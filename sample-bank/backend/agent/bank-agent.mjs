#!/usr/bin/env node
// The bank assistant's toolkit, run by Claude Code acting as the owner's personal agent. The bank serves
// it at /agent/bank-agent.mjs, and the setup text the portal gives the owner installs it in ~/.sample-bank.
//
//   node bank-agent.mjs register --owner-email <email> [--name <text>] [--<attribute> <value> ...]
//                                                   starts registering this agent as the owner's personal agent:
//                                                   the agent runs ThunderID's registration flow, and returns
//                                                   once the bank has emailed the owner a link to approve.
//                                                   --name and any other flag (--model-provider, --model,
//                                                   --function, ...) describe the agent
//   node bank-agent.mjs finish-registration --assistant-identifier <identifier>
//                                                   saves the assistant identifier the bank's page showed the
//                                                   owner once they approved
//   node bank-agent.mjs login [--assistant-identifier <identifier>]
//                                                   owner signs in and consents; stores a token
//   node bank-agent.mjs whoami                      shows who the stored token acts for
//   node bank-agent.mjs token                       shows the stored access token, its decoded claims and
//                                                   a jwt.io link to it
//   node bank-agent.mjs account                     balance and recent transactions
//   node bank-agent.mjs transfer --to <name> --amount <n> [--note <text>]
//
// The agent authenticates to ThunderID with private_key_jwt. Its key pair is generated on first use
// in .keys next to this file, and its public key is served at https://localhost:7070/.well-known/jwks.json
// while `login` runs, which is the JWKS URI the agent registers with. ThunderID fetches it when the agent signs
// in, and only over https, so the server uses a certificate from mkcert (`mkcert -install` once; the certificate
// is created in .keys on first use), which ThunderID trusts through the system trust store.
import { createPrivateKey, generateKeyPairSync, randomBytes, createHash, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const KEY_DIR = join(here, '.keys');
const STATE_FILE = join(here, '.state', 'session.json');
const AGENT_FILE = join(here, '.state', 'agent.json');
// A registration waiting for the owner: `register` writes it, and `finish-registration` reads it.
const REGISTRATION_FILE = join(here, '.state', 'registration.json');
// How long `login` waits for the owner to sign in and approve.
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const config = {
  thunderidUrl: process.env.THUNDERID_URL ?? 'https://localhost:8090',
  bankApiUrl: process.env.BANK_API_URL ?? 'http://localhost:4000',
  bankResource: 'https://bank.sample.local/api',
  scope: 'openid bank:read bank:write',
  port: Number(process.env.BANK_AGENT_PORT ?? 7070),
  // ThunderID's local install uses a self-signed certificate. Only for local testing.
  allowSelfSigned: (process.env.ALLOW_SELF_SIGNED ?? 'true') === 'true',
  // Set to false to only print the sign-in URL.
  openBrowser: (process.env.BANK_AGENT_OPEN_BROWSER ?? 'true') === 'true',
  // The bank's application for registering assistants (thunderid-config/bank-sample.yaml): the agent runs its
  // registration flow.
  registrationAppId: process.env.BANK_REGISTRATION_APP_ID ?? '01990000-ba4c-7000-8000-000000000004',
};
const redirectUri = `https://localhost:${config.port}/callback`;

// The TLS certificate for the local callback and JWKS server, created with mkcert on first use.
function loadTlsCertificate() {
  const cert = join(KEY_DIR, 'localhost.pem');
  const key = join(KEY_DIR, 'localhost-key.pem');
  if (!existsSync(cert) || !existsSync(key)) {
    mkdirSync(KEY_DIR, { recursive: true });
    try {
      execFileSync('mkcert', ['-cert-file', cert, '-key-file', key, 'localhost'], { stdio: 'ignore' });
    } catch {
      fail('ThunderID only fetches a JWKS over https. Install mkcert, run `mkcert -install` once, and run the command again.');
    }
  }
  return { cert: readFileSync(cert), key: readFileSync(key) };
}

// --- small helpers ---------------------------------------------------------------

function openInBrowser(url) {
  if (config.openBrowser) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(opener, [url], () => {});
  }
}

// Stops the callback server so the command exits as soon as the owner is done. close() only refuses new
// connections, and the browser holds its own open (keep-alive, and ones it opened ahead of time), which would
// keep the command running for minutes. They are closed once the page has been sent.
function stopServer(server, res) {
  server.close();
  if (res && !res.writableFinished) {
    res.once('finish', () => server.closeAllConnections());
  } else {
    server.closeAllConnections();
  }
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The page the owner's browser lands on when the sign-in comes back to the agent. The agent serves it, so it
// carries no bank branding. It resolves once the page is sent.
function sendResultPage(res, { ok, title, message, status = 200 }) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  return new Promise((resolve) => res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg: #f5f6f8; --card: #fff; --text: #1f2328; --muted: #6a7178; --line: #e4e6ea;
    --good: #1a8a4a; --good-soft: #e3f4ea; --bad: #c0392b; --bad-soft: #fdecea;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: var(--text); background: var(--bg); }
  body { margin: 0; min-height: 100vh; display: flex; background: var(--bg); }
  main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
  .card { width: 100%; max-width: 440px; box-sizing: border-box; background: var(--card); border: 1px solid var(--line);
    border-radius: 12px; padding: 40px 32px; text-align: center; box-shadow: 0 8px 24px rgba(28, 35, 51, 0.06); }
  .icon { width: 64px; height: 64px; margin: 0 auto 20px; border-radius: 50%; display: grid; place-items: center;
    background: ${ok ? 'var(--good-soft)' : 'var(--bad-soft)'}; color: ${ok ? 'var(--good)' : 'var(--bad)'}; }
  h1 { margin: 0 0 10px; font-size: 1.35rem; }
  p { margin: 0; color: var(--muted); line-height: 1.5; }
  .next { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); font-size: 0.9rem; }
</style>
</head>
<body>
<main>
  <div class="card">
    <div class="icon">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${ok ? '<path d="M5 12.5l4.5 4.5L19 7.5"/>' : '<path d="M7 7l10 10M17 7L7 17"/>'}
      </svg>
    </div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <p class="next">You can close this tab and return to your assistant.</p>
  </div>
</main>
</body>
</html>`, resolve));
}

function loadAgent() {
  return existsSync(AGENT_FILE) ? JSON.parse(readFileSync(AGENT_FILE, 'utf8')) : {};
}

function saveAgent(agent) {
  mkdirSync(dirname(AGENT_FILE), { recursive: true });
  writeFileSync(AGENT_FILE, JSON.stringify({ ...loadAgent(), ...agent }, null, 2));
}

function saveRegistration(state) {
  mkdirSync(dirname(REGISTRATION_FILE), { recursive: true });
  writeFileSync(REGISTRATION_FILE, JSON.stringify(state, null, 2));
}

function loadRegistration() {
  try {
    return JSON.parse(readFileSync(REGISTRATION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function decodeJwt(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function request(url, { method = 'GET', headers = {}, body } = {}) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, { method, headers, rejectUnauthorized: !config.allowSelfSigned }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch {
          // keep the raw text
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

// --- the agent's key pair --------------------------------------------------------

function loadKeys() {
  const privatePath = join(KEY_DIR, 'private.pem');
  const jwksPath = join(KEY_DIR, 'jwks.json');
  if (!existsSync(privatePath)) {
    mkdirSync(KEY_DIR, { recursive: true });
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const kid = createHash('sha256').update(JSON.stringify(jwk)).digest('base64url').slice(0, 16);
    writeFileSync(privatePath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    writeFileSync(jwksPath, JSON.stringify({ keys: [{ ...jwk, kid, alg: 'ES256', use: 'sig' }] }, null, 2));
  }
  const jwks = JSON.parse(readFileSync(jwksPath, 'utf8'));
  return { privateKey: createPrivateKey(readFileSync(privatePath)), jwks, kid: jwks.keys[0].kid };
}

// clientAssertion signs the private_key_jwt assertion: issued by and about the agent, for ThunderID.
function clientAssertion(clientId, issuer, keys) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: keys.kid }));
  const payload = b64url(JSON.stringify({
    iss: clientId, sub: clientId, aud: issuer, iat: now, exp: now + 60, jti: randomBytes(16).toString('hex'),
  }));
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

// --- session ---------------------------------------------------------------------

function saveSession(session) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
}

function loadSession() {
  if (!existsSync(STATE_FILE)) {
    fail('The assistant has no access to the bank yet. Run: node bank-agent.mjs login');
  }
  const session = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  if (session.expiresAt <= Date.now()) {
    fail('The assistant\'s access has expired. Run login again so the owner can approve it.');
  }
  return session;
}

function describe(token) {
  const claims = decodeJwt(token);
  return {
    actingFor: claims.sub,
    agent: claims.act?.sub ?? null,
    permissions: (claims.scope ?? '').split(' ').filter((s) => s.startsWith('bank:')),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

// --- ThunderID -------------------------------------------------------------------

async function discover() {
  const discovery = await request(`${config.thunderidUrl}/.well-known/openid-configuration`);
  if (discovery.status !== 200) {
    fail(`ThunderID is not reachable at ${config.thunderidUrl}`);
  }
  return discovery.body;
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

// signInRequest is the authorization request that has the owner sign the agent in to act for them.
function signInRequest(authorizeUrl, clientId) {
  const { verifier, challenge } = pkce();
  const state = randomBytes(16).toString('hex');
  const url = `${authorizeUrl}?${new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: config.scope,
    resource: config.bankResource, state, code_challenge: challenge, code_challenge_method: 'S256',
  })}`;
  return { url, verifier, state };
}

// authorizeRefusal asks ThunderID to start a sign-in before the owner is sent there. When ThunderID answers with
// its error page instead of the sign-in, the callback would never come, so the error is returned to report now
// rather than waiting.
async function authorizeRefusal(authorizeUrl) {
  const probe = await request(authorizeUrl);
  const location = probe.headers?.location;
  if (!location) {
    return null;
  }
  const target = new URL(location, authorizeUrl);
  if (!target.pathname.endsWith('/error')) {
    return null;
  }
  return { code: target.searchParams.get('errorCode'), message: target.searchParams.get('errorMessage') ?? 'unknown error' };
}

// flowError reads an error from a flow response, whose messages are i18n objects with a default value.
function flowError(error, fallback) {
  const text = (message) => (typeof message === 'string' ? message : message?.defaultValue);
  return error ? `${text(error.message) ?? error.code}: ${text(error.description) ?? ''}` : fallback;
}

// startRegistrationFlow starts the self registration flow of the bank's assistant registration application, and
// answers its steps from values: how the agent describes itself, its redirect URI and JWKS URI, and the owner's
// email. A value that is not one of a field's options is left out. It returns once the flow asks for the token of
// the link it emailed the owner: the owner opens the link in ThunderID's sign-in pages, which finish the flow, so
// the agent's part ends there. A value the flow refuses, or a step that needs anything else, stops it.
async function startRegistrationFlow(values) {
  const execute = async (payload) => {
    const res = await request(`${config.thunderidUrl}/flow/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status !== 200) {
      throw new Error(flowError(res.body, `the registration flow refused the request (${res.status})`));
    }
    if (res.body.flowStatus === 'ERROR') {
      throw new Error(flowError(res.body.error, 'the registration flow failed'));
    }
    return res.body;
  };
  const answers = { ...values };
  const usable = (input) => Boolean(answers[input.identifier])
    && (!input.options?.length || input.options.includes(answers[input.identifier]));

  // Verbose, since the owner's pages in the gate are drawn from the flow's components, and a flow keeps the
  // setting it started with.
  let step = await execute({ applicationId: config.registrationAppId, flowType: 'REGISTRATION', verbose: true }).catch((err) => {
    throw new Error(`${err.message}. Is thunderid-config/bank-sample.yaml imported into ThunderID?`);
  });
  for (let i = 0; i < 4 && step.flowStatus !== 'COMPLETE'; i += 1) {
    if (step.error) {
      throw new Error(flowError(step.error));
    }
    const refused = step.data?.fieldErrors ?? [];
    if (refused.length) {
      const reasons = refused.map((field) => `${field.identifier} (${field.message})`);
      throw new Error(`the registration refused ${reasons.join(', ')}. Run register again with a valid value.`);
    }
    const inputs = step.data?.inputs ?? [];
    if (inputs.some((input) => input.identifier === 'token')) {
      return;
    }
    const missing = inputs.filter((input) => input.required && !usable(input));
    if (missing.length) {
      const needs = missing.map((input) => (input.options?.length
        ? `${input.identifier} (one of: ${input.options.join(', ')})` : input.identifier));
      throw new Error(`the registration needs ${needs.join(', ')}. Run register again with flags for them.`);
    }
    step = await execute({
      executionId: step.executionId,
      challengeToken: step.challengeToken,
      action: step.data?.actions?.[0]?.ref,
      inputs: Object.fromEntries(inputs.filter(usable).map((input) => [input.identifier, answers[input.identifier]])),
    });
  }
  throw new Error('the registration flow did not email the owner');
}

// --- commands --------------------------------------------------------------------

// Flags describe the agent. They never answer the owner's approval or set the agent's key: the toolkit supplies
// the owner's email (--owner-email), its redirect URI and its JWKS URI itself.
const NOT_ATTRIBUTES = new Set(['username', 'password', 'email', 'token', 'ownerEmail', 'publicKey']);

// register starts registering this agent as the owner's personal agent. The agent runs ThunderID's registration
// flow, through the bank's assistant registration application, with its details, and the flow emails the owner a
// link. The owner finishes the registration in ThunderID's sign-in pages: the link signs them in, which makes them
// the agent's owner, they approve, and the page shows the assistant identifier, which they paste back to the agent for
// finish-registration. The agent never sees the link or holds a token of the owner's. It supplies its redirect URI
// and JWKS URI, so the owner does not need to know them.
//
// --owner-email is the owner's email at the bank, which the link is sent to. The agent describes itself with the
// other flags: --name, and any other flag is an attribute of the agent type, named in kebab case
// (--model-provider anthropic is modelProvider). The flow asks for the agent type's attributes, and the agent
// answers with the flags of the same names.
async function register(args) {
  const ownerEmail = args['owner-email'];
  if (!ownerEmail) {
    fail('Give the owner\'s email at the bank with --owner-email: the bank emails them a link to approve the registration.');
  }
  // The JWKS URI the agent registers with is served when the agent signs in, from its key pair and certificate.
  // Anything missing for them is reported now, before the owner is emailed.
  loadKeys();
  loadTlsCertificate();
  const values = {
    ...Object.fromEntries(Object.entries(args)
      .map(([flag, value]) => [flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value])
      .filter(([attribute, value]) => attribute !== '_' && value && !NOT_ATTRIBUTES.has(attribute))),
    email: ownerEmail,
    redirectUris: redirectUri,
    jwksUri: `https://localhost:${config.port}/.well-known/jwks.json`,
  };

  await startRegistrationFlow(values).catch((err) => fail(err.message));
  saveRegistration({ ownerEmail, name: values.name });
  console.log(`The bank emailed ${ownerEmail} a link to approve the registration.`);
  console.log('Tell the owner to open it, click Sign in, approve, and paste here the assistant identifier the bank\'s page then shows. '
    + 'Then run: node bank-agent.mjs finish-registration --assistant-identifier <assistant identifier>');
}

// finishRegistration saves the assistant identifier the owner pasted from the bank's page, once ThunderID confirms it
// knows it. It is the agent's OAuth client ID. A new registration is a new agent, so the identifier and token of an
// earlier one are dropped. The agent
// still has no access to the bank: it gets it with login.
async function finishRegistration(args) {
  const clientId = args['assistant-identifier'];
  if (!clientId) {
    fail('Give the assistant identifier the bank\'s page showed the owner with --assistant-identifier.');
  }
  const { authorization_endpoint: authorizeUrl } = await discover();
  const refusal = await authorizeRefusal(signInRequest(authorizeUrl, clientId).url);
  if (refusal) {
    fail(`ThunderID does not know the assistant identifier ${clientId}. `
      + 'Check the assistant identifier the bank\'s page showed the owner, and run finish-registration again.');
  }
  const { name } = loadRegistration() ?? {};
  rmSync(AGENT_FILE, { force: true });
  rmSync(STATE_FILE, { force: true });
  saveAgent(name ? { clientId, name } : { clientId });
  rmSync(REGISTRATION_FILE, { force: true });
  console.log(`Registered as the owner's assistant${name ? ` "${name}"` : ''} (assistant identifier ${clientId}).`);
  console.log('The assistant has no access to the bank yet. When there is something to do there, run login: the owner approves what the assistant may do for them.');
}

// refuseIfUnavailable stops `login` before the owner is sent to sign in when ThunderID will not sign the agent
// in: it is suspended, or has been deleted. ThunderID refuses a suspended agent the same way whoever suspended it,
// so the message cannot say who: the owner, the bank, or a suspension of the owner's own account. The owner sees
// which in the bank portal.
async function refuseIfUnavailable(authorizeUrl) {
  const refusal = await authorizeRefusal(authorizeUrl);
  if (refusal?.code === 'unauthorized_client') {
    fail(`ThunderID will not sign this assistant in: ${refusal.message}. The assistant is suspended. The owner can sign `
      + 'in to the bank portal to see who suspended it, and resume it there if they did. Do not retry.');
  }
  if (refusal) {
    fail(`ThunderID refused the sign-in: ${refusal.message}. If the assistant was deleted, register it again with: node bank-agent.mjs register`);
  }
}

async function login(args) {
  const clientId = args['assistant-identifier'] ?? loadAgent().clientId;
  if (!clientId) {
    fail(loadRegistration()
      ? 'The registration is waiting for the owner to approve it from the bank\'s email and paste the assistant identifier the page shows. '
        + 'Then run: node bank-agent.mjs finish-registration --assistant-identifier <assistant identifier>'
      : 'This assistant is not registered yet. Run: node bank-agent.mjs register');
  }
  // Remembered so that a later `login` needs no assistant identifier, even if this one is not completed.
  saveAgent({ clientId });
  const keys = loadKeys();
  const { issuer, authorization_endpoint: authorizeUrl, token_endpoint: tokenUrl } = await discover();
  const { url, verifier, state } = signInRequest(authorizeUrl, clientId);

  await refuseIfUnavailable(url);

  const result = await new Promise((resolve) => {
    const finish = (outcome, res) => {
      clearTimeout(timer);
      stopServer(server, res);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ error: 'timed_out: the owner did not approve within 5 minutes. Run login again.' }),
      LOGIN_TIMEOUT_MS);
    const server = https.createServer(loadTlsCertificate(), async (req, res) => {
      const reqUrl = new URL(req.url, `https://localhost:${config.port}`);
      if (reqUrl.pathname === '/.well-known/jwks.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(keys.jwks));
        return;
      }
      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const params = reqUrl.searchParams;
      if (params.get('error') || params.get('state') !== state) {
        sendResultPage(res, { ok: false, status: 400, title: 'Sign-in not completed',
          message: 'Your assistant is not connected to the bank. Ask it to try again when you are ready.' });
        finish({ error: `${params.get('error') ?? 'state_mismatch'}: ${params.get('error_description') ?? ''}` }, res);
        return;
      }
      // The code exchange runs while the JWKS is still being served, since ThunderID fetches it now.
      const token = await request(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code: params.get('code'), redirect_uri: redirectUri,
          code_verifier: verifier, resource: config.bankResource, client_id: clientId,
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: clientAssertion(clientId, issuer, keys),
        }).toString(),
      });
      sendResultPage(res, token.status === 200
        ? { ok: true, title: 'Assistant connected',
          message: 'Your assistant can now work with your bank account on your behalf, within the permissions you approved.' }
        : { ok: false, title: 'Assistant not connected',
          message: 'Your assistant could not get access to the bank. Check your assistant for details.' });
      finish(token, res);
    });
    server.listen(config.port, () => {
      console.log('Ask the owner to sign in and approve in the browser:');
      console.log(url);
      openInBrowser(url);
    });
  });

  if (result.error) {
    fail(result.error);
  }
  if (result.status !== 200) {
    fail(`Token request refused (${result.status}): ${JSON.stringify(result.body)}`);
  }
  saveSession({
    clientId,
    accessToken: result.body.access_token,
    expiresAt: Date.now() + result.body.expires_in * 1000,
  });
  console.log('Connected. The assistant has its own access token and acts for its owner:');
  console.log(JSON.stringify(describe(result.body.access_token), null, 2));
}

function whoami() {
  console.log(JSON.stringify(describe(loadSession().accessToken), null, 2));
}

// token shows the access token for the demo: the raw token, its decoded header and claims, and a link
// that opens it in jwt.io. The token is in the link's fragment, which the browser does not send to jwt.io.
function token() {
  const { accessToken } = loadSession();
  const header = JSON.parse(Buffer.from(accessToken.split('.')[0], 'base64url').toString('utf8'));
  const jwtIo = `https://jwt.io/#token=${accessToken}`;
  console.log(JSON.stringify({ accessToken, header, claims: decodeJwt(accessToken), jwtIo }, null, 2));
}

async function callBank(method, path, payload) {
  const session = loadSession();
  const res = await request(`${config.bankApiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  console.log(JSON.stringify({ status: res.status, ...res.body }, null, 2));
  if (res.status !== 200) {
    process.exit(1);
  }
}

const args = parseArgs(process.argv.slice(2));
switch (args._[0]) {
  case 'register':
    await register(args);
    break;
  case 'finish-registration':
    await finishRegistration(args);
    break;
  case 'login':
    await login(args);
    break;
  case 'whoami':
    whoami();
    break;
  case 'token':
    token();
    break;
  case 'account':
    await callBank('GET', '/api/account');
    break;
  case 'transfer':
    await callBank('POST', '/api/transfer', { to: args.to, amount: Number(args.amount), note: args.note });
    break;
  default:
    console.log('Usage: node bank-agent.mjs <register --owner-email <email> [--name <text>] [--<attribute> <value> ...] | finish-registration --assistant-identifier <identifier> | login [--assistant-identifier <identifier>] | whoami | token | account | transfer --to <name> --amount <n> [--note <text>]>');
    process.exit(args._[0] ? 1 : 0);
}
