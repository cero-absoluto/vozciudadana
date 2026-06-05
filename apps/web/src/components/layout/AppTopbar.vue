<template>
  <div class="topbar">
    <div class="logo">
  <div class="logo-mark">
    <svg viewBox="0 0 40 40" width="32" height="32">
      <circle cx="20" cy="20" r="19" fill="none" stroke="#4CFFA4" stroke-width="1.2"/>
      <circle cx="20" cy="20" r="16" fill="#1A7A4C"/>
      <rect x="11" y="9" width="18" height="13" rx="2" fill="none" stroke="#ffffff" stroke-width="1.2"/>
      <line x1="14" y1="13" x2="26" y2="13" stroke="#ffffff" stroke-width="1"/>
      <line x1="14" y1="16" x2="23" y2="16" stroke="#ffffff" stroke-width="1"/>
      <line x1="14" y1="19" x2="21" y2="19" stroke="#ffffff" stroke-width="1"/>
      <path d="M16 22 L20 27 L24 22" fill="#4CFFA4"/>
    </svg>
  </div>
  <div>
    <div>{{ $t('app.name') }}</div>
   <div class="topbar-sub" style="font-size:9px;opacity:.5;font-weight:400;letter-spacing:.3px;line-height:1.4">
  {{ $t('app.tagline1') }}<br>
  {{ $t('app.tagline2') }}
</div>
  </div>
</div>
    <div class="topbar-right">
      <div class="lang-switcher">
        <button v-for="l in langs" :key="l.code"
          class="lang-btn" :class="{active: ui.lang === l.code}"
          @click="setLang(l.code)">{{ l.label }}</button>
      </div>
      <div class="badge-anon"><div class="pulse"></div><span>{{ $t('app.anon') }}</span></div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import { useUiStore } from '@/stores/ui.js';
const { locale } = useI18n({ useScope: 'global' });
const ui = useUiStore();
const langs = [
  { code:'es', label:'ES' }, { code:'en', label:'EN' },
  { code:'fr', label:'FR' }, { code:'zh', label:'中文' },
];
function setLang(code) {
  locale.value = code;
  ui.lang = code;
  localStorage.setItem('vc_lang', code);
}
</script>
