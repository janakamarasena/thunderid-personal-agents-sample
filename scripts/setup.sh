#!/usr/bin/env bash
# One-time setup: unpacks a ThunderID release into ./thunderid, sets it up for this demo and imports the bank's
# configuration.
#
#   scripts/setup.sh path/to/thunderid-gateway-<version>-<os>-<arch>.zip
#
# It creates .env if there is none, makes ThunderID trust the management API key from it (ThunderID keeps only the
# key's SHA-256 digest), gives ThunderID a certificate from mkcert so browsers and the agent trust it, runs
# ThunderID's own setup, then starts ThunderID once to import thunderid-config/bank-sample.yaml and stops it again.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ZIP="${1:-}"
[[ -n "$ZIP" && -f "$ZIP" ]] || fail "Usage: scripts/setup.sh path/to/thunderid-gateway-<version>-<os>-<arch>.zip"
[[ ! -e "$THUNDERID_DIR" ]] || fail "$THUNDERID_DIR already exists. Run scripts/stop.sh and delete it to set up again."
need unzip "Install unzip."
need openssl "Install OpenSSL."
need curl "Install curl."
need lsof "Install lsof."
need node "Install Node.js 22 or later."
need mkcert "Install mkcert (https://github.com/FiloSottile/mkcert) and run: mkcert -install"
listening 8090 && fail "Something already listens on port 8090. Stop it first (scripts/stop.sh stops this demo)."

"$ROOT/scripts/generate-secrets.sh"
load_env

say "Unpacking $(basename "$ZIP")"
tmp="$(mktemp -d)"
unzip -q "$ZIP" -d "$tmp"
mv "$tmp"/*/ "$THUNDERID_DIR"
rmdir "$tmp"
cd "$THUNDERID_DIR"

# ThunderID's scripts treat any socket on the port as a running server, including a browser's open connection
# to it. Count only a listening server.
perl -pi -e 's/lsof -ti tcp:\$port >\/dev\/null/lsof -ti tcp:\$port -sTCP:LISTEN >\/dev\/null/' setup.sh start.sh

say "Trusting this installation's management API key"
digest="$(printf '%s' "$THUNDERID_MANAGEMENT_API_KEY" | openssl dgst -sha256 | awk '{print $NF}')"
awk -v h="$digest" '
  /^    management_api_key_hash:/ { next }
  { print }
  /^  security:/ { print "    management_api_key_hash: \"" h "\"" }
' deployment.yaml >deployment.yaml.tmp && mv deployment.yaml.tmp deployment.yaml
grep -q "management_api_key_hash: \"$digest\"" deployment.yaml || fail "Could not set the key in deployment.yaml."

say "Issuing ThunderID's certificate with mkcert"
mkdir -p config/certs
mkcert -cert-file config/certs/server.cert -key-file config/certs/server.key localhost 127.0.0.1 ::1

say "Running ThunderID's setup"
mkdir -p "$LOG_DIR"
./setup.sh --admin-username "$ADMIN_USERNAME" --admin-password "$ADMIN_PASSWORD" >"$LOG_DIR/thunderid-setup.log" 2>&1 ||
  fail "ThunderID's setup failed. See $LOG_DIR/thunderid-setup.log."

say "Starting ThunderID to import the configuration"
nohup ./start.sh >"$LOG_DIR/thunderid.log" 2>&1 </dev/null &
wait_for "ThunderID" "$THUNDERID_URL/health/readiness" 60
"$ROOT/scripts/import-config.sh"
"$ROOT/scripts/stop.sh" >/dev/null

say "Setup complete"
echo "Start the demo with: scripts/start.sh"
