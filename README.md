# VB Store

Storefront and admin panel for VB Store. Prices in Indian Rupees, delivery
addresses with PIN code and state, Cash on Delivery / UPI, and order alerts on
Telegram.

- `index.html` is the store. `admin.html` is the admin panel.
- The pages are plain HTML, CSS and JavaScript with no build step, so any
  static host (this repository uses GitHub Pages) can serve them.
- Products, categories, orders, settings and admin users live in a
  [Supabase](https://supabase.com) database. `js/config.js` holds the project
  URL and publishable key, both of which are safe to publish.

## How it fits together

| Part | Where |
| --- | --- |
| Catalogue, bag, checkout | `js/app.js` |
| Admin panel | `js/admin.js` |
| Shared helpers and data access | `js/store.js` |
| Theme colours (light and dark) | `css/site.css`, `js/tw.js` |
| Database tables, security rules, checkout logic | `supabase/schema.sql` |
| Sample catalogue | `supabase/seed.sql` |

Checkout calls the `place_order` database function. It re-checks stock and
prices on the server, reduces stock, saves the order and sends the Telegram
alert. The bot token is stored in a private table and never reaches the
browser of a customer.

Admin users have one of two roles: `admin` (full access) or `viewer`
(read-only). The database enforces this with row level security, so the rules
hold even if someone bypasses the page.

## Setting up a new database

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor,
   then `supabase/seed.sql` if you want the sample products.
2. Create the first admin:
   `select private.create_staff('admin', 'a-strong-password', 'admin');`
3. Put the project URL and publishable key in `js/config.js`.
4. Sign in at `admin.html` and fill in Settings → Telegram order alerts.

## Running locally

Serve the folder with any static server, for example
`python -m http.server 8000`, and open `http://localhost:8000`.
