<template>
  <div>
    <!-- A failed load is not an empty list: the failure notice (with retry) lives in HomeScreen. -->
    <div v-if="!protests.length && !store.error" style="padding:20px 14px;text-align:center">
      <div style="font-size:22px;margin-bottom:8px">🌍</div>
      <div style="font-size:12px;font-weight:500;color:var(--text);margin-bottom:4px">{{ $t('active.empty') }}</div>
      <div style="font-size:10px;color:var(--text3);line-height:1.6">{{ $t('active.emptyDesc') }}</div>
      <button @click="$router.push('/create')"
        style="margin-top:10px;padding:7px 14px;background:var(--accent);border:none;border-radius:var(--r);color:white;font-size:10px;cursor:pointer">
        {{ $t('active.createBtn') }}
      </button>
    </div>
    <div v-for="p in protests" :key="p.id">
      <article class="p-item"
        :aria-label="p.title"
        :class="{ locked: isBlocked(p), 'joined-item': p.joined }">
        <div class="pi-heat" :style="{ background: p.color+'18', color: p.color }">{{ p.heat }}°</div>
        <div class="pi-info">
          <div class="pi-title" style="white-space:normal;overflow:visible;text-overflow:unset">{{ p.title }}</div>
          <ProtestTiming :protest="p" />
          <div class="pi-meta">
            <span class="scope-badge" :class="store.scopeBadge(p).cls">{{ store.scopeBadge(p).icon }} {{ badgeLabel(p) }}</span>
            <span v-if="p.country">{{ localizedCountry(p.country, locale) }}</span>
          </div>
          <div class="pi-bar" :style="{ width: p.heat + '%', background: p.color }"></div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:5px">
            <div v-if="isBlocked(p)" style="font-size:14px">🔒</div>
            <div class="pi-count" style="font-size:13px">{{ fmt(p.count) }}</div>
            <div style="font-size:12px;color:var(--text2);font-weight:600">{{ fmtTime(p.timer) }}</div>
          </div>
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
            <!-- Botón principal: UNIRSE — protagonista -->
            <button type="button" @click.stop="handleClick(p)"
              :aria-label="p.title + ' — ' + (p.joined ? $t('active.joined', { time: fmtTime(p.timer) }) : $t('active.joinBtn'))"
              style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:11px 14px;background:var(--accent2);border:none;font-family:inherit;border-radius:20px;cursor:pointer;font-size:15px;font-weight:700;color:#000;box-sizing:border-box">
              ✊ {{ p.joined ? $t('active.joined', { time: fmtTime(p.timer) }) : $t('active.joinBtn') }}
            </button>
            <!-- Botón secundario: informe — texto completo, borde sutil -->
            <button type="button" @click.stop="router.push(`/informe/${p.id}`)"
              :aria-label="p.title + ' — ' + $t('informe.headerLabel')"
              style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 14px;background:transparent;font-family:inherit;border:.5px solid var(--border2);border-radius:20px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text2);box-sizing:border-box">
              📊 {{ $t('informe.headerLabel') }} →
            </button>
          </div>
        </div>
      </article>
      <!-- status strips -->
      <div v-if="p.joined"                  class="joined-strip">{{ $t('active.joined', { time: fmtTime(p.timer) }) }}</div>
      <div v-else-if="cj(p).lock"           class="lock-strip">🔒 {{ cj(p).msg }}</div>
      <div v-else-if="cj(p).geo"            class="geo-strip">🌍 {{ cj(p).msg }}</div>
      
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
const router = useRouter();
const { t, locale } = useI18n({ useScope: 'global' });
import { useProtestsStore } from '@/stores/protests.js';
import { useUiStore }       from '@/stores/ui.js';
import { fmt, fmtTime, localizedCountry } from '@/constants.js';

import ProtestTiming from '@/components/protests/ProtestTiming.vue';

const props  = defineProps({ protests: Array });
const emit   = defineEmits(['open']);
const store  = useProtestsStore();
const ui     = useUiStore();

const cj         = p => store.canJoin(p);
const isBlocked  = p => { const r = cj(p); return !r.ok && !r.joined; };

// National badge shows the country — localise it to the current UI language
// instead of the fixed string stored at creation. Other badges keep their label.
function badgeLabel(p) {
  if (p.dominio_email)        return p.convocatoria_institucion || p.dominio_email || t('home.filterInstitutional').replace(/[^\w\s]/g,'').trim();
  if (p.scope === 'national') return localizedCountry(p.country, locale.value) || p.countryName || '';
  if (p.scope === 'regional') return t('home.filterRegional').replace(/[^\w\s]/g,'').trim();
  if (p.scope === 'local')    return p.convocatoria_ciudad_nombre || t('home.filterLocal').replace(/[^\w\s]/g,'').trim();
  if (p.scope === 'global')   return t('home.filterGlobal').replace(/[^\w\s]/g,'').trim();
  return store.scopeBadge(p).label;
}

function handleClick(p) {
  const r = cj(p);
  if (r.joined || r.ok) emit('open', p.id);
  else if (r.lock)      ui.showToast(t('active.toastLocked'));
  else if (r.geo)       ui.showToast(t('active.toastGeo'));
}
</script>
