<template>
  <div class="screen active" id="s-archivo">
    <div class="arch-hdr">
      <div class="arch-title">{{ $t('archivo.title') }}</div>
      <div class="arch-sub">{{ $t('archivo.subtitle') }}</div>
    </div>

    <!-- Filtros -->
    <div class="arch-filters">
      <select id="archive-filter-type" v-model="filtroTipo" class="arch-sel" :aria-label="$t('archivo.filterTypeLabel')">
        <option value="">{{ $t('archivo.filterAll') }}</option>
        <option value="national">{{ $t('archivo.filterNational') }}</option>
        <option value="regional">{{ $t('archivo.filterRegional') }}</option>
        <option value="local">{{ $t('archivo.filterLocal') }}</option>
        <option value="global">{{ $t('archivo.filterGlobal') }}</option>
        <option value="institutional">{{ $t('archivo.filterInstitutional') }}</option>
      </select>
      <select id="archive-filter-country" v-model="filtroPais" class="arch-sel" :aria-label="$t('archivo.filterCountryLabel')">
        <option value="">{{ $t('archivo.filterAllCountries') }}</option>
        <option v-for="code in paisesDisponibles" :key="code" :value="code">{{ localizedCountry(code, locale) || code }}</option>
      </select>
      <select id="archive-filter-sort" v-model="filtroOrden" class="arch-sel" :aria-label="$t('archivo.sortLabel')">
        <option value="fecha">{{ $t('archivo.sortDate') }}</option>
        <option value="adheridos">{{ $t('archivo.sortAdheridos') }}</option>
      </select>
    </div>

    <!-- Lista -->
    <div class="arch-list" v-if="!loading && !loadError">
      <div v-if="protestasFiltered.length === 0" class="arch-empty">
        <div style="font-size:36px;margin-bottom:12px">📭</div>
        <div style="font-size:16px;color:var(--text2)">{{ $t('archivo.empty') }}</div>
      </div>

      <div v-for="p in protestasFiltered" :key="p.id"
           class="arch-item" @click="$router.push(`/informe/${p.id}`)">

        <!-- Cabecera: badge + fecha -->
        <div class="arch-item-hdr">
          <span :class="scopeBadge(p).cls">
            {{ scopeBadge(p).icon }} {{ scopeBadge(p).label }}
          </span>
          <span class="arch-fecha">{{ fmtFecha(p.ends_at) }}</span>
        </div>

        <!-- Título -->
        <div class="arch-item-title">{{ p.title }}</div>

        <!-- Meta -->
        <div class="arch-item-meta">
          <span>📍 {{ localizedCountry(p.country, locale) || p.country_name }}</span>
          <span>👤 {{ fmt(p.count ?? 0) }} {{ $t('archivo.metaAdheridos') }}</span>
          <span v-if="p.cities_count > 0">🏙️ {{ p.cities_count }} {{ $t('archivo.metaCiudades') }}</span>
        </div>

        <!-- Footer -->
        <div class="arch-item-footer">
          {{ $t('archivo.seeReport') }}
        </div>
      </div>
    </div>

    <div v-if="loadError" class="arch-loading" role="alert">
      <div style="font-size:15px;color:var(--text2);margin-bottom:12px">{{ $t('archivo.loadError') }}</div>
      <button type="button" class="btn-primary" @click="loadArchive">{{ $t('archivo.retry') }}</button>
    </div>

    <div v-if="loading" class="arch-loading">
      <div class="spin-ring"></div>
      <div style="font-size:15px;color:var(--text2);margin-top:12px">{{ $t('archivo.loading') }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { localizedCountry } from '@/constants.js';

const { t, locale } = useI18n({ useScope: 'global' });

const loading  = ref(false);
const loadError = ref(false);
const protestas = ref([]);
const filtroTipo  = ref('');
const filtroPais  = ref('');
const filtroOrden = ref('fecha');

const scopeBadge = p => {
  // Para institucionales, mostrar el nombre de la institución si está disponible
  if (p.scope === 'institutional' || p.dominio_email) {
    return { cls: 'arch-badge badge-inst', icon: '🏢', label: p.convocatoria_institucion || t('archivo.filterInstitutional') };
  }
  const badges = {
    national:      { cls: 'arch-badge badge-nat',  icon: '🏛️', label: t('archivo.filterNational') },
    regional:      { cls: 'arch-badge badge-reg',  icon: '🌐', label: t('archivo.filterRegional') },
    global:        { cls: 'arch-badge badge-glob', icon: '🌍', label: t('archivo.filterGlobal') },
    local:         { cls: 'arch-badge badge-reg',  icon: '📍', label: t('archivo.filterLocal') },
  };
  return badges[p.scope] ?? { cls: 'arch-badge', icon: '📢', label: p.scope };
};

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(locale.value, { day: '2-digit', month: 'short', year: 'numeric' });
}

const paisesDisponibles = computed(() => {
  const set = new Set(protestas.value.map(p => p.country).filter(Boolean));
  return [...set].sort();
});

const protestasFiltered = computed(() => {
  let list = [...protestas.value];
  if (filtroTipo.value)  list = list.filter(p => p.scope === filtroTipo.value);
  if (filtroPais.value)  list = list.filter(p => p.country === filtroPais.value);
  if (filtroOrden.value === 'adheridos') {
    list.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  } else {
    list.sort((a, b) => new Date(b.ends_at) - new Date(a.ends_at));
  }
  return list;
});

async function loadArchive() {
  if (loading.value) return;
  loading.value = true;
  loadError.value = false;
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/protests/archivo`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid archive payload');
    protestas.value = data;
  } catch {
    protestas.value = [];
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(loadArchive);
</script>
