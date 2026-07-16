import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { REGIONS, inRegion, fmtTime, displayScope } from '@/constants.js';
import { useDeviceStore } from './device.js';
import * as api from '@/services/api.js';

const SCOPE_COLOR = { national: '#7C6FFF', regional: '#FFB347', local: '#4CC8FF', global: '#4CFFA4' };
const INST_COLOR = '#FF7CB0'; // institutional events, distinct on the map

/** Map an API protest record to the shape the UI expects. */
function normalizeProtest(p) {
  const endsAt = new Date(p.ends_at).getTime();
  return {
    id:          p.id,
    title:       p.title,
    country:     p.country ?? p.convocatoria_pais ?? null,
    countryName: p.country_name,
    scope:       p.scope,
    region:      p.region ?? null,
    count:       p.count ?? 0,
    heat:        p.heat ?? 5,
    timer:       Math.max(0, Math.floor((endsAt - Date.now()) / 1000)),
    color:       p.dominio_email ? INST_COLOR : (SCOPE_COLOR[p.scope] ?? '#7C6FFF'),
    cities:      p.cities_count ?? 0,
    desc:        p.description,
    demands:     p.demands ?? '',
    joined:      false,
    viralCount:  p.viral_count ?? 0,
    convocatoria_pais:        p.convocatoria_pais ?? null,
    convocatoria_region:      p.convocatoria_region ?? null,
    convocatoria_institucion: p.convocatoria_institucion ?? null,
    convocatoria_osm_id:      p.convocatoria_osm_id ?? null,
    convocatoria_ciudad_nombre: p.convocatoria_ciudad_nombre ?? null,
    convocatoria_lat:         p.convocatoria_lat ?? null,
    convocatoria_lon:         p.convocatoria_lon ?? null,
    dominio_email:            p.dominio_email ?? null,
    requiere_censo:           p.requiere_censo ?? false,
    saldo_euros:              p.saldo_euros ?? 0,
    donaciones_count:         p.donaciones_count ?? 0,
    donaciones_total:         p.donaciones_total ?? 0,
    ultima_donacion:          p.ultima_donacion ?? null,
    ends_at:                  p.ends_at ?? null,
    focal_point:              p.focal_point ?? null,
    fuente_url:               p.fuente_url ?? null,
    tipo_abuso:               p.tipo_abuso ?? null,
    risk_level:               p.risk_level ?? null,
    source_type:              p.source_type ?? null,
    source_confidence_score:  p.source_confidence_score ?? null,
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
  // Closed convocatorias only ever end up in `protests` via fetchProtestById()
  // (someone viewing a direct link after closure) — they must never surface
  // in home listings, map picks or the global counter, only on their own
  // DetailScreen/InformeScreen.
  const globalCount = computed(() =>
    protests.value.reduce((s, p) => s + (p.timer > 0 ? p.count : 0), 0));

  // Same exclusion as filteredProtests/globalCount, exposed as a plain list
  // for components that render every open protest without going through the
  // scope/country filter pipeline (the map, the slots tab).
  const openProtests = computed(() => protests.value.filter(p => p.timer > 0));

  const filteredProtests = computed(() => {
    const device = useDeviceStore();
    const open = protests.value.filter(p => p.timer > 0);
    let list = filter.value === 'all' ? open : open.filter(p => displayScope(p) === filter.value);
    // Al pinchar un país, filtrar ESTRICTAMENTE a ese país (nacional, regional,
    // local e institucional — todas llevan p.country). Si no hay ninguna, la
    // lista queda vacía (estado vacío), en vez de mostrar las de otros países.
    if (countryFilter.value) {
      list = list.filter(p => p.country === countryFilter.value);
    }
    const sorted = [...list].sort((a, b) => b.heat - a.heat);

    // En modo 'all' sin filtro de país: mostrar 1 de cada categoría de display
    if (filter.value === 'all' && !countryFilter.value) {
      const national      = sorted.filter(p => displayScope(p) === 'national' && p.country === device.simCountry);
      const global        = sorted.filter(p => displayScope(p) === 'global');
      const regional      = sorted.filter(p => displayScope(p) === 'regional');
      const local         = sorted.filter(p => displayScope(p) === 'local');
      const institutional = sorted.filter(p => displayScope(p) === 'institutional');
      const others        = sorted.filter(p => displayScope(p) === 'national' && p.country !== device.simCountry);
      const top = [
        ...(global.length   ? [global[0]]   : []),
        ...(national.length ? [national[0]] : []),
        ...(regional.slice(0, 1)),
        ...(local.slice(0, 1)),
        ...(institutional.slice(0, 1)),
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
    if (p.scope === 'regional' && !p.dominio_email) {
      const active = protests.value.find(x => x.scope === 'regional' && !x.dominio_email && x.region === p.region && x.joined && x.id !== p.id);
      if (active) return { ok: false, lock: true, msg: `Tu dispositivo ya está adherido a una convocatoria del bloque ${REGIONS[p.region]?.name}.` };
    }
    if (p.scope === 'global') {
      const active = protests.value.find(x => x.scope === 'global' && x.joined && x.id !== p.id);
      if (active) return { ok: false, lock: true, msg: `Tu dispositivo ya está adherido a una convocatoria global: "${active.title}".` };
    }

    if (p.scope === 'national') {
      // National eligibility = SIM country matches the convocatoria's country.
      // Geographic confidence is INFORMATIVE ONLY (shown in the report) and must
      // not block adhesion — otherwise legitimate citizens whose auxiliary
      // signals (IP/GPS/timezone/language) are weak or misaligned would be
      // unfairly excluded. Auxiliary signals describe signal quality, not rights.
      if (device.simCountry !== p.country) return { ok: false, geo: true, msg: `Esta convocatoria es exclusivamente para ciudadanos de ${p.countryName}.` };
    }
   if (p.scope === 'regional') {
      if (p.dominio_email) return { ok: true };
      if (p.convocatoria_pais) {
        const simOk = device.simCountry === p.convocatoria_pais;
        const ipOk  = device.ipCountry  === p.convocatoria_pais;
        if (!simOk && !ipOk) return { ok: false, geo: true, msg: `Esta convocatoria es para personas en ${p.countryName}.` };
      }
      return { ok: true };
    }
      return { ok: true };
  }
  function scopeBadge(p) {
    if (p.dominio_email)        return { cls: 'sb-inst',     icon: '🏢', label: p.convocatoria_institucion || p.dominio_email || 'Institucional' };
    if (p.scope === 'national') return { cls: 'sb-national', icon: '🏛️', label: p.countryName };
    if (p.scope === 'regional') return { cls: 'sb-regional', icon: '🌐', label: 'Regional' };
    if (p.scope === 'local')    return { cls: 'sb-local',    icon: '📍', label: p.convocatoria_ciudad_nombre || 'Local' };
    return { cls: 'sb-global', icon: '🌍', label: 'Global' };
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function loadProtests(filters = {}) {
    loading.value = true;
    error.value = null;
    try {
      const data = await api.fetchProtests(filters);
      const locks = useDeviceStore().getLocks();
      const fresh = data.map(p => {
        const n = normalizeProtest(p);
        if (locks[n.id]) n.joined = true;
        return n;
      });
      // GET /api/protests only returns active convocatorias (ends_at in the
      // future). Preserve any already-closed one currently held in memory —
      // it only gets there via fetchProtestById(), i.e. someone is actively
      // viewing it via a direct link — so a background refresh here doesn't
      // race it back into a blank DetailScreen.
      const freshIds = new Set(fresh.map(p => p.id));
      const keptClosed = protests.value.filter(p => p.timer <= 0 && !freshIds.has(p.id));
      protests.value = [...fresh, ...keptClosed];
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

  // Fallback fetch for direct links (e.g. shared via WhatsApp) to a protest
  // that isn't in the already-loaded list — either because loadProtests()
  // hasn't resolved yet, or because the protest has already closed and the
  // list endpoint only returns active ones (GET /api/protests filters by
  // ends_at). Returns the normalized protest, or null if it truly doesn't
  // exist (404). Never throws — callers just check the return value.
  async function fetchProtestById(id) {
    const existing = protests.value.find(p => String(p.id) === String(id));
    if (existing) return existing;
    try {
      const raw = await api.fetchProtest(id);
      const n = normalizeProtest(raw);
      const locks = useDeviceStore().getLocks();
      if (locks[n.id]) n.joined = true;
      protests.value.push(n);
      return n;
    } catch (err) {
      return null;
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
    // No optimistic local-only fallback here anymore: CreateScreen.vue now
    // awaits this call and shows the real error to the person on ANY
    // failure (network or a real admission rejection), so a phantom local
    // entry no longer serves its original purpose (masking a failure as a
    // success) — it only left a ghost card in the list until the next
    // reload, which is exactly the "duplicate" that showed up in testing.
    const created = await api.createProtest({
      ...data,
      duration_h: dur,
      country: data.country || (data.scope === 'national' ? device.simCountry : null),
      country_name: data.country_name || (data.scope === 'national' ? device.simName : data.scope === 'regional' ? 'Regional' : 'Global'),
    });
    protests.value.push(normalizeProtest(created));
    return created;
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
    globalCount, filteredProtests, openProtests,
    canJoin, scopeBadge,
    loadProtests, fetchProtestById, joinProtest, incrementViral, boostQueue, createProtest, tickTimers, restoreFromStorage,
  };
});

