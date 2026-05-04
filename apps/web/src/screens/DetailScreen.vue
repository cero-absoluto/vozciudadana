<template>
  <div class="screen active" id="s-detail" v-if="protest">
    <!-- Header -->
    <div class="detail-hdr">
      <button class="back" @click="$router.back()">← Volver al mapa</button>
      <div class="d-title">{{ protest.title }}</div>
      <div class="d-loc">
        <span v-html="store.scopeBadge(protest)"></span>
        <span style="font-size:9px;color:var(--text2)">📍 {{ protest.countryName }}</span>
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
        <div class="gv-row">
          <div class="gv-dot" :style="{background: device.docCountry ? 'var(--accent2)' : 'var(--accent4)'}"></div>
          <div class="gv-label">Documento (voluntario)</div>
          <div class="gv-val" :class="device.docCountry ? 'gv-ok' : 'gv-warn'">
            {{ device.docCountry ? '✓ Verificado' : 'No aportado (+25%)' }}
          </div>
        </div>
        <div class="conf-bar"><div class="conf-fill" :style="{ width: device.confidence + '%', background: confFillColor }"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:3px">
          <div style="font-size:7px;color:var(--text3)">Confianza geográfica</div>
          <div style="font-size:8px;font-weight:600" :style="{color: confFillColor}">{{ device.confidence }}%</div>
        </div>
      </div>

      <!-- Lock / geo message -->
      <div v-if="!cj.ok && !cj.joined">
        <div v-if="cj.lock" class="lock-detail">🔒 <strong>Dispositivo bloqueado:</strong> {{ cj.msg }}</div>
        <div v-else-if="cj.geo" class="geo-detail">🌍 <strong>Fuera de alcance geográfico:</strong> {{ cj.msg }}</div>
      </div>

      <!-- Security guarantees -->
      <div class="block">
        <div class="block-title">Garantías de seguridad</div>
        <div class="sec-row"><div class="sec-ico" style="background:rgba(76,255,164,.08)">🔒</div><div style="flex:1"><div class="sec-lbl">Hash SHA-256 local</div><div class="sec-sub">Tu número nunca sale de tu dispositivo en texto claro.</div></div><div class="check"><svg viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="var(--accent2)" stroke-width="2.5"/></svg></div></div>
        <div class="sec-row"><div class="sec-ico" style="background:rgba(255,179,71,.08)">🪪</div><div style="flex:1"><div class="sec-lbl">Doble verificación (SMS + DNI voluntario)</div><div class="sec-sub">El documento se hashea localmente.</div></div><div class="check"><svg viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="var(--accent2)" stroke-width="2.5"/></svg></div></div>
        <div class="sec-row"><div class="sec-ico" style="background:rgba(124,111,255,.08)">🧅</div><div style="flex:1"><div class="sec-lbl">Tor en regímenes de riesgo</div><div class="sec-sub">Tu IP nunca llega a nuestros servidores.</div></div><div class="check"><svg viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="var(--accent2)" stroke-width="2.5"/></svg></div></div>
        <div class="sec-row"><div class="sec-ico" style="background:rgba(255,107,107,.08)">🗳️</div><div style="flex:1"><div class="sec-lbl">Un dispositivo · una adhesión por alcance</div></div><div class="check"><svg viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="var(--accent2)" stroke-width="2.5"/></svg></div></div>
        <div class="sec-row"><div class="sec-ico" style="background:rgba(255,179,71,.08)">⛓️</div><div style="flex:1"><div class="sec-lbl">Blockchain público</div><div class="sec-sub">Conteos inmutables.</div></div><div class="check"><svg viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="var(--accent2)" stroke-width="2.5"/></svg></div></div>
      </div>

      <div class="block"><div class="block-title">Sobre esta convocatoria</div><div class="d-desc">{{ protest.desc }}</div></div>
      <div v-if="protest.demands" class="block">
        <div class="block-title" style="color:var(--accent3)">⚡ Qué exigimos</div>
        <div class="d-desc" style="color:var(--text);font-weight:500;line-height:1.9">{{ protest.demands }}</div>
      </div>
    </div>

    <!-- Join footer -->
    <div class="join-footer">
      <div class="btn-row">
        <button class="btn-primary" :class="{sj: protest.joined}" :disabled="!cj.ok" @click="onJoin">
          {{ joinLabel }}
        </button>
        <div class="viral-wrap">
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
      <div v-if="(protest.viralCount || 0) > 0"
        style="display:flex;align-items:center;gap:6px;margin-top:7px;padding:6px 9px;background:rgba(184,65,14,.08);border:.5px solid rgba(232,93,36,.22);border-radius:var(--r)">
        <span style="font-size:11px">🔥</span>
        <span style="font-size:9px;color:rgba(255,140,80,.9)"><strong style="color:#e85d24">{{ fmt(protest.viralCount) }}</strong> personas ya han hecho VIRAL esta convocatoria</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useDeviceStore }   from '@/stores/device.js';
import { useUiStore }       from '@/stores/ui.js';
import DetailMap from '@/components/map/DetailMap.vue';
import { fmt, fmtTime, inRegion } from '@/constants.js';

const route    = useRoute();
const router   = useRouter();
const store    = useProtestsStore();
const device   = useDeviceStore();
const ui       = useUiStore();

const protest = computed(() => store.protests.find(p => p.id === Number(route.params.id)));
const cj      = computed(() => protest.value ? store.canJoin(protest.value) : { ok: false });

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
  return 'Adherirme de forma anónima';
});

function onJoin() {
  if (!cj.value.ok) return;
  router.push('/auth');
}
</script>
