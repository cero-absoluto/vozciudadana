import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { REGIONS } from '@/constants.js';

export const useDeviceStore = defineStore('device', () => {
  const simPrefix  = ref('');
  const simCountry = ref('');
  const simName    = ref('');
  const ipCountry     = ref(localStorage.getItem('vc_ip_country') || '');
  const ipCity        = ref('');
  const ipRegion      = ref(null);
  const ipCountryName = ref(null);
  const docCountry = ref(null);

  const tzCountry  = ref(null);
  const langCountry = ref(null);

  const confidence = computed(() => {
    // GPS is the strongest physical-presence signal. When available, IP+GPS
    // agreement dominates the score; timezone and language are auxiliary signals
    // (they reflect device configuration, not physical location) and are compared
    // against the GPS country — so a person physically present abroad with a
    // foreign-configured device is not penalised.
    if (gpsReady.value) {
      let score = 60; // GPS base — physical presence
      if (ipCountry.value) score += 15;                                                  // IP also present
      if (gpsCountryCode.value && gpsCountryCode.value === ipCountry.value) score += 20;  // GPS agrees with IP (real physical agreement)
      if (tzCountry.value   && tzCountry.value   === gpsCountryCode.value) score += 10;   // timezone matches GPS country
      if (langCountry.value && langCountry.value === gpsCountryCode.value) score += 5;    // language matches GPS country
      return Math.min(100, score);
    }
    // Without GPS: IP + secondary signals (timezone, language)
    let score = 0;
    if (ipCountry.value) score += 40;
    if (tzCountry.value  && tzCountry.value  === ipCountry.value) score += 30;
    if (langCountry.value && langCountry.value === ipCountry.value) score += 20;
    if (tzCountry.value && langCountry.value && tzCountry.value === langCountry.value) score += 10;
    return Math.min(100, score);
  });
  async function detectCountryByIp() {
    try {
    const API_BASE = import.meta.env.VITE_API_URL || 'https://api.voiceprotest.org';
    const res = await fetch(`${API_BASE}/api/ipinfo`);
     const data = await res.json();
      if (data.country_code) {
        ipCountry.value = data.country_code;
        try { localStorage.setItem('vc_ip_country', data.country_code); } catch {}
        ipCity.value = data.city || '';
        ipRegion.value = data.region || null;
        ipCountryName.value = data.country_name || null;
        // NOTE: simCountry must NOT be overwritten with IP country.
        // simCountry reflects the phone prefix chosen by the user.
        // IP country is stored separately in ipCountry for confidence calculation.
        if (!localStorage.getItem('vc_sim_set_by_user')) {
          // Use Intl.DisplayNames for the country name — covers all 249 ISO countries
          // in the current UI language, no hardcoded list needed.
          const displayName = new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' });
          simName.value = displayName.of(data.country_code) || data.country_name || data.country_code;

          // Fetch the dial code from the country-codes endpoint (already cached by the
          // CreateScreen selector). Falls back silently — prefix just stays empty.
          try {
            const codesRes = await fetch(`${API_BASE}/api/country-codes`);
            const codes = await codesRes.json();
            const match = codes.find(c => c.iso2 === data.country_code);
            if (match) simPrefix.value = '+' + match.dial_code;
          } catch { /* silencioso — el prefijo queda vacío */ }
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
  const gpsCountryCode = ref(null);  // ISO code (e.g. 'MT') — for confidence comparisons; gpsPais keeps the display name
  const gpsReady    = ref(false);

  async function requestGps() {
    if (!('geolocation' in navigator)) return false;

    // Helper: wrap getCurrentPosition as a Promise
    function getPos(opts) {
      return new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, opts)
      );
    }

    let pos = null;

    // Intento 1: alta precisión (GPS real) — hasta 10s
    try {
      pos = await getPos({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    } catch {
      // Intento 2: baja precisión (WiFi/red) — hasta 8s
      // Útil cuando el GPS del dispositivo no está disponible (interior, WiFi only)
      try {
        pos = await getPos({ enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 });
      } catch {
        return false; // Usuario denegó o sin señal — sin feedback, decisión suya
      }
    }

    gpsLat.value      = pos.coords.latitude;
    gpsLng.value      = pos.coords.longitude;
    gpsAccuracy.value = pos.coords.accuracy;

    // Reverse geocode via backend proxy — never call Nominatim directly
    // from the browser (would expose user's real IP to OpenStreetMap).
    try {
      const API_BASE = import.meta.env.VITE_API_URL || 'https://api.voiceprotest.org';
      const res = await fetch(
        `${API_BASE}/api/geocode?lat=${gpsLat.value}&lon=${gpsLng.value}`
      );
      const geo = await res.json();
      gpsCity.value        = geo.city         || null;
      gpsRegion.value      = geo.region       || null;
      gpsPais.value        = geo.country      || null;
      gpsCountryCode.value = geo.country_code || null;
    } catch { /* silencioso — las coordenadas ya están disponibles */ }

    gpsReady.value = true;
    return true;
  }

  return {
    simPrefix, simCountry, simName, ipCountry, ipCity, docCountry,
    confidence, myRegions, regionLabel,
    setDocCountry, getLocks, setLock, getDeviceId, setDeviceId,
    tzCountry, langCountry, detectSecondarySignals, detectCountryByIp, ipRegion, ipCountryName,
    gpsLat, gpsLng, gpsAccuracy, gpsCity, gpsRegion, gpsPais, gpsCountryCode, gpsReady, requestGps,
  };
});
