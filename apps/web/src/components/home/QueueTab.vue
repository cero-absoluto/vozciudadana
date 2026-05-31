<template>
  <div>
    <div class="panel-info">{{ $t('queue.info') }}</div>
    <div v-for="(q, i) in sorted" :key="q.id" class="q-item">
      <div class="q-rank">#{{ i + 1 }}</div>
      <div class="pi-info">
        <div class="pi-title">{{ q.title }}</div>
        <div class="pi-meta"><span>{{ q.countryName }}</span></div>
      </div>
      <div class="q-votes">{{ fmt(q.votes) }}</div>
      <button class="q-boost" :id="'qb-' + q.id" :disabled="boosted.has(q.id)" @click="boost(q.id)">
        {{ boosted.has(q.id) ? $t('queue.boosted') : $t('queue.boost') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { fmt } from '@/constants.js';

const { t: _t } = useI18n(); // ensure i18n is available for template

const props = defineProps({ queue: Array });
const emit  = defineEmits(['boost']);
const boosted = ref(new Set());

const sorted = computed(() => [...props.queue].sort((a, b) => b.votes - a.votes));

function boost(id) {
  emit('boost', id);
  boosted.value = new Set([...boosted.value, id]);
}
</script>
