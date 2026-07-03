<template>
  <div>
    <div v-if="!protests.length" style="padding:20px 14px;text-align:center">
      <div style="font-size:22px;margin-bottom:8px">🌍</div>
      <div style="font-size:12px;font-weight:500;color:var(--text);margin-bottom:4px">{{ $t('active.empty') }}</div>
      <div style="font-size:10px;color:var(--text3);line-height:1.6">{{ $t('active.emptyDesc') }}</div>
      <button @click="$router.push('/create')"
        style="margin-top:10px;padding:7px 14px;background:var(--accent);border:none;border-radius:var(--r);color:white;font-size:10px;cursor:pointer">
        {{ $t('active.createBtn') }}
      </button>
    </div>
    <div v-for="p in protests" :key="p.id">
      <div class="p-item"
        :class="{ locked: isBlocked(p), 'joined-item': p.joined }"
        @click="handleClick(p)">
        <div class="pi-heat" :style="{ background: p.color+'18', color: p.color }">{{ p.heat }}°</div>
        <div class="pi-info">
          <div class="pi-title" style="white-space:normal;overflow:visible;text-overflow:unset">{{ p.title }}</div>
          <div class="pi-meta">
            <span class="scope-badge" :class="store.scopeBadge(p).cls">{{ store.scopeBadge(p).icon }} {{ badgeLabel(p) }}</span>
            <span v-if="p.country">{{ localizedCountry(p.country, locale) }}</span>
          </div>
          <div class="pi-bar" :style="{ width: p.heat + '%', background: p.color }"></div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:5px">
            <div @click.stop="router.push(`/informe/${p.id}`)"
              style="cursor:pointer;font-size:14px;opacity:.7" title="Ver informe público">📄</div>
            <div v-if="isBlocked(p)" style="font-size:14px">🔒</div>
            <div class="pi-count" style="font-size:13px">{{ fmt(p.count) }}</div>
            <div style="font-size:12px;color:var(--text2);font-weight:600">{{ fmtTime(p.timer) }}</div>
            <div v-if="p.ends_at" style="font-size:11px;color:var(--text3);margin-top:2px">{{ fmtCloseDate(p.ends_at) }}</div>
          </div>
        </div>
      </div>
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
const { t, locale } = useI18n();
import { useProtestsStore } from '@/stores/protests.js';
import { useUiStore }       from '@/stores/ui.js';
import { fmt, fmtTime, localizedCountry } from '@/constants.js';

function fmtCloseDate(endsAt) {
  if (!endsAt) return '';
  return new Date(endsAt).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
}

const props  = defineProps({ protests: Array });
const emit   = defineEmits(['open']);
const store  = useProtestsStore();
const ui     = useUiStore();

const cj         = p => store.canJoin(p);
const isBlocked  = p => { const r = cj(p); return !r.ok && !r.joined; };

// National badge shows the country — localise it to the current UI language
// instead of the fixed string stored at creation. Other badges keep their label.
function badgeLabel(p) {
  if (p.scope === 'national' && !p.dominio_email && p.country) return localizedCountry(p.country, locale.value);
  return store.scopeBadge(p).label;
}

function handleClick(p) {
  const r = cj(p);
  if (r.joined || r.ok) emit('open', p.id);
  else if (r.lock)      ui.showToast(t('active.toastLocked'));
  else if (r.geo)       ui.showToast(t('active.toastGeo'));
}
</script>
