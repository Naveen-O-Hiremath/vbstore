// Deals page: products listed from other shopping sites. Every link opens the
// original site in a new tab and the click is counted for the admin dashboard.
(() => {
  const { esc } = VB;
  const db = VB.connect();
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let deals = [];
  const state = { q: "", site: "all", sort: "featured" };

  const drop = VB.dealDrop;
  const percentOff = VB.dealPercentOff;

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
    $("#grid").innerHTML = list.map((d) => VB.dealCard(d)).join("");
  }

  function render() {
    renderPills();
    renderGrid();
  }

  async function start() {
    message("progress_activity", "Loading deals…", "");
    try {
      deals = await VB.fetchDeals(db);
    } catch {
      return message("cloud_off", "Deals could not be loaded", "Please check your internet connection and try again.", `<button type="button" data-retry class="btn btn-primary btn-sm mt-4">Try again</button>`);
    }
    render();
  }

  VB.trackDealClicks(db);

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
