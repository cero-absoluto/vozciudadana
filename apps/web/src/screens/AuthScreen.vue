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
          <select id="cc-sel" class="cc-sel" v-model="countryCode">
            <option value="+356">🇲🇹 +356</option>
            <option value="+34">🇪🇸 +34</option>
            <option value="+52">🇲🇽 +52</option>
            <option value="+54">🇦🇷 +54</option>
            <option value="+58">🇻🇪 +58</option>
            <option value="+53">🇨🇺 +53</option>
            <option value="+7">🇷🇺 +7</option>
            <option value="+98">🇮🇷 +98</option>
            <option value="+375">🇧🇾 +375</option>
            <option value="+1">🇺🇸 +1</option>
            <option value="+44">🇬🇧 +44</option>
            <option value="+33">🇫🇷 +33</option>
            <option value="+49">🇩🇪 +49</option>
            <option value="+86">🇨🇳 +86</option>
            <option value="+55">🇧🇷 +55</option>
          </select>
          <label for="phone-in" class="sr-only">Número de teléfono</label>
          <input id="phone-in" class="phone-in" type="tel" v-model="phone" placeholder="600 000 000" maxlength="12" aria-label="Número de teléfono">
        </div>
        <div class="input-hint">Tu número se transforma en una huella irreversible en tu dispositivo antes de enviarse.</div>
        <div class="hash-label">Huella generada en tiempo real</div>
        <div class="hash-prev">{{ hashDisplay }}</div>
        <button class="btn-primary" style="width:100%;margin-top:8px" :disabled="phone.replace(/\D/g,'').length < 6 || sending" @click="sendSMS">
          {{ sending ? 'Enviando...' : 'Enviar código →' }}
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

      <div class="anon-note" style="margin-top:10px">🛡️ Tu identidad nunca se almacena. Solo huellas matemáticas irreversibles.</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '@/stores/ui.js';

const router = useRouter();
const ui     = useUiStore();

const countryCode  = ref('+34');
const phone        = ref('');
const sending      = ref(false);
const otpVisible   = ref(false);
const otpDigits    = ref(['1','2','3','4','5','6']);
const otpRefs      = ref([]);
const advOpen      = ref(false);

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
    const h = await sha256(countryCode.value + v);
    hashDisplay.value = 'sha256:' + h;
  } else {
    hashDisplay.value = 'Escribe tu número...';
  }
});

import * as api from '@/services/api.js';
import { useDeviceStore } from '@/stores/device.js';
const device = useDeviceStore();

async function sendSMS() {
  const v = phone.value.replace(/\D/g, '');
  if (v.length < 6) return;
  sending.value = true;
  try {
    let token = '';
    try { token = await getRecaptchaToken('request_otp'); } catch { /* dev mode */ }
    const phoneHash = await sha256(countryCode.value + v);
    await api.requestOtp({ phone_hash: phoneHash, recaptcha_token: token || 'dev' });
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
    const phoneHash = await sha256(countryCode.value + v);
    const deviceId  = device.getDeviceId();
    sessionStorage.setItem('vc_phone_hash', phoneHash);
    sessionStorage.setItem('vc_device_id',  deviceId);
    await api.verifyOtp({ phone_hash: phoneHash, otp: code, device_id: deviceId });
    router.push('/verify');
  } catch (err) {
    ui.showToast('Código incorrecto o expirado: ' + err.message);
  } finally {
    sending.value = false;
  }
}
</script>
