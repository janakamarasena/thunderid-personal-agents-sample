// ThunderID's REST APIs, through the dev server's /thunderid proxy. The owner's self-service calls take the
// customer's token; the admin calls take the administrator's token, which carries the system scope.
import { config } from './config.js';

// An error message from ThunderID, whose messages are i18n objects with a default value.
function describeError(data, status) {
  const text = (message) => (typeof message === 'string' ? message : message?.defaultValue);
  const title = text(data?.message);
  const detail = text(data?.description);
  if (title || detail) {
    return [title, detail].filter(Boolean).join(': ');
  }
  return data?.error_description ?? data?.error ?? `Request failed (${status})`;
}

async function call(token, method, path, body) {
  const response = await fetch(`/thunderid${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) {
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(describeError(data, response.status));
  }
  return data;
}

// listAll reads every page of a list endpoint.
async function listAll(token, path, key) {
  const items = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const separator = path.includes('?') ? '&' : '?';
    const page = await call(token, 'GET', `${path}${separator}limit=${limit}&offset=${offset}`);
    items.push(...(page[key] ?? []));
    if ((page[key] ?? []).length < limit) {
      return items;
    }
  }
}

// --- the owner: self-service ---------------------------------------------------------------------

export const listMyAgents = (token) => listAll(token, '/users/me/agents', 'agents');
export const suspendMyAgent = (token, id) => call(token, 'POST', `/users/me/agents/${id}/suspend`);
export const unsuspendMyAgent = (token, id) => call(token, 'POST', `/users/me/agents/${id}/unsuspend`);
export const suspendAllMyAgents = (token) => call(token, 'POST', '/users/me/agents/suspend');
export const deleteMyAgent = (token, id) => call(token, 'DELETE', `/users/me/agents/${id}`);

// --- the administrator -----------------------------------------------------------------------------

export const listUsers = (token) => listAll(token, '/users', 'users');
export const getUser = (token, id) => call(token, 'GET', `/users/${id}`);
export const listAgents = (token) => listAll(token, '/agents?include=display', 'agents');
export const getUserUsages = (token, id) => call(token, 'GET', `/users/${id}/usages`);
export const deleteUser = (token, id) => call(token, 'DELETE', `/users/${id}`);
export const deleteAgent = (token, id) => call(token, 'DELETE', `/agents/${id}`);

// createStandardAgent registers an agent an administrator manages, as opposed to a personal agent its
// owner registers. Deleting its owner is refused while it exists.
export const createStandardAgent = (token, { ouId, ownerId, name }) => call(token, 'POST', '/agents', {
  ouId,
  type: 'default',
  owner: { id: ownerId },
  description: 'Created from the bank admin dashboard',
  attributes: { name },
});

// runFlow runs one of ThunderID's administration flows to its end. The flow takes the subject (a user or an
// agent ID) and, for a suspension, a note of at most 100 characters.
async function runFlow(token, flowId, subject, operatorNote) {
  const inputs = { subject };
  if (operatorNote) {
    inputs.operatorNote = operatorNote;
  }
  const result = await call(token, 'POST', '/flow/execute', { flowId, inputs });
  if (result.flowStatus !== 'COMPLETE') {
    throw new Error(result.error ? describeError(result.error, 200) : `The flow ended as ${result.flowStatus}`);
  }
  return result;
}

export const suspendUser = (token, id, note) => runFlow(token, config.flows.userSuspend, id, note);
export const unsuspendUser = (token, id) => runFlow(token, config.flows.userUnsuspend, id);
export const unlockUser = (token, id) => runFlow(token, config.flows.userUnlock, id);
export const suspendAgent = (token, id, note) => runFlow(token, config.flows.agentSuspend, id, note);
export const unsuspendAgent = (token, id) => runFlow(token, config.flows.agentUnsuspend, id);
export const unlockAgent = (token, id) => runFlow(token, config.flows.agentUnlock, id);
