<script setup>
// An account's or agent's access status, as ThunderID reports it: ACTIVE, LOCKED or SUSPENDED, and for a
// suspension who holds it. The owner's, the organization's and a cascade from the owner's account are
// independent holds; each is lifted only by its own party.
import { computed } from 'vue';

const props = defineProps({
  status: { type: Object, default: null },
  // Who is reading: an owner sees "you" and "the bank", an administrator sees the roles.
  audience: { type: String, default: 'admin' },
});

const value = computed(() => props.status?.value ?? 'ACTIVE');
const details = computed(() => props.status?.details ?? {});
const holds = computed(() => details.value.appliedBy ?? []);

const names = {
  admin: { organization: 'by an administrator', owner: 'by its owner', cascade: "with the owner's account" },
  owner: { organization: 'by the bank', owner: 'by you', cascade: 'with your account' },
};

const lockText = computed(() => ({
  SUSPENSION_RELEASE_LOCK: 'Locked after a suspension. An administrator unlocks it.',
  FAILED_ATTEMPTS: 'Locked after failed attempts',
}[details.value.reason] ?? 'Locked'));

const title = computed(() => {
  const parts = [];
  if (details.value.reason) {
    parts.push(details.value.reason);
  }
  if (details.value.since) {
    parts.push(`since ${new Date(details.value.since).toLocaleString()}`);
  }
  return parts.join(' ');
});
</script>

<template>
  <span class="status" :title="title">
    <span :class="['badge', value.toLowerCase()]">{{ value === 'SUSPENDED' ? 'Suspended' : value === 'LOCKED' ? 'Locked' : 'Active' }}</span>
    <template v-if="value === 'SUSPENDED'">
      <span v-for="hold in holds" :key="hold" :class="['hold', hold]">{{ names[audience][hold] ?? hold }}</span>
    </template>
    <span v-else-if="value === 'LOCKED'" class="hint">{{ lockText }}</span>
    <span v-if="audience === 'admin' && details.operatorNote" class="hint note">“{{ details.operatorNote }}”</span>
  </span>
</template>
