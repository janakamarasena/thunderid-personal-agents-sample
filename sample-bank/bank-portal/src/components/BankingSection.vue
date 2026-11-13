<script setup>
import { onMounted, ref } from 'vue';
import { getAccount, makeTransfer } from '../api.js';
import { notifyError, notifySuccess } from '../toasts.js';

const props = defineProps({
  session: { type: Object, required: true },
  user: { type: Object, required: true },
});

const account = ref(null);
// Failures show as a notification; the page keeps a line saying the account could not be loaded.
const loadFailed = ref(false);
const form = ref({ to: '', amount: '', note: '' });
const busy = ref(false);

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const when = (iso) => new Date(iso).toLocaleString();

async function load() {
  try {
    account.value = (await getAccount(props.session)).account;
    loadFailed.value = false;
  } catch (err) {
    loadFailed.value = true;
    notifyError('Could not load your account', err.message);
  }
}

async function submit() {
  busy.value = true;
  try {
    const result = await makeTransfer(props.session, { ...form.value, amount: Number(form.value.amount) });
    account.value = result.account;
    notifySuccess(`Sent ${money(Number(form.value.amount))} to ${form.value.to}`);
    form.value = { to: '', amount: '', note: '' };
  } catch (err) {
    notifyError('Transfer failed', err.message);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="card balance" v-if="account">
    <div>
      <p class="muted">Checking account · {{ account.accountNumber }}</p>
      <p class="amount">{{ money(account.balance) }}</p>
    </div>
    <button class="secondary" @click="load">Refresh</button>
  </section>
  <section v-else-if="loadFailed" class="card balance">
    <p class="muted">Your account could not be loaded.</p>
    <button class="secondary" @click="load">Retry</button>
  </section>

  <section class="card">
    <h2>Transfer money</h2>
    <p v-if="!user.permissions.includes('bank:write')" class="muted">
      Your session does not hold <code>bank:write</code>, so the bank will refuse transfers.
    </p>
    <form class="grid" @submit.prevent="submit">
      <label>To <input v-model="form.to" required placeholder="Recipient name" /></label>
      <label>Amount <input v-model="form.amount" required type="number" min="0.01" step="0.01" /></label>
      <label class="wide">Note <input v-model="form.note" placeholder="Optional" /></label>
      <button :disabled="busy">Send</button>
    </form>
  </section>

  <section class="card" v-if="account">
    <h2>Recent transactions</h2>
    <table>
      <thead>
        <tr><th>Date</th><th>Description</th><th>Made by</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>
        <tr v-for="(t, i) in account.transactions" :key="i">
          <td>{{ when(t.at) }}</td>
          <td>{{ t.description }}</td>
          <td>
            <span v-if="t.viaAgent" class="pill agent" :title="t.viaAgent">Assistant</span>
            <span v-else class="muted">You</span>
          </td>
          <td :class="['num', t.type]">{{ t.type === 'debit' ? '−' : '+' }}{{ money(t.amount) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
