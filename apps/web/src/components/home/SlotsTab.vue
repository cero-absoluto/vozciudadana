<template>
  <div>
    <div class="panel-info">Cada país tiene 1 slot activo (nacional). Las convocatorias globales no compiten con las nacionales.</div>
    <div v-for="c in countries" :key="c" class="slot-item">
      <div class="pi-info">
        <div class="pi-title" style="font-size:11px">{{ c }}</div>
        <div class="pi-meta">{{ slotLabel(c) }}</div>
        <div v-if="activeFor(c)" class="slot-bar">
          <div class="slot-fill" :style="{ width: slotPct(c) + '%' }"></div>
        </div>
      </div>
      <div class="pi-right">
        <div style="font-size:10px" :style="{color: activeFor(c) ? 'var(--accent3)' : 'var(--accent2)'}">
          {{ activeFor(c) ? '🔴' : '🟢' }}
        </div>
        <div v-if="activeFor(c)" class="pi-timer">{{ fmtTime(activeFor(c).timer) }}</div>
      </div>
    </div>

    <div class="panel-info" style="margin-top:4px">Slots regionales activos:</div>
    <template v-for="[key, r] in Object.entries(REGIONS)" :key="key">
      <div v-if="activeRegion(key)" class="slot-item">
        <div class="pi-info">
          <div class="pi-title" style="font-size:11px">{{ r.icon }} {{ r.name }}</div>
          <div class="pi-meta">Slot ocupado: "{{ activeRegion(key).title.substring(0,28) }}..."</div>
          <div class="slot-bar"><div class="slot-fill" :style="{ width: slotPct(null, key) + '%' }"></div></div>
        </div>
        <div class="pi-right">
          <div style="font-size:10px;color:var(--accent3)">🔴</div>
          <div class="pi-timer">{{ fmtTime(activeRegion(key).timer) }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { REGIONS, fmtTime } from '@/constants.js';

const props = defineProps({ protests: Array, queue: Array });

const countries = computed(() => {
  const names = new Set([
    ...props.protests.filter(p => p.scope==='national').map(p => p.countryName),
    ...props.queue.filter(q => q.scope==='national').map(q => q.countryName),
  ]);
  return [...names];
});

const activeFor   = c  => props.protests.find(p => p.scope==='national' && p.countryName===c) || null;
const activeRegion = k => props.protests.find(p => p.scope==='regional' && p.region===k) || null;
const slotPct     = (c, k) => {
  const p = c ? activeFor(c) : activeRegion(k);
  return p ? Math.min(100, Math.round((p.timer / 7200) * 100)) : 0;
};
const inQueue     = c  => props.queue.filter(q => q.scope==='national' && q.countryName===c).length;
const slotLabel   = c  => {
  const a = activeFor(c);
  if (a)          return `Slot ocupado: "${a.title.substring(0,30)}..."`;
  if (inQueue(c)) return `Slot libre · ${inQueue(c)} en cola`;
  return 'Slot libre';
};
</script>
