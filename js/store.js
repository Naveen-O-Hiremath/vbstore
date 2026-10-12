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

  return { KEYS, load, save, connect, unwrap, fromRow, toRow, fetchCatalogue, staffEmail, inr, esc, telegramCall, download };
})();
