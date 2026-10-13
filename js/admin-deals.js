// Admin sections for deals listed from other shopping sites: the Deals tab
// (add, edit, hide, reorder) and the Dashboard tab (click statistics).
// Registers with js/admin.js, which passes in its shared helpers.
(VB.adminModules ||= []).push(({ db, act, confirmDialog, isAdmin, friendly, uploadPhoto, actions }) => {
  const { inr, esc, unwrap } = VB;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  // Used to fill in the site name from a pasted link.
  const SITES = [
    ["amazon.", "Amazon"], ["amzn.", "Amazon"], ["flipkart.", "Flipkart"], ["fkrt.", "Flipkart"],
    ["myntra.", "Myntra"], ["meesho.", "Meesho"], ["ajio.", "Ajio"], ["nykaa", "Nykaa"], ["croma.", "Croma"],
    ["tatacliq.", "Tata CLiQ"], ["jiomart.", "JioMart"], ["reliancedigital.", "Reliance Digital"], ["snapdeal.", "Snapdeal"]
  ];
  const RANGES = [7, 30, 90];

  let deals = [];
  let stats = { days: [], previous: 0, allTime: 0, deals: [] };
  let range = 30;
  let query = "";
  let editingId = null;

  async function load() {
    [deals, stats] = await Promise.all([
      unwrap(db.from("deals").select("*").order("position").order("id")),
      unwrap(db.rpc("deal_stats", { p_days: range }))
    ]);
  }

  const dealById = (id) => deals.find((d) => d.id === Number(id));
  const clicksOf = (id) => stats.deals.find((row) => row.id === id) || { clicks: 0, allTime: 0, last: null };
  const dropOf = (d) => d.old_price - d.price;
  const percentOff = (d) => Math.round((dropOf(d) / d.old_price) * 100);
  const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };
  const siteFromUrl = (url) => {
    const host = hostOf(url).toLowerCase();
    return (host && SITES.find(([key]) => host.includes(key))?.[1]) || "";
  };
  const updateDeal = (id, values) => unwrap(db.from("deals").update(values).eq("id", id));
  const thumb = (d) => (d.image
    ? `<img src="${esc(d.image)}" alt="" class="w-full h-full object-contain" onerror="this.style.visibility='hidden'"/>`
    : `<span class="msym text-outline">image</span>`);

  // ---------- Deals tab ----------

  function renderDeals() {
    const admin = isAdmin();
    const q = query.trim().toLowerCase();
    const list = deals.filter((d) => !q || `${d.title} ${d.source} ${d.description}`.toLowerCase().includes(q));
    const canMove = list.length === deals.length;
    const iconButton = (action, id, icon, title, extra = "") => `<button type="button" data-action="${action}" data-id="${id}" title="${title}" aria-label="${title}" ${extra} class="p-1.5 rounded-md text-on-surface-variant hover:text-primary hover:bg-surface-container-high disabled:opacity-25 disabled:pointer-events-none"><span class="msym">${icon}</span></button>`;

    $("#d-empty").hidden = !!list.length;
    $("#d-empty").textContent = deals.length ? "No deals match your search." : `No deals yet.${admin ? " Press “Add deal” to list your first one." : ""}`;
    $("#d-rows").innerHTML = list.map((d, i) => `
      <tr class="border-b border-outline-variant/20 last:border-0 hover:bg-surface-container-low">
        <td class="p-3">
          <div class="flex items-center gap-3 ${d.hidden ? "opacity-50" : ""}">
            <div class="w-12 h-12 shrink-0 rounded-lg bg-surface-container flex items-center justify-center overflow-hidden">${thumb(d)}</div>
            <div class="min-w-0">
              <p class="text-label-lg truncate max-w-[320px]">${esc(d.title)}</p>
              <p class="text-label-md text-outline truncate max-w-[320px]">${esc(d.source)} · <a href="${esc(d.url)}" target="_blank" rel="noopener" class="hover:text-primary underline">${esc(hostOf(d.url))}</a>${d.hidden ? " · Hidden" : ""}</p>
            </div>
          </div>
        </td>
        <td class="p-3 text-right font-mono text-primary font-semibold">${inr(d.price)}</td>
        <td class="p-3 text-right font-mono text-outline">${dropOf(d) ? inr(d.old_price) : "—"}</td>
        <td class="p-3 text-right font-mono">${dropOf(d) ? `${inr(dropOf(d))}<span class="block text-label-sm text-tertiary">${percentOff(d)}% off</span>` : "—"}</td>
        <td class="p-3 text-right font-mono">${clicksOf(d.id).allTime}</td>
        <td class="p-3 text-center">
          <button type="button" data-action="deal-toggle" data-id="${d.id}" ${admin ? "" : "disabled"} title="${d.hidden ? "Hidden from the Deals page" : "Visible on the Deals page"}" class="${d.hidden ? "text-outline" : "text-tertiary"}"><span class="msym">${d.hidden ? "visibility_off" : "visibility"}</span></button>
        </td>
        <td class="p-3">
          <div class="admin-only flex justify-end">
            ${iconButton("deal-move", d.id, "arrow_upward", canMove ? "Move up" : "Clear the search to reorder", `data-delta="-1" ${canMove && i > 0 ? "" : "disabled"}`)}
            ${iconButton("deal-move", d.id, "arrow_downward", canMove ? "Move down" : "Clear the search to reorder", `data-delta="1" ${canMove && i < list.length - 1 ? "" : "disabled"}`)}
            ${iconButton("deal-edit", d.id, "edit", "Edit")}
            ${iconButton("deal-delete", d.id, "delete", "Delete")}
          </div>
        </td>
      </tr>`).join("");
  }

  $("#d-search").addEventListener("input", (event) => {
    query = event.target.value;
    renderDeals();
  });

  // ---------- Deal editor ----------

  const form = $("#deal-form");
  let siteWasAutoFilled = false;

  function renderPreview() {
    const src = form.elements.image.value.trim();
    $("#de-preview").innerHTML = src
      ? `<img src="${esc(src)}" alt="" class="w-full h-full object-contain" onerror="this.style.visibility='hidden'"/>`
      : `<span class="msym text-outline">image</span>`;
  }

  function renderDrop() {
    const price = Number(form.elements.price.value);
    const old = Number(form.elements.old_price.value);
    $("#de-drop").textContent = price > 0 && old > price
      ? `Shown as a price drop of ${inr(old - price)} (${Math.round(((old - price) / old) * 100)}% off).`
      : "";
  }

  function openEditor(deal) {
    editingId = deal?.id ?? null;
    $("#deal-editor-title").textContent = deal ? "Edit deal" : "Add deal";
    $("#deal-error").textContent = "";
    form.reset();
    siteWasAutoFilled = !deal;
    if (deal) {
      for (const key of ["url", "title", "source", "price", "description", "image"]) form.elements[key].value = deal[key];
      form.elements.old_price.value = dropOf(deal) ? deal.old_price : "";
      form.elements.hidden.checked = deal.hidden;
    }
    $("#site-list").innerHTML = [...new Set([...SITES.map(([, name]) => name), ...deals.map((d) => d.source)])]
      .map((name) => `<option value="${esc(name)}">`).join("");
    renderPreview();
    renderDrop();
    $("#deal-editor").showModal();
  }

  // Pasting a link fills in the site name, unless the admin typed their own.
  form.elements.url.addEventListener("input", () => {
    const site = siteFromUrl(form.elements.url.value.trim());
    if (site && (siteWasAutoFilled || !form.elements.source.value.trim())) {
      form.elements.source.value = site;
      siteWasAutoFilled = true;
    }
  });
  form.elements.source.addEventListener("input", () => { siteWasAutoFilled = false; });
  form.elements.image.addEventListener("input", renderPreview);
  form.elements.price.addEventListener("input", renderDrop);
  form.elements.old_price.addEventListener("input", renderDrop);

  $("#de-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file || !isAdmin()) return;
    $("#deal-error").textContent = "Uploading photo…";
    try {
      form.elements.image.value = await uploadPhoto(file);
      $("#deal-error").textContent = "";
      renderPreview();
    } catch (error) {
      $("#deal-error").textContent = `The photo could not be uploaded: ${friendly(error.message)}`;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAdmin()) return;
    const data = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));
    const price = Number(data.price);
    const old = Number(data.old_price) || price;

    const problem =
      !/^https?:\/\/\S+$/i.test(data.url) || !hostOf(data.url) ? "Enter the full link to the product, starting with https://" :
      !data.title ? "A title is required." :
      !data.source ? "Enter the site this deal is from, for example Amazon." :
      !(price > 0) ? "Enter the current price, greater than 0." :
      old < price ? "The earlier price cannot be lower than the price now." : "";
    $("#deal-error").textContent = problem;
    if (problem) return;

    const values = {
      url: data.url,
      title: data.title,
      source: data.source,
      price: Math.round(price),
      old_price: Math.round(old),
      description: data.description,
      image: data.image,
      hidden: form.elements.hidden.checked
    };
    const saved = editingId
      ? await act(() => updateDeal(editingId, values), "Deal updated")
      : await act(() => unwrap(db.from("deals").insert({ ...values, position: Math.max(0, ...deals.map((d) => d.position)) + 1 })), "Deal added");
    if (saved) $("#deal-editor").close();
  });

  // ---------- Dashboard ----------

  const number = new Intl.NumberFormat("en-IN");
  const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n));
  const plural = (n, word) => `${number.format(n)} ${word}${n === 1 ? "" : "s"}`;
  const parseDay = (day) => new Date(`${day}T00:00:00`);
  const shortDay = (day) => parseDay(day).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const longDay = (day) => parseDay(day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const CHART = "rgb(var(--c-chart))";

  function renderTiles() {
    const total = stats.days.reduce((sum, d) => sum + d.clicks, 0);
    const today = stats.days.at(-1)?.clicks ?? 0;
    const live = deals.filter((d) => !d.hidden).length;

    // Compared with the same number of days immediately before the period.
    let delta;
    if (!stats.previous) {
      delta = total ? ["trending_up", "text-tertiary", `No clicks in the ${range} days before`] : ["trending_flat", "text-outline", "No clicks yet"];
    } else {
      const change = Math.round(((total - stats.previous) / stats.previous) * 100);
      delta = change > 0 ? ["trending_up", "text-tertiary", `${change}% more than the ${range} days before`]
        : change < 0 ? ["trending_down", "text-error", `${-change}% fewer than the ${range} days before`]
        : ["trending_flat", "text-outline", `Same as the ${range} days before`];
    }

    const tile = (label, value, note) => `
      <div class="bg-surface-container-lowest p-5">
        <p class="text-label-md text-on-surface-variant">${label}</p>
        <p class="text-headline-lg font-semibold mt-1">${value}</p>
        <p class="text-label-md text-on-surface-variant mt-1 flex items-center gap-1 min-h-[20px]">${note}</p>
      </div>`;
    $("#k-tiles").innerHTML =
      tile(`Clicks, last ${range} days`, number.format(total), `<span class="msym !text-[16px] ${delta[1]}">${delta[0]}</span>${delta[2]}`) +
      tile("Clicks today", number.format(today), `Average ${(total / range).toFixed(1)} a day`) +
      tile("Clicks, all time", number.format(stats.allTime), "Since the first deal was listed") +
      tile("Deals live", number.format(live), deals.length - live ? `${deals.length - live} hidden` : "All deals are visible");
  }

  // Rounds the top of the y-axis up to a clean number with at most four steps.
  function niceScale(max) {
    const raw = Math.max(max, 4) / 4;
    const power = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw);
    return { step, top: Math.ceil(Math.max(max, 4) / step) * step };
  }

  // Column chart of clicks per day, drawn as SVG at the container's real width
  // so text stays a constant size on every screen.
  function renderDaily() {
    const el = $("#daily-chart");
    const days = stats.days;
    const total = days.reduce((sum, d) => sum + d.clicks, 0);
    $("#daily-sub").textContent = days.length ? `${shortDay(days[0].day)} to ${shortDay(days.at(-1).day)}, Indian time` : "";
    $("#daily-table").innerHTML = [...days].reverse().map((d) => `<tr class="border-t border-outline-variant/20"><td class="p-2">${longDay(d.day)}</td><td class="p-2 text-right font-mono">${d.clicks}</td></tr>`).join("");
    if (!total) {
      el.innerHTML = `<p class="py-16 text-center text-on-surface-variant">No clicks in this period yet. They will appear here as customers open deals.</p>`;
      return;
    }

    const W = Math.max(el.clientWidth, 280);
    const H = 240;
    const m = { left: 36, right: 8, top: 22, bottom: 26 };
    const plotW = W - m.left - m.right;
    const plotH = H - m.top - m.bottom;
    const peak = Math.max(...days.map((d) => d.clicks));
    const { step, top } = niceScale(peak);
    const band = plotW / days.length;
    const barW = Math.max(1, Math.min(24, band - 2)); // 2px of surface between neighbours
    const y = (value) => m.top + plotH - (value / top) * plotH;
    const baseline = m.top + plotH;

    let grid = "";
    for (let value = 0; value <= top; value += step) {
      grid += `<line x1="${m.left}" x2="${W - m.right}" y1="${y(value)}" y2="${y(value)}" stroke="rgb(var(--c-outline-variant) / ${value ? 0.45 : 1})" stroke-width="1"/>
        <text x="${m.left - 8}" y="${y(value) + 4}" text-anchor="end">${compact(value)}</text>`;
    }

    // Label as many days as fit, always including the most recent one.
    const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotW / 64))));
    const peakIndex = days.findIndex((d) => d.clicks === peak);
    let marks = "";
    let labels = "";
    let hits = "";
    days.forEach((d, i) => {
      const cx = m.left + band * i + band / 2;
      const x = cx - barW / 2;
      const h = (d.clicks / top) * plotH;
      if (h > 0) {
        const r = Math.min(4, barW / 2, h); // rounded at the data end, square on the baseline
        marks += `<path class="mark" data-key="${d.day}" fill="${CHART}" d="M${x},${baseline} V${baseline - h + r} Q${x},${baseline - h} ${x + r},${baseline - h} H${x + barW - r} Q${x + barW},${baseline - h} ${x + barW},${baseline - h + r} V${baseline} Z"/>`;
      }
      if ((days.length - 1 - i) % every === 0) labels += `<text x="${cx}" y="${H - 6}" text-anchor="${i === days.length - 1 ? "end" : "middle"}" ${i === days.length - 1 ? `dx="${band / 2}"` : ""}>${shortDay(d.day)}</text>`;
      if (i === peakIndex) labels += `<text class="peak" x="${Math.min(Math.max(cx, m.left + 12), W - m.right - 12)}" y="${y(peak) - 6}" text-anchor="middle">${number.format(peak)}</text>`;
      // The whole column of the plot is the hover / focus target, not just the bar.
      hits += `<rect x="${m.left + band * i}" y="${m.top}" width="${band}" height="${plotH}" fill="transparent" tabindex="0" role="img" aria-label="${esc(`${longDay(d.day)}: ${plural(d.clicks, "click")}`)}" data-key="${d.day}" data-tip-value="${esc(plural(d.clicks, "click"))}" data-tip-label="${esc(longDay(d.day))}"/>`;
    });

    el.innerHTML = `<svg data-chart width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Clicks per day" class="block">
      <style>text{font-size:11px;fill:rgb(var(--c-outline));font-variant-numeric:tabular-nums}text.peak{fill:rgb(var(--c-on-surface));font-weight:600}rect:focus{outline:none}rect:focus-visible{stroke:rgb(var(--c-primary));stroke-width:1}</style>
      ${grid}${marks}${labels}${hits}</svg>`;
  }

  // Horizontal bars with the value at the tip. One series, so one colour.
  function barList(el, rows, emptyText) {
    const max = Math.max(0, ...rows.map((row) => row.value));
    if (!max) {
      el.innerHTML = `<p class="py-10 text-center text-on-surface-variant">${emptyText}</p>`;
      return;
    }
    el.innerHTML = `<div data-chart class="space-y-3">${rows.map((row) => `
      <div tabindex="0" data-key="${esc(row.key)}" data-tip-value="${esc(plural(row.value, "click"))}" data-tip-label="${esc(row.tip)}" class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-3 rounded focus:outline-none focus-visible:ring-1 ring-primary">
        <div class="min-w-0">
          <p class="text-body-sm truncate">${esc(row.label)}</p>
          ${row.sub ? `<p class="text-label-md text-outline truncate">${esc(row.sub)}</p>` : ""}
        </div>
        <div class="flex items-center gap-2 min-w-0">
          <div class="mark h-3 rounded-r" data-key="${esc(row.key)}" style="width:calc((100% - 3.5rem) * ${row.value / max});min-width:${row.value ? 2 : 0}px;background:${CHART}"></div>
          <span class="text-label-md font-mono shrink-0">${number.format(row.value)}</span>
        </div>
      </div>`).join("")}</div>`;
  }

  function renderBreakdowns() {
    const withClicks = deals.map((d) => ({ deal: d, ...clicksOf(d.id) }));

    barList($("#top-deals"), withClicks.filter((row) => row.clicks).sort((a, b) => b.clicks - a.clicks).slice(0, 7).map((row) => ({
      key: `deal-${row.deal.id}`,
      label: row.deal.title,
      sub: row.deal.source,
      value: row.clicks,
      tip: `${row.deal.title} · ${plural(row.allTime, "click")} all time`
    })), "No clicks in this period yet.");

    const bySite = new Map();
    for (const row of withClicks) bySite.set(row.deal.source, (bySite.get(row.deal.source) || 0) + row.clicks);
    const sites = [...bySite].map(([site, value]) => ({ site, value })).filter((row) => row.value).sort((a, b) => b.value - a.value);
    // Past seven sites the tail is folded into one row to keep the list readable.
    const shown = sites.length > 8 ? [...sites.slice(0, 7), { site: "Other sites", value: sites.slice(7).reduce((sum, row) => sum + row.value, 0) }] : sites;
    const siteTotal = sites.reduce((sum, row) => sum + row.value, 0);
    barList($("#by-site"), shown.map((row) => ({
      key: `site-${row.site}`,
      label: row.site,
      sub: `${Math.round((row.value / siteTotal) * 100)}% of clicks`,
      value: row.value,
      tip: `${row.site} · ${Math.round((row.value / siteTotal) * 100)}% of clicks in this period`
    })), "No clicks in this period yet.");

    const lastClick = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
    $("#perf-empty").hidden = !!deals.length;
    $("#perf-rows").innerHTML = withClicks.sort((a, b) => b.clicks - a.clicks || b.allTime - a.allTime).map((row) => `
      <tr class="border-b border-outline-variant/20 last:border-0">
        <td class="p-3"><span class="block truncate max-w-[340px] ${row.deal.hidden ? "text-outline" : ""}">${esc(row.deal.title)}${row.deal.hidden ? " (hidden)" : ""}</span></td>
        <td class="p-3 text-on-surface-variant">${esc(row.deal.source)}</td>
        <td class="p-3 text-right font-mono">${inr(row.deal.price)}</td>
        <td class="p-3 text-right font-mono font-semibold">${number.format(row.clicks)}</td>
        <td class="p-3 text-right font-mono">${number.format(row.allTime)}</td>
        <td class="p-3 text-right text-on-surface-variant">${lastClick(row.last)}</td>
      </tr>`).join("");
  }

  function renderDashboard() {
    $("#range").innerHTML = RANGES.map((days) => `<button type="button" data-action="stats-range" data-days="${days}" aria-pressed="${days === range}" class="px-3 py-1.5 rounded-md text-label-md ${days === range ? "bg-surface-container-highest text-on-surface" : "text-outline hover:text-on-surface"}">Last ${days} days</button>`).join("");
    $("#range-note").textContent = "Every number below covers this period.";
    $("#dash").style.opacity = "";
    renderTiles();
    renderDaily();
    renderBreakdowns();
  }

  // One tooltip for every chart. It repeats values that are also on the page
  // (bar labels and the tables), and shows on keyboard focus as well as hover.
  const tip = $("#chart-tip");
  const dash = $("#dash");
  function showTip(target, x, y) {
    $("#chart-tip-value").textContent = target.dataset.tipValue;
    $("#chart-tip-label").textContent = target.dataset.tipLabel;
    tip.hidden = false;
    tip.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${y - tip.offsetHeight - 12 < 8 ? y + 18 : y - tip.offsetHeight - 12}px`;
    for (const mark of $$(".mark", target.closest("[data-chart]"))) mark.style.opacity = mark.dataset.key === target.dataset.key ? "" : "0.4";
  }
  function hideTip() {
    tip.hidden = true;
    for (const mark of $$(".mark", dash)) mark.style.opacity = "";
  }
  dash.addEventListener("pointermove", (event) => {
    const target = event.target.closest("[data-tip-value]");
    if (target) showTip(target, event.clientX, event.clientY);
    else hideTip();
  });
  dash.addEventListener("pointerleave", hideTip);
  dash.addEventListener("focusin", (event) => {
    const target = event.target.closest("[data-tip-value]");
    if (!target) return;
    const box = target.getBoundingClientRect();
    showTip(target, box.left + box.width / 2, box.top);
  });
  dash.addEventListener("focusout", hideTip);

  // Redraw the day chart when its width changes, including the first time the tab is shown.
  let lastWidth = 0;
  new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width && width !== lastWidth) {
      lastWidth = width;
      renderDaily();
    }
  }).observe($("#daily-chart"));

  // ---------- Actions ----------

  Object.assign(actions, {
    "deal-new": () => openEditor(null),
    "deal-edit": ({ id }) => openEditor(dealById(id)),
    "deal-close": () => $("#deal-editor").close(),
    "deal-toggle": ({ id }) => act(() => updateDeal(Number(id), { hidden: !dealById(id).hidden })),
    "deal-move": ({ id, delta }) => {
      const from = deals.findIndex((d) => d.id === Number(id));
      const to = from + Number(delta);
      if (to < 0 || to >= deals.length) return;
      const [a, b] = [deals[from], deals[to]];
      act(() => Promise.all([updateDeal(a.id, { position: b.position }), updateDeal(b.id, { position: a.position })]));
    },
    "deal-delete": async ({ id }) => {
      const deal = dealById(id);
      const clicks = clicksOf(deal.id).allTime;
      const warning = clicks ? ` Its ${plural(clicks, "click")} will be removed from the dashboard too. Hide it instead to keep them.` : "";
      if (await confirmDialog(`Delete "${deal.title}"?${warning}`, "Delete")) {
        act(() => unwrap(db.from("deals").delete().eq("id", deal.id)), "Deal deleted");
      }
    },
    "stats-range": ({ days }) => {
      range = Number(days);
      dash.style.opacity = "0.5"; // keep the old numbers on screen, dimmed, while the new ones load
      act(() => {});
    }
  });

  return {
    load,
    render: () => {
      renderDeals();
      renderDashboard();
    }
  };
});
