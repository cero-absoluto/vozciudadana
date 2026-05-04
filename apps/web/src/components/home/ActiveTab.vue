<template>
  <div>
    <div v-if="!protests.length" style="padding:20px 14px;text-align:center">
      <div style="font-size:22px;margin-bottom:8px">🌍</div>
      <div style="font-size:12px;font-weight:500;color:var(--text);margin-bottom:4px">Sin convocatorias activas</div>
      <div style="font-size:10px;color:var(--text3);line-height:1.6">No hay convocatorias en este país ahora mismo.</div>
      <button @click="$router.push('/create')"
        style="margin-top:10px;padding:7px 14px;background:var(--accent);border:none;border-radius:var(--r);color:white;font-size:10px;cursor:pointer">
        + Crear convocatoria
      </button>
    </div>
    <div v-for="p in protests" :key="p.id">
      <div class="p-item"
        :class="{ locked: isBlocked(p), 'joined-item': p.joined }"
        @click="handleClick(p)">
        <div class="pi-heat" :style="{ background: p.color+'18', color: p.color }">{{ p.heat }}°</div>
        <div class="pi-info">
          <div class="pi-title">{{ p.title }}</div>
          <div class="pi-meta">
            <span v-html="store.scopeBadge(p)"></span>
            <span>{{ p.countryName }}</span>
            <span>{{ fmtTime(p.timer) }}</span>
          </div>
          <div class="pi-bar" :style="{ width: p.heat + '%', background: p.color }"></div>
        </div>
        <div class="pi-right">
          <div class="pi-count">{{ fmt(p.count) }}</div>
          <div class="pi-timer">{{ fmtTime(p.timer) }}</div>
        </div>
        <div v-if="isBlocked(p)" class="pi-lock">🔒</div>
      </div>
      <!-- status strips -->
      <div v-if="p.joined"                  class="joined-strip">✓ Adherido · {{ fmtTime(p.timer) }} restante</div>
      <div v-else-if="cj(p).lock"           class="lock-strip">🔒 {{ cj(p).msg }}</div>
      <div v-else-if="cj(p).geo"            class="geo-strip">🌍 {{ cj(p).msg }}</div>
    </div>
  </div>
</template>

<script setup>
import { useProtestsStore } from '@/stores/protests.js';
import { useUiStore }       from '@/stores/ui.js';
import { fmt, fmtTime }     from '@/constants.js';

const props  = defineProps({ protests: Array });
const emit   = defineEmits(['open']);
const store  = useProtestsStore();
const ui     = useUiStore();

const cj         = p => store.canJoin(p);
const isBlocked  = p => { const r = cj(p); return !r.ok && !r.joined; };

function handleClick(p) {
  const r = cj(p);
  if (r.joined || r.ok) emit('open', p.id);
  else if (r.lock)      ui.showToast('🔒 Dispositivo bloqueado hasta que finalice la convocatoria activa');
  else if (r.geo)       ui.showToast('🌍 No puedes participar: fuera del alcance geográfico');
}
</script>
