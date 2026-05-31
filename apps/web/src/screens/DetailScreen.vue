<template>
  <div class="screen active" id="s-detail" v-if="protest">
    <!-- Header -->
    <div class="detail-hdr">
      <button class="back" @click="$router.back()">← Volver al mapa</button>
      <div class="d-title">{{ protest.title }}</div>
      <div class="d-loc">
        <span class="scope-badge" :class="store.scopeBadge(protest).cls">{{ store.scopeBadge(protest).icon }} {{ store.scopeBadge(protest).label }}</span>
        <span style="font-size:11px;color:var(--text2)">📍 {{ protest.countryName }}</span>
      </div>
    </div>

    <!-- Particle map -->
    <DetailMap :participant-count="protest.count" :joined="protest.joined" />

    <div class="d-scroll">
      <!-- Stats -->
      <div class="stats-row">
        <div class="sc"><div class="sc-n" style="color:var(--accent)">{{ fmt(protest.count) }}</div><div class="sc-l">Adheridos</div></div>
        <div class="sc"><div class="sc-n" style="color:var(--accent2)">{{ protest.cities }}</div><div class="sc-l">Ciudades</div></div>
        <div class="sc"><div class="sc-n" style="color:var(--accent3)">{{ fmtTime(protest.timer) }}</div><div class="sc-l">Restante</div></div>
      </div>
      <!-- Velocidad — solo si hay datos de hoy -->
      <div v-if="velocidadHoy > 0" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(76,255,164,.06);border:.5px solid rgba(76,255,164,.2);border-radius:var(--r);margin-bottom:8px">
        <div style="width:6px;height:6px;border-radius:50%;background:var(--accent2);animation:blink 1.5s infinite;flex-shrink:0"></div>
        <div style="font-size:11px;color:var(--accent2)">
          <strong>+{{ velocidadHoy }}</strong> nuevas adhesiones hoy
          <span v-if="tendenciaHoy > 0" style="color:var(--accent2)"> · ↑ más que ayer</span>
          <span v-else-if="tendenciaHoy < 0" style="color:var(--accent4)"> · ↓ menos que ayer</span>
        </div>
      </div>

      <!-- Geo validation -->
      <div v-if="protest.scope !== 'global'" class="geo-validation">
        <div class="gv-title">Validación geográfica</div>
        <div class="gv-row">
          <div class="gv-dot" :style="{background: simOk ? 'var(--accent2)' : 'var(--accent3)'}"></div>
          <div class="gv-label">SIM / Prefijo</div>
          <div class="gv-val" :class="simOk ? 'gv-ok' : 'gv-no'">
            {{ simOk ? '✓ ' + device.simPrefix + ' (' + device.simName + ')' : '✗ Diferente país' }}
          </div>
        </div>
        <div class="gv-row">
          <div class="gv-dot" :style="{background: simOk ? 'var(--accent2)' : 'var(--accent3)'}"></div>
          <div class="gv-label">IP / Ubicación</div>
          <div class="gv-val" :class="simOk ? 'gv-ok' : 'gv-no'">
            {{ simOk ? '✓ ' + device.ipCity : '✗ Diferente país' }}
          </div>
        </div>
        
        <div class="conf-bar"><div class="conf-fill" :style="{ width: device.confidence + '%', background: confFillColor }"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:3px">
          <div style="font-size:10px;color:var(--text2)">Confianza geográfica</div>
          <div style="font-size:8px;font-weight:600" :style="{color: confFillColor}">{{ device.confidence }}%</div>
        </div>
      </div>

      <!-- Lock / geo message -->
      <div v-if="!cj.ok && !cj.joined">
        <div v-if="cj.lock" class="lock-detail">🔒 <strong>Dispositivo bloqueado:</strong> {{ cj.msg }}</div>
        <div v-else-if="cj.geo" class="geo-detail">🌍 <strong>Fuera de alcance geográfico:</strong> {{ cj.msg }}</div>
      </div>

      <div class="block"><div class="block-title">Sobre esta convocatoria</div><div class="d-desc">{{ protest.desc }}</div></div>
      <div v-if="protest.demands" class="block">
        <div class="block-title" style="color:var(--accent3)">⚡ Qué exigimos</div>
        <div class="d-desc" style="color:var(--text);font-weight:500;line-height:1.9">{{ protest.demands }}</div>
      </div>
    </div>

    <!-- Join footer -->
    <div class="join-footer">
      <!-- Risk info -->
      <div v-if="!protest.joined && cj.ok" class="risk-info" style="margin-bottom:8px;padding:8px 10px;border-radius:var(--r);font-size:9px;line-height:1.6"
        :style="{
          background: protest.risk_level === 'high' || protest.risk_level === 'critical' ? 'rgba(255,107,107,.06)' : protest.scope === 'global' ? 'rgba(124,111,255,.06)' : 'rgba(76,255,164,.06)',
          border: protest.risk_level === 'high' || protest.risk_level === 'critical' ? '.5px solid rgba(255,107,107,.2)' : protest.scope === 'global' ? '.5px solid var(--border2)' : '.5px solid rgba(76,255,164,.2)',
          color: protest.risk_level === 'high' || protest.risk_level === 'critical' ? 'var(--accent3)' : protest.scope === 'global' ? 'var(--text2)' : 'var(--accent2)'
        }">
        <span v-if="protest.risk_level === 'high' || protest.risk_level === 'critical'">
          🕵️ <strong>Régimen de alto riesgo.</strong> Tu adhesión es completamente anónima. No se recaba ningún dato de ubicación. Tu identidad nunca se almacena.
        </span>
        <span v-else-if="protest.scope === 'global'">
          🌍 <strong>Convocatoria global.</strong> Solo verificarás que eres una persona real. Tu identidad nunca se almacena.
        </span>
        <span v-else-if="protest.scope === 'regional' && protest.dominio_email && protest.requiere_censo">
          👥 <strong>Convocatoria con censo dinámico.</strong> Verificarás tu pertenencia con tu email y el aval de tus compañeros. Tu identidad nunca se almacena.
        </span>
        <span v-else-if="protest.scope === 'regional' && protest.dominio_email">
          📧 <strong>Convocatoria local.</strong> Verificarás tu pertenencia con tu email institucional. Tu identidad nunca se almacena.
        </span>
        <span v-else>
          📍 <strong>Democracia verificada.</strong> Al adherirte se usará tu ubicación para acreditar que estás en el país correcto. Esto añade credibilidad al informe público. Tu identidad nunca se almacena.
        </span>
      </div>
      <!-- Financiacion ciudadana -->
      <div v-if="donacionesInfo" style="width:100%;margin-bottom:10px;padding:12px;background:rgba(255,255,255,.04);border:.5px solid var(--border2);border-radius:var(--r2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:12px;font-weight:700;color:var(--text)">💰 Financiación ciudadana</div>
          <div style="font-size:11px;color:var(--accent2)">{{ donacionesInfo.adhesiones_posibles }} adhesiones posibles</div>
        </div>
        <div style="width:100%;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden;margin-bottom:6px">
          <div :style="{width: Math.min(100, (donacionesInfo.saldo_euros / 20) * 100) + '%', height: '100%', background: donacionesInfo.saldo_euros > 2 ? 'var(--accent2)' : 'var(--accent3)', borderRadius: '3px', transition: 'width .5s'}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:10px;color:var(--text2)">Saldo: <strong style="color:var(--text)">{{ donacionesInfo.saldo_euros.toFixed(2) }}€</strong></div>
          <div v-if="donacionesInfo.donaciones_count > 0" style="font-size:10px;color:var(--text2)">{{ donacionesInfo.donaciones_count }} donaciones · {{ donacionesInfo.donaciones_total.toFixed(2) }}€ total</div>
        </div>
        <div v-if="donacionesInfo.saldo_euros <= 0" style="font-size:11px;color:var(--accent3);margin-bottom:8px;text-align:center">⚠️ Saldo agotado — esta convocatoria necesita tu apoyo</div>
        <a :href="`https://ko-fi.com/vozciudadana?description=Donacion+para:+${encodeURIComponent(protest.title)}`" target="_blank" rel="noopener"
          style="display:block;width:100%;padding:9px;background:#FF5E5B;border:none;border-radius:var(--r);color:#fff;font-size:12px;font-weight:700;cursor:pointer;text-decoration:none;box-sizing:border-box;text-align:center">
          ☕ Apoyar esta convocatoria
        </a>
      </div>
      <div class="btn-row">
        <button class="btn-primary" :class="{sj: protest.joined}" :disabled="!cj.ok" @click="onJoin">
          {{ joinLabel }}
        </button>
        <div class="viral-wrap"v-if="!protest.requiere_censo">
          <button class="btn-viral" @click="ui.showShareModal = true">
            <div class="bv-inner">
              <div class="bv-left"><span class="bv-fire">🔥</span>
                <div class="bv-text"><div class="bv-title">VIRAL</div><div class="bv-sub">Hazlo viral</div></div>
              </div>
              <div class="bv-right">
                <div class="bv-count">{{ fmt(protest.viralCount || 0) }}</div>
                <div class="bv-clabel">compartieron</div>
              </div>
            </div>
          </button>
        </div>
      </div>
      <button v-if="protest.scope === 'regional' && protest.dominio_email && protest.requiere_censo && censoExiste"
        @click="router.push(`/grupo/${protest.id}`)"
        style="width:100%;margin-top:8px;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);color:var(--text2);font-size:10px;cursor:pointer">
        {{ protest.joined ? '👥 Mi grupo' : '👥 Ver el censo' }}
      </button>
      <div v-if="(protest.viralCount || 0) > 0"
        style="display:flex;align-items:center;gap:6px;margin-top:7px;padding:6px 9px;background:rgba(184,65,14,.08);border:.5px solid rgba(232,93,36,.22);border-radius:var(--r)">
        <span style="font-size:11px">🔥</span>
        <span style="font-size:9px;color:rgba(255,140,80,.9)"><strong style="color:#e85d24">{{ fmt(protest.viralCount) }}</strong> personas ya han hecho VIRAL esta convocatoria</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useDeviceStore }   from '@/stores/device.js';
import { useUiStore }       from '@/stores/ui.js';
import DetailMap from '@/components/map/DetailMap.vue';
import { fmt, fmtTime, inRegion } from '@/constants.js';
import * as api from '@/services/api.js';

const route    = useRoute();
const router   = useRouter();
const store    = useProtestsStore();
const device   = useDeviceStore();
const ui       = useUiStore();

const protest = computed(() => store.protests.find(p => String(p.id) === route.params.id));
const cj      = computed(() => protest.value ? store.canJoin(protest.value) : { ok: false });

const grupoId = ref(null);
const censoExiste = ref(false);
const velocidadHoy = ref(0);
const tendenciaHoy = ref(0);
const donacionesInfo = computed(() => {
  if (!protest.value) return null;
  const saldo = protest.value.saldo_euros ?? 0;
  return {
    saldo_euros:         saldo,
    adhesiones_posibles: Math.floor(saldo / 0.05),
    donaciones_count:    protest.value.donaciones_count ?? 0,
    donaciones_total:    protest.value.donaciones_total ?? 0,
    ultima_donacion:     protest.value.ultima_donacion ?? null,
  };
});

onMounted(async () => {
  if (protest.value?.requiere_censo) {
    try {
      const data = await api.fetchGrupoPorConvocatoria(route.params.id);
      grupoId.value = data.group_id;
      censoExiste.value = true;
    } catch {
      censoExiste.value = false;
    }
  }
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/protests/${route.params.id}/informe`);
    const informe = await res.json();
    velocidadHoy.value = informe.velocidad?.adhesiones_hoy || 0;
    tendenciaHoy.value = informe.velocidad?.tendencia_hoy || 0;
  } catch { /* silencioso */ }
});

const simOk = computed(() => {
  if (!protest.value) return false;
  if (protest.value.scope === 'national') return device.simCountry === protest.value.country;
  if (protest.value.scope === 'regional') return inRegion(protest.value.region, device.simCountry);
  return true;
});

const confFillColor = computed(() => {
  const c = device.confidence;
  return c >= 75 ? 'var(--accent2)' : c >= 50 ? 'var(--accent4)' : 'var(--accent3)';
});

const joinLabel = computed(() => {
  if (!protest.value) return '—';
  if (protest.value.joined) return '✓ Adherido de forma anónima';
  if (!cj.value.ok) return cj.value.lock ? '🔒 Dispositivo bloqueado' : '🌍 Fuera de alcance';
  if (protest.value.scope === 'regional' && protest.value.dominio_email && protest.value.requiere_censo) {
    return censoExiste.value ? '👥 Unirme al censo' : '🌱 Iniciar el censo';
  }
  if (protest.value.scope === 'regional' && protest.value.dominio_email) {
    return '📧 Verificar email y adherirme';
  }
  return 'Adherirme de forma anónima';
});

function onJoin() {
  if (!cj.value.ok) return;
  if (protest.value.scope === 'regional' && protest.value.dominio_email) {
    if (protest.value.requiere_censo) {
      sessionStorage.setItem('vc_group_id', sessionStorage.getItem('vc_group_id') || '');
      if (!censoExiste.value) {
        router.push(`/grupo/${protest.value.id}?iniciar=true`);
      } else {
        router.push(`/grupo/${protest.value.id}`);
      }
    } else {
      router.push(`/verify-institucional/${protest.value.id}`);
    }
  } else {
    sessionStorage.setItem('vc_risk_level', protest.value.risk_level || 'low');
    sessionStorage.setItem('vc_protest_scope', protest.value.scope || 'national');
    sessionStorage.setItem('vc_last_joined', String(protest.value.id));
    router.push('/auth');
  }
}
</script>
