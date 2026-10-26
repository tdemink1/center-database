// Daily Market Report: loads data/*.json written by scripts/generate_report.py and renders it.

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
