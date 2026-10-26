// Shared helpers for the Center Database report pages (report.html, morning.html).

const $ = (id) => document.getElementById(id);

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

const REGION_NAMES = {
  USD: "U.S.", EUR: "Eurozone", GBP: "U.K.", JPY: "Japan", CNY: "China", CAD: "Canada",
  AUD: "Australia", NZD: "New Zealand", CHF: "Switzerland", All: "Global",
};
const MAJOR_REGIONS = new Set(["USD", "EUR", "GBP", "JPY", "CNY", "All"]);

function shortDate(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

async function loadJson(path) {
  // GitHub Pages caches files for 10 minutes; a unique query string skips that cache.
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
