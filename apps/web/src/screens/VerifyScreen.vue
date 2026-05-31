<template>
  <div class="screen active" id="s-verify">
    <!-- Spinner -->
    <div v-if="!success" class="spinner on">
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
      <button class="suc-share" @click="ui.showShareModal = true">{{ $t('verify.viral') }}</button>
      <button class="btn-primary" style="width:100%;margin-bottom:7px" @click="goDetail">{{ $t('verify.backDetail') }}</button>
      <button @click="goInforme"
        style="width:100%;margin-bottom:7px;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);color:var(--text2);font-size:14px;cursor:pointer">
        {{ $t('verify.seeReport') }}
      </button>
      <button style="width:100%;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);font-size:13px;color:var(--text2);cursor:pointer"
        @click="$router.push('/')">{{ $t('verify.goMap') }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useDeviceStore }   from '@/stores/device.js';
import { useUiStore }       from '@/stores/ui.js';

const router   = useRouter();
const { t } = useI18n();
const protests = useProtestsStore();
const device   = useDeviceStore();
const ui       = useUiStore();

const success    = ref(false);
const spinMsg    = ref('Verificando código...');
const receiptHash = ref('');

const MSGS = [
  () => t('verify.spinVerifying'),
  () => t('verify.spinRegistering'),
  () => t('verify.spinGenerating'),
];

onMounted(async () => {
  await protests.loadProtests();
  // Limpiar GPS después de usarlo
  setTimeout(() => {
    localStorage.removeItem('vc_gps_lat');
    localStorage.removeItem('vc_gps_lng');
    localStorage.removeItem('vc_gps_accuracy');
    localStorage.removeItem('vc_gps_ts');
  }, 5000);
  for (const msg of MSGS) {
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
      let token = '';
      try {
        token = await window.grecaptcha.execute(import.meta.env.VITE_RECAPTCHA_KEY, { action: 'join_protest' });
      } catch { /* dev */ }
      await import('@/services/api.js').then(api =>
  api.joinProtest(target.id, {
    phone_hash:      phoneHash,
    device_id:       deviceId,
    recaptcha_token: token || 'dev',
   gps_lat:         ui.gpsLat ?? (localStorage.getItem('vc_gps_lat') ? parseFloat(localStorage.getItem('vc_gps_lat')) : null),
   gps_lng:         ui.gpsLng ?? (localStorage.getItem('vc_gps_lng') ? parseFloat(localStorage.getItem('vc_gps_lng')) : null),
   gps_accuracy:    ui.gpsAccuracy ?? (localStorage.getItem('vc_gps_accuracy') ? parseFloat(localStorage.getItem('vc_gps_accuracy')) : null),
   ip_ciudad:  localStorage.getItem('vc_geo_ciudad') || device.ipCity || null,
   ip_pais:    localStorage.getItem('vc_geo_pais') || device.ipCountryName || null,
   ip_region:  localStorage.getItem('vc_geo_region') || device.ipRegion || null,
  })
);
    } catch (e) {
      if (e.code === 'NATIONAL_ONLY') {
        ui.showToast(t('verify.toastNational'));
        router.push('/');
        return;
      }
      /* silencioso para otros errores */
    }
    protests.joinProtest(target.id);
    await protests.loadProtests();
    sessionStorage.setItem('vc_last_joined', String(target.id));
  }

  const c = '0123456789abcdef'; let h = 'sha256:';
  for (let i = 0; i < 64; i++) h += c[Math.floor(Math.random() * 16)];
  receiptHash.value = h;
  success.value = true;
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

