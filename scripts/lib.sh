#!/usr/bin/env bash
# Shared by the scripts in this folder: where things are, the ports the demo uses, and small helpers.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
THUNDERID_DIR="$ROOT/thunderid"
SAMPLE_DIR="$ROOT/sample-bank"
CONFIG_FILE="$ROOT/thunderid-config/bank-sample.yaml"
ENV_FILE="$ROOT/.env"
LOG_DIR="$ROOT/logs"

THUNDERID_URL="https://localhost:8090"
# ThunderID, the bank API, the portal, the sample SMTP server and its inbox, and the agent toolkit's callback.
DEMO_PORTS=(8090 4000 5173 2525 8788 7070)

# The secret store name the config's sec: reference resolves (thunderid-config/bank-sample.yaml, Bank API client).
BANK_API_SECRET_NAME="APPLICATION__01990000BA4C70008000000000000003__CLIENT_SECRET"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

load_env() {
  [[ -f "$ENV_FILE" ]] || fail "$ENV_FILE is missing. Run scripts/generate-secrets.sh first."
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

# listening <port>: true when a server listens on the port. Only listeners count: a browser tab that still holds a
# connection to the port must not.
listening() { lsof -ti "tcp:$1" -sTCP:LISTEN >/dev/null 2>&1; }

# wait_for <name> <url> <seconds>: waits until the URL answers with a 2xx status.
wait_for() {
  local name="$1" url="$2" seconds="$3"
  for ((i = 0; i < seconds; i++)); do
    if curl -sf -o /dev/null --max-time 2 "$url"; then
      echo "$name is up."
      return 0
    fi
    sleep 1
  done
  fail "$name did not come up at $url within ${seconds}s. See $LOG_DIR."
}

need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is not installed. $2"; }
