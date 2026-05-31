<template>
  <Teleport to="body">
    <div id="install-banner" v-if="ui.showInstallBanner" style="display:flex">
      <div class="ib-icon">🔥</div>
      <div class="ib-text">
        <div class="ib-title">{{ $t('install.title') }}</div>
        <div class="ib-sub">{{ $t('install.subtitle') }}</div>
      </div>
      <button class="ib-btn" @click="ui.installPWA()">{{ $t('install.btn') }}</button>
      <button class="ib-close" @click="ui.dismissInstallBanner()">✕</button>
    </div>
  </Teleport>
</template>
<script setup>
import { useUiStore } from '@/stores/ui.js';
const ui = useUiStore();
</script>
