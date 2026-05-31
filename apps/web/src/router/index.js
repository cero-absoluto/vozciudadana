import { createRouter, createWebHashHistory } from 'vue-router';

import HomeScreen   from '@/screens/HomeScreen.vue';
import DetailScreen from '@/screens/DetailScreen.vue';
import AuthScreen   from '@/screens/AuthScreen.vue';
import VerifyScreen from '@/screens/VerifyScreen.vue';
import VerifyInstitucionalScreen from '@/screens/VerifyInstitucionalScreen.vue';
import CreateScreen from '@/screens/CreateScreen.vue';
import AboutScreen  from '@/screens/AboutScreen.vue';
import InformeScreen from '@/screens/InformeScreen.vue';
import MiGrupoScreen from '@/screens/MiGrupoScreen.vue';
import UnirseGrupoScreen from '@/screens/UnirseGrupoScreen.vue';
import InviteScreen from '@/screens/InviteScreen.vue';
import ArchivoScreen from '@/screens/ArchivoScreen.vue';

const routes = [
  { path: '/',          component: HomeScreen },
  { path: '/detail/:id', component: DetailScreen },
  { path: '/auth',      component: AuthScreen },
  { path: '/verify',    component: VerifyScreen },
  { path: '/verify-institucional/:protestId', component: VerifyInstitucionalScreen },
  { path: '/create',    component: CreateScreen },
  { path: '/about',     component: AboutScreen },
  { path: '/informe/:id', component: InformeScreen },
  { path: '/grupo/:protestId', component: MiGrupoScreen },
{ path: '/grupo/:protestId/unirse', component: UnirseGrupoScreen },
{ path: '/invite/:token', component: InviteScreen },
  { path: '/archivo', component: ArchivoScreen },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

