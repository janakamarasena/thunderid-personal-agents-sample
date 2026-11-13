<script setup>
// A short-lived notification in the bottom right corner. It closes itself when its time bar runs out; the
// bar pauses while the pointer is over the notification, so there is time to read it.
defineProps({
  title: { type: String, required: true },
  message: { type: String, default: '' },
  // success or error.
  kind: { type: String, default: 'error' },
  // How long it stays, in milliseconds.
  duration: { type: Number, default: 10000 },
});
const emit = defineEmits(['close']);
</script>

<template>
  <div :class="['toast', kind]" :role="kind === 'error' ? 'alert' : 'status'">
    <div class="toast-body">
      <strong>{{ title }}</strong>
      <p v-if="message">{{ message }}</p>
    </div>
    <button type="button" class="toast-close" aria-label="Dismiss" @click="emit('close')">×</button>
    <div class="toast-timer" :style="{ animationDuration: `${duration}ms` }" @animationend="emit('close')" />
  </div>
</template>
