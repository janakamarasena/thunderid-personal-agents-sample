<script setup>
import { ThunderIDProvider } from '@thunderid/vue';
import CustomerShell from './CustomerShell.vue';
import { config } from './config.js';

// Customers sign in with the redirect flow. The resource ties the access token to the bank API. Sign up opens
// the registration flow in the gate.
const signInOptions = { resource: config.bankResource };
const signUpUrl = `${config.gateUrl}/signup?${new URLSearchParams({ applicationId: config.applicationId })}`;
</script>

<template>
  <ThunderIDProvider
    :client-id="config.clientId"
    :base-url="config.thunderidUrl"
    :scopes="config.scopes"
    :sign-in-options="signInOptions"
    :sign-up-url="signUpUrl"
  >
    <CustomerShell />
  </ThunderIDProvider>
</template>
