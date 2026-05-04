<template>
  <Teleport to="body">
    <div id="toast" :class="{show: ui.toastVisible}">{{ ui.toastMsg }}</div>
  </Teleport>
</template>
<script setup>
import { useUiStore } from '@/stores/ui.js';
const ui = useUiStore();
</script>
