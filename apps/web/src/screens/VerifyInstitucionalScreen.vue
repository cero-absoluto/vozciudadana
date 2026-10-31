<template>
  <div class="screen active" id="s-verify-institucional">

    <!-- PASO 1: Introducir email -->
    <div v-if="step === 1" class="verify-wrap">
      <div class="verify-icon">🏛️</div>
      <div class="verify-title">{{ $t('verificacional.title') }}</div>
      <div class="verify-sub">{{ $t('verificacional.subtitle', { domain: dominio }) }}</div>
      <div class="fg" style="margin-top:24px">
        <label for="institution-verify-email">{{ $t('verificacional.emailLabel') }}</label>
        <input id="institution-verify-email" type="email" v-model="email" :disabled="loading"
          :placeholder="`Ej: tu.nombre@${dominio}`"
          @keyup.enter="sendOtp">
        <div v-if="emailError" class="verify-error" role="alert">{{ emailError }}</div>
      </div>
      <button class="btn-primary" style="width:100%;margin-top:16px"
        :disabled="loading" @click="sendOtp">
        {{ loading ? $t('verificacional.sending') : $t('verificacional.sendCode') }}
      </button>
      <button class="btn-back" :disabled="loading" @click="$router.back()">{{ $t('verificacional.back') }}</button>
    </div>

    <!-- PASO 2: Introducir OTP -->
    <div v-if="step === 2" class="verify-wrap">
      <div class="verify-icon">📬</div>
      <div class="verify-title">{{ $t('verificacional.otpTitle') }}</div>
      <div class="verify-sub">{{ $t('verificacional.otpSubtitle') }}</div>
      <div class="fg" style="margin-top:24px">
        <label for="institution-verify-code">{{ $t('verificacional.otpLabel') }}</label>
        <input id="institution-verify-code" type="text" v-model="otp" maxlength="6" :disabled="loading" inputmode="numeric" autocomplete="one-time-code"
          placeholder="000000" @keyup.enter="verifyOtp"
          style="letter-spacing:8px;font-size:22px;text-align:center">
        <div v-if="otpError" class="verify-error" role="alert">{{ otpError }}</div>
      </div>
      <button class="btn-primary" style="width:100%;margin-top:16px"
        :disabled="loading" @click="verifyOtp">
        {{ loading ? $t('verificacional.verifying') : $t('verificacional.verifyCode') }}
      </button>
      <button class="btn-back" :disabled="loading" @click="step = 1; otp = ''">{{ $t('verificacional.changeEmail') }}</button>
    </div>

    <!-- PASO 3: Éxito -->
    <div v-if="step === 3" class="success-scr on">
      <div class="suc-ico">✓</div>
      <div class="suc-h">{{ $t('verificacional.successTitle') }}</div>
      <div class="suc-p">{{ $t('verificacional.successBody') }}</div>
      <strong>{{ confirmedTitle }}</strong>
      <div class="suc-hash">
        <span style="color:var(--text3)">{{ $t('participation.receipt') }}</span><br>
        <span>{{ receiptHash }}</span>
      </div>
      <p>{{ $t('participation.receiptNote') }}</p>
      <p v-if="savedConfirmation">{{ $t('participation.savedConfirmation') }}</p>
      <p v-if="receiptNotSaved" role="alert">{{ $t('participation.receiptNotSaved') }}</p>
      <p v-if="censusNotSaved" role="alert">{{ $t('participation.censusNotSaved') }}</p>
      <button type="button" @click="newInstitutionalVerification">{{ $t('participation.anotherEmail') }}</button>
      <button class="suc-share" @click="ui.showShareModal = true">{{ $t('verificacional.viral') }}</button>
      <button class="btn-primary" style="width:100%;margin-bottom:7px" @click="goDetail">{{ $t('verificacional.backDetail') }}</button>
      <button style="width:100%;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);font-size:10px;color:var(--text2);cursor:pointer"
        @click="$router.push('/')">{{ $t('verificacional.goMap') }}</button>
    </div>
    <section v-if="step === 4" role="alert" style="padding:24px;overflow-y:auto">
      <p>{{ $t(outcomeMessage) }}</p>
      <button type="button" @click="goDetail">{{ $t('verificacional.backDetail') }}</button>
      <button type="button" @click="$router.push('/informe/' + protestId)">{{ $t('participation.viewReport') }}</button>
    </section>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import {recaptchaToken} from '@/services/requestJson.js';
import {validReceipt, readOutcome, writeOutcome, uncertainOutcome, participationErrorKey} from '@/lib/participationOutcome.js';
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
const activeContext = ref(null);
const outcomeMessage = ref('participation.uncertain');
const confirmedTitle = ref('');
const savedConfirmation = ref(false);
const receiptNotSaved = ref(false);
const censusNotSaved = ref(false);
const contextKey = 'vc_institutional_outcome_context:' + protestId;

function showConfirmed(result, restored = false) {
  receiptHash.value = result.receipt;
  confirmedTitle.value = result.title || protest.value?.title || protestId;
  savedConfirmation.value = restored;
  if (!restored) receiptNotSaved.value = !writeOutcome(sessionStorage, activeContext.value, {state:'completed',receipt:result.receipt,title:confirmedTitle.value});
  step.value = 3;
}

onMounted(() => {
  try {
    const nonce = sessionStorage.getItem(contextKey);
    if (!nonce) return;
    if (!validReceipt(nonce)) { step.value = 4; return; }
    activeContext.value = 'email:' + protestId + ':' + nonce;
    const previous = readOutcome(sessionStorage, activeContext.value);
    if (previous?.state === 'completed') showConfirmed(previous, true);
    else if (previous && previous.state !== 'rejected') {
      outcomeMessage.value = previous.state === 'unavailable' ? 'participation.storageUnavailable' : 'participation.uncertain';
      step.value = 4;
    }
  } catch { outcomeMessage.value = 'participation.storageUnavailable'; step.value = 4; }
});

function newInstitutionalVerification() {
  if (loading.value) return;
  try { sessionStorage.removeItem(contextKey); }
  catch { return; }
  activeContext.value = null;
  otp.value = '';
  email.value = '';
  emailError.value = '';
  otpError.value = '';
  censusNotSaved.value = false;
  step.value = 1;
}

async function getRecaptchaToken(action) {
  return recaptchaToken(window.grecaptcha, RECAPTCHA_KEY, action);
}

async function sendOtp() {
  if (loading.value) return;
  emailError.value = '';
  if (!email.value.trim()) { emailError.value = t('verificacional.errEmail'); return; }
  email.value = email.value.trim();
  if (!email.value.includes('@')) { emailError.value = t('verificacional.errEmailInvalid'); return; }
  const parts = email.value.split('@');
  if (parts[1]?.toLowerCase() !== dominio.value.toLowerCase()) {
    emailError.value = t('verificacional.errDomain', {domain:'@' + dominio.value});
    return;
  }
  loading.value = true;
  try {
    const recaptcha = await getRecaptchaToken('institutional_send_otp');
    const api = await import('@/services/api.js');
    const result = await api.sendEmailOtp({email:email.value,protest_id:protestId,recaptcha_token:recaptcha});
    if (result?.sent !== true || !validReceipt(result.challenge_id)) throw Object.assign(new Error('INVALID_API_RESPONSE'), {code:'INVALID_API_RESPONSE'});
    const nonce = crypto.randomUUID();
    try {
      sessionStorage.setItem(contextKey, nonce);
      if (sessionStorage.getItem(contextKey) !== nonce) throw new Error();
    } catch { emailError.value = t('participation.storageUnavailable'); return; }
    activeContext.value = 'email:' + protestId + ':' + nonce;
    step.value = 2;
  } catch (error) {
    emailError.value = t(uncertainOutcome(error) ? 'participation.deliveryUncertain' : participationErrorKey(error));
  } finally { loading.value = false; }
}

async function verifyOtp() {
  if (loading.value) return;
  otpError.value = '';
  if (!/^[0-9]{6}$/.test(otp.value)) { otpError.value = t('verificacional.errOtp'); return; }
  if (!activeContext.value) { otpError.value = t('participation.storageUnavailable'); return; }
  const previous = readOutcome(sessionStorage, activeContext.value);
  if (previous?.state === 'completed') { showConfirmed(previous, true); return; }
  if (previous && previous.state !== 'rejected') { step.value = 4; return; }
  loading.value = true;
  // Prepare the module before the write-ahead marker: an import error sent nothing.
  let api;
  try { api = await import('@/services/api.js'); }
  catch { otpError.value = t('participation.loadUnavailable'); loading.value = false; return; }
  if (!writeOutcome(sessionStorage, activeContext.value, {state:'pending',title:protest.value?.title || protestId})) {
    otpError.value = t('participation.storageUnavailable'); loading.value = false; return;
  }
  try {
    const result = await api.verifyEmailOtp({email:email.value,otp:otp.value,protest_id:protestId});
    if (result?.verified !== true || !validReceipt(result.receipt)) throw Object.assign(new Error('INVALID_API_RESPONSE'), {code:'INVALID_API_RESPONSE'});
    showConfirmed(result);
    ui.showToast(t('verify.toast'));
  } catch (error) {
    if (error?.code === 'CENSUS_SESSION_NOT_SAVED' && error.verified === true && validReceipt(error.receipt)) {
      censusNotSaved.value = true;
      showConfirmed({receipt:error.receipt});
    } else {
      writeOutcome(sessionStorage, activeContext.value, {state:uncertainOutcome(error) ? 'uncertain' : 'rejected'});
      if (uncertainOutcome(error)) { outcomeMessage.value = 'participation.uncertain'; step.value = 4; }
      else otpError.value = t(participationErrorKey(error));
    }
  } finally { loading.value = false; }
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
