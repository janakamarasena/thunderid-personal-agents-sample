#!/usr/bin/env bash
# Stops ThunderID, the Sample Bank and the agent toolkit's callback server: whatever listens on the demo's ports.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

for port in "${DEMO_PORTS[@]}"; do
  pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
done
for ((i = 0; i < 15; i++)); do
  busy=()
  for port in "${DEMO_PORTS[@]}"; do listening "$port" && busy+=("$port"); done
  [[ ${#busy[@]} -eq 0 ]] && { echo "Stopped."; exit 0; }
  sleep 1
done
fail "Still listening on: ${busy[*]}"
