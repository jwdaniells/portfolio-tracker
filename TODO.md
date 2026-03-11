# Daniells Portfolio Tracker — Project To Do List

Items are grouped by type. Add a date when an item is completed.

---

## 🔧 Enhancements

- [ ] **iOS Widget — cron trigger**: Set up cron-job.org to trigger the GitHub Actions fetch-prices workflow reliably (4× daily or targeted around market close). Replaces the unreliable GitHub scheduled trigger.
- [ ] **UI — Fetch Prices button**: Add a button to the portfolio tracker UI that triggers the GitHub Actions fetch-prices workflow on demand (via GitHub API dispatch), so prices can be refreshed without going to GitHub Actions tab.
- [ ] **Analysis page — Refresh button**: Add a "Refresh Analysis" button on the Analysis tab that re-runs the analysis generation (triggers `generate_docs.py` or equivalent) and reloads the results without a full page reload.
- [ ] **Analysis page — Extra content**: Review and expand the analysis information shown — e.g. sector breakdown, risk metrics, performance vs benchmark, drawdown stats. To be scoped further.

---

## 🐛 Bug Fixes / Known Issues

<!-- Nothing here yet -->

---

## ❓ Open Questions

<!-- Nothing here yet -->

---

## ✅ Completed

| Date | Item |
|------|------|
| 10 Mar 2026 | iOS widget — added crypto bucket row (total + day change) |
| 10 Mar 2026 | iOS widget — send-script GitHub Actions workflow (emails `ios_widget.js`) |
| 11 Mar 2026 | iOS widget — fix duplicate movers (aggregate by ticker across accounts) |
| 11 Mar 2026 | iOS widget — show 6 top movers instead of 4 |
| 11 Mar 2026 | iOS widget — move "vs date" label to sit under timestamp in header |
| 11 Mar 2026 | `fetch_prices.py` — roll `prevPrice` per-holding on new `priceDate` only (fixes zero-change movers) |
