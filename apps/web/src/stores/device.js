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

  const tzCountry  = ref(null);
  const langCountry = ref(null);

  const confidence = computed(() => {
    let score = 0;
    if (simCountry.value)  score += 50;
    if (ipCountry.value && ipCountry.value === simCountry.value)  score += 30;
    if (tzCountry.value  && tzCountry.value  === simCountry.value) score += 12;
    if (langCountry.value && langCountry.value === simCountry.value) score += 8;
    return Math.min(100, score);
  });
  function detectSecondarySignals() {
    // Zona horaria → país aproximado
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tzMap = {
      'Europe/Madrid': 'ES', 'Europe/Amsterdam': 'NL', 'Europe/Paris': 'FR',
      'Europe/Berlin': 'DE', 'Europe/Rome': 'IT', 'Europe/Lisbon': 'PT',
      'Europe/London': 'GB', 'America/New_York': 'US', 'America/Los_Angeles': 'US',
      'America/Chicago': 'US', 'America/Sao_Paulo': 'BR', 'America/Mexico_City': 'MX',
      'Asia/Tokyo': 'JP', 'Asia/Shanghai': 'CN', 'Australia/Sydney': 'AU',
      'Europe/Warsaw': 'PL', 'Europe/Bucharest': 'RO', 'Europe/Athens': 'GR',
      'Europe/Brussels': 'BE', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO',
      'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI', 'Europe/Zurich': 'CH',
      'Europe/Vienna': 'AT', 'Europe/Prague': 'CZ', 'Europe/Budapest': 'HU',
      'Europe/Kyiv': 'UA', 'Europe/Moscow': 'RU', 'Asia/Dubai': 'AE',
      'Asia/Kolkata': 'IN', 'Asia/Seoul': 'KR', 'America/Toronto': 'CA',
      'America/Buenos_Aires': 'AR', 'America/Santiago': 'CL', 'America/Bogota': 'CO',
      'Europe/Malta': 'MT',
    };
    tzCountry.value = tzMap[tz] || null;

    // Idioma → país aproximado
    const lang = navigator.language?.split('-')[1]?.toUpperCase() || null;
    langCountry.value = lang;
  }

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
    tzCountry, langCountry, detectSecondarySignals,
  };
});
