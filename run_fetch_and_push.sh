#!/bin/bash
# run_fetch_and_push.sh
# Called by launchd at 16:45 on weekdays.
# 1. Fetches latest prices
# 2. Pushes updated JSON to GitHub
# 3. Sends email notification (requires NOTIFY_EMAIL to be set below)

NOTIFY_EMAIL="jdaniells@yahoo.co.uk"

DIR="/Users/john.daniells/Library/CloudStorage/OneDrive-LondonStockExchangeGroup/Documents/Documentation/AI Docs/Daniells Portfolio Tracker"
LOG="/tmp/portfolio_fetch.log"
ERR_LOG="/tmp/portfolio_fetch_err.log"
TODAY=$(date +"%d %b %Y")

echo "=== Portfolio fetch started: $(date) ===" >> "$LOG"

# ── 1. Fetch prices ────────────────────────────────────────────────────────────
/usr/bin/python3 "$DIR/fetch_prices.py" >> "$LOG" 2>> "$ERR_LOG"
FETCH_STATUS=$?

if [ $FETCH_STATUS -ne 0 ]; then
  SUBJECT="⚠️ Portfolio Tracker — Fetch FAILED ($TODAY)"
  BODY="The price fetch script exited with an error. Check /tmp/portfolio_fetch_err.log for details."
  echo "$BODY. Emailing..." >> "$LOG"
  osascript -e "tell application \"Mail\" to send (make new outgoing message with properties {subject:\"$SUBJECT\", content:\"$BODY\", visible:false}) to make new to recipient at end of to recipients with properties {address:\"$NOTIFY_EMAIL\"}"
  exit 1
fi

# ── 2. Git push to GitHub ──────────────────────────────────────────────────────
cd "$DIR" || exit 1
git add price_history-2.json analysis.json >> "$LOG" 2>> "$ERR_LOG"
git commit -m "Auto-update prices $TODAY" >> "$LOG" 2>> "$ERR_LOG"
PUSH_OUTPUT=$(git push 2>&1)
PUSH_STATUS=$?
echo "$PUSH_OUTPUT" >> "$LOG"

# ── 3. Email notification ──────────────────────────────────────────────────────
if [ $PUSH_STATUS -eq 0 ]; then
  SUBJECT="✅ Portfolio Tracker updated ($TODAY)"
  # Extract total value from the log
  TOTAL=$(grep -o "Total: £[0-9,]*" "$LOG" | tail -1)
  BODY="Portfolio prices fetched and pushed to GitHub successfully.

${TOTAL:-Total value not extracted — check fetch log.}

View your tracker: https://jwdaniells.github.io/portfolio-tracker/

Fetch log: /tmp/portfolio_fetch.log"
else
  SUBJECT="⚠️ Portfolio Tracker — Push FAILED ($TODAY)"
  BODY="Prices were fetched but the GitHub push failed.

Push output:
$PUSH_OUTPUT

Check /tmp/portfolio_fetch_err.log for details."
fi

osascript << EOF
tell application "Mail"
  set msg to make new outgoing message with properties {subject:"$SUBJECT", content:"$BODY", visible:false}
  tell msg
    make new to recipient at end of to recipients with properties {address:"$NOTIFY_EMAIL"}
  end tell
  send msg
end tell
EOF

echo "=== Done: $(date) ===" >> "$LOG"
