import { createRouter, createWebHistory } from 'vue-router';
import CustomerZone from './CustomerZone.vue';
import AdminZone from './AdminZone.vue';
import UsersView from './admin/UsersView.vue';
import UserDetail from './admin/UserDetail.vue';
import AgentsView from './admin/AgentsView.vue';

// The customer pages and the admin dashboard are two zones. Each has its own ThunderIDProvider, because
// each signs in for a different audience: the bank API for customers, ThunderID's management API for
// administrators. Moving between zones swaps the provider.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: CustomerZone },
    {
      path: '/admin',
      component: AdminZone,
      children: [
        // The query is kept: after sign-in ThunderID returns here with the authorization code.
        { path: '', redirect: (to) => ({ path: '/admin/users', query: to.query }) },
        { path: 'users', component: UsersView },
        { path: 'users/:id', component: UserDetail, props: true },
        { path: 'agents', component: AgentsView },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
