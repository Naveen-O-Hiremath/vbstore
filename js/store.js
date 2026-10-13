// Shared helpers and data access for the storefront and the admin panel.
// The catalogue, orders and settings live in the Supabase database.
window.VB = (() => {
  const KEYS = {
    cart: "vb_cart",
    wishlist: "vb_wishlist",
    customer: "vb_customer",
    theme: "vb_theme"
  };
  // Staff sign in with a username; the database stores it as an address on this domain.
  const STAFF_DOMAIN = "vbstore.local";

  const load = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };
  const save = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };

  // The storefront always connects as an anonymous customer, even if an admin
  // is signed in on the same browser; only the admin panel keeps a session.
  const connect = ({ staff = false } = {}) => supabase.createClient(
    window.VB_CONFIG.supabaseUrl,
    window.VB_CONFIG.supabaseKey,
    { auth: staff ? { storageKey: "vb_staff_session" } : { persistSession: false, autoRefreshToken: false, storageKey: "vb_anon" } }
  );

  // Supabase returns { data, error }; turn that into a value or a thrown Error.
  const unwrap = async (query) => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  };

  // The database column is "description"; the pages use the shorter "desc".
  const fromRow = ({ description, ...row }) => ({ ...row, desc: description });
  const toRow = ({ desc, ...product }) => ({ ...product, description: desc });

  const fetchCatalogue = async (db) => {
    const [products, categories, settings] = await Promise.all([
      unwrap(db.from("products").select("*").order("position").order("name")),
      unwrap(db.from("categories").select("*").order("position").order("name")),
      unwrap(db.from("settings").select("*").single())
    ]);
    return {
      products: products.map(fromRow),
      categories: categories.map((c) => c.name),
      shipping: { fee: settings.shipping_fee, freeAbove: settings.free_above }
    };
  };

  const staffEmail = (username) => {
    const name = username.trim().toLowerCase();
    return name.includes("@") ? name : `${name}@${STAFF_DOMAIN}`;
  };

  const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  const inr = (amount) => rupees.format(Number(amount) || 0);

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  // Used only by the admin's Telegram setup, with the token an admin typed in.
  const telegramCall = async (token, method, params) => {
    // Form-encoded keeps this a "simple" cross-origin request (no preflight).
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      body: new URLSearchParams(params)
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || `Telegram error ${res.status}`);
    return json.result;
  };

  // ---------- Deals from other shopping sites (deals page and the store's home page) ----------

  const fetchDeals = (db) => unwrap(
    db.from("deals").select("id,title,source,url,image,price,old_price,description").order("position").order("id")
  );
  const dealDrop = (d) => d.old_price - d.price;
  const dealPercentOff = (d) => Math.round((dealDrop(d) / d.old_price) * 100);

  // One deal as a card. Every link opens the seller's site in a new tab;
  // rel="sponsored nofollow" tells search engines these are outbound shopping links.
  const dealCard = (d, extraClasses = "") => {
    // Links come from the database; only ever render web addresses as links.
    const url = /^https?:\/\//i.test(d.url) ? d.url : "#";
    const link = (classes, inner, label = "") => `<a href="${esc(url)}" target="_blank" rel="noopener sponsored nofollow" data-deal="${d.id}" ${label ? `aria-label="${esc(label)}"` : ""} class="${classes}">${inner}</a>`;
    const drop = dealDrop(d);
    return `
      <article class="group relative bg-surface-container-lowest p-5 flex flex-col justify-between hover:bg-surface-container-low transition-colors duration-200 ${extraClasses}">
        <div>
          <div class="flex items-center justify-between gap-2 pb-2">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-label-sm uppercase"><span class="msym !text-[14px]">storefront</span>${esc(d.source)}</span>
            ${drop ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary/10 border border-tertiary/30 text-tertiary text-label-sm"><span class="msym !text-[14px]">trending_down</span>${inr(drop)} OFF</span>` : ""}
          </div>
          ${link("relative w-full aspect-[4/3] flex items-center justify-center overflow-hidden my-2 bg-surface-container/20 rounded-xl", d.image
            ? `<img src="${esc(d.image)}" alt="${esc(d.title)}" loading="lazy" class="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-500" onerror="this.style.visibility='hidden'"/>`
            : `<span class="msym !text-[40px] text-outline">image</span>`, `${d.title} on ${d.source}`)}
          <h3 class="text-body-md font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">${link("", esc(d.title))}</h3>
          ${d.description ? `<p class="text-body-sm text-on-surface-variant line-clamp-3 mt-1">${esc(d.description)}</p>` : ""}
        </div>
        <div class="pt-3 mt-3 border-t border-outline-variant/30">
          <div class="flex items-baseline flex-wrap gap-x-2">
            <span class="font-mono text-headline-sm text-primary font-bold">${inr(d.price)}</span>
            ${drop ? `<span class="font-mono text-label-md text-outline line-through">${inr(d.old_price)}</span><span class="text-label-sm text-tertiary">${dealPercentOff(d)}% OFF</span>` : ""}
          </div>
          ${link("btn btn-secondary w-full !rounded-xl mt-3 hover:!bg-primary hover:!text-on-primary", `<span>View on ${esc(d.source)}</span><span class="msym !text-[18px]">open_in_new</span>`)}
        </div>
      </article>`;
  };

  // Counts a click on any deal link, then lets the browser open the seller's
  // site as normal. Middle-click (open in a new tab) arrives as "auxclick".
  const trackDealClicks = (db) => {
    const track = (event) => {
      const link = event.target.closest("a[data-deal]");
      if (!link || (event.type === "auxclick" && event.button !== 1)) return;
      db.rpc("track_deal_click", { p_deal_id: Number(link.dataset.deal) }).then(() => {}, () => {});
    };
    document.addEventListener("click", track);
    document.addEventListener("auxclick", track);
  };

  const download = (filename, text, type = "application/json") => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // Light / dark theme. js/tw.js applies the saved choice before first paint;
  // any element with data-theme-toggle switches it.
  const root = document.documentElement;
  const syncThemeButtons = () => {
    const light = root.dataset.theme === "light";
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.title = light ? "Switch to dark theme" : "Switch to light theme";
      button.setAttribute("aria-label", button.title);
      const icon = button.querySelector(".msym");
      if (icon) icon.textContent = light ? "dark_mode" : "light_mode";
    });
  };
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-theme-toggle]")) return;
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    try { localStorage.setItem(KEYS.theme, root.dataset.theme); } catch {}
    syncThemeButtons();
  });
  syncThemeButtons();

  return {
    KEYS, load, save, connect, unwrap, fromRow, toRow, fetchCatalogue, staffEmail, inr, esc, telegramCall, download,
    fetchDeals, dealDrop, dealPercentOff, dealCard, trackDealClicks
  };
})();
