// Verifies ThunderID access tokens: signature against the published JWKS, issuer, audience and expiry, and then
// asks ThunderID whether the token is still active (introspection). The signature alone cannot say so: a
// token stays well formed after it is revoked, for example when its owner or an administrator suspends the
// agent, or the account is suspended or deleted. It then reads the subject, the acting agent (act.sub) and
// the permissions (scope).
import { createPublicKey, verify } from 'node:crypto';
import https from 'node:https';
import http from 'node:http';

const config = {
  thunderidUrl: process.env.THUNDERID_URL ?? 'https://localhost:8090',
  audience: process.env.BANK_API_AUDIENCE ?? 'https://bank.sample.local/api',
  // ThunderID's local install uses a self-signed certificate. Only for local testing.
  allowSelfSigned: (process.env.ALLOW_SELF_SIGNED ?? 'true') === 'true',
  // The bank API's own client (thunderid-config/bank-sample.yaml). Introspection needs client authentication. The
  // secret comes from the repository's .env, which scripts/generate-secrets.sh creates.
  clientId: process.env.BANK_API_CLIENT_ID ?? 'bank-api',
  clientSecret: process.env.BANK_API_CLIENT_SECRET,
};
if (!config.clientSecret) {
  throw new Error('BANK_API_CLIENT_SECRET is not set. Run scripts/generate-secrets.sh, then start the bank with scripts/start.sh.');
}

function getJSON(url) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, { rejectUnauthorized: !config.allowSelfSigned }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} returned ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
  });
}

// postForm sends a form to ThunderID with the bank API's client credentials (client_secret_basic).
function postForm(url, form) {
  const basic = Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64');
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, {
      method: 'POST',
      rejectUnauthorized: !config.allowSelfSigned,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end(new URLSearchParams(form).toString());
  });
}

let discovery;
let keys = new Map();

async function loadDiscovery() {
  if (!discovery) {
    discovery = await getJSON(`${config.thunderidUrl}/.well-known/openid-configuration`);
  }
  return discovery;
}

async function refreshKeys() {
  const { jwks_uri: jwksUri } = await loadDiscovery();
  const jwks = await getJSON(jwksUri);
  keys = new Map(jwks.keys.map((jwk) => [jwk.kid, jwk]));
}

async function keyFor(kid) {
  if (!keys.has(kid)) {
    await refreshKeys();
  }
  const jwk = keys.get(kid);
  if (!jwk) {
    throw new AuthError(401, 'invalid_token', `unknown signing key ${kid}`);
  }
  return createPublicKey({ key: jwk, format: 'jwk' });
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// The node:crypto digest and padding for each JWS algorithm ThunderID may sign with.
function verifyOptions(alg, key) {
  switch (alg) {
    case 'RS256': case 'RS384': case 'RS512':
      return { digest: `sha${alg.slice(2)}`, key };
    case 'PS256': case 'PS384': case 'PS512':
      return { digest: `sha${alg.slice(2)}`, key: { key, padding: 6, saltLength: Number(alg.slice(2)) / 8 } };
    case 'ES256': case 'ES384': case 'ES512':
      return { digest: `sha${alg === 'ES512' ? 512 : alg.slice(2)}`, key: { key, dsaEncoding: 'ieee-p1363' } };
    case 'EdDSA':
      return { digest: null, key };
    default:
      throw new AuthError(401, 'invalid_token', `unsupported algorithm ${alg}`);
  }
}

// isActive asks ThunderID whether the token is still good. It is the one place a revocation shows: the token is
// inactive once it is revoked, or its subject or client is suspended or deleted. If ThunderID cannot answer, the
// bank refuses the request rather than trust a token it cannot check.
async function isActive(token) {
  const { introspection_endpoint: endpoint } = await loadDiscovery();
  let result;
  try {
    result = await postForm(endpoint, { token });
  } catch {
    throw new AuthError(503, 'temporarily_unavailable', 'the bank could not check the token with ThunderID');
  }
  if (result.status !== 200) {
    throw new AuthError(503, 'temporarily_unavailable', `ThunderID refused the bank's introspection request (${result.status})`);
  }
  return result.body.active === true;
}

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// verifyToken returns the caller described by a ThunderID access token, or throws AuthError.
export async function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AuthError(401, 'invalid_token', 'not a JWT');
  }
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);

  const { digest, key } = verifyOptions(header.alg, await keyFor(header.kid));
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!verify(digest, signed, key, Buffer.from(parts[2], 'base64url'))) {
    throw new AuthError(401, 'invalid_token', 'bad signature');
  }

  const { issuer } = await loadDiscovery();
  if (claims.iss !== issuer) {
    throw new AuthError(401, 'invalid_token', `unexpected issuer ${claims.iss}`);
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.audience)) {
    throw new AuthError(401, 'invalid_token', `token is not for ${config.audience}`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) {
    throw new AuthError(401, 'invalid_token', 'token expired');
  }
  if (!(await isActive(token))) {
    throw new AuthError(401, 'invalid_token', 'the token is no longer active: it was revoked, or its owner or assistant was suspended or deleted');
  }

  return {
    userId: claims.sub,
    agentId: claims.act?.sub ?? null,
    permissions: (claims.scope ?? '').split(' ').filter(Boolean),
    claims,
  };
}

// The two permissions the bank understands.
export const PERMISSION_READ = 'bank:read';
export const PERMISSION_WRITE = 'bank:write';

export function requirePermission(caller, permission) {
  if (!caller.permissions.includes(permission)) {
    throw new AuthError(403, 'insufficient_scope', `${permission} is required`);
  }
}
