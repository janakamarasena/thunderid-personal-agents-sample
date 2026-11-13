// The sample bank's API. Every request needs a ThunderID access token for the bank API:
//   GET  /api/account   bank:read   balance and recent transactions
//   POST /api/transfer  bank:write  move money out of the account
// It also serves the agent toolkit and its skill, which an owner's agent downloads during setup:
//   GET  /agent/bank-agent.mjs, GET /agent/SKILL.md
// A token issued to a personal agent carries the owner as sub and the agent as act.sub, so the bank
// knows the owner's account is being used through an agent and records it on each transaction.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { AuthError, PERMISSION_READ, PERMISSION_WRITE, requirePermission, verifyToken } from './auth.mjs';
import { accountFor, transfer } from './store.mjs';

const port = Number(process.env.PORT ?? 4000);

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new AuthError(400, 'invalid_request', 'body is not JSON'));
      }
    });
  });
}

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) {
    throw new AuthError(401, 'invalid_token', 'a bearer token is required');
  }
  return verifyToken(header.slice('Bearer '.length));
}

function callerSummary(caller) {
  return { userId: caller.userId, agentId: caller.agentId, permissions: caller.permissions };
}

const agentFiles = {
  '/agent/bank-agent.mjs': { file: new URL('./agent/bank-agent.mjs', import.meta.url), type: 'text/javascript' },
  '/agent/SKILL.md': { file: new URL('./agent/SKILL.md', import.meta.url), type: 'text/markdown' },
};

const routes = {
  'GET /api/health': async () => ({ status: 200, body: { status: 'ok' } }),

  'GET /api/account': async (req) => {
    const caller = await authenticate(req);
    requirePermission(caller, PERMISSION_READ);
    return { status: 200, body: { caller: callerSummary(caller), account: accountFor(caller.userId) } };
  },

  'POST /api/transfer': async (req) => {
    const caller = await authenticate(req);
    requirePermission(caller, PERMISSION_WRITE);
    const { amount, to, note } = await readJSON(req);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      throw new AuthError(400, 'invalid_request', 'amount must be a positive number');
    }
    if (!to) {
      throw new AuthError(400, 'invalid_request', 'to is required');
    }
    const result = transfer(caller.userId, { amount: value, to, note, agentId: caller.agentId });
    if (result.error) {
      throw new AuthError(400, 'invalid_request', result.error);
    }
    return { status: 200, body: { caller: callerSummary(caller), account: result.account } };
  },
};

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const agentFile = req.method === 'GET' && agentFiles[path];
  if (agentFile) {
    res.writeHead(200, { 'Content-Type': `${agentFile.type}; charset=utf-8` });
    res.end(readFileSync(agentFile.file));
    return;
  }
  const route = routes[`${req.method} ${path}`];
  if (!route) {
    send(res, 404, { error: 'not_found' });
    return;
  }
  try {
    const { status, body } = await route(req);
    send(res, status, body);
  } catch (err) {
    if (err instanceof AuthError) {
      console.log(`${req.method} ${path} -> ${err.status} ${err.code}: ${err.message}`);
      send(res, err.status, { error: err.code, error_description: err.message });
      return;
    }
    console.error(err);
    send(res, 500, { error: 'server_error', error_description: err.message });
  }
});

server.listen(port, () => {
  console.log(`Bank API listening on http://localhost:${port}`);
});
