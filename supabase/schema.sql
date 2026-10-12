-- VB Store database for Supabase (Postgres). Safe to run more than once.
-- Run it in the Supabase SQL editor, then create the first admin with:
--   select private.create_staff('admin', '<a password of 8+ characters>', 'admin');
-- No secrets live in this file. The Telegram bot token is stored in the
-- private schema from Admin → Settings and is never readable by customers.

create extension if not exists pg_net;
create schema if not exists private;

-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  username   text not null unique,
  role       text not null check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  name     text primary key check (length(btrim(name)) between 1 and 40),
  position integer not null default 0
);

create table if not exists public.products (
  id          text primary key,
  name        text not null check (length(btrim(name)) between 1 and 80),
  category    text not null references public.categories (name) on update cascade on delete restrict,
  series      text not null default '',
  price       integer not null check (price > 0),
  mrp         integer not null,
  description text not null default '',
  image       text not null default '',
  badge       text not null default '',
  spec        text not null default '',
  stock       integer not null default 0 check (stock >= 0),
  featured    boolean not null default false,
  hidden      boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  check (mrp >= price)
);

create table if not exists public.settings (
  id           boolean primary key default true check (id),
  store_name   text not null default 'VB Store',
  shipping_fee integer not null default 79 check (shipping_fee >= 0),
  free_above   integer not null default 999 check (free_above >= 0)
);
insert into public.settings default values on conflict do nothing;

create table if not exists public.orders (
  id            bigint generated always as identity primary key,
  order_no      text not null unique,
  created_at    timestamptz not null default now(),
  status        text not null default 'new' check (status in ('new', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  customer_name text not null,
  phone         text not null,
  email         text not null default '',
  line1         text not null,
  line2         text not null default '',
  city          text not null,
  state         text not null,
  pin           text not null,
  payment       text not null,
  notes         text not null default '',
  items         jsonb not null, -- [{ id, name, price, qty }]
  subtotal      integer not null,
  shipping      integer not null,
  total         integer not null
);

-- Telegram bot details. The private schema is not exposed through the API.
create table if not exists private.telegram (
  id        boolean primary key default true check (id),
  bot_token text not null default '',
  chat_ids  text[] not null default '{}'
);
insert into private.telegram default values on conflict do nothing;

-- ---------------------------------------------------------------- roles

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = (select auth.uid()));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = (select auth.uid()) and role = 'admin');
$$;

create or replace function private.require_admin() returns void
language plpgsql set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can do this.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------- row level security

alter table public.profiles   enable row level security;
alter table public.categories enable row level security;
alter table public.products   enable row level security;
alter table public.settings   enable row level security;
alter table public.orders     enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.categories, public.products, public.settings to anon, authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;
grant update on public.settings to authenticated;
grant select on public.orders, public.profiles to authenticated;

drop policy if exists "staff read profiles" on public.profiles;
create policy "staff read profiles" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "anyone reads categories" on public.categories;
create policy "anyone reads categories" on public.categories for select to anon, authenticated using (true);
drop policy if exists "admins manage categories" on public.categories;
create policy "admins manage categories" on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Customers only ever see visible products; staff see hidden ones too.
drop policy if exists "read products" on public.products;
create policy "read products" on public.products for select to anon, authenticated
  using (not hidden or public.is_staff());
drop policy if exists "admins manage products" on public.products;
create policy "admins manage products" on public.products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "anyone reads settings" on public.settings;
create policy "anyone reads settings" on public.settings for select to anon, authenticated using (true);
drop policy if exists "admins change settings" on public.settings;
create policy "admins change settings" on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Orders are written only by place_order() and set_order_status() below.
drop policy if exists "staff read orders" on public.orders;
create policy "staff read orders" on public.orders for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------- product photos

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('products', 'products', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "admins upload product photos" on storage.objects;
create policy "admins upload product photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'products' and public.is_admin());
drop policy if exists "admins replace product photos" on storage.objects;
create policy "admins replace product photos" on storage.objects for update to authenticated
  using (bucket_id = 'products' and public.is_admin());
drop policy if exists "admins delete product photos" on storage.objects;
create policy "admins delete product photos" on storage.objects for delete to authenticated
  using (bucket_id = 'products' and public.is_admin());

-- ---------------------------------------------------------------- helpers

-- 2062383 -> ₹20,62,383 (Indian digit grouping)
create or replace function private.inr(n integer) returns text
language sql immutable set search_path = '' as $$
  select '₹' || case
    when n < 1000 then n::text
    else regexp_replace((n / 1000)::text, '(\d)(?=(\d\d)+$)', '\1,', 'g') || ',' || lpad((n % 1000)::text, 3, '0')
  end;
$$;

create or replace function private.html(t text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

-- ---------------------------------------------------------------- checkout

-- Called by the storefront. Prices, stock and delivery charges are taken from
-- the database, never from the browser. Reduces stock, saves the order and
-- queues a Telegram alert to every configured chat.
create or replace function public.place_order(p_items jsonb, p_customer jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name    text := btrim(coalesce(p_customer ->> 'name', ''));
  v_phone   text := btrim(coalesce(p_customer ->> 'phone', ''));
  v_email   text := btrim(coalesce(p_customer ->> 'email', ''));
  v_line1   text := btrim(coalesce(p_customer ->> 'line1', ''));
  v_line2   text := btrim(coalesce(p_customer ->> 'line2', ''));
  v_city    text := btrim(coalesce(p_customer ->> 'city', ''));
  v_state   text := btrim(coalesce(p_customer ->> 'state', ''));
  v_pin     text := btrim(coalesce(p_customer ->> 'pin', ''));
  v_payment text := btrim(coalesce(p_customer ->> 'payment', ''));
  v_notes   text := btrim(coalesce(p_customer ->> 'notes', ''));
  v_line     record;
  v_product  public.products%rowtype;
  v_settings public.settings%rowtype;
  v_telegram private.telegram%rowtype;
  v_items    jsonb := '[]'::jsonb;
  v_lines    text := '';
  v_count    integer := 0;
  v_subtotal integer := 0;
  v_shipping integer := 0;
  v_order_no text;
  v_text     text;
  v_chat     text;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your bag is empty.';
  elsif jsonb_array_length(p_items) > 30 then
    raise exception 'Too many different items in one order.';
  elsif length(v_name) not between 2 and 80 then
    raise exception 'Please enter your full name.';
  elsif v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid 10-digit Indian mobile number.';
  elsif length(v_email) > 120 or (v_email <> '' and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'Enter a valid email address or leave it blank.';
  elsif length(v_line1) not between 5 and 160 or length(v_line2) > 160 then
    raise exception 'Please enter your house number and street.';
  elsif length(v_city) not between 2 and 60 then
    raise exception 'Please enter your city or town.';
  elsif length(v_state) not between 2 and 60 then
    raise exception 'Please select your state.';
  elsif v_pin !~ '^[1-9][0-9]{5}$' then
    raise exception 'Enter a valid 6-digit PIN code.';
  elsif v_payment not in ('Cash on Delivery', 'UPI') then
    raise exception 'Please choose a payment preference.';
  elsif length(v_notes) > 400 then
    raise exception 'Order notes are too long.';
  end if;

  -- Brake on scripted spam: a real shop will not see this many orders an hour.
  if (select count(*) from public.orders where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'We are receiving a lot of orders right now. Please try again in a little while.';
  end if;

  for v_line in
    select e ->> 'id' as id, sum((e ->> 'qty')::integer)::integer as qty
    from jsonb_array_elements(p_items) as e
    group by 1 order by 1 -- fixed order so two simultaneous orders cannot deadlock
  loop
    if v_line.qty is null or v_line.qty < 1 then
      raise exception 'Invalid quantity in your bag.';
    end if;
    select * into v_product from public.products where id = v_line.id and not hidden for update;
    if not found then
      raise exception 'One of the items in your bag is no longer available. Please refresh the page.';
    elsif v_product.stock = 0 then
      raise exception '% is sold out.', v_product.name;
    elsif v_product.stock < v_line.qty then
      raise exception 'Only % left of %. Please reduce the quantity.', v_product.stock, v_product.name;
    end if;
    update public.products set stock = stock - v_line.qty where id = v_product.id;

    v_count := v_count + 1;
    v_subtotal := v_subtotal + v_product.price * v_line.qty;
    v_items := v_items || jsonb_build_object('id', v_product.id, 'name', v_product.name, 'price', v_product.price, 'qty', v_line.qty);
    v_lines := v_lines || format(E'%s. %s × %s — %s\n', v_count, private.html(v_product.name), v_line.qty, private.inr(v_product.price * v_line.qty));
  end loop;

  select * into v_settings from public.settings;
  if v_subtotal < v_settings.free_above then
    v_shipping := v_settings.shipping_fee;
  end if;

  loop
    v_order_no := 'VB-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-' ||
      (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::integer, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from public.orders where order_no = v_order_no);
  end loop;

  insert into public.orders (order_no, customer_name, phone, email, line1, line2, city, state, pin, payment, notes, items, subtotal, shipping, total)
  values (v_order_no, v_name, v_phone, v_email, v_line1, v_line2, v_city, v_state, v_pin, v_payment, v_notes, v_items, v_subtotal, v_shipping, v_subtotal + v_shipping);

  -- The alert is best effort: the order is already saved and shows in the admin.
  begin
    select * into v_telegram from private.telegram;
    if v_telegram.bot_token <> '' then
      v_text := format(E'🛒 <b>New order %s</b>\n%s IST\n\n<b>Items</b>\n%s\nSubtotal: %s\nDelivery: %s\n<b>Total: %s</b>\nPayment: %s\n\n<b>Customer</b>\n%s\n📞 +91 %s%s\n\n<b>Deliver to</b>\n%s%s\n%s, %s – %s%s',
        v_order_no,
        to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI am'),
        v_lines,
        private.inr(v_subtotal),
        case when v_shipping = 0 then 'FREE' else private.inr(v_shipping) end,
        private.inr(v_subtotal + v_shipping),
        v_payment,
        private.html(v_name),
        v_phone,
        case when v_email <> '' then E'\n✉️ ' || private.html(v_email) else '' end,
        private.html(v_line1),
        case when v_line2 <> '' then E'\n' || private.html(v_line2) else '' end,
        private.html(v_city), private.html(v_state), v_pin,
        case when v_notes <> '' then E'\n\n<b>Notes</b>\n' || private.html(v_notes) else '' end);
      foreach v_chat in array v_telegram.chat_ids loop
        perform net.http_post(
          url  := 'https://api.telegram.org/bot' || v_telegram.bot_token || '/sendMessage',
          body := jsonb_build_object('chat_id', v_chat, 'text', v_text, 'parse_mode', 'HTML', 'disable_web_page_preview', true));
      end loop;
    end if;
  exception when others then
    raise warning 'Telegram alert for % was not queued: %', v_order_no, sqlerrm;
  end;

  return jsonb_build_object('order_no', v_order_no, 'subtotal', v_subtotal, 'shipping', v_shipping, 'total', v_subtotal + v_shipping);
end;
$$;

-- Admin only. Cancelling an order puts its items back into stock.
create or replace function public.set_order_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
begin
  perform private.require_admin();
  select * into v_order from public.orders where id = p_id for update;
  if not found then
    raise exception 'Order not found.';
  elsif v_order.status = 'cancelled' then
    raise exception 'A cancelled order cannot be reopened.';
  end if;
  if p_status = 'cancelled' then
    update public.products p set stock = p.stock + (i ->> 'qty')::integer
    from jsonb_array_elements(v_order.items) as i
    where p.id = i ->> 'id';
  end if;
  update public.orders set status = p_status where id = p_id;
end;
$$;

-- ---------------------------------------------------------------- telegram settings (admin only)

create or replace function public.get_telegram_settings() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select jsonb_build_object('botToken', bot_token, 'chatIds', to_jsonb(chat_ids)) from private.telegram);
end;
$$;

create or replace function public.set_telegram_settings(p_bot_token text, p_chat_ids text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update private.telegram set bot_token = btrim(coalesce(p_bot_token, '')), chat_ids = coalesce(p_chat_ids, '{}');
end;
$$;

-- ---------------------------------------------------------------- admin panel users

-- Staff sign in with a username; Supabase Auth stores it as <username>@vbstore.local.
create or replace function private.create_staff(p_username text, p_password text, p_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_email    text;
  v_id       uuid := gen_random_uuid();
begin
  if v_username !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Usernames need 3 to 30 characters: letters, numbers, dot, dash or underscore.';
  elsif length(coalesce(p_password, '')) < 8 then
    raise exception 'Passwords need at least 8 characters.';
  elsif p_role not in ('admin', 'viewer') then
    raise exception 'Unknown access level.';
  elsif exists (select 1 from public.profiles where username = v_username) then
    raise exception '"%" already exists.', v_username;
  end if;
  v_email := v_username || '@vbstore.local';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, 'email',
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), now(), now(), now());

  insert into public.profiles (user_id, username, role) values (v_id, v_username, p_role);
  return v_id;
end;
$$;

create or replace function public.staff_create(p_username text, p_password text, p_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return private.create_staff(p_username, p_password, p_role);
end;
$$;

-- Admins can set anyone's password; everyone can change their own.
create or replace function public.staff_set_password(p_user_id uuid, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is distinct from (select auth.uid()) then
    perform private.require_admin();
  elsif not public.is_staff() then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Passwords need at least 8 characters.';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_user_id and id in (select user_id from public.profiles);
end;
$$;

create or replace function public.staff_set_role(p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_role not in ('admin', 'viewer') then
    raise exception 'Unknown access level.';
  end if;
  update public.profiles set role = p_role where user_id = p_user_id;
  if not exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'Keep at least one user with Admin access.';
  end if;
end;
$$;

create or replace function public.staff_delete(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot remove your own account.';
  end if;
  delete from auth.users where id = p_user_id and id in (select user_id from public.profiles);
end;
$$;

-- Only place_order is open to customers; the rest need a signed-in user and
-- check for admin rights themselves.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.place_order(jsonb, jsonb), public.is_staff(), public.is_admin() to anon, authenticated;
grant execute on all functions in schema public to authenticated;
revoke all on schema private from public, anon, authenticated;

notify pgrst, 'reload schema';
