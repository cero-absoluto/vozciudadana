import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import i18n from '@/i18n.js';

export const useUiStore = defineStore('ui', () => {
  const toastMsg           = ref('');
  const toastVisible       = ref(false);
  const showShareModal     = ref(false);
  const shareContext       = shallowRef(null);
  const shareOpenId        = ref(0);

  function openShare(context) {
    // An open dialog keeps the destination it was explicitly opened for.
    if (showShareModal.value) return false;
    const rawId = context?.id;
    const id = typeof rawId === 'string' ? rawId.trim()
      : typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0 ? String(rawId) : '';
    const title = typeof context?.title === 'string' ? context.title.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !title || title.length > 500) {
      shareContext.value = null;
      showShareModal.value = false;
      return false;
    }
    // Copy only public event metadata: never retain the caller's object or credentials.
    shareContext.value = Object.freeze({ id, title });
    shareOpenId.value += 1;
    showShareModal.value = true;
    return true;
  }
  const showInstallBanner  = ref(false);
  const lang               = ref(i18n.global.locale.value);
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
    if (outcome === 'accepted') showToast(i18n.global.t('install.toastInstalled'));
    deferredPrompt.value = null;
    showInstallBanner.value = false;
  }

 return {
    toastMsg, toastVisible, showShareModal, shareContext, shareOpenId, openShare, showInstallBanner, lang,
    showToast, setDeferredPrompt, revealInstallBanner, dismissInstallBanner, installPWA,
    gpsLat, gpsLng, gpsAccuracy, setGps, clearGps,
  };
});
