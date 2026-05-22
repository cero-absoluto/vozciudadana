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
      <div v-else-if="data">

        <!-- Cabecera -->
        <div style="margin-bottom:20px">
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">
            Informe público verificado
          </div>
          <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;letter-spacing:-.4px;margin-bottom:8px">
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

        <!-- BLOQUE 4 — Penetración del universo -->
        <div class="block" style="margin-bottom:12px">
          <div class="block-title">🌍 Penetración del universo</div>
          <div style="font-size:14px;color:var(--text2);line-height:1.8">
            {{ data.total_adhesiones }} adhesiones verificadas sobre un universo elegible de ciudadanos de {{ data.protest.country_name }}.
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

        <!-- Botón volver -->
        <button class="btn-primary" style="width:100%" @click="$router.back()">
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
</script>
