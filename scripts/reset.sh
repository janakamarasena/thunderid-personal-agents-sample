#!/usr/bin/env bash
# Resets the demo for another run without touching ThunderID: removes the agent's toolkit, keys and skill from
# your home folder, empties the sample inbox and reopens john's account at $5,000.
#
# Before running it, suspend and delete the assistant in the portal (Assistants), and lift any suspension in the
# admin dashboard. Afterwards, sign out of the portal and start a new agent session.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

pids="$(lsof -ti tcp:7070 -sTCP:LISTEN 2>/dev/null || true)"
[[ -n "$pids" ]] && kill $pids 2>/dev/null || true

rm -rf "$HOME/.sample-bank" "$HOME/.claude/skills/bank-assistant"
echo "Removed the agent's toolkit (~/.sample-bank) and skill (~/.claude/skills/bank-assistant)."

if curl -sf -o /dev/null -X DELETE http://127.0.0.1:8788/api/messages; then
  echo "Emptied the sample inbox."
else
  echo "The sample inbox is not running; nothing to empty."
fi

rm -f "$SAMPLE_DIR/backend/data/accounts.json"
echo "Reset the bank's accounts (john starts again at \$5,000)."
