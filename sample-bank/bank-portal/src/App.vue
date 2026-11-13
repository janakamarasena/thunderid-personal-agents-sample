<script setup>
import { onMounted } from 'vue';
import { checkThunderID } from './thunderidCheck.js';
import { dismissToast, notifyError, toasts } from './toasts.js';
import ToastNotification from './components/ToastNotification.vue';

// Whether the portal can sign anyone in, checked once when it loads.
onMounted(async () => {
  const problem = await checkThunderID();
  if (problem) notifyError(problem.title, problem.message);
});
</script>

<template>
  <router-view />
  <TransitionGroup name="toast" tag="div" class="toasts">
    <ToastNotification
      v-for="toast in toasts"
      :key="toast.id"
      :title="toast.title"
      :message="toast.message"
      :kind="toast.kind"
      :duration="toast.duration"
      @close="dismissToast(toast.id)"
    />
  </TransitionGroup>
</template>
