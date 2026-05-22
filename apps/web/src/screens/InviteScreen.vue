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
            Al aceptar esta invitación recibirás automáticamente <strong>1 de los 2 avales</strong> necesarios para entrar al grupo.<br><br>
            Solo necesitarás <strong>1 aval más</strong> de cualquier otro miembro acreditado.
          </div>
        </div>

        <div class="block" style="margin-bottom:20px">
          <div class="block-title">🔒 Tu privacidad</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.8">
            Tu email se convierte en una huella matemática irreversible y se destruye inmediatamente. Nadie — ni el sistema ni quien te invitó — puede saber quién eres.
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
  institucion: 'Utrecht University',
  region: 'Utrecht',
  protestId: null,
});

onMounted(async () => {
  // TODO: validar token con GET /api/grupos/invite/:token cuando Jaime lo implemente
  await new Promise(r => setTimeout(r, 800)); // simulación
  estado.value = 'valida'; // simulación — siempre válida por ahora
});

async function aceptarInvitacion() {
  // Redirigir al flujo de verificación de email con el token de invitación
  if (invitacion.value.protestId) {
    router.push(`/grupo/${invitacion.value.protestId}/unirse?invite=${token}`);
  } else {
    // Demo: ir a unirse sin protestId específico
    ui.showToast('Invitación aceptada — verifica tu email para completar el proceso');
    router.push('/');
  }
}
</script>
