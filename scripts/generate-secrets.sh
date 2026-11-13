#!/usr/bin/env bash
# Creates .env with this installation's secrets. It never overwrites an existing .env: delete it first to start
# over (and run scripts/setup.sh again, since ThunderID keeps the values it was set up with).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [[ -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE already exists; leaving it as it is."
  exit 0
fi
need openssl "Install OpenSSL."

umask 077
cat >"$ENV_FILE" <<EOF
# Created by scripts/generate-secrets.sh. Do not commit this file.

# The key the scripts import configuration into ThunderID with. ThunderID stores only its SHA-256 digest.
THUNDERID_MANAGEMENT_API_KEY=$(openssl rand -hex 32)

# The bank API's client secret, which it authenticates to ThunderID's introspection endpoint with.
BANK_API_CLIENT_SECRET=$(openssl rand -hex 24)

# ThunderID's administrator, who also signs in to the bank's admin dashboard. A local demo account.
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
EOF
echo "Created $ENV_FILE."
