<template>
  <div class="topbar">
    <div class="logo">
  <div class="logo-mark">
    <svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM10 16.5v-9l6 4.5-6 4.5z"/></svg>
  </div>
  <div>
    <div>Voz Ciudadana</div>
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
