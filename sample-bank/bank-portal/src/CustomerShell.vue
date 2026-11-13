<script setup>
import { ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { SignInButton } from '@thunderid/vue';
import { provideSession } from './session.js';
import AccountSection from './components/AccountSection.vue';
import BankingSection from './components/BankingSection.vue';
import AgentsSection from './components/AgentsSection.vue';

const { isSignedIn, isLoading, signOut, session, user } = provideSession();
const router = useRouter();

const tab = ref('banking');

const tabs = [
  { id: 'banking', label: 'Banking' },
  { id: 'account', label: 'My Account' },
  { id: 'agents', label: 'Assistants' },
];

// An administrator who signed in here goes on to the dashboard. It asks them to sign in again, because
// ThunderID's management API takes a different token from the bank API.
watch(user, (current) => {
  if (current?.isAdmin) {
    router.replace({ path: '/admin', query: { continue: '1' } });
  }
});
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="logo">◆</span>
      <span>Sample Bank</span>
    </div>
    <div v-if="user" class="who">
      <span>{{ user.givenName ?? user.username ?? 'Signed in' }}</span>
      <button class="secondary" @click="signOut()">Sign out</button>
    </div>
  </header>

  <main>
    <p v-if="isLoading" class="muted">Loading…</p>

    <section v-else-if="!isSignedIn" class="card welcome">
      <h1>Welcome to Sample Bank</h1>
      <p class="muted">Sign in with ThunderID to see your account and manage your assistants.</p>
      <div class="actions center">
        <SignInButton as-child v-slot="{ signIn }">
          <button @click="signIn">Sign in</button>
        </SignInButton>
      </div>
      <!-- <p class="hint">Bank staff: <RouterLink to="/admin">administrator sign-in</RouterLink>.</p> -->
    </section>

    <p v-else-if="!user || user.isAdmin" class="muted">Loading…</p>

    <template v-else>
      <nav class="tabs">
        <button
          v-for="t in tabs"
          :key="t.id"
          :class="['tab', { active: tab === t.id }]"
          @click="tab = t.id"
        >{{ t.label }}</button>
      </nav>

      <BankingSection v-if="tab === 'banking'" :session="session" :user="user" />
      <AccountSection v-else-if="tab === 'account'" :user="user" />
      <AgentsSection v-else :session="session" :user="user" />
    </template>
  </main>
</template>
