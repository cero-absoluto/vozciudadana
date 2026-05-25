import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { REGIONS, inRegion, fmtTime } from '@/constants.js';
import { useDeviceStore } from './device.js';
import * as api from '@/services/api.js';

const SCOPE_COLOR = { national: '#7C6FFF', regional: '#FFB347', global: '#4CFFA4' };

/** Map an API protest record to the shape the UI expects. */
function normalizeProtest(p) {
  const endsAt = new Date(p.ends_at).getTime();
  return {
    id:          p.id,
    title:       p.title,
    country:     p.country ?? null,
    countryName: p.country_name,
    scope:       p.scope,
    region:      p.region ?? null,
    count:       p.count ?? 0,
    heat:        p.heat ?? 5,
    timer:       Math.max(0, Math.floor((endsAt - Date.now()) / 1000)),
    color:       SCOPE_COLOR[p.scope] ?? '#7C6FFF',
    cities:      p.cities_count ?? 0,
    desc:        p.description,
    demands:     p.demands ?? '',
    joined:      false,
    viralCount:  p.viral_count ?? 0,
    convocatoria_pais:        p.convocatoria_pais ?? null,
    convocatoria_region:      p.convocatoria_region ?? null,
    convocatoria_institucion: p.convocatoria_institucion ?? null,
    dominio_email:            p.dominio_email ?? null,
    requiere_censo:           p.requiere_censo ?? false,
  };
}

const FALLBACK_PROTESTS = [];

const INITIAL_QUEUE = [ ];

export const useProtestsStore = defineStore('protests', () => {
  const protests      = ref(FALLBACK_PROTESTS.map(p => ({ ...p })));
  const queue         = ref(INITIAL_QUEUE.map(q => ({ ...q })));
  const loading       = ref(false);
  const error         = ref(null);
  const filter        = ref('all');   // 'all' | 'national' | 'regional' | 'global'
  const countryFilter = ref(null);    // ISO alpha-2 or null

  // ── Getters ────────────────────────────────────────────────────────────────
  const globalCount = computed(() => protests.value.reduce((s, p) => s + p.count, 0));

  const filteredProtests = computed(() => {
    const device = useDeviceStore();
    let list = filter.value === 'all' ? protests.value : protests.value.filter(p => p.scope === filter.value);
    if (countryFilter.value) {
      const byCountry = list.filter(p => p.country === countryFilter.value);
      if (byCountry.length) list = byCountry;
    }
    const sorted = [...list].sort((a, b) => b.heat - a.heat);

    // En modo 'all' sin filtro de país: mostrar 1 nacional del dispositivo + 1 global
    if (filter.value === 'all' && !countryFilter.value) {
      const national = sorted.filter(p => p.scope === 'national' && p.country === device.simCountry);
      const global   = sorted.filter(p => p.scope === 'global');
      const regional = sorted.filter(p => p.scope === 'regional');
      const others   = sorted.filter(p => p.scope === 'national' && p.country !== device.simCountry);
      // 1 nacional propio + 1 global + resto ordenado por heat
      const top = [
        ...(national.length ? [national[0]] : []),
        ...(global.length   ? [global[0]]   : []),
        ...(regional.slice(0, 1)),
        ...others.slice(0, 2),
      ];
      // Deduplicar
      const seen = new Set();
      return top.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
    }
    return sorted;
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function canJoin(p) {
    if (p.joined) return { ok: false, joined: true };
    const device = useDeviceStore();

    if (p.scope === 'national') {
      const active = protests.value.find(x => x.scope === 'national' && x.joined && x.id !== p.id);
      if (active) return { ok: false, lock: true, msg: `Tu dispositivo ya está adherido a "${active.title}" (${fmtTime(active.timer)} restante).` };
    }
    if (p.scope === 'regional') {
      const active = protests.value.find(x => x.scope === 'regional' && x.region === p.region && x.joined && x.id !== p.id);
      if (active) return { ok: false, lock: true, msg: `Tu dispositivo ya está adherido a una convocatoria del bloque ${REGIONS[p.region]?.name}.` };
    }
    if (p.scope === 'global') {
      const active = protests.value.find(x => x.scope === 'global' && x.joined && x.id !== p.id);
      if (active) return { ok: false, lock: true, msg: `Tu dispositivo ya está adherido a una convocatoria global: "${active.title}".` };
    }

    if (p.scope === 'national') {
      if (device.simCountry !== p.country) return { ok: false, geo: true, msg: `Esta convocatoria es exclusivamente para ciudadanos de ${p.countryName}.` };
      if (device.confidence < 60) return { ok: false, geo: true, msg: `Confianza geográfica insuficiente (${device.confidence}%).` };
    }
    if (p.scope === 'regional') {
  if (p.dominio_email) return { ok: true };
  if (p.convocatoria_pais) {
    const simOk = device.simCountry === p.convocatoria_pais;
    const ipOk  = device.ipCountry  === p.convocatoria_pais;
    if (!simOk && !ipOk) return { ok: false, geo: true, msg: `Esta convocatoria es para personas en ${p.countryName}.` };
  }
}
    return { ok: true };
  }

  function scopeBadge(p) {
    if (p.scope === 'national') return { cls: 'sb-national', icon: '🏛️', label: p.countryName };
    if (p.scope === 'regional') return { cls: 'sb-regional', icon: '🌐', label: 'Local' };
    return { cls: 'sb-global', icon: '🌍', label: 'Global' };
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function loadProtests(filters = {}) {
    loading.value = true;
    error.value = null;
    try {
      const data = await api.fetchProtests(filters);
      const locks = useDeviceStore().getLocks();
      protests.value = data.map(p => {
        const n = normalizeProtest(p);
        if (locks[n.id]) n.joined = true;
        return n;
      });
    } catch (err) {
      error.value = err.message;
      // Fall back to demo data so the UI stays usable offline
      if (!protests.value.length) {
        protests.value = FALLBACK_PROTESTS.map(p => ({ ...p }));
      }
    } finally {
      loading.value = false;
    }
  }

  function joinProtest(id) {
    const p = protests.value.find(x => x.id === id);
    if (!p) return;
    p.joined = true;
    p.count += 1;
    p.viralCount = p.viralCount || Math.floor(p.count * 0.022);
    useDeviceStore().setLock(id);
  }

  function incrementViral(id) {
    const p = protests.value.find(x => x.id === id);
    if (!p) return;
    p.viralCount = (p.viralCount || 0) + 1;
  }

  function boostQueue(id) {
    const q = queue.value.find(x => x.id === id);
    if (q) q.votes += 1;
  }

  async function createProtest(data) {
    const device = useDeviceStore();
    const dur = parseFloat(data.duration_h) || 2;
    try {
      const created = await api.createProtest({
  ...data,
  duration_h: dur,
  country: data.country || (data.scope === 'national' ? device.simCountry : null),
  country_name: data.country_name || (data.scope === 'national' ? device.simName : data.scope === 'regional' ? 'Regional' : 'Global'),
      });
      protests.value.push(normalizeProtest(created));
      return created;
    } catch (err) {
      // Optimistic local insert so the UI doesn't freeze if the API is down
    protests.value.push({
      id: Date.now(),
      title:       data.title,
      country:     data.scope === 'national' ? device.simCountry : null,
        countryName: data.scope === 'national' ? device.simName
                   : data.scope === 'regional' ? (REGIONS[data.region]?.name || 'Regional')
                   : 'Global',
      scope:       data.scope,
      region:      data.region || undefined,
      count:       0,
      heat:        5,
      timer:       dur * 3600,
        color:       SCOPE_COLOR[data.scope] ?? '#7C6FFF',
      cities:      1,
      desc:        data.description,
      demands:     data.demands,
      joined:      false,
      viralCount:  0,
    });
      throw err;
    }
  }

  function tickTimers() {
    protests.value.forEach(p => {
      if (p.timer > 0) {
        p.timer--;
      }
    });
  }

  // Restore joined state from localStorage on init, then load from API
  async function restoreFromStorage() {
    const locks = useDeviceStore().getLocks();
    protests.value.forEach(p => {
      if (locks[p.id]) p.joined = true;
    });
    await loadProtests();
  }

  return {
    protests, queue, filter, countryFilter, loading, error,
    globalCount, filteredProtests,
    canJoin, scopeBadge,
    loadProtests, joinProtest, incrementViral, boostQueue, createProtest, tickTimers, restoreFromStorage,
  };
});
