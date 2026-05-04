<template>
  <Teleport to="body">
    <div id="install-banner" v-if="ui.showInstallBanner" style="display:flex">
      <div class="ib-icon">🔥</div>
      <div class="ib-text">
        <div class="ib-title">Instalar Voz Ciudadana</div>
        <div class="ib-sub">Sigue el resultado en tiempo real · Sin App Store · Sin permisos de nadie</div>
      </div>
      <button class="ib-btn" @click="ui.installPWA()">Instalar</button>
      <button class="ib-close" @click="ui.dismissInstallBanner()">✕</button>
    </div>
  </Teleport>
</template>
<script setup>
import { useUiStore } from '@/stores/ui.js';
const ui = useUiStore();
</script>
