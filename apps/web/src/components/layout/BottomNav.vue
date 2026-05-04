<template>
  <div class="bottom-nav">
    <button class="nav-item" :class="{active: isActive('/')}"       @click="$router.push('/')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>
      Mapa
    </button>
    <button class="nav-item" :class="{active: isActive('/create')}" @click="$router.push('/create')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
      Convocar
    </button>
    <button class="nav-item" :class="{active: isActive('/about')}"  @click="$router.push('/about')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="8.5" stroke-linecap="round"/><line x1="12" y1="12" x2="12" y2="16"/></svg>
      Cómo funciona
    </button>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router';
const route    = useRoute();
const isActive = path => route.path === path || (path === '/' && route.path === '/');
</script>
