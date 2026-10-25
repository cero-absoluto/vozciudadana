<template>
  <Teleport to="body">
    <div class="modal-overlay" :class="{open: ui.showShareModal}" @click.self="ui.showShareModal = false">
      <div ref="dialogEl" class="modal" role="dialog" aria-modal="true" aria-label="Compartir convocatoria">
        <div style="background:rgba(184,65,14,.08);border:.5px solid rgba(232,93,36,.25);border-radius:var(--r2);padding:12px 13px;margin-bottom:14px">
          <div style="font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:rgba(232,93,36,.8);margin-bottom:6px">{{ $t('share.previewLabel') }}</div>
          <div style="font-size:12px;color:var(--text);line-height:1.7;font-style:italic">{{ previewMsg }}</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
          <button @click="shareWA" style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:#075E54;border:none;border-radius:var(--r2);cursor:pointer;width:100%">
            <div style="width:32px;height:32px;border-radius:9px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-size:18px">💬</div>
            <div style="text-align:left;flex:1">
              <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:white">WhatsApp</div>
              <div style="font-size:10px;color:rgba(255,255,255,.7);margin-top:1px">{{ $t('share.whatsappDesc') }}</div>
            </div>
            <div style="font-size:18px;color:rgba(255,255,255,.6)">→</div>
          </button>
          <button @click="shareTG" style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:#2CA5E0;border:none;border-radius:var(--r2);cursor:pointer;width:100%">
            <div style="width:32px;height:32px;border-radius:9px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-size:18px">✈️</div>
            <div style="text-align:left;flex:1">
              <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:white">Telegram</div>
              <div style="font-size:10px;color:rgba(255,255,255,.7);margin-top:1px">{{ $t('share.telegramDesc') }}</div>
            </div>
            <div style="font-size:18px;color:rgba(255,255,255,.6)">→</div>
          </button>
          <button @click="copyLink" style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:var(--bg3);border:.5px solid var(--border2);border-radius:var(--r2);cursor:pointer;width:100%">
            <div style="width:32px;height:32px;border-radius:9px;background:rgba(124,111,255,.15);display:flex;align-items:center;justify-content:center;font-size:18px">🔗</div>
            <div style="text-align:left;flex:1">
              <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:var(--text)">{{ $t('share.copy') }}</div>
              <div style="font-size:10px;color:var(--text3);margin-top:1px">{{ $t('share.copyDesc') }}</div>
            </div>
            <div style="font-size:16px;color:var(--accent)">📋</div>
          </button>
        </div>

        <button class="modal-close" @click="ui.showShareModal = false">{{ $t('share.close') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useUiStore }       from '@/stores/ui.js';
import { useProtestsStore } from '@/stores/protests.js';
import { fmt } from '@/constants.js';

const { t } = useI18n();
const ui       = useUiStore();
const protests = useProtestsStore();
const route    = useRoute();

const BASE_URL = 'https://www.voiceprotest.org';

// ── Focus management ──────────────────────────────────────────────────────
const dialogEl = shallowRef(null);
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
let origin = null;
let listening = false;
let openToken = 0;

function focusables() {
  const el = dialogEl.value;
  if (!el) return [];
  return Array.from(el.querySelectorAll(FOCUSABLE)).filter(n => !n.disabled);
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    ui.showShareModal = false;
    return;
  }
  if (e.key !== 'Tab') return;
  const items = focusables();
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0];
  const last  = items[items.length - 1];
  const active = document.activeElement;
  const inside = dialogEl.value?.contains(active);
  if (!inside) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

function stopListening() {
  if (!listening) return;
  document.removeEventListener('keydown', onKeydown);
  listening = false;
}

function restoreFocus() {
  const target = origin;
  origin = null;
  if (target && target.isConnected && typeof target.focus === 'function') target.focus();
}

watch(() => ui.showShareModal, async (open) => {
  const token = ++openToken;
  if (open) {
    origin = document.activeElement;
    if (!listening) { document.addEventListener('keydown', onKeydown); listening = true; }
    await nextTick();
    if (token !== openToken || !ui.showShareModal) return;
    const items = focusables();
    (items[0] || dialogEl.value)?.focus?.();
  } else {
    stopListening();
    restoreFocus();
  }
});

onBeforeUnmount(() => {
  openToken++;
  stopListening();
  restoreFocus();
});

const currentProtest = computed(() => {
  // route.params.id exists on DetailScreen; after joining (VerifyScreen) the
  // route is /verify with no id — fall back to the protest just joined.
  // (Bug fixed July 2026: sharing right after joining — the highest-intent
  // moment — produced the generic voiceprotest.org message with no title and
  // no direct link, leaving recipients without context or a clear action.)
  const id = route.params.id || sessionStorage.getItem('vc_last_joined');
  return id ? protests.protests.find(p => String(p.id) === String(id)) : null;
});

const eventUrl = computed(() => {
  const id = route.params.id || sessionStorage.getItem('vc_last_joined');
  return id ? `${BASE_URL}/#/detail/${id}` : BASE_URL;
});

const fullMsg = computed(() => {
  if (currentProtest.value?.title) {
    return t('share.viralMsgEvent', { title: currentProtest.value.title, url: eventUrl.value });
  }
  return t('share.viralMsg', { url: eventUrl.value });
});

const previewMsg = computed(() =>
  fullMsg.value.replace(/https?:\/\/\S+/g, '').trim()
);

function incrementViral() {
  const id = Number(route.params.id || sessionStorage.getItem('vc_last_joined'));
  if (id) protests.incrementViral(id);
}

function shareWA() {
  window.open(`https://wa.me/?text=${encodeURIComponent(fullMsg.value)}`, '_blank');
  incrementViral(); ui.showShareModal = false;
  ui.showToast(t('share.toastWA'));
}
function shareTG() {
  const url = encodeURIComponent(eventUrl.value);
  const msg = encodeURIComponent(fullMsg.value);
  window.open(`https://t.me/share/url?url=${url}&text=${msg}`, '_blank');
  incrementViral(); ui.showShareModal = false;
  ui.showToast(t('share.toastTG'));
}
function copyLink() {
  navigator.clipboard?.writeText(fullMsg.value).catch(() => {});
  incrementViral(); ui.showShareModal = false;
  ui.showToast(t('share.toastCopy'));
}
</script>
