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
        <button class="btn-primary" style="width:100%;margin-top:8px" @click="$router.back()">
          ← Volver
        </button>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import * as api from '@/services/api.js';

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
</script>
