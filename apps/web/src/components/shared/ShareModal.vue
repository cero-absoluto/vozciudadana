<template>
  <Teleport to="body">
    <div class="modal-overlay" :class="{open: ui.showShareModal}" @click.self="ui.showShareModal = false">
      <div class="modal" ref="dialogEl" role="dialog" aria-modal="true" :aria-label="$t('share.dialogTitle')">
        <div style="background:rgba(184,65,14,.08);border:.5px solid rgba(232,93,36,.25);border-radius:var(--r2);padding:12px 13px;margin-bottom:14px">
          <div style="font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:rgba(232,93,36,.8);margin-bottom:6px">{{ $t('share.previewLabel') }}</div>
          <div style="font-size:12px;color:var(--text);line-height:1.7;font-style:italic">{{ previewMsg }}</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
          <button @click="shareWA" :disabled="copying" style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:#075E54;border:none;border-radius:var(--r2);cursor:pointer;width:100%">
            <div style="width:32px;height:32px;border-radius:9px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-size:18px">💬</div>
            <div style="text-align:left;flex:1">
              <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:white">WhatsApp</div>
              <div style="font-size:10px;color:rgba(255,255,255,.7);margin-top:1px">{{ $t('share.whatsappDesc') }}</div>
            </div>
            <div style="font-size:18px;color:rgba(255,255,255,.6)">→</div>
          </button>
          <button @click="shareTG" :disabled="copying" style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:#2CA5E0;border:none;border-radius:var(--r2);cursor:pointer;width:100%">
            <div style="width:32px;height:32px;border-radius:9px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-size:18px">✈️</div>
            <div style="text-align:left;flex:1">
              <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:white">Telegram</div>
              <div style="font-size:10px;color:rgba(255,255,255,.7);margin-top:1px">{{ $t('share.telegramDesc') }}</div>
            </div>
            <div style="font-size:18px;color:rgba(255,255,255,.6)">→</div>
          </button>
          <button @click="copyLink" :disabled="copying" :aria-busy="copying" style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:var(--bg3);border:.5px solid var(--border2);border-radius:var(--r2);cursor:pointer;width:100%">
            <div style="width:32px;height:32px;border-radius:9px;background:rgba(124,111,255,.15);display:flex;align-items:center;justify-content:center;font-size:18px">🔗</div>
            <div style="text-align:left;flex:1">
              <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:var(--text)">{{ $t('share.copy') }}</div>
              <div style="font-size:10px;color:var(--text3);margin-top:1px">{{ $t('share.copyDesc') }}</div>
            </div>
            <div style="font-size:16px;color:var(--accent)">📋</div>
          </button>
        </div>

        <div v-if="copyFailed" role="alert" style="margin-bottom:12px">
          <div style="font-size:11px;color:var(--text);margin-bottom:6px">{{ $t('share.copyError') }}</div>
          <textarea :aria-label="$t('share.messageLabel')" readonly rows="4" :value="fullMsg" @focus="$event.target.select?.()" style="width:100%;box-sizing:border-box;font-size:12px"></textarea>
        </div>

        <button class="modal-close" @click="ui.showShareModal = false">{{ $t('share.close') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUiStore }       from '@/stores/ui.js';
import { useProtestsStore } from '@/stores/protests.js';

const { t } = useI18n();
const ui       = useUiStore();
const protests = useProtestsStore();
const openedContext = ref(null);

const dialogEl = ref(null);
const copying = ref(false);
const copyFailed = ref(false);
let origin = null;
let openToken = 0;
let listening = false;

function focusables() {
  const root = dialogEl.value;
  if (!root) return [];
  return Array.from(root.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault?.();
    ui.showShareModal = false;
    return;
  }
  if (e.key !== 'Tab') return;
  const items = focusables();
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  const active = document.activeElement;
  const inside = items.includes(active);
  if (e.shiftKey) {
    if (!inside || active === first) { e.preventDefault(); last.focus(); }
  } else if (!inside || active === last) {
    e.preventDefault(); first.focus();
  }
}

function listen(on) {
  if (on === listening) return;
  listening = on;
  if (on) document.addEventListener('keydown', onKeydown);
  else document.removeEventListener('keydown', onKeydown);
}

function restoreFocus() {
  const target = origin;
  origin = null;
  try {
    if (target && target.isConnected !== false && typeof target.focus === 'function') target.focus();
  } catch { /* origin gone: nothing to restore */ }
}

watch(() => [ui.showShareModal, ui.shareOpenId], async ([open]) => {
  const token = ++openToken;
  copying.value = false;
  copyFailed.value = false;
  if (open) {
    const target = ui.shareContext;
    if (!target || typeof target.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(target.id) || typeof target.title !== 'string' || !target.title.trim()) {
      openedContext.value = null;
      ui.showShareModal = false;
      return;
    }
    openedContext.value = Object.freeze({id: target.id, title: target.title});
    origin = document.activeElement;
    listen(true);
    await nextTick();
    if (token !== openToken || !ui.showShareModal) return;
    focusables()[0]?.focus();
  } else {
    openedContext.value = null;
    listen(false);
    restoreFocus();
  }
}, {flush: 'sync'});

onBeforeUnmount(() => {
  openToken++;
  listen(false);
  if (ui.showShareModal) restoreFocus();
});

const BASE_URL = 'https://www.voiceprotest.org';

// The opening owns a public snapshot; routes, session markers and list refreshes
// cannot replace the event while a share or clipboard promise is pending.
const eventUrl = computed(() => openedContext.value ? `${BASE_URL}/#/detail/${encodeURIComponent(openedContext.value.id)}` : '');
const fullMsg = computed(() => openedContext.value
  ? t('share.viralMsgEvent', {title:openedContext.value.title,url:eventUrl.value}) : '');

const previewMsg = computed(() =>
  fullMsg.value.replace(/https?:\/\/\S+/g, '').trim()
);

function incrementViral(id = openedContext.value?.id) {
  if (id) protests.incrementViral(id);
}

function shareWA() {
  if (!ui.showShareModal || !openedContext.value || copying.value) return;
  window.open(`https://wa.me/?text=${encodeURIComponent(fullMsg.value)}`, '_blank', 'noopener,noreferrer');
  incrementViral(); ui.showShareModal = false;
  ui.showToast(t('share.toastWA'));
}
function shareTG() {
  if (!ui.showShareModal || !openedContext.value || copying.value) return;
  const url = encodeURIComponent(eventUrl.value);
  const msg = encodeURIComponent(fullMsg.value);
  window.open(`https://t.me/share/url?url=${url}&text=${msg}`, '_blank', 'noopener,noreferrer');
  incrementViral(); ui.showShareModal = false;
  ui.showToast(t('share.toastTG'));
}
async function copyLink() {
  if (copying.value || !ui.showShareModal || !openedContext.value) return;
  // Capture text and destination now: a late answer must not touch a newer opening.
  const token = openToken;
  const text = fullMsg.value;
  const id = openedContext.value.id;
  copying.value = true;
  copyFailed.value = false;
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch { /* falls through to manual copy */ }
  if (token !== openToken || !ui.showShareModal || openedContext.value?.id !== id) return;
  copying.value = false;
  if (!ok) { copyFailed.value = true; return; }
  incrementViral(id); ui.showShareModal = false;
  ui.showToast(t('share.toastCopy'));
}
</script>
