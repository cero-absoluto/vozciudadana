<template>
  <div class="screen active" id="s-mi-grupo">
    <div class="scroll" style="padding:16px">

      <!-- Header -->
      <div style="margin-bottom:20px">
        <button class="back" @click="$router.back()">← Volver</button>
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;margin-bottom:4px">
          Mi Grupo — {{ protest?.convocatoria_institucion || 'Mi Grupo' }}
        </div>
        <div style="font-size:11px;color:var(--text3)">
          {{ protest?.convocatoria_region || '' }} {{ protest?.dominio_email ? '· @' + protest.dominio_email : '' }}
        </div>
      </div>
      <!-- Sin grupo — crear censo -->
      <div v-if="!groupId" style="text-align:center;padding:40px 20px">
        <div style="font-size:48px;margin-bottom:16px">🌱</div>
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;margin-bottom:8px">
          El censo aún no existe
        </div>
        <div style="font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:24px">
          Sé el primero en iniciarlo. Como nodo génesis podrás invitar a tus compañeros y avalar sus solicitudes.
        </div>
        <div v-if="!creandoGrupo">
          <button class="btn-primary" style="width:100%;margin-bottom:8px" @click="creandoGrupo = true">
            🌱 Iniciar el censo
          </button>
        </div>
        <div v-if="creandoGrupo" class="block" style="text-align:left">
          <div class="block-title">📧 Verifica tu email institucional</div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:12px;line-height:1.6">
            Introduce tu email <strong>@{{ protest?.dominio_email }}</strong> para convertirte en el nodo génesis del censo.
          </div>
          <div class="fg">
            <label>Tu email institucional</label>
            <input type="email" v-model="genesisEmail"
              :placeholder="`tu.nombre@${protest?.dominio_email}`">
            <div v-if="genesisError" style="font-size:10px;color:var(--accent3);margin-top:4px">{{ genesisError }}</div>
          </div>
          <button class="btn-primary" style="width:100%;margin-top:8px"
            :disabled="loadingGenesis" @click="enviarOtpGenesis">
            {{ loadingGenesis ? 'Enviando...' : 'Enviar código →' }}
          </button>
        </div>
        <div v-if="genesisOtpVisible" class="block" style="text-align:left;margin-top:12px">
          <div class="block-title">📬 Introduce el código</div>
          <input type="text" v-model="genesisOtp" maxlength="6"
            placeholder="000000"
            style="width:100%;padding:14px;text-align:center;letter-spacing:10px;font-size:24px;font-weight:700;background:var(--bg2);border:.5px solid var(--border2);border-radius:var(--r);color:var(--text);font-family:'Syne',sans-serif">
          <div v-if="genesisOtpError" style="font-size:10px;color:var(--accent3);margin-top:6px">{{ genesisOtpError }}</div>
          <button class="btn-primary" style="width:100%;margin-top:12px"
            :disabled="loadingGenesis" @click="verificarOtpGenesis">
            {{ loadingGenesis ? 'Verificando...' : 'Verificar y crear censo →' }}
          </button>
        </div>
      </div>

      <!-- Con grupo — mostrar estado -->
      <div v-if="groupId">

      <!-- Estado del censo -->
      <div class="block" style="margin-bottom:12px">
        <div class="block-title">📊 Estado del censo</div>
        <div class="stats-row">
          <div class="sc">
            <div class="sc-n" style="color:var(--accent)">{{ grupo.acreditados }}</div>
            <div class="sc-l">Acreditados</div>
          </div>
          <div class="sc">
            <div class="sc-n" style="color:var(--accent4)">{{ grupo.pendientes }}</div>
            <div class="sc-l">Pendientes</div>
          </div>
          <div class="sc">
            <div class="sc-n" style="color:var(--accent2)">{{ grupo.mis_vouches_restantes }}</div>
            <div class="sc-l">Mis avales</div>
          </div>
        </div>
        <div style="margin-top:10px">
          <div style="font-size:8px;color:var(--text3);margin-bottom:4px">Progreso del censo</div>
          <div style="background:var(--bg4);border-radius:4px;height:6px;overflow:hidden">
            <div :style="{width: progresoPercent + '%', background:'var(--accent)', height:'100%', borderRadius:'4px', transition:'width .5s'}"></div>
          </div>
          <div style="font-size:8px;color:var(--text3);margin-top:3px;text-align:right">
            {{ grupo.acreditados }} / {{ grupo.objetivo }} objetivo
          </div>
        </div>
      </div>

      <!-- Mi estado -->
      <div class="block" style="margin-bottom:12px">
        <div class="block-title">👤 Mi estado</div>
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0">
          <div style="width:10px;height:10px;border-radius:50%;background:var(--accent2)"></div>
          <div style="font-size:12px;font-weight:500">
            {{ miEstado.es_genesis ? '⭐ Nodo génesis' : '✓ Acreditado' }}
          </div>
        </div>
        <div style="font-size:10px;color:var(--text3)">
          Has dado {{ miEstado.vouches_dados }} avales · Puedes dar {{ grupo.mis_vouches_restantes }} más
        </div>
      </div>

      <!-- Solicitudes pendientes -->
      <div class="block" style="margin-bottom:12px">
        <div class="block-title">🔔 Solicitudes pendientes ({{ solicitudes.length }})</div>
        <div v-if="solicitudes.length === 0" style="font-size:11px;color:var(--text3);padding:8px 0">
          No hay solicitudes pendientes.
        </div>
        <div v-for="s in solicitudes" :key="s.id" style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:.5px solid var(--border)">
          <div style="flex:1">
            <div style="font-size:11px;font-weight:500">Candidato anónimo</div>
            <div style="font-size:9px;color:var(--text3)">{{ s.vouches_recibidos }}/2 avales · Solicitó {{ formatFecha(s.requested_at) }}</div>
            <div style="background:var(--bg4);border-radius:4px;height:4px;overflow:hidden;margin-top:4px;width:80px">
              <div :style="{width: (s.vouches_recibidos/2*100)+'%',background:'var(--accent4)',height:'100%',borderRadius:'4px'}"></div>
            </div>
          </div>
          <button
            v-if="grupo.mis_vouches_restantes > 0 && !s.ya_avalado"
            @click="darVouch(s)"
            style="padding:6px 12px;background:var(--accent);border:none;border-radius:var(--r);color:white;font-size:10px;font-weight:600;cursor:pointer">
            Avalar
          </button>
          <div v-else-if="s.ya_avalado" style="font-size:10px;color:var(--accent2)">✓ Avalado</div>
          <div v-else style="font-size:10px;color:var(--text3)">Sin avales</div>
        </div>
      </div>

      <!-- Invitar -->
      <div class="block" style="margin-bottom:20px">
        <div class="block-title">🔗 Invitar a compañeros</div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:10px;line-height:1.6">
          Comparte este link <strong>solo con compañeros de tu grupo</strong>. Compartirlo fuera compromete la integridad del censo.
        </div>
        <div style="font-size:9px;padding:6px 8px;background:rgba(255,107,107,.06);border:.5px solid rgba(255,107,107,.2);border-radius:var(--r);color:var(--accent3);margin-bottom:10px;line-height:1.5">
          ⚠️ Cada link tiene un máximo de usos. Los primeros {{ grupo.mis_vouches_restantes }} compañeros que lo usen recibirán 1 aval tuyo automáticamente. El resto necesitará avales de otros miembros acreditados.
        </div>
        <div v-if="linkInvitacion" style="background:var(--bg3);border:.5px solid var(--border2);border-radius:var(--r);padding:8px 10px;font-family:monospace;font-size:9px;color:var(--accent);word-break:break-all;margin-bottom:8px">
          {{ linkInvitacion }}
        </div>
        <div style="display:flex;gap:8px">
          <button @click="generarLink"
            style="flex:1;padding:9px;background:var(--bg3);border:.5px solid var(--border2);border-radius:var(--r);color:var(--text);font-size:11px;cursor:pointer">
            {{ linkInvitacion ? '↺ Regenerar link' : '+ Generar link' }}
          </button>
          <button v-if="linkInvitacion" @click="compartirLink"
            style="padding:9px 14px;background:var(--accent);border:none;border-radius:var(--r);color:white;font-size:11px;cursor:pointer">
            Compartir
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
import * as api from '@/services/api.js';

const route = useRoute();
const router = useRouter();
const protests = useProtestsStore();
const ui = useUiStore();

const protestId = route.params.protestId;
const protest = computed(() => protests.protests.find(p => String(p.id) === protestId));

const linkInvitacion = ref('');
const groupId = ref(null);
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
    genesisError.value = `El email debe ser del dominio @${dominio}`;
    return;
  }
  loadingGenesis.value = true;
  try {
    await api.sendEmailOtp({ email: genesisEmail.value, protest_id: protestId });
    genesisOtpVisible.value = true;
  } catch (e) {
    genesisError.value = e.message || 'Error al enviar el código.';
  } finally {
    loadingGenesis.value = false;
  }
}

async function verificarOtpGenesis() {
  genesisOtpError.value = '';
  if (!genesisOtp.value || genesisOtp.value.length < 6) {
    genesisOtpError.value = 'Introduce el código de 6 dígitos';
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
    ui.showToast('✓ Censo iniciado — eres el nodo génesis');
  } catch (e) {
    genesisOtpError.value = e.message || 'Error al crear el grupo.';
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
    ui.showToast('Error al cargar el estado del grupo');
  }
}

async function darVouch(solicitud) {
  if (!groupId.value || !emailHash.value) return;
  try {
    await api.darVouch(groupId.value, {
      voucher_hash:   emailHash.value,
      candidate_hash: solicitud.candidate_hash,
    });
    ui.showToast('✓ Aval registrado');
    await cargarEstado();
  } catch (e) {
    ui.showToast('Error al registrar el aval: ' + e.message);
  }
}

async function generarLink() {
  if (!groupId.value || !emailHash.value) return;
  try {
    const data = await api.generarInvite(groupId.value, { inviter_hash: emailHash.value });
    linkInvitacion.value = data.url;
  } catch (e) {
    ui.showToast('Error al generar el link: ' + e.message);
  }
}

async function copiarLink() {
  try {
    await navigator.clipboard.writeText(linkInvitacion.value);
    ui.showToast('✓ Link copiado al portapapeles');
  } catch {
    ui.showToast('No se pudo copiar — copia el link manualmente');
  }
}
async function compartirLink() {
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Únete al censo de ' + (protest.value?.convocatoria_institucion || 'nuestro grupo'),
        text: 'Te invito a unirte al censo verificado. Solo para compañeros del grupo — no compartas este link fuera.',
        url: linkInvitacion.value,
      });
    } catch {
      // Usuario canceló
    }
  } else {
    await copiarLink();
    ui.showToast('✓ Link copiado — compártelo solo con tus compañeros');
  }
}
  
onMounted(async () => {
  try {
    const data = await api.fetchGrupoPorConvocatoria(protestId);
    groupId.value = data.group_id;
    sessionStorage.setItem('vc_group_id', data.group_id);
  } catch {
    // No hay grupo para esta convocatoria — mostrar pantalla de crear censo
    groupId.value = null;
  }
  await cargarEstado();
});
</script>
