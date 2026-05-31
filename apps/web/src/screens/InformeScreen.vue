<template>
  <div class="screen active" id="s-informe">
    <div class="scroll" style="padding:16px">

      <!-- Cargando -->
      <div v-if="loading" style="text-align:center;padding:40px">
        <div class="spin-ring" style="margin:0 auto 12px"></div>
        <div style="font-size:12px;color:var(--text3)">Cargando informe...</div>
      </div>

      <!-- Error -->
      <div v-else-if="error" style="text-align:center;padding:40px;color:var(--accent3)">
        No se encontró la convocatoria.
      </div>

      <!-- Informe -->
      <div v-else-if="data" class="informe-layout">

        <!-- COLUMNA IZQUIERDA -->
        <div class="informe-left">

          <!-- Cabecera -->
          <div style="margin-bottom:20px">
            <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">
              Informe público verificado
            </div>
           <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:22px;letter-spacing:-.4px;margin-bottom:8px">
              {{ data.protest.title }}
            </div>
            <div style="font-size:11px;color:var(--text2);margin-bottom:4px">
              {{ data.protest.demands }}
            </div>
            <div v-if="data.protest.fuente_url" style="font-size:10px;color:var(--text3);margin-top:6px">
              📎 Fuente:
              <a :href="data.protest.fuente_url" target="_blank"
                style="color:var(--accent);text-decoration:underline;word-break:break-all">
                {{ data.protest.fuente_url }}
              </a>
            </div>
            <div v-if="data.protest.tipo_abuso" style="font-size:10px;color:var(--text3);margin-top:4px">
              ⚠️ Tipo de abuso:
              <span style="color:var(--accent4);font-weight:500">{{ tipoAbusoLabel }}</span>
            </div>
            <div style="font-size:11px;color:var(--text3)">
              {{ formatDate(data.protest.starts_at) }} → {{ formatDate(data.protest.ends_at) }}
            </div>
          </div>

          <!-- BLOQUE 1 — Titular -->
          <div class="block" style="margin-bottom:14px">
            <div class="block-title">📢 Titular político</div>
            <div style="font-size:14px;font-weight:600;line-height:1.5;color:var(--text)">
              {{ data.total_adhesiones }} ciudadanos verificados de {{ data.protest.country_name }}
              exigen al {{ data.protest.focal_point }}: "{{ data.protest.demands }}"
            </div>
          </div>

          <!-- BLOQUE 5 — Distribución geográfica -->
          <div class="block" style="margin-bottom:12px">
            <div class="block-title">📍 Distribución geográfica</div>
            <div style="font-size:14px;color:var(--text2);line-height:1.8;margin-bottom:8px">
              <strong>Por región:</strong><br>
              <span v-for="(count, region) in data.distribucion_regiones" :key="region">
                {{ region }}: {{ count }} adhesión{{ count > 1 ? 'es' : '' }} · 
              </span>
            </div>
            <div style="font-size:14px;color:var(--text2);line-height:1.8">
              <strong>Por ciudad:</strong><br>
              <span v-for="ciudad in data.distribucion_ciudades.slice(0,10)" :key="ciudad">
                {{ ciudad }} · 
              </span>
              <span v-if="data.distribucion_ciudades.length > 10">
                y {{ data.distribucion_ciudades.length - 10 }} ciudades más.
              </span>
            </div>
          </div>

        </div><!-- fin columna izquierda -->

        <!-- COLUMNA DERECHA -->
        <div class="informe-right">

          <!-- BLOQUE FIABILIDAD — Calidad de la verificación -->
          <div class="block" style="margin-bottom:12px">
            <div class="block-title">🔬 Calidad de la verificación</div>
            <div v-if="data.desglose_fiabilidad" style="display:flex;flex-direction:column;gap:8px">
              
              <!-- Alta -->
              <div v-if="data.desglose_fiabilidad.alta.count > 0">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                  <span style="color:var(--accent2);font-weight:500">Fiabilidad alta (85-95%)</span>
                  <span style="color:var(--text2)">{{ data.desglose_fiabilidad.alta.count }} ciudadanos</span>
                </div>
                <div style="background:var(--bg4);border-radius:4px;height:8px;overflow:hidden">
                  <div :style="{width: pct(data.desglose_fiabilidad.alta.count) + '%', background:'var(--accent2)', height:'100%', borderRadius:'4px', transition:'width .5s'}"></div>
                </div>
                <div style="font-size:10px;color:var(--text3);margin-top:2px">{{ data.desglose_fiabilidad.alta.descripcion }}</div>
              </div>

              <!-- Media -->
              <div v-if="data.desglose_fiabilidad.media.count > 0">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                  <span style="color:var(--accent4);font-weight:500">Fiabilidad media (75-84%)</span>
                  <span style="color:var(--text2)">{{ data.desglose_fiabilidad.media.count }} ciudadanos</span>
                </div>
                <div style="background:var(--bg4);border-radius:4px;height:8px;overflow:hidden">
                  <div :style="{width: pct(data.desglose_fiabilidad.media.count) + '%', background:'var(--accent4)', height:'100%', borderRadius:'4px', transition:'width .5s'}"></div>
                </div>
                <div style="font-size:10px;color:var(--text3);margin-top:2px">{{ data.desglose_fiabilidad.media.descripcion }}</div>
              </div>

              <!-- Base -->
              <div v-if="data.desglose_fiabilidad.base.count > 0">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                  <span style="color:var(--accent);font-weight:500">Fiabilidad base (60-74%)</span>
                  <span style="color:var(--text2)">{{ data.desglose_fiabilidad.base.count }} ciudadanos</span>
                </div>
                <div style="background:var(--bg4);border-radius:4px;height:8px;overflow:hidden">
                  <div :style="{width: pct(data.desglose_fiabilidad.base.count) + '%', background:'var(--accent)', height:'100%', borderRadius:'4px', transition:'width .5s'}"></div>
                </div>
                <div style="font-size:10px;color:var(--text3);margin-top:2px">{{ data.desglose_fiabilidad.base.descripcion }}</div>
              </div>

              <!-- Sin dato -->
              <div v-if="data.desglose_fiabilidad.sin_dato.count > 0">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                  <span style="color:var(--text3);font-weight:500">Sin clasificar</span>
                  <span style="color:var(--text2)">{{ data.desglose_fiabilidad.sin_dato.count }} ciudadanos</span>
                </div>
                <div style="font-size:10px;color:var(--text3);margin-top:2px">Adhesiones anteriores al sistema de fiabilidad</div>
              </div>

            </div>
            <div v-else style="font-size:12px;color:var(--text3)">Sin datos de fiabilidad disponibles.</div>
          </div>

          <!-- BLOQUE 2 — Los tres números -->
          <div class="block" style="margin-bottom:12px">
            <div class="block-title">🔢 Los tres números</div>
            <div class="stats-row">
              <div class="sc">
                <div class="sc-n" style="color:var(--accent)">{{ data.total_adhesiones }}</div>
                <div class="sc-l">Adhesiones</div>
              </div>
              <div class="sc">
                <div class="sc-n" style="color:var(--accent2)">{{ data.ciudades_distintas }}</div>
                <div class="sc-l">Ciudades</div>
              </div>
              <div class="sc">
                <div class="sc-n" style="color:var(--accent4)">100%</div>
                <div class="sc-l">Verificadas</div>
              </div>
            </div>
          </div>

          <!-- BLOQUE GPS — Nivel de verificación -->
          <div class="block" style="margin-bottom:12px">
            <div class="block-title">📍 Nivel de verificación geográfica</div>
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <div style="flex:1;background:rgba(76,255,164,.06);border:.5px solid rgba(76,255,164,.2);border-radius:var(--r);padding:10px;text-align:center">
                <div style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--accent2)">{{ data.adhesiones_con_gps }}</div>
                <div style="font-size:9px;color:var(--text3);margin-top:2px">Con GPS verificado ✅</div>
              </div>
              <div style="flex:1;background:rgba(124,111,255,.06);border:.5px solid var(--border);border-radius:var(--r);padding:10px;text-align:center">
                <div style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--accent)">{{ data.adhesiones_sin_gps }}</div>
                <div style="font-size:9px;color:var(--text3);margin-top:2px">Solo SIM/IP 📱</div>
              </div>
            </div>
            <div style="font-size:10px;color:var(--text3);line-height:1.6">
              Las adhesiones con GPS confirmado acreditan la ubicación física del participante en el momento de adherirse.
            </div>
          </div>

          <!-- BLOQUE 3 — Prueba de humanidad -->
          <div class="block" style="margin-bottom:12px">
            <div class="block-title">🧠 Prueba de humanidad</div>
            <div style="font-size:14px;color:var(--text2);line-height:1.8">
              - {{ data.paises_distintos }} {{ data.paises_distintos === 1 ? 'país distinto' : 'países distintos' }}<br>
              - {{ data.idiomas_distintos }} {{ data.idiomas_distintos === 1 ? 'idioma distinto' : 'idiomas distintos' }}<br>
              • Primera adhesión: {{ formatDateTime(data.primera_adhesion) }}<br>
              • Última adhesión: {{ formatDateTime(data.ultima_adhesion) }}
            </div>
          </div>

          <!-- BLOQUE 4 — Velocidad de crecimiento -->
          <div class="block" style="margin-bottom:12px">
            <div class="block-title">📈 Velocidad de crecimiento</div>
            <div v-if="data.velocidad" style="margin-bottom:12px">
              <div style="display:flex;gap:8px;margin-bottom:12px">
                <div style="flex:1;background:var(--bg3);border-radius:var(--r);padding:10px;text-align:center">
                  <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--accent2)">{{ data.velocidad.media_diaria }}</div>
                  <div style="font-size:10px;color:var(--text3);margin-top:2px">Media diaria de adhesiones</div>
                </div>
                <div v-if="data.velocidad.dia_pico" style="flex:1;background:var(--bg3);border-radius:var(--r);padding:10px;text-align:center">
                  <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--accent)">{{ data.velocidad.dia_pico.count }}</div>
                  <div style="font-size:10px;color:var(--text3);margin-top:2px">Pico — {{ formatDate(data.velocidad.dia_pico.fecha) }}</div>
                </div>
              </div>
              <div style="font-size:10px;color:var(--text3);margin-bottom:6px">Adhesiones por día</div>
              <div style="display:flex;align-items:flex-end;gap:3px;height:80px">
                <div v-for="d in data.velocidad.adhesiones_por_dia" :key="d.fecha"
                  :style="{
                    flex:1,
                    background: d.count === data.velocidad.dia_pico?.count ? 'var(--accent2)' : 'var(--accent)',
                    height: maxPct(d.count) + '%',
                    borderRadius:'3px 3px 0 0',
                    minHeight:'4px',
                    opacity: d.count === data.velocidad.dia_pico?.count ? 1 : 0.6
                  }">
                </div>
              </div>
            </div>
            <div v-else style="font-size:12px;color:var(--text3)">Sin datos de velocidad disponibles.</div>
          </div>

          <!-- BLOQUE 6 — Cadena de verificación -->
          <div class="block" style="margin-bottom:12px">
            <div class="block-title">🔒 Cadena de verificación</div>
            <div style="font-size:14px;color:var(--text2);line-height:1.8">
              Cada adhesión fue verificada mediante: reCAPTCHA v3 (prueba de humanidad) + SMS OTP (número real) + hash SHA-256 local (anonimato irreversible) + unicidad de dispositivo.
            </div>
          </div>

          <!-- BLOQUE 7 — Sello de transparencia -->
          <div class="block" style="margin-bottom:20px">
            <div class="block-title">✅ Sello de transparencia</div>
            <div v-if="data.protest.hash_integridad" style="margin-bottom:12px;padding:8px 10px;background:rgba(76,255,164,.06);border:.5px solid rgba(76,255,164,.18);border-radius:var(--r)">
              <div style="font-size:9px;color:var(--text3);margin-bottom:4px">🔐 Hash de integridad al cierre</div>
              <div style="font-family:monospace;font-size:9px;color:var(--accent2);word-break:break-all">{{ data.protest.hash_integridad }}</div>
            </div>
            <div style="font-size:14px;color:var(--text2);line-height:1.8">
              Código fuente auditado públicamente:<br>
              <button
                onclick="window.open('https://github.com/cero-absoluto/vozciudadana','_blank')"
                style="background:transparent;border:.5px solid var(--accent);border-radius:var(--r);padding:4px 10px;color:var(--accent);cursor:pointer;font-size:11px;margin-top:4px">
                Ver código fuente en GitHub →
              </button><br><br>
              Informe generado: {{ formatDateTime(new Date().toISOString()) }}<br>
              ID de convocatoria: <span style="font-family:monospace;font-size:10px;color:var(--accent2)">{{ $route.params.id }}</span><br>
              Blockchain en desarrollo — disponible en v2.0.
            </div>
          </div>

        </div><!-- fin columna derecha -->

        <!-- Botón volver -->
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn-primary" style="flex:1" @click="$router.back()">← Back</button>
          <button class="btn-primary" style="flex:1;background:var(--accent2);color:#000" @click="downloadPDF">⬇ Download PDF Report</button>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import * as api from '@/services/api.js';
import { jsPDF } from 'jspdf';

const route = useRoute();
const TIPO_ABUSO_LABELS = {
  corrupcion: 'Corrupción o malversación',
  nepotismo: 'Nepotismo o favoritismo',
  derechos: 'Vulneración de derechos fundamentales',
  negligencia: 'Negligencia grave',
  represion: 'Represión o censura',
  opacidad: 'Opacidad o falta de rendición de cuentas',
  otro: 'Otro abuso de poder público',
};

const tipoAbusoLabel = computed(() =>
  TIPO_ABUSO_LABELS[data.value?.protest?.tipo_abuso] || data.value?.protest?.tipo_abuso || '—'
);
const data = ref(null);
const loading = ref(true);
const error = ref(false);

onMounted(async () => {
  try {
    const res = await fetch(
      `${import.meta.env.VITE_API_URL}/api/protests/${route.params.id}/informe`
    );
    if (!res.ok) throw new Error('Not found');
    data.value = await res.json();
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
});

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
  });
}

function pct(count) {
  if (!data.value?.total_adhesiones) return 0;
  return Math.round((count / data.value.total_adhesiones) * 100);
}
  function maxPct(count) {
  if (!data.value?.velocidad?.adhesiones_por_dia?.length) return 0;
  const max = Math.max(...data.value.velocidad.adhesiones_por_dia.map(d => d.count));
  return max > 0 ? Math.round((count / max) * 100) : 0;
}

function downloadPDF() {
  const d = data.value;
  if (!d) return;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210; const M = 18; const CW = W - M * 2;
  let y = 0;

  function nl(h = 5) { y += h; }
  function line() { doc.setDrawColor(60,60,80); doc.line(M, y, W - M, y); nl(4); }
  function h1(txt) { doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(255,255,255); doc.text(txt, M, y); nl(9); }
  function h2(txt) { doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(76,255,164); doc.text(txt, M, y); nl(6); }
  function body(txt, opts={}) {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(9); doc.setTextColor(180,178,200);
    const lines = doc.splitTextToSize(txt, CW);
    lines.forEach(l => { if (y > 270) { doc.addPage(); setPageBg(); y = 20; } doc.text(l, M, y); nl(5); });
  }
  function kv(k, v) {
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(120,115,160);
    doc.text(k + ':', M, y);
    doc.setFont('helvetica','normal'); doc.setTextColor(220,218,240);
    doc.text(String(v), M + 45, y);
    nl(5);
  }
  function setPageBg() { doc.setFillColor(12,11,20); doc.rect(0,0,210,297,'F'); }

  // PAGE 1
  setPageBg();
  y = 20;

  // Header band
  doc.setFillColor(30,27,50); doc.rect(0, 10, 210, 30, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(76,255,164);
  doc.text('VOZ CIUDADANA — VERIFIED PUBLIC REPORT', M, 18);
  doc.setFontSize(6); doc.setTextColor(120,115,160);
  doc.text('cero-absoluto.github.io/vozciudadana', M, 23);
  doc.setFontSize(6); doc.setTextColor(100,95,140);
  doc.text('Generated: ' + new Date().toISOString(), M, 27);
  y = 46;

  // Title
  doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(255,255,255);
  const titleLines = doc.splitTextToSize(d.protest.title, CW);
  titleLines.forEach(l => { doc.text(l, M, y); nl(8); });
  nl(2);

  // Political headline
  if (d.protest.demands && d.protest.focal_point) {
    doc.setFillColor(20,18,35); doc.rect(M-2, y-4, CW+4, 14, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(255,179,71);
    const headline = d.total_adhesiones + ' verified citizens demand to ' + d.protest.focal_point + ': \ + d.protest.demands + \';
    const hl = doc.splitTextToSize(headline, CW);
    hl.forEach(l => { doc.text(l, M, y); nl(5); });
    nl(3);
  }

  line();

  // Section 1 — Convocation details
  h2('1. CONVOCATION DETAILS');
  kv('Country', d.protest.country_name || '—');
  kv('Scope', d.protest.scope || '—');
  kv('Focal point', d.protest.focal_point || '—');
  kv('Start date', d.protest.starts_at ? new Date(d.protest.starts_at).toLocaleDateString('en-GB') : '—');
  kv('End date', d.protest.ends_at ? new Date(d.protest.ends_at).toLocaleDateString('en-GB') : '—');
  if (d.protest.tipo_abuso) kv('Abuse type', d.protest.tipo_abuso);
  if (d.protest.fuente_url) kv('Source', d.protest.fuente_url);
  if (d.protest.demands) { nl(1); body('Demands: ' + d.protest.demands); }
  nl(2); line();

  // Section 2 — Key figures
  h2('2. KEY FIGURES');
  kv('Total verified adhesions', d.total_adhesiones);
  kv('Distinct cities', d.ciudades_distintas);
  kv('Distinct countries', d.paises_distintos);
  kv('Distinct languages', d.idiomas_distintos);
  kv('Adhesions with GPS', d.adhesiones_con_gps + ' (' + Math.round(d.adhesiones_con_gps/Math.max(d.total_adhesiones,1)*100) + '%)');
  kv('Adhesions SIM/IP only', d.adhesiones_sin_gps);
  kv('First adhesion', d.primera_adhesion ? new Date(d.primera_adhesion).toLocaleString('en-GB') : '—');
  kv('Last adhesion', d.ultima_adhesion ? new Date(d.ultima_adhesion).toLocaleString('en-GB') : '—');
  nl(2); line();

  // Section 3 — Verification quality
  h2('3. VERIFICATION QUALITY');
  if (d.desglose_fiabilidad) {
    const fi = d.desglose_fiabilidad;
    if (fi.alta?.count > 0) kv('High reliability (85-95%)', fi.alta.count + ' citizens — ' + (fi.alta.descripcion || ''));
    if (fi.media?.count > 0) kv('Medium reliability (75-84%)', fi.media.count + ' citizens — ' + (fi.media.descripcion || ''));
    if (fi.base?.count > 0) kv('Base reliability (60-74%)', fi.base.count + ' citizens — ' + (fi.base.descripcion || ''));
    if (fi.sin_dato?.count > 0) kv('Unclassified', fi.sin_dato.count + ' citizens (prior to reliability system)');
  }
  nl(2); line();

  // Section 4 — Geographic distribution
  h2('4. GEOGRAPHIC DISTRIBUTION');
  if (d.distribucion_regiones && Object.keys(d.distribucion_regiones).length > 0) {
    body('By region:', {bold:true});
    Object.entries(d.distribucion_regiones).forEach(([r, c]) => body('  ' + r + ': ' + c + ' adhesion' + (c>1?'s':'') ));
    nl(1);
  }
  if (d.distribucion_ciudades?.length > 0) {
    body('Top cities: ' + d.distribucion_ciudades.slice(0,15).join(' · '));
    if (d.distribucion_ciudades.length > 15) body('...and ' + (d.distribucion_ciudades.length-15) + ' more cities.');
  }
  nl(2); line();

  // Section 5 — Growth velocity
  h2('5. GROWTH VELOCITY');
  if (d.velocidad) {
    kv('Daily average', d.velocidad.media_diaria + ' adhesions/day');
    if (d.velocidad.dia_pico) kv('Peak day', d.velocidad.dia_pico.count + ' adhesions on ' + new Date(d.velocidad.dia_pico.fecha).toLocaleDateString('en-GB'));
    if (d.velocidad.adhesiones_por_dia?.length > 0) {
      nl(1);
      body('Daily breakdown:', {bold:true});
      d.velocidad.adhesiones_por_dia.forEach(dd => body('  ' + new Date(dd.fecha).toLocaleDateString('en-GB') + ': ' + dd.count + ' adhesions'));
    }
  }
  nl(2); line();

  // Section 6 — Verification chain
  h2('6. VERIFICATION CHAIN');
  body('Each adhesion was verified through a multi-layer process:');
  body('  1. reCAPTCHA v3 — proof of humanity (bot detection)');
  body('  2. SMS OTP — real phone number verification (one adhesion per number)');
  body('  3. SHA-256 local hash — irreversible anonymisation (identity never stored)');
  body('  4. Device uniqueness — one device per protest scope');
  body('  5. Geographic verification — SIM prefix, IP geolocation, GPS (optional)');
  nl(2); line();

  // Section 7 — Transparency seal
  h2('7. TRANSPARENCY SEAL');
  kv('Convocation ID', route.params.id);
  kv('Open source', 'github.com/cero-absoluto/vozciudadana');
  kv('License', 'AGPL 3.0 — publicly auditable');
  kv('Report generated', new Date().toISOString());
  if (d.protest.hash_integridad) {
    nl(1);
    body('Integrity hash (SHA-256 at closure):', {bold:true});
    doc.setFont('courier','normal'); doc.setFontSize(7); doc.setTextColor(76,255,164);
    const hashLines = doc.splitTextToSize(d.protest.hash_integridad, CW);
    hashLines.forEach(l => { doc.text(l, M, y); nl(4); });
  }

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(20,18,35); doc.rect(0, 285, 210, 12, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(80,75,120);
    doc.text('Voz Ciudadana — Verified Citizen Protest Platform — AGPL 3.0', M, 291);
    doc.text('Page ' + i + ' of ' + totalPages, W - M, 291, {align:'right'});
  }

  const filename = 'vozciudadana-report-' + d.protest.title.replace(/[^a-z0-9]/gi,'-').toLowerCase().slice(0,40) + '.pdf';
  doc.save(filename);
}
</script>
