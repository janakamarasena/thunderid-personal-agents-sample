<script setup>
import { watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { SignInButton, useThunderID } from '@thunderid/vue';
import { provideSession } from './session.js';
import AdminLayout from './admin/AdminLayout.vue';

const { isSignedIn, isLoading, signOut, user } = provideSession();
const { signIn, signInOptions } = useThunderID();
const route = useRoute();
const router = useRouter();

// An administrator who signed in on the customer page is sent here with ?continue, and goes straight on to
// the administrator sign-in (it is a different token, so ThunderID asks for the credentials again).
watch(isLoading, (loading) => {
  if (!loading && !isSignedIn.value && route.query.continue) {
    router.replace({ path: route.path });
    signIn(signInOptions);
  }
}, { immediate: true });
</script>

<template>
  <header class="topbar admin">
    <div class="brand">
      <span class="logo">◆</span>
      <span>Sample Bank · Administration</span>
    </div>
    <div class="who">
      <RouterLink class="topbar-link" to="/">Customer site</RouterLink>
      <template v-if="user">
        <span>{{ user.givenName ?? user.username ?? 'Signed in' }}</span>
        <button class="secondary" @click="signOut()">Sign out</button>
      </template>
    </div>
  </header>

  <main class="wide">
    <p v-if="isLoading || (isSignedIn && !user)" class="muted">Loading…</p>

    <section v-else-if="!isSignedIn" class="card welcome">
      <h1>Administrator sign-in</h1>
      <p class="muted">The dashboard calls ThunderID's management API, which takes its own token, so administrators sign in here even if they already signed in to the bank.</p>
      <div class="actions center">
        <SignInButton as-child v-slot="{ signIn: start }">
          <button @click="start">Sign in as administrator</button>
        </SignInButton>
      </div>
    </section>

    <section v-else-if="!user.hasSystemAccess" class="card welcome">
      <h1>Not an administrator</h1>
      <p class="muted">{{ user.username }} does not have administrator access, so ThunderID did not grant the dashboard's token.</p>
      <div class="actions center"><button class="secondary" @click="signOut()">Sign out</button></div>
    </section>

    <AdminLayout v-else />
  </main>
</template>
