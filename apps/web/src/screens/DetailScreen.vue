<template>
  <div class="screen active" id="s-detail" v-if="protest">
    <!-- Header -->
    <div class="detail-hdr">
      <button class="back" @click="$router.back()">{{ $t('detail.back') }}</button>
      <div class="d-title">{{ protest.title }}</div>
      <div class="d-loc">
        <span class="scope-badge" :class="store.scopeBadge(protest).cls">{{ store.scopeBadge(protest).icon }} {{ store.scopeBadge(protest).label }}</span>
        <span style="font-size:12px;color:var(--text2)">📍 {{ localizedCountry(protest.country, locale.value) || protest.countryName }}</span>
      </div>
    </div>

    <!-- Particle map -->
    <DetailMap :participant-count="protest.count" :joined="protest.joined" />

    <div class="d-scroll">
      <!-- Stats -->
      <div class="stats-row">
        <div class="sc"><div class="sc-n" style="color:var(--accent)">{{ fmt(protest.count) }}</div><div class="sc-l">{{ $t('detail.statAdheridos') }}</div></div>
        <div class="sc"><div class="sc-n" style="color:var(--accent2)">{{ protest.cities }}</div><div class="sc-l">{{ $t('detail.statCiudades') }}</div></div>
        <div class="sc"><div class="sc-n" style="color:var(--accent3)">{{ fmtTime(protest.timer) }}</div><div class="sc-l">{{ $t('detail.statRestante') }}</div></div>
      </div>
      <!-- Fecha de cierre -->
      <div v-if="protest.ends_at && protest.timer > 0" style="text-align:center;font-size:13px;color:var(--text2);margin-bottom:8px">
        {{ $t('detail.closesOn') }} {{ fmtCloseDate(protest.ends_at) }}
      </div>

      <!-- Velocidad — solo si hay datos de hoy -->
      <div v-if="velocidadHoy > 0" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(76,255,164,.06);border:.5px solid rgba(76,255,164,.2);border-radius:var(--r);margin-bottom:8px">
        <div style="width:6px;height:6px;border-radius:50%;background:var(--accent2);animation:blink 1.5s infinite;flex-shrink:0"></div>
        <div style="font-size:14px;color:var(--accent2)">
          <strong>+{{ velocidadHoy }}</strong> {{ $t('detail.speedToday') }}
          <span v-if="tendenciaHoy > 0" style="color:var(--accent2)"> · {{ $t('detail.trendUp') }}</span>
          <span v-else-if="tendenciaHoy < 0" style="color:var(--accent4)"> · {{ $t('detail.trendDown') }}</span>
        </div>
      </div>

      <!-- Sobre la convocatoria — visible por defecto -->
      <div class="block">
        <div class="block-title" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center" @click="sobreOpen = !sobreOpen">
          <span>{{ $t('detail.aboutThisCall') }}</span>
          <span style="font-size:12px;color:var(--text2)">{{ sobreOpen ? '▲' : '▼' }}</span>
        </div>
        <div v-if="sobreOpen">
          <div v-if="protest.focal_point" style="margin-bottom:8px;padding:8px 10px;background:rgba(124,111,255,.06);border:.5px solid var(--border2);border-radius:var(--r)">
            <div style="font-size:12px;font-weight:700;color:var(--text2);letter-spacing:.3px;margin-bottom:3px">{{ $t('detail.directedAt') }}</div>
            <div style="font-size:15px;color:var(--text);font-weight:700">{{ protest.focal_point }}</div>
          </div>
          <div class="d-desc">{{ protest.desc }}</div>
          <div v-if="protest.demands" style="margin-top:10px">
            <div class="block-title" style="color:var(--accent3)">⚡ {{ $t('detail.whatWeDemand') }}</div>
            <div class="d-desc" style="color:var(--text);font-weight:500;line-height:1.9">{{ protest.demands }}</div>
          </div>
          <div v-if="protest.tipo_abuso" style="margin-top:8px">
            <div style="font-size:12px;font-weight:700;color:var(--text2);letter-spacing:.3px;margin-bottom:3px">{{ $t('detail.typeOfAbuse') }}</div>
            <div style="font-size:14px;color:var(--text)">{{ protest.tipo_abuso }}</div>
          </div>
          <div v-if="protest.fuente_url" style="margin-top:8px">
            <div style="font-size:12px;font-weight:700;color:var(--text2);letter-spacing:.3px;margin-bottom:3px">{{ $t('detail.source') }}</div>
            <a :href="protest.fuente_url" target="_blank" rel="noopener"
              style="font-size:13px;color:var(--accent);word-break:break-all">{{ protest.fuente_url }}</a>
          </div>
        </div>
      </div>
      <!-- Geo validation — colapsable. Hidden for institutional convocatorias,
           which are verified by institutional email, not by SIM/GPS geography. -->
      <div v-if="protest.scope !== 'global' && !protest.dominio_email" class="geo-validation">
        <div class="gv-title" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center" @click="geoOpen = !geoOpen">
          <span>{{ $t('detail.geoValidation') }}</span>
          <span style="font-size:12px;color:var(--text2)">{{ geoOpen ? '▲' : '▼' }}</span>
        </div>
        <div v-if="geoOpen">
          <div class="gv-row">
            <div class="gv-dot" :style="{background: simOk ? 'var(--accent2)' : 'var(--accent3)'}"></div>
            <div class="gv-label">{{ $t('detail.geoSim') }}</div>
            <div class="gv-val" :class="simOk ? 'gv-ok' : 'gv-no'">
              {{ simOk ? '✓ ' + device.simPrefix + ' (' + device.simName + ')' : $t('detail.geoDiff') }}
            </div>
          </div>
          <div class="gv-row">
            <div class="gv-dot" :style="{background: simOk ? 'var(--accent2)' : 'var(--accent3)'}"></div>
            <div class="gv-label">{{ $t('detail.geoIp') }}</div>
            <div class="gv-val" :class="simOk ? 'gv-ok' : 'gv-no'">
              {{ simOk ? '✓ ' + (device.gpsReady && device.gpsCity ? device.gpsCity : device.ipCity) : $t('detail.geoDiff') }}
            </div>
          </div>
          <div class="conf-bar"><div class="conf-fill" :style="{ width: device.confidence + '%', background: confFillColor }"></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:3px">
            <div style="font-size:12px;color:var(--text2)">{{ $t('detail.geoConfidence') }}</div>
            <div style="font-size:12px;font-weight:600" :style="{color: confFillColor}">{{ device.confidence }}%</div>
          </div>
        </div>
      </div>

      <!-- Lock / geo message -->
      <div v-if="!cj.ok && !cj.joined">
        <div v-if="cj.lock" class="lock-detail">{{ $t('detail.lockMsg') }} {{ cj.msg }}</div>
        <div v-else-if="cj.geo" class="geo-detail">{{ $t('detail.geoMsg') }} {{ cj.msg }}</div>
      </div>

    </div>

    <!-- Join footer -->
    <div class="join-footer">
      <!-- Risk info -->
      <div v-if="!protest.joined && cj.ok" class="risk-info" style="margin-bottom:8px;padding:10px 12px;border-radius:var(--r);font-size:13px;line-height:1.6"
        :style="{
          background: protest.risk_level === 'high' || protest.risk_level === 'critical' ? 'rgba(255,107,107,.06)' : protest.scope === 'global' ? 'rgba(124,111,255,.06)' : 'rgba(76,255,164,.06)',
          border: protest.risk_level === 'high' || protest.risk_level === 'critical' ? '.5px solid rgba(255,107,107,.2)' : protest.scope === 'global' ? '.5px solid var(--border2)' : '.5px solid rgba(76,255,164,.2)',
          color: protest.risk_level === 'high' || protest.risk_level === 'critical' ? 'var(--accent3)' : protest.scope === 'global' ? 'var(--text2)' : 'var(--accent2)'
        }">
        <span v-if="protest.risk_level === 'high' || protest.risk_level === 'critical'">{{ $t('detail.riskHigh') }}</span>
        <span v-else-if="protest.scope === 'global'">{{ $t('detail.riskGlobal') }}</span>
        <span v-else-if="protest.scope === 'regional' && protest.dominio_email && protest.requiere_censo">{{ $t('detail.riskCensus') }}</span>
        <span v-else-if="protest.scope === 'regional' && protest.dominio_email">{{ $t('detail.riskEmail') }}</span>
        <span v-else>{{ $t('detail.riskNormal') }}</span>
      </div>
      <!-- Financiacion ciudadana -->
      <div v-if="donacionesInfo" style="width:100%;margin-bottom:10px;padding:12px;background:rgba(255,255,255,.04);border:.5px solid var(--border2);border-radius:var(--r2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:14px;font-weight:700;color:var(--text)">{{ $t('detail.donTitle') }}</div>
          <div style="font-size:14px;color:var(--accent2)">{{ donacionesInfo.adhesiones_posibles }} {{ $t('detail.donPosibles') }}</div>
        </div>
        <div style="width:100%;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden;margin-bottom:6px">
          <div :style="{width: Math.min(100, (donacionesInfo.saldo_euros / 20) * 100) + '%', height: '100%', background: donacionesInfo.saldo_euros > 2 ? 'var(--accent2)' : 'var(--accent3)', borderRadius: '3px', transition: 'width .5s'}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:13px;color:var(--text2)">{{ $t('detail.donSaldo') }} <strong style="color:var(--text)">{{ donacionesInfo.saldo_euros.toFixed(2) }}€</strong></div>
          <div v-if="donacionesInfo.donaciones_count > 0" style="font-size:12px;color:var(--text2)">{{ $t('detail.donCount', { count: donacionesInfo.donaciones_count, total: donacionesInfo.donaciones_total.toFixed(2) }) }}</div>
        </div>
        <div v-if="donacionesInfo.saldo_euros <= 0" style="font-size:12px;color:var(--accent3);margin-bottom:8px;padding:8px 10px;background:rgba(255,94,91,.06);border-radius:var(--r);border:.5px solid rgba(255,94,91,.2);text-align:center;line-height:1.5">
          ⚠️ {{ $t('detail.donAgotado') }}<br>
          <span style="font-size:12px;color:var(--text2)">{{ $t('detail.donAgotadoHint') }}</span>
        </div>
        <a :href="`https://ko-fi.com/voiceprotest?description=Support:+${encodeURIComponent(protest.title)}`" target="_blank" rel="noopener"
          style="display:block;width:100%;padding:9px;background:#FF5E5B;border:none;border-radius:var(--r);color:#fff;font-size:12px;font-weight:700;cursor:pointer;text-decoration:none;box-sizing:border-box;text-align:center">
          {{ $t('detail.donApoyar') }}
        </a>
      </div>
      <div class="btn-row">
        <button class="btn-primary" :class="{sj: protest.joined}" :disabled="!cj.ok || sinSaldo" @click="onJoin">
          {{ joinLabel }}
        </button>
        <div class="viral-wrap"v-if="!protest.requiere_censo">
          <button class="btn-viral" @click="ui.showShareModal = true">
            <div class="bv-inner">
              <div class="bv-left"><span class="bv-fire">🔥</span>
              <div class="bv-text"><div class="bv-title">{{ $t('detail.viral') }}</div><div class="bv-sub">{{ $t('detail.viralMake') }}</div></div>
              </div>
              <div class="bv-right">
                <div class="bv-count">{{ fmt(protest.viralCount || 0) }}</div>
                <div class="bv-clabel">{{ $t('detail.viralShared') }}</div>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Refuerzo territorial: re-entrada mientras el token de 24h siga vivo.
           Una sola tarjeta, sin repetición: desaparece al usarse o caducar.
           Copy de impacto (qué gana el informe), nunca de culpa. -->

      <!-- Interstitial GPS pre-adhesión (convocatorias territoriales) -->
      <teleport to="body">
        <div v-if="showGpsOverlay"
          style="position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:1000;display:flex;align-items:center;justify-content:center;padding:22px"
          @click.self="gpsOverlaySkip">
          <div style="max-width:400px;width:100%;background:var(--bg2);border:.5px solid rgba(76,200,255,.35);border-radius:var(--r2);padding:22px 20px">
            <div style="font-size:28px;text-align:center;margin-bottom:10px">📍</div>
            <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:800;color:var(--text);text-align:center;line-height:1.4;margin-bottom:10px">
              {{ $t('detail.gpsPromptTitle', { territorio: reinforceTerritorio }) }}
            </div>
            <div style="font-size:13.5px;color:var(--text2);line-height:1.65;text-align:center;margin-bottom:16px">
              {{ $t('detail.gpsPromptBody') }}
            </div>
            <button @click="gpsOverlayActivate" :disabled="gpsOverlayBusy"
              style="width:100%;padding:13px;background:rgba(76,200,255,.14);border:.5px solid #4CC8FF;border-radius:var(--r);color:#4CC8FF;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px">
              {{ gpsOverlayBusy ? '...' : $t('detail.gpsPromptYes') }}
            </button>
            <button @click="gpsOverlaySkip"
              style="width:100%;padding:12px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);color:var(--text2);font-size:13px;cursor:pointer">
              {{ $t('detail.gpsPromptSkip') }}
            </button>
          </div>
        </div>
      </teleport>
      <div v-if="reinforceAvailable && !reinforceDone"
        style="width:100%;margin-top:8px;padding:12px;background:rgba(76,200,255,.06);border:.5px solid rgba(76,200,255,.3);border-radius:var(--r2)">
        <div style="font-size:13px;font-weight:700;color:#4CC8FF;margin-bottom:5px">📍 {{ $t('detail.reforzarTitle') }}</div>
        <div style="font-size:11px;color:var(--text2);line-height:1.6;margin-bottom:8px">
          {{ $t('detail.reforzarBody', { territorio: reinforceTerritorio }) }}
        </div>
        <button @click="reforzarDesdeDetalle" :disabled="reforzandoGps"
          style="width:100%;padding:11px;background:rgba(76,200,255,.12);border:.5px solid #4CC8FF;border-radius:var(--r);color:#4CC8FF;font-size:13px;font-weight:700;cursor:pointer">
          {{ reforzandoGps ? '...' : $t('detail.reforzarBtn') }}
        </button>
        <div style="font-size:10px;color:var(--text3);margin-top:6px;text-align:center">{{ $t('detail.reforzarPrivacy') }}</div>
      </div>
      <div v-if="reinforceDone"
        style="width:100%;margin-top:8px;padding:10px 12px;background:rgba(76,255,164,.06);border:.5px solid rgba(76,255,164,.3);border-radius:var(--r);font-size:12px;color:var(--accent2);text-align:center">
        ✓ {{ $t('detail.reforzarDone') }}
      </div>
      <button v-if="protest.scope === 'regional' && protest.dominio_email && protest.requiere_censo && censoExiste"
        @click="router.push(`/grupo/${protest.id}`)"
        style="width:100%;margin-top:8px;padding:9px;background:transparent;border:.5px solid var(--border2);border-radius:var(--r);color:var(--text2);font-size:12px;cursor:pointer">
        {{ protest.joined ? $t('detail.myGroup') : $t('detail.seeCensus') }}
      </button>
      <div v-if="(protest.viralCount || 0) > 0"
        style="display:flex;align-items:center;gap:6px;margin-top:7px;padding:6px 9px;background:rgba(184,65,14,.08);border:.5px solid rgba(232,93,36,.22);border-radius:var(--r)">
        <span style="font-size:12px">🔥</span>
        <span style="font-size:12px;color:rgba(255,140,80,.9)"><strong style="color:#e85d24">{{ fmt(protest.viralCount) }}</strong> {{ $t('detail.viralCountSuffix') }}</span>
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
import { useI18n } from 'vue-i18n';
import { localizedCountry } from '@/constants.js';
import DetailMap from '@/components/map/DetailMap.vue';
import { fmt, fmtTime, inRegion } from '@/constants.js';

function fmtCloseDate(endsAt) {
  if (!endsAt) return '';
  return new Date(endsAt).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit'
  });
}
import * as api from '@/services/api.js';

const { t, locale } = useI18n();

const route    = useRoute();
const router   = useRouter();
const store    = useProtestsStore();
const device   = useDeviceStore();
const ui       = useUiStore();

const protest = computed(() => store.protests.find(p => String(p.id) === route.params.id));

// ── Refuerzo territorial post-adhesión (Decision July 2026) ──────────────────
// The 24h single-use GPS token now persists in localStorage (see VerifyScreen)
// so users can reinforce later — e.g. joining from home, reinforcing from the
// neighborhood. The record is removed on use or expiry. The token is a random
// UUID with no personal data; coordinates are never stored server-side.
const reforzandoGps  = ref(false);
const reinforceDone  = ref(false);
const reinforceTick  = ref(0); // bump to re-evaluate after use

function readReinforceRecord() {
  try {
    const raw = localStorage.getItem('vc_gps_reinforce');
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec?.token || !rec?.protestId) return null;
    if (rec.expiresAt && Date.now() > rec.expiresAt) {
      localStorage.removeItem('vc_gps_reinforce');
      return null;
    }
    return rec;
  } catch { return null; }
}

const reinforceAvailable = computed(() => {
  reinforceTick.value; // dependency
  if (!protest.value?.joined) return false;
  if (!(protest.value.scope === 'local' || protest.value.scope === 'regional')) return false;
  if (device.gpsReady && reinforceDone.value) return false;
  const rec = readReinforceRecord();
  return !!rec && String(rec.protestId) === String(protest.value.id);
});

const reinforceTerritorio = computed(() =>
  protest.value?.convocatoria_ciudad_nombre
  || protest.value?.convocatoria_region
  || (protest.value?.scope === 'regional' ? 'la región' : 'el municipio'));

async function reforzarDesdeDetalle() {
  if (reforzandoGps.value) return;
  reforzandoGps.value = true;
  try {
    await device.requestGps();
    const rec = readReinforceRecord();
    if (rec && device.gpsLat && device.gpsLng) {
      const API_BASE = import.meta.env.VITE_API_URL || 'https://api.voiceprotest.org';
      const res = await fetch(`${API_BASE}/api/protests/${rec.protestId}/adhesion`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gps_update_token: rec.token,
          gps_lat:          device.gpsLat,
          gps_lng:          device.gpsLng,
          gps_accuracy:     device.gpsAccuracy ?? null,
        }),
      });
      if (res.ok) {
        reinforceDone.value = true;
        ui.showToast(t('detail.reforzarToast'));
      }
      // Single-use either way: remove record and legacy sessionStorage copy
      localStorage.removeItem('vc_gps_reinforce');
      sessionStorage.removeItem('vc_gps_update_token');
      reinforceTick.value++;
    }
  } catch { /* usuario denegó GPS o fallo de red — la tarjeta permanece */ }
  finally { reforzandoGps.value = false; }
}
const cj      = computed(() => protest.value ? store.canJoin(protest.value) : { ok: false });

const grupoId = ref(null);
const censoExiste = ref(false);
const velocidadHoy = ref(0);
const tendenciaHoy = ref(0);
const geoOpen = ref(false);
const sobreOpen = ref(true);
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

const sinSaldo = computed(() => {
  if (!donacionesInfo.value) return false;
  return donacionesInfo.value.saldo_euros <= 0;
});

const joinLabel = computed(() => {
  if (!protest.value) return '—';
  if (protest.value.joined) return t('detail.joinJoined');
  if (sinSaldo.value) return t('detail.joinSinSaldo');
  if (!cj.value.ok) return cj.value.lock ? t('detail.joinLocked') : t('detail.joinGeo');
  if (protest.value.scope === 'regional' && protest.value.dominio_email && protest.value.requiere_censo) {
    return censoExiste.value ? t('detail.joinInitCensus') : t('detail.joinCensus');
  }
  if (protest.value.scope === 'regional' && protest.value.dominio_email) {
    return t('detail.joinEmail');
  }
  return t('detail.joinAnon');
});

function onJoin() {
  if (!cj.value.ok) return;
  // GPS interstitial for territorial convocatorias (Decision July 2026):
  // ask ONCE at the moment of joining — motivation peak, user gesture
  // available for the browser prompt — instead of relying only on the
  // fragile post-adhesion token path. Optionality is explicit: both
  // buttons proceed to join; "skip" is remembered per-protest so the
  // overlay never nags. If granted, coordinates travel with the adhesion
  // itself (VerifyScreen payload falls back to the device store).
  const territorial = protest.value.scope === 'local'
    || (protest.value.scope === 'regional' && !protest.value.dominio_email);
  if (territorial && !device.gpsReady
      && !sessionStorage.getItem('vc_gps_prompted_' + protest.value.id)) {
    showGpsOverlay.value = true;
    return;
  }
  proceedJoin();
}

const showGpsOverlay = ref(false);
const gpsOverlayBusy = ref(false);

async function gpsOverlayActivate() {
  if (gpsOverlayBusy.value) return;
  gpsOverlayBusy.value = true;
  try { await device.requestGps(); } catch { /* denegado — seguimos igual */ }
  gpsOverlayBusy.value = false;
  sessionStorage.setItem('vc_gps_prompted_' + protest.value.id, '1');
  showGpsOverlay.value = false;
  proceedJoin();
}

function gpsOverlaySkip() {
  sessionStorage.setItem('vc_gps_prompted_' + protest.value.id, '1');
  showGpsOverlay.value = false;
  proceedJoin();
}

function proceedJoin() {
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
    sessionStorage.setItem('vc_protest_id', protest.value.id);
    sessionStorage.setItem('vc_protest_ends_at', protest.value.ends_at || '');
    router.push('/auth');
  }
}
</script>


