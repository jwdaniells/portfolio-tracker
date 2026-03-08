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
  bg:        new Color("#0d1b2a"),
  gold:      new Color("#c9a84c"),
  light:     new Color("#e8dcc8"),
  muted:     new Color("#6a7d8f"),
  green:     new Color("#70AD47"),
  red:       new Color("#e07060"),
  dim:       new Color("#2a3d50"),
  greenFill: new Color("#70AD47", 0.15),
  redFill:   new Color("#e07060", 0.15),
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
        val     = h.manualValue     || 0
        prevVal = h.prevManualValue || val
      } else if (h.price != null && h.units != null) {
        val     = h.units * h.price
        prevVal = h.prevPrice != null ? h.units * h.prevPrice : val
      } else {
        continue
      }

      total     += val
      prevTotal += prevVal

      const change = val - prevVal
      if (h.ticker && Math.abs(change) > 0.5) {
        movers.push({ ticker: h.ticker, change, pct: prevVal > 0 ? change / prevVal : 0 })
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

// ── Sparkline (DrawContext) ───────────────────────────────────────────────────
function buildSparkline(history, w, h, up) {
  const dc = new DrawContext()
  dc.size = new Size(w, h)
  dc.opaque = false
  dc.respectScreenScale = true

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const pts = (history || []).filter(p => new Date(p.date) >= cutoff)
  if (pts.length < 2) return dc.getImage()

  const vals = pts.map(p => p.totalValue)
  const minV = Math.min(...vals)
  const maxV = Math.max(...vals)
  const range = maxV - minV || 1
  const pad = 2

  const toX = i => (i / (pts.length - 1)) * w
  const toY = v => h - pad - ((v - minV) / range) * (h - pad * 2)

  // Area fill
  const area = new Path()
  pts.forEach((p, i) => {
    const x = toX(i), y = toY(p.totalValue)
    i === 0 ? area.move(new Point(x, y)) : area.addLine(new Point(x, y))
  })
  area.addLine(new Point(w, h))
  area.addLine(new Point(0, h))
  area.closeSubpath()
  dc.setFillColor(up ? C.greenFill : C.redFill)
  dc.addPath(area)
  dc.fillPath()

  // Line
  const line = new Path()
  pts.forEach((p, i) => {
    const x = toX(i), y = toY(p.totalValue)
    i === 0 ? line.move(new Point(x, y)) : line.addLine(new Point(x, y))
  })
  dc.setStrokeColor(up ? C.green : C.red)
  dc.setLineWidth(1.5)
  dc.addPath(line)
  dc.strokePath()

  return dc.getImage()
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1e6) return "£" + (n / 1e6).toFixed(3) + "m"
  if (a >= 1e3) return "£" + (n / 1e3).toFixed(1) + "k"
  return "£" + Math.round(n)
}

function fmtFull(n) {
  const abs = Math.round(Math.abs(n))
  const s   = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return (n >= 0 ? "+£" : "−£") + s
}

function fmtPct(p) {
  return (p >= 0 ? "+" : "") + (p * 100).toFixed(2) + "%"
}

function fmtDateTime(iso) {
  if (!iso) return "—"
  try {
    const d    = new Date(iso)
    const date = d.toLocaleDateString("en-GB",    { day: "numeric", month: "short", timeZone: "Europe/London" })
    const time = d.toLocaleTimeString("en-GB",    { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
    return date + " · " + time
  } catch (e) { return "—" }
}

// ── Build the widget ──────────────────────────────────────────────────────────
async function buildWidget(d) {
  const widget = new ListWidget()
  widget.backgroundColor = C.bg
  widget.url = TRACKER_URL
  widget.setPadding(12, 14, 10, 14)

  // Error state
  if (!d) {
    const t = widget.addText("⚠️ Could not load portfolio data")
    t.textColor = C.red
    t.font = Font.systemFont(12)
    return widget
  }

  const { total, change, pct, movers } = calc(d)
  const meta  = d.meta || {}
  const up    = change >= 0
  const col   = up ? C.green : C.red
  const arrow = up ? "▲" : "▼"

  // ── Header: label + date·time ──────────────────────────────────────────────
  const hdr = widget.addStack()
  hdr.layoutHorizontally()
  hdr.centerAlignContent()

  const lbl = hdr.addText("DANIELLS PORTFOLIO")
  lbl.textColor = C.muted
  lbl.font = Font.boldSystemFont(8)

  hdr.addSpacer()

  const ts = hdr.addText(fmtDateTime(meta.fetchTimestamp))
  ts.textColor = C.dim
  ts.font = Font.systemFont(8)

  widget.addSpacer(3)

  // ── Total value ────────────────────────────────────────────────────────────
  const tv = widget.addText(fmt(total))
  tv.textColor = C.gold
  tv.font = Font.boldSystemFont(24)
  tv.minimumScaleFactor = 0.6

  widget.addSpacer(2)

  // ── Change row (green/red) ─────────────────────────────────────────────────
  const cr = widget.addStack()
  cr.layoutHorizontally()
  cr.centerAlignContent()

  const ct = cr.addText(arrow + " " + fmtFull(change) + "   " + fmtPct(pct))
  ct.textColor = col
  ct.font = Font.boldSystemFont(11)
  ct.minimumScaleFactor = 0.7

  cr.addSpacer()

  const cl = cr.addText("vs " + (meta.prevDateDisplay || "prev"))
  cl.textColor = C.muted
  cl.font = Font.systemFont(9)

  widget.addSpacer(5)

  // ── Sparkline (last 30 days) ───────────────────────────────────────────────
  const spark = buildSparkline(d.history || [], 300, 30, up)
  const sparkEl = widget.addImage(spark)
  sparkEl.imageSize = new Size(300, 30)
  sparkEl.resizable = false

  widget.addSpacer(4)

  // ── Top movers (4 in a 2×2 grid) ──────────────────────────────────────────
  const ml = widget.addText("TOP MOVERS")
  ml.textColor = C.muted
  ml.font = Font.boldSystemFont(8)

  widget.addSpacer(3)

  const top = movers.slice(0, 4)
  if (top.length === 0) {
    const nm = widget.addText("No movement data yet")
    nm.textColor = C.dim
    nm.font = Font.systemFont(10)
  }

  // Render in pairs (2 per row)
  for (let i = 0; i < top.length; i += 2) {
    const row = widget.addStack()
    row.layoutHorizontally()
    row.centerAlignContent()

    for (let j = i; j < Math.min(i + 2, top.length); j++) {
      const m  = top[j]
      const mc = m.change >= 0 ? C.green : C.red
      const ma = m.change >= 0 ? "▲" : "▼"

      const cell = row.addStack()
      cell.layoutHorizontally()
      cell.centerAlignContent()

      const tk = cell.addText(m.ticker)
      tk.textColor = C.light
      tk.font = Font.boldSystemFont(9)

      cell.addSpacer(3)

      const mv = cell.addText(ma + " " + fmt(Math.abs(m.change)) + " " + fmtPct(m.pct))
      mv.textColor = mc
      mv.font = Font.systemFont(9)
      mv.minimumScaleFactor = 0.7

      if (j === i && top.length > i + 1) row.addSpacer() // spacer between the two cells
    }

    widget.addSpacer(3)
  }

  widget.addSpacer()

  return widget
}

// ── Entry point ───────────────────────────────────────────────────────────────
const data   = await fetchData()
const widget = await buildWidget(data)

if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentMedium()
}

Script.complete()
