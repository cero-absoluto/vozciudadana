<template>
  <div>
    <div class="panel-info">La ciudadanía impulsa convocatorias en espera. La más impulsada sube cuando hay slot libre en su país.</div>
    <div v-for="(q, i) in sorted" :key="q.id" class="q-item">
      <div class="q-rank">#{{ i + 1 }}</div>
      <div class="pi-info">
        <div class="pi-title">{{ q.title }}</div>
        <div class="pi-meta"><span>{{ q.countryName }}</span></div>
      </div>
      <div class="q-votes">{{ fmt(q.votes) }}</div>
      <button class="q-boost" :id="'qb-' + q.id" :disabled="boosted.has(q.id)" @click="boost(q.id)">
        {{ boosted.has(q.id) ? '✓ Impulsado' : '+ Impulsar' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { fmt } from '@/constants.js';

const props = defineProps({ queue: Array });
const emit  = defineEmits(['boost']);
const boosted = ref(new Set());

const sorted = computed(() => [...props.queue].sort((a, b) => b.votes - a.votes));

function boost(id) {
  emit('boost', id);
  boosted.value = new Set([...boosted.value, id]);
}
</script>
