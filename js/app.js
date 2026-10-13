// Storefront: catalogue, wishlist, bag and checkout.
(() => {
  const { KEYS, load, save, inr, esc } = VB;
  const db = VB.connect();
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
    "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
    "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
    "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"
  ];

  const config = { shipping: { fee: 0, freeAbove: 0 } };
  let products = [];
  let categories = [];
  const byId = (id) => products.find((p) => p.id === id);
  const discount = (p) => (p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0);

  const state = { cat: "all", q: "", inStock: false, wishOnly: false, sort: "featured" };
  let wishlist = load(KEYS.wishlist, []);
  let cart = load(KEYS.cart, []);

  // Loads the live catalogue. Runs at start and after every order attempt so
  // stock on screen stays current. The database only returns visible products.
  async function loadCatalogue() {
    const catalogue = await VB.fetchCatalogue(db);
    products = catalogue.products;
    categories = catalogue.categories.filter((cat) => products.some((p) => p.category === cat));
    config.shipping = catalogue.shipping;
    wishlist = wishlist.filter(byId);
    // Drop bag lines whose product was removed or sold out, and cap to stock.
    cart = cart
      .filter((line) => byId(line.id)?.stock > 0)
      .map((line) => ({ id: line.id, qty: Math.max(1, Math.min(line.qty | 0, byId(line.id).stock)) }));
  }

  // ---------- Small render helpers ----------

  const image = (p, classes) => (p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" class="${classes}" onerror="this.style.visibility='hidden'"/>`
    : `<span class="msym !text-[40px] text-outline">image</span>`);

  const stockBadge = (p) => {
    if (p.stock <= 0) {
      return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-error/10 border border-error/30 text-error text-label-sm">SOLD OUT</span>`;
    }
    if (p.stock <= 5) {
      return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-error/10 border border-error/30 text-error text-label-sm"><span class="h-1.5 w-1.5 rounded-full bg-error animate-pulse"></span>ONLY ${p.stock} LEFT</span>`;
    }
    return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-tertiary/10 border border-tertiary/30 text-tertiary text-label-sm"><span class="h-1.5 w-1.5 rounded-full bg-tertiary animate-pulse"></span>IN STOCK</span>`;
  };

  const priceBlock = (p, size = "text-label-lg") => `
    <span class="inline-flex items-baseline flex-wrap gap-x-2">
      <span class="font-mono ${size} text-primary font-bold">${inr(p.price)}</span>
      ${discount(p) ? `<span class="font-mono text-label-md text-outline line-through">${inr(p.mrp)}</span><span class="text-label-sm text-tertiary">${discount(p)}% OFF</span>` : ""}
    </span>`;

  const heart = (p, extra = "") => {
    const on = wishlist.includes(p.id);
    return `<button type="button" data-action="wish" data-id="${esc(p.id)}" aria-pressed="${on}" title="${on ? "Remove from wishlist" : "Add to wishlist"}" class="p-1 ${on ? "text-error" : "text-outline hover:text-error"} ${extra}"><span class="msym ${on ? "fill" : ""}">favorite</span></button>`;
  };

  // ---------- Catalogue ----------

  function visibleProducts() {
    const q = state.q.trim().toLowerCase();
    const list = products.filter((p) => (
      (state.cat === "all" || p.category === state.cat) &&
      (!state.inStock || p.stock > 0) &&
      (!state.wishOnly || wishlist.includes(p.id)) &&
      (!q || [p.name, p.category, p.series, p.desc, p.badge].join(" ").toLowerCase().includes(q))
    ));
    const sorters = {
      low: (a, b) => a.price - b.price,
      high: (a, b) => b.price - a.price,
      discount: (a, b) => discount(b) - discount(a),
      featured: (a, b) => Number(!!b.featured) - Number(!!a.featured)
    };
    return list.sort(sorters[state.sort]);
  }

  function renderHero() {
    const hero = $("#hero");
    const p = products.find((x) => x.featured && x.stock > 0) || products.find((x) => x.stock > 0) || products[0];
    if (!p) {
      hero.innerHTML = `<div class="py-16 text-center"><h1 class="text-headline-lg uppercase font-bold">Catalogue coming soon</h1><p class="text-on-surface-variant mt-2">New products are on the way. Please check back shortly.</p></div>`;
      return;
    }
    const { fee, freeAbove } = config.shipping;
    hero.innerHTML = `
      <div class="flex flex-wrap items-center gap-2 pb-4 border-b border-outline-variant/40 text-outline text-label-md uppercase tracking-wider">
        <span class="text-tertiary font-bold tracking-widest">FEATURED</span><span>/</span>
        <span class="text-on-surface-variant">${esc(p.category)}</span>
        ${p.series ? `<span>/</span><span class="text-on-surface font-semibold">${esc(p.series)}</span>` : ""}
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 pt-6 items-center">
        <div class="lg:col-span-5 flex flex-col space-y-4 order-2 lg:order-1">
          <div class="flex flex-wrap items-center gap-1">
            ${stockBadge(p)}
            ${p.badge ? `<span class="bg-surface-container-high text-on-surface-variant px-2 py-0.5 rounded-full text-label-sm uppercase">${esc(p.badge)}</span>` : ""}
          </div>
          <h1 class="text-[32px] leading-9 md:text-headline-xl uppercase font-bold tracking-tight">
            <span class="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">${esc(p.name)}</span>
          </h1>
          <p class="text-body-lg text-on-surface-variant max-w-lg">${esc(p.desc)}</p>
          <div class="grid grid-cols-2 gap-1 p-3 bg-surface-container-low rounded-xl border border-outline-variant/40">
            <div class="flex flex-col">
              <span class="text-label-sm uppercase text-outline">Price (incl. taxes)</span>
              ${priceBlock(p, "text-headline-sm")}
            </div>
            <div class="flex flex-col border-l border-outline-variant/40 pl-3">
              <span class="text-label-sm uppercase text-outline">Highlights</span>
              <span class="text-body-md font-semibold">${esc(p.spec || p.series || p.category)}</span>
            </div>
          </div>
          <div class="flex flex-col sm:flex-row items-stretch gap-2">
            <button type="button" data-action="buy" data-id="${esc(p.id)}" class="btn btn-primary flex-1 !py-3.5" ${p.stock > 0 ? "" : "disabled"}>
              <span class="msym">bolt</span><span>Buy now — ${inr(p.price)}</span>
            </button>
            <button type="button" data-action="add" data-id="${esc(p.id)}" class="btn btn-secondary !py-3.5" ${p.stock > 0 ? "" : "disabled"}>
              <span class="msym text-tertiary">add_shopping_cart</span><span>Add to bag</span>
            </button>
          </div>
          <div class="flex items-center justify-between text-outline text-label-sm">
            <span class="flex items-center gap-1 text-tertiary"><span class="msym !text-[16px]">verified</span>Cash on Delivery available</span>
            <span>${fee ? `Free delivery above ${inr(freeAbove)}` : "Free delivery"}</span>
          </div>
        </div>
        <div class="lg:col-span-7 relative order-1 lg:order-2 flex items-center justify-center">
          <div class="absolute inset-0 hidden sm:flex items-center justify-center pointer-events-none">
            <div class="absolute w-[420px] h-[420px] rounded-full border border-primary/20"></div>
            <div class="absolute w-[520px] h-[520px] rounded-full border border-secondary/10"></div>
          </div>
          <button type="button" data-action="view" data-id="${esc(p.id)}" aria-label="View ${esc(p.name)}" class="relative w-full aspect-square max-w-[560px] flex items-center justify-center p-4">
            ${image(p, "w-full h-full object-contain rounded-2xl drop-shadow-[0_25px_35px_rgba(0,0,0,0.45)] transition-transform duration-700 hover:scale-105 select-none")}
            ${discount(p) ? `<span class="absolute top-6 left-6 bg-surface-container/90 backdrop-blur-md border border-outline-variant/60 rounded-lg p-2.5 flex items-center gap-2 shadow-lg text-label-sm"><span class="msym !text-[18px] text-tertiary">sell</span>Save ${inr(p.mrp - p.price)}</span>` : ""}
            <span class="absolute bottom-6 left-6 bg-surface-container/90 backdrop-blur-md border border-outline-variant/60 rounded-lg p-2.5 flex items-center gap-2 shadow-lg text-label-sm"><span class="msym !text-[18px] text-primary">local_shipping</span>Delivered across India</span>
          </button>
        </div>
      </div>`;
  }

  function renderFilters() {
    $("#nav-cats").innerHTML = categories.slice(0, 5).map((cat) => `
      <button type="button" data-action="cat" data-cat="${esc(cat)}" data-scroll class="text-label-md px-2 py-1 rounded-lg transition-colors ${state.cat === cat ? "bg-primary-container text-on-primary-container font-semibold" : "text-on-surface-variant hover:text-on-surface"}">${esc(cat)}</button>`).join("");

    const menuRow = (value, label, icon) => `
      <button type="button" data-action="cat" data-cat="${esc(value)}" data-scroll class="menu-link ${state.cat === value ? "active" : ""}"><span class="msym">${icon}</span>${esc(label)}</button>`;
    $("#menu-cats").innerHTML = menuRow("all", "All products", "apps") + categories.map((cat) => menuRow(cat, cat, "label")).join("");

    const pill = (value, label) => `
      <button type="button" data-action="cat" data-cat="${esc(value)}" class="shrink-0 px-4 py-1.5 rounded-lg text-label-md transition-all ${state.cat === value ? "bg-primary text-on-primary font-semibold" : "bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface"}">${esc(label)}</button>`;
    $("#cat-pills").innerHTML =
      pill("all", `All Products (${products.length})`) +
      categories.map((cat) => pill(cat, cat)).join("") +
      (state.wishOnly ? `<button type="button" data-action="wish-filter" class="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-label-md bg-error/10 border border-error/30 text-error"><span class="msym fill !text-[14px]">favorite</span>Wishlist<span class="msym !text-[14px]">close</span></button>` : "");
  }

  function renderGrid() {
    const list = visibleProducts();
    $("#grid").hidden = !list.length;
    $("#grid-empty").hidden = !!list.length;
    $("#grid").innerHTML = list.map((p) => `
      <article class="group relative bg-surface-container-lowest p-6 flex flex-col justify-between hover:bg-surface-container-low transition-colors duration-200">
        <div>
          <div class="flex items-center justify-between pb-2">${stockBadge(p)}${heart(p)}</div>
          <button type="button" data-action="view" data-id="${esc(p.id)}" aria-label="View ${esc(p.name)}" class="relative w-full aspect-[4/3] flex items-center justify-center overflow-hidden my-2 bg-surface-container/20 rounded-xl">
            ${image(p, "w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-500")}
            ${p.badge ? `<span class="absolute bottom-2 left-2 text-[10px] uppercase font-mono tracking-wider bg-surface-container-lowest/80 px-1.5 py-0.5 rounded text-outline">${esc(p.badge)}</span>` : ""}
          </button>
          <div class="space-y-1">
            <span class="text-label-sm uppercase text-outline">${esc(p.series || p.category)}</span>
            <h3 class="text-headline-sm font-semibold group-hover:text-primary transition-colors">
              <button type="button" data-action="view" data-id="${esc(p.id)}" class="text-left">${esc(p.name)}</button>
            </h3>
            <p class="text-body-sm text-on-surface-variant line-clamp-2">${esc(p.desc)}</p>
          </div>
          <div class="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/30 mt-2">
            ${priceBlock(p)}
            <span class="text-label-sm text-on-surface-variant font-mono text-right">${esc(p.spec)}</span>
          </div>
        </div>
        <div class="pt-4 mt-2">
          <button type="button" data-action="add" data-id="${esc(p.id)}" ${p.stock > 0 ? "" : "disabled"} class="btn btn-secondary w-full !rounded-xl hover:!bg-primary hover:!text-on-primary">
            <span class="msym !text-[18px]">add_shopping_cart</span><span>${p.stock > 0 ? "Add to Bag" : "Sold out"}</span>
          </button>
        </div>
      </article>`).join("");
  }

  function renderWishCount() {
    const badge = $("#wish-count");
    badge.hidden = !wishlist.length;
    badge.textContent = wishlist.length;
    $("#menu-wish-count").textContent = wishlist.length || "";
  }

  function renderCatalogue() {
    renderFilters();
    renderGrid();
    renderWishCount();
  }

  function openQuickView(p) {
    const dialog = $("#quick-view");
    dialog.innerHTML = `
      <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant grid grid-cols-1 md:grid-cols-2 overflow-hidden">
        <div class="aspect-square bg-surface-container/30 flex items-center justify-center">${image(p, "w-full h-full object-contain p-6")}</div>
        <div class="p-6 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            ${stockBadge(p)}
            <button type="button" data-action="close-view" aria-label="Close" class="p-1 text-outline hover:text-on-surface"><span class="msym">close</span></button>
          </div>
          <span class="text-label-sm uppercase text-outline">${esc([p.category, p.series].filter(Boolean).join(" · "))}</span>
          <h2 class="text-headline-md font-semibold">${esc(p.name)}</h2>
          ${priceBlock(p, "text-headline-sm")}
          <p class="text-label-md text-outline -mt-2">Inclusive of all taxes</p>
          <p class="text-body-md text-on-surface-variant">${esc(p.desc)}</p>
          ${p.spec ? `<p class="font-mono text-body-sm text-on-surface border-t border-outline-variant/40 pt-3">${esc(p.spec)}</p>` : ""}
          <div class="flex gap-2 mt-auto pt-3">
            <button type="button" data-action="buy" data-id="${esc(p.id)}" ${p.stock > 0 ? "" : "disabled"} class="btn btn-primary flex-1"><span class="msym">bolt</span>${p.stock > 0 ? "Buy now" : "Sold out"}</button>
            <button type="button" data-action="add" data-id="${esc(p.id)}" ${p.stock > 0 ? "" : "disabled"} class="btn btn-secondary"><span class="msym">add_shopping_cart</span>Add</button>
          </div>
        </div>
      </div>`;
    if (!dialog.open) dialog.showModal();
  }

  // ---------- Bag ----------

  const cartLines = () => cart.map((line) => ({ p: byId(line.id), qty: line.qty }));

  function totals() {
    const subtotal = cartLines().reduce((sum, { p, qty }) => sum + p.price * qty, 0);
    const { fee, freeAbove } = config.shipping;
    const shipping = subtotal > 0 && subtotal < freeAbove ? fee : 0;
    return { subtotal, shipping, total: subtotal + shipping };
  }

  function renderCart() {
    save(KEYS.cart, cart);
    const lines = cartLines();
    const count = lines.reduce((sum, line) => sum + line.qty, 0);
    const { subtotal, shipping, total } = totals();
    const { fee, freeAbove } = config.shipping;

    $("#cart-count").textContent = count;
    $("#menu-cart-count").textContent = count || "";
    $("#bag-count").textContent = count;
    $("#cart-pill-total").textContent = inr(subtotal);
    $("#to-checkout").disabled = !lines.length;

    $("#bag-items").innerHTML = lines.length ? lines.map(({ p, qty }) => `
      <div class="flex items-center gap-4 p-2 bg-surface-container-low rounded-xl border border-outline-variant/50">
        <div class="w-16 h-16 shrink-0 bg-surface-container rounded-lg flex items-center justify-center overflow-hidden">${image(p, "w-full h-full object-contain p-1")}</div>
        <div class="flex-1 min-w-0">
          <h3 class="text-label-lg truncate">${esc(p.name)}</h3>
          <p class="text-[12px] text-on-surface-variant font-mono">${inr(p.price)} each</p>
          <div class="flex items-center justify-between pt-1">
            <span class="font-mono text-body-sm text-primary font-bold">${inr(p.price * qty)}</span>
            <div class="flex items-center gap-2">
              <div class="flex items-center border border-outline-variant rounded-md bg-surface-container-highest">
                <button type="button" data-action="qty" data-delta="-1" data-id="${esc(p.id)}" aria-label="Decrease quantity" class="px-2.5 py-0.5 hover:text-primary">−</button>
                <span class="px-1 text-xs font-mono font-bold">${qty}</span>
                <button type="button" data-action="qty" data-delta="1" data-id="${esc(p.id)}" aria-label="Increase quantity" class="px-2.5 py-0.5 hover:text-primary disabled:opacity-30" ${qty >= p.stock ? "disabled" : ""}>+</button>
              </div>
              <button type="button" data-action="remove" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}" class="text-outline hover:text-error"><span class="msym !text-[18px]">delete</span></button>
            </div>
          </div>
        </div>
      </div>`).join("") : `
      <div class="h-full flex flex-col items-center justify-center text-center gap-2 py-16">
        <span class="msym !text-[40px] text-outline">shopping_bag</span>
        <p class="text-headline-sm">Your bag is empty</p>
        <p class="text-body-sm text-on-surface-variant">Add something you like to get started.</p>
      </div>`;

    const progress = $("#ship-progress");
    progress.hidden = !lines.length || !fee;
    if (!progress.hidden) {
      const unlocked = subtotal >= freeAbove;
      progress.innerHTML = `
        <div class="flex items-center justify-between text-label-sm pb-1.5">
          <span class="${unlocked ? "text-tertiary" : "text-on-surface-variant"} flex items-center gap-1"><span class="msym !text-[16px]">${unlocked ? "check_circle" : "local_shipping"}</span>${unlocked ? "You have unlocked free delivery" : `Add ${inr(freeAbove - subtotal)} more for free delivery`}</span>
        </div>
        <div class="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
          <div class="bg-tertiary h-full rounded-full transition-all" style="width:${Math.min(100, (subtotal / freeAbove) * 100)}%"></div>
        </div>`;
    }

    const summary = `
      <div class="flex justify-between text-body-sm text-on-surface-variant"><span>Subtotal</span><span class="font-mono text-on-surface font-semibold">${inr(subtotal)}</span></div>
      <div class="flex justify-between text-body-sm text-on-surface-variant"><span>Delivery</span><span class="font-mono font-semibold ${shipping ? "text-on-surface" : "text-tertiary"}">${shipping ? inr(shipping) : "FREE"}</span></div>
      <div class="flex justify-between text-headline-sm font-bold pt-1 border-t border-outline-variant/40"><span>Total</span><span class="text-primary font-mono">${inr(total)}</span></div>`;
    $$(".js-totals").forEach((el) => { el.innerHTML = summary; });
  }

  function addToCart(id) {
    const p = byId(id);
    if (!p || p.stock <= 0) return false;
    const line = cart.find((l) => l.id === id);
    if (line && line.qty >= p.stock) {
      toast(`Only ${p.stock} in stock`, p.name);
      return true;
    }
    if (line) line.qty += 1;
    else cart.push({ id, qty: 1 });
    renderCart();
    toast("Added to bag", p.name);
    return true;
  }

  function showView(name) {
    for (const view of ["bag", "checkout", "success"]) $(`#view-${view}`).hidden = view !== name;
  }

  function toggleDrawer(open, view = "bag") {
    if (open) showView(view);
    $("#drawer").classList.toggle("translate-x-full", !open);
    $("#drawer-scrim").hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  }

  function toggleMenu(open) {
    $("#menu").classList.toggle("-translate-x-full", !open);
    $("#menu-scrim").hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  }

  let toastTimer;
  function toast(title, subtitle = "") {
    $("#toast-title").textContent = title;
    $("#toast-sub").textContent = subtitle;
    const el = $("#toast");
    el.classList.remove("-translate-y-24", "opacity-0");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("-translate-y-24", "opacity-0"), 2600);
  }

  // ---------- Checkout ----------

  const form = $("#checkout-form");
  const cleanPhone = (value) => value.replace(/[\s()-]/g, "").replace(/^(\+?91|0)(?=[6-9]\d{9}$)/, "");

  const validators = {
    name: (v) => (v.length >= 2 ? "" : "Please enter your full name."),
    phone: (v) => (/^[6-9]\d{9}$/.test(cleanPhone(v)) ? "" : "Enter a valid 10-digit Indian mobile number."),
    email: (v) => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Enter a valid email address or leave it blank."),
    line1: (v) => (v.length >= 5 ? "" : "Please enter your house number and street."),
    city: (v) => (v.length >= 2 ? "" : "Please enter your city or town."),
    pin: (v) => (/^[1-9]\d{5}$/.test(v) ? "" : "Enter a valid 6-digit PIN code."),
    state: (v) => (v ? "" : "Please select your state.")
  };

  function readForm() {
    const data = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value).trim()]));
    let firstInvalid = null;
    for (const [name, check] of Object.entries(validators)) {
      const message = check(data[name] || "");
      form.elements[name].classList.toggle("invalid", !!message);
      $(`[data-err="${name}"]`, form).textContent = message;
      if (message && !firstInvalid) firstInvalid = form.elements[name];
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return null;
    }
    data.phone = cleanPhone(data.phone);
    return data;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorBox = $("#order-error");
    errorBox.hidden = true;
    if (form.elements.website.value) return; // honeypot
    if (!cart.length) return showView("bag");
    const customer = readForm();
    if (!customer) return;

    const button = $("#place-order");
    const label = $("span:last-child", button);
    button.disabled = true;
    label.textContent = "Placing order…";

    // The database re-checks stock and prices, saves the order and alerts the team.
    let order = null;
    let problem = "";
    try {
      order = await VB.unwrap(db.rpc("place_order", { p_items: cart, p_customer: customer }));
    } catch (error) {
      problem = /fetch|network/i.test(error.message)
        ? "Sorry, we could not send your order just now. Please check your internet connection and try again."
        : error.message;
    }
    // Refresh stock either way; a failed order usually means something just sold out.
    await loadCatalogue().then(renderAll, () => {});

    button.disabled = false;
    label.textContent = "Place order";

    if (!order) {
      errorBox.textContent = problem;
      errorBox.hidden = false;
      return;
    }

    const { website, notes, payment, ...address } = customer;
    save(KEYS.customer, address);
    $("#success-id").textContent = order.order_no;
    $("#success-text").textContent = `Thanks, ${customer.name.split(" ")[0]}! We will contact you on +91 ${customer.phone} to confirm delivery and payment.`;
    form.elements.notes.value = "";
    cart = [];
    renderCart();
    showView("success");
  });

  form.addEventListener("input", (event) => {
    const name = event.target.name;
    if (!validators[name] || !event.target.classList.contains("invalid")) return;
    const message = validators[name](event.target.value.trim());
    event.target.classList.toggle("invalid", !!message);
    $(`[data-err="${name}"]`, form).textContent = message;
  });

  // ---------- Events ----------

  const actions = {
    add: ({ id }) => addToCart(id),
    buy: ({ id }) => {
      if (!cart.some((l) => l.id === id) && !addToCart(id)) return;
      $("#quick-view").close();
      toggleDrawer(true);
    },
    view: ({ id }) => byId(id) && openQuickView(byId(id)),
    "close-view": () => $("#quick-view").close(),
    wish: ({ id }) => {
      wishlist = wishlist.includes(id) ? wishlist.filter((x) => x !== id) : [...wishlist, id];
      save(KEYS.wishlist, wishlist);
      if (state.wishOnly && !wishlist.length) state.wishOnly = false;
      renderCatalogue();
    },
    "wish-filter": () => {
      if (!state.wishOnly && !wishlist.length) return toast("Your wishlist is empty", "Tap the heart on a product to save it");
      state.wishOnly = !state.wishOnly;
      renderCatalogue();
      if (state.wishOnly) $("#catalogue").scrollIntoView();
    },
    cat: ({ cat }, el) => {
      state.cat = cat;
      renderCatalogue();
      if (el.hasAttribute("data-scroll")) $("#catalogue").scrollIntoView();
    },
    "reset-filters": () => {
      Object.assign(state, { cat: "all", q: "", inStock: false, wishOnly: false });
      $$(".js-search").forEach((input) => { input.value = ""; });
      $("#instock-toggle").checked = false;
      renderCatalogue();
    },
    qty: ({ id, delta }) => {
      const line = cart.find((l) => l.id === id);
      if (!line) return;
      line.qty = Math.min(line.qty + Number(delta), byId(id).stock);
      if (line.qty <= 0) cart = cart.filter((l) => l !== line);
      renderCart();
    },
    remove: ({ id }) => {
      cart = cart.filter((l) => l.id !== id);
      renderCart();
    },
    "open-menu": () => toggleMenu(true),
    "close-menu": () => toggleMenu(false),
    "open-cart": () => toggleDrawer(true),
    "close-cart": () => toggleDrawer(false),
    checkout: () => {
      showView("checkout");
      form.elements.name.focus();
    },
    "back-to-bag": () => showView("bag"),
    retry: () => start()
  };

  document.addEventListener("click", (event) => {
    const el = event.target.closest("[data-action]");
    // Choosing anything in the side menu closes it first, so the result is visible.
    if (event.target.closest("#menu a, #menu [data-action]:not([data-action=close-menu])")) toggleMenu(false);
    if (el) actions[el.dataset.action]?.(el.dataset, el);
    else if (event.target.id === "quick-view") event.target.close(); // click on the backdrop
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || $("#quick-view").open) return;
    toggleDrawer(false);
    toggleMenu(false);
  });

  $$(".js-search").forEach((input) => input.addEventListener("input", () => {
    state.q = input.value;
    $$(".js-search").forEach((other) => { if (other !== input) other.value = input.value; });
    renderGrid();
  }));
  $("#instock-toggle").addEventListener("change", (event) => {
    state.inStock = event.target.checked;
    renderGrid();
  });
  $("#sort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderGrid();
  });

  // ---------- Start ----------

  $("#f-state").innerHTML = `<option value="">Select state</option>` + STATES.map((s) => `<option>${s}</option>`).join("");
  for (const [name, value] of Object.entries(load(KEYS.customer, {}))) {
    if (form.elements[name] && name !== "website") form.elements[name].value = value;
  }

  $("#year").textContent = new Date().getFullYear();

  function renderAll() {
    const { fee, freeAbove } = config.shipping;
    $("#strip-shipping").textContent = fee
      ? `Free above ${inr(freeAbove)}, otherwise just ${inr(fee)}.`
      : "Free delivery on every order.";
    renderHero();
    renderCatalogue();
    renderCart();
  }

  // A few deals from other sites under the store's own products. Optional:
  // the section stays hidden when there are none or they cannot be loaded.
  const HOME_DEALS = 8;
  async function loadHomeDeals() {
    const deals = await VB.fetchDeals(db).catch(() => []);
    $("#home-deals").hidden = !deals.length;
    $("#home-deals-grid").innerHTML = deals.slice(0, HOME_DEALS).map((d) => VB.dealCard(d, "min-w-[80%] sm:min-w-0 snap-start")).join("");
    const more = $("#home-deals-more");
    more.hidden = deals.length <= HOME_DEALS;
    more.textContent = `See all ${deals.length} deals`;
  }

  async function start() {
    $("#hero").innerHTML = `<div class="py-24 text-center text-on-surface-variant"><span class="msym !text-[32px] animate-spin text-primary">progress_activity</span><p class="mt-2">Loading the store…</p></div>`;
    try {
      await loadCatalogue();
    } catch {
      $("#hero").innerHTML = `<div class="py-20 text-center"><span class="msym !text-[40px] text-outline">cloud_off</span><h1 class="text-headline-md font-semibold mt-2">The store could not be loaded</h1><p class="text-on-surface-variant mt-1">Please check your internet connection and try again.</p><button type="button" data-action="retry" class="btn btn-primary btn-sm mt-4">Try again</button></div>`;
      return;
    }
    renderAll();
    loadHomeDeals();
  }

  VB.trackDealClicks(db);
  start();
})();
