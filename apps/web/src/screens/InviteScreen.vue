<template>
  <div class="screen active" id="s-invite">
    <div class="scroll" style="padding:16px">

      <!-- Cargando -->
      <div v-if="estado === 'cargando'" style="text-align:center;padding:60px 20px">
        <div class="spin-ring" style="margin:0 auto 12px"></div>
        <div style="font-size:11px;color:var(--text3)">{{ $t('invite.loading') }}</div>
      </div>

      <!-- Invitación válida -->
      <div v-if="estado === 'valida'">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:48px;margin-bottom:12px">🎓</div>
          <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;margin-bottom:6px">
            {{ $t('invite.title') }}
          </div>
          <div style="font-size:12px;color:var(--text2)">
            {{ invitacion.institucion }} · {{ invitacion.region }}
          </div>
        </div>

        <div class="block" style="margin-bottom:12px">
          <div class="block-title">{{ $t('invite.howTitle') }}</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.8">
            {{ $t('invite.howBody') }}
          </div>
        </div>

        <div class="block" style="margin-bottom:20px">
          <div class="block-title">{{ $t('invite.privacyTitle') }}</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.8">
            {{ $t('invite.privacyBody') }}
          </div>
        </div>

        <div style="font-size:9px;padding:6px 8px;background:rgba(255,107,107,.06);border:.5px solid rgba(255,107,107,.2);border-radius:var(--r);color:var(--accent3);margin-bottom:20px;line-height:1.5">
          {{ $t('invite.warning') }}
        </div>

          <button class="btn-primary" style="width:100%;margin-bottom:8px"
          @click="aceptarInvitacion">
          {{ $t('invite.accept') }}
        </button>
        <button @click="$router.push('/')"
          style="width:100%;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);color:var(--text2);font-size:10px;cursor:pointer">
          {{ $t('invite.reject') }}
        </button>
      </div>

      <!-- Invitación inválida -->
      <div v-if="estado === 'invalida'" style="text-align:center;padding:60px 20px">
        <div style="font-size:48px;margin-bottom:12px">⚠️</div>
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:16px;margin-bottom:8px">
          {{ $t('invite.invalidTitle') }}
        </div>
        <div style="font-size:11px;color:var(--text3);line-height:1.7;margin-bottom:24px">
          {{ $t('invite.invalidBody') }}
        </div>
        <button class="btn-primary" style="width:100%" @click="$router.push('/')">
          {{ $t('invite.goMap') }}
        </button>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUiStore } from '@/stores/ui.js';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

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
    if (!res.ok) throw new Error(t('invite.invalidTitle'));
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
    ui.showToast(t('invite.errorInvalid'));
  }
}
</script>
