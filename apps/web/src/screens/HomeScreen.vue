<template>
  <div class="screen active" id="s-home">

    <!-- Left column: map + filters -->
    <div id="home-left">
      <!-- Device status bar -->
      <div class="device-bar">
        <div class="dev-flag">{{ deviceFlag }}</div>
        <div class="dev-info">
          <div class="dev-country">{{ device.simName }}{{ device.regionLabel ? ' · ' + device.regionLabel : '' }}</div>
          <div class="dev-conf">Confianza geográfica: <span :style="{color: confColor}">{{ device.confidence }}%</span></div>
        </div>
        <div class="dev-dots">
          <div class="dev-dot" :style="{background:'var(--accent2)'}" title="SIM"></div>
          <div class="dev-dot" :style="{background:'var(--accent2)'}" title="IP"></div>
          <div class="dev-dot" :style="{background: device.docCountry ? 'var(--accent2)' : 'var(--accent4)'}" title="Documento"></div>
        </div>
      </div>

      <!-- Filters + count -->
      <div class="map-topbar">
        <div class="filter-row">
          <button class="pill" :class="{active: protests.filter==='all'}"      @click="setFilter('all')">Todas</button>
          <button class="pill" :class="{active: protests.filter==='national'}" @click="setFilter('national')">🏛️ Nacional</button>
          <button class="pill" :class="{active: protests.filter==='regional'}" @click="setFilter('regional')">🌐 Local</button>
          <button class="pill" :class="{active: protests.filter==='global'}"   @click="setFilter('global')">🌍 Global</button>
        </div>
        <div class="global-chip">
          <div class="red-dot"></div>
          <span>{{ fmt(protests.globalCount) }}</span>
        </div>
      </div>

      <!-- World map -->
      <WorldMap
        :protests="protests.protests"
        :filter="protests.filter"
        :country-filter="protests.countryFilter"
        :country-filter-name="countryFilterName"
        :height="220"
        @country-click="onCountryClick"
        @clear-country="clearCountryFilter"
      />
    </div>

    <!-- Right column: panels -->
    <div id="home-right">
      <div class="panel-tabs">
        <button class="ptab" :class="{active: tab==='active'}" @click="tab='active'">Activas</button>
        <button class="ptab" :class="{active: tab==='queue'}"  @click="tab='queue'">Cola</button>
        <button class="ptab" :class="{active: tab==='slots'}"  @click="tab='slots'">Slots</button>
      </div>
      <div class="panel-body">
        <ActiveTab  v-if="tab==='active'" :protests="protests.filteredProtests" @open="openDetail" />
        <QueueTab   v-if="tab==='queue'"  :queue="protests.queue"               @boost="protests.boostQueue" />
        <SlotsTab   v-if="tab==='slots'"  :protests="protests.protests"         :queue="protests.queue" />
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useDeviceStore }   from '@/stores/device.js';
import WorldMap   from '@/components/map/WorldMap.vue';
import ActiveTab  from '@/components/home/ActiveTab.vue';
import QueueTab   from '@/components/home/QueueTab.vue';
import SlotsTab   from '@/components/home/SlotsTab.vue';
import { fmt, ISO_NUM_TO_A2 } from '@/constants.js';

const router   = useRouter();
const protests = useProtestsStore();
const device   = useDeviceStore();

const tab = ref('active');
const countryFilterName = ref(null);

const deviceFlag = computed(() => {
  const flags = { ES:'🇪🇸', FR:'🇫🇷', MX:'🇲🇽', DE:'🇩🇪', US:'🇺🇸', IR:'🇮🇷', RU:'🇷🇺' };
  return flags[device.simCountry] || '🌍';
});
const confColor = computed(() => {
  const c = device.confidence;
  return c >= 75 ? 'var(--accent2)' : c >= 50 ? 'var(--accent4)' : 'var(--accent3)';
});

function setFilter(f) {
  protests.filter = f;
  protests.countryFilter = null;
  countryFilterName.value = null;
}

function onCountryClick(isoA2, name) {
  protests.countryFilter  = isoA2;
  countryFilterName.value = name;
  tab.value = 'active';
}

function clearCountryFilter() {
  protests.countryFilter  = null;
  countryFilterName.value = null;
}

function openDetail(id) {
  router.push(`/detail/${id}`);
}
</script>
