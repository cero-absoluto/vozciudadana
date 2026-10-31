<template>
  <div class="screen active" id="s-verify-institucional">

    <!-- PASO 1: Introducir email -->
    <div v-if="step === 1 && availability !== 'ready'" class="verify-wrap" :role="availability === 'loading' ? 'status' : 'alert'">
      <div class="verify-icon">🏛️</div>
      <div class="verify-sub">{{ $t(availabilityMessage) }}</div>
      <button v-if="availability === 'error'" type="button" class="btn-primary" style="width:100%;margin-top:16px"
        @click="loadProtest">{{ $t('verificacional.retry') }}</button>
      <button v-if="availability === 'noninstitutional' || availability === 'closed'" type="button" class="btn-back" @click="goDetail">{{ $t('verificacional.backDetail') }}</button>
      <button v-if="availability === 'closed'" type="button" class="btn-back" @click="$router.push('/informe/' + protestId)">{{ $t('participation.viewReport') }}</button>
      <button v-if="availability === 'error' || availability === 'missing'" type="button" class="btn-back" @click="$router.push('/')">{{ $t('verificacional.goMap') }}</button>
    </div>

    <div v-if="step === 1 && availability === 'ready'" class="verify-wrap">
      <div class="verify-icon">🏛️</div>
      <div class="verify-title">{{ $t('verificacional.title') }}</div>
      <div class="verify-sub"><strong>{{ protest.title }}</strong></div>
      <div class="verify-sub">{{ $t('verificacional.subtitle', { domain: dominio }) }}</div>
      <div class="fg" style="margin-top:24px">
        <label for="institution-verify-email">{{ $t('verificacional.emailLabel') }}</label>
        <input id="institution-verify-email" type="email" v-model="email" :disabled="loading"
          :placeholder="$t('verificacional.emailPlaceholder', { domain: dominio })"
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
      <button class="btn-back" :disabled="loading" @click="changeEmail">{{ $t('verificacional.changeEmail') }}</button>
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
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {recaptchaToken} from '@/services/requestJson.js';
import {validReceipt, freshOutcomeId, readOutcome, writeOutcome, beginOutcome, uncertainOutcome, participationErrorKey} from '@/lib/participationOutcome.js';
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
const resolvedProtest = ref(null);
const protest   = computed(() => protests.protests.find(p => String(p.id) === String(protestId)) || resolvedProtest.value);
// Only a real, syntactically valid domain enables the form; the server stays
// the authority on admission and validity.
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const dominio   = computed(() => {
  const d = String(protest.value?.dominio_email ?? '').trim().toLowerCase();
  return DOMAIN_RE.test(d) ? d : '';
});
const loadState = ref('loading');
// The view may cache a computed value while the clock advances. Dispatch guards
// call currentAvailability imperatively rather than trusting that cached view.
const availabilityCheckedAt = ref(0);
function currentAvailability() {
  const p = protest.value;
  if (!p) return loadState.value === 'loading' ? 'loading' : loadState.value === 'error' ? 'error' : 'missing';
  if (!dominio.value) return 'noninstitutional';
  const endsAt = p.endsAtMs ?? Date.parse(p.ends_at);
  if (Number.isFinite(endsAt) ? endsAt <= Date.now() : !(Number.isFinite(p.timer) && p.timer > 0)) return 'closed';
  return 'ready';
}
const availability = computed(() => { availabilityCheckedAt.value; return currentAvailability(); });
function isAvailableNow() {
  availabilityCheckedAt.value = Date.now();
  return currentAvailability() === 'ready';
}
const AVAILABILITY_MESSAGES = {
  loading: 'verificacional.loadingEvent', error: 'verificacional.loadError', missing: 'verificacional.notFound',
  noninstitutional: 'verificacional.notInstitutional', closed: 'verificacional.closed',
};
const availabilityMessage = computed(() => AVAILABILITY_MESSAGES[availability.value] ?? AVAILABILITY_MESSAGES.missing);

const step       = ref(1);
const email      = ref('');
const otp        = ref('');
const loading    = ref(false);
const emailError = ref('');
const otpError   = ref('');
const receiptHash = ref('');

const RECAPTCHA_KEY = import.meta.env.VITE_RECAPTCHA_KEY;
const activeContext = ref(null);
// Convocatoria, domain and email fixed when the code was requested.
const sentContext = ref(null);
const outcomeMessage = ref('participation.uncertain');
const confirmedTitle = ref('');
const savedConfirmation = ref(false);
const receiptNotSaved = ref(false);
const censusNotSaved = ref(false);
const contextKey = 'vc_institutional_outcome_context:' + protestId;
let verificationActive = true;
onUnmounted(() => { verificationActive = false; });

function showConfirmed(result, restored = false, journalContext = activeContext.value) {
  receiptHash.value = result.receipt;
  confirmedTitle.value = result.title || protest.value?.title || protestId;
  savedConfirmation.value = restored;
  if (!restored) receiptNotSaved.value = !writeOutcome(sessionStorage, journalContext, {state:'completed',receipt:result.receipt,title:confirmedTitle.value,attemptId:result.attemptId});
  step.value = 3;
}

let resolving = false;
async function loadProtest() {
  if (resolving) return;
  resolving = true;
  loadState.value = 'loading';
  try {
    const found = await protests.fetchProtestById(protestId);
    if (verificationActive) {
      resolvedProtest.value = found || null;
      loadState.value = found ? 'loaded' : 'missing';
    }
  } catch {
    if (verificationActive) loadState.value = 'error';
  } finally { resolving = false; }
}

onMounted(() => {
  // Receipts and pending outcomes are restored first; they never depend on the load below.
  restoreOutcome();
  if (step.value === 1) return loadProtest();
});

function restoreOutcome() {
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
}

function changeEmail() {
  if (loading.value) return;
  activeContext.value = null;
  sentContext.value = null;
  otp.value = '';
  step.value = 1;
}

function newInstitutionalVerification() {
  if (loading.value) return;
  try { sessionStorage.removeItem(contextKey); }
  catch { return; }
  activeContext.value = null;
  sentContext.value = null;
  otp.value = '';
  email.value = '';
  emailError.value = '';
  otpError.value = '';
  censusNotSaved.value = false;
  step.value = 1;
  void loadProtest();
}

async function getRecaptchaToken(action) {
  return recaptchaToken(window.grecaptcha, RECAPTCHA_KEY, action);
}

async function sendOtp() {
  if (loading.value || step.value !== 1 || !verificationActive || !isAvailableNow()) return;
  emailError.value = '';
  if (!email.value.trim()) { emailError.value = t('verificacional.errEmail'); return; }
  email.value = email.value.trim();
  if (!email.value.includes('@')) { emailError.value = t('verificacional.errEmailInvalid'); return; }
  const parts = email.value.split('@');
  if (parts[1]?.toLowerCase() !== dominio.value) {
    emailError.value = t('verificacional.errDomain', {domain:'@' + dominio.value});
    return;
  }
  const requested = {protestId, dominio: dominio.value, email: email.value, title: protest.value.title};
  const sameRequest = () => verificationActive && isAvailableNow() && dominio.value === requested.dominio && email.value === requested.email;
  loading.value = true;
  // Establish recoverable local context before requesting an email code.
  let nonce;
  try {
    nonce = freshOutcomeId();
    sessionStorage.setItem(contextKey, nonce);
    if (sessionStorage.getItem(contextKey) !== nonce) throw new Error();
  } catch { emailError.value = t('participation.storageUnavailable'); loading.value = false; return; }
  let recaptcha;
  try { recaptcha = await getRecaptchaToken('institutional_send_otp'); }
  catch { emailError.value = t('participation.preflightUnavailable'); loading.value = false; return; }
  if (!sameRequest()) {
    if (verificationActive) emailError.value = t('verificacional.contextChanged');
    loading.value = false; return;
  }
  try {
    const api = await import('@/services/api.js');
    // Nothing has been sent yet: abort if the context changed meanwhile.
    if (!sameRequest()) {
      if (verificationActive) emailError.value = t('verificacional.contextChanged');
      return;
    }
    const result = await api.sendEmailOtp({email:requested.email,protest_id:requested.protestId,recaptcha_token:recaptcha});
    if (result?.sent !== true || !validReceipt(result.challenge_id)) throw Object.assign(new Error('INVALID_API_RESPONSE'), {code:'INVALID_API_RESPONSE'});
    if (!verificationActive) return;
    // The code was really sent: keep it bound to the context it was requested for.
    sentContext.value = requested;
    activeContext.value = 'email:' + protestId + ':' + nonce;
    step.value = 2;
  } catch (error) {
    emailError.value = t(uncertainOutcome(error) ? 'participation.deliveryUncertain' : participationErrorKey(error));
  } finally { loading.value = false; }
}

async function verifyOtp() {
  if (loading.value || !verificationActive || step.value === 3 || step.value === 4) return;
  otpError.value = '';
  // A recorded outcome takes precedence over current event availability or form values.
  const outcomeContext = activeContext.value;
  const previous = outcomeContext ? readOutcome(sessionStorage, outcomeContext) : null;
  if (previous?.state === 'completed') { showConfirmed(previous, true); return; }
  if (previous && previous.state !== 'rejected') {
    outcomeMessage.value = previous.state === 'unavailable' ? 'participation.storageUnavailable' : 'participation.uncertain';
    step.value = 4; return;
  }
  if (!/^[0-9]{6}$/.test(otp.value)) { otpError.value = t('verificacional.errOtp'); return; }
  if (!outcomeContext || !sentContext.value) { otpError.value = t('participation.storageUnavailable'); return; }
  const requested = sentContext.value;
  const requestedOtp = otp.value;
  const requestedTitle = requested.title || protest.value?.title || protestId;
  // Never substitute mutable form/store values after asynchronous preparation.
  const sameContext = () => requested.protestId === protestId && dominio.value === requested.dominio && isAvailableNow() && sentContext.value === requested && activeContext.value === outcomeContext;
  const contextChanged = () => {
    activeContext.value = null; sentContext.value = null; otp.value = '';
    emailError.value = t('verificacional.contextChanged'); step.value = 1; loading.value = false;
  };
  if (!sameContext()) { contextChanged(); return; }
  loading.value = true;
  // Prepare the module before the write-ahead marker: an import error sent nothing.
  let api;
  try { api = await import('@/services/api.js'); }
  catch { otpError.value = t('participation.loadUnavailable'); loading.value = false; return; }
  if (!verificationActive) { loading.value = false; return; }
  if (!sameContext()) { contextChanged(); return; }
  const attempt = beginOutcome(sessionStorage, outcomeContext, requestedTitle);
  if (!attempt.started) {
    if (attempt.previous?.state === 'completed') showConfirmed(attempt.previous, true);
    else { outcomeMessage.value = attempt.previous?.state === 'unavailable' ? 'participation.storageUnavailable' : 'participation.uncertain'; step.value = 4; }
    loading.value = false; return;
  }
  try {
    const result = await api.verifyEmailOtp({email:requested.email,otp:requestedOtp,protest_id:requested.protestId});
    if (result?.verified !== true || !validReceipt(result.receipt)) throw Object.assign(new Error('INVALID_API_RESPONSE'), {code:'INVALID_API_RESPONSE'});
    showConfirmed({...result,title:requestedTitle,attemptId:attempt.attemptId}, false, outcomeContext);
    ui.showToast(t('verify.toast'));
  } catch (error) {
    if (error?.code === 'CENSUS_SESSION_NOT_SAVED' && error.verified === true && validReceipt(error.receipt)) {
      censusNotSaved.value = true;
      showConfirmed({receipt:error.receipt,title:requestedTitle,attemptId:attempt.attemptId}, false, outcomeContext);
    } else {
      const saved = writeOutcome(sessionStorage, outcomeContext, {state:uncertainOutcome(error) ? 'uncertain' : 'rejected',attemptId:attempt.attemptId});
      if (!saved) { outcomeMessage.value = 'participation.uncertain'; step.value = 4; return; }
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
