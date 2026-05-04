import { createRouter, createWebHashHistory } from 'vue-router';

import HomeScreen   from '@/screens/HomeScreen.vue';
import DetailScreen from '@/screens/DetailScreen.vue';
import AuthScreen   from '@/screens/AuthScreen.vue';
import VerifyScreen from '@/screens/VerifyScreen.vue';
import CreateScreen from '@/screens/CreateScreen.vue';
import AboutScreen  from '@/screens/AboutScreen.vue';

const routes = [
  { path: '/',          component: HomeScreen },
  { path: '/detail/:id', component: DetailScreen },
  { path: '/auth',      component: AuthScreen },
  { path: '/verify',    component: VerifyScreen },
  { path: '/create',    component: CreateScreen },
  { path: '/about',     component: AboutScreen },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
