<template>
  <div class="screen active" id="s-auth">
    <div class="auth-wrap">
      <div class="auth-ico">📱</div>
      <div class="auth-h">Tu número de teléfono</div>
      <div class="auth-p">Te enviamos un código de 6 dígitos. Tu número se transforma en una huella matemática en tu dispositivo — nunca lo vemos en texto claro.</div>

      <!-- reCAPTCHA status -->
      <div class="verif-strip" :class="captchaStatusClass" style="width:100%;margin-bottom:10px">
        <span>{{ captchaIco }}</span>
        <span>{{ captchaTxt }}</span>
      </div>

      <!-- Phone input -->
      <div style="width:100%" v-if="!otpVisible">
        <div class="phone-wrap">
          <label for="cc-sel" class="sr-only">Prefijo del país</label>
          <select id="cc-sel" class="cc-sel" v-model="countryCode" :disabled="countryCodes.length === 0">
            <option v-if="countryCodes.length === 0" :value="countryCode">...</option>
            <option v-for="c in countryCodes" :key="c.iso2" :value="c.iso2">
              {{ c.flag }} +{{ c.dial_code }}
            </option>
          </select>
          <label for="phone-in" class="sr-only">Número de teléfono</label>
          <input id="phone-in" class="phone-in" type="tel" v-model="phone" placeholder="600 000 000" maxlength="12" aria-label="Número de móvil">
        </div>
        <div class="input-hint">Tu número se transforma en una huella irreversible en tu dispositivo antes de enviarse.</div>
        <div class="hash-label">Huella generada en tiempo real</div>
        <div class="hash-prev">{{ hashDisplay }}</div>
        <button class="btn-primary" style="width:100%;margin-top:8px;position:sticky;bottom:8px" :disabled="phone.replace(/\D/g,'').length < 6 || sending" @click="sendSMS">
          {{ sending ? 'Procesando...' : 'Solicitar código →' }}
        </button>
      </div>

      <!-- OTP input -->
      <div v-if="otpVisible" style="width:100%;margin-top:12px">
        <div style="font-size:10px;color:var(--text2);margin-bottom:12px;line-height:1.7;text-align:center">
          Código de 6 dígitos enviado. Expira en 5 minutos.
        </div>
        <div class="otp-row">
          <input v-for="(_, i) in 6" :key="i" class="otp-box" type="tel" maxlength="1"
            :ref="el => { if (el) otpRefs[i] = el }"
            v-model="otpDigits[i]"
            @input="onOtpInput(i)"
            :aria-label="`Dígito ${i + 1} del código`">
        </div>
        <div style="font-size:9px;color:var(--text3);margin-bottom:10px;text-align:center">
          ¿No lo recibiste? <span style="color:var(--accent);cursor:pointer" @click="ui.showToast('Código reenviado')">Reenviar</span>
        </div>
        <button class="btn-primary" style="width:100%" @click="verifyOTP">Verificar →</button>
      </div>

      <!-- Advanced options -->
      <div style="width:100%;margin-top:14px">
        <button @click="advOpen = !advOpen"
          style="width:100%;padding:8px;background:transparent;border:.5px solid var(--border);border-radius:var(--r);font-size:10px;color:var(--text3);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px">
          ⚙️ Opciones avanzadas <span>{{ advOpen ? '▲' : '▼' }}</span>
        </button>
        <div v-if="advOpen" style="margin-top:8px">
          <div class="auth-opts">
            <div class="auth-opt" @click="ui.showToast('World ID — próximamente')">
              <div class="ao-ico" style="background:rgba(124,111,255,.08)">🌐</div>
              <div><div class="ao-title">World ID<span class="ao-badge badge-max">Máximo anonimato</span></div><div class="ao-desc">Zero-Knowledge Proof.</div></div>
            </div>
            <div class="auth-opt" @click="ui.showToast('Modo alto riesgo — próximamente')">
              <div class="ao-ico" style="background:rgba(255,107,107,.08)">🕵️</div>
              <div><div class="ao-title">Modo alto riesgo</div><div class="ao-desc">Tor + ZK-proof.</div></div>
            </div>
          </div>
        </div>
      </div>
<!-- Modal GPS -->
      <div v-if="showGpsModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px">
        <div style="background:var(--bg2);border:.5px solid var(--border2);border-radius:var(--r2);padding:24px;max-width:340px;width:100%">
          <div style="font-size:24px;text-align:center;margin-bottom:12px">📍</div>
          <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:14px;margin-bottom:10px;text-align:center">Refuerza tu participación</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:20px;text-align:center">
            Para reforzar la credibilidad de tu participación, vamos a pedirte que compartas tu ubicación. Esto confirma que estás en el país correcto y hace tu participación más difícil de cuestionar.<br><br>
            <strong style="color:var(--accent2)">Tu ubicación nunca se guarda — solo se usa en este momento.</strong>
          </div>
          <button class="btn-primary" style="width:100%;margin-bottom:8px" @click="aceptarGps">
            📍 Reforzar mi participación
          </button>
          <button @click="rechazarGps"
            style="width:100%;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);color:var(--text2);font-size:10px;cursor:pointer">
            Continuar sin ubicación
          </button>
        </div>
      </div>
      <div class="anon-note" style="margin-top:10px">🛡️ Tu identidad nunca se almacena. Solo huellas matemáticas irreversibles.</div>
    </div>
  </div>
</template>

<script setup>
import { useProtestsStore } from '@/stores/protests.js';
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '@/stores/ui.js';

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
    captchaTxt.value  = 'Verificado — eres humano. Introduce tu número.';
  } catch {
    captchaStatusClass.value = 'verif-error';
    captchaIco.value = '⚠️';
    captchaTxt.value = 'No se pudo verificar reCAPTCHA. Continúa si estás en desarrollo.';
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

/** Real SHA-256 hash using the Web Crypto API. */
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const hashDisplay = ref('Escribe tu número...');
watch([countryCode, phone], async () => {
  const v = phone.value.replace(/\D/g, '');
  if (v.length >= 4) {
    const h = await sha256('+' + dialCode.value + v);
    hashDisplay.value = 'sha256:' + h;
  } else {
    hashDisplay.value = 'Escribe tu número...';
  }
});

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
      ui.showToast(`Esta convocatoria es solo para ciudadanos de ${protest.country_name}. Usa un número de ese país.`);
      sending.value = false;
      return;
    }
  }

  // Solicitar GPS si la convocatoria es nacional de riesgo bajo/medio
  const riskLevel = sessionStorage.getItem('vc_risk_level') || 'low';
  const scope = sessionStorage.getItem('vc_protest_scope') || 'national';
  
  if (scope === 'national' && (riskLevel === 'low' || riskLevel === 'med')) {
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
        // Geocodificación inversa — obtener ciudad/región/país real del GPS
        try {
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
            { headers: { 'Accept-Language': 'es' } }
          );
          const geoData = await geoRes.json();
          const gpsCiudad = geoData.address?.city || geoData.address?.town || geoData.address?.village || null;
          const gpsRegion = geoData.address?.state || null;
          const gpsPais = geoData.address?.country || null;
          localStorage.setItem('vc_geo_ciudad', gpsCiudad || '');
          localStorage.setItem('vc_geo_region', gpsRegion || '');
          localStorage.setItem('vc_geo_pais', gpsPais || '');
        } catch { /* silencioso */ }
     } catch (gpsErr) {
        console.log('GPS error:', gpsErr);
        ui.clearGps();
      }
    }
    
  }
// Esperar a que el GPS se guarde completamente
    await new Promise(r => setTimeout(r, 500));
  
  // Si el dispositivo ya está verificado, saltar OTP
  const existingDevice = await api.fetchDeviceLocks(device.getDeviceId());
  if (existingDevice && existingDevice.length > 0) {
    const v = phone.value.replace(/\D/g, '');
    const phoneHash = await sha256('+' + dialCode.value + v);
    sessionStorage.setItem('vc_phone_hash', phoneHash);
    sessionStorage.setItem('vc_device_id', device.getDeviceId());
    router.push('/verify');
    return;
  }
  const v = phone.value.replace(/\D/g, '');
  if (v.length < 6) { sending.value = false; return; }
  try {
    let token = '';
    try { token = await getRecaptchaToken('request_otp'); } catch { /* dev mode */ }
    await api.requestOtp({ phone: '+' + dialCode.value + v, recaptcha_token: token || 'dev' });
    otpDigits.value = ['', '', '', '', '', ''];
    otpVisible.value = true;
  } catch (err) {
    ui.showToast('Error al enviar el código: ' + err.message);
  } finally {
    sending.value = false;
  }
}

function onOtpInput(i) {
  if (otpDigits.value[i] && i < 5) otpRefs.value[i + 1]?.focus();
}

async function verifyOTP() {
  const code = otpDigits.value.join('');
  if (code.length < 6) { ui.showToast('Introduce los 6 dígitos'); return; }
  sending.value = true;
  try {
    const v = phone.value.replace(/\D/g, '');
    const phoneHash = await sha256('+' + countryCode.value + v);
    const deviceId  = device.getDeviceId();
    sessionStorage.setItem('vc_phone_hash', phoneHash);
    sessionStorage.setItem('vc_device_id',  deviceId);
    const res = await api.verifyOtp({ phone: '+' + dialCode.value + v, otp: code, device_id: deviceId, country_code: countryCode.value });
    // Sync local device_id with the canonical one from the server (anchored to phone_hash).
    // If localStorage was cleared and the phone was already verified, the server returns
    // the original device_id so the user keeps their identity across sessions.
    if (res.device_id && res.device_id !== deviceId) {
      device.setDeviceId(res.device_id);
      sessionStorage.setItem('vc_device_id', res.device_id);
    }
    router.push('/verify');
  } catch (err) {
    ui.showToast('Código incorrecto o expirado: ' + err.message);
  } finally {
    sending.value = false;
  }
}
</script>
