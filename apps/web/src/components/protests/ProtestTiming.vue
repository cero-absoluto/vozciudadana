<template>
  <div class="protest-timing">
    <strong>{{ timing.state === 'upcoming' ? t('timing.upcoming', { time: fmtTime(timing.seconds) }) : t(`timing.${timing.state}`) }}</strong>
    <div v-if="Number.isFinite(timing.start)">{{ t('timing.starts', { date: date(timing.start) }) }}</div>
    <div v-if="Number.isFinite(timing.end)">{{ t(timing.state === 'ended' ? 'timing.endedOn' : 'timing.ends', { date: date(timing.end) }) }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { fmtTime } from '@/constants.js';
import { protestTiming } from '@/protestTiming.js';

const props = defineProps({ protest: { type: Object, required: true } });
const { t, locale } = useI18n({ useScope: 'global' });
const now = ref(Date.now());
const timing = computed(() => protestTiming(props.protest, now.value));
let interval;
onMounted(() => { now.value = Date.now(); interval = setInterval(() => { now.value = Date.now(); }, 1000); });
onUnmounted(() => clearInterval(interval));
function date(ms) {
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(ms);
}
</script>

<style scoped>
.protest-timing { margin: 6px 0; font-size: 12px; line-height: 1.5; color: var(--text2); overflow-wrap: anywhere; }
.protest-timing strong { color: var(--text); }
</style>
