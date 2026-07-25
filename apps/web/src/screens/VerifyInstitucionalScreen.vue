<template>
  <div class="screen active" id="s-verify-institucional">

    <!-- PASO 1: Introducir email -->
    <div v-if="step === 1" class="verify-wrap">
      <div class="verify-icon">🏛️</div>
      <div class="verify-title">{{ $t('verificacional.title') }}</div>
      <div class="verify-sub">{{ $t('verificacional.subtitle', { domain: dominio }) }}</div>
      <div class="fg" style="margin-top:24px">
        <label>{{ $t('verificacional.emailLabel') }}</label>
        <input type="email" v-model="email"
          :placeholder="`Ej: tu.nombre@${dominio}`"
          @keyup.enter="sendOtp">
        <div v-if="emailError" class="verify-error">{{ emailError }}</div>
      </div>
      <button class="btn-primary" style="width:100%;margin-top:16px"
        :disabled="loading" @click="sendOtp">
        {{ loading ? $t('verificacional.sending') : $t('verificacional.sendCode') }}
      </button>
      <button class="btn-back" @click="$router.back()">{{ $t('verificacional.back') }}</button>
    </div>

    <!-- PASO 2: Introducir OTP -->
    <div v-if="step === 2" class="verify-wrap">
      <div class="verify-icon">📬</div>
      <div class="verify-title">{{ $t('verificacional.otpTitle') }}</div>
      <div class="verify-sub">{{ $t('verificacional.otpSubtitle') }}</div>
      <div class="fg" style="margin-top:24px">
        <label>{{ $t('verificacional.otpLabel') }}</label>
        <input type="text" v-model="otp" maxlength="6"
          placeholder="000000" @keyup.enter="verifyOtp"
          style="letter-spacing:8px;font-size:22px;text-align:center">
        <div v-if="otpError" class="verify-error">{{ otpError }}</div>
      </div>
      <button class="btn-primary" style="width:100%;margin-top:16px"
        :disabled="loading" @click="verifyOtp">
        {{ loading ? $t('verificacional.verifying') : $t('verificacional.verifyCode') }}
      </button>
      <button class="btn-back" @click="step = 1">{{ $t('verificacional.changeEmail') }}</button>
    </div>

    <!-- PASO 3: Éxito -->
    <div v-if="step === 3" class="success-scr on">
      <div class="suc-ico">✓</div>
      <div class="suc-h">{{ $t('verificacional.successTitle') }}</div>
      <div class="suc-p">{{ $t('verificacional.successBody') }}</div>
      <div class="suc-hash">
        <span style="color:var(--text3)">{{ $t('verificacional.receipt') }}</span><br>
        <span>{{ receiptHash }}</span>
      </div>
      <button class="suc-share" @click="ui.showShareModal = true">{{ $t('verificacional.viral') }}</button>
      <button class="btn-primary" style="width:100%;margin-bottom:7px" @click="goDetail">{{ $t('verificacional.backDetail') }}</button>
      <button style="width:100%;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);font-size:10px;color:var(--text2);cursor:pointer"
        @click="$router.push('/')">{{ $t('verificacional.goMap') }}</button>
    </div>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useUiStore } from '@/stores/ui.js';

const route    = useRoute();
const router   = useRouter();
const { t } = useI18n();
const protests = useProtestsStore();
const ui       = useUiStore();

const protestId = route.params.protestId;
const protest   = computed(() => protests.protests.find(p => String(p.id) === protestId));
const dominio   = computed(() => protest.value?.dominio_email || t('verificacional.yourInstitution'));

const step       = ref(1);
const email      = ref('');
const otp        = ref('');
const loading    = ref(false);
const emailError = ref('');
const otpError   = ref('');
const receiptHash = ref('');

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
    let recaptchaToken = 'dev';
    try {
      recaptchaToken = await getRecaptchaToken('institutional_send_otp');
    } catch { /* falls back to 'dev' — the backend rejects with a clear error in production if reCAPTCHA is genuinely unavailable */ }
    const api = await import('@/services/api.js');
    await api.sendEmailOtp({ email: email.value, protest_id: protestId, recaptcha_token: recaptchaToken });
    step.value = 2;
  } catch (e) {
    emailError.value = t('verificacional.errorSend');
  } finally {
    loading.value = false;
  }
}

async function verifyOtp() {
  otpError.value = '';
  if (!otp.value.trim() || otp.value.length < 6) { otpError.value = t('verificacional.errOtp'); return; }
  loading.value = true;
  try {
    const api = await import('@/services/api.js');
    const result = await api.verifyEmailOtp({ email: email.value, otp: otp.value, protest_id: protestId });
    // Found 24 July 2026 while migrating this flow to the shared
    // AdhesionService: this used to fabricate a fake-looking
    // "sha256:<random hex>" receipt whenever result.receipt was absent —
    // meaning a person could see what looked exactly like a cryptographic
    // confirmation for an adhesion that may never have actually been
    // created. The backend's new atomic path (verify_institutional_otp_and_
    // create_adhesion) guarantees receipt is present on any success — if it
    // is ever missing, something real failed, and pretending otherwise is
    // exactly the kind of thing this project's own Principle 4 rules out.
    if (!result.receipt) {
      otpError.value = t('verificacional.errOtpWrong');
      return;
    }
    receiptHash.value = result.receipt;
    step.value = 3;
    ui.showToast(t('verify.toast'));
  } catch (e) {
    otpError.value = t('verificacional.errOtpWrong');
  } finally {
    loading.value = false;
  }
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
