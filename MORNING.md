# Morning Briefing: run instructions

This is the job the 11:00 AM ET cloud routine runs every weekday. It publishes a short briefing on overnight and
early-market news to `morning.html`. Edit this file to change what the routine does.

Run every command from the repository root. Never touch `data/latest.json` or `data/report-*.json`; those belong
to the closing report (`ROUTINE.md`).

## 1. Take the morning snapshot
Run `python3 scripts/generate_report.py --morning`. It writes `data/morning-YYYY-MM-DD.json`,
`data/morning-latest.json` and updates `data/index.json` with U.S. index futures, U.S. indexes since the open,
Europe and Asia-Pacific, Treasury yields, commodities, FX, crypto, the 33-ticker watchlist with its latest
headlines, today's economic calendar and current macro headlines.

- If it prints many 429 errors or "Could not load: …", wait a minute and rerun once.
- If every price fails with a network or proxy error, stop, commit nothing, and report which hosts failed.
- Check `date` in `data/morning-latest.json` against today's date in America/New_York. If they differ
  (a U.S. market holiday), stop: commit nothing, and report that markets are closed today.

## 2. Research the morning
Read `data/morning-latest.json` (highlights, markets, watchlist moves and headlines, calendar, macroNews), then use
web search for:
- Overnight: the Asia-Pacific session, Europe so far, geopolitics, and major company news since yesterday's close
  (earnings after the bell and before the open, guidance, deals, analyst upgrades/downgrades).
- This morning's economic data: actual vs. forecast for anything released at 8:30 or 10:00 ET.
- How U.S. stocks opened and where they stand now, plus Treasury yields, oil, gold, the dollar and bitcoin.
- Why the biggest watchlist movers are moving.
- What is still ahead today: Fed speakers, Treasury auctions, data, central-bank decisions, after-close earnings.

## 3. Write the briefing
Write `data/morning-YYYY-MM-DD.md` (today's date). Keep it short and scannable: **about 200–300 words**, using only
`### ` headings, `- ` bullets, `**bold**` and plain sentences, in these sections:

- `### Overnight`: 2–4 bullets on what happened while U.S. markets were closed.
- `### Early trading`: 2–3 sentences on the open and the market as of now (S&P 500, Nasdaq, Dow, 10-year yield, oil).
- `### Data & events`: this morning's releases with actual vs. forecast, and what is still ahead today.
- `### Watchlist movers`: the 3–5 biggest watchlist moves with the reason for each.

Be factual and neutral, with no personalized investment advice. Use only figures from the snapshot or sources you
checked, and paraphrase rather than quote news articles.

Attach it: `python3 scripts/generate_report.py --morning --commentary data/morning-YYYY-MM-DD.md --commentary-only`

## 4. Verify, commit and push
Confirm `data/morning-latest.json` has today's date, a non-empty `commentary`, and close to 33 watchlist entries,
and that `git status` shows no changes to `data/latest.json` or `data/report-*.json`. Commit only the morning files
and `data/index.json` directly to `main` with the message `Morning briefing YYYY-MM-DD` and push to `origin main`
(no pull request). If the push is rejected, run `git pull --rebase origin main` and push again.

Finish with a 2–3 line summary: the market's tone this morning, the top watchlist mover, and any problems.
