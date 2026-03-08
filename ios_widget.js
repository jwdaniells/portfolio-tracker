// ============================================================
//  Daniells Portfolio Tracker — iOS Home Screen Widget
//  Size: Medium (2×4)
//  Requires: Scriptable (free, App Store)
//  Tap opens: https://jwdaniells.github.io/portfolio-tracker/
// ============================================================

const JSON_URL    = "https://raw.githubusercontent.com/jwdaniells/portfolio-tracker/main/price_history-2.json"
const TRACKER_URL = "https://jwdaniells.github.io/portfolio-tracker/"

// ── Colours (match the portfolio tracker UI) ──────────────────────────────────
const C = {
  bg:    new Color("#0d1b2a"),
  gold:  new Color("#c9a84c"),
  light: new Color("#e8dcc8"),
  muted: new Color("#6a7d8f"),
  green: new Color("#70AD47"),
  red:   new Color("#e07060"),
  dim:   new Color("#2a3d50"),
}

// ── Fetch JSON from GitHub ────────────────────────────────────────────────────
async function fetchData() {
  try {
    const req = new Request(JSON_URL)
    req.timeoutInterval = 10
    return await req.loadJSON()
  } catch (e) {
    return null
  }
}

// ── Calculate totals and top movers ──────────────────────────────────────────
function calc(d) {
  let total = 0, prevTotal = 0
  const movers = []

  for (const acc of d.accounts || []) {
    for (const h of acc.holdings || []) {
      let val, prevVal

      if (h.pensionTracking) {
        val      = h.manualValue      || 0
        prevVal  = h.prevManualValue  || val
      } else if (h.price != null && h.units != null) {
        val      = h.units * h.price
        prevVal  = h.prevPrice != null ? h.units * h.prevPrice : val
      } else {
        continue
      }

      total     += val
      prevTotal += prevVal

      const change = val - prevVal
      if (h.ticker && Math.abs(change) > 0.5) {
        movers.push({
          ticker: h.ticker,
          change,
          pct: prevVal > 0 ? change / prevVal : 0,
        })
      }
    }
  }

  movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))

  return {
    total,
    prevTotal,
    change: total - prevTotal,
    pct:    prevTotal > 0 ? (total - prevTotal) / prevTotal : 0,
    movers,
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1e6) return "£" + (n / 1e6).toFixed(3) + "m"
  if (a >= 1e3) return "£" + (n / 1e3).toFixed(1) + "k"
  return "£" + Math.round(n)
}

function fmtFull(n) {
  // Manual thousand-separator (safe in all JS engines)
  const abs = Math.round(Math.abs(n))
  const s   = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return (n >= 0 ? "+£" : "−£") + s
}

function fmtPct(p) {
  return (p >= 0 ? "+" : "") + (p * 100).toFixed(2) + "%"
}

function fmtTime(iso) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/London"
    })
  } catch (e) { return "—" }
}

// ── Build the widget ──────────────────────────────────────────────────────────
async function buildWidget(d) {
  const w = new ListWidget()
  w.backgroundColor = C.bg
  w.url = TRACKER_URL
  w.setPadding(12, 14, 10, 14)

  // Error state
  if (!d) {
    const t = w.addText("⚠️ Could not load portfolio data")
    t.textColor = C.red
    t.font = Font.systemFont(12)
    return w
  }

  const { total, change, pct, movers } = calc(d)
  const meta  = d.meta || {}
  const up    = change >= 0
  const col   = up ? C.green : C.red
  const arrow = up ? "▲" : "▼"

  // ── Header: label + fetch time ─────────────────────────────────────────────
  const hdr = w.addStack()
  hdr.layoutHorizontally()
  hdr.centerAlignContent()

  const lbl = hdr.addText("DANIELLS PORTFOLIO")
  lbl.textColor = C.muted
  lbl.font = Font.boldSystemFont(8)

  hdr.addSpacer()

  const ts = hdr.addText("as at " + fmtTime(meta.fetchTimestamp))
  ts.textColor = C.dim
  ts.font = Font.systemFont(8)

  w.addSpacer(4)

  // ── Total value (large) ────────────────────────────────────────────────────
  const tv = w.addText(fmt(total))
  tv.textColor = C.gold
  tv.font = Font.boldSystemFont(26)
  tv.minimumScaleFactor = 0.6

  w.addSpacer(2)

  // ── Change since last fetch day ────────────────────────────────────────────
  const cr = w.addStack()
  cr.layoutHorizontally()
  cr.centerAlignContent()

  const ct = cr.addText(arrow + " " + fmtFull(change) + "   " + fmtPct(pct))
  ct.textColor = col
  ct.font = Font.boldSystemFont(12)
  ct.minimumScaleFactor = 0.7

  cr.addSpacer()

  const cl = cr.addText("vs " + (meta.prevDateDisplay || "prev"))
  cl.textColor = C.muted
  cl.font = Font.systemFont(9)

  w.addSpacer(8)

  // ── Top movers label ───────────────────────────────────────────────────────
  const ml = w.addText("TOP MOVERS")
  ml.textColor = C.muted
  ml.font = Font.boldSystemFont(8)

  w.addSpacer(4)

  // ── Up to 3 movers ─────────────────────────────────────────────────────────
  const top = movers.slice(0, 3)

  if (top.length === 0) {
    const nm = w.addText("No movement data yet")
    nm.textColor = C.dim
    nm.font = Font.systemFont(10)
  }

  for (const m of top) {
    const row = w.addStack()
    row.layoutHorizontally()
    row.centerAlignContent()

    const mc = m.change >= 0 ? C.green : C.red
    const ma = m.change >= 0 ? "▲" : "▼"

    const tk = row.addText(m.ticker)
    tk.textColor = C.light
    tk.font = Font.boldSystemFont(11)

    row.addSpacer()

    const mv = row.addText(ma + " " + fmt(Math.abs(m.change)) + "   " + fmtPct(m.pct))
    mv.textColor = mc
    mv.font = Font.systemFont(11)
    mv.minimumScaleFactor = 0.8

    w.addSpacer(3)
  }

  w.addSpacer()

  // ── Footer: fetch date ─────────────────────────────────────────────────────
  const ft = w.addText(meta.fetchDateDisplay || "")
  ft.textColor = C.dim
  ft.font = Font.systemFont(8)

  return w
}

// ── Entry point ───────────────────────────────────────────────────────────────
const data   = await fetchData()
const widget = await buildWidget(data)

if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  // Preview when run inside the Scriptable app
  await widget.presentMedium()
}

Script.complete()
