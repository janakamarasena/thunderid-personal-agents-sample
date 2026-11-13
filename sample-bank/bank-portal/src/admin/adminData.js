// What the dashboard shows: every user and agent, read from ThunderID's management API, and a log of what the
// administrator did and what it changed. Because a user's suspension or deletion reaches their personal
// agents, perform() reads the lists before and after an action and reports the difference.
import { ref } from 'vue';
import { listAgents, listUsers } from '../thunderid.js';
import { notifyError } from '../toasts.js';

export const users = ref([]);
export const agents = ref([]);
export const loading = ref(false);
export const loadError = ref('');
export const activity = ref([]);

export const PERSONAL = 'personal-assistant';
export const isPersonal = (agent) => agent.kind === PERSONAL;
export const userName = (user) => user?.attributes?.username ?? user?.attributes?.name ?? user?.id;
export const agentName = (agent) => agent.display ?? agent.attributes?.name ?? agent.id;

export async function refresh(token) {
  loading.value = true;
  try {
    const [nextUsers, nextAgents] = await Promise.all([listUsers(token), listAgents(token)]);
    users.value = nextUsers;
    agents.value = nextAgents;
    loadError.value = '';
  } catch (err) {
    loadError.value = err.message;
    notifyError('Could not load users and agents', err.message);
  } finally {
    loading.value = false;
  }
}

const holdNames = { organization: 'administrator', owner: 'owner', cascade: "owner's account" };

// describeStatus is a status as one short phrase: "Suspended by administrator + owner".
export function describeStatus(status) {
  const value = status?.value ?? 'ACTIVE';
  if (value === 'SUSPENDED') {
    const holds = (status.details?.appliedBy ?? []).map((hold) => holdNames[hold] ?? hold);
    return holds.length ? `Suspended by ${holds.join(' + ')}` : 'Suspended';
  }
  return value === 'LOCKED' ? 'Locked' : 'Active';
}

// describeChanges lists what differs between two reads: a status that changed, or an account or agent that is gone.
function describeChanges(before, after) {
  const lines = [];
  const compare = (kindOf, was, now, nameOf) => {
    const current = new Map(now.map((item) => [item.id, item]));
    for (const item of was) {
      const next = current.get(item.id);
      if (!next) {
        lines.push(`${kindOf(item)} ${nameOf(item)} was deleted.`);
      } else if (describeStatus(item.status) !== describeStatus(next.status)) {
        lines.push(`${kindOf(item)} ${nameOf(item)}: ${describeStatus(item.status)} → ${describeStatus(next.status)}.`);
      }
    }
  };
  compare(() => 'Account', before.users, after.users, userName);
  // Personal agents are the ones a cascade reaches, so the log names the kind.
  compare((agent) => (isPersonal(agent) ? 'Personal agent' : 'Agent'), before.agents, after.agents, agentName);
  return lines;
}

export function record(title, lines = [], tone = 'info') {
  activity.value = [{ id: `${Date.now()}-${Math.random()}`, time: new Date(), title, lines, tone }, ...activity.value].slice(0, 25);
}

export const clearActivity = () => { activity.value = []; };

// perform runs one action, reloads the lists, and records what changed. An error is recorded, shown as a
// notification, and thrown again, so the caller knows the action did not happen.
export async function perform(token, title, action) {
  const before = { users: [...users.value], agents: [...agents.value] };
  try {
    await action();
  } catch (err) {
    record(`${title}: refused`, [err.message], 'error');
    notifyError('The action failed', err.message);
    throw err;
  }
  await refresh(token);
  record(title, describeChanges(before, { users: users.value, agents: agents.value }));
}
