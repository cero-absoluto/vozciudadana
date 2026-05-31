<template>
  <div class="bottom-nav">
    <button class="nav-item" :class="{active: isActive('/')}" @click="$router.push('/')" aria-label="Mapa">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>
      <span class="nav-txt-short">Mapa</span>
      <span class="nav-txt-full">Mapa</span>
    </button>
    <button class="nav-item" :class="{active: isActive('/create')}" @click="$router.push('/create')" aria-label="Convocar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
      <span class="nav-txt-short">Convocar</span>
      <span class="nav-txt-full">Convocar</span>
    </button>
    <button class="nav-item" :class="{active: isActive('/archivo')}" @click="$router.push('/archivo')" aria-label="Archivo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M3 6v14a1 1 0 001 1h16a1 1 0 001-1V6M3 6l2-3h14l2 3"/><line x1="10" y1="11" x2="14" y2="11"/></svg>
      <span class="nav-txt-short">Archivo</span>
      <span class="nav-txt-full">Archivo</span>
    </button>
    <button class="nav-item" :class="{active: isActive('/about')}" @click="$router.push('/about')" aria-label="Cómo funciona">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="8.5" stroke-linecap="round"/><line x1="12" y1="12" x2="12" y2="16"/></svg>
      <span class="nav-txt-short">Info</span>
      <span class="nav-txt-full">Cómo funciona</span>
    </button>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router';
const route    = useRoute();
const isActive = path => route.path === path || (path === '/' && route.path === '/');
</script>
