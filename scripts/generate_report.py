#!/usr/bin/env python3
"""
Build the Center Database daily market report.

Pulls prices, analyst consensus and headlines from public Yahoo Finance,
CNBC, MarketWatch and Federal Reserve feeds (no API keys), and writes:

  data/report-YYYY-MM-DD.json   the day's snapshot
  data/latest.json              copy of the newest snapshot
  data/index.json               list of available report dates

Usage:
  python3 scripts/generate_report.py
  python3 scripts/generate_report.py --commentary brief.md   # attach a written market brief
  python3 scripts/generate_report.py --morning                # 11 AM morning-briefing snapshot

The morning snapshot writes data/morning-YYYY-MM-DD.json and data/morning-latest.json and
never touches the closing report files.

Standard library only, so it runs on the stock macOS python3.
"""

import argparse
import datetime as dt
import html
import http.cookiejar
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

WATCHLIST = [
    "NVDA", "TSLA", "META", "SHOP", "GOOG", "AMZN", "MSFT", "AMD", "LNG", "MSTR",
    "JPM", "BRK-B", "ASML", "BFGIX", "AVGO", "LLY", "CB", "BAC", "AAPL", "ISRG",
    "CRWD", "SMH", "CAT", "PLTR", "MA", "COIN", "XBI", "WMB", "MU", "GEV",
    "SPCX", "CRWV", "IBIT",
]

# Yahoo uses a dash for share classes; show the familiar dot form.
DISPLAY_SYMBOL = {"BRK-B": "BRK.B"}

MARKETS = {
    "us": [
        ("^GSPC", "S&P 500"), ("^DJI", "Dow Jones"), ("^IXIC", "Nasdaq Composite"),
        ("^NDX", "Nasdaq 100"), ("^RUT", "Russell 2000"), ("^VIX", "VIX"),
    ],
    "europe": [
        ("^STOXX50E", "Euro Stoxx 50"), ("^FTSE", "FTSE 100 (UK)"), ("^GDAXI", "DAX (Germany)"),
        ("^FCHI", "CAC 40 (France)"), ("FTSEMIB.MI", "FTSE MIB (Italy)"), ("^SSMI", "SMI (Switzerland)"),
    ],
    "asia": [
        ("^N225", "Nikkei 225 (Japan)"), ("^HSI", "Hang Seng (Hong Kong)"), ("000001.SS", "Shanghai Composite"),
        ("^KS11", "KOSPI (Korea)"), ("^TWII", "TAIEX (Taiwan)"), ("^BSESN", "Sensex (India)"),
        ("^AXJO", "ASX 200 (Australia)"),
    ],
    "americas": [
        ("^GSPTSE", "S&P/TSX (Canada)"), ("^BVSP", "Bovespa (Brazil)"), ("^MXX", "IPC (Mexico)"),
    ],
    "rates": [
        ("^IRX", "US 3-Month"), ("^FVX", "US 5-Year"), ("^TNX", "US 10-Year"), ("^TYX", "US 30-Year"),
    ],
    "commodities": [
        ("CL=F", "WTI Crude"), ("BZ=F", "Brent Crude"), ("NG=F", "Natural Gas"),
        ("GC=F", "Gold"), ("SI=F", "Silver"), ("HG=F", "Copper"),
    ],
    "fx": [
        ("DX-Y.NYB", "US Dollar Index"), ("EURUSD=X", "EUR/USD"), ("GBPUSD=X", "GBP/USD"),
        ("USDJPY=X", "USD/JPY"), ("USDCNY=X", "USD/CNY"), ("USDCAD=X", "USD/CAD"),
    ],
    "crypto": [
        ("BTC-USD", "Bitcoin"), ("ETH-USD", "Ether"),
    ],
}

# Shown only in the morning briefing, where overnight futures matter.
FUTURES = [
    ("ES=F", "S&P 500 futures"), ("NQ=F", "Nasdaq 100 futures"),
    ("YM=F", "Dow futures"), ("RTY=F", "Russell 2000 futures"),
]

MACRO_FEEDS = [
    ("Economy", "CNBC", "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
    ("Global", "CNBC", "https://www.cnbc.com/id/100727362/device/rss/rss.html"),
    ("Markets", "MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("Finance", "CNBC", "https://www.cnbc.com/id/10000664/device/rss/rss.html"),
    ("Federal Reserve", "Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"),
]

# Yahoo answers 429 to full browser user-agent strings but accepts this short one.
USER_AGENT = "Mozilla/5.0"

_cookies = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cookies))
_crumb = None
_crumb_lock = threading.Lock()


def fetch(url, timeout=20, attempts=3):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with _opener.open(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == attempts - 1:
                raise
            time.sleep(2 * (attempt + 1))


def fetch_json(url):
    return json.loads(fetch(url).decode("utf-8"))


def yahoo_crumb():
    """Yahoo's quoteSummary endpoint needs a session cookie plus a matching crumb."""
    global _crumb
    with _crumb_lock:  # Worker threads must share one cookie/crumb pair.
        if _crumb is None:
            try:
                fetch("https://fc.yahoo.com")
            except Exception:
                pass  # fc.yahoo.com answers 404 but still sets the cookie.
            _crumb = fetch("https://query1.finance.yahoo.com/v1/test/getcrumb").decode("utf-8").strip()
    return _crumb


# ---------------------------------------------------------------- prices

def quote_history(symbol):
    """One year of daily closes plus the live price, reduced to the changes the report shows."""
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        + urllib.parse.quote(symbol)
        + "?range=1y&interval=1d&includePrePost=false"
    )
    result = fetch_json(url)["chart"]["result"][0]
    meta = result["meta"]
    offset = meta.get("gmtoffset", 0)
    stamps = result.get("timestamp") or []
    closes = result["indicators"]["quote"][0].get("close") or []
    bars = [
        (dt.datetime.utcfromtimestamp(t + offset).date(), c)
        for t, c in zip(stamps, closes)
        if c is not None
    ]

    price = meta.get("regularMarketPrice")
    as_of = dt.datetime.utcfromtimestamp(meta.get("regularMarketTime", 0) + offset)
    today = as_of.date()
    # Mutual funds report a morning timestamp but the prior day's NAV, so anchor
    # on the newest priced bar when the quote's own day has no close yet.
    if bars and bars[-1][0] < today:
        today = bars[-1][0]
    if price is None and bars:
        price = bars[-1][1]

    def close_before(day):
        prior = [c for d, c in bars if d < day]
        return prior[-1] if prior else None

    def pct(base):
        if base in (None, 0) or price is None:
            return None
        return (price / base - 1) * 100

    prev = close_before(today)
    week = close_before(today - dt.timedelta(days=6))
    month = close_before(today - dt.timedelta(days=29))
    ytd_base = close_before(dt.date(today.year, 1, 1))

    return {
        "symbol": symbol,
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "type": meta.get("instrumentType"),
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName"),
        "price": price,
        "prevClose": prev,
        "change": None if prev is None or price is None else price - prev,
        "changePct": pct(prev),
        "change1w": pct(week),
        "change1m": pct(month),
        "changeYtd": pct(ytd_base),
        "close1w": week,
        "closeYtd": ytd_base,
        "high52": meta.get("fiftyTwoWeekHigh"),
        "low52": meta.get("fiftyTwoWeekLow"),
        "dayHigh": meta.get("regularMarketDayHigh"),
        "dayLow": meta.get("regularMarketDayLow"),
        "volume": meta.get("regularMarketVolume"),
        "asOf": as_of.isoformat(timespec="minutes"),
        "spark": [round(c, 4) for _, c in bars[-63:]],
    }


# ---------------------------------------------------------------- analysts

def rating_from_mean(mean):
    """Yahoo's consensus runs 1 (Strong Buy) to 5 (Sell); bucket it into Buy / Hold / Sell."""
    if mean is None:
        return None
    if mean <= 2.5:
        return "Buy"
    if mean < 3.5:
        return "Hold"
    return "Sell"


def analyst_consensus(symbol):
    url = (
        "https://query2.finance.yahoo.com/v10/finance/quoteSummary/"
        + urllib.parse.quote(symbol)
        + "?modules=financialData,recommendationTrend&crumb="
        + urllib.parse.quote(yahoo_crumb())
    )
    try:
        result = fetch_json(url)["quoteSummary"]["result"][0]
    except Exception:
        return {"rating": None}

    fin = result.get("financialData") or {}

    def raw(key):
        value = fin.get(key)
        return value.get("raw") if isinstance(value, dict) else None

    trend = (result.get("recommendationTrend") or {}).get("trend") or []
    current = next((t for t in trend if t.get("period") == "0m"), None)
    mean = raw("recommendationMean")
    count = raw("numberOfAnalystOpinions")
    if not count:
        mean = None

    return {
        "rating": rating_from_mean(mean),
        "consensusKey": fin.get("recommendationKey") if mean is not None else None,
        "consensusMean": mean,
        "analysts": count,
        "targetMean": raw("targetMeanPrice"),
        "targetHigh": raw("targetHighPrice"),
        "targetLow": raw("targetLowPrice"),
        "breakdown": None if not current else {
            k: current.get(k, 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")
        },
    }


# ---------------------------------------------------------------- news

def clean(text):
    text = html.unescape(text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_date(value):
    if not value:
        return None
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            parsed = dt.datetime.strptime(value.strip(), fmt)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.astimezone(dt.timezone.utc).isoformat(timespec="minutes")
        except ValueError:
            continue
    return None


def read_rss(url, source, limit):
    try:
        root = ET.fromstring(fetch(url))
    except Exception:
        return []
    items = []
    for item in root.iter("item"):
        title = clean(item.findtext("title"))
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        summary = clean(item.findtext("description"))
        if len(summary) > 280:
            summary = summary[:277].rsplit(" ", 1)[0] + "…"
        items.append({
            "title": title,
            "link": link,
            "source": source,
            "summary": summary,
            "published": parse_date(item.findtext("pubDate")),
        })
    items.sort(key=lambda i: i["published"] or "", reverse=True)
    return items[:limit]


def ticker_news(symbol):
    url = (
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s="
        + urllib.parse.quote(symbol)
        + "&region=US&lang=en-US"
    )
    return read_rss(url, "Yahoo Finance", 4)


# ---------------------------------------------------------------- economic calendar

CALENDAR_FEEDS = [
    "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    "https://nfs.faireconomy.media/ff_calendar_nextweek.json",  # Only published some days; 404 otherwise.
]


def economic_calendar():
    """This week's (and, when published, next week's) scheduled releases with forecast and previous values."""
    now = dt.datetime.now(dt.timezone.utc)
    events, seen = [], set()
    for url in CALENDAR_FEEDS:
        try:
            rows = json.loads(fetch(url, attempts=1).decode("utf-8"))
        except Exception:
            continue
        for row in rows:
            if row.get("impact") not in ("High", "Medium") or not row.get("date"):
                continue
            when = dt.datetime.fromisoformat(row["date"])
            key = (row.get("title"), row.get("country"), row["date"])
            if key in seen:
                continue
            seen.add(key)
            events.append({
                "time": when.isoformat(),
                "country": row.get("country"),
                "event": clean(row.get("title")),
                "impact": row["impact"],
                "forecast": row.get("forecast") or None,
                "previous": row.get("previous") or None,
                "released": when <= now,
            })
    events.sort(key=lambda e: e["time"])
    return events


def macro_outlook():
    path = DATA_DIR / "macro_outlook.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- assembly

def safe(fn, *args):
    try:
        return fn(*args)
    except Exception as exc:
        print(f"  ! {fn.__name__}{args}: {exc}", file=sys.stderr)
        return None


def build_stock(symbol):
    quote = safe(quote_history, symbol)
    if quote is None:
        return None
    fund_like = quote.get("type") in ("ETF", "MUTUALFUND")
    consensus = {"rating": None} if fund_like else (safe(analyst_consensus, symbol) or {"rating": None})
    if quote["price"] and consensus.get("targetMean"):
        consensus["upsidePct"] = (consensus["targetMean"] / quote["price"] - 1) * 100
    if consensus["rating"] is None:
        consensus["note"] = (
            "Fund — no sell-side analyst coverage" if fund_like else "Insufficient analyst coverage"
        )
    quote["symbol"] = DISPLAY_SYMBOL.get(symbol, symbol)
    quote["consensus"] = consensus
    quote["news"] = safe(ticker_news, symbol) or []
    return quote


def build_market(entry):
    symbol, label = entry
    quote = safe(quote_history, symbol)
    if quote is None:
        return None
    quote["label"] = label
    if symbol not in ("^GSPC", "^IXIC", "^DJI", "^RUT"):
        quote.pop("spark", None)  # Sparklines only for the headline U.S. indexes.
    return quote


def fmt_pct(value):
    return "n/a" if value is None else f"{value:+.2f}%"


def auto_highlights(markets, stocks):
    """Plain, data-driven bullets used when no written brief is attached."""
    lines = []
    us = {m["symbol"]: m for m in markets.get("us", [])}
    parts = [
        f"{us[s]['label']} {fmt_pct(us[s]['changePct'])}"
        for s in ("^GSPC", "^DJI", "^IXIC", "^RUT") if s in us
    ]
    if parts:
        lines.append("U.S. stocks: " + ", ".join(parts) + ".")
    if "^VIX" in us and us["^VIX"]["price"] is not None:
        lines.append(f"VIX at {us['^VIX']['price']:.2f} ({fmt_pct(us['^VIX']['changePct'])}).")

    for region, title in (("europe", "Europe"), ("asia", "Asia-Pacific")):
        rows = [m for m in markets.get(region, []) if m.get("changePct") is not None]
        if rows:
            up = sum(1 for m in rows if m["changePct"] > 0)
            best = max(rows, key=lambda m: m["changePct"])
            worst = min(rows, key=lambda m: m["changePct"])
            lines.append(
                f"{title}: {up} of {len(rows)} indexes higher; best {best['label']} {fmt_pct(best['changePct'])}, "
                f"weakest {worst['label']} {fmt_pct(worst['changePct'])}."
            )

    rates = {m["symbol"]: m for m in markets.get("rates", [])}
    if "^TNX" in rates and rates["^TNX"]["price"] is not None and rates["^TNX"]["change"] is not None:
        lines.append(
            f"10-year Treasury yield {rates['^TNX']['price']:.2f}% ({rates['^TNX']['change'] * 100:+.0f} bp)."
        )
    comm = {m["symbol"]: m for m in markets.get("commodities", [])}
    bits = [
        f"{comm[s]['label']} {fmt_pct(comm[s]['changePct'])}"
        for s in ("CL=F", "GC=F") if s in comm
    ]
    if bits:
        lines.append("Commodities: " + ", ".join(bits) + ".")

    moved = [s for s in stocks if s.get("changePct") is not None]
    if moved:
        moved.sort(key=lambda s: s["changePct"], reverse=True)
        top = ", ".join(f"{s['symbol']} {fmt_pct(s['changePct'])}" for s in moved[:3])
        bottom = ", ".join(f"{s['symbol']} {fmt_pct(s['changePct'])}" for s in moved[-3:][::-1])
        up = sum(1 for s in moved if s["changePct"] > 0)
        lines.append(f"Watchlist: {up} of {len(moved)} higher. Leaders: {top}. Laggards: {bottom}.")
    return lines


def write_index():
    def dates(prefix):
        return sorted((p.stem[len(prefix):] for p in DATA_DIR.glob(prefix + "*.json")
                       if p.stem != prefix + "latest"), reverse=True)
    index = {"dates": dates("report-"), "morning": dates("morning-")}
    (DATA_DIR / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")


def write_report(report, prefix="report-", latest="latest.json"):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(report, indent=1, ensure_ascii=False)
    (DATA_DIR / f"{prefix}{report['date']}.json").write_text(text, encoding="utf-8")
    (DATA_DIR / latest).write_text(text, encoding="utf-8")
    write_index()


def todays_events(calendar, date):
    """Calendar rows falling on `date` in New York time (the feed carries its own offsets)."""
    from zoneinfo import ZoneInfo
    new_york = ZoneInfo("America/New_York")
    return [e for e in calendar if dt.datetime.fromisoformat(e["time"]).astimezone(new_york).date().isoformat() == date]


def build_morning():
    """Lighter 11 AM snapshot: futures, overnight and early moves, watchlist movers, today's calendar, headlines."""
    def light_stock(symbol):
        quote = safe(quote_history, symbol)
        if quote is None:
            return None
        quote["symbol"] = DISPLAY_SYMBOL.get(symbol, symbol)
        quote["news"] = (safe(ticker_news, symbol) or [])[:3]
        quote.pop("spark", None)
        return quote

    with ThreadPoolExecutor(max_workers=8) as pool:
        groups = dict(MARKETS, futures=FUTURES)
        market_jobs = {k: [pool.submit(build_market, e) for e in v] for k, v in groups.items()}
        stock_jobs = [pool.submit(light_stock, s) for s in WATCHLIST]
        feed_jobs = [(topic, pool.submit(read_rss, url, source, 6)) for topic, source, url in MACRO_FEEDS]
        calendar_job = pool.submit(safe, economic_calendar)

        markets = {k: [r for r in (j.result() for j in v) if r] for k, v in market_jobs.items()}
        stocks = [r for r in (j.result() for j in stock_jobs) if r]
        news = [{"topic": topic, "items": job.result()} for topic, job in feed_jobs]
        calendar = calendar_job.result() or []

    spx = next((m for m in markets["us"] if m["symbol"] == "^GSPC"), None)
    date = spx["asOf"][:10] if spx else dt.date.today().isoformat()
    return {
        "date": date,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "kind": "morning",
        "commentary": None,
        "highlights": auto_highlights(markets, stocks),
        "markets": markets,
        "watchlist": stocks,
        "macroNews": news,
        "calendar": todays_events(calendar, date),
    }, stocks


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--commentary", type=Path, help="Markdown file with a written market brief to attach")
    parser.add_argument(
        "--commentary-only", action="store_true",
        help="Attach --commentary to the latest report without refetching data",
    )
    parser.add_argument(
        "--morning", action="store_true",
        help="Build the 11 AM morning-briefing snapshot instead of the closing report",
    )
    args = parser.parse_args()

    commentary = args.commentary.read_text(encoding="utf-8").strip() if args.commentary else None

    if args.morning:
        if args.commentary_only:
            if not commentary:
                parser.error("--commentary-only needs --commentary")
            report = json.loads((DATA_DIR / "morning-latest.json").read_text(encoding="utf-8"))
            report["commentary"] = commentary
            write_report(report, "morning-", "morning-latest.json")
            print(f"Attached briefing to morning snapshot for {report['date']}")
            return
        print("Fetching morning snapshot…")
        report, stocks = build_morning()
        report["commentary"] = commentary
        write_report(report, "morning-", "morning-latest.json")
        print(f"Wrote morning snapshot for {report['date']}: {len(stocks)} holdings, "
              f"{sum(len(v) for v in report['markets'].values())} market series, "
              f"{len(report['calendar'])} calendar events today.")
        return

    if args.commentary_only:
        if not commentary:
            parser.error("--commentary-only needs --commentary")
        report = json.loads((DATA_DIR / "latest.json").read_text(encoding="utf-8"))
        report["commentary"] = commentary
        report["outlook"] = safe(macro_outlook)
        write_report(report)
        print(f"Attached brief to report for {report['date']}")
        return

    print("Fetching markets, watchlist and news…")
    with ThreadPoolExecutor(max_workers=8) as pool:
        market_jobs = {k: [pool.submit(build_market, e) for e in v] for k, v in MARKETS.items()}
        stock_jobs = [pool.submit(build_stock, s) for s in WATCHLIST]
        feed_jobs = [(topic, pool.submit(read_rss, url, source, 8)) for topic, source, url in MACRO_FEEDS]
        calendar_job = pool.submit(safe, economic_calendar)

        markets = {k: [r for r in (j.result() for j in v) if r] for k, v in market_jobs.items()}
        stocks = [r for r in (j.result() for j in stock_jobs) if r]
        news = [{"topic": topic, "items": job.result()} for topic, job in feed_jobs]
        calendar = calendar_job.result() or []

    spx = next((m for m in markets["us"] if m["symbol"] == "^GSPC"), None)
    date = (spx["asOf"][:10] if spx else dt.date.today().isoformat())

    report = {
        "date": date,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "highlights": auto_highlights(markets, stocks),
        "commentary": commentary,
        "markets": markets,
        "macroNews": news,
        "calendar": calendar,
        "outlook": safe(macro_outlook),
        "watchlist": stocks,
        "ratingMethod": (
            "Rating maps Yahoo Finance's analyst consensus mean (1 = Strong Buy … 5 = Sell): "
            "≤ 2.5 Buy, 2.5–3.5 Hold, ≥ 3.5 Sell. Funds and ETFs have no sell-side coverage."
        ),
    }

    # Keep a brief already written for this date if this run did not supply one.
    existing = DATA_DIR / f"report-{date}.json"
    if commentary is None and existing.exists():
        try:
            report["commentary"] = json.loads(existing.read_text(encoding="utf-8")).get("commentary")
        except Exception:
            pass

    write_report(report)
    missing = sorted(set(DISPLAY_SYMBOL.get(s, s) for s in WATCHLIST) - {s["symbol"] for s in stocks})
    print(f"Wrote report for {date}: {len(stocks)} holdings, {sum(len(v) for v in markets.values())} market series.")
    if missing:
        print("Could not load: " + ", ".join(missing), file=sys.stderr)


if __name__ == "__main__":
    main()
