// Daily Market Report: loads data/*.json written by scripts/generate_report.py and renders it.

const $ = (id) => document.getElementById(id);

const state = {
  report: null,
  sortKey: null,
  sortDir: -1,
  ratingFilter: "",
  text: "",
  openRows: new Set(),
  newsTopic: null,
  calRegion: "major",
};

// ---------------------------------------------------------------- formatting

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || "") ? url : "#";
}

function num(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function priceDigits(value) {
  if (value == null) return 2;
  if (Math.abs(value) >= 1000) return 2;
  if (Math.abs(value) < 10) return 4;
  return 2;
}

function signClass(value) {
  if (value == null || Math.abs(value) < 0.005) return "flat";
  return value > 0 ? "up" : "down";
}

// Arrows and signs carry direction too, so it is never color alone.
function pct(value) {
  if (value == null || Number.isNaN(value)) return `<span class="chg flat">—</span>`;
  const arrow = value > 0.005 ? "▲" : value < -0.005 ? "▼" : "";
  const sign = value > 0 ? "+" : "";
  return `<span class="chg ${signClass(value)}"><span aria-hidden="true">${arrow}</span> ${sign}${num(value)}%</span>`;
}

function bp(change) {
  if (change == null) return `<span class="chg flat">—</span>`;
  const v = change * 100;
  const sign = v > 0 ? "+" : "";
  return `<span class="chg ${signClass(v)}">${sign}${v.toFixed(0)} bp</span>`;
}

function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function longDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

// Small Markdown subset for the written brief: ### headings, - bullets, **bold**, paragraphs.
function renderMarkdown(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const out = [];
  let list = null;
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (/^[-*] /.test(line)) {
      if (!list) { list = []; }
      list.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
    if (!line) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    out.push(heading ? `<h3>${inline(heading[1])}</h3>` : `<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join("")}</ul>`);
  return out.join("");
}

// ---------------------------------------------------------------- sparkline

function sparkline(values, { width = 120, height = 32, label = "" } = {}) {
  const pts = (values || []).filter((v) => v != null);
  if (pts.length < 2) return "";
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 3;
  const step = (width - pad * 2) / (pts.length - 1);
  const coords = pts.map((v, i) => [
    pad + i * step,
    pad + (height - pad * 2) * (1 - (v - min) / span),
  ]);
  const d = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const trend = signClass(pts[pts.length - 1] - pts[0]);
  const [lx, ly] = coords[coords.length - 1];
  const change = (pts[pts.length - 1] / pts[0] - 1) * 100;
  const title = `${label} 3-month trend: ${num(pts[0], priceDigits(pts[0]))} → ${num(pts[pts.length - 1], priceDigits(pts[0]))} (${change > 0 ? "+" : ""}${change.toFixed(1)}%), range ${num(min, priceDigits(min))}–${num(max, priceDigits(max))}`;
  return `<svg class="spark ${trend}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
    <title>${esc(title)}</title>
    <path d="${d}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5"/>
  </svg>`;
}

// ---------------------------------------------------------------- sections

function renderHead(r) {
  $("report-date").textContent = longDate(r.date);
  const generated = new Date(r.generatedAt);
  $("report-meta").textContent =
    `Generated ${generated.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · ` +
    `${r.watchlist.length} holdings tracked · Data: Yahoo Finance, CNBC, MarketWatch, Federal Reserve`;
}

function renderBrief(r) {
  const box = $("commentary");
  if (r.commentary) {
    box.innerHTML = renderMarkdown(r.commentary);
    box.hidden = false;
  } else {
    box.hidden = true;
  }
  $("highlights").innerHTML = (r.highlights || []).map((h) => `<li>${esc(h)}</li>`).join("");
}

function renderUS(r) {
  $("us-grid").innerHTML = (r.markets.us || []).map((m) => `
    <article class="card index-card">
      <div class="index-top">
        <h3>${esc(m.label)}</h3>
        ${pct(m.changePct)}
      </div>
      <p class="index-price">${num(m.price)}</p>
      <p class="index-sub">
        ${m.change == null ? "" : `${m.change > 0 ? "+" : ""}${num(m.change)} pts`}
        · YTD ${pct(m.changeYtd)}
      </p>
      ${sparkline(m.spark, { width: 220, height: 40, label: m.label })}
    </article>`).join("");
}

function diff(now, then) {
  return now == null || then == null ? null : now - then;
}

function marketTable(title, rows, { yields = false } = {}) {
  const body = rows.map((m) => `
    <tr>
      <td class="left"><span class="name">${esc(m.label)}</span></td>
      <td>${yields ? `${num(m.price, 3)}%` : num(m.price, priceDigits(m.price))}</td>
      <td>${yields ? bp(m.change) : pct(m.changePct)}</td>
      <td>${yields ? bp(diff(m.price, m.close1w)) : pct(m.change1w)}</td>
      <td>${yields ? bp(diff(m.price, m.closeYtd)) : pct(m.changeYtd)}</td>
    </tr>`).join("");
  return `
    <article class="card table-card">
      <h3>${esc(title)}</h3>
      <div class="table-wrap">
        <table class="data-table compact">
          <thead><tr>
            <th class="left">Market</th><th>${yields ? "Yield" : "Last"}</th><th>1D</th><th>1W</th><th>YTD</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </article>`;
}

function renderGlobal(r) {
  const m = r.markets;
  $("global-grid").innerHTML = [
    marketTable("Europe", m.europe || []),
    marketTable("Asia-Pacific", m.asia || []),
    marketTable("Americas ex-U.S.", m.americas || []),
  ].join("");
  $("cross-grid").innerHTML = [
    marketTable("U.S. Treasury Yields", m.rates || [], { yields: true }),
    marketTable("Commodities", m.commodities || []),
    marketTable("Currencies", m.fx || []),
    marketTable("Crypto", m.crypto || []),
  ].join("");
}

// ---------------------------------------------------------------- watchlist

const RATING_ORDER = { Buy: 3, Hold: 2, Sell: 1 };
const CONSENSUS_LABEL = {
  strong_buy: "Strong Buy", buy: "Buy", hold: "Hold", underperform: "Underperform", sell: "Sell",
};

function ratingBadge(c) {
  if (!c.rating) {
    return `<span class="rating rating-none" title="${esc(c.note || "")}">N/A</span>`;
  }
  const detail = CONSENSUS_LABEL[c.consensusKey] || c.rating;
  return `<span class="rating rating-${c.rating.toLowerCase()}">${c.rating}</span>
    <span class="rating-sub">${esc(detail)} · ${num(c.consensusMean)}</span>`;
}

function breakdownBar(b) {
  if (!b) return "";
  const parts = [
    ["strongBuy", "Strong Buy"], ["buy", "Buy"], ["hold", "Hold"], ["sell", "Sell"], ["strongSell", "Strong Sell"],
  ];
  const total = parts.reduce((s, [k]) => s + (b[k] || 0), 0);
  if (!total) return "";
  const segs = parts
    .filter(([k]) => b[k])
    .map(([k, label]) => `<span class="seg seg-${k}" style="flex:${b[k]}" title="${label}: ${b[k]}"></span>`)
    .join("");
  const legend = parts
    .map(([k, label]) => `<span class="legend-item"><span class="swatch seg-${k}"></span>${label} <strong>${b[k] || 0}</strong></span>`)
    .join("");
  return `<div class="breakdown"><div class="bar" role="img" aria-label="Analyst ratings: ${parts.map(([k, l]) => `${l} ${b[k] || 0}`).join(", ")}">${segs}</div><div class="legend">${legend}</div></div>`;
}

function stockDetail(s) {
  const c = s.consensus;
  const range = s.low52 != null && s.high52 != null && s.high52 > s.low52
    ? Math.min(100, Math.max(0, ((s.price - s.low52) / (s.high52 - s.low52)) * 100))
    : null;
  const analyst = c.rating
    ? `<h4>Analyst consensus</h4>
       <p><strong>${c.rating}</strong> — ${esc(CONSENSUS_LABEL[c.consensusKey] || "")}, mean ${num(c.consensusMean)} on a 1 (Strong Buy) to 5 (Sell) scale from ${c.analysts ?? "—"} analysts.</p>
       ${breakdownBar(c.breakdown)}
       <p class="muted">Price targets: low $${num(c.targetLow)} · mean $${num(c.targetMean)} · high $${num(c.targetHigh)}</p>`
    : `<h4>Analyst consensus</h4><p class="muted">${esc(c.note || "No analyst coverage")}.</p>`;
  const news = s.news.length
    ? `<ul class="mini-news">${s.news.map((n) => `
        <li><a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
        <span class="muted"> · ${esc(timeAgo(n.published))}</span></li>`).join("")}</ul>`
    : `<p class="muted">No recent headlines.</p>`;
  return `
    <div class="detail-grid">
      <div>
        <h4>Trading</h4>
        <p class="muted">${esc(s.exchange || "")} · ${esc(s.type === "MUTUALFUND" ? "Mutual fund (NAV)" : s.type === "ETF" ? "ETF" : "Equity")}</p>
        <p>Day range $${num(s.dayLow)} – $${num(s.dayHigh)}${s.volume ? ` · Volume ${s.volume.toLocaleString("en-US")}` : ""}</p>
        ${range == null ? "" : `
          <div class="range52" aria-label="52-week range position ${range.toFixed(0)}%">
            <span>$${num(s.low52)}</span>
            <div class="range-track"><span class="range-dot" style="left:${range}%"></span></div>
            <span>$${num(s.high52)}</span>
          </div>
          <p class="muted">52-week range · ${range.toFixed(0)}% of the way from low to high</p>`}
        ${analyst}
      </div>
      <div>
        <h4>Latest news</h4>
        ${news}
      </div>
    </div>`;
}

function sortValue(s, key) {
  if (key === "rating") return RATING_ORDER[s.consensus.rating] ?? 0;
  if (key === "upsidePct") return s.consensus.upsidePct ?? -Infinity;
  if (key === "symbol") return s.symbol;
  return s[key] ?? -Infinity;
}

function renderWatchlist() {
  const r = state.report;
  let rows = r.watchlist.slice();
  const text = state.text.trim().toLowerCase();
  if (text) rows = rows.filter((s) => s.symbol.toLowerCase().includes(text) || s.name.toLowerCase().includes(text));
  if (state.ratingFilter === "none") rows = rows.filter((s) => !s.consensus.rating);
  else if (state.ratingFilter) rows = rows.filter((s) => s.consensus.rating === state.ratingFilter);
  if (state.sortKey) {
    rows.sort((a, b) => {
      const va = sortValue(a, state.sortKey);
      const vb = sortValue(b, state.sortKey);
      if (typeof va === "string") return va.localeCompare(vb) * state.sortDir;
      return (va - vb) * state.sortDir;
    });
  }

  document.querySelectorAll(".watch-table th[data-sort]").forEach((th) => {
    const active = th.dataset.sort === state.sortKey;
    th.setAttribute("aria-sort", active ? (state.sortDir > 0 ? "ascending" : "descending") : "none");
  });

  $("watch-body").innerHTML = rows.length ? rows.map((s) => {
    const c = s.consensus;
    const open = state.openRows.has(s.symbol);
    return `
      <tr class="stock-row${open ? " open" : ""}" data-symbol="${esc(s.symbol)}" tabindex="0" aria-expanded="${open}">
        <td class="left">
          <span class="ticker">${esc(s.symbol)}</span>
          <span class="name">${esc(s.name)}</span>
        </td>
        <td class="price">$${num(s.price, priceDigits(s.price))}</td>
        <td>${pct(s.changePct)}</td>
        <td>${pct(s.change1w)}</td>
        <td>${pct(s.change1m)}</td>
        <td>${pct(s.changeYtd)}</td>
        <td class="center">${sparkline(s.spark, { label: s.symbol })}</td>
        <td class="center">${ratingBadge(c)}</td>
        <td>${c.targetMean ? `$${num(c.targetMean)}<br>${pct(c.upsidePct)}` : `<span class="muted">—</span>`}</td>
      </tr>
      ${open ? `<tr class="detail-row"><td colspan="9">${stockDetail(s)}</td></tr>` : ""}`;
  }).join("") : `<tr><td colspan="9" class="empty">No holdings match this filter.</td></tr>`;
}

function renderWatchSummary(r) {
  const moved = r.watchlist.filter((s) => s.changePct != null);
  const up = moved.filter((s) => s.changePct > 0.005).length;
  const down = moved.filter((s) => s.changePct < -0.005).length;
  const counts = { Buy: 0, Hold: 0, Sell: 0, none: 0 };
  r.watchlist.forEach((s) => { counts[s.consensus.rating || "none"] += 1; });
  const sorted = moved.slice().sort((a, b) => b.changePct - a.changePct);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  $("watch-summary").innerHTML = `
    <span class="stat"><span class="chg up">▲ ${up}</span> advancing · <span class="chg down">▼ ${down}</span> declining</span>
    <span class="stat">Ratings: <strong>${counts.Buy}</strong> Buy · <strong>${counts.Hold}</strong> Hold · <strong>${counts.Sell}</strong> Sell · <strong>${counts.none}</strong> funds</span>
    ${best ? `<span class="stat">Best <strong>${esc(best.symbol)}</strong> ${pct(best.changePct)} · Worst <strong>${esc(worst.symbol)}</strong> ${pct(worst.changePct)}</span>` : ""}`;
  $("rating-method").textContent = r.ratingMethod || "";
}

// ---------------------------------------------------------------- news

function renderNews() {
  const feeds = (state.report.macroNews || []).filter((f) => f.items.length);
  if (!feeds.length) {
    $("news-tabs").innerHTML = "";
    $("news-list").innerHTML = `<li class="muted">No headlines available.</li>`;
    return;
  }
  if (!feeds.some((f) => f.topic === state.newsTopic)) state.newsTopic = feeds[0].topic;
  $("news-tabs").innerHTML = feeds.map((f) => `
    <button type="button" role="tab" data-topic="${esc(f.topic)}" aria-selected="${f.topic === state.newsTopic}" aria-pressed="${f.topic === state.newsTopic}">${esc(f.topic)}</button>`).join("");
  const feed = feeds.find((f) => f.topic === state.newsTopic);
  $("news-list").innerHTML = feed.items.map((n) => `
    <li>
      <a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
      ${n.summary ? `<p>${esc(n.summary)}</p>` : ""}
      <span class="muted">${esc(n.source)}${n.published ? ` · ${esc(timeAgo(n.published))}` : ""}</span>
    </li>`).join("");
}

// ---------------------------------------------------------------- calendar & outlook

const REGION_NAMES = {
  USD: "U.S.", EUR: "Eurozone", GBP: "U.K.", JPY: "Japan", CNY: "China", CAD: "Canada",
  AUD: "Australia", NZD: "New Zealand", CHF: "Switzerland", All: "Global",
};
const MAJOR_REGIONS = new Set(["USD", "EUR", "GBP", "JPY", "CNY", "All"]);

function shortDate(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function renderOutlook(r) {
  const o = r.outlook;
  const section = $("calendar").querySelector(".outlook-grid");
  if (!o) {
    section.hidden = true;
    $("outlook-note").textContent = "";
    return;
  }
  section.hidden = false;
  const today = r.date;
  const sourceLink = (url) => url ? ` <a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">Source</a>` : "";
  $("cb-body").innerHTML = o.centralBanks
    .filter((b) => b.date >= today)
    .map((b) => `
      <tr>
        <td class="left nowrap">${esc(shortDate(b.date))}</td>
        <td class="left"><strong>${esc(b.bank)}</strong>${b.current ? `<span class="name">Now ${esc(b.current)}</span>` : ""}</td>
        <td class="left wrap">${esc(b.expectation)}${sourceLink(b.source)}</td>
      </tr>`).join("") || `<tr><td colspan="3" class="empty">No meetings listed.</td></tr>`;
  $("release-body").innerHTML = o.keyReleases
    .filter((k) => k.date >= today)
    .map((k) => `
      <tr>
        <td class="left nowrap">${esc(shortDate(k.date))}</td>
        <td class="left"><strong>${esc(k.event)}</strong>${sourceLink(k.source)}</td>
        <td class="left wrap">${esc(k.forecast || "—")}</td>
        <td class="left wrap">${esc(k.previous || "—")}</td>
      </tr>`).join("") || `<tr><td colspan="4" class="empty">No releases listed.</td></tr>`;
  $("outlook-note").textContent = `Outlook curated ${shortDate(o.updated)}. ${o.note || ""}`;
}

function renderCalendar() {
  const all = state.report.calendar || [];
  const rows = all.filter((e) => (
    state.calRegion === "all" ||
    (state.calRegion === "us" ? e.country === "USD" : MAJOR_REGIONS.has(e.country))
  ));
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
  const dayOf = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  let lastDay = null;
  // A row is "released" if its time has passed now, not just when the report ran.
  const now = Date.now();
  $("cal-body").innerHTML = rows.length ? rows.map((e) => {
    const day = dayOf(e.time);
    const header = day !== lastDay ? `<tr class="day-row"><td colspan="7">${esc(longDate(day))}</td></tr>` : "";
    lastDay = day;
    const released = new Date(e.time).getTime() <= now;
    return `${header}
      <tr class="${released ? "released" : ""}">
        <td class="left nowrap">${esc(fmtTime(e.time))}</td>
        <td class="left nowrap">${esc(REGION_NAMES[e.country] || e.country)}</td>
        <td class="left">${esc(e.event)}</td>
        <td class="center"><span class="impact impact-${e.impact.toLowerCase()}">${esc(e.impact)}</span></td>
        <td>${esc(e.forecast || "—")}</td>
        <td>${esc(e.previous || "—")}</td>
        <td class="center"><span class="status ${released ? "status-done" : "status-next"}">${released ? "Released" : "Upcoming"}</span></td>
      </tr>`;
  }).join("") : `<tr><td colspan="7" class="empty">No calendar events for this filter.</td></tr>`;
}

// ---------------------------------------------------------------- loading

async function loadJson(path) {
  // GitHub Pages caches files for 10 minutes; a unique query string skips that cache.
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function render(report) {
  state.report = report;
  state.openRows.clear();
  renderHead(report);
  renderBrief(report);
  renderUS(report);
  renderGlobal(report);
  renderWatchSummary(report);
  renderWatchlist();
  renderNews();
  renderOutlook(report);
  renderCalendar();
  $("report-body").hidden = false;
  $("load-error").hidden = true;
}

async function loadEdition(date) {
  try {
    render(await loadJson(date ? `data/report-${date}.json` : "data/latest.json"));
  } catch (e) {
    $("report-date").textContent = "Daily Market Report";
    $("report-body").hidden = true;
    $("load-error").hidden = false;
  }
}

async function init() {
  try {
    const { dates } = await loadJson("data/index.json");
    $("archive-select").innerHTML = dates
      .map((d) => `<option value="${esc(d)}">${esc(longDate(d))}</option>`)
      .join("");
  } catch (e) {
    $("archive-select").closest(".archive").hidden = true;
  }
  await loadEdition(null);
  if (state.report) $("archive-select").value = state.report.date;
}

// ---------------------------------------------------------------- events

$("archive-select").addEventListener("change", (e) => loadEdition(e.target.value));

$("watch-filter").addEventListener("input", (e) => {
  state.text = e.target.value;
  renderWatchlist();
});

$("rating-filter").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.ratingFilter = btn.dataset.rating;
  $("rating-filter").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  renderWatchlist();
});

document.querySelectorAll(".watch-table th[data-sort]").forEach((th) => {
  th.tabIndex = 0;
  const sort = () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) state.sortDir *= -1;
    else { state.sortKey = key; state.sortDir = key === "symbol" ? 1 : -1; }
    renderWatchlist();
  };
  th.addEventListener("click", sort);
  th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sort(); } });
});

function toggleRow(row) {
  const symbol = row.dataset.symbol;
  if (state.openRows.has(symbol)) state.openRows.delete(symbol);
  else state.openRows.add(symbol);
  renderWatchlist();
  document.querySelector(`.stock-row[data-symbol="${CSS.escape(symbol)}"]`)?.focus();
}

$("watch-body").addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const row = e.target.closest(".stock-row");
  if (row) toggleRow(row);
});

$("watch-body").addEventListener("keydown", (e) => {
  const row = e.target.closest(".stock-row");
  if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleRow(row); }
});

$("cal-filter").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.calRegion = btn.dataset.region;
  $("cal-filter").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  renderCalendar();
});

$("news-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.newsTopic = btn.dataset.topic;
  renderNews();
});

init();
