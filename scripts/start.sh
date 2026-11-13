#!/usr/bin/env bash
# Starts ThunderID and the Sample Bank (bank API, portal and sample email inbox) in the background. Logs go to
# ./logs. Stop them with scripts/stop.sh.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
[[ -d "$THUNDERID_DIR" ]] || fail "ThunderID is not set up. Run scripts/setup.sh first."
need node "Install Node.js 22 or later."
mkdir -p "$LOG_DIR"

if listening 8090; then
  echo "ThunderID is already running."
else
  say "Starting ThunderID"
  # The redirections sit on the subshell, so nothing in the background keeps this script's output open.
  (cd "$THUNDERID_DIR" && exec nohup ./start.sh) >"$LOG_DIR/thunderid.log" 2>&1 </dev/null &
fi
wait_for "ThunderID" "$THUNDERID_URL/health/readiness" 60

if listening 4000 || listening 5173 || listening 8788; then
  echo "The Sample Bank is already running."
else
  say "Starting the Sample Bank (installs its dependencies on the first run)"
  (cd "$SAMPLE_DIR" && exec nohup node start.mjs) >"$LOG_DIR/sample-bank.log" 2>&1 </dev/null &
fi
wait_for "The bank API" "http://localhost:4000/api/health" 300
wait_for "The portal" "http://localhost:5173/" 300
wait_for "The email inbox" "http://127.0.0.1:8788/health" 300

say "The demo is running"
cat <<EOF
  Bank portal          http://localhost:5173        john / john  (also carol, bob)
  Bank admin dashboard http://localhost:5173/admin  $ADMIN_USERNAME / (ADMIN_PASSWORD in .env)
  Email inbox          http://127.0.0.1:8788
  ThunderID Console    $THUNDERID_URL/console  $ADMIN_USERNAME / (ADMIN_PASSWORD in .env)
  Logs                 $LOG_DIR
  Stop                 scripts/stop.sh
EOF
