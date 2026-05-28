<template>
  <div class="screen active" id="s-unirse-grupo">
    <div class="scroll" style="padding:16px">

      <!-- Header -->
      <div style="margin-bottom:24px">
        <button class="back" @click="$router.back()">← Volver</button>
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;margin-bottom:4px">
          Unirme al grupo
        </div>
        <div style="font-size:11px;color:var(--text3)">
          {{ protest?.convocatoria_institucion || 'Institución' }}
        </div>
      </div>

      <!-- Paso 1: verificar email -->
      <div v-if="paso === 1">
        <div class="block" style="margin-bottom:12px">
          <div class="block-title">📧 Verifica tu email institucional</div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:12px;line-height:1.6">
            Para unirte al grupo necesitas verificar que tienes un email
            <strong>@{{ dominio }}</strong>. El email no se guardará.
          </div>
          <div class="fg">
            <label>Email institucional *</label>
            <input type="email" v-model="email"
              :placeholder="`tu.nombre@${dominio}`"
              @keyup.enter="solicitarOtp">
            <div v-if="emailError" style="font-size:10px;color:var(--accent3);margin-top:4px">{{ emailError }}</div>
          </div>
          <button class="btn-primary" style="width:100%;margin-top:8px"
            :disabled="loading" @click="solicitarOtp">
            {{ loading ? 'Enviando...' : 'Enviar código →' }}
          </button>
        </div>
        <div style="font-size:9px;color:var(--text3);text-align:center;line-height:1.6">
          🔒 Tu email se convierte en una huella matemática irreversible.<br>
          Nadie puede saber quién eres a partir de ella.
        </div>
      </div>

      <!-- Paso 2: introducir OTP -->
      <div v-if="paso === 2">
        
        <div class="block" style="margin-bottom:12px">
          <div class="block-title">📬 Introduce el código</div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:12px;line-height:1.6">
            Hemos enviado un código de 6 dígitos a tu email. Caduca en 10 minutos.
          </div>
          <input type="text" v-model="otp" maxlength="6"
            placeholder="000000"
            style="width:100%;padding:14px;text-align:center;letter-spacing:10px;font-size:24px;font-weight:700;background:var(--bg2);border:.5px solid var(--border2);border-radius:var(--r);color:var(--text);font-family:'Syne',sans-serif"
            @keyup.enter="verificarOtp">
          <div v-if="otpError" style="font-size:10px;color:var(--accent3);margin-top:6px">{{ otpError }}</div>
          <button class="btn-primary" style="width:100%;margin-top:12px"
            :disabled="loading" @click="verificarOtp">
            {{ loading ? 'Verificando...' : 'Verificar código →' }}
          </button>
          <button @click="paso = 1"
            style="width:100%;margin-top:8px;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);color:var(--text2);font-size:10px;cursor:pointer">
            ← Cambiar email
          </button>
        </div>
      </div>

      <!-- Paso 3: solicitud enviada -->
      <div v-if="paso === 3" style="text-align:center;padding:40px 20px">
        <div style="font-size:48px;margin-bottom:16px">✓</div>
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;color:var(--accent2);margin-bottom:8px">
          Solicitud enviada
        </div>
        <div style="font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:24px">
          Tu email ha sido verificado y tu solicitud está pendiente de avales.<br><br>
          Necesitas <strong>2 avales</strong> de compañeros acreditados para entrar al grupo.<br>
          Coordínate con ellos por WhatsApp o en clase.
        </div>
        <button class="btn-primary" style="width:100%" @click="$router.push('/')">
          Ir al mapa →
        </button>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
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
const dominio = computed(() => protest.value?.dominio_email || 'tu institución');

const paso = ref(1);
const email = ref('');
const otp = ref('');
const loading = ref(false);
const emailError = ref('');
const otpError = ref('');

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function solicitarOtp() {
  emailError.value = '';
  if (!email.value.trim()) { emailError.value = 'Introduce tu email institucional'; return; }
  const partes = email.value.split('@');
  if (partes[1]?.toLowerCase() !== dominio.value.toLowerCase()) {
    emailError.value = `El email debe ser del dominio @${dominio.value}`;
    return;
  }
  loading.value = true;
  try {
    await api.sendEmailOtp({ email: email.value, protest_id: protestId });
    paso.value = 2;
  } catch (e) {
    emailError.value = e.message || 'Error al enviar el código.';
  } finally {
    loading.value = false;
  }
}

async function verificarOtp() {
  otpError.value = '';
  if (!otp.value.trim() || otp.value.length < 6) {
    otpError.value = 'Introduce el código de 6 dígitos';
    return;
  }
  loading.value = true;
  try {
    // 1. Verificar OTP y registrar adhesión institucional
    await api.verifyEmailOtp({ email: email.value, otp: otp.value, protest_id: protestId });

    // 2. Calcular hash del email
    const emailHash = await sha256(email.value.toLowerCase());
    sessionStorage.setItem('vc_email_hash', emailHash);

    // 3. Solicitar unirse al grupo
   const groupId = sessionStorage.getItem('vc_group_id');
    const inviteToken = route.query.invite || sessionStorage.getItem('vc_invite_token');
    if (groupId) {
      await api.solicitarUnirse(groupId, { 
        email_hash:    emailHash, 
        invite_token:  inviteToken || null,
        candidate_email: email.value,
      });

         }

   // Comprobar si fue acreditado automáticamente
    const groupId2 = sessionStorage.getItem('vc_group_id');
    if (groupId2) {
      try {
        const estado = await api.fetchGrupoEstado(groupId2, emailHash);
        if (estado.mi_estado?.acreditado) {
          paso.value = 4;
        } else {
          paso.value = 3;
        }
      } catch {
        paso.value = 3;
      }
    } else {
      paso.value = 3;
    }
  } catch (e) {
     console.log('Error verificarOtp:', e);
    otpError.value = e.message || 'Código incorrecto o caducado.';
  } finally {
    loading.value = false;
  }
}
</script>
