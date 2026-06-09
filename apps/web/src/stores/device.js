import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { REGIONS } from '@/constants.js';

export const useDeviceStore = defineStore('device', () => {
  const simPrefix  = ref('+34');
  const simCountry = ref('ES');
  const simName    = ref('España');
  const ipCountry     = ref('ES');
  const ipCity        = ref('Madrid');
  const ipRegion      = ref(null);
  const ipCountryName = ref(null);
  const docCountry = ref(null);

  const tzCountry  = ref(null);
  const langCountry = ref(null);

  const confidence = computed(() => {
    // GPS is the strongest signal — if available, dominates the score
    if (gpsReady.value) {
      let score = 60; // GPS base
      if (ipCountry.value) score += 25;  // IP also present
      if (tzCountry.value && tzCountry.value === ipCountry.value) score += 10;
      if (langCountry.value && langCountry.value === ipCountry.value) score += 5;
      return Math.min(100, score);
    }
    // Without GPS: IP + secondary signals
    let score = 0;
    if (ipCountry.value) score += 40;
    if (tzCountry.value  && tzCountry.value  === ipCountry.value) score += 30;
    if (langCountry.value && langCountry.value === ipCountry.value) score += 20;
    if (tzCountry.value && langCountry.value && tzCountry.value === langCountry.value) score += 10;
    return Math.min(100, score);
  });
  async function detectCountryByIp() {
    try {
    const res = await fetch('https://ipapi.co/json/');
     const data = await res.json();
      if (data.country_code) {
        ipCountry.value = data.country_code;
        ipCity.value = data.city || '';
        ipRegion.value = data.region || null;
        ipCountryName.value = data.country_name || null;
        // NOTE: simCountry must NOT be overwritten with IP country.
        // simCountry reflects the phone prefix chosen by the user.
        // IP country is stored separately in ipCountry for confidence calculation.
        // Actualizar nombre y prefijo según país detectado
        const countryNames = {
          'MT': 'Malta', 'ES': 'España', 'NL': 'Países Bajos', 'GB': 'Reino Unido',
          'FR': 'Francia', 'DE': 'Alemania', 'IT': 'Italia', 'PT': 'Portugal',
          'BE': 'Bélgica', 'US': 'Estados Unidos', 'MX': 'México', 'AR': 'Argentina',
          'BR': 'Brasil', 'CO': 'Colombia', 'CL': 'Chile', 'PE': 'Perú',
          'UY': 'Uruguay', 'VE': 'Venezuela', 'JP': 'Japón', 'CN': 'China',
          'AU': 'Australia', 'CA': 'Canadá', 'SE': 'Suecia', 'NO': 'Noruega',
          'DK': 'Dinamarca', 'FI': 'Finlandia', 'PL': 'Polonia', 'UA': 'Ucrania',
          'RU': 'Rusia', 'TR': 'Turquía', 'ZA': 'Sudáfrica', 'IN': 'India',
        };
        const countryPrefixes = {
          'MT': '+356', 'ES': '+34', 'NL': '+31', 'GB': '+44',
          'FR': '+33', 'DE': '+49', 'IT': '+39', 'PT': '+351',
          'BE': '+32', 'US': '+1', 'MX': '+52', 'AR': '+54',
          'BR': '+55', 'CO': '+57', 'CL': '+56', 'PE': '+51',
          'UY': '+598', 'VE': '+58', 'JP': '+81', 'CN': '+86',
          'AU': '+61', 'CA': '+1', 'SE': '+46', 'NO': '+47',
          'DK': '+45', 'FI': '+358', 'PL': '+48', 'UA': '+380',
          'RU': '+7', 'TR': '+90', 'ZA': '+27', 'IN': '+91',
        };
        // Update simName and simPrefix for UI display (country selector default)
        // simCountry must NOT be overwritten — it reflects the phone prefix chosen by the user
        // IP country is stored separately in ipCountry for confidence calculation
        if (!localStorage.getItem('vc_sim_set_by_user')) {
          // Only update the UI selector if the user hasn't manually chosen a prefix
          simName.value = countryNames[data.country_code] || data.country_code;
          simPrefix.value = countryPrefixes[data.country_code] || '';
          // simCountry stays as default (ES) until user explicitly selects a prefix
        }
      }
    } catch { /* silencioso */ }
  }
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

  // ── GPS boost ────────────────────────────────────────────────────────────
  const gpsLat      = ref(null);
  const gpsLng      = ref(null);
  const gpsAccuracy = ref(null);
  const gpsCity     = ref(null);
  const gpsRegion   = ref(null);
  const gpsPais     = ref(null);
  const gpsReady    = ref(false);

  async function requestGps() {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve(false);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          gpsLat.value      = pos.coords.latitude;
          gpsLng.value      = pos.coords.longitude;
          gpsAccuracy.value = pos.coords.accuracy;
          // Reverse geocode via Nominatim
          try {
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${gpsLat.value}&lon=${gpsLng.value}&format=json`,
              { headers: { 'Accept-Language': 'es', 'User-Agent': 'VoiceProtest/1.0' } }
            );
            const geo = await res.json();
            gpsCity.value   = geo.address?.city || geo.address?.town || geo.address?.village || null;
            gpsRegion.value = geo.address?.state || null;
            gpsPais.value   = geo.address?.country || null;
          } catch { /* silencioso */ }
          gpsReady.value = true;
          resolve(true);
        },
        () => resolve(false),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  return {
    simPrefix, simCountry, simName, ipCountry, ipCity, docCountry,
    confidence, myRegions, regionLabel,
    setDocCountry, getLocks, setLock, getDeviceId, setDeviceId,
    tzCountry, langCountry, detectSecondarySignals, detectCountryByIp, ipRegion, ipCountryName,
    gpsLat, gpsLng, gpsAccuracy, gpsCity, gpsRegion, gpsPais, gpsReady, requestGps,
  };
});
