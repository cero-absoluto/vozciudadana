import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { REGIONS } from '@/constants.js';

export const useDeviceStore = defineStore('device', () => {
  const simPrefix  = ref('+34');
  const simCountry = ref('ES');
  const simName    = ref('España');
  const ipCountry  = ref('ES');
  const ipCity     = ref('Madrid');
  const docCountry = ref(null);

  const confidence = computed(() => {
    if (docCountry.value) return 100;
    return 75; // SIM 40% + IP 35%
  });

  const myRegions = computed(() =>
    Object.entries(REGIONS)
      .filter(([, r]) => r.members.includes(simCountry.value))
      .map(([k]) => k)
  );

  const regionLabel = computed(() =>
    myRegions.value.map(k => REGIONS[k].name).join(' · ')
  );

  function setDocCountry(c) { docCountry.value = c; }

  // ── localStorage device-lock helpers ──────────────────────────────────────
  function getLocks() {
    try { return JSON.parse(localStorage.getItem('vc_locks') || '{}'); }
    catch { return {}; }
  }

  function setLock(protestId) {
    const locks = getLocks();
    locks[protestId] = Date.now();
    localStorage.setItem('vc_locks', JSON.stringify(locks));
  }

  function getDeviceId() {
    let id = localStorage.getItem('vc_device_id');
    if (!id) {
      const arr = crypto.getRandomValues(new Uint8Array(16));
      id = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('vc_device_id', id);
    }
    return id;
  }

  function setDeviceId(id) {
    localStorage.setItem('vc_device_id', id);
  }

  return {
    simPrefix, simCountry, simName, ipCountry, ipCity, docCountry,
    confidence, myRegions, regionLabel,
    setDocCountry, getLocks, setLock, getDeviceId, setDeviceId,
  };
});
