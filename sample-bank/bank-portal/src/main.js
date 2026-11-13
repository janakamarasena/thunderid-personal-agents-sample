import { createApp } from 'vue';
import { ThunderIDPlugin } from '@thunderid/vue';
import App from './App.vue';
import { router } from './router.js';
import './style.css';

createApp(App).use(ThunderIDPlugin).use(router).mount('#app');
