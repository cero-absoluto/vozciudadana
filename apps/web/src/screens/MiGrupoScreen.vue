<template>
  <div class="screen active" id="s-mi-grupo">
    <div class="scroll" style="padding:16px">

      <!-- Header -->
      <div style="margin-bottom:20px">
        <button class="back" @click="$router.back()">{{ $t('migrupo.back') }}</button>
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;margin-bottom:4px">
          {{ $t('migrupo.title') }} {{ protest?.convocatoria_institucion || $t('migrupo.ourGroup') }}
        </div>
        <div style="font-size:11px;color:var(--text3)">
          {{ protest?.convocatoria_region || '' }} {{ protest?.dominio_email ? '· @' + protest.dominio_email : '' }}
        </div>
      </div>
      <!-- Sin grupo — crear censo -->
      <!-- Sin grupo — crear censo -->
      <div v-if="!groupId && !cargando">
        <div v-if="!creandoGrupo" style="text-align:center;padding:40px 20px">
          <div style="font-size:48px;margin-bottom:16px">🌱</div>
          <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;margin-bottom:8px">
          {{ $t('migrupo.noExistsTitle') }}
          </div>
          <div style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:24px">
          {{ $t('migrupo.noExistsBody') }}
          </div>
          <button class="btn-primary" style="width:100%;margin-bottom:8px" @click="creandoGrupo = true">
          🌱 {{ $t('migrupo.initCensus') }}
          </button>
        </div>
        <div v-if="creandoGrupo" class="block" style="text-align:left;margin-top:20px">
          <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:20px;margin-bottom:12px">
          📧 {{ $t('migrupo.verifyEmail') }}
          </div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.6">
          {{ $t('migrupo.genesisIntro', { domain: protest?.dominio_email }) }}
          </div>
          <div v-if="!genesisOtpVisible">
            <div class="fg">
              <label>{{ $t('migrupo.emailLabel') }}</label>
              <input type="email" v-model="genesisEmail"
                :placeholder="`tu.nombre@${protest?.dominio_email}`">
              <div v-if="genesisError" style="font-size:10px;color:var(--accent3);margin-top:4px">{{ genesisError }}</div>
            </div>
            <button class="btn-primary" style="width:100%;margin-top:8px"
              :disabled="loadingGenesis" @click="enviarOtpGenesis">
              {{ loadingGenesis ? $t('migrupo.sending') : $t('migrupo.requestCode') }}
            </button>
          </div>
        </div>
        <div v-if="genesisOtpVisible" class="block" style="text-align:left;margin-top:12px">
          <div class="block-title">📬 {{ $t('migrupo.enterCode') }}</div>
          <input type="text" v-model="genesisOtp" maxlength="6"
            placeholder="000000"
            style="width:100%;padding:14px;text-align:center;letter-spacing:10px;font-size:24px;font-weight:700;background:var(--bg2);border:.5px solid var(--border2);border-radius:var(--r);color:var(--text);font-family:'Syne',sans-serif">
          <div v-if="genesisOtpError" style="font-size:10px;color:var(--accent3);margin-top:6px">{{ genesisOtpError }}</div>
          <button class="btn-primary" style="width:100%;margin-top:12px"
            :disabled="loadingGenesis" @click="verificarOtpGenesis">
              {{ loadingGenesis ? $t('migrupo.verifying') : $t('migrupo.verifyCreate') }}
          </button>
        </div>
      </div>
       
      <!-- Con grupo — mostrar estado -->
      <div v-if="groupId">

      <!-- Estado del censo -->
      <div class="block" style="margin-bottom:12px">
        <div class="block-title">📊 {{ $t('migrupo.statusTitle') }}</div>
        <div class="stats-row">
          <div class="sc">
            <div class="sc-n" style="color:var(--accent)">{{ grupo.acreditados }}</div>
            <div class="sc-l">{{ $t('migrupo.statAccredited') }}</div>
          </div>
          <div class="sc">
            <div class="sc-n" style="color:var(--accent4)">{{ grupo.pendientes }}</div>
            <div class="sc-l">{{ $t('migrupo.statPending') }}</div>
          </div>
          <div class="sc">
            <div class="sc-n" style="color:var(--accent2)">{{ grupo.mis_vouches_restantes }}</div>
            <div class="sc-l">{{ $t('migrupo.statMyVouches') }}</div>
          </div>
        </div>
        <div style="margin-top:10px">
          <div style="font-size:8px;color:var(--text3);margin-bottom:4px">{{ $t('migrupo.progressLabel') }}</div>
          <div style="background:var(--bg4);border-radius:4px;height:6px;overflow:hidden">
            <div :style="{width: progresoPercent + '%', background:'var(--accent)', height:'100%', borderRadius:'4px', transition:'width .5s'}"></div>
          </div>
          <div style="font-size:8px;color:var(--text3);margin-top:3px;text-align:right">
            {{ grupo.acreditados }} / {{ grupo.objetivo }} {{ $t('migrupo.progressGoal') }}
          </div>
        </div>
      </div>

      <!-- Mi estado -->
      <div class="block" style="margin-bottom:12px">
        <div class="block-title">{{ $t('migrupo.myStatusTitle') }}</div>
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0">
          <div style="width:10px;height:10px;border-radius:50%;background:var(--accent2)"></div>
          <div style="font-size:12px;font-weight:500">
            {{ miEstado.es_genesis ? '⭐ ' + $t('migrupo.genesis') : '✓ ' + $t('migrupo.accredited') }}
          </div>
        </div>
        <div style="font-size:13px;color:var(--text2)">
          {{ $t('migrupo.vouchesGiven', { given: miEstado.vouches_dados, remaining: grupo.mis_vouches_restantes }) }}
        </div>
      </div>

      <!-- Solicitudes pendientes -->
      <div class="block" style="margin-bottom:12px">
        <div class="block-title">{{ $t('migrupo.pendingTitle', { count: solicitudes.length }) }}</div>
        <div v-if="solicitudes.length === 0" style="font-size:13px;color:var(--text2);padding:8px 0">
          {{ $t('migrupo.noPending') }}
        </div>
        <div v-for="s in solicitudes" :key="s.id" style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:.5px solid var(--border)">
          <div style="flex:1">
            <div style="font-size:11px;font-weight:500">{{ s.candidate_email || $t('migrupo.anonymousCandidate') }}</div>
            <div style="font-size:9px;color:var(--text3)">{{ $t('migrupo.vouchesReceived', { received: s.vouches_recibidos, date: formatFecha(s.requested_at) }) }}</div>
            <div style="background:var(--bg4);border-radius:4px;height:4px;overflow:hidden;margin-top:4px;width:80px">
              <div :style="{width: (s.vouches_recibidos/2*100)+'%',background:'var(--accent4)',height:'100%',borderRadius:'4px'}"></div>
            </div>
          </div>
          <button
            v-if="grupo.mis_vouches_restantes > 0 && !s.ya_avalado"
            @click="darVouch(s)"
            style="padding:6px 12px;background:var(--accent);border:none;border-radius:var(--r);color:white;font-size:10px;font-weight:600;cursor:pointer">
            {{ $t('migrupo.vouch') }}
          </button>
          <div v-else-if="s.ya_avalado" style="font-size:10px;color:var(--accent2)">{{ $t('migrupo.vouched') }}</div>
          <div v-else style="font-size:10px;color:var(--text3)">{{ $t('migrupo.noVouches') }}</div>
        </div>
      </div>

      <!-- Invitar -->
      <div class="block" style="margin-bottom:20px">
        <div class="block-title">{{ $t('migrupo.inviteTitle') }}</div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:10px;line-height:1.6">
          {{ $t('migrupo.inviteDesc') }}
        </div>
        <div style="font-size:12px;padding:6px 8px;background:rgba(255,107,107,.06);border:.5px solid rgba(255,107,107,.2);border-radius:var(--r);color:var(--accent3);margin-bottom:10px;line-height:1.5">
          {{ $t('migrupo.inviteWarning') }}
        </div>
        <div style="font-size:9px;padding:6px 8px;background:rgba(124,111,255,.06);border:.5px solid var(--border);border-radius:var(--r);color:var(--text2);margin-bottom:10px;line-height:1.5">
          {{ $t('migrupo.invitesLeft', { n: grupo.mis_vouches_restantes }) }}
        </div>
        <div v-if="linkInvitacion" style="background:var(--bg3);border:.5px solid var(--border2);border-radius:var(--r);padding:8px 10px;font-family:monospace;font-size:9px;color:var(--accent);word-break:break-all;margin-bottom:8px">
          {{ linkInvitacion }}
        </div>
       <div style="display:flex;gap:8px">
          <button @click="generarYCompartirLink"
            style="flex:1;padding:9px;background:var(--accent);border:none;border-radius:var(--r);color:white;font-size:11px;font-weight:600;cursor:pointer">
            {{ linkInvitacion ? $t('migrupo.regenerate') : $t('migrupo.generateLink') }}
          </button>
          <button v-if="linkInvitacion" @click="copiarLink"
            style="padding:9px 14px;background:var(--bg3);border:.5px solid var(--border2);border-radius:var(--r);color:var(--text);font-size:11px;cursor:pointer">
            {{ $t('migrupo.copyBtn') }}
          </button>
        </div>
      </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useUiStore } from '@/stores/ui.js';
import { useI18n } from 'vue-i18n';
import * as api from '@/services/api.js';

const { t } = useI18n();

const route = useRoute();
const router = useRouter();
const protests = useProtestsStore();
const ui = useUiStore();

const protestId = route.params.protestId;
const protest = computed(() => protests.protests.find(p => String(p.id) === protestId));

const linkInvitacion = ref('');
const groupId = ref(null);
const cargando = ref(true);
const emailHash = ref(sessionStorage.getItem('vc_email_hash') || '');
const creandoGrupo = ref(false);
const genesisEmail = ref('');
const genesisOtp = ref('');
const genesisError = ref('');
const genesisOtpError = ref('');
const genesisOtpVisible = ref(false);
const loadingGenesis = ref(false);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function enviarOtpGenesis() {
  genesisError.value = '';
  const dominio = protest.value?.dominio_email || '';
  const partes = genesisEmail.value.split('@');
  if (partes[1]?.toLowerCase() !== dominio.toLowerCase()) {
    genesisError.value = `${t('migrupo.errorDomain', { domain: dominio })}`;
    return;
  }
  loadingGenesis.value = true;
  try {
    await api.sendEmailOtp({ email: genesisEmail.value, protest_id: protestId });
    genesisOtpVisible.value = true;
  } catch (e) {
    genesisError.value = t('migrupo.errorSend');
  } finally {
    loadingGenesis.value = false;
  }
}

async function verificarOtpGenesis() {
  genesisOtpError.value = '';
  if (!genesisOtp.value || genesisOtp.value.length < 6) {
    genesisOtpError.value = t('migrupo.otpError');
    return;
  }
  loadingGenesis.value = true;
  try {
    await api.verifyEmailOtp({ email: genesisEmail.value, otp: genesisOtp.value, protest_id: protestId });
    const hash = await sha256(genesisEmail.value.toLowerCase());
    const data = await api.crearGrupo({
      protest_id:   protestId,
      genesis_hash: hash,
      name:         protest.value?.convocatoria_institucion || 'Grupo',
    });
    groupId.value = data.group_id;
    emailHash.value = hash;
    sessionStorage.setItem('vc_group_id', data.group_id);
    sessionStorage.setItem('vc_email_hash', hash);
    await cargarEstado();
    creandoGrupo.value = false;
    genesisOtpVisible.value = false;
    ui.showToast(t('migrupo.toastCreated'));
  } catch (e) {
    genesisOtpError.value = t('migrupo.errorCreateGroup');
  } finally {
    loadingGenesis.value = false;
  }
}  

const grupo = ref({
  acreditados: 0,
  pendientes: 0,
  mis_vouches_restantes: 5,
  objetivo: 30,
});

const miEstado = ref({
  acreditado: false,
  es_genesis: false,
  vouches_dados: 0,
});

const solicitudes = ref([]);

const progresoPercent = computed(() =>
  Math.min(100, Math.round((grupo.value.acreditados / grupo.value.objetivo) * 100))
);

function formatFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

async function cargarEstado() {
  if (!groupId.value) return;
  try {
    const data = await api.fetchGrupoEstado(groupId.value, emailHash.value);
    grupo.value = {
      acreditados:           data.acreditados,
      pendientes:            data.pendientes,
      mis_vouches_restantes: data.mis_vouches_restantes,
      objetivo:              data.objetivo,
    };
    miEstado.value = data.mi_estado;
    solicitudes.value = data.solicitudes;
  } catch (e) {
    ui.showToast(t('migrupo.toastLoadError'));
  }
}

async function darVouch(solicitud) {
  if (!groupId.value || !emailHash.value) return;
  try {
    await api.darVouch(groupId.value, {
      voucher_hash:   emailHash.value,
      candidate_hash: solicitud.candidate_hash,
    });
    ui.showToast(t('migrupo.toastVouched'));
    await cargarEstado();
  } catch (e) {
    ui.showToast(t('migrupo.toastVouchError'));
  }
}

async function generarLink() {
  if (!groupId.value || !emailHash.value) return;
  try {
    const data = await api.generarInvite(groupId.value, { inviter_hash: emailHash.value });
    linkInvitacion.value = data.url;
  } catch (e) {
    ui.showToast(t('migrupo.toastLinkError'));
  }
}
  async function generarYCompartirLink() {
  await generarLink();
  if (linkInvitacion.value) {
    await compartirLink();
  }
}

async function copiarLink() {
  try {
    await navigator.clipboard.writeText(linkInvitacion.value);
    ui.showToast(t('migrupo.linkCopied'));
  } catch {
    ui.showToast(t('migrupo.linkCopyError'));
  }
}
async function compartirLink() {
  if (navigator.share) {
    try {
      await navigator.share({
        title: t('migrupo.shareTitle', { name: protest.value?.convocatoria_institucion || t('migrupo.ourGroup') }),
        text: t('migrupo.shareText'),
        url: linkInvitacion.value,
      });
    } catch {
      // Usuario canceló
    }
  } else {
    await copiarLink();
    ui.showToast(t('migrupo.linkCopied'));
  }
}
  
onMounted(async () => {
  await protests.loadProtests();
  try {
    const data = await api.fetchGrupoPorConvocatoria(protestId);
    groupId.value = data.group_id;
    sessionStorage.setItem('vc_group_id', data.group_id);
  } catch {
    groupId.value = null;
  }
  await cargarEstado();
  cargando.value = false;
  // Si viene con ?iniciar=true, mostrar directamente el formulario
  if (route.query.iniciar === 'true' && !groupId.value) {
    creandoGrupo.value = true;
  }
});
</script>
