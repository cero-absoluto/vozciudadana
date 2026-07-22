<template>
  <div class="screen active" id="s-verify">
    <!-- Spinner -->
    <div v-if="!success" class=" spinner on">
      <div class="spin-ring"></div>
      <div class="spin-txt">{{ spinMsg }}</div>
    </div>
    <!-- Success -->
    <div v-if="success" class="success-scr on">
      <div class="suc-ico">✓</div>
      <div class="suc-h">{{ $t('verify.successTitle') }}</div>

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

        <button @click="activarNotificacion"
          style="width:100%;margin-bottom:10px;padding:12px;background:rgba(76,111,255,.12);border:.5px solid #4C6FFF;border-radius:var(--r);color:#4C6FFF;font-size:13px;font-weight:700;cursor:pointer">
          {{ notiActivada ? $t('verify.notiOn') : $t('verify.notiOff') }}
        </button>

        <!-- Peldaño 2 — VIRAL -->
        <button class="suc-share" style="width:100%;margin-bottom:10px" @click="ui.showShareModal = true">
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
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useDeviceStore }   from '@/stores/device.js';
import { useUiStore }       from '@/stores/ui.js';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const router   = useRouter();
const protests = useProtestsStore();
const device   = useDeviceStore();
const ui       = useUiStore();

const success    = ref(false);
const spinMsg    = ref('');
const notiActivada = ref(false);
const gpsUpdateToken  = ref(null);
const hadGpsAtJoin    = ref(false);
const showGpsReinforce = ref(false);
const gpsReinforceDone = ref(false);

// Local scope GPS reinforce


async function activarNotificacion() {
  if (notiActivada.value) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const reg = await navigator.serviceWorker.ready;
    const vapidRes = await fetch(`${import.meta.env.VITE_API_URL}/api/push/vapid-public-key`);
    const { publicKey } = await vapidRes.json();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const protestId = sessionStorage.getItem('vc_last_joined');
    const deviceId  = sessionStorage.getItem('vc_device_id');

    // Get protest ends_at
    const protestEndsAt = protests.protests.find(p => String(p.id) === protestId)?.ends_at || null;

    const locale = localStorage.getItem('vc_lang') || navigator.language?.substring(0, 2) || 'en';
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;

    await fetch(`${import.meta.env.VITE_API_URL}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id:    deviceId,
        protest_id:   protestId,
        ends_at:      protestEndsAt,
        locale,
        timezone,
        subscription: sub,
      }),
    });
    notiActivada.value = true;
  } catch { /* silencioso */ }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

onMounted(async () => {
  await protests.loadProtests();

  // Limpiar GPS después de usarlo
  setTimeout(() => {
    localStorage.removeItem('vc_gps_lat');
    localStorage.removeItem('vc_gps_lng');
    localStorage.removeItem('vc_gps_accuracy');
    localStorage.removeItem('vc_gps_ts');
  }, 5000);
  // Mensaje honesto: se muestra mientras dura la llamada real de adhesión
  // más abajo, no un progreso simulado con tiempos fijos que no corresponden
  // a ningún trabajo real (antes: 3 mensajes x 850ms fijos).
  spinMsg.value = t('verify.spinVerifying');

  // Find the protest the user was viewing (the first joinable one for demo)
  const lastId = sessionStorage.getItem('vc_last_joined');
const target = lastId 
  ? protests.protests.find(p => String(p.id) === lastId)
  : protests.protests.find(p => !p.joined && protests.canJoin(p).ok);
  if (target) {
    try {
      const phoneHash = sessionStorage.getItem('vc_phone_hash');
      const deviceId  = sessionStorage.getItem('vc_device_id');
      const smsSent   = sessionStorage.getItem('vc_sms_sent') === 'true';
      let token = '';
      try {
        token = await window.grecaptcha.execute(import.meta.env.VITE_RECAPTCHA_KEY, { action: 'join_protest' });
      } catch { /* dev */ }
      await import('@/services/api.js').then(async api => {
  const joinRes = await api.joinProtest(target.id, {
    phone_hash:      phoneHash,
    device_id:       deviceId,
    sms_sent:        smsSent,
    recaptcha_token: token || 'dev',
   gps_lat:         ui.gpsLat ?? (localStorage.getItem('vc_gps_lat') ? parseFloat(localStorage.getItem('vc_gps_lat')) : null) ?? (device.gpsReady ? device.gpsLat : null),
   gps_lng:         ui.gpsLng ?? (localStorage.getItem('vc_gps_lng') ? parseFloat(localStorage.getItem('vc_gps_lng')) : null) ?? (device.gpsReady ? device.gpsLng : null),
   gps_accuracy:    ui.gpsAccuracy ?? (localStorage.getItem('vc_gps_accuracy') ? parseFloat(localStorage.getItem('vc_gps_accuracy')) : null) ?? (device.gpsReady ? device.gpsAccuracy : null),
   ip_ciudad:  localStorage.getItem('vc_geo_ciudad') || device.ipCity || null,
   ip_pais:    localStorage.getItem('vc_geo_pais') || device.ipCountryName || null,
   ip_region:  localStorage.getItem('vc_geo_region') || device.ipRegion || null,
  });
  // Capa 1 (21 July 2026): if this adhesion didn't carry GPS the first
  // time — declined, failed silently (see the Capa 0 fix in AuthScreen.vue),
  // or simply skipped — and the backend issued a reinforcement token
  // (local/regional scope only), offer one more attempt right here, once
  // the person has already completed a successful adhesion. Reconnects an
  // existing, already-hardened backend endpoint (PATCH .../adhesion) that
  // had been fully built and working with no frontend caller since the old
  // UI for it was removed — see the Audit Trail, 16 and 21 July 2026.
  hadGpsAtJoin.value = !!(ui.gpsLat ?? (localStorage.getItem('vc_gps_lat') ? parseFloat(localStorage.getItem('vc_gps_lat')) : null) ?? (device.gpsReady ? device.gpsLat : null));
  gpsUpdateToken.value = joinRes.gps_update_token || null;
  showGpsReinforce.value = !hadGpsAtJoin.value && !!gpsUpdateToken.value;
});
    } catch (e) {
      if (e.code === 'NATIONAL_ONLY') {
        ui.showToast(t('verify.toastNational'));
        router.push('/');
        return;
      }
      if (e.status === 409 || e.message?.includes('409') || e.message?.includes('already')) {
        ui.showToast(t('verify.toastAlready'));
        router.push('/');
        return;
      }
      if (e.status === 402 || e.message?.includes('402') || e.message?.includes('SALDO')) {
        ui.showToast(t('verify.toastSinSaldo'));
        router.push('/');
        return;
      }
      ui.showToast(t('verify.toastError'));
      router.push('/');
      return;
    }
    protests.joinProtest(target.id);
    await protests.loadProtests();
    sessionStorage.setItem('vc_last_joined', String(target.id));
  }

  success.value = true;

  ui.showToast(t('verify.toast'));
  setTimeout(() => ui.revealInstallBanner(), 1500);
});

const reinforcing = ref(false);
async function reinforceGps() {
  if (reinforcing.value) return;
  reinforcing.value = true;
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject,
        { enableHighAccuracy: true, timeout: 10000 })
    );
    const res = await import('@/services/api.js').then(api =>
      api.patchAdhesionGps(sessionStorage.getItem('vc_last_joined'), {
        gps_update_token: gpsUpdateToken.value,
        gps_lat:          pos.coords.latitude,
        gps_lng:          pos.coords.longitude,
        gps_accuracy:     pos.coords.accuracy,
      })
    );
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
  const id = sessionStorage.getItem('vc_last_joined');
  if (id) router.push(`/detail/${id}`);
  else    router.push('/');
}
  function goInforme() {
  const id = sessionStorage.getItem('vc_last_joined');
  if (id) router.push(`/informe/${id}`);
  else    router.push('/');
}
</script>



