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
    cities:      p.cities ?? 1,
    desc:        p.description,
    demands:     p.demands ?? '',
    joined:      false,
    viralCount:  p.viral_count ?? 0,
  };
}

const FALLBACK_PROTESTS = [
  {id:1,title:'Acceso a la vivienda para jóvenes',country:'ES',countryName:'España',scope:'national',region:null,count:0,heat:5,timer:172800,color:'#7C6FFF',cities:1,desc:'Los jóvenes españoles necesitan entre 8 y 12 años de ahorro íntegro para reunir el 20% de entrada exigido por los bancos. La tasa de emancipación juvenil en España (15,9%) es la más baja de la UE (media 31,4%).',demands:'Que el Gobierno derogue la obligación del 20% de entrada para primera vivienda habitual de menores de 35 años · Que establezca un sistema de garantías públicas · Que publique un plan de acceso a vivienda para jóvenes',joined:false,viralCount:0},
  {id:2,title:'Reforma del Parlamento Europeo',country:'EU',countryName:'Unión Europea',scope:'regional',region:'eu',count:412000,heat:88,timer:5400,color:'#4A6FFF',cities:890,desc:'Exigimos mayor representación ciudadana y transparencia en las instituciones europeas.',demands:'Que se reforme el sistema electoral europeo · Que los ciudadanos puedan proponer leyes directamente · Que las sesiones sean íntegramente públicas',joined:false,viralCount:0},
  {id:3,title:'Libertad para presos políticos',country:null,countryName:'Global',scope:'global',region:null,count:211000,heat:98,timer:3600,color:'#4CFFA4',cities:521,desc:'Más de 250 personas detenidas arbitrariamente. Exigimos su liberación inmediata.',demands:'Liberación inmediata e incondicional · Sanciones internacionales · Acceso a observadores independientes de DDHH.',joined:false,viralCount:0},
  {id:4,title:'Contra la corrupción del gobierno',country:'ES',countryName:'España',scope:'national',region:null,count:187432,heat:95,timer:6840,color:'#ff2020',cities:284,desc:'Denunciamos la corrupción sistémica. Exigimos transparencia total y fin de la impunidad.',demands:'Que dimita el presidente · Que se abra una investigación independiente · Que se publiquen todos los contratos públicos · Fin de la impunidad.',joined:false,viralCount:0},
  {id:5,title:'Crisis climática — Acuerdo de París',country:null,countryName:'Global',scope:'global',region:null,count:890000,heat:76,timer:86400,color:'#4CFFA4',cities:1240,desc:'Los compromisos del Acuerdo de París no se están cumpliendo.',demands:'Que se tomen medidas urgentes.',joined:false,viralCount:0},
  {id:6,title:'Política agraria común de la UE',country:'EU',countryName:'Unión Europea',scope:'regional',region:'eu',count:128000,heat:65,timer:9000,color:'#4A6FFF',cities:340,desc:'La PAC actual no protege a los pequeños agricultores ni a la biodiversidad.',demands:'Que se reforme la PAC.',joined:false,viralCount:0},
  {id:7,title:'Internet libre en Irán',country:'IR',countryName:'Irán',scope:'national',region:null,count:89234,heat:90,timer:4100,color:'#e84020',cities:198,desc:'El régimen ha bloqueado más de 15.000 sitios.',demands:'Que se desbloqueen todas las plataformas · Que cese la vigilancia · Que se libere a todos los periodistas presos.',joined:false,viralCount:0},
  {id:8,title:'Transparencia en contratos públicos',country:'MX',countryName:'México',scope:'national',region:null,count:41230,heat:65,timer:7200,color:'#e8a020',cities:97,desc:'Contratos millonarios adjudicados sin concurso público.',demands:'Que se abran licitaciones.',joined:false,viralCount:0},
];

const INITIAL_QUEUE = [
  {id:20,title:'Contra la comercialización de carne',country:'ES',countryName:'España',scope:'national',votes:1240},
  {id:21,title:'Por el transporte público gratuito',country:'FR',countryName:'Francia',scope:'national',votes:8900},
  {id:22,title:'Por el salario mínimo digno',country:'ES',countryName:'España',scope:'national',votes:15600},
  {id:23,title:'Acceso universal a medicamentos',country:null,countryName:'Global',scope:'global',votes:22100},
];

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
      if (device.confidence < 60) return { ok: false, geo: true, msg: `Confianza geográfica insuficiente (${device.confidence}%). Aporta tu documento de identidad.` };
    }
    if (p.scope === 'regional') {
      if (!inRegion(p.region, device.simCountry)) return { ok: false, geo: true, msg: `Esta convocatoria es para miembros de ${REGIONS[p.region]?.name}.` };
      if (device.confidence < 40) return { ok: false, geo: true, msg: `Confianza geográfica insuficiente (${device.confidence}%).` };
    }
    return { ok: true };
  }

  function scopeBadge(p) {
    if (p.scope === 'national') return { cls: 'sb-national', icon: '🏛️', label: p.countryName };
    if (p.scope === 'regional') return { cls: 'sb-regional', icon: '🌐', label: REGIONS[p.region]?.name || 'Regional' };
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
        country:    data.scope === 'national' ? device.simCountry : null,
        country_name: data.scope === 'national' ? device.simName
                    : data.scope === 'regional' ? (REGIONS[data.region]?.name || 'Regional')
                    : 'Global',
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
      region:      data.region || null,
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
        if (Math.random() < 0.4) p.count += Math.floor(Math.random() * 4 + 1);
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
