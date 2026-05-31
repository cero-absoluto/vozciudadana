<template>
  <div class="map-wrap" :style="{ height: height + 'px', flex: 1 }">
    <canvas ref="canvasEl"></canvas>
    <div class="map-hint" id="map-hint">
      <template v-if="countryFilterName">
        📍 {{ countryFilterName }} —
        <span style="margin-left:4px;cursor:pointer;color:var(--accent);font-size:8px;text-decoration:underline"
              @click="$emit('clear-country')">✕ {{ $t('map.clearFilter') }}</span>
      </template>
      <template v-else>{{ $t('map.hint') }}</template>
    </div>
    <div class="map-ctrl">
      <button class="mc" @click="zoomIn">+</button>
      <button class="mc" @click="zoomOut">−</button>
      <button class="mc" @click="resetView" style="font-size:9px">⊙</button>
    </div>
    <div class="map-legend">
      <div class="ml-title">{{ $t('map.legendTitle') }}</div>
      <div class="ml-row"><div class="ml-sq" style="background:#1a3a5c"></div>{{ $t('map.legendNone') }}</div>
      <div class="ml-row"><div class="ml-sq" style="background:#2d5a8e"></div>{{ $t('map.legendLow') }}</div>
      <div class="ml-row"><div class="ml-sq" style="background:#e8a020"></div>{{ $t('map.legendMed') }}</div>
      <div class="ml-row"><div class="ml-sq" style="background:#ff2020"></div>{{ $t('map.legendHigh') }}</div>
    </div>
    <div class="mtt" ref="tooltipEl"></div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import * as d3 from 'd3';

const { t } = useI18n({ useScope: 'global' });
import * as topojson from 'topojson-client';
import { ISO_NUM_TO_A2, COORDS, REGION_COORDS, heatColor, lighten, fmt, fmtTime, REGIONS } from '@/constants.js';

const props = defineProps({
  protests:          { type: Array,  required: true },
  filter:            { type: String, default: 'all' },
  countryFilter:     { type: String, default: null },
  countryFilterName: { type: String, default: null },
  height:            { type: Number, default: 220 },
});
const emit = defineEmits(['country-click', 'protest-click', 'clear-country']);

const canvasEl  = ref(null);
const tooltipEl = ref(null);

let ctx, worldData, raf;
let W = 0, H = 0;
let zoom = 1, offX = 0, offY = 0;
let proj = null, gp = null;
let hovered = null;
let mousedown = false, drag = false;
let dragStartX = 0, dragStartY = 0, ox = 0, oy = 0;

function buildProj() {
  if (!canvasEl.value) return;
  proj = d3.geoNaturalEarth1()
    .scale((W / 640) * 112 * zoom)
    .translate([W / 2 + offX, H / 2 + offY]);
  gp = d3.geoPath(proj, ctx);
}

function getHeat(iso) {
  const a2 = ISO_NUM_TO_A2[iso];
  const p = props.protests.find(x => x.country === a2);
  return p?.heat || 0;
}

function drawFrame() {
  if (!worldData || !ctx) return;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a1628'; ctx.fillRect(0, 0, W, H);

  topojson.feature(worldData, worldData.objects.countries).features.forEach(f => {
    const iso = f.id ? String(f.id).padStart(3, '0') : null;
    ctx.beginPath(); gp(f);
    ctx.fillStyle = iso === hovered ? lighten(heatColor(getHeat(iso))) : heatColor(getHeat(iso));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.5; ctx.stroke();
  });

  const t = Date.now();
  const vis = props.filter === 'all' ? props.protests : props.protests.filter(p => p.scope === props.filter);
  // ── Malta — punto fijo siempre visible ──
  if (zoom > 3) {
    const maltaCoords = proj([14.5, 35.9]);
    if (maltaCoords) {
      const [mx, my] = maltaCoords;
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      if (zoom > 6) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Malta', mx, my - 6);
      }
    }
  }
  vis.forEach(p => {
    let co;
    if (p.scope === 'national') {
      const numIso = Object.entries(ISO_NUM_TO_A2).find(([, v]) => v === p.country)?.[0];
      co = numIso ? COORDS[numIso] : null;
    } else if (p.scope === 'regional') {
      const numIso = Object.entries(ISO_NUM_TO_A2).find(([, v]) => v === p.convocatoria_pais)?.[0];
  co = numIso ? COORDS[numIso] : (REGION_COORDS[p.region] || null);
    } else {
      co = REGION_COORDS['global'];
    }
    if (!co) return;
    const [x, y] = proj(co);
    if (x < -10 || x > W + 10 || y < -10 || y > H + 10) return;
    const idSeed = typeof p.id === 'number' ? p.id
      : String(p.id).split('').reduce((n, c) => ((n << 5) - n + c.charCodeAt(0)) | 0, 0);
    const pulse = 0.4 + Math.sin(t / 500 + idSeed) * 0.3;
    const r = 3 + (p.heat / 100) * 5;
    ctx.beginPath(); ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,80,80,${pulse * 0.2})`; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.color; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'white'; ctx.fill();
  });
  raf = requestAnimationFrame(drawFrame);
}

function cssToGeo(e) {
  const rect = canvasEl.value.getBoundingClientRect();
  return proj.invert([e.clientX - rect.left, e.clientY - rect.top]);
}

function countryAtEvent(e) {
  if (!worldData) return null;
  const geo = cssToGeo(e);
  if (!geo) return null;
  return topojson.feature(worldData, worldData.objects.countries).features
    .find(f => d3.geoContains(f, geo)) || null;
}

function setupEvents() {
  const c = canvasEl.value;

  c.addEventListener('mousemove', e => {
    if (!worldData) return;
    if (mousedown) {
      const dist = Math.sqrt((e.clientX - dragStartX) ** 2 + (e.clientY - dragStartY) ** 2);
      if (dist > 4) drag = true;
      if (drag) { offX = ox + (e.clientX - dragStartX); offY = oy + (e.clientY - dragStartY); buildProj(); return; }
    }
    const rect = c.getBoundingClientRect();
    const ttx = (e.clientX - rect.left) > rect.width * 0.6 ? (e.clientX - rect.left) - 188 : (e.clientX - rect.left) + 10;
    const tty = (e.clientY - rect.top) - 6;
    const found = countryAtEvent(e);
    const tt = tooltipEl.value;
    if (found) {
      const iso = found.id ? String(found.id).padStart(3, '0') : null;
      hovered = iso;
      const heat = getHeat(iso), a2 = ISO_NUM_TO_A2[iso] || iso;
      const prot = props.protests.find(p => p.country === a2);
      if (heat > 0 || prot) {
        tt.style.display = 'block'; tt.style.left = ttx + 'px'; tt.style.top = tty + 'px';
        tt.innerHTML = `<div class="mt-title">${found.properties?.name || '—'}</div>` +
          (prot ? `<div class="mt-row"><span>${prot.title.substring(0, 28)}...</span></div>
            <div class="mt-row"><span>Adheridos</span><span class="mt-ct">${fmt(prot.count)}</span></div>` : ``);
      } else { tt.style.display = 'none'; hovered = null; }
    } else { tt.style.display = 'none'; hovered = null; }
  });

  c.addEventListener('mousedown', e => {
    dragStartX = e.clientX; dragStartY = e.clientY;
    ox = offX; oy = offY; mousedown = true; drag = false;
  });
  c.addEventListener('mouseup',    () => { mousedown = false; setTimeout(() => drag = false, 50); });
  c.addEventListener('mouseleave', () => { mousedown = false; drag = false; tooltipEl.value.style.display = 'none'; hovered = null; });

  c.addEventListener('click', e => {
    if (!worldData || drag) return;
    const geo = cssToGeo(e);
    if (!geo) return;
    const found = topojson.feature(worldData, worldData.objects.countries).features
      .find(f => d3.geoContains(f, geo));
    if (!found) return;
    const iso  = found.id ? String(found.id).padStart(3, '0') : null;
    const name = found.properties?.name || iso;
    const a2   = ISO_NUM_TO_A2[iso] || iso;
    emit('country-click', a2, name);
  });

  c.addEventListener('wheel', e => {
    e.preventDefault();
    zoom = Math.min(50, Math.max(0.7, zoom * (e.deltaY > 0 ? 0.82 : 1.4)));
    buildProj();
  }, { passive: false });

  // ── TOUCH EVENTS (móvil) ──────────────────────────────
  let lastTouchDist = 0;
  let touchStartX = 0, touchStartY = 0, touchOx = 0, touchOy = 0;

  c.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchOx = offX; touchOy = offY;
      drag = false;
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.sqrt(dx * dx + dy * dy);
    }
  }, { passive: false });

  c.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      if (Math.sqrt(dx*dx+dy*dy) > 4) drag = true;
      if (drag) { offX = touchOx + dx; offY = touchOy + dy; buildProj(); }
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastTouchDist > 0) {
        const ratio = dist / lastTouchDist;
        zoom = Math.min(10, Math.max(0.7, zoom * ratio));
        buildProj();
      }
      lastTouchDist = dist;
    }
  }, { passive: false });

  c.addEventListener('touchend', e => {
    e.preventDefault();
    if (e.changedTouches.length === 1 && !drag) {
      const touch = e.changedTouches[0];
      const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY };
      const geo = cssToGeo(fakeEvent);
      if (geo) {
        const found = topojson.feature(worldData, worldData.objects.countries).features
          .find(f => d3.geoContains(f, geo));
        if (found) {
          const iso = found.id ? String(found.id).padStart(3, '0') : null;
          const name = found.properties?.name || iso;
          const a2 = ISO_NUM_TO_A2[iso] || iso;
          emit('country-click', a2, name);
        }
      }
    }
    lastTouchDist = 0;
    setTimeout(() => { drag = false; }, 50);
  }, { passive: false });
}

function zoomIn()    { zoom = Math.min(10, zoom * 1.3); buildProj(); }
function zoomOut()   { zoom = Math.max(0.7, zoom / 1.3); buildProj(); }
function resetView() { zoom = 1; offX = 0; offY = 0; buildProj(); }

onMounted(() => {
  const c = canvasEl.value;
  ctx = c.getContext('2d');
  W = c.width  = c.parentElement.clientWidth  || window.innerWidth;
  H = c.height = c.parentElement.clientHeight || props.height;
  buildProj();

  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json').then(data => {
    worldData = data;
    drawFrame();
  });

  setupEvents();

  const handleVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else if (worldData) {
      drawFrame();
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);
  c._visibilityHandler = handleVisibility;

  const ro = new ResizeObserver(() => {
    W = c.width  = c.parentElement.clientWidth  || window.innerWidth;
    H = c.height = c.parentElement.clientHeight || props.height;
    buildProj();
  });
  ro.observe(c.parentElement);
  c._ro = ro;
});

onUnmounted(() => {
  cancelAnimationFrame(raf);
  canvasEl.value?._ro?.disconnect();
  if (canvasEl.value?._visibilityHandler) {
    document.removeEventListener('visibilitychange', canvasEl.value._visibilityHandler);
  }
});
</script>
