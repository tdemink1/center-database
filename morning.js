// Morning Briefing: loads data/morning-*.json written by `scripts/generate_report.py --morning` and renders it.

function renderHead(r) {
  $("report-date").textContent = longDate(r.date);
  const generated = new Date(r.generatedAt).toLocaleString("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
  });
  $("report-meta").textContent = `Published ${generated} ET · Prices as of publication; U.S. markets open 9:30 AM ET`;
}

function renderBrief(r) {
  const box = $("commentary");
  box.hidden = !r.commentary;
  box.innerHTML = r.commentary ? renderMarkdown(r.commentary) : "";
  $("highlights").innerHTML = (r.highlights || []).map((h) => `<li>${esc(h)}</li>`).join("");
}

function renderMarkets(r) {
  const m = r.markets;
  $("market-grid").innerHTML = [
    marketTable("U.S. index futures", m.futures || []),
    marketTable("U.S. stocks (since the open)", (m.us || []).filter((x) => x.symbol !== "^NDX")),
    marketTable("Europe (midday)", m.europe || []),
    marketTable("Asia-Pacific (overnight close)", m.asia || []),
    marketTable("U.S. Treasury Yields", m.rates || [], { yields: true }),
    marketTable("Commodities", m.commodities || []),
    marketTable("Currencies & Crypto", [...(m.fx || []), ...(m.crypto || [])]),
  ].join("");
}

function moverTable(title, rows) {
  const body = rows.map((s) => {
    const headline = s.news && s.news[0];
    return `
      <tr>
        <td class="left"><span class="ticker">${esc(s.symbol)}</span><span class="name">${esc(s.name)}</span></td>
        <td>$${num(s.price, priceDigits(s.price))}</td>
        <td>${pct(s.changePct)}</td>
        <td class="left wrap">${headline
          ? `<a href="${esc(safeUrl(headline.link))}" target="_blank" rel="noopener noreferrer">${esc(headline.title)}</a>`
          : `<span class="muted">—</span>`}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="4" class="empty">None today.</td></tr>`;
  return `
    <article class="card table-card">
      <h3>${esc(title)}</h3>
      <div class="table-wrap">
        <table class="data-table compact">
          <thead><tr><th class="left">Ticker</th><th>Price</th><th>Today</th><th class="left">Latest headline</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </article>`;
}

function renderMovers(r) {
  const moved = r.watchlist.filter((s) => s.changePct != null).sort((a, b) => b.changePct - a.changePct);
  const up = moved.filter((s) => s.changePct > 0.005).slice(0, 6);
  const down = moved.filter((s) => s.changePct < -0.005).reverse().slice(0, 6);
  $("mover-grid").innerHTML = moverTable("Biggest gainers", up) + moverTable("Biggest decliners", down);
}

function renderCalendar(r) {
  const rows = (r.calendar || []).filter((e) => MAJOR_REGIONS.has(e.country));
  const now = Date.now();
  $("cal-body").innerHTML = rows.length ? rows.map((e) => {
    const released = new Date(e.time).getTime() <= now;
    const time = new Date(e.time).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
    });
    return `
      <tr class="${released ? "released" : ""}">
        <td class="left nowrap">${esc(time)}</td>
        <td class="left nowrap">${esc(REGION_NAMES[e.country] || e.country)}</td>
        <td class="left">${esc(e.event)}</td>
        <td class="center"><span class="impact impact-${e.impact.toLowerCase()}">${esc(e.impact)}</span></td>
        <td>${esc(e.forecast || "—")}</td>
        <td>${esc(e.previous || "—")}</td>
        <td class="center"><span class="status ${released ? "status-done" : "status-next"}">${released ? "Released" : "Upcoming"}</span></td>
      </tr>`;
  }).join("") : `<tr><td colspan="7" class="empty">No major scheduled releases today.</td></tr>`;
}

function renderNews(r) {
  const seen = new Set();
  const items = (r.macroNews || [])
    .flatMap((f) => f.items)
    .filter((n) => !seen.has(n.title) && seen.add(n.title))
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .slice(0, 10);
  $("news-list").innerHTML = items.map((n) => `
    <li>
      <a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
      ${n.summary ? `<p>${esc(n.summary)}</p>` : ""}
      <span class="muted">${esc(n.source)}${n.published ? ` · ${esc(timeAgo(n.published))}` : ""}</span>
    </li>`).join("") || `<li class="muted">No headlines available.</li>`;
}

function render(r) {
  renderHead(r);
  renderBrief(r);
  renderMarkets(r);
  renderMovers(r);
  renderCalendar(r);
  renderNews(r);
  $("report-body").hidden = false;
  $("load-error").hidden = true;
}

async function loadEdition(date) {
  try {
    const r = await loadJson(date ? `data/morning-${date}.json` : "data/morning-latest.json");
    render(r);
    return r;
  } catch (e) {
    $("report-date").textContent = "Morning Briefing";
    $("report-body").hidden = true;
    $("load-error").hidden = false;
    return null;
  }
}

async function init() {
  try {
    const { morning = [] } = await loadJson("data/index.json");
    $("archive-select").innerHTML = morning
      .map((d) => `<option value="${esc(d)}">${esc(longDate(d))}</option>`)
      .join("");
    $("archive-select").closest(".archive").hidden = !morning.length;
  } catch (e) {
    $("archive-select").closest(".archive").hidden = true;
  }
  const r = await loadEdition(null);
  if (r) $("archive-select").value = r.date;
}

$("archive-select").addEventListener("change", (e) => loadEdition(e.target.value));

init();
