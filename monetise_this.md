# Portfolio Tracker — Monetisation Plan & Task List
*Started: 11 March 2026*

---

## Product Vision

Sell a **packaged set of artefacts and templates** that any user can install and self-host. Claude drives the initial setup through a conversational Q&A, builds the personalised config invisibly, and then acts as an **ongoing conversational interface** to the tracker — for queries, updates, analysis, and adjustments over time.

**Key differentiators:**
- No SaaS subscription to a third-party platform — user owns their own instance
- Claude-native: setup and ongoing use is entirely conversational, no forms or dashboards to configure
- Retirement modelling depth (DB pensions, state pension, PCLS, tax) well beyond consumer tools
- Price updates via automated GitHub Actions — no manual effort after setup

---

## Revised Model: "Install & Ask Claude"

```
User purchases the package
        ↓
Receives: artefact bundle (JSX, Python scripts, GitHub Actions workflows,
          config schema, instructions)
        ↓
Opens Claude → pastes onboarding prompt → Claude interviews them
        ↓
Claude generates their personal user_config.json
        ↓
User commits config to their cloned repo → GitHub Pages deploys their tracker
        ↓
Ongoing: user asks Claude to update values, explain tabs, adjust goals,
         trigger fetches, interpret analysis — all via conversation
```

---

## Artefact Bundle (what gets sold)

- [ ] `portfolio_tracker.jsx` — parameterised, consuming `user_config.json`
- [ ] `retirement_planner.jsx` — parameterised
- [ ] `fetch_prices.py` — config-driven (tickers/symbols from config)
- [ ] `fetch_analysis.py` — config-driven
- [ ] GitHub Actions workflows (`fetch-prices.yml`, `fetch-analysis.yml`, `send-widget-script.yml`)
- [ ] `ios_widget.js` — Scriptable widget
- [ ] `user_config.json` — schema with documented fields (empty / example values)
- [ ] `SETUP.md` — step-by-step: fork repo, open Claude, paste onboarding prompt, commit config
- [ ] `ONBOARDING_PROMPT.md` — the Claude prompt the user pastes to start their guided setup interview

---

## Build Steps

### Phase 1 — Foundation (must do first)
- [ ] **Define `user_config.json` schema** — capture every hardcoded personal value across all files: names, DOBs, goal, baseline, contributions, retirement inputs, DB/state pensions, ticker map, scheme constants, rate assumptions
- [ ] **Parameterise `portfolio_tracker_v1.20.jsx`** — replace all hardcoded values with reads from `user_config.json` (loaded at startup alongside `price_history.json`)
- [ ] **Parameterise `retirement_planner.jsx`** — same treatment
- [ ] **Parameterise `fetch_prices.py`** — ticker/symbol map, account structure driven from config
- [ ] **Parameterise `fetch_analysis.py`** — same

### Phase 2 — Onboarding Experience
- [ ] **Write `ONBOARDING_PROMPT.md`** — the master Claude prompt that: introduces the product, asks the interview questions block by block (identity → accounts → retirement → goals), validates inputs, resolves fund ISINs/SEDOLs, and outputs a complete `user_config.json`
- [ ] **Test onboarding end-to-end** — run through the prompt as a new fictional user, verify the generated config produces a working tracker
- [ ] **Write `SETUP.md`** — clear step-by-step instructions: fork repo on GitHub, clone locally (or use Codespaces), open Claude, paste prompt, commit config, enable GitHub Pages, set up PAT for action buttons

### Phase 3 — Packaging & Distribution
- [ ] **Strip all John-specific data** from the template files — replace with empty/example values
- [ ] **Create a clean public GitHub template repo** (separate from personal tracker) — `portfolio-tracker-template`
- [ ] **Landing page** — simple one-pager explaining the product, what they get, price, buy button
- [ ] **Payment integration** — Lemon Squeezy (simplest for digital downloads) or Gumroad

### Phase 4 — Ongoing Claude Interface
- [ ] **Document "Claude commands"** — a reference card of prompts users can give Claude to manage their tracker (e.g. "update my pension value to £15,400", "what does my goal tab show?", "trigger a price refresh", "explain the analysis tab")
- [ ] **Test ongoing workflow** — simulate a user 3 months post-setup asking Claude to make changes

---

## Monetisation Options

| Model | Price | Notes |
|---|---|---|
| One-time artefact bundle | £49–79 | Buy once, self-host forever |
| Bundle + setup call (optional) | £99–149 | Zoom session to get them set up |
| IFA white-label (B2B) | £200–500 setup + £20/month | Adviser deploys for multiple clients |

**Subscription hook:** A "price update service" add-on where the GitHub Actions run under a managed account — so non-technical users don't need to manage PATs or GitHub at all.

---

## Open Questions

- [ ] What is the right price point for the base bundle?
- [ ] Do we want a free tier (lite version with fewer tabs) to drive top-of-funnel?
- [ ] Should the template repo be public (anyone can fork) or private (paid unlock)?
- [ ] Is the IFA B2B route worth pursuing early, or is it a phase 2 market?

---

## Completed

| Date | Item |
|------|------|
| 10 Mar 2026 | Initial product plan written (`portfolio_product_plan_v1.0.md`) |
| 11 Mar 2026 | Config externalisation added to main TODO as Phase 1 foundation |
| 11 Mar 2026 | This monetisation task list created |
