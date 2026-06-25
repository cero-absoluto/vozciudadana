<template>
  <div class="screen active" id="s-auth">
    <div class="auth-wrap">
      <div class="auth-ico">📱</div>
      <div class="auth-h">{{ $t('auth.title') }}</div>
      <div class="auth-p">{{ $t('auth.subtitle') }}</div>

      <!-- reCAPTCHA status -->
      <div class="verif-strip" :class="captchaStatusClass" style="width:100%;margin-bottom:10px">
        <span>{{ captchaIco }}</span>
        <span>{{ captchaTxt }}</span>
      </div>

      <!-- Phone input -->
      <div style="width:100%" v-if="!otpVisible">
        <div class="phone-wrap">
          <label for="cc-sel" class="sr-only">{{ $t('auth.prefixLabel') }}</label>
          <select id="cc-sel" class="cc-sel" v-model="countryCode" :disabled="countryCodes.length === 0">
            <option v-if="countryCodes.length === 0" :value="countryCode">...</option>
            <option v-for="c in countryCodes" :key="c.iso2" :value="c.iso2">
              {{ c.flag }} +{{ c.dial_code }}
            </option>
          </select>
          <label for="phone-in" class="sr-only">{{ $t('auth.phoneLabel') }}</label>
          <input id="phone-in" class="phone-in" type="tel" v-model="phone" :placeholder="$t('auth.phonePlaceholder')" maxlength="12" :aria-label="$t('auth.phoneLabel')">
        </div>
        <div class="input-hint">{{ $t('auth.hashHint') }}</div>
        <div class="hash-label">{{ $t('auth.hashLabel') }}</div>
        <div class="hash-prev">{{ hashDisplay }}</div>
        <button class="btn-primary" style="width:100%;margin-top:8px;position:sticky;bottom:8px" :disabled="phone.replace(/\D/g,'').length < 6 || sending" @click="sendSMS">
          {{ sending ? $t('auth.sending') : $t('auth.sendCode') }}
        </button>
      </div>

      <!-- OTP input -->
      <div v-if="otpVisible" style="width:100%;margin-top:12px">
        <div style="font-size:14px;color:var(--text);margin-bottom:12px;line-height:1.7;text-align:center">
          {{ $t('auth.otpSent') }}
        </div>
        <div class="otp-row">
          <input v-for="(_, i) in 6" :key="i" class="otp-box" type="tel" maxlength="1"
            :ref="el => { if (el) otpRefs[i] = el }"
            v-model="otpDigits[i]"
            @input="onOtpInput(i)"
            :aria-label="$t('auth.otpDigit', { n: i + 1 })">
        </div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:10px;text-align:center">
          {{ $t('auth.resendQuestion') }} <span style="color:var(--accent);cursor:pointer" @click="ui.showToast($t('auth.resendToast'))">{{ $t('auth.resend') }}</span>
        </div>
        <button class="btn-primary" style="width:100%" @click="verifyOTP">{{ $t('auth.verify') }}</button>
      </div>

      <!-- Advanced options -->
      <div style="width:100%;margin-top:14px">
        <button @click="advOpen = !advOpen"
          style="width:100%;padding:10px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);font-size:13px;color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px">
          {{ $t('auth.advancedOptions') }} <span>{{ advOpen ? '▲' : '▼' }}</span>
        </button>
        <div v-if="advOpen" style="margin-top:8px">
          <div class="auth-opts">
            <div class="auth-opt" @click="ui.showToast($t('auth.worldIdSoon'))">
              <div class="ao-ico" style="background:rgba(124,111,255,.08)">🌐</div>
              <div><div class="ao-title">World ID<span class="ao-badge badge-max">{{ $t('auth.worldIdBadge') }}</span></div><div class="ao-desc">{{ $t('auth.worldIdDesc') }}</div></div>
            </div>
            <div class="auth-opt" @click="ui.showToast($t('auth.highRiskSoon'))">
              <div class="ao-ico" style="background:rgba(255,107,107,.08)">🕵️</div>
              <div><div class="ao-title">{{ $t('auth.highRiskTitle') }}</div><div class="ao-desc">{{ $t('auth.highRiskDesc') }}</div></div>
            </div>
          </div>
        </div>
      </div>
<!-- Modal GPS -->
      <div v-if="showGpsModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px">
        <div style="background:var(--bg2);border:.5px solid var(--border2);border-radius:var(--r2);padding:24px;max-width:340px;width:100%">
          <div style="font-size:24px;text-align:center;margin-bottom:12px">📍</div>
          <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:14px;margin-bottom:10px;text-align:center">{{ $t('auth.gpsTitle') }}</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:20px;text-align:center">
            {{ $t('auth.gpsBody') }}<br><br>
            <strong style="color:var(--accent2)">{{ $t('auth.gpsNote') }}</strong>
          </div>
          <button class="btn-primary" style="width:100%;margin-bottom:8px" @click="aceptarGps">
            📍 {{ $t('auth.gpsAccept') }}
          </button>
          <button @click="rechazarGps"
            style="width:100%;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);color:var(--text2);font-size:10px;cursor:pointer">
            {{ $t('auth.gpsDecline') }}
          </button>
        </div>
      </div>
      <div class="anon-note" style="margin-top:10px">🛡️ {{ $t('auth.anonNote') }}</div>
    </div>
  </div>
</template>

<script setup>
import { useProtestsStore } from '@/stores/protests.js';
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '@/stores/ui.js';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const router = useRouter();
const ui     = useUiStore();

const countryCode  = ref('ES');
const countryCodes = ref([]);
const dialCode     = computed(() => {
  const c = countryCodes.value.find(c => c.iso2 === countryCode.value);
  return c ? c.dial_code : 34;
});
const phone        = ref('');
const sending      = ref(false);
const otpVisible   = ref(false);
const otpDigits    = ref(['1','2','3','4','5','6']);
const otpRefs      = ref([]);
const advOpen      = ref(false);
  const showGpsModal = ref(false);
let gpsResolve = null;

function aceptarGps() {
  showGpsModal.value = false;
  if (gpsResolve) gpsResolve(true);
}

function rechazarGps() {
  showGpsModal.value = false;
  if (gpsResolve) gpsResolve(false);
}

// reCAPTCHA status
const captchaStatusClass = ref('verif-loading');
const captchaIco         = ref('⏳');
const captchaTxt         = ref('Verificando que eres humano...');

const RECAPTCHA_KEY = import.meta.env.VITE_RECAPTCHA_KEY;

async function getRecaptchaToken(action) {
  return new Promise((resolve, reject) => {
    if (typeof window.grecaptcha === 'undefined' || !RECAPTCHA_KEY) {
      reject(new Error('reCAPTCHA no disponible'));
      return;
    }
    window.grecaptcha.ready(() => {
      window.grecaptcha.execute(RECAPTCHA_KEY, { action })
        .then(t => resolve(t))
        .catch(err => reject(err));
    });
  });
}

onMounted(async () => {
  try {
    await getRecaptchaToken('load');
    captchaStatusClass.value = 'verif-ok';
    captchaIco.value  = '✓';
    captchaTxt.value  = t('auth.captchaOk');
  } catch {
    captchaStatusClass.value = 'verif-error';
    captchaIco.value = '⚠️';
    captchaTxt.value = t('auth.captchaFail');
  }

  try {
    countryCodes.value = await api.fetchCountryCodes();
    const dev = useDeviceStore();
    if (dev.ipCountry) {
      countryCode.value = dev.ipCountry;
    }
  } catch {
    // Fallback
  }
});

  // The pseudonymous identifier is computed server-side with HMAC after OTP
  // verification — it is never derived in the browser (a client-side hash could
  // only be plain SHA-256, which is dictionary-attackable). We therefore show an
  // explanatory message instead of a live, inaccurate client-side hash preview.
  const hashDisplay = ref(t('auth.hashPlaceholder'));

import * as api from '@/services/api.js';
import { useDeviceStore } from '@/stores/device.js';
const device = useDeviceStore();

async function sendSMS() {
  if (sending.value) return;
  sending.value = true;
  const protestScope = sessionStorage.getItem('vc_protest_scope') || 'national';
  if (protestScope === 'national') {
    const lastId = sessionStorage.getItem('vc_last_joined');
    const protestsStore = useProtestsStore();
    const protest = protestsStore.protests.find(p => String(p.id) === lastId);
    if (protest?.country && protest.country !== countryCode.value) {
      ui.showToast(t('auth.wrongCountry', { country: protest.country_name }));
      sending.value = false;
      return;
    }
  }

  // GPS: if already obtained from homescreen strengthen button, use it directly
  const riskLevel = sessionStorage.getItem('vc_risk_level') || 'low';
  const scope = sessionStorage.getItem('vc_protest_scope') || 'national';

  if (scope === 'national' && (riskLevel === 'low' || riskLevel === 'med')) {
    if (device.gpsReady) {
      // GPS already obtained from the Strengthen button on the home screen — use it
      ui.setGps(device.gpsLat, device.gpsLng, device.gpsAccuracy);
      localStorage.setItem('vc_gps_lat', device.gpsLat);
      localStorage.setItem('vc_gps_lng', device.gpsLng);
      localStorage.setItem('vc_gps_accuracy', device.gpsAccuracy);
      localStorage.setItem('vc_gps_ts', Date.now());
      localStorage.setItem('vc_geo_ciudad', device.gpsCity || '');
      localStorage.setItem('vc_geo_region', device.gpsRegion || '');
      localStorage.setItem('vc_geo_pais', device.gpsPais || '');
    } else {
      // GPS not yet obtained — show modal to ask
      const accepted = await new Promise(resolve => {
        gpsResolve = resolve;
        showGpsModal.value = true;
      });
      if (accepted) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
          });
          ui.setGps(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
          localStorage.setItem('vc_gps_lat', pos.coords.latitude);
          localStorage.setItem('vc_gps_lng', pos.coords.longitude);
          localStorage.setItem('vc_gps_accuracy', pos.coords.accuracy);
          localStorage.setItem('vc_gps_ts', Date.now());
          try {
            // Reverse geocode via backend proxy — never call Nominatim directly
            // from the browser (would expose user's real IP to OpenStreetMap).
            const API_BASE = import.meta.env.VITE_API_URL || 'https://api.voiceprotest.org';
            const geoRes = await fetch(
              `${API_BASE}/api/geocode?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`
            );
            const geoData = await geoRes.json();
            const gpsCiudad = geoData.city    || null;
            const gpsRegion = geoData.region  || null;
            const gpsPais   = geoData.country || null;
            localStorage.setItem('vc_geo_ciudad', gpsCiudad || '');
            localStorage.setItem('vc_geo_region', gpsRegion || '');
            localStorage.setItem('vc_geo_pais', gpsPais || '');
          } catch { /* silencioso */ }
        } catch (gpsErr) {
          console.log('GPS error:', gpsErr);
          ui.clearGps();
        }
      }
    } // end else (GPS not ready)
  } // end if national scope
  // Esperar a que el GPS se guarde completamente
    await new Promise(r => setTimeout(r, 500));
  
  // Si el dispositivo ya está verificado, saltar OTP
  const existingDevice = await api.fetchDeviceLocks(device.getDeviceId());
  if (existingDevice && existingDevice.length > 0) {
    // Device already verified — fetch the canonical server-side (HMAC) phone_hash.
    // The client never recomputes an identity hash itself.
    const dev = await api.fetchDevice(device.getDeviceId());
    sessionStorage.setItem('vc_phone_hash', dev.phone_hash);
    sessionStorage.setItem('vc_device_id', device.getDeviceId());
    sessionStorage.setItem('vc_sms_sent', 'false');
    router.push('/verify');
    return;
  }
  const v = phone.value.replace(/\D/g, '');
  if (v.length < 6) { sending.value = false; return; }
  try {
    let token = '';
    try { token = await getRecaptchaToken('request_otp'); } catch { /* dev mode */ }
    const protestId = sessionStorage.getItem('vc_last_joined') || null;
    const res = await api.requestOtp({ phone: '+' + dialCode.value + v, recaptcha_token: token || 'dev', protest_id: protestId });
    if (res && res.sent === false) {
      ui.showToast(t('auth.verificationCannotContinue'));
      return;
    }
    otpDigits.value = ['', '', '', '', '', ''];
    otpVisible.value = true;
  } catch (err) {
    if (err.status === 429 || err.message?.includes('429') || err.code === 'otp_rate_limited') {
      ui.showToast(t('auth.otpRateLimited'));
    } else {
      ui.showToast(t('auth.sendError'));
    }
  } finally {
    sending.value = false;
  }
}

function onOtpInput(i) {
  if (otpDigits.value[i] && i < 5) otpRefs.value[i + 1]?.focus();
}

async function verifyOTP() {
  const code = otpDigits.value.join('');
  if (code.length < 6) { ui.showToast(t('auth.otpError')); return; }
  sending.value = true;
  try {
    const v = phone.value.replace(/\D/g, '');
    const deviceId  = device.getDeviceId();
    const res = await api.verifyOtp({ phone: '+' + dialCode.value + v, otp: code, device_id: deviceId, country_code: countryCode.value });
    // The identity hash is computed server-side with HMAC and returned here.
    // The client never derives a persistent identity hash itself (a browser
    // cannot hold the HMAC secret, so any client-side hash would be plain
    // SHA-256 and dictionary-attackable).
    sessionStorage.setItem('vc_phone_hash', res.phone_hash);
    sessionStorage.setItem('vc_device_id',  res.device_id || deviceId);
    sessionStorage.setItem('vc_sms_sent', 'true');
    // Sync local device_id with the canonical one from the server (anchored to phone_hash).
    // If localStorage was cleared and the phone was already verified, the server returns
    // the original device_id so the user keeps their identity across sessions.
    if (res.device_id && res.device_id !== deviceId) {
      device.setDeviceId(res.device_id);
      sessionStorage.setItem('vc_device_id', res.device_id);
    }
    router.push('/verify');
  } catch (err) {
    ui.showToast(t('auth.otpIncorrect'));
  } finally {
    sending.value = false;
  }
}
</script>
