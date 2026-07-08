<template>
  <div class="screen active" id="s-home">

    <!-- Left column: map + filters -->
    <div id="home-left">
      <!-- Compact 3-step strip (gateway) -->
      <div class="steps-strip">
        <div class="ss-item">
          <span class="ss-ic"><span class="ss-num">1</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11.5v5M9.5 14h5"/></svg></span>
          <span class="ss-tx"><b>{{ $t('home.stepJoin') }}</b><span>{{ $t('home.stepJoinSub') }}</span></span>
        </div>
        <span class="ss-arr">→</span>
        <div class="ss-item">
          <span class="ss-ic"><span class="ss-num">2</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg></span>
          <span class="ss-tx"><b>{{ $t('home.stepVerify') }}</b><span>{{ $t('home.stepVerifySub') }}</span></span>
        </div>
        <span class="ss-arr">→</span>
        <div class="ss-item">
          <span class="ss-ic"><span class="ss-num">3</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V11M12 21V4M19 21v-6"/></svg></span>
          <span class="ss-tx"><b>{{ $t('home.stepResults') }}</b><span>{{ $t('home.stepResultsSub') }}</span></span>
        </div>
      </div>
      <!-- Device status bar -->
      <div class="device-bar">
        <div class="dev-info">
          <div class="dev-country"><span class="dev-flag">{{ deviceFlag }}</span> {{ displayCountryName }}{{ device.regionLabel ? ' · ' + device.regionLabel : '' }}</div>
          <div class="dev-conf">
            {{ $t('home.geoConfidence') }} <span :style="{color: confColor}">{{ device.confidence }}%</span>
          </div>
          <div v-if="!device.gpsReady" @click="strengthenGps"
            style="font-size:13px;color:var(--accent2);cursor:pointer;text-decoration:underline;font-weight:600;margin-top:3px">
            📍 {{ strengtheningGps ? '...' : $t('home.improveConfidence') }}
          </div>
          <div v-else style="font-size:13px;color:var(--accent);font-weight:700;margin-top:3px">
            📍 GPS ✓
          </div>
        </div>
        <div class="dev-dots">
          <div class="dev-dot" :style="{background:'var(--accent2)'}" title="SIM"></div>
          <div class="dev-dot" :style="{background:'var(--accent2)'}" title="IP"></div>
          <div class="dev-dot" :style="{background: device.docCountry ? 'var(--accent2)' : 'var(--accent4)'}" :title="$t('home.dotDocument')"></div>
        </div>
      </div>

     <!-- Overlay bienvenida — solo primera vez -->
      <div v-if="showMapOverlay" 
        style="position:absolute;top:0;left:0;right:0;bottom:0;z-index:10;background:rgba(6,14,26,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;border-radius:0"
        @click="cerrarOverlay">
        <div style="text-align:center;padding:20px">
          <div style="font-size:40px;margin-bottom:12px;animation:pulse-map 1.5s ease-in-out infinite">🌍</div>
          <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;color:white;margin-bottom:8px;line-height:1.3">
            {{ $t('home.overlayTitle') }}
          </div>
          <div style="font-size:25px;color:rgba(255,255,255,.9);line-height:1.7;margin-bottom:16px">
            {{ $t('home.overlayBody') }}
          </div>
          <div style="display:flex;align-items:center;gap:6px;justify-content:center;margin-bottom:20px">
            <div style="width:8px;height:8px;border-radius:50%;background:var(--accent2);animation:pulse-map 1s ease-in-out infinite"></div>
            <div style="font-size:11px;color:var(--accent2)">{{ $t('home.overlayLive') }}</div>
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,.4)">{{ $t('home.overlayTap') }}</div>
        </div>
        <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:var(--accent);transform-origin:left" :style="{width: timerWidth + '%'}"></div>
      </div>
      <!-- World map -->
      <WorldMap
        :protests="protests.protests"
        :filter="protests.filter"
        :country-filter="protests.countryFilter"
        :country-filter-name="countryFilterName"
        :home-country="device.simCountry"
        :fallback-country="device.ipCountry"
        :height="220"
        @country-click="onCountryClick"
        @clear-country="clearCountryFilter"
      />

      <!-- Filters + count -->
      <div class="map-topbar">
        <div class="filter-row">
          <button class="pill" :class="{active: protests.filter==='global'}"   @click="setFilter('global')">{{ $t('home.filterGlobal') }}</button>
          <button class="pill" :class="{active: protests.filter==='national'}" @click="setFilter('national')">{{ $t('home.filterNational') }}</button>
          <button class="pill" :class="{active: protests.filter==='regional'}" @click="setFilter('regional')">{{ $t('home.filterRegional') }}</button>
          <button class="pill" :class="{active: protests.filter==='local'}"    @click="setFilter('local')">{{ $t('home.filterLocal') }}</button>
          <button class="pill" :class="{active: protests.filter==='institutional'}" @click="setFilter('institutional')">{{ $t('home.filterInstitutional') }}</button>
        </div>
        <div class="global-chip">
          <div class="red-dot"></div>
          <span>{{ fmt(protests.globalCount) }}</span>
        </div>
      </div>
    </div>

    <!-- Right column: panels (shown once a country or scope is selected) -->
    <div id="home-right" v-if="protests.countryFilter || protests.filter !== 'all'">
      <div class="panel-tabs">
        <button class="ptab" :class="{active: tab==='active'}" @click="tab='active'">{{ $t('home.tabActive') }}</button>
        <button class="ptab" :class="{active: tab==='queue'}"  @click="tab='queue'">{{ $t('home.tabQueue') }}</button>
        <button class="ptab" :class="{active: tab==='slots'}"  @click="tab='slots'">{{ $t('home.tabSlots') }}</button>
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
import { useI18n } from 'vue-i18n';
import { useProtestsStore } from '@/stores/protests.js';
import { useDeviceStore }   from '@/stores/device.js';
import WorldMap   from '@/components/map/WorldMap.vue';
import ActiveTab  from '@/components/home/ActiveTab.vue';
import QueueTab   from '@/components/home/QueueTab.vue';
import SlotsTab   from '@/components/home/SlotsTab.vue';
import { fmt, ISO_NUM_TO_A2, localizedCountry } from '@/constants.js';

const router   = useRouter();
const protests = useProtestsStore();
const device   = useDeviceStore();
const { locale } = useI18n({ useScope: 'global' });

const tab = ref('active');
const showMapOverlay = ref(!localStorage.getItem('vc_map_intro'));
const timerWidth = ref(100);
let timerInterval = null;

function cerrarOverlay() {
  showMapOverlay.value = false;
  localStorage.setItem('vc_map_intro', '1');
  if (timerInterval) clearInterval(timerInterval);
}

if (showMapOverlay.value) {
  const duration = 5000;
  const steps = 50;
  const stepTime = duration / steps;
  let current = steps;
  timerInterval = setInterval(() => {
    current--;
    timerWidth.value = (current / steps) * 100;
    if (current <= 0) cerrarOverlay();
  }, stepTime);
}
const countryFilterName = ref(null);

const deviceFlag = computed(() => {
  const code = device.ipCountry || device.simCountry;
  if (!code || code.length !== 2) return '🌍';
  // Build flag from Unicode regional indicator symbols — renders consistently
  // across platforms as long as the OS has any flag-capable font, and avoids
  // a hardcoded country list that was missing most countries (e.g. Malta).
  const codePoints = code.toUpperCase().split('').map(c => 0x1F1E6 - 65 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
});

const displayCountryName = computed(() => localizedCountry(device.simCountry || device.ipCountry, locale.value) || device.simName);
const strengtheningGps = ref(false);
async function strengthenGps() {
  if (strengtheningGps.value || device.gpsReady) return;
  strengtheningGps.value = true;
  await device.requestGps();
  strengtheningGps.value = false;
}

const confColor = computed(() => {
  const c = device.confidence;
  return c >= 75 ? 'var(--accent2)' : 'var(--accent4)';
});

function setFilter(f) {
  // toggle: tapping the active scope again returns to the no-filter (gateway) view
  protests.filter = (protests.filter === f) ? 'all' : f;
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
