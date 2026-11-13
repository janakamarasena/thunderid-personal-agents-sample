<script setup>
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useSession } from '../session.js';
import { agentName, agents, isPersonal, loadError, loading, refresh, userName, users } from './adminData.js';
import AgentActions from './AgentActions.vue';
import StatusBadge from '../components/StatusBadge.vue';

const { session } = useSession();
const filter = ref('all');
const search = ref('');

// The agent API cannot filter on kind or owner, so the dashboard filters the list itself.
const filters = computed(() => [
  { id: 'all', label: 'All', count: agents.value.length },
  { id: 'personal', label: 'Personal', count: agents.value.filter(isPersonal).length },
  { id: 'other', label: 'Other', count: agents.value.filter((agent) => !isPersonal(agent)).length },
]);

const rows = computed(() => agents.value.filter((agent) => {
  if (filter.value === 'personal' && !isPersonal(agent)) return false;
  if (filter.value === 'other' && isPersonal(agent)) return false;
  return agentName(agent).toLowerCase().includes(search.value.toLowerCase());
}));

const ownerOf = (agent) => users.value.find((user) => user.id === agent.owner?.id);
</script>

<template>
  <section class="card">
    <div class="row">
      <div>
        <h2>Agents</h2>
        <p class="muted">A personal agent acts only for its owner, a user. Other agents are the ones an administrator manages.</p>
      </div>
      <div class="actions">
        <input v-model="search" placeholder="Search agents" />
        <button class="secondary" :disabled="loading" @click="refresh(session.accessToken)">Refresh</button>
      </div>
    </div>

    <div class="filters">
      <button
        v-for="f in filters"
        :key="f.id"
        :class="['pill-button', { active: filter === f.id }]"
        @click="filter = f.id"
      >{{ f.label }} <span class="count">{{ f.count }}</span></button>
    </div>

    <table>
      <thead><tr><th>Agent</th><th>Kind</th><th>Owner</th><th>Status</th><th></th></tr></thead>
      <tbody>
        <tr v-for="agent in rows" :key="agent.id">
          <td>
            {{ agentName(agent) }}
            <div v-if="agent.clientId" class="hint">Client ID <code>{{ agent.clientId }}</code></div>
          </td>
          <td><span :class="['pill', { agent: isPersonal(agent) }]">{{ isPersonal(agent) ? 'Personal' : 'Standard' }}</span></td>
          <td>
            <RouterLink v-if="ownerOf(agent)" :to="`/admin/users/${agent.owner?.id}`">{{ userName(ownerOf(agent)) }}</RouterLink>
            <span v-else class="muted">{{ agent.owner?.id ?? '—' }}</span>
          </td>
          <td><StatusBadge :status="agent.status" /></td>
          <td><AgentActions :agent="agent" /></td>
        </tr>
        <tr v-if="!rows.length"><td colspan="5" class="muted">{{ loading ? 'Loading…' : loadError ? 'Agents could not be loaded.' : 'No agents.' }}</td></tr>
      </tbody>
    </table>
  </section>
</template>
