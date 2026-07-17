<template>
  <div class="screen active" id="s-auth">
    <div class="auth-wrap">

      <!-- Contexto de la convocatoria — título, destinatario, demandas -->
      <div v-if="joiningProtest" class="auth-protest-card">
        <div class="auth-protest-title">{{ joiningProtest.title }}</div>
        <div v-if="joiningProtest.focal_point" class="auth-protest-focal">
          <span class="auth-protest-label">{{ $t('detail.directedAt') }}:</span>
          {{ joiningProtest.focal_point }}
        </div>
        <div v-if="joiningProtest.demands" class="auth-protest-demands">
          <span class="auth-protest-label">⚡ {{ $t('detail.whatWeDemand') }}:</span>
          {{ joiningProtest.demands }}
        </div>
      </div>

      <div class="auth-divider"></div>

      <!-- Phone input -->
      <div class="auth-phone-label">{{ $t('auth.title') }}</div>

      <div style="width:100%" v-if="!otpVisible">
        <div class="phone-wrap">
          <label for="cc-sel" class="sr-only">{{ $t('auth.prefixLabel') }}</label>
          <select id="cc-sel" class="cc-sel cc-sel-visible" v-model="countryCode" :disabled="countryCodes.length === 0">
            <option v-if="countryCodes.length === 0" :value="countryCode">...</option>
            <option v-for="c in countryCodes" :key="c.iso2" :value="c.iso2">
              {{ c.flag }} +{{ c.dial_code }}
            </option>
          </select>
          <label for="phone-in" class="sr-only">{{ $t('auth.phoneLabel') }}</label>
          <input id="phone-in" class="phone-in phone-in-visible" type="tel" v-model="phone"
            :placeholder="$t('auth.phonePlaceholder')" maxlength="12"
            :aria-label="$t('auth.phoneLabel')" autofocus>
        </div>
        <button class="btn-primary auth-submit-btn"
          :disabled="phone.replace(/\D/g,'').length < 6 || sending"
          @click="sendSMS">
          {{ sending ? $t('auth.sending') : $t('auth.sendCode') }}
        </button>
      </div>

      <!-- OTP input -->
      <div v-if="otpVisible" style="width:100%;margin-top:4px">
        <div class="auth-otp-sent">{{ $t('auth.otpSent') }}</div>
        <div class="otp-row">
          <input v-for="(_, i) in 6" :key="i" class="otp-box otp-box-visible" type="tel" maxlength="1"
            :ref="el => { if (el) otpRefs[i] = el }"
            v-model="otpDigits[i]"
            @input="onOtpInput(i)"
            inputmode="numeric"
            :autocomplete="i === 0 ? 'one-time-code' : 'off'"
            :aria-label="$t('auth.otpDigit', { n: i + 1 })">
        </div>
        <div class="auth-resend">
          {{ $t('auth.resendQuestion') }}
          <span class="auth-resend-link" @click="ui.showToast($t('auth.resendToast'))">{{ $t('auth.resend') }}</span>
        </div>
        <button class="btn-primary auth-submit-btn" @click="verifyOTP">{{ $t('auth.verify') }}</button>
      </div>

      <!-- Modal GPS -->
      <div v-if="showGpsModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px">
        <div style="background:var(--bg2);border:.5px solid var(--border2);border-radius:var(--r2);padding:24px;max-width:340px;width:100%">
          <div style="font-size:24px;text-align:center;margin-bottom:12px">📍</div>
          <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:16px;margin-bottom:10px;text-align:center">{{ $t('auth.gpsTitle') }}</div>
          <div style="font-size:14px;color:var(--text2);line-height:1.6;margin-bottom:20px;text-align:center">
            {{ $t('auth.gpsNote') }}
          </div>
          <button class="btn-primary" style="width:100%;margin-bottom:8px" @click="aceptarGps">
            📍 {{ $t('auth.gpsAccept') }}
          </button>
          <button @click="rechazarGps"
            style="width:100%;padding:10px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);color:var(--text2);font-size:13px;cursor:pointer">
            {{ $t('auth.gpsDecline') }}
          </button>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.auth-protest-card {
  width: 100%;
  margin-bottom: 4px;
  text-align: left;
}
.auth-protest-title {
  font-family: 'Syne', sans-serif;
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
  line-height: 1.35;
  margin-bottom: 10px;
}
.auth-protest-focal {
  font-size: 16px;
  color: var(--text2);
  margin-bottom: 8px;
  line-height: 1.5;
}
.auth-protest-demands {
  font-size: 16px;
  color: var(--text);
  line-height: 1.6;
}
.auth-protest-label {
  font-weight: 700;
  color: var(--accent2);
  margin-right: 4px;
}
.auth-divider {
  width: 100%;
  height: .5px;
  background: var(--border);
  margin: 16px 0;
}
.auth-phone-label {
  width: 100%;
  font-size: 17px;
  font-weight: 600;
  color: var(--text2);
  margin-bottom: 10px;
  text-align: left;
}
/* Inputs con borde blanco visible */
.cc-sel-visible {
  border: 1.5px solid rgba(255,255,255,0.5) !important;
  color: var(--text) !important;
}
.phone-in-visible {
  border: 1.5px solid rgba(255,255,255,0.5) !important;
  color: var(--text) !important;
}
.phone-in-visible::placeholder {
  color: var(--text3);
}
.otp-box-visible {
  border: 1.5px solid rgba(255,255,255,0.5) !important;
  color: var(--text) !important;
  font-size: 20px !important;
}
.otp-box-visible:focus {
  border-color: var(--accent2) !important;
  outline: none;
}
.auth-submit-btn {
  width: 100%;
  margin-top: 14px;
  padding: 14px;
  font-size: 16px;
  font-weight: 700;
}
.auth-otp-sent {
  font-size: 16px;
  color: var(--text2);
  margin-bottom: 14px;
  line-height: 1.6;
  text-align: center;
}
.auth-resend {
  font-size: 15px;
  color: var(--text2);
  margin-bottom: 12px;
  text-align: center;
  margin-top: 10px;
}
.auth-resend-link {
  color: var(--accent);
  cursor: pointer;
  font-weight: 600;
}
</style>

<script setup>
import { useProtestsStore } from '@/stores/protests.js';
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '@/stores/ui.js';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const router = useRouter();
const ui     = useUiStore();

const protestsStoreRef = useProtestsStore();
const joiningProtest = computed(() => {
  const id = sessionStorage.getItem('vc_last_joined');
  return id ? protestsStoreRef.protests.find(p => String(p.id) === String(id)) : null;
});

const countryCode  = ref('ES');
const countryCodes = ref([]);
const dialCode     = computed(() => {
  const c = countryCodes.value.find(c => c.iso2 === countryCode.value);
  return c ? c.dial_code : 34;
});
const phone        = ref('');
const sending      = ref(false);
const otpVisible   = ref(false);
const otpDigits    = ref(['', '', '', '', '', '']);
const otpRefs      = ref([]);
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

const captchaStatusClass = ref('verif-loading');
const captchaIco         = ref('⏳');
const captchaTxt         = ref('');
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

import * as api from '@/services/api.js';
import { useDeviceStore } from '@/stores/device.js';
const device = useDeviceStore();

onMounted(async () => {
  try {
    await getRecaptchaToken('load');
    captchaStatusClass.value = 'verif-ok';
  } catch {
    captchaStatusClass.value = 'verif-error';
  }

  try {
    countryCodes.value = await api.fetchCountryCodes();
    const dev = useDeviceStore();
    if (dev.ipCountry) {
      countryCode.value = dev.ipCountry;
    }
  } catch { /* Fallback */ }
});

// GPS para local/regional — se pide justo después de pulsar "Recibir código"
// (dentro de sendSMS), no nada más entrar en la pantalla. Sigue siendo
// pre-adhesión: el dato viaja en la misma llamada de adhesión que hace
// VerifyScreen, solo cambia el instante dentro de este flujo.
async function requestGpsFlow() {
  const riskLevel = sessionStorage.getItem('vc_risk_level') || 'low';
  const scope = sessionStorage.getItem('vc_protest_scope') || 'national';
  if (!((scope === 'regional' || scope === 'local') &&
        (riskLevel === 'low' || riskLevel === 'med') &&
        !device.gpsReady)) {
    return;
  }
  const accepted = await new Promise(resolve => {
    gpsResolve = resolve;
    showGpsModal.value = true;
  });
  if (accepted) {
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject,
          { enableHighAccuracy: true, timeout: 10000 })
      );
      ui.setGps(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      localStorage.setItem('vc_gps_lat', pos.coords.latitude);
      localStorage.setItem('vc_gps_lng', pos.coords.longitude);
      localStorage.setItem('vc_gps_accuracy', pos.coords.accuracy);
      localStorage.setItem('vc_gps_ts', Date.now());
    } catch { /* sin GPS */ }
  }
}

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

  // GPS para local/regional — ahora se pide aquí, justo tras pulsar el botón,
  // en vez de nada más entrar en la pantalla (ver requestGpsFlow más arriba).
  await requestGpsFlow();

  if (device.gpsReady) {
    await new Promise(r => setTimeout(r, 300));
  }

  const existingDevice = await api.fetchDeviceLocks(device.getDeviceId());
  if (existingDevice && existingDevice.length > 0) {
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
    startWebOtpListener();
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
  // iOS Safari doesn't implement the WebOTP JS API at all — its only
  // autofill mechanism is the passive `autocomplete="one-time-code"`
  // suggestion, which some iOS versions deliver as the FULL 6-digit string
  // typed into whichever box carries that attribute (box 0 here), ignoring
  // its maxlength="1". Detect that case and redistribute across all boxes,
  // instead of just keeping the first digit and discarding the rest.
  if (otpDigits.value[i] && otpDigits.value[i].length > 1) {
    fillOtpDigits(otpDigits.value[i]);
    return;
  }
  if (otpDigits.value[i] && i < 5) otpRefs.value[i + 1]?.focus();
}

// Splits a full code string (from iOS's multi-char autofill, or from the
// WebOTP API result on Android/Chrome) across the 6 boxes, focuses the
// last one, and auto-submits — the person never has to open the SMS app
// or type anything by hand.
function fillOtpDigits(codeStr) {
  const digits = (codeStr || '').replace(/\D/g, '').slice(0, 6).split('');
  if (digits.length < 6) return;
  digits.forEach((d, idx) => { otpDigits.value[idx] = d; });
  otpRefs.value[5]?.focus();
  verifyOTP();
}

let otpAbortController = null;

// Android/Chrome only (Safari never implemented this API — see onOtpInput
// above for its separate, passive mechanism). Requires the SMS to end with
// "@voiceprotest.org #123456" — see the Twilio Verify custom template.
function startWebOtpListener() {
  if (!('OTPCredential' in window)) return;
  otpAbortController?.abort();
  otpAbortController = new AbortController();
  navigator.credentials
    .get({ otp: { transport: ['sms'] }, signal: otpAbortController.signal })
    .then(otp => { if (otp?.code) fillOtpDigits(otp.code); })
    .catch(() => { /* aborted (left the screen) or no matching SMS arrived — silent */ });
}

onUnmounted(() => otpAbortController?.abort());

async function verifyOTP() {
  otpAbortController?.abort();
  const code = otpDigits.value.join('');
  if (code.length < 6) { ui.showToast(t('auth.otpError')); return; }
  sending.value = true;
  try {
    const v = phone.value.replace(/\D/g, '');
    const deviceId  = device.getDeviceId();
    const res = await api.verifyOtp({ phone: '+' + dialCode.value + v, otp: code, device_id: deviceId, country_code: countryCode.value });
    sessionStorage.setItem('vc_phone_hash', res.phone_hash);
    sessionStorage.setItem('vc_device_id',  res.device_id || deviceId);
    sessionStorage.setItem('vc_sms_sent', 'true');
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
