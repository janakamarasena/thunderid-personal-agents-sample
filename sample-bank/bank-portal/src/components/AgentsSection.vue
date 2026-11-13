<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { connectPromptText, setupTextFor, startRegistration, submitRegistration } from '../api.js';
import {
  deleteMyAgent, listMyAgents, suspendAllMyAgents, suspendMyAgent, unsuspendMyAgent,
} from '../thunderid.js';
import { notifyError, notifySuccess } from '../toasts.js';
import ConfirmDialog from './ConfirmDialog.vue';
import StatusBadge from './StatusBadge.vue';

const props = defineProps({
  session: { type: Object, required: true },
  user: { type: Object, required: true },
});

// The owner's personal agents, read from ThunderID's self-service API (GET /users/me/agents).
const agents = ref([]);
const loaded = ref(false);
// Failures show as a notification; the list keeps a line saying it could not be loaded.
const listFailed = ref(false);
const confirming = ref(null);
const acting = ref(false);
const token = () => props.session.accessToken;

async function loadAgents() {
  try {
    agents.value = await listMyAgents(token());
    listFailed.value = false;
  } catch (err) {
    listFailed.value = true;
    notifyError('Could not load your assistants', err.message);
  } finally {
    loaded.value = true;
  }
}

const heldByOwner = (agent) => (agent.status?.details?.appliedBy ?? []).includes('owner');
const heldByBank = (agent) => (agent.status?.details?.appliedBy ?? []).includes('organization');
const anySuspendable = computed(() => agents.value.some((agent) => !heldByOwner(agent)));

// run does one of the owner's actions, then reloads the list so the status shown is ThunderID's. The outcome
// shows as a notification: `done` ({ title, message }, or a function of the result that returns one) when it
// worked, titled `failure` when it did not.
async function run(action, done, failure) {
  acting.value = true;
  try {
    const result = await action();
    const { title, message } = typeof done === 'function' ? done(result) : done;
    notifySuccess(title, message);
    await loadAgents();
  } catch (err) {
    notifyError(failure, err.message);
  } finally {
    acting.value = false;
    confirming.value = null;
  }
}

const suspendOne = (agent) => run(() => suspendMyAgent(token(), agent.id), {
  title: `${agent.attributes.name} is suspended`,
  message: 'Its tokens were revoked, and it gets no new ones until you resume it.',
}, `Could not suspend ${agent.attributes.name}`);
const resumeOne = (agent) => run(() => unsuspendMyAgent(token(), agent.id), heldByBank(agent)
  ? {
    title: `You lifted your suspension of ${agent.attributes.name}`,
    message: "The bank's suspension stays until an administrator lifts it.",
  }
  : { title: `${agent.attributes.name} is active again` }, `Could not resume ${agent.attributes.name}`);
const suspendAll = () => run(() => suspendAllMyAgents(token()), ({ suspendedCount: count }) => ({
  title: `${count} assistant${count === 1 ? '' : 's'} suspended`,
  message: count ? 'Their tokens were revoked.' : '',
}), 'Could not suspend your assistants');
const removeOne = (agent) => run(() => deleteMyAgent(token(), agent.id), {
  title: `${agent.attributes.name} was deleted`,
  message: 'Its credentials no longer work.',
}, `Could not delete ${agent.attributes.name}`);

const step = ref(null);
const values = ref({});
const busy = ref(false);
// What the registration flow asks the owner to correct, shown in the form. Other failures are notifications.
const formError = ref('');
const registered = ref(null);
const copied = ref('');
const signInStep = computed(() => step.value?.inputs.some((input) => input.identifier === 'password'));

// The portal fills in nothing about the agent. If the flow signs the owner in again before it creates the
// agent, the username starts as theirs.
const defaults = computed(() => ({ username: props.user.username }));
const connectPrompt = connectPromptText(props.user);

// Once the owner has agents, connecting another assistant folds away to one line. It shows only once the
// list has loaded, so the page does not jump.
const connectOpen = ref(false);
const hasAgents = computed(() => agents.value.length > 0);
// The owner's list may leave out how an agent signs in; the column shows only when there is something in it.
const showSignIn = computed(() => agents.value.some((agent) => agent.tokenEndpointAuthMethod || agent.grantTypes?.length));

// showResult brings the result card into view once a registration finishes.
const resultCard = ref(null);
function showResult() {
  nextTick(() => resultCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// Short fields that share a row in the registration form.
const HALF_WIDTH = ['modelProvider', 'model'];

// label turns an input identifier into a label: modelProvider -> Model provider.
function label(identifier) {
  const words = identifier.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return { 'redirect uris': 'Redirect URIs', 'jwks uri': 'JWKS URI' }[words]
    ?? `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

// showStep shows a step's fields, keeping what the owner already entered. A suggested value for a field with
// fixed options is used only if it is one of them.
function showStep(next) {
  const kept = values.value;
  const allowed = (input, value) => !input.options?.length || input.options.includes(value);
  values.value = Object.fromEntries(next.inputs.map((input) => {
    const suggested = defaults.value[input.identifier];
    return [input.identifier, kept[input.identifier] ?? (allowed(input, suggested) ? suggested : undefined) ?? ''];
  }));
  step.value = next;
}

async function openForm() {
  busy.value = true;
  formError.value = '';
  registered.value = null;
  values.value = {};
  try {
    const result = await startRegistration(props.session);
    showStep(result.step);
  } catch (err) {
    notifyError('Could not start the registration', err.message);
  } finally {
    busy.value = false;
  }
}

async function submit() {
  busy.value = true;
  formError.value = '';
  try {
    const result = await submitRegistration(props.session, step.value, values.value);
    if (result.step) {
      // The flow sent the form back, saying what to correct: shown next to the fields.
      showStep(result.step);
      formError.value = result.error;
      return;
    }
    const agent = { ...result.agent, name: values.value.name ?? 'Your assistant', jwksUri: values.value.jwksUri };
    // The secret, when there is one, is shown once and never stored.
    registered.value = { ...agent, setup: setupTextFor(agent) };
    step.value = null;
    await loadAgents();
    showResult();
  } catch (err) {
    notifyError('Registration failed', err.message);
    step.value = null;
  } finally {
    busy.value = false;
  }
}

onMounted(loadAgents);

async function copy(text, what) {
  await navigator.clipboard.writeText(text);
  copied.value = what;
  setTimeout(() => { copied.value = ''; }, 1500);
}

</script>

<template>
  <section v-if="loaded" class="card">
    <div class="row">
      <div>
        <h2>{{ hasAgents ? 'Connect another assistant' : 'Connect your assistant' }}</h2>
        <p class="muted">Assistants you connect act only for you, and only with the permissions you approve.</p>
      </div>
      <button v-if="hasAgents" class="secondary" :aria-expanded="connectOpen" @click="connectOpen = !connectOpen">
        {{ connectOpen ? 'Hide' : 'Connect an assistant' }}
      </button>
    </div>
    <template v-if="!hasAgents || connectOpen">
      <ol class="steps">
        <li>Paste this message into Claude Code.</li>
        <li>Approve your assistant from the email we send you.</li>
        <li>Paste the assistant identifier it shows back into Claude Code.</li>
      </ol>
      <p class="muted">Your assistant tells you each step as you go.</p>
      <pre class="prompt">{{ connectPrompt }}</pre>
      <p><button @click="copy(connectPrompt, 'prompt')">{{ copied === 'prompt' ? 'Copied' : 'Copy message' }}</button></p>
      <div class="row manual">
        <p class="muted">Or enter the assistant's details yourself.</p>
        <button class="secondary" :disabled="busy" @click="openForm">Register manually</button>
      </div>
    </template>
  </section>

  <section v-if="step" class="card">
    <h2 v-if="step">{{ signInStep ? 'Confirm it is you' : 'Assistant details' }}</h2>
    <form v-if="step" class="grid" @submit.prevent="submit">
      <label v-for="input in step.inputs" :key="input.identifier" :class="{ wide: !HALF_WIDTH.includes(input.identifier) }">
        {{ label(input.identifier) }}{{ input.required ? ' *' : '' }}
        <select v-if="input.options?.length" v-model="values[input.identifier]" :required="input.required">
          <option v-if="!input.required" value="">Not set</option>
          <option v-for="option in input.options" :key="option" :value="option">{{ option }}</option>
        </select>
        <textarea v-else-if="input.identifier === 'publicKey'" v-model="values[input.identifier]" rows="3"
          placeholder="Optional. A JWKS document" />
        <input v-else v-model="values[input.identifier]" :required="input.required"
          :type="input.type === 'PASSWORD_INPUT' ? 'password' : 'text'" />
      </label>
      <p v-if="signInStep" class="hint wide">Confirm it is you: the registration flow signs you in before it creates the assistant.</p>
      <p v-else class="hint wide">The fields come from the assistant's type. Enter where the assistant sends you back, and a JWKS URI or public key if it signs in with a key; without one it gets a client secret. The bank's assistant toolkit uses <code>https://localhost:7070/callback</code> and <code>https://localhost:7070/.well-known/jwks.json</code>.</p>
      <div class="actions wide">
        <button :disabled="busy">{{ busy ? 'Working…' : signInStep ? 'Continue' : 'Register assistant' }}</button>
        <button type="button" class="secondary" @click="step = null">Cancel</button>
      </div>
    </form>
    <p v-if="formError" class="error">{{ formError }}</p>
  </section>

  <section v-if="registered" ref="resultCard" class="card result">
    <h2>{{ registered.name }} is ready</h2>
    <dl class="details">
      <dt>Assistant identifier</dt>
      <dd><code>{{ registered.clientId }}</code> <button class="link" @click="copy(registered.clientId, 'clientId')">{{ copied === 'clientId' ? 'Copied' : 'Copy' }}</button></dd>
      <template v-if="registered.clientSecret">
        <dt>Client secret</dt>
        <dd>
          <code>{{ registered.clientSecret }}</code>
          <button class="link" @click="copy(registered.clientSecret, 'secret')">{{ copied === 'secret' ? 'Copied' : 'Copy' }}</button>
          <p class="warning">Shown only now. Save it if you need it; it cannot be shown again.</p>
        </dd>
      </template>
      <template v-else>
        <dt>Authentication</dt>
        <dd>private_key_jwt<template v-if="registered.jwksUri"> with the key at <code>{{ registered.jwksUri }}</code></template>. No secret.</dd>
      </template>
    </dl>

    <h3>Connect your assistant</h3>
    <ol class="steps">
      <li>Copy the setup message.</li>
      <li>Paste it into Claude Code and press Enter.</li>
      <li>When a browser tab opens, sign in and approve the permissions you want the assistant to have.</li>
    </ol>
    <p>Then ask, for example, <em>"What's my bank balance?"</em></p>
    <button @click="copy(registered.setup, 'setup')">{{ copied === 'setup' ? 'Copied' : 'Copy setup message' }}</button>
    <details class="skill">
      <summary class="hint">Show the setup message</summary>
      <pre>{{ registered.setup }}</pre>
    </details>
  </section>

  <section class="card">
    <div class="row">
      <div>
        <h2>Your assistants</h2>
        <p class="muted">Suspend an assistant to stop it at once: its tokens are revoked and it gets no new ones. Resume it when you are ready. Deleting it removes it for good.</p>
      </div>
      <div class="actions">
        <button class="secondary" :disabled="acting" @click="loadAgents">Refresh</button>
        <button class="secondary" :disabled="acting || !anySuspendable" @click="confirming = { kind: 'suspendAll' }">Suspend all</button>
      </div>
    </div>
    <p v-if="!loaded" class="muted">Loading…</p>
    <p v-else-if="!agents.length && listFailed" class="muted">Your assistants could not be loaded.</p>
    <p v-else-if="!agents.length" class="muted">You have no assistants yet.</p>
    <table v-else-if="agents.length">
      <thead><tr><th>Name</th><th>Status</th><th v-if="showSignIn">Sign-in</th><th></th></tr></thead>
      <tbody>
        <tr v-for="a in agents" :key="a.id">
          <td>
            {{ a.attributes.name }}
            <div class="hint">Assistant identifier <code>{{ a.clientId }}</code></div>
          </td>
          <td><StatusBadge :status="a.status" audience="owner" /></td>
          <td v-if="showSignIn" class="hint">
            {{ a.tokenEndpointAuthMethod }}<br>
            {{ (a.grantTypes ?? []).join(', ') }}
          </td>
          <td class="actions-cell">
            <button v-if="!heldByOwner(a)" class="link" :disabled="acting" @click="confirming = { kind: 'suspend', agent: a }">Suspend</button>
            <button v-else class="link" :disabled="acting" @click="resumeOne(a)">Resume</button>
            <button class="link danger-text" :disabled="acting" @click="confirming = { kind: 'delete', agent: a }">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="agents.some(heldByBank)" class="hint">An assistant the bank suspended stays suspended until an administrator lifts it, even if you resume it.</p>
  </section>

  <ConfirmDialog
    v-if="confirming?.kind === 'suspend'"
    :title="`Suspend ${confirming.agent.attributes.name}?`"
    confirm-label="Suspend"
    :busy="acting"
    @confirm="suspendOne(confirming.agent)"
    @cancel="confirming = null"
  >
    Its tokens are revoked, so it is signed out of the bank at once. Its credentials and settings are kept, and you can resume it later.
  </ConfirmDialog>
  <ConfirmDialog
    v-if="confirming?.kind === 'suspendAll'"
    title="Suspend all your assistants?"
    confirm-label="Suspend all"
    :busy="acting"
    @confirm="suspendAll"
    @cancel="confirming = null"
  >
    Every assistant you have is stopped at once. You can resume them one by one.
  </ConfirmDialog>
  <ConfirmDialog
    v-if="confirming?.kind === 'delete'"
    :title="`Delete ${confirming.agent.attributes.name}?`"
    confirm-label="Delete assistant"
    danger
    :busy="acting"
    @confirm="removeOne(confirming.agent)"
    @cancel="confirming = null"
  >
    This removes the assistant and its credentials permanently. It cannot be undone.
  </ConfirmDialog>
</template>
