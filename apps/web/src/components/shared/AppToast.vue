<template>
  <Teleport to="body">
    <div id="toast" role="alert" aria-live="polite" aria-atomic="true" :class="{show: ui.toastVisible}">{{ ui.toastMsg }}</div>
  </Teleport>
</template>
<script setup>
import { useUiStore } from '@/stores/ui.js';
const ui = useUiStore();
</script>
