<script setup>
import { ThunderIDProvider } from '@thunderid/vue';
import AdminShell from './AdminShell.vue';
import { config } from './config.js';

// The dashboard calls ThunderID's management API, so its token is for that API, not the bank's. It is a
// second SDK instance (its own session, kept apart from the customer's) that returns to the dashboard's first
// page. The SDK reads the sign-in response only at the address it was given, so no redirect may come first.
const origin = window.location.origin;
const signInOptions = { resource: config.systemResource };
const returnTo = `${origin}/admin/users`;
</script>

<template>
  <ThunderIDProvider
    :instance-id="1"
    :client-id="config.clientId"
    :base-url="config.thunderidUrl"
    :scopes="config.scopes"
    :sign-in-options="signInOptions"
    :after-sign-in-url="returnTo"
    :after-sign-out-url="origin"
  >
    <AdminShell />
  </ThunderIDProvider>
</template>
