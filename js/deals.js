// Deals page: products listed from other shopping sites. Every link opens the
// original site in a new tab and the click is counted for the admin dashboard.
(() => {
  const { inr, esc, unwrap } = VB;
  const db = VB.connect();
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let deals = [];
  const state = { q: "", site: "all", sort: "featured" };

  const drop = (d) => d.old_price - d.price;
  const percentOff = (d) => Math.round((drop(d) / d.old_price) * 100);
  // Links come from the database; only ever render web addresses as links.
  const safeUrl = (url) => (/^https?:\/\//i.test(url) ? url : "#");

  function visibleDeals() {
    const q = state.q.trim().toLowerCase();
    const list = deals.filter((d) => (
      (state.site === "all" || d.source === state.site) &&
      (!q || `${d.title} ${d.source} ${d.description}`.toLowerCase().includes(q))
    ));
    const sorters = {
      drop: (a, b) => drop(b) - drop(a),
      percent: (a, b) => percentOff(b) - percentOff(a),
      low: (a, b) => a.price - b.price
    };
    return sorters[state.sort] ? list.sort(sorters[state.sort]) : list;
  }

  function renderPills() {
    const sites = [...new Set(deals.map((d) => d.source))];
    const pill = (value, label) => `
      <button type="button" data-site="${esc(value)}" class="shrink-0 px-4 py-1.5 rounded-lg text-label-md transition-all ${state.site === value ? "bg-primary text-on-primary font-semibold" : "bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface"}">${esc(label)}</button>`;
    $("#site-pills").innerHTML = pill("all", `All deals (${deals.length})`) + sites.map((site) => pill(site, site)).join("");
  }

  function message(icon, title, text, button = "") {
    $("#state").hidden = false;
    $("#grid").hidden = true;
    $("#state").innerHTML = `<span class="msym !text-[40px] text-outline ${icon === "progress_activity" ? "animate-spin !text-primary" : ""}">${icon}</span>
      <p class="text-headline-sm mt-2">${title}</p>
      <p class="text-body-sm text-on-surface-variant mt-1">${text}</p>${button}`;
  }

  function renderGrid() {
    const list = visibleDeals();
    if (!deals.length) return message("local_offer", "No deals right now", "New offers are added often. Please check back soon.");
    if (!list.length) return message("search_off", "No deals match", "Try a different search or site.", `<button type="button" data-reset class="btn btn-secondary btn-sm mt-4">Clear filters</button>`);
    $("#state").hidden = true;
    $("#grid").hidden = false;
    // rel="sponsored nofollow" tells search engines these are outbound shopping links.
    const link = (d, classes, inner, label = "") => `<a href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener sponsored nofollow" data-deal="${d.id}" ${label ? `aria-label="${esc(label)}"` : ""} class="${classes}">${inner}</a>`;
    $("#grid").innerHTML = list.map((d) => `
      <article class="group relative bg-surface-container-lowest p-5 flex flex-col justify-between hover:bg-surface-container-low transition-colors duration-200">
        <div>
          <div class="flex items-center justify-between gap-2 pb-2">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-label-sm uppercase"><span class="msym !text-[14px]">storefront</span>${esc(d.source)}</span>
            ${drop(d) ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary/10 border border-tertiary/30 text-tertiary text-label-sm"><span class="msym !text-[14px]">trending_down</span>${inr(drop(d))} OFF</span>` : ""}
          </div>
          ${link(d, "relative w-full aspect-[4/3] flex items-center justify-center overflow-hidden my-2 bg-surface-container/20 rounded-xl", d.image
            ? `<img src="${esc(d.image)}" alt="${esc(d.title)}" loading="lazy" class="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-500" onerror="this.style.visibility='hidden'"/>`
            : `<span class="msym !text-[40px] text-outline">image</span>`, `${d.title} on ${d.source}`)}
          <h2 class="text-body-md font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">${link(d, "", esc(d.title))}</h2>
          ${d.description ? `<p class="text-body-sm text-on-surface-variant line-clamp-3 mt-1">${esc(d.description)}</p>` : ""}
        </div>
        <div class="pt-3 mt-3 border-t border-outline-variant/30">
          <div class="flex items-baseline flex-wrap gap-x-2">
            <span class="font-mono text-headline-sm text-primary font-bold">${inr(d.price)}</span>
            ${drop(d) ? `<span class="font-mono text-label-md text-outline line-through">${inr(d.old_price)}</span><span class="text-label-sm text-tertiary">${percentOff(d)}% OFF</span>` : ""}
          </div>
          ${link(d, "btn btn-secondary w-full !rounded-xl mt-3 hover:!bg-primary hover:!text-on-primary", `<span>View on ${esc(d.source)}</span><span class="msym !text-[18px]">open_in_new</span>`)}
        </div>
      </article>`).join("");
  }

  function render() {
    renderPills();
    renderGrid();
  }

  async function start() {
    message("progress_activity", "Loading deals…", "");
    try {
      deals = await unwrap(db.from("deals").select("id,title,source,url,image,price,old_price,description").order("position").order("id"));
    } catch {
      return message("cloud_off", "Deals could not be loaded", "Please check your internet connection and try again.", `<button type="button" data-retry class="btn btn-primary btn-sm mt-4">Try again</button>`);
    }
    render();
  }

  // Count the click, then let the browser open the seller's site as normal.
  // Middle-click and Ctrl-click (open in a new tab) arrive as "auxclick" / "click".
  function track(event) {
    const link = event.target.closest("a[data-deal]");
    if (!link || (event.type === "auxclick" && event.button !== 1)) return;
    db.rpc("track_deal_click", { p_deal_id: Number(link.dataset.deal) }).then(() => {}, () => {});
  }
  document.addEventListener("click", track);
  document.addEventListener("auxclick", track);

  document.addEventListener("click", (event) => {
    const pill = event.target.closest("[data-site]");
    if (pill) {
      state.site = pill.dataset.site;
      return render();
    }
    if (event.target.closest("[data-retry]")) return start();
    if (event.target.closest("[data-reset]")) {
      Object.assign(state, { q: "", site: "all" });
      $$(".js-search").forEach((input) => { input.value = ""; });
      render();
    }
  });

  $$(".js-search").forEach((input) => input.addEventListener("input", () => {
    state.q = input.value;
    $$(".js-search").forEach((other) => { if (other !== input) other.value = input.value; });
    renderGrid();
  }));
  $("#sort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderGrid();
  });

  start();
})();
