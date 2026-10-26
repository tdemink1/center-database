# Daily Market Report: run instructions

This is the job the scheduled cloud routine runs every weekday after the U.S. close.
Edit this file to change what the routine does; the routine itself just says "follow ROUTINE.md".

Run every command from the repository root. The site is static: `report.html` reads `data/latest.json`.

Whenever you stop without publishing (closed market, blocked fetch), run `git stash --include-untracked` so the working tree is clean, and do not commit anything.

## 1. Regenerate the market data
Run `python3 scripts/generate_report.py` (standard library only, ~10s). It fetches U.S. and global indexes, rates,
commodities, FX, crypto, the 33-ticker watchlist (NVDA, TSLA, META, SHOP, GOOG, AMZN, MSFT, AMD, LNG, MSTR, JPM,
BRK.B, ASML, BFGIX, AVGO, LLY, CB, BAC, AAPL, ISRG, CRWD, SMH, CAT, PLTR, MA, COIN, XBI, WMB, MU, GEV, SPCX, CRWV,
IBIT) with analyst-consensus Buy/Hold/Sell ratings, ticker and macro headlines, and this week's economic calendar.
It writes `data/report-YYYY-MM-DD.json`, `data/latest.json` and `data/index.json`.

- If it prints many 429 errors or "Could not load: …", wait a minute and rerun once. Note any tickers still missing.
- If every price fails with a network or proxy error, the environment is blocking outbound access. Stop, commit
  nothing, and report which hosts failed.
- Check `date` in `data/latest.json` against today's date in America/New_York. If they differ (a U.S. market
  holiday), stop: commit nothing, and report that markets were closed.

## 2. Refresh the macro outlook
Update `data/macro_outlook.json`, keeping its exact JSON structure (`updated`, `note`, `centralBanks[]` with
bank/region/date/current/expectation/source, `keyReleases[]` with date/event/forecast/previous/source).

- Use web search to verify upcoming central-bank meetings (Fed/FOMC, ECB, Bank of Japan, Bank of England, plus
  others if market-moving) for roughly the next 8 weeks, current policy rates where known, and current market
  pricing (e.g. CME FedWatch probabilities).
- Update the key U.S. releases for the next ~2 weeks (GDP, CPI, PCE, jobs report, retail sales, ISM, etc.) with
  consensus forecasts and previous values where you can find them.
- Drop past events, set `updated` to today, and cite a real source URL for each entry. Never invent numbers; use
  null when a forecast isn't available. Validate the file with `python3 -m json.tool data/macro_outlook.json`.

## 3. Write the Market Brief
Read `data/latest.json` (highlights, markets, watchlist moves and ratings, macroNews, calendar) and research today's
session with web search: why markets moved, major macro data released today (actual vs. forecast), central-bank
news, and what is coming up. Write `data/commentary-YYYY-MM-DD.md` (today's date) using only these Markdown
features: `### ` headings, `- ` bullets, `**bold**`, plain paragraphs. Use these sections:

- `### The big picture`: the U.S. close in 3–4 sentences (S&P 500, Dow, Nasdaq, Russell 2000, VIX) and the day's theme.
- `### What's driving it`: 3–5 bolded-lead bullets on the drivers.
- `### Rates & macro`: Treasury yields, today's data releases with actual vs. forecast, Fed/policy news.
- `### Calendar & forecasts`: what is coming tomorrow and over the next week or two, with consensus forecasts and
  central-bank expectations, consistent with `macro_outlook.json`.
- `### Global`: Europe, Asia-Pacific, commodities & FX, crypto.
- `### Watchlist takeaways`: biggest watchlist movers and why, any rating or price-target changes, upcoming
  earnings for watchlist names.

Keep it about 350–500 words, factual and neutral, with no personalized investment advice. Use only figures from
`latest.json` or sources you checked, and paraphrase rather than quote news articles.

Then attach it: `python3 scripts/generate_report.py --commentary data/commentary-YYYY-MM-DD.md --commentary-only`

## 4. Verify, commit and push
Confirm `data/latest.json` has today's date, a non-empty `commentary`, `outlook.updated` equal to today, and
close to 33 watchlist entries. Then commit only the `data/` changes directly to `main` with the message
`Daily report YYYY-MM-DD` and push to `origin main` (no pull request: GitHub Pages serves `main`). If the push is
rejected, run `git pull --rebase origin main` and push again.

Finish with a 3–5 line summary: index moves, top watchlist movers, the next key macro event, and any problems
(missing tickers, failed feeds, unverifiable forecasts).
