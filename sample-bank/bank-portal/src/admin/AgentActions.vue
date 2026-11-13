<script setup>
// What an administrator can do to one agent. An administrator's suspension is the organization's: independent of
// the owner's own suspension, and lifted only here. A personal agent suspended with its owner's account is lifted
// by lifting the account.
import { computed, ref } from 'vue';
import { useSession } from '../session.js';
import { agentName, perform } from './adminData.js';
import { deleteAgent, suspendAgent, unlockAgent, unsuspendAgent } from '../thunderid.js';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const props = defineProps({ agent: { type: Object, required: true } });

const { session } = useSession();
const token = () => session.value.accessToken;
const holds = computed(() => props.agent.status?.details?.appliedBy ?? []);
const locked = computed(() => props.agent.status?.value === 'LOCKED');
const name = computed(() => agentName(props.agent));
const dialog = ref(null);
const busy = ref(false);

// perform shows a failure as a notification and in the activity log.
async function run(title, action) {
  busy.value = true;
  try {
    await perform(token(), title, action);
  } catch {
    // Already shown.
  } finally {
    busy.value = false;
    dialog.value = null;
  }
}

const suspend = (note) => run(`Suspended agent ${name.value}`, () => suspendAgent(token(), props.agent.id, note));
const lift = () => run(`Lifted the suspension of agent ${name.value}`, () => unsuspendAgent(token(), props.agent.id));
const unlock = () => run(`Unlocked agent ${name.value}`, () => unlockAgent(token(), props.agent.id));
const remove = () => run(`Deleted agent ${name.value}`, () => deleteAgent(token(), props.agent.id));
</script>

<template>
  <span class="row-actions">
    <button v-if="!holds.includes('organization')" class="link" :disabled="busy" @click="dialog = 'suspend'">Suspend</button>
    <button v-else class="link" :disabled="busy" @click="lift">Lift suspension</button>
    <button v-if="locked" class="link" :disabled="busy" @click="unlock">Unlock</button>
    <button class="link danger-text" :disabled="busy" @click="dialog = 'delete'">Delete</button>
  </span>

  <ConfirmDialog
    v-if="dialog === 'suspend'"
    :title="`Suspend ${name}?`"
    confirm-label="Suspend"
    note-label="Reason (optional, shown to administrators)"
    :busy="busy"
    @confirm="suspend"
    @cancel="dialog = null"
  >
    Its tokens are revoked and it gets no new ones. This is the organization's suspension: the owner can lift only their own, and this stays until you lift it.
  </ConfirmDialog>
  <ConfirmDialog
    v-if="dialog === 'delete'"
    :title="`Delete ${name}?`"
    confirm-label="Delete agent"
    danger
    :busy="busy"
    @confirm="remove"
    @cancel="dialog = null"
  >
    The agent and its credentials are removed permanently.
  </ConfirmDialog>
</template>
