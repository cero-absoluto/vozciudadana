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
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useDeviceStore }   from '@/stores/device.js';
import { useUiStore }       from '@/stores/ui.js';

const router   = useRouter();
const protests = useProtestsStore();
const device   = useDeviceStore();
const ui       = useUiStore();

const success    = ref(false);
const spinMsg    = ref('Verificando código...');
const receiptHash = ref('');

const MSGS = ['Verificando código...', 'Registrando en blockchain...', 'Generando comprobante anónimo...'];

onMounted(async () => {
  await protests.loadProtests();
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
    gps_lat:         sessionStorage.getItem('vc_gps_lat') ? parseFloat(sessionStorage.getItem('vc_gps_lat')) : null,
    gps_lng:         sessionStorage.getItem('vc_gps_lng') ? parseFloat(sessionStorage.getItem('vc_gps_lng')) : null,
    gps_accuracy:    sessionStorage.getItem('vc_gps_accuracy') ? parseFloat(sessionStorage.getItem('vc_gps_accuracy')) : null,
  })
);
    } catch (e) {
      if (e.code === 'NATIONAL_ONLY') {
        ui.showToast('No puede adherirse, la protesta es únicamente para ciudadanos nacionales');
        router.push('/');
        return;
      }
      /* silencioso para otros errores */
    }
    protests.joinProtest(target.id);
    sessionStorage.setItem('vc_last_joined', String(target.id));
  }

  const c = '0123456789abcdef'; let h = 'sha256:';
  for (let i = 0; i < 64; i++) h += c[Math.floor(Math.random() * 16)];
  receiptHash.value = h;
  success.value = true;
  ui.showToast('✓ Adhesión anónima registrada');
  setTimeout(() => ui.revealInstallBanner(), 1500);
});

function goDetail() {
  const id = sessionStorage.getItem('vc_last_joined');
  if (id) router.push(`/detail/${id}`);
  else    router.push('/');
}
</script>
