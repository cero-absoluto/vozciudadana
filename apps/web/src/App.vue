<template>
  <div id="app-shell">
    <AppTopbar />
    <main class="app-main">
      <RouterView />
    </main>
    <BottomNav />
    <ShareModal />
    <AppToast />
    <InstallBanner />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useProtestsStore } from '@/stores/protests.js';
import { useUiStore }       from '@/stores/ui.js';
import AppTopbar    from '@/components/layout/AppTopbar.vue';
import BottomNav    from '@/components/layout/BottomNav.vue';
import ShareModal   from '@/components/shared/ShareModal.vue';
import AppToast     from '@/components/shared/AppToast.vue';
import InstallBanner from '@/components/shared/InstallBanner.vue';

const protests = useProtestsStore();
const ui       = useUiStore();

onMounted(() => {
  // Restore joined state from localStorage
  protests.restoreFromStorage();

  // Live counter tick
  setInterval(() => protests.tickTimers(), 1000);

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/vozciudadana/service-worker.js')
      .catch(err => console.warn('[PWA] SW error:', err));
  }

  // PWA install prompt
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    ui.setDeferredPrompt(e);
  });
});
</script>

<style>
/* App shell layout */
html, body { height: 100%; overflow: hidden; }

#app-shell {
  height: 100svh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-width: 520px;
  margin: 0 auto;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
}

.app-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Screen base — all screens fill the main area */
.screen {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  animation: fadeUp .3s ease;
}
@keyframes fadeUp { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }

/* Desktop responsive */
@media (min-width: 900px) {
  body { background: var(--bg2); }
  #app-shell {
    max-width: 100% !important;
    width: 100% !important;
    border: none;
    margin: 0 !important;
  }
  #s-home {
    flex-direction: row;
    overflow: hidden;
  }
  #home-left {
    flex: 1.5;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    overflow: hidden;
  }
  #home-right {
    flex: 1;
    width: auto;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel-body { flex: 1; overflow-y: auto; }
  #s-detail, #s-auth, #s-verify, #s-about {
    max-width: 680px;
    margin: 0 auto;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }
  #s-create {
  max-width: 100% !important;
    width: 100% !important;
    margin: 0 !important;
    border: none;
  }
  .create-scroll {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    padding: 24px;
    align-items: start;
     width: 100%;
  }
  #s-detail {max-width: 100% !important; width: 100% !important; margin: 0 !important; border: none; }
  .topbar { max-width: 100%; border-bottom: 1px solid var(--border); padding: 12px 24px; }
  .bottom-nav { max-width: 100%; padding: 0 24px; }
  .modal { max-width: 480px; }
  #s-about {
    max-width: 100% !important;
    width: 100% !important;
    margin: 0 !important;
    border: none !important;
  }
  #s-about .tech-grid {
    grid-template-columns: 1fr 1fr 1fr;
    padding: 0 24px;
    gap: 12px;
  }
  #s-about .about-hero {
    padding: 24px;
  }
  #s-about .about-h {
    font-size: 28px;
  }
  #s-about .about-p {
    font-size: 14px;
  }
  #s-about .section-head {
    font-size: 13px;
    padding: 12px 24px 8px;
  }
  #s-about .manifesto {
    font-size: 16px;
    margin: 16px 24px;
  }
   #s-detail .detail-map { height: 180px; }
  .detail-body {
    display: flex;
    flex-direction: row;
    flex: 1;
    overflow: hidden;
  }
  .detail-body .detail-map {
    width: 300px;
    flex-shrink: 0;
    height: 100% !important;
  }
  .detail-body .d-scroll {
    flex: 1;
    overflow-y: auto;
  }
}
</style>
