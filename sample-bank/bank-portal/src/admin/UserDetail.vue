<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useSession } from '../session.js';
import { agentName, agents, isPersonal, perform, refresh, userName } from './adminData.js';
import {
  createStandardAgent, deleteUser, getUser, getUserUsages, suspendUser, unlockUser, unsuspendUser,
} from '../thunderid.js';
import { notifyError } from '../toasts.js';
import AgentActions from './AgentActions.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import StatusBadge from '../components/StatusBadge.vue';

const props = defineProps({ id: { type: String, required: true } });
const { session } = useSession();
const router = useRouter();
const token = () => session.value.accessToken;

const user = ref(null);
const usages = ref(null);
const loadFailed = ref(false);
const dialog = ref(null);
const busy = ref(false);
const newAgentName = ref('');

const owned = computed(() => agents.value.filter((agent) => agent.owner?.id === props.id));
const personal = computed(() => owned.value.filter(isPersonal));
const standard = computed(() => owned.value.filter((agent) => !isPersonal(agent)));
const holds = computed(() => user.value?.status?.details?.appliedBy ?? []);
const locked = computed(() => user.value?.status?.value === 'LOCKED');
const attributes = computed(() => Object.entries(user.value?.attributes ?? {}));

// ThunderID's usages answer: what happens to each agent this user owns if the user is deleted.
const blocking = computed(() => (usages.value?.usages ?? []).filter((usage) => usage.behaviorOnDelete === 'restrict'));

async function load() {
  try {
    [user.value, usages.value] = await Promise.all([getUser(token(), props.id), getUserUsages(token(), props.id)]);
    loadFailed.value = false;
  } catch (err) {
    loadFailed.value = true;
    notifyError('Could not load the user', err.message);
  }
}

onMounted(async () => {
  await refresh(token());
  await load();
});
watch(() => props.id, load);

// perform shows a failure as a notification and in the activity log.
async function run(title, action, { reload = true } = {}) {
  busy.value = true;
  try {
    await perform(token(), title, action);
    return true;
  } catch {
    return false;
  } finally {
    busy.value = false;
    dialog.value = null;
    if (reload) await load().catch(() => {});
  }
}

const suspend = (note) => run(`Suspended account ${userName(user.value)}`, () => suspendUser(token(), props.id, note));
const lift = () => run(`Lifted the suspension of account ${userName(user.value)}`, () => unsuspendUser(token(), props.id));
const unlock = () => run(`Unlocked account ${userName(user.value)}`, () => unlockUser(token(), props.id));

async function remove() {
  if (await run(`Deleted account ${userName(user.value)}`, () => deleteUser(token(), props.id), { reload: false })) {
    router.replace('/admin/users');
  }
}

async function addStandardAgent() {
  const name = newAgentName.value.trim();
  if (!name) return;
  const ok = await run(`Added standard agent ${name}, owned by ${userName(user.value)}`,
    () => createStandardAgent(token(), { ouId: user.value.ouId, ownerId: props.id, name }));
  if (ok) newAgentName.value = '';
}
</script>

<template>
  <p><RouterLink to="/admin/users">← All users</RouterLink></p>
  <p v-if="!user" class="muted">{{ loadFailed ? 'This user could not be loaded.' : 'Loading…' }}</p>

  <template v-if="user">
    <section class="card">
      <div class="row">
        <div>
          <h2>{{ userName(user) }}</h2>
          <p><StatusBadge :status="user.status" /></p>
        </div>
        <div class="actions wrap">
          <button v-if="!holds.includes('organization')" class="secondary" :disabled="busy" @click="dialog = 'suspend'">Suspend account</button>
          <button v-else class="secondary" :disabled="busy" @click="lift">Lift suspension</button>
          <button v-if="locked" class="secondary" :disabled="busy" @click="unlock">Unlock</button>
          <button class="danger" :disabled="busy" @click="dialog = 'delete'">Delete account</button>
        </div>
      </div>
      <dl class="details">
        <dt>User ID</dt><dd><code>{{ user.id }}</code></dd>
        <dt>Type</dt><dd>{{ user.type }}</dd>
        <template v-for="[key, value] in attributes" :key="key">
          <dt>{{ key }}</dt><dd>{{ value }}</dd>
        </template>
      </dl>
      <p v-if="locked" class="hint">After a suspension is lifted, ThunderID keeps the account locked until an administrator unlocks it.</p>
    </section>

    <section class="card">
      <h2>What happens to their agents</h2>
      <ul class="rules">
        <li><strong>Suspend the account:</strong> the {{ personal.length }} personal agent(s) are suspended with it, by a hold of their own (<em>cascade</em>), and released when the account is. Agents the owner or an administrator suspended keep that hold. Other agents are not touched.</li>
        <li><strong>Delete the account:</strong> personal agents are deleted with it, after their tokens are revoked. Any other agent they own stops the deletion until it is removed or reassigned.</li>
      </ul>
      <template v-if="usages?.usages?.length">
        <h3>If this account is deleted</h3>
        <table>
          <thead><tr><th>Agent</th><th>Outcome</th></tr></thead>
          <tbody>
            <tr v-for="usage in usages.usages" :key="usage.id">
              <td>{{ usage.displayName }}</td>
              <td>
                <span v-if="usage.behaviorOnDelete === 'cascade'" class="pill">Deleted with the account</span>
                <span v-else-if="usage.behaviorOnDelete === 'restrict'" class="pill blocks">Blocks the deletion</span>
                <span v-else class="pill">{{ usage.behaviorOnDelete }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <p v-else class="hint">This user owns no agents.</p>
    </section>

    <section class="card">
      <h2>Agents they own</h2>
      <table v-if="owned.length">
        <thead><tr><th>Agent</th><th>Kind</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="agent in owned" :key="agent.id">
            <td>{{ agentName(agent) }}<div v-if="agent.clientId" class="hint">Client ID <code>{{ agent.clientId }}</code></div></td>
            <td><span :class="['pill', { agent: isPersonal(agent) }]">{{ isPersonal(agent) ? 'Personal' : 'Standard' }}</span></td>
            <td><StatusBadge :status="agent.status" /></td>
            <td><AgentActions :agent="agent" /></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">This user owns no agents.</p>
      <form class="inline-form" @submit.prevent="addStandardAgent">
        <input v-model="newAgentName" placeholder="Name of a standard agent" />
        <button class="secondary" :disabled="busy || !newAgentName.trim()">Add standard agent</button>
        <span class="hint">Personal agents are registered by their owner. A standard agent owned by this user stops the user's deletion, which shows the other side of the cascade.</span>
      </form>
    </section>

    <ConfirmDialog
      v-if="dialog === 'suspend'"
      :title="`Suspend ${userName(user)}?`"
      confirm-label="Suspend account"
      note-label="Reason (optional, shown to administrators)"
      :busy="busy"
      @confirm="suspend"
      @cancel="dialog = null"
    >
      Their tokens are revoked and they cannot sign in. Their {{ personal.length }} personal agent(s) are suspended with them.
    </ConfirmDialog>
    <ConfirmDialog
      v-if="dialog === 'delete'"
      :title="`Delete ${userName(user)}?`"
      confirm-label="Delete account"
      danger
      :busy="busy"
      @confirm="remove"
      @cancel="dialog = null"
    >
      <template v-if="blocking.length">
        ThunderID will refuse: {{ blocking.length }} agent(s) they own block the deletion
        ({{ blocking.map((usage) => usage.displayName).join(', ') }}).
      </template>
      <template v-else>
        The account is deleted permanently{{ personal.length ? `, and so are its ${personal.length} personal agent(s)` : '' }}.
      </template>
    </ConfirmDialog>
  </template>
</template>
