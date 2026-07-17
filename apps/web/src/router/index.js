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
import ApiScreen from '@/screens/ApiScreen.vue';
import PrivacyScreen from '@/screens/PrivacyScreen.vue';
import FundingScreen from '@/screens/FundingScreen.vue';

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
  { path: '/api-docs', component: ApiScreen },
  { path: '/privacy',  component: PrivacyScreen },
  { path: '/funding',  component: FundingScreen },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// Phase 1 (Static Foundations, 16 July 2026): robots.txt cannot exclude
// these routes from indexing — with hash-based routing, everything after
// the # is client-side only, so a crawler always sees the same server
// path ("/") regardless of which screen is open. A JS-executing crawler
// (Googlebot) does see the DOM after navigation, though, so a robots meta
// tag toggled here has real effect for those. Non-JS crawlers see none of
// this either way, since they only ever get the empty app shell — for
// them the distinction is moot.
const NOINDEX_PREFIXES = ['/auth', '/verify', '/create', '/grupo', '/invite'];

router.afterEach((to) => {
  const shouldNoindex = NOINDEX_PREFIXES.some(p => to.path.startsWith(p));
  let tag = document.querySelector('meta[name="robots"]');
  if (shouldNoindex) {
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'robots');
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', 'noindex, nofollow');
  } else if (tag) {
    tag.remove();
  }
});


