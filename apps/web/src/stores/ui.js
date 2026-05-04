import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUiStore = defineStore('ui', () => {
  const toastMsg           = ref('');
  const toastVisible       = ref(false);
  const showShareModal     = ref(false);
  const showInstallBanner  = ref(false);
  const lang               = ref('es');
  let   _toastTimer        = null;
  let   _deferredPrompt    = null;

  function showToast(msg) {
    toastMsg.value = msg;
    toastVisible.value = true;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { toastVisible.value = false; }, 2800);
  }

  function setDeferredPrompt(e) { _deferredPrompt = e; }

  function revealInstallBanner() {
    if (!_deferredPrompt) return;
    if (window.navigator.standalone) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    showInstallBanner.value = true;
  }

  function dismissInstallBanner() {
    showInstallBanner.value = false;
    _deferredPrompt = null;
  }

  async function installPWA() {
    if (!_deferredPrompt) return;
    _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;
    if (outcome === 'accepted') showToast('✓ Voz Ciudadana instalada. ¡El pueblo manda!');
    _deferredPrompt = null;
    showInstallBanner.value = false;
  }

  return {
    toastMsg, toastVisible, showShareModal, showInstallBanner, lang,
    showToast, setDeferredPrompt, revealInstallBanner, dismissInstallBanner, installPWA,
  };
});
