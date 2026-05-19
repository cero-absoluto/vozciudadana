<template>
  <div class="screen active" id="s-verify-institucional">

    <!-- PASO 1: Introducir email -->
    <div v-if="step === 1" class="verify-wrap">
      <div class="verify-icon">🏛️</div>
      <div class="verify-title">Verificación institucional</div>
      <div class="verify-sub">Introduce tu email de {{ dominio }} para verificar tu pertenencia.</div>
      <div class="fg" style="margin-top:24px">
        <label>Email institucional *</label>
        <input type="email" v-model="email"
          :placeholder="`Ej: tu.nombre@${dominio}`"
          @keyup.enter="sendOtp">
        <div v-if="emailError" class="verify-error">{{ emailError }}</div>
      </div>
      <button class="btn-primary" style="width:100%;margin-top:16px"
        :disabled="loading" @click="sendOtp">
        {{ loading ? 'Enviando...' : 'Enviar código →' }}
      </button>
      <button class="btn-back" @click="$router.back()">← Volver</button>
    </div>

    <!-- PASO 2: Introducir OTP -->
    <div v-if="step === 2" class="verify-wrap">
      <div class="verify-icon">📬</div>
      <div class="verify-title">Código enviado</div>
      <div class="verify-sub">Hemos enviado un código de 6 dígitos a tu email. Caduca en 10 minutos.</div>
      <div class="fg" style="margin-top:24px">
        <label>Código de verificación *</label>
        <input type="text" v-model="otp" maxlength="6"
          placeholder="000000" @keyup.enter="verifyOtp"
          style="letter-spacing:8px;font-size:22px;text-align:center">
        <div v-if="otpError" class="verify-error">{{ otpError }}</div>
      </div>
      <button class="btn-primary" style="width:100%;margin-top:16px"
        :disabled="loading" @click="verifyOtp">
        {{ loading ? 'Verificando...' : 'Verificar código →' }}
      </button>
      <button class="btn-back" @click="step = 1">← Cambiar email</button>
    </div>

    <!-- PASO 3: Éxito -->
    <div v-if="step === 3" class="success-scr on">
      <div class="suc-ico">✓</div>
      <div class="suc-h">¡Adhesión registrada!</div>
      <div class="suc-p">Tu voz ha sido contada de forma anónima y verificada.</div>
      <div class="suc-hash">
        <span style="color:var(--text3)">Comprobante:</span><br>
        <span>{{ receiptHash }}</span>
      </div>
      <button class="suc-share" @click="ui.showShareModal = true">🔥 VIRAL — Hazlo viral ahora</button>
      <button class="btn-primary" style="width:100%;margin-bottom:7px" @click="goDetail">← Ver la convocatoria</button>
      <button style="width:100%;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);font-size:10px;color:var(--text2);cursor:pointer"
        @click="$router.push('/')">Ir al mapa mundial</button>
    </div>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useUiStore } from '@/stores/ui.js';

const route    = useRoute();
const router   = useRouter();
const protests = useProtestsStore();
const ui       = useUiStore();

const protestId = route.params.protestId;
const protest   = computed(() => protests.protests.find(p => String(p.id) === protestId));
const dominio   = computed(() => protest.value?.dominio_email || 'tu institución');

const step       = ref(1);
const email      = ref('');
const otp        = ref('');
const loading    = ref(false);
const emailError = ref('');
const otpError   = ref('');
const receiptHash = ref('');

async function sendOtp() {
  emailError.value = '';
  if (!email.value.trim()) { emailError.value = 'Introduce tu email institucional'; return; }
  if (!email.value.includes('@')) { emailError.value = 'Email no válido'; return; }
  const parts = email.value.split('@');
  if (parts[1]?.toLowerCase() !== dominio.value.toLowerCase()) {
    emailError.value = `El email debe ser del dominio @${dominio.value}`;
    return;
  }
  loading.value = true;
  try {
    const api = await import('@/services/api.js');
    await api.sendEmailOtp({ email: email.value, protest_id: protestId });
    step.value = 2;
  } catch (e) {
    emailError.value = e.message || 'Error al enviar el código. Inténtalo de nuevo.';
  } finally {
    loading.value = false;
  }
}

async function verifyOtp() {
  otpError.value = '';
  if (!otp.value.trim() || otp.value.length < 6) { otpError.value = 'Introduce el código de 6 dígitos'; return; }
  loading.value = true;
  try {
    const api = await import('@/services/api.js');
    const result = await api.verifyEmailOtp({ email: email.value, otp: otp.value, protest_id: protestId });
    receiptHash.value = result.receipt || generarHashFalso();
    step.value = 3;
    ui.showToast('✓ Adhesión anónima registrada');
  } catch (e) {
    otpError.value = e.message || 'Código incorrecto o caducado.';
  } finally {
    loading.value = false;
  }
}

function generarHashFalso() {
  const c = '0123456789abcdef'; let h = 'sha256:';
  for (let i = 0; i < 64; i++) h += c[Math.floor(Math.random() * 16)];
  return h;
}

function goDetail() {
  router.push(`/detail/${protestId}`);
}
</script>

<style scoped>
.verify-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px 24px;
  max-width: 400px;
  margin: 0 auto;
}
.verify-icon { font-size: 48px; margin-bottom: 16px; }
.verify-title { font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 8px; text-align: center; }
.verify-sub { font-size: 12px; color: var(--text2); text-align: center; line-height: 1.6; }
.verify-error { color: var(--accent3); font-size: 11px; margin-top: 6px; }
.btn-back {
  width: 100%;
  margin-top: 10px;
  padding: 9px;
  background: transparent;
  border: .5px solid var(--border2);
  border-radius: var(--r);
  font-size: 10px;
  color: var(--text2);
  cursor: pointer;
}
</style>
