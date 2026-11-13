// Short-lived notifications, shown in the bottom right corner by App.vue: what an action did, or what went
// wrong. Each closes itself after a few seconds.
import { ref } from 'vue';

export const toasts = ref([]);
let nextId = 1;
const MAX_SHOWN = 3;
// How long each kind stays, in milliseconds. An error has more to read.
const DURATION = { success: 6000, error: 10000 };

// The same notification is not shown twice at once.
function show(kind, title, message) {
  if (toasts.value.some((toast) => toast.kind === kind && toast.title === title && toast.message === message)) return;
  toasts.value = [...toasts.value, { id: nextId++, kind, title, message, duration: DURATION[kind] }].slice(-MAX_SHOWN);
}

export const notifySuccess = (title, message = '') => show('success', title, message);
export const notifyError = (title, message = '') => show('error', title, message);

export function dismissToast(id) {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}
