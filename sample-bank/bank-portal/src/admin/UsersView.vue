<script setup>
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useSession } from '../session.js';
import { agents, isPersonal, loadError, loading, refresh, userName, users } from './adminData.js';
import StatusBadge from '../components/StatusBadge.vue';

const { session } = useSession();
const search = ref('');

const rows = computed(() => users.value
  .filter((user) => `${userName(user)} ${user.attributes?.email ?? ''}`.toLowerCase().includes(search.value.toLowerCase()))
  .map((user) => {
    const owned = agents.value.filter((agent) => agent.owner?.id === user.id);
    return { user, personal: owned.filter(isPersonal).length, other: owned.length - owned.filter(isPersonal).length };
  }));

const fullName = (user) => [user.attributes?.given_name, user.attributes?.family_name].filter(Boolean).join(' ');
</script>

<template>
  <section class="card">
    <div class="row">
      <div>
        <h2>Users</h2>
        <p class="muted">Open a user to see their details and the agents they own, and to suspend or delete them.</p>
      </div>
      <div class="actions">
        <input v-model="search" placeholder="Search users" />
        <button class="secondary" :disabled="loading" @click="refresh(session.accessToken)">Refresh</button>
      </div>
    </div>
    <table>
      <thead><tr><th>User</th><th>Email</th><th>Status</th><th class="num">Personal agents</th><th class="num">Other agents</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.user.id">
          <td>
            <RouterLink :to="`/admin/users/${row.user.id}`">{{ userName(row.user) }}</RouterLink>
            <div class="hint">{{ fullName(row.user) }}</div>
          </td>
          <td>{{ row.user.attributes?.email }}</td>
          <td><StatusBadge :status="row.user.status" /></td>
          <td class="num">{{ row.personal }}</td>
          <td class="num">{{ row.other }}</td>
        </tr>
        <tr v-if="!rows.length"><td colspan="5" class="muted">{{ loading ? 'Loading…' : loadError ? 'Users could not be loaded.' : 'No users.' }}</td></tr>
      </tbody>
    </table>
  </section>
</template>
