<template>
  <div class="screen active" id="s-invite">
    <div class="scroll" style="padding:16px">

      <!-- Cargando -->
      <div v-if="estado === 'cargando'" style="text-align:center;padding:60px 20px">
        <div class="spin-ring" style="margin:0 auto 12px"></div>
        <div style="font-size:11px;color:var(--text3)">Validando invitación...</div>
      </div>

      <!-- Invitación válida -->
      <div v-if="estado === 'valida'">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:48px;margin-bottom:12px">🎓</div>
          <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;margin-bottom:6px">
            Te han invitado al grupo
          </div>
          <div style="font-size:12px;color:var(--text2)">
            {{ invitacion.institucion }} · {{ invitacion.region }}
          </div>
        </div>

        <div class="block" style="margin-bottom:12px">
          <div class="block-title">ℹ️ Cómo funciona</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.8">
            Al aceptar verificarás tu email institucional. El aval de quien te invitó se registra automáticamente.<br><br>
            Si fuiste invitado directamente por el nodo génesis, quedarás acreditado sin necesitar avales adicionales.<br><br>
            Si fuiste invitado por otro miembro, necesitarás <strong>1 aval más</strong> de cualquier miembro acreditado.
          </div>

      <div class="block" style="margin-bottom:20px">
          <div class="block-title">🔒 Tu privacidad</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.8">
            Tu email se convierte en una huella matemática irreversible y se destruye inmediatamente. Nadie — ni el sistema ni quien te invitó — puede saber quién eres.
          </div>
        </div>

      <div style="font-size:9px;padding:6px 8px;background:rgba(255,107,107,.06);border:.5px solid rgba(255,107,107,.2);border-radius:var(--r);color:var(--accent3);margin-bottom:20px;line-height:1.5">
          ⚠️ Este link es de un solo uso y caduca en 48 horas. Si no eres miembro del grupo, por favor no lo uses.
        </div>

        </div>

          <button class="btn-primary" style="width:100%;margin-bottom:8px"
          @click="aceptarInvitacion">
          Aceptar invitación →
        </button>
        <button @click="$router.push('/')"
          style="width:100%;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);color:var(--text2);font-size:10px;cursor:pointer">
          Rechazar
        </button>
      </div>

      <!-- Invitación inválida -->
      <div v-if="estado === 'invalida'" style="text-align:center;padding:60px 20px">
        <div style="font-size:48px;margin-bottom:12px">⚠️</div>
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:16px;margin-bottom:8px">
          Invitación no válida
        </div>
        <div style="font-size:11px;color:var(--text3);line-height:1.7;margin-bottom:24px">
          Este link ha caducado, ya ha sido usado el número máximo de veces o no existe.
        </div>
        <button class="btn-primary" style="width:100%" @click="$router.push('/')">
          Ir al mapa →
        </button>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUiStore } from '@/stores/ui.js';

const route = useRoute();
const router = useRouter();
const ui = useUiStore();

const token = route.params.token;
const estado = ref('cargando');
const invitacion = ref({
  institucion: '',
  region: '',
  group_id: null,
  protest_id: null,
});

onMounted(async () => {
  try {
    const res = await fetch(
      `${import.meta.env.VITE_API_URL}/api/grupos/invite/${token}`
    );
    if (!res.ok) throw new Error('Invitación no válida');
    const data = await res.json();
    invitacion.value = {
      institucion: data.institucion,
      region:      data.region,
      group_id:    data.group_id,
      protest_id:  data.protest_id,
    };
    estado.value = 'valida';
  } catch {
    estado.value = 'invalida';
  }
});

async function aceptarInvitacion() {
  if (invitacion.value.protest_id && invitacion.value.group_id) {
    sessionStorage.setItem('vc_invite_token', token);
    sessionStorage.setItem('vc_group_id', invitacion.value.group_id);
    router.push(`/grupo/${invitacion.value.protest_id}/unirse?invite=${token}`);
  } else {
    ui.showToast('Error — invitación no válida');
  }
}
</script>
