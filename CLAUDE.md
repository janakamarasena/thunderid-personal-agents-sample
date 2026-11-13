# ThunderID personal agents sample: help the user set up and run the demo

This repository is a runnable demo: a Sample Bank whose customers connect their own AI agent, with identity from
ThunderID (register the agent, give it its own credentials, delegate access, revoke it). `README.md` explains the
story and what happens under the hood. This file is for you, Claude Code, when the user opens a session here to
set up, run, reset or troubleshoot the demo. Treat the sample's code as given unless the user asks to change it.

## The parts

| Part | Where | Notes |
| --- | --- | --- |
| ThunderID (standalone release) | https://localhost:8090, Console at https://localhost:8090/console | Unpacked into `./thunderid` by `scripts/setup.sh` |
| Bank portal and admin dashboard | http://localhost:5173, http://localhost:5173/admin | Vue dev server |
| Bank API | http://localhost:4000 | Checks every token, including introspection |
| Sample inbox | http://127.0.0.1:8788 (SMTP on 2525) | Catches the approval email |
| Agent toolkit callback | https://localhost:7070 | Runs only while the agent's `login` waits for the owner |

Accounts: john / john (also carol, bob) in the portal. `admin` with `ADMIN_PASSWORD` from `.env` (default `admin`)
for the admin dashboard and the ThunderID Console. Logs: `logs/thunderid.log`, `logs/sample-bank.log`,
`logs/thunderid-setup.log`.

## Set up (once)

1. Check the prerequisites and tell the user what is missing: macOS or Linux; `node` 22 or later; `curl`,
   `openssl`, `unzip`, `lsof`, `perl`; `mkcert`. If `mkcert` is installed but not found, Homebrew is probably not
   on this shell's `PATH` (try `/opt/homebrew/bin/mkcert`). `mkcert -install` needs the user's password, so ask
   the user to run it themselves; check it worked with `ls "$(mkcert -CAROOT)"`.
2. Get a ThunderID release archive, `thunderid-gateway-<version>-<os>-<arch>.zip`, version 2.0.0 or later. Ask
   the user for its path, or for permission to build it: clone https://github.com/thunder-id/thunderid outside this
   repository and run `make build` there (it needs Go, Node.js 24 and pnpm, and takes several minutes; run it in
   the background). The archive lands in its `target/dist/`. The sample was tested with main at `34efb15c`.
3. Run `scripts/setup.sh <path to the zip>`. It creates `.env` with random secrets, unpacks ThunderID, trusts the
   management API key, issues ThunderID's certificate with mkcert, runs ThunderID's setup and imports
   `thunderid-config/bank-sample.yaml`. Expect `Imported 17 of 17 resources.`

## Start, stop

- `scripts/start.sh` starts ThunderID and the Sample Bank in the background (the first run installs the
  Sample Bank's npm dependencies) and prints the URLs. It returns once everything answers.
- `scripts/stop.sh` stops everything the demo started.

## Run the demo

Point the user to "The demo, beat by beat" in `README.md`. The agent must run in a **separate** Claude Code
session in an empty folder outside this repository (for example `mkdir -p ~/bank-agent && cd ~/bank-agent &&
claude`), so it starts fresh and does not load this file. Don't play the agent in this session unless the user asks.

## Resetting: soft by default, hard only when asked

**When the user says "reset" (or "soft reset", "reset the demo", "start over"), do the soft reset. Do the hard
reset only when the user explicitly asks for a hard reset.**

**Soft reset** (between runs; ThunderID keeps its users and configuration):

1. Ask the user to do these in the browser first, since they need the user's own sign-in: in the portal
   (http://localhost:5173, as john), **Assistants** → **Suspend**, then **Delete** the assistant; in the admin
   dashboard, lift any suspension and unlock any locked user, and delete any standard agent they added.
2. Run `scripts/reset.sh`. It stops the toolkit's callback server, removes `~/.sample-bank` and
   `~/.claude/skills/bank-assistant`, empties the sample inbox, and reopens john's account at $5,000.
3. Tell the user to sign out of the portal and start a new agent session.

**Hard reset** (only on explicit request; it wipes ThunderID's data and secrets):

```bash
scripts/reset.sh
scripts/stop.sh
rm -rf thunderid .env logs
scripts/setup.sh <path to the zip>
scripts/start.sh
```

Before deleting, say what will be removed and confirm. After a hard reset every earlier agent is gone, and the
browser may still hold old portal sessions: sign out and in again.

If ThunderID is down or not responding, restart it with `scripts/stop.sh` and `scripts/start.sh` (no data is lost)
rather than resetting.

## Troubleshooting

- **The portal says the browser cannot call ThunderID, or the browser console shows a CORS error:** usually the
  certificate. Have the user open https://localhost:8090. A warning means mkcert's CA isn't trusted: they run
  `mkcert -install` and restart the browser. Otherwise run `scripts/import-config.sh` to restore the allowed
  origins.
- **Port 8090 "in use" with nothing listening:** a browser tab may hold a connection. Have the user close it.
  Never run `kill -9 $(lsof -ti tcp:8090)`: it also kills the browser (or this app). Use
  `lsof -ti tcp:8090 -sTCP:LISTEN` to find a real listener.
- **The agent's calls return `401 invalid_token`:** the token was revoked (suspend, cascade or a re-import) or
  expired; the agent signs in again with `login`. After a suspension, wait about 30 seconds before resuming and
  signing in, or the new token is revoked too.
- **After lifting a user's suspension they can't sign in:** ThunderID locks the account; unlock it in the admin
  dashboard.
- **`scripts/import-config.sh` revokes the live tokens of the applications it updates** (the portal's sessions).
  Run it only when needed, and tell the user to sign in again.

## Rules

- Never commit or print `.env`, and never commit `thunderid/` or `logs/` (all git-ignored).
- Don't change the sample's code or ThunderID's configuration unless the user asks; build new things as new files.
- Keep the user's machine tidy: what setup adds lives in this folder, except the mkcert CA (removed with
  `mkcert -uninstall`) and what the agent installs in `~/.sample-bank` and `~/.claude/skills/bank-assistant`
  (removed by `scripts/reset.sh`).
