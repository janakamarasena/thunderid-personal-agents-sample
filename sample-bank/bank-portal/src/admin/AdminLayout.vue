<script setup>
import { onMounted } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useSession } from '../session.js';
import { activity, clearActivity, refresh } from './adminData.js';

const { session } = useSession();
const route = useRoute();

onMounted(() => refresh(session.value.accessToken));
</script>

<template>
  <nav class="tabs">
    <RouterLink :class="['tab', { active: route.path.startsWith('/admin/users') }]" to="/admin/users">Users</RouterLink>
    <RouterLink :class="['tab', { active: route.path.startsWith('/admin/agents') }]" to="/admin/agents">Agents</RouterLink>
  </nav>

  <router-view />

  <section class="card activity">
    <div class="row">
      <div>
        <h2>Activity</h2>
        <p class="muted">What you did here, and what it changed. A user's suspension or deletion reaches their personal agents.</p>
      </div>
      <button v-if="activity.length" class="secondary" @click="clearActivity">Clear</button>
    </div>
    <p v-if="!activity.length" class="hint">Nothing yet.</p>
    <ul v-else class="log">
      <li v-for="entry in activity" :key="entry.id" :class="entry.tone">
        <strong>{{ entry.title }}</strong>
        <span class="hint"> {{ entry.time.toLocaleTimeString() }}</span>
        <ul v-if="entry.lines.length"><li v-for="line in entry.lines" :key="line">{{ line }}</li></ul>
      </li>
    </ul>
  </section>
</template>
