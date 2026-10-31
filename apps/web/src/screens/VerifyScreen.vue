<template>
  <div class="screen active" id="s-verify">
    <!-- Spinner -->
    <div v-if="!success && !outcomeMessage" class=" spinner on" role="status" aria-live="polite">
      <div class="spin-ring"></div>
      <div class="spin-txt">{{ spinMsg }}</div>
    </div>
    <section v-if="outcomeMessage" role="alert" style="padding:24px;overflow-y:auto">
      <p>{{ $t(outcomeMessage) }}</p>
      <button type="button" @click="goDetail">{{ $t('verify.backDetail') }}</button>
      <button type="button" @click="goInforme">{{ $t('participation.viewReport') }}</button>
    </section>
    <!-- Success -->
    <div v-if="success" class="success-scr on">
      <div class="suc-ico">✓</div>
      <div class="suc-h">{{ $t('verify.successTitle') }}</div>
      <div class="participation-receipt" style="width:100%;overflow-wrap:anywhere;padding:12px" role="status">
        <strong>{{ confirmedTitle }}</strong>
        <p>{{ $t('participation.receipt') }}: <code>{{ receipt }}</code></p>
        <p>{{ $t('participation.receiptNote') }}</p>
        <p v-if="savedConfirmation">{{ $t('participation.savedConfirmation') }}</p>
        <p v-if="receiptNotSaved" role="alert">{{ $t('participation.receiptNotSaved') }}</p>
      </div>

            <!-- Escalera de acción -->
      <div style="width:100%;margin-top:8px">

        <!-- Refuerzo de GPS (Capa 1, 21 julio 2026) — solo si no hubo GPS al unirse -->
        <div v-if="showGpsReinforce" style="width:100%;margin-bottom:14px;padding:14px;background:rgba(76,255,164,.08);border:.5px solid var(--accent);border-radius:var(--r)">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px">{{ $t('verify.gpsReinforceTitle') }}</div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:10px">{{ $t('verify.gpsReinforceBody') }}</div>
          <button @click="reinforceGps" :disabled="reinforcing"
            style="width:100%;padding:10px;background:var(--accent);border:none;border-radius:var(--r);color:#000;font-weight:700;font-size:13px;cursor:pointer;margin-bottom:6px">
            {{ reinforcing ? '…' : $t('verify.gpsReinforceAccept') }}
          </button>
          <button @click="showGpsReinforce = false"
            style="width:100%;padding:8px;background:transparent;border:none;color:var(--text2);font-size:12px;cursor:pointer">
            {{ $t('verify.gpsReinforceDecline') }}
          </button>
        </div>
        <div v-if="gpsReinforceDone" style="width:100%;margin-bottom:14px;padding:10px;background:rgba(76,255,164,.08);border-radius:var(--r);text-align:center;font-size:12px;color:var(--accent);font-weight:700">
          ✓ {{ $t('verify.gpsReinforceSuccess') }}
        </div>

        <!-- Peldaño 1 — Notificación -->

        <p id="participation-notification-info" style="font-size:12px;color:var(--text2);line-height:1.6">{{ $t('verify.notiInfo') }}</p>
        <button @click="activarNotificacion" :disabled="notiPending" :aria-busy="notiPending" aria-describedby="participation-notification-info"
          style="width:100%;margin-bottom:10px;padding:12px;background:rgba(76,111,255,.12);border:.5px solid #4C6FFF;border-radius:var(--r);color:#4C6FFF;font-size:13px;font-weight:700;cursor:pointer">
          {{ notiActivada ? $t('verify.notiOn') : $t('verify.notiOff') }}
        </button>

        <!-- Peldaño 2 — VIRAL -->
        <button class="suc-share" style="width:100%;margin-bottom:10px" @click="shareProtest">
          {{ $t('verify.viral') }}
        </button>

        <!-- Peldaño 3 — Ver convocatoria (salida) -->
        <button @click="goDetail"
          style="width:100%;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);color:var(--text2);font-size:11px;cursor:pointer">
          ← {{ $t('verify.backDetail') }}
        </button>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useDeviceStore }   from '@/stores/device.js';
import { useUiStore }       from '@/stores/ui.js';
import { useI18n } from 'vue-i18n';
import { markForceOtp } from '@/lib/nationalPreCheck.js';
import { classifyJoinRejection, joinRejectionPath, joinRejectionToast } from '@/lib/joinRejection.js';
import { localizedCountry } from '@/constants.js';
import {withClientDeadline} from '@/services/requestJson.js';
import {validReceipt, readOutcome, writeOutcome, beginOutcome, uncertainOutcome, participationErrorKey} from '@/lib/participationOutcome.js';
import {participationGpsSnapshot} from '@/lib/participationGps.js';

const { t, locale } = useI18n();

const router   = useRouter();
const protests = useProtestsStore();
const device   = useDeviceStore();
const ui       = useUiStore();

const success    = ref(false);
const spinMsg    = ref('');
const outcomeMessage = ref('');
const receipt = ref('');
const confirmedTitle = ref('');
const savedConfirmation = ref(false);
const receiptNotSaved = ref(false);
const confirmedProtestId = ref('');
const confirmedIdentity = ref('');
let verificationActive = true;
onUnmounted(() => { verificationActive = false; });
const notiActivada = ref(false);
const notiPending = ref(false);
const gpsUpdateToken  = ref(null);
const hadGpsAtJoin    = ref(false);
const showGpsReinforce = ref(false);
const gpsReinforceDone = ref(false);

// Local scope GPS reinforce


function shareProtest() {
  if (!success.value || !validReceipt(receipt.value)) return false;
  return ui.openShare({id: confirmedProtestId.value, title: confirmedTitle.value});
}

async function activarNotificacion() {
  if (notiActivada.value || notiPending.value) return;
  notiPending.value = true;
  try {
    const deviceId=confirmedIdentity.value;
    const protestId=confirmedProtestId.value;
    const deviceSecret=device.getDeviceSecret();
    const ownsContext=()=>verificationActive && !!deviceId && !!protestId && sessionStorage.getItem('vc_device_id')===deviceId && sessionStorage.getItem('vc_last_joined')===protestId && device.getDeviceId()===deviceId && device.getDeviceSecret()===deviceSecret;
    if (!deviceSecret || !ownsContext()) throw new Error('NOTIFICATION_CONTEXT_CHANGED');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    if (!ownsContext()) throw new Error('NOTIFICATION_CONTEXT_CHANGED');
    const reg = await withClientDeadline(() => navigator.serviceWorker.ready);
    if (!ownsContext()) throw new Error('NOTIFICATION_CONTEXT_CHANGED');
    const {publicKey} = await withClientDeadline(async signal => {
      const response=await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/push/vapid-public-key`,{signal});
      if (!response.ok) throw new Error('VAPID_UNAVAILABLE');
      return response.json();
    });
    if (!ownsContext()) throw new Error('NOTIFICATION_CONTEXT_CHANGED');
    let sub = await withClientDeadline(() => reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
    if (!ownsContext()) throw new Error('NOTIFICATION_CONTEXT_CHANGED');

    // Get protest ends_at
    const protestEndsAt = protests.protests.find(p => String(p.id) === protestId)?.ends_at || null;

    const locale = localStorage.getItem('vc_lang') || navigator.language?.substring(0, 2) || 'en';
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;

    const save = subscription => withClientDeadline(async signal => {
      if (!ownsContext()) throw new Error('NOTIFICATION_CONTEXT_CHANGED');
      const response=await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal, body: JSON.stringify({
        device_id:    deviceId,
        device_secret: deviceSecret,
        protest_id:   protestId,
        ends_at:      protestEndsAt,
        locale,
        timezone,
        subscription,
      }),
      });
      const data=await response.json().catch(()=>null);
      return {ok:response.ok,status:response.status,json:async()=>data};
    });
    let saved = await save(sub);
    if (saved.status === 409 && (await saved.json().catch(() => null))?.error === 'PUSH_ENDPOINT_OWNED') {
      // Clearing device storage can leave an old browser endpoint. Obtain a
      // new provider subscription instead of transferring another owner's row.
      if (!ownsContext()) throw new Error('NOTIFICATION_CONTEXT_CHANGED');
      await withClientDeadline(() => sub.unsubscribe());
      if (!ownsContext()) throw new Error('NOTIFICATION_CONTEXT_CHANGED');
      sub = await withClientDeadline(() => reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)}));
      saved = await save(sub);
    }
    if (!saved.ok) { ui.showToast(t('verify.notiError')); return; }
    notiActivada.value = true;
  } catch { ui.showToast(t('verify.notiError')); }
  finally { notiPending.value = false; }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

onMounted(async () => {
  // Snapshot synchronously before any await, then remove the persistent copy.
  // A slow preflight must not lose the consented payload or retain a GPS cache.
  let gpsSnapshot;
  try {
    gpsSnapshot = participationGpsSnapshot(ui, device, localStorage);
    ui.clearGps();
  } catch { outcomeMessage.value = 'participation.storageUnavailable'; return; }
  finally {
    for (const key of ['vc_gps_lat','vc_gps_lng','vc_gps_accuracy','vc_gps_ts']) {
      try { localStorage.removeItem(key); } catch { /* Browser storage unavailable. */ }
    }
  }
  let lastId, context, identity, participationToken;
  try {
    lastId = sessionStorage.getItem('vc_last_joined');
    identity = sessionStorage.getItem('vc_device_id');
    participationToken = sessionStorage.getItem('vc_participation_token');
    context = 'phone:' + identity + ':' + lastId;
  } catch { outcomeMessage.value = 'participation.storageUnavailable'; return; }
  if (!lastId) {
    ui.showToast(t('verify.toastProtestNotFound'));
    router.push('/');
    return;
  }
  if (typeof identity !== 'string' || identity.length < 8 || identity.length > 128) {
    outcomeMessage.value = 'participation.verificationRejected';
    router.push('/auth');
    return;
  }
  confirmedProtestId.value = lastId;
  confirmedIdentity.value = identity;
  const previous = readOutcome(sessionStorage, context);
  if (previous?.state === 'completed') {
    receipt.value = previous.receipt;
    confirmedTitle.value = previous.title;
    savedConfirmation.value = true;
    success.value = true;
    return; // Reload is display-only: no list, CAPTCHA or adhesion request.
  }
  if (previous && previous.state !== 'rejected') {
    outcomeMessage.value = previous.state === 'unavailable' ? 'participation.storageUnavailable' : 'participation.uncertain';
    return;
  }
  if (!participationToken) { outcomeMessage.value = 'participation.verificationRejected'; router.push('/auth'); return; }
  spinMsg.value = t('verify.spinVerifying');
  try { await withClientDeadline(() => protests.loadProtests()); }
  catch { outcomeMessage.value = 'participation.loadUnavailable'; return; }
  if (!verificationActive) return;
  const target = sessionStorage.getItem('vc_last_joined') === lastId
    ? protests.protests.find(p => String(p.id) === lastId) : null;
  if (!target) {
    outcomeMessage.value = 'participation.loadUnavailable';
    return;
  }
  let api, token;
  try {
    token = await withClientDeadline(() => window.grecaptcha.execute(import.meta.env.VITE_RECAPTCHA_KEY, {action:'join_protest'}));
    api = await withClientDeadline(() => import('@/services/api.js'));
  } catch { outcomeMessage.value = 'participation.loadUnavailable'; return; }
  // Check after all preflight awaits, immediately before journalling/dispatch.
  if (!verificationActive) return;
  if (sessionStorage.getItem('vc_last_joined') !== lastId || sessionStorage.getItem('vc_device_id') !== identity || sessionStorage.getItem('vc_participation_token') !== participationToken) {
    ui.showToast(t('verify.toastProtestNotFound'));
    router.push('/');
    return;
  }
  const attempt = beginOutcome(sessionStorage, context, target.title);
  if (!attempt.started) {
    if (attempt.previous?.state === 'completed') {
      receipt.value = attempt.previous.receipt;
      confirmedTitle.value = attempt.previous.title;
      savedConfirmation.value = true;
      success.value = true;
    } else outcomeMessage.value = attempt.previous?.state === 'unavailable' ? 'participation.storageUnavailable' : 'participation.uncertain';
    return;
  }
  const gpsAllowed = !target.dominio_email && !['high','critical'].includes(target.risk_level);
  let joinRes;
  try {
    joinRes = await api.joinProtest(target.id, {
      participation_token: participationToken,
      sms_sent: sessionStorage.getItem('vc_sms_sent') === 'true',
      recaptcha_token: token,
      gps_lat: gpsAllowed ? gpsSnapshot.lat : null,
      gps_lng: gpsAllowed ? gpsSnapshot.lng : null,
      gps_accuracy: gpsAllowed ? gpsSnapshot.accuracy : null,
      ip_ciudad: localStorage.getItem('vc_geo_ciudad') || device.ipCity || null,
      ip_pais: localStorage.getItem('vc_geo_pais') || device.ipCountryName || null,
      ip_region: localStorage.getItem('vc_geo_region') || device.ipRegion || null,
    });
    if (!validReceipt(joinRes?.receipt)) throw Object.assign(new Error('INVALID_API_RESPONSE'), {code:'INVALID_API_RESPONSE'});
  } catch (error) {
    const saved = writeOutcome(sessionStorage, context, {state:uncertainOutcome(error) ? 'uncertain' : 'rejected',title:target.title,attemptId:attempt.attemptId});
    if (!saved) { outcomeMessage.value = 'participation.uncertain'; return; }
    outcomeMessage.value = participationErrorKey(error);
    if (!uncertainOutcome(error)) {
      const rejection = classifyJoinRejection(error);
      if (rejection.forceOtp) markForceOtp(sessionStorage);
      if (rejection.destination === 'auth') router.push(joinRejectionPath(rejection, target.id));
    }
    return;
  }
  // The receipt proves this response. Later local failures never undo that fact.
  receipt.value = joinRes.receipt;
  confirmedTitle.value = target.title;
  receiptNotSaved.value = !writeOutcome(sessionStorage, context, {state:'completed',receipt:joinRes.receipt,title:target.title,attemptId:attempt.attemptId});
  success.value = true;
  hadGpsAtJoin.value = gpsAllowed && gpsSnapshot.lat != null && gpsSnapshot.lng != null;
  gpsUpdateToken.value = joinRes.gps_update_token || null;
  showGpsReinforce.value = gpsAllowed && !hadGpsAtJoin.value && !!gpsUpdateToken.value;
  try { protests.joinProtest(target.id); } catch { /* Secondary local counter/lock. */ }
  void protests.loadProtests().catch(() => {});
  ui.showToast(t('verify.toast'));
  setTimeout(() => ui.revealInstallBanner(), 1500);
});

const reinforcing = ref(false);
async function reinforceGps() {
  if (reinforcing.value) return;
  const id = confirmedProtestId.value;
  if (!verificationActive || sessionStorage.getItem('vc_last_joined') !== id || sessionStorage.getItem('vc_device_id') !== confirmedIdentity.value) return;
  const target = protests.protests.find(p => String(p.id) === String(id));
  if (!target || target.dominio_email || ['high', 'critical'].includes(target.risk_level)) return;
  reinforcing.value = true;
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject,
        { enableHighAccuracy: true, timeout: 10000 })
    );
    const res = await import('@/services/api.js').then(api => {
      if (!verificationActive || sessionStorage.getItem('vc_last_joined') !== id || sessionStorage.getItem('vc_device_id') !== confirmedIdentity.value) throw new Error('GPS_CONTEXT_CHANGED');
      return api.patchAdhesionGps(id, {
        gps_update_token: gpsUpdateToken.value,
        gps_lat:          pos.coords.latitude,
        gps_lng:          pos.coords.longitude,
        gps_accuracy:     pos.coords.accuracy,
      });
    });
    showGpsReinforce.value = false;
    gpsReinforceDone.value = true;
    ui.showToast(t('verify.gpsReinforceSuccess'));
  } catch (err) {
    // Same honest-error treatment as Capa 0 (AuthScreen.vue) — a failure
    // here must never again disappear silently.
    if (err?.status === 409 || err?.status === 410 || err?.status === 404) {
      // Token already used/expired/missing — nothing the person can do by
      // retrying; just stop offering it rather than show a confusing error.
      showGpsReinforce.value = false;
    } else {
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
      let key;
      if (err?.code === 1) key = isIOS ? 'auth.gpsErrorDeniedIOS' : 'auth.gpsErrorDeniedAndroid';
      else if (err?.code === 3) key = 'auth.gpsErrorTimeout';
      else key = 'auth.gpsErrorUnavailable';
      ui.showToast(t(key));
    }
  } finally {
    reinforcing.value = false;
  }
}

function goDetail() {
  const id = confirmedProtestId.value || sessionStorage.getItem('vc_last_joined');
  if (id) router.push(`/detail/${id}`);
  else    router.push('/');
}
  function goInforme() {
  const id = confirmedProtestId.value || sessionStorage.getItem('vc_last_joined');
  if (id) router.push(`/informe/${id}`);
  else    router.push('/');
}
</script>



