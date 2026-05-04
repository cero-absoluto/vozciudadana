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
          <select class="cc-sel" v-model="countryCode">
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
          <input class="phone-in" type="tel" v-model="phone" placeholder="600 000 000" maxlength="12">
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
        <div style="background:rgba(255,179,71,.08);border:.5px solid rgba(255,179,71,.2);border-radius:6px;padding:6px 9px;margin-bottom:8px;text-align:center;font-size:9px;color:var(--accent4)">
          DEMO · Código prellenado · Pulsa Verificar
        </div>
        <div class="otp-row">
          <input v-for="(_, i) in 6" :key="i" class="otp-box" type="tel" maxlength="1"
            :ref="el => { if (el) otpRefs[i] = el }"
            v-model="otpDigits[i]"
            @input="onOtpInput(i)"
            style="color:var(--accent2)">
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

const RECAPTCHA_KEY = '6LdFl9MsAAAAAISibM9CLohSkQLj1HfN5kH7Hw9Q';

async function getRecaptchaToken(action) {
  return new Promise(resolve => {
    if (typeof window.grecaptcha === 'undefined') { resolve('demo_token'); return; }
    window.grecaptcha.ready(() => {
      window.grecaptcha.execute(RECAPTCHA_KEY, { action })
        .then(t => resolve(t))
        .catch(() => resolve('demo_token'));
    });
  });
}

onMounted(async () => {
  try {
    const token = await getRecaptchaToken('join_protest');
    captchaStatusClass.value = 'verif-ok';
    captchaIco.value  = '✓';
    captchaTxt.value  = token && token !== 'demo_token'
      ? 'Verificado — eres humano. Introduce tu número.'
      : 'Modo demo — introduce tu número.';
  } catch {
    captchaStatusClass.value = 'verif-ok';
    captchaIco.value = '✓';
    captchaTxt.value = 'Introduce tu número para continuar.';
  }
});

async function mockHash(s) {
  const c = '0123456789abcdef'; let h = 'sha256:';
  for (let i = 0; i < 64; i++) h += c[Math.floor(Math.random() * 16)];
  return h;
}

const hashDisplay = ref('Escribe tu número...');
watch([countryCode, phone], async () => {
  const v = phone.value.replace(/\D/g, '');
  hashDisplay.value = v.length >= 4 ? await mockHash(countryCode.value + v) : 'Escribe tu número...';
});

function sendSMS() {
  sending.value = true;
  setTimeout(() => {
    sending.value = false;
    otpVisible.value = true;
  }, 1200);
}

function onOtpInput(i) {
  if (otpDigits.value[i] && i < 5) otpRefs.value[i + 1]?.focus();
}

function verifyOTP() {
  if (otpDigits.value.join('').length < 6) { ui.showToast('Introduce los 6 dígitos'); return; }
  router.push('/verify');
}
</script>
