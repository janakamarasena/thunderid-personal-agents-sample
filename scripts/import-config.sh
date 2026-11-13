#!/usr/bin/env bash
# Imports thunderid-config/bank-sample.yaml into the running ThunderID with the management API key, after storing
# the bank API's client secret that the config refers to. Import once, at setup: importing again revokes the live
# tokens of the applications it updates.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
need node "Install Node.js 22 or later."

curl -sf -o /dev/null "$THUNDERID_URL/health/readiness" || fail "ThunderID is not running at $THUNDERID_URL."

say "Storing the bank API's client secret in ThunderID"
curl -sf -o /dev/null -X PUT "$THUNDERID_URL/secrets/$BANK_API_SECRET_NAME" \
  -H "API-Key: $THUNDERID_MANAGEMENT_API_KEY" -H 'Content-Type: application/json' \
  -d "{\"value\":\"$BANK_API_CLIENT_SECRET\"}" || fail "ThunderID refused the secret. Was it set up with this .env's key?"

say "Importing $(basename "$CONFIG_FILE")"
CONFIG_FILE="$CONFIG_FILE" node -e '
  const fs = require("fs");
  process.stdout.write(JSON.stringify({ content: fs.readFileSync(process.env.CONFIG_FILE, "utf8") }));
' | curl -s -X POST "$THUNDERID_URL/import" \
  -H "API-Key: $THUNDERID_MANAGEMENT_API_KEY" -H 'Content-Type: application/json' --data-binary @- |
  node -e '
    let body = "";
    process.stdin.on("data", (c) => (body += c)).on("end", () => {
      let result;
      try { result = JSON.parse(body); } catch { console.error(body); process.exit(1); }
      if (!result.summary) { console.error(JSON.stringify(result)); process.exit(1); }
      for (const r of result.results.filter((x) => x.status !== "success")) {
        console.error(`  ${r.resourceType} ${r.resourceName ?? r.resourceId}: ${r.code ?? ""} ${r.message ?? ""}`);
      }
      console.log(`Imported ${result.summary.imported} of ${result.summary.totalDocuments} resources.`);
      process.exit(result.summary.failed ? 1 : 0);
    });
  '
