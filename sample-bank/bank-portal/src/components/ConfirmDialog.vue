<script setup>
// A small confirmation, optionally with a note (for a suspension: the reason, at most 100 characters).
import { ref } from 'vue';

defineProps({
  title: { type: String, required: true },
  confirmLabel: { type: String, default: 'Confirm' },
  danger: { type: Boolean, default: false },
  noteLabel: { type: String, default: '' },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['confirm', 'cancel']);
const note = ref('');
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <form class="dialog" @submit.prevent="emit('confirm', note)">
      <h3>{{ title }}</h3>
      <div class="dialog-body"><slot /></div>
      <label v-if="noteLabel" class="field">
        {{ noteLabel }}
        <input v-model="note" maxlength="100" autofocus />
      </label>
      <div class="actions">
        <button :class="{ danger }" :disabled="busy">{{ busy ? 'Working…' : confirmLabel }}</button>
        <button type="button" class="secondary" :disabled="busy" @click="emit('cancel')">Cancel</button>
      </div>
    </form>
  </div>
</template>
