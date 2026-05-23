import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

export const useUiStore = defineStore('ui', () => {
  const toastMsg           = ref('');
  const toastVisible       = ref(false);
  const showShareModal     = ref(false);
  const showInstallBanner  = ref(false);
  const lang               = ref('es');
  const deferredPrompt     = shallowRef(null);
  const gpsLat      = ref(null);
const gpsLng      = ref(null);
const gpsAccuracy = ref(null);

function setGps(lat, lng, accuracy) {
  gpsLat.value      = lat;
  gpsLng.value      = lng;
  gpsAccuracy.value = accuracy;
}

function clearGps() {
  gpsLat.value      = null;
  gpsLng.value      = null;
  gpsAccuracy.value = null;
}
  let   _toastTimer        = null;

  function showToast(msg) {
    toastMsg.value = msg;
    toastVisible.value = true;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { toastVisible.value = false; }, 2800);
  }

  function setDeferredPrompt(e) { deferredPrompt.value = e; }

  function revealInstallBanner() {
    if (!deferredPrompt.value) return;
    if (window.navigator.standalone) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    showInstallBanner.value = true;
  }

  function dismissInstallBanner() {
    showInstallBanner.value = false;
    deferredPrompt.value = null;
  }

  async function installPWA() {
    if (!deferredPrompt.value) return;
    deferredPrompt.value.prompt();
    const { outcome } = await deferredPrompt.value.userChoice;
    if (outcome === 'accepted') showToast('✓ Voz Ciudadana instalada. ¡El pueblo manda!');
    deferredPrompt.value = null;
    showInstallBanner.value = false;
  }

 return {
    toastMsg, toastVisible, showShareModal, showInstallBanner, lang,
    showToast, setDeferredPrompt, revealInstallBanner, dismissInstallBanner, installPWA,
    gpsLat, gpsLng, gpsAccuracy, setGps, clearGps,
  };
});
