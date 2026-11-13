<script setup>
defineProps({ user: { type: Object, required: true } });
</script>

<template>
  <section class="card">
    <h2>My Account</h2>
    <dl class="details">
      <dt>Name</dt>
      <dd>{{ [user.givenName, user.familyName].filter(Boolean).join(' ') || '—' }}</dd>
      <dt>Username</dt>
      <dd>{{ user.username ?? '—' }}</dd>
      <dt>Email</dt>
      <dd>{{ user.email ?? '—' }}</dd>
      <dt>User ID</dt>
      <dd><code>{{ user.id }}</code></dd>
      <dt>Bank permissions</dt>
      <dd>
        <span v-for="p in user.permissions" :key="p" class="pill">{{ p }}</span>
        <span v-if="!user.permissions.length" class="muted">none</span>
      </dd>
    </dl>
  </section>
</template>
