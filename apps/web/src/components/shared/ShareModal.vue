<template>
  <Teleport to="body">
    <div class="modal-overlay" :class="{open: ui.showShareModal}" @click.self="ui.showShareModal = false">
      <div class="modal">
        <div style="background:rgba(184,65,14,.08);border:.5px solid rgba(232,93,36,.25);border-radius:var(--r2);padding:12px 13px;margin-bottom:14px">
          <div style="font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:rgba(232,93,36,.8);margin-bottom:6px">🔥 Mensaje que se enviará</div>
          <div style="font-size:12px;color:var(--text);line-height:1.7;font-style:italic">{{ previewMsg }}</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
          <button @click="shareWA" style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:#075E54;border:none;border-radius:var(--r2);cursor:pointer;width:100%">
            <div style="width:32px;height:32px;border-radius:9px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-size:18px">💬</div>
            <div style="text-align:left;flex:1">
              <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:white">WhatsApp</div>
              <div style="font-size:10px;color:rgba(255,255,255,.7);margin-top:1px">Envía el mensaje a tus contactos y grupos</div>
            </div>
            <div style="font-size:18px;color:rgba(255,255,255,.6)">→</div>
          </button>
          <button @click="shareTG" style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:#2CA5E0;border:none;border-radius:var(--r2);cursor:pointer;width:100%">
            <div style="width:32px;height:32px;border-radius:9px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-size:18px">✈️</div>
            <div style="text-align:left;flex:1">
              <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:white">Telegram</div>
              <div style="font-size:10px;color:rgba(255,255,255,.7);margin-top:1px">Difunde en canales y grupos</div>
            </div>
            <div style="font-size:18px;color:rgba(255,255,255,.6)">→</div>
          </button>
          <button @click="copyLink" style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:var(--bg3);border:.5px solid var(--border2);border-radius:var(--r2);cursor:pointer;width:100%">
            <div style="width:32px;height:32px;border-radius:9px;background:rgba(124,111,255,.15);display:flex;align-items:center;justify-content:center;font-size:18px">🔗</div>
            <div style="text-align:left;flex:1">
              <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:var(--text)">Copiar enlace + mensaje</div>
              <div style="font-size:10px;color:var(--text3);margin-top:1px">Para TikTok, Instagram, X, Facebook o donde quieras</div>
            </div>
            <div style="font-size:16px;color:var(--accent)">📋</div>
          </button>
        </div>

        <button class="modal-close" @click="ui.showShareModal = false">Cerrar</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useUiStore }       from '@/stores/ui.js';
import { useProtestsStore } from '@/stores/protests.js';
import { fmt } from '@/constants.js';

const ui       = useUiStore();
const protests = useProtestsStore();
const route    = useRoute();

const BASE_URL = 'https://cero-absoluto.github.io/vozciudadana';

const currentProtest = computed(() => {
  const id = Number(route.params.id);
  return id ? protests.protests.find(p => p.id === id) : null;
});

const fullMsg = computed(() => {
  const count = currentProtest.value ? fmt(currentProtest.value.count) : 'miles de';
  return `EL PUEBLO MANDA.\n${count} voces. Sin violencia. Sin miedo.\nSolo ciudadanos recordándoles quién tiene el poder real.\nSúmate: ${BASE_URL}\n#VozCiudadana #ElPuebloManda`;
});

const previewMsg = computed(() =>
  fullMsg.value.replace(/https?:\/\/\S+/g, '').replace('#VozCiudadana #ElPuebloManda', '').trim()
);

function incrementViral() {
  const id = Number(route.params.id);
  if (id) protests.incrementViral(id);
}

function shareWA() {
  window.open(`https://wa.me/?text=${encodeURIComponent(fullMsg.value)}`, '_blank');
  incrementViral(); ui.showShareModal = false;
  ui.showToast('🔥 ¡El pueblo manda! Compartido por WhatsApp');
}
function shareTG() {
  const url = encodeURIComponent(BASE_URL);
  const msg = encodeURIComponent(fullMsg.value);
  window.open(`https://t.me/share/url?url=${url}&text=${msg}`, '_blank');
  incrementViral(); ui.showShareModal = false;
  ui.showToast('🔥 ¡El pueblo manda! Compartido por Telegram');
}
function copyLink() {
  navigator.clipboard?.writeText(fullMsg.value).catch(() => {});
  incrementViral(); ui.showShareModal = false;
  ui.showToast('📋 ¡Copiado! Pégalo en TikTok, Instagram o donde quieras');
}
</script>
