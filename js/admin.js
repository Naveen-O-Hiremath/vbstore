// Admin panel: sign-in with roles, products, categories, orders and settings.
// Every change is saved straight to the database and is live for customers.
// The database enforces who may do what; the checks here only tidy the screen.
(() => {
  const { inr, esc, unwrap } = VB;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const db = VB.connect({ staff: true });
  // Everything not listed here changes data and is skipped for read-only users.
  const VIEWER_ACTIONS = new Set(["logout", "sort", "export", "refresh"]);
  const ORDER_STATUSES = ["new", "confirmed", "shipped", "delivered", "cancelled"];

  let me = null; // the signed-in user's profile: { user_id, username, role }
  let products = [];
  let categories = [];
  let orders = [];
  let staff = [];
  let shipping = { fee: 0, freeAbove: 0 };

  let editingId = null;
  let query = "";
  let filterCat = "";
  let filterStatus = "";
  let orderQuery = "";
  let orderStatus = "";
  const sort = { key: null, dir: 1 }; // key null = the manual order used on the store
  const selected = new Set();
  const openOrders = new Set();

  const isAdmin = () => me?.role === "admin";

  // ---------- Dialogs and toast ----------

  // Optional action shows a button inside the toast, e.g. Undo.
  let toastTimer;
  function hideToast() {
    $("#toast").classList.add("translate-y-24", "opacity-0", "pointer-events-none");
  }
  function toast(message, action) {
    const el = $("#toast");
    const button = $("#toast-action");
    $("#toast-text").textContent = message;
    button.hidden = !action;
    button.textContent = action?.label ?? "";
    button.onclick = action ? () => { hideToast(); action.run(); } : null;
    el.classList.toggle("pointer-events-none", !action);
    el.classList.remove("translate-y-24", "opacity-0");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 8000 : 3500);
  }

  function confirmDialog(message, yesLabel) {
    const dialog = $("#confirm");
    $("#confirm-text").textContent = message;
    $("#confirm-yes").textContent = yesLabel;
    dialog.returnValue = "no";
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "yes"), { once: true });
    });
  }

  // Resolves with the trimmed text, or null when cancelled or left empty.
  function promptDialog(label, value = "", type = "text") {
    const dialog = $("#prompt");
    const input = $("#prompt-input");
    $("#prompt-label").textContent = label;
    input.type = type;
    input.value = value;
    dialog.returnValue = "no";
    dialog.showModal();
    input.select();
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        const text = input.value.trim();
        input.value = "";
        resolve(dialog.returnValue === "yes" && text ? text : null);
      }, { once: true });
    });
  }

  // ---------- Data ----------

  async function refresh() {
    const [catalogue, orderRows, staffRows] = await Promise.all([
      VB.fetchCatalogue(db),
      unwrap(db.from("orders").select("*").order("created_at", { ascending: false }).limit(500)),
      isAdmin() ? unwrap(db.from("profiles").select("*").order("created_at")) : []
    ]);
    if (!me) return; // signed out while the request was in flight
    ({ products, categories, shipping } = catalogue);
    orders = orderRows;
    staff = staffRows;
    render();
  }

  // Runs one change against the database, then reloads so the screen always
  // shows what was really saved. Returns false (with the reason shown) on failure.
  async function act(work, message, undo) {
    try {
      await work();
    } catch (error) {
      toast(friendly(error.message));
      await refresh().catch(() => {});
      return false;
    }
    await refresh();
    if (message) toast(message, undo && { label: "Undo", run: undo });
    return true;
  }

  const friendly = (message) => (
    /fetch|network/i.test(message) ? "Could not reach the server. Check your internet connection." :
    /row-level security|permission denied/i.test(message) ? "You do not have permission to do that." :
    /products_category_fkey/.test(message) ? "Move or delete the products in this category first." :
    /duplicate key/.test(message) ? "That name already exists." :
    message
  );

  // ---------- Sign-in ----------

  async function startSession() {
    const { data: { session } } = await db.auth.getSession();
    me = null;
    if (session) {
      me = await unwrap(db.from("profiles").select("*").eq("user_id", session.user.id).maybeSingle()).catch(() => null);
      if (!me) await db.auth.signOut();
    }
    $("#login").hidden = !!me;
    $("#app").hidden = !me;
    if (!me) {
      // Leave nothing from the previous user on the page.
      products = categories = orders = staff = [];
      delete document.body.dataset.role;
      $("#l-user").focus();
      return;
    }
    render();
    document.body.dataset.role = me.role;
    $("#role-chip").textContent = isAdmin() ? "Admin" : "Read-only";
    $("#who").textContent = `Signed in as ${me.username}`;
    $("#readonly-note").hidden = isAdmin();
    showTab("products");
    try {
      await refresh();
      if (isAdmin()) await fillSettings();
    } catch (error) {
      toast(friendly(error.message));
    }
  }

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const errorBox = $("#login-error");
    const button = $("button[type=submit]", form);
    errorBox.hidden = true;
    button.disabled = true;
    const { error } = await db.auth.signInWithPassword({
      email: VB.staffEmail(form.elements.username.value),
      password: form.elements.password.value
    });
    button.disabled = false;
    if (error) {
      errorBox.textContent = /invalid login/i.test(error.message) ? "Incorrect username or password." : friendly(error.message);
      errorBox.hidden = false;
      return;
    }
    form.reset();
    await startSession();
    if (!me) {
      errorBox.textContent = "This account has no access to the admin panel.";
      errorBox.hidden = false;
    }
  });

  function showTab(name) {
    if (name === "settings" && !isAdmin()) name = "products";
    for (const tab of ["products", "categories", "orders", "settings"]) $(`#tab-${tab}`).hidden = tab !== name;
    $$(".tab").forEach((button) => {
      const active = button.dataset.tab === name;
      button.classList.toggle("bg-surface-container-highest", active);
      button.classList.toggle("text-on-surface", active);
      button.classList.toggle("text-outline", !active);
    });
  }

  function render() {
    renderProducts();
    renderCategories();
    renderOrders();
    renderUsers();
  }

  // ---------- Products ----------

  const productById = (id) => products.find((p) => p.id === id);
  const nextPosition = (list) => Math.max(0, ...list.map((item) => item.position)) + 1;
  const updateProduct = (id, values) => unwrap(db.from("products").update(values).eq("id", id));

  const statusOf = (p) => (p.hidden ? "hidden" : p.stock <= 0 ? "out" : p.stock <= 5 ? "low" : "in");
  const matchesStatus = (p) => !filterStatus || statusOf(p) === filterStatus || (filterStatus === "in" && !p.hidden && p.stock > 0);

  function visibleRows() {
    const q = query.trim().toLowerCase();
    const list = products.filter((p) => (
      (!q || `${p.name} ${p.category} ${p.series} ${p.badge}`.toLowerCase().includes(q)) &&
      (!filterCat || p.category === filterCat) &&
      matchesStatus(p)
    ));
    if (!sort.key) return list;
    const text = sort.key === "name" || sort.key === "category";
    return list.sort((a, b) => sort.dir * (text ? a[sort.key].localeCompare(b[sort.key]) : a[sort.key] - b[sort.key]));
  }

  function renderProducts() {
    const admin = isAdmin();
    const live = products.filter((p) => !p.hidden);
    const low = live.filter((p) => p.stock > 0 && p.stock <= 5).length;
    const out = live.filter((p) => p.stock <= 0).length;
    const stat = (label, value, tone = "") => `<div class="bg-surface-container-lowest p-4"><p class="text-label-sm uppercase text-outline">${label}</p><p class="text-headline-md font-semibold font-mono ${tone}">${value}</p></div>`;
    $("#stats").innerHTML =
      stat("Products", products.length) +
      stat("In stock", live.filter((p) => p.stock > 0).length, "text-tertiary") +
      stat("Low stock", low, low ? "text-secondary" : "") +
      stat("Sold out", out, out ? "text-error" : "") +
      stat("Hidden", products.length - live.length) +
      stat("Stock value", inr(products.reduce((sum, p) => sum + p.price * p.stock, 0)));

    if (filterCat && !categories.includes(filterCat)) filterCat = "";
    $("#p-cat").innerHTML = `<option value="">All categories</option>` +
      categories.map((c) => `<option value="${esc(c)}" ${c === filterCat ? "selected" : ""}>${esc(c)}</option>`).join("");

    $$("[data-action=sort]").forEach((button) => {
      const active = sort.key === button.dataset.key;
      button.classList.toggle("text-primary", active);
      $(".msym", button).textContent = active ? (sort.dir > 0 ? "arrow_upward" : "arrow_downward") : "unfold_more";
    });

    for (const id of [...selected]) if (!productById(id)) selected.delete(id);
    const list = visibleRows();
    // Moving rows only makes sense while the table shows the store's own order.
    const canMove = !sort.key && list.length === products.length;
    const moveTitle = (label) => (canMove ? label : "Clear sorting and filters to reorder");
    const iconButton = (action, id, icon, title, extra = "") => `<button type="button" data-action="${action}" data-id="${esc(id)}" title="${title}" aria-label="${title}" ${extra} class="p-1.5 rounded-md text-on-surface-variant hover:text-primary hover:bg-surface-container-high disabled:opacity-25 disabled:pointer-events-none"><span class="msym">${icon}</span></button>`;
    const stockTone = (p) => (p.stock <= 0 ? "text-error" : p.stock <= 5 ? "text-secondary" : "text-tertiary");

    $("#p-empty").hidden = !!list.length;
    $("#p-rows").innerHTML = list.map((p, i) => `
      <tr class="border-b border-outline-variant/20 last:border-0 hover:bg-surface-container-low ${selected.has(p.id) ? "bg-surface-container-low" : ""}">
        <td class="admin-only p-3"><input type="checkbox" class="js-select h-4 w-4 accent-primary" value="${esc(p.id)}" ${selected.has(p.id) ? "checked" : ""} aria-label="Select ${esc(p.name)}"/></td>
        <td class="p-3">
          <div class="flex items-center gap-3 ${p.hidden ? "opacity-50" : ""}">
            <div class="w-12 h-12 shrink-0 rounded-lg bg-surface-container flex items-center justify-center overflow-hidden">
              ${p.image ? `<img src="${esc(p.image)}" alt="" class="w-full h-full object-contain" onerror="this.style.visibility='hidden'"/>` : `<span class="msym text-outline">image</span>`}
            </div>
            <div class="min-w-0">
              <p class="text-label-lg truncate max-w-[220px]">${esc(p.name)}</p>
              <p class="text-label-md text-outline truncate max-w-[220px]">${p.hidden ? "Hidden from store" : esc(p.badge || p.series || "")}</p>
            </div>
          </div>
        </td>
        <td class="p-3 text-on-surface-variant">${esc(p.category)}</td>
        <td class="p-3 text-right">${admin
          ? `<input type="number" min="1" step="1" value="${p.price}" data-id="${esc(p.id)}" data-field="price" aria-label="Price of ${esc(p.name)}" class="js-inline field !w-24 !py-1 text-right font-mono !text-primary font-semibold"/>`
          : `<span class="font-mono text-primary font-semibold">${inr(p.price)}</span>`}</td>
        <td class="p-3 text-right font-mono text-outline">${p.mrp > p.price ? `${inr(p.mrp)}<span class="block text-label-sm text-tertiary">${Math.round((1 - p.price / p.mrp) * 100)}% off</span>` : "—"}</td>
        <td class="p-3 text-right">${admin
          ? `<input type="number" min="0" step="1" value="${p.stock}" data-id="${esc(p.id)}" data-field="stock" aria-label="Stock of ${esc(p.name)}" class="js-inline field !w-20 !py-1 text-right font-mono !${stockTone(p)}"/>`
          : `<span class="font-mono ${stockTone(p)}">${p.stock <= 0 ? "Sold out" : p.stock}</span>`}</td>
        <td class="p-3 text-center">
          <button type="button" data-action="toggle-hidden" data-id="${esc(p.id)}" ${admin ? "" : "disabled"} title="${p.hidden ? "Hidden from the store" : "Visible on the store"}" class="${p.hidden ? "text-outline" : "text-tertiary"}"><span class="msym">${p.hidden ? "visibility_off" : "visibility"}</span></button>
        </td>
        <td class="p-3 text-center">
          <button type="button" data-action="feature" data-id="${esc(p.id)}" ${admin ? "" : "disabled"} title="Featured in the store banner" class="${p.featured ? "text-primary" : "text-outline"}"><span class="msym ${p.featured ? "fill" : ""}">star</span></button>
        </td>
        <td class="admin-only p-3">
          <div class="flex justify-end">
            ${iconButton("move", p.id, "arrow_upward", moveTitle("Move up"), `data-delta="-1" ${canMove && i > 0 ? "" : "disabled"}`)}
            ${iconButton("move", p.id, "arrow_downward", moveTitle("Move down"), `data-delta="1" ${canMove && i < list.length - 1 ? "" : "disabled"}`)}
            ${iconButton("duplicate", p.id, "content_copy", "Duplicate")}
            ${iconButton("edit", p.id, "edit", "Edit")}
            ${iconButton("delete", p.id, "delete", "Delete")}
          </div>
        </td>
      </tr>`).join("");

    $("#bulk-bar").hidden = !selected.size;
    $("#bulk-count").textContent = `${selected.size} selected`;
    $("#select-all").checked = list.length > 0 && list.every((p) => selected.has(p.id));
  }

  // Price and stock can be typed straight into the table.
  $("#p-rows").addEventListener("change", (event) => {
    if (!isAdmin()) return;
    const input = event.target;
    if (input.classList.contains("js-select")) {
      if (input.checked) selected.add(input.value);
      else selected.delete(input.value);
      return renderProducts();
    }
    if (!input.classList.contains("js-inline")) return;
    const product = productById(input.dataset.id);
    const field = input.dataset.field;
    const value = Number(input.value);
    const valid = input.value !== "" && Number.isInteger(value) && (field === "price" ? value > 0 : value >= 0);
    if (!valid) {
      toast(field === "price" ? "Price must be a whole number above 0." : "Stock must be a whole number, 0 or more.");
      return renderProducts();
    }
    if (value === product[field]) return;
    // A price above the MRP lifts the MRP with it, so no false discount shows.
    const values = field === "price" ? { price: value, mrp: Math.max(product.mrp, value) } : { stock: value };
    act(() => updateProduct(product.id, values), `${product.name}: ${field} updated`);
  });

  $("#select-all").addEventListener("change", (event) => {
    for (const p of visibleRows()) {
      if (event.target.checked) selected.add(p.id);
      else selected.delete(p.id);
    }
    renderProducts();
  });

  // Deleting can be undone by putting the same rows back.
  function deleteProducts(ids, label) {
    const removed = products.filter((p) => ids.includes(p.id));
    return act(
      () => unwrap(db.from("products").delete().in("id", ids)),
      `${label} deleted`,
      () => act(() => unwrap(db.from("products").insert(removed.map(VB.toRow))), "Restored")
    );
  }

  async function bulk(op) {
    const ids = [...selected];
    const label = `${ids.length} product${ids.length === 1 ? "" : "s"}`;
    const update = (values) => unwrap(db.from("products").update(values).in("id", ids));
    if (op === "delete") {
      if (!(await confirmDialog(`Delete ${label}?`, "Delete"))) return;
      await deleteProducts(ids, label);
    } else if (op === "hide" || op === "show") {
      await act(() => update({ hidden: op === "hide" }), `${label} ${op === "hide" ? "hidden" : "shown"}`);
    } else if (op === "soldout") {
      await act(() => update({ stock: 0 }), `${label} marked sold out`);
    }
    selected.clear();
    renderProducts();
  }

  // ---------- Product editor ----------

  const productForm = $("#product-form");
  const NEW_CATEGORY = "__new__";

  function fillCategorySelect(value) {
    productForm.elements.category.innerHTML =
      `<option value="">Select category</option>` +
      categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("") +
      `<option value="${NEW_CATEGORY}">+ New category…</option>`;
    productForm.elements.category.value = value;
  }

  let lastCategory = "";
  productForm.elements.category.addEventListener("change", async (event) => {
    if (event.target.value !== NEW_CATEGORY) {
      lastCategory = event.target.value;
      return;
    }
    const name = await promptDialog("New category name");
    if (name && await addCategory(name)) lastCategory = name;
    fillCategorySelect(lastCategory);
  });

  function renderPreview() {
    const src = productForm.elements.image.value.trim();
    $("#e-preview").innerHTML = src
      ? `<img src="${esc(src)}" alt="" class="w-full h-full object-contain" onerror="this.style.visibility='hidden'"/>`
      : `<span class="msym text-outline">image</span>`;
  }

  function openEditor(product) {
    editingId = product?.id ?? null;
    $("#editor-title").textContent = product ? "Edit product" : "Add product";
    $("#editor-error").textContent = "";
    productForm.reset();
    lastCategory = product?.category ?? filterCat;
    fillCategorySelect(lastCategory);
    if (product) {
      for (const key of ["name", "series", "price", "stock", "badge", "spec", "desc", "image"]) {
        productForm.elements[key].value = product[key] ?? "";
      }
      productForm.elements.mrp.value = product.mrp > product.price ? product.mrp : "";
      productForm.elements.featured.checked = product.featured;
      productForm.elements.hidden.checked = product.hidden;
    }
    renderPreview();
    $("#editor").showModal();
  }

  // Shrinks a photo in the browser, then stores it in the "products" bucket.
  async function uploadPhoto(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    const path = `${crypto.randomUUID()}.webp`;
    await unwrap(db.storage.from("products").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" }));
    return db.storage.from("products").getPublicUrl(path).data.publicUrl;
  }

  $("#e-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file || !isAdmin()) return;
    $("#editor-error").textContent = "Uploading photo…";
    try {
      productForm.elements.image.value = await uploadPhoto(file);
      $("#editor-error").textContent = "";
      renderPreview();
    } catch (error) {
      $("#editor-error").textContent = `The photo could not be uploaded: ${friendly(error.message)}`;
    }
  });
  productForm.elements.image.addEventListener("input", renderPreview);

  const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product";
  function uniqueId(name) {
    const base = slug(name);
    let id = base;
    for (let n = 2; productById(id); n++) id = `${base}-${n}`;
    return id;
  }

  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAdmin()) return;
    const data = Object.fromEntries([...new FormData(productForm)].map(([k, v]) => [k, String(v).trim()]));
    const price = Number(data.price);
    const mrp = Number(data.mrp) || price;
    const stock = Number(data.stock);

    const problem =
      !data.name ? "Product name is required." :
      !data.category || data.category === NEW_CATEGORY ? "Please choose a category." :
      !(price > 0) ? "Enter a selling price greater than 0." :
      mrp < price ? "MRP cannot be lower than the selling price." :
      data.stock === "" || !Number.isInteger(stock) || stock < 0 ? "Enter the stock quantity (0 or more)." : "";
    $("#editor-error").textContent = problem;
    if (problem) return;

    const values = VB.toRow({
      name: data.name,
      category: data.category,
      series: data.series,
      price: Math.round(price),
      mrp: Math.round(mrp),
      desc: data.desc,
      image: data.image,
      badge: data.badge,
      spec: data.spec,
      stock,
      featured: productForm.elements.featured.checked,
      hidden: productForm.elements.hidden.checked
    });
    const saved = editingId
      ? await act(() => updateProduct(editingId, values), "Product updated")
      : await act(() => unwrap(db.from("products").insert({ ...values, id: uniqueId(data.name), position: nextPosition(products) })), "Product added");
    if (saved) $("#editor").close();
  });

  // ---------- Categories ----------

  const productCount = (category) => products.filter((p) => p.category === category).length;
  const findCategory = (name) => categories.find((c) => c.toLowerCase() === name.toLowerCase());

  async function addCategory(name) {
    if (findCategory(name)) {
      toast(`"${findCategory(name)}" already exists.`);
      return false;
    }
    // New categories go last; reordering renumbers the whole list.
    return act(() => unwrap(db.from("categories").insert({ name, position: categories.length + 1 })), `Category "${name}" added`);
  }

  function renderCategories() {
    const iconButton = (action, name, icon, title, extra = "") => `<button type="button" data-action="${action}" data-name="${esc(name)}" title="${title}" aria-label="${title}" ${extra} class="admin-only p-1.5 rounded-md text-on-surface-variant hover:text-primary hover:bg-surface-container-high disabled:opacity-25 disabled:pointer-events-none"><span class="msym">${icon}</span></button>`;
    $("#c-rows").innerHTML = categories.length ? categories.map((name, i) => {
      const count = productCount(name);
      return `
      <div class="flex items-center gap-3 px-4 py-3">
        <span class="font-mono text-label-md text-outline w-5">${i + 1}</span>
        <div class="min-w-0 flex-1">
          <p class="text-label-lg truncate">${esc(name)}</p>
          <p class="text-label-md text-outline">${count} product${count === 1 ? "" : "s"}</p>
        </div>
        ${iconButton("cat-move", name, "arrow_upward", "Move up", `data-delta="-1" ${i > 0 ? "" : "disabled"}`)}
        ${iconButton("cat-move", name, "arrow_downward", "Move down", `data-delta="1" ${i < categories.length - 1 ? "" : "disabled"}`)}
        ${iconButton("cat-rename", name, "edit", "Rename")}
        ${iconButton("cat-delete", name, "delete", count ? "Move or delete its products first" : "Delete", count ? "disabled" : "")}
      </div>`;
    }).join("") : `<p class="p-8 text-center text-on-surface-variant">No categories yet.${isAdmin() ? " Add your first one above." : ""}</p>`;
  }

  $("#category-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAdmin()) return;
    const name = event.target.elements.name.value.trim();
    if (name && await addCategory(name)) event.target.reset();
  });

  async function renameCategory(oldName) {
    const name = await promptDialog(`Rename "${oldName}"`, oldName);
    if (!name || name === oldName) return;
    const clash = findCategory(name);
    if (clash && clash !== oldName) return toast(`"${clash}" already exists.`);
    // The database moves this category's products to the new name as well.
    act(() => unwrap(db.from("categories").update({ name }).eq("name", oldName)), `Renamed to "${name}"`);
  }

  // Saves the whole category order as positions 1..n.
  const saveCategoryOrder = (names) => Promise.all(
    names.map((name, i) => unwrap(db.from("categories").update({ position: i + 1 }).eq("name", name)))
  );

  // ---------- Orders ----------

  const orderDate = (iso) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  const STATUS_TONE = {
    new: "bg-primary/15 text-primary border-primary/40",
    confirmed: "bg-secondary/15 text-secondary border-secondary/40",
    shipped: "bg-secondary/15 text-secondary border-secondary/40",
    delivered: "bg-tertiary/15 text-tertiary border-tertiary/40",
    cancelled: "bg-error/10 text-error border-error/40"
  };

  function renderOrders() {
    const admin = isAdmin();
    const count = (status) => orders.filter((o) => o.status === status).length;
    const stat = (label, value, tone = "") => `<div class="bg-surface-container-lowest p-4"><p class="text-label-sm uppercase text-outline">${label}</p><p class="text-headline-md font-semibold font-mono ${tone}">${value}</p></div>`;
    $("#o-stats").innerHTML =
      stat("New", count("new"), count("new") ? "text-primary" : "") +
      stat("In progress", count("confirmed") + count("shipped")) +
      stat("Delivered", count("delivered"), "text-tertiary") +
      stat("Cancelled", count("cancelled")) +
      stat("Sales", inr(orders.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + o.total, 0)));
    $("#orders-badge").hidden = !count("new");
    $("#orders-badge").textContent = count("new");

    const q = orderQuery.trim().toLowerCase();
    const list = orders.filter((o) => (
      (!orderStatus || o.status === orderStatus) &&
      (!q || `${o.order_no} ${o.customer_name} ${o.phone} ${o.pin} ${o.city}`.toLowerCase().includes(q))
    ));
    $("#o-empty").hidden = !!list.length;
    $("#o-rows").innerHTML = list.map((o) => `
      <details data-order="${o.id}" ${openOrders.has(o.id) ? "open" : ""} class="group border border-outline-variant/40 rounded-xl bg-surface-container-lowest">
        <summary class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 cursor-pointer list-none">
          <span class="msym text-outline group-open:rotate-90 transition-transform">chevron_right</span>
          <span class="font-mono text-label-lg">${esc(o.order_no)}</span>
          <span class="text-body-sm text-on-surface-variant">${orderDate(o.created_at)}</span>
          <span class="text-body-sm truncate max-w-[200px]">${esc(o.customer_name)}, ${esc(o.city)}</span>
          <span class="ml-auto font-mono text-label-lg text-primary">${inr(o.total)}</span>
          ${admin && o.status !== "cancelled"
            ? `<select class="js-order-status field !w-auto !py-1 !text-[12px]" data-id="${o.id}" aria-label="Status of ${esc(o.order_no)}">${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select>`
            : `<span class="px-2 py-0.5 rounded-full border text-label-sm uppercase ${STATUS_TONE[o.status]}">${o.status}</span>`}
        </summary>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 pb-4 pt-1 border-t border-outline-variant/20 text-body-sm">
          <div>
            <p class="label mt-3">Items</p>
            ${o.items.map((item) => `<div class="flex justify-between gap-3"><span>${esc(item.name)} × ${item.qty}</span><span class="font-mono">${inr(item.price * item.qty)}</span></div>`).join("")}
            <div class="flex justify-between gap-3 text-on-surface-variant mt-2 pt-2 border-t border-outline-variant/20"><span>Delivery</span><span class="font-mono">${o.shipping ? inr(o.shipping) : "FREE"}</span></div>
            <div class="flex justify-between gap-3 font-semibold"><span>Total · ${esc(o.payment)}</span><span class="font-mono text-primary">${inr(o.total)}</span></div>
          </div>
          <div>
            <p class="label mt-3">Customer</p>
            <p>${esc(o.customer_name)} · <a class="text-primary underline" href="tel:+91${esc(o.phone)}">+91 ${esc(o.phone)}</a></p>
            ${o.email ? `<p class="text-on-surface-variant">${esc(o.email)}</p>` : ""}
            <p class="label mt-3">Deliver to</p>
            <p>${esc(o.line1)}${o.line2 ? `<br/>${esc(o.line2)}` : ""}<br/>${esc(o.city)}, ${esc(o.state)} – ${esc(o.pin)}</p>
            ${o.notes ? `<p class="label mt-3">Notes</p><p>${esc(o.notes)}</p>` : ""}
          </div>
        </div>
      </details>`).join("");
  }

  // Remember which orders are expanded so a refresh does not collapse them.
  $("#o-rows").addEventListener("toggle", (event) => {
    const id = Number(event.target.dataset.order);
    if (event.target.open) openOrders.add(id);
    else openOrders.delete(id);
  }, true);

  $("#o-rows").addEventListener("change", async (event) => {
    const select = event.target;
    if (!select.classList.contains("js-order-status") || !isAdmin()) return;
    const order = orders.find((o) => o.id === Number(select.dataset.id));
    const status = select.value;
    if (status === "cancelled" && !(await confirmDialog(`Cancel order ${order.order_no}? Its items go back into stock and it cannot be reopened.`, "Cancel order"))) {
      return renderOrders();
    }
    act(() => unwrap(db.rpc("set_order_status", { p_id: order.id, p_status: status })), `${order.order_no} marked ${status}`);
  });

  // ---------- Settings: Telegram and delivery ----------

  const settingsForm = $("#settings-form");
  const tgResult = $("#tg-result");
  settingsForm.addEventListener("submit", (event) => event.preventDefault());
  const parseChatIds = (text) => [...new Set(text.split(/[\s,]+/).filter(Boolean))];
  const telegramFromForm = () => ({
    botToken: settingsForm.elements.botToken.value.trim(),
    chatIds: parseChatIds(settingsForm.elements.chatIds.value)
  });

  async function fillSettings() {
    const telegram = await unwrap(db.rpc("get_telegram_settings"));
    settingsForm.elements.botToken.value = telegram.botToken;
    settingsForm.elements.chatIds.value = telegram.chatIds.join(", ");
    settingsForm.elements.fee.value = shipping.fee;
    settingsForm.elements.freeAbove.value = shipping.freeAbove;
  }

  function saveTelegram() {
    const { botToken, chatIds } = telegramFromForm();
    return act(() => unwrap(db.rpc("set_telegram_settings", { p_bot_token: botToken, p_chat_ids: chatIds })), "Telegram settings saved");
  }

  function saveShipping() {
    const whole = (input) => Math.max(0, Math.round(Number(input.value) || 0));
    const values = { shipping_fee: whole(settingsForm.elements.fee), free_above: whole(settingsForm.elements.freeAbove) };
    return act(() => unwrap(db.from("settings").update(values).eq("id", true)), "Delivery charges saved");
  }

  async function findChats() {
    const { botToken } = telegramFromForm();
    if (!botToken) return void (tgResult.innerHTML = `<p class="text-error">Paste the bot token first.</p>`);
    tgResult.innerHTML = `<p class="text-on-surface-variant">Looking for people who started the bot…</p>`;
    try {
      const updates = await VB.telegramCall(botToken, "getUpdates", {});
      const chats = new Map();
      for (const update of updates) {
        const chat = (update.message || update.my_chat_member || update.channel_post)?.chat;
        if (chat) chats.set(String(chat.id), chat);
      }
      if (!chats.size) {
        tgResult.innerHTML = `<p class="text-secondary">No one new found. Open the bot in Telegram on the phone, press Start (or send any message), then try again.</p>`;
        return;
      }
      const chosen = new Set(telegramFromForm().chatIds);
      tgResult.innerHTML = [...chats.values()].map((chat) => {
        const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "Unknown";
        return `<label class="flex items-center gap-2 p-2 rounded-lg border border-outline-variant/50 bg-surface-container-low cursor-pointer">
          <input type="checkbox" class="js-chat accent-primary" value="${esc(chat.id)}" ${chosen.has(String(chat.id)) ? "checked" : ""}/>
          <span class="font-medium">${esc(name)}</span>
          ${chat.username ? `<span class="text-outline">@${esc(chat.username)}</span>` : ""}
          <span class="ml-auto font-mono text-outline">${esc(chat.id)}</span>
        </label>`;
      }).join("");
    } catch (error) {
      tgResult.innerHTML = `<p class="text-error">Telegram said: ${esc(error.message)}. Check the token.</p>`;
    }
  }

  tgResult.addEventListener("change", (event) => {
    if (!event.target.classList.contains("js-chat")) return;
    const ids = new Set(telegramFromForm().chatIds);
    if (event.target.checked) ids.add(event.target.value);
    else ids.delete(event.target.value);
    settingsForm.elements.chatIds.value = [...ids].join(", ");
  });

  async function testTelegram() {
    const { botToken, chatIds } = telegramFromForm();
    if (!botToken || !chatIds.length) return void (tgResult.innerHTML = `<p class="text-error">Enter the bot token and at least one chat ID first.</p>`);
    tgResult.innerHTML = `<p class="text-on-surface-variant">Sending…</p>`;
    const results = await Promise.all(chatIds.map((chatId) => VB.telegramCall(botToken, "sendMessage", {
      chat_id: chatId,
      text: "✅ <b>VB Store</b> test message. Order alerts will arrive in this chat.",
      parse_mode: "HTML"
    }).then(() => `<p class="text-tertiary">Delivered to ${esc(chatId)}</p>`, (error) => `<p class="text-error">Failed for ${esc(chatId)}: ${esc(error.message)}</p>`)));
    tgResult.innerHTML = results.join("");
  }

  // ---------- Settings: users ----------

  function renderUsers() {
    $("#u-rows").innerHTML = staff.map((user) => `
      <div class="flex items-center gap-2 px-3 py-2">
        <span class="msym text-outline">${user.role === "admin" ? "shield_person" : "visibility"}</span>
        <span class="text-label-lg truncate flex-1">${esc(user.username)}${user.user_id === me.user_id ? ` <span class="text-label-md text-outline">(you)</span>` : ""}</span>
        <select class="js-user-role field !w-auto !py-1 !text-[12px]" data-id="${user.user_id}" aria-label="Access for ${esc(user.username)}">
          <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
          <option value="viewer" ${user.role === "viewer" ? "selected" : ""}>Read-only</option>
        </select>
        <button type="button" data-action="user-password" data-id="${user.user_id}" title="Set a new password" aria-label="Set a new password for ${esc(user.username)}" class="p-1.5 rounded-md text-on-surface-variant hover:text-primary hover:bg-surface-container-high"><span class="msym">key</span></button>
        <button type="button" data-action="user-remove" data-id="${user.user_id}" ${user.user_id === me.user_id ? "disabled" : ""} title="Remove user" aria-label="Remove ${esc(user.username)}" class="p-1.5 rounded-md text-on-surface-variant hover:text-error hover:bg-surface-container-high disabled:opacity-25 disabled:pointer-events-none"><span class="msym">person_remove</span></button>
      </div>`).join("");
  }

  const staffById = (id) => staff.find((user) => user.user_id === id);

  $("#u-rows").addEventListener("change", async (event) => {
    const select = event.target;
    if (!select.classList.contains("js-user-role")) return;
    const user = staffById(select.dataset.id);
    await act(() => unwrap(db.rpc("staff_set_role", { p_user_id: user.user_id, p_role: select.value })), `${user.username} is now ${select.value === "admin" ? "an admin" : "read-only"}`);
    if (user.user_id === me.user_id) startSession(); // my own access may have changed
  });

  async function addUser() {
    const username = $("#u-name").value.trim();
    const added = await act(
      () => unwrap(db.rpc("staff_create", { p_username: username, p_password: $("#u-pass").value, p_role: $("#u-role").value })),
      `${username.toLowerCase()} can now sign in`
    );
    if (added) {
      $("#u-name").value = "";
      $("#u-pass").value = "";
    }
  }

  async function setUserPassword(id) {
    const user = staffById(id);
    const password = await promptDialog(`New password for ${user.username} (8+ characters)`, "", "password");
    if (password) act(() => unwrap(db.rpc("staff_set_password", { p_user_id: id, p_password: password })), `Password changed for ${user.username}`);
  }

  async function removeUser(id) {
    const user = staffById(id);
    if (await confirmDialog(`Remove ${user.username}? They will no longer be able to sign in.`, "Remove")) {
      act(() => unwrap(db.rpc("staff_delete", { p_user_id: id })), `${user.username} removed`);
    }
  }

  // ---------- Events ----------

  const actions = {
    logout: async () => {
      await db.auth.signOut();
      startSession();
    },
    refresh: () => act(() => {}, "Up to date"),
    sort: ({ key }) => {
      // Each click cycles: ascending, descending, back to store order.
      if (sort.key !== key) Object.assign(sort, { key, dir: 1 });
      else if (sort.dir === 1) sort.dir = -1;
      else sort.key = null;
      renderProducts();
    },
    export: () => {
      const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      VB.download(`vbstore-catalogue-${stamp}.json`, JSON.stringify({ categories, products }, null, 2));
    },

    new: () => openEditor(null),
    edit: ({ id }) => openEditor(productById(id)),
    "close-editor": () => $("#editor").close(),
    "close-prompt": () => $("#prompt").close("no"),
    feature: ({ id }) => act(() => updateProduct(id, { featured: !productById(id).featured })),
    "toggle-hidden": ({ id }) => act(() => updateProduct(id, { hidden: !productById(id).hidden })),
    duplicate: ({ id }) => {
      const { id: _, created_at, ...source } = VB.toRow(productById(id));
      const name = `${source.name} (copy)`;
      // Copies start hidden so the store never shows two of the same product.
      const copy = { ...source, id: uniqueId(name), name, featured: false, hidden: true, position: nextPosition(products) };
      act(() => unwrap(db.from("products").insert(copy)), "Duplicated as a hidden copy at the end of the list");
    },
    move: ({ id, delta }) => {
      const from = products.findIndex((p) => p.id === id);
      const to = from + Number(delta);
      if (to < 0 || to >= products.length) return;
      const [a, b] = [products[from], products[to]];
      act(() => Promise.all([updateProduct(a.id, { position: b.position }), updateProduct(b.id, { position: a.position })]));
    },
    delete: ({ id }) => deleteProducts([id], `"${productById(id).name}"`),
    bulk: ({ op }) => {
      if (op !== "clear") return bulk(op);
      selected.clear();
      renderProducts();
    },

    "cat-rename": ({ name }) => renameCategory(name),
    "cat-delete": ({ name }) => {
      if (productCount(name)) return;
      act(() => unwrap(db.from("categories").delete().eq("name", name)), `Category "${name}" deleted`);
    },
    "cat-move": ({ name, delta }) => {
      const from = categories.indexOf(name);
      const to = from + Number(delta);
      if (to < 0 || to >= categories.length) return;
      const order = [...categories];
      [order[from], order[to]] = [order[to], order[from]];
      act(() => saveCategoryOrder(order));
    },

    "add-user": addUser,
    "user-password": ({ id }) => setUserPassword(id),
    "user-remove": ({ id }) => removeUser(id),
    "save-telegram": saveTelegram,
    "save-shipping": saveShipping,
    "find-chats": findChats,
    "test-telegram": testTelegram
  };

  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (tab) return showTab(tab.dataset.tab);
    const el = event.target.closest("[data-action]");
    if (!el || !actions[el.dataset.action]) return;
    if (!isAdmin() && !VIEWER_ACTIONS.has(el.dataset.action)) return;
    actions[el.dataset.action](el.dataset);
  });

  const bind = (selector, eventName, apply, rerender) => $(selector).addEventListener(eventName, (event) => {
    apply(event.target.value);
    rerender();
  });
  bind("#p-search", "input", (v) => { query = v; }, renderProducts);
  bind("#p-cat", "change", (v) => { filterCat = v; }, renderProducts);
  bind("#p-status", "change", (v) => { filterStatus = v; }, renderProducts);
  bind("#o-search", "input", (v) => { orderQuery = v; }, renderOrders);
  bind("#o-status", "change", (v) => { orderStatus = v; }, renderOrders);

  startSession();
})();
