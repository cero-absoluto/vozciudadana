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
      <div class="suc-p">{{ $t('verify.successBody') }}</div>
      <div class="suc-hash">
        <span style="color:var(--text3)">{{ $t('verify.receipt') }}</span><br>
        <span>{{ receiptHash }}</span>
      </div>
            <!-- Escalera de acción -->
      <div style="width:100%;margin-top:8px">

        <!-- Peldaño 0 — GPS territorial (convocatorias locales y regionales, si no tiene GPS aún) -->
        <div v-if="isLocalProtest && !device.gpsReady" style="margin-bottom:10px">
          <div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:6px;padding:8px 10px;background:rgba(76,200,255,.06);border-radius:var(--r);border:.5px solid rgba(76,200,255,.25)">
            {{ joinedScope === 'regional' ? $t('verify.gpsRegionalInfo', { region: localCiudad }) : $t('verify.gpsLocalInfo', { ciudad: localCiudad }) }}
          </div>
          <button @click="reforzarGpsLocal"
            style="width:100%;margin-bottom:10px;padding:12px;background:rgba(76,200,255,.12);border:.5px solid #4CC8FF;border-radius:var(--r);color:#4CC8FF;font-size:13px;font-weight:700;cursor:pointer">
            📍 {{ reforzandoGps ? '...' : $t('verify.gpsLocalBtn') }}
          </button>
        </div>

        <!-- Peldaño 1 — Notificación -->
        <div v-if="!notiActivada" style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:6px;padding:8px 10px;background:var(--bg2);border-radius:var(--r);border:.5px solid var(--border)">
          {{ $t('verify.notiInfo') }}
        </div>
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
const receiptHash = ref('');
const notiActivada = ref(false);

// Local scope GPS reinforce
const isLocalProtest = ref(false);
const joinedScope = ref(null); // 'local' | 'regional' — picks the right reinforce copy
const localCiudad    = ref('');
const reforzandoGps  = ref(false);

async function reforzarGpsLocal() {
  if (reforzandoGps.value || device.gpsReady) return;
  reforzandoGps.value = true;
  try {
    await device.requestGps();
    // Send GPS coordinates to backend using the single-use update token
    const token    = sessionStorage.getItem('vc_gps_update_token');
    const protestId = sessionStorage.getItem('vc_last_joined');
    if (token && protestId && device.gpsLat && device.gpsLng) {
      const API_BASE = import.meta.env.VITE_API_URL || 'https://api.voiceprotest.org';
      await fetch(`${API_BASE}/api/protests/${protestId}/adhesion`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gps_update_token: token,
          gps_lat:          device.gpsLat,
          gps_lng:          device.gpsLng,
          gps_accuracy:     device.gpsAccuracy ?? null,
        }),
      });
      // Token is single-use — remove from sessionStorage after sending
      sessionStorage.removeItem('vc_gps_update_token');
    }
  } catch { /* silencioso */ } finally {
    reforzandoGps.value = false;
  }
}

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
  for (const msg of [t('verify.spinVerifying'), t('verify.spinRegistering'), t('verify.spinGenerating')]) {
    spinMsg.value = msg;
    await new Promise(r => setTimeout(r, 850));
  }

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
  // Store GPS update token for post-adhesion GPS reinforcement (local scope only)
  if (joinRes?.gps_update_token) {
    sessionStorage.setItem('vc_gps_update_token', joinRes.gps_update_token);
  }
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

  const c = '0123456789abcdef'; let h = 'sha256:';
  for (let i = 0; i < 64; i++) h += c[Math.floor(Math.random() * 16)];
  receiptHash.value = h;
  success.value = true;

  // Check if this is a local or regional protest to show GPS reinforce button
  // (Bug fixed July 2026: only scope==='local' showed the button — on regional
  // convocatorias, where territorial evidence matters just as much for the
  // public report, users had no way to reinforce with GPS.)
  const joinedProtest = protests.protests.find(p => String(p.id) === sessionStorage.getItem('vc_last_joined'));
  if (joinedProtest?.scope === 'local' || joinedProtest?.scope === 'regional') {
    isLocalProtest.value = true;
    joinedScope.value = joinedProtest.scope;
    localCiudad.value = joinedProtest.convocatoria_ciudad_nombre
      || joinedProtest.convocatoria_region
      || (joinedProtest.scope === 'regional' ? 'la región' : 'el municipio');
  }

  ui.showToast(t('verify.toast'));
  setTimeout(() => ui.revealInstallBanner(), 1500);
});

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


