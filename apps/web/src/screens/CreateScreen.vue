<template>
  <div class="screen active" id="s-create">
    <div class="create-scroll">
  <!-- COLUMNA IZQUIERDA -->
  <div>
        <div class="fg">
  <label>Título *
    <span class="info-icon" @mouseenter="showTooltip('title')" @mouseleave="hideTooltip()">ℹ️
      <div v-if="tooltip === 'title'" class="tooltip-box">Resume la denuncia en una frase clara. Usa verbos como "exigir" o "denunciar". Máximo 120 caracteres.</div>
    </span>
  </label>
      <input type="text" v-model="form.title" maxlength="120" placeholder="Ej: Contra la corrupción del gobierno">
      <div class="char-c">{{ form.title.length }}/120</div>
    </div>
    <div class="fg">
  <label>Descripción *
    <span class="info-icon" @mouseenter="showTooltip('description')" @mouseleave="hideTooltip()">ℹ️
      <div v-if="tooltip === 'description'" class="tooltip-box">Explica el abuso con hechos concretos y verificables. Sin opiniones ni valoraciones personales. Máximo 500 caracteres.</div>
    </span>
  </label>
      <textarea v-model="form.description" rows="2" maxlength="500" placeholder="Explica el motivo con hechos concretos."></textarea>
      <div class="char-c">{{ form.description.length }}/500</div>
    </div>
    <div class="fg">
  <label>Qué exigimos *
    <span class="info-icon" @mouseenter="showTooltip('demands')" @mouseleave="hideTooltip()">ℹ️
      <div v-if="tooltip === 'demands'" class="tooltip-box">Usa verbos de acción: exigir, denunciar, dimitir, investigar. Verbos NO PERMTIDOS pedir, solicitar, proponer. Máximo 300 caracteres.</div>
    </span>
  </label>
      <textarea v-model="form.demands" rows="2" maxlength="300" placeholder="Ej: Que dimita el presidente · Que se retire la ley"></textarea>
      <div class="char-c">{{ form.demands.length }}/300</div>
    </div>
    <div class="fg">
  <label>Contra quien va dirigida *
    <span class="info-icon" @mouseenter="showTooltip('focal')" @mouseleave="hideTooltip()">ℹ️
      <div v-if="tooltip === 'focal'" class="tooltip-box">Institución o cargo público al que va dirigida la demanda. Debe ser una autoridad pública con poder de decisión.</div>
    </span>
  </label>
      <input type="text" v-model="form.focal_point" placeholder="Ej: Congreso de los Diputados">
    </div>
    
    <div class="fg"><label>Tipo de abuso *</label>
  <select v-model="form.tipo_abuso">
    <option value="">Selecciona el tipo de abuso...</option>
    <option value="corrupcion">Corrupción o malversación</option>
    <option value="nepotismo">Nepotismo o favoritismo</option>
    <option value="derechos">Vulneración de derechos fundamentales</option>
    <option value="negligencia">Negligencia grave</option>
    <option value="represion">Represión o censura</option>
    <option value="opacidad">Opacidad o falta de rendición de cuentas</option>
    <option value="otro">Otro abuso de poder público</option>
  </select>
</div>
<div class="fg">
  <label>Fuente que acredita el hecho *
    <span class="info-icon" @mouseenter="showTooltip('fuente')" @mouseleave="hideTooltip()">ℹ️
      <div v-if="tooltip === 'fuente'" class="tooltip-box">Enlaza un artículo de prensa, documento oficial, resolución judicial o dato estadístico que acredite el hecho denunciado.</div>
    </span>
  </label>
 <input type="text" v-model="form.fuente_url" placeholder="elpais.com/... o boe.es/...">
  <div v-if="fuenteStatus === 'checking'" style="font-size:11px;color:var(--text3);margin-top:4px">
    🔄 Verificando fuente...
  </div>
  <div v-else-if="fuenteStatus === 'oficial'" style="font-size:11px;color:var(--accent2);margin-top:4px">
    ✅ Organismo oficial verificado
  </div>
  <div v-else-if="fuenteStatus === 'verified'" style="font-size:11px;color:var(--accent2);margin-top:4px">
    ✅ Fuente verificada — {{ fuenteName }}
  </div>
  <div v-else-if="fuenteStatus === 'unknown'" style="font-size:11px;color:var(--accent4);margin-top:4px">
    ⚠️ Fuente no reconocida — asegúrate de que sea accesible públicamente
  </div>
  <div v-else-if="fuenteStatus === 'invalid'" style="font-size:11px;color:var(--accent3);margin-top:4px">
    ❌ URL no válida
  </div>
  <div v-else style="font-size:10px;color:var(--text3);margin-top:4px;opacity:.6">
    Enlaza el artículo, documento oficial o dato que acredita el hecho denunciado.
  </div>
</div>
  </div>

  <!-- COLUMNA DERECHA -->
  <div>
    <div class="scope-section">
      <div class="scope-section-title">Alcance geográfico *</div>
      <div class="scope-opts">
        <div v-for="s in scopes" :key="s.key"
          class="scope-opt" :class="{sel: form.scope === s.key}"
          @click="selectScope(s.key)">
          <div class="so-ico" :style="{background: s.bg}">{{ s.icon }}</div>
          <div class="so-txt">
            <div class="so-title">{{ s.label }} <span class="scope-badge" :class="s.badgeClass">{{ s.badgeLabel }}</span></div>
            <div class="so-desc">{{ s.desc }}</div>
          </div>
          <div class="so-radio" :class="{on: form.scope === s.key}"></div>
        </div>
      </div>
      <!-- Campos adaptativos según alcance -->
<div v-if="form.scope === 'national' || form.scope === 'regional'" class="fg" style="margin-top:12px">
  <label>País *</label>
  <select v-model="form.convocatoria_pais">
    <option value="">Selecciona un país...</option>
    <option value="AF">Afganistán</option>
    <option value="DE">Alemania</option>
    <option value="AR">Argentina</option>
    <option value="AU">Australia</option>
    <option value="AT">Austria</option>
    <option value="BE">Bélgica</option>
    <option value="BO">Bolivia</option>
    <option value="BR">Brasil</option>
    <option value="CA">Canadá</option>
    <option value="CL">Chile</option>
    <option value="CN">China</option>
    <option value="CO">Colombia</option>
    <option value="KR">Corea del Sur</option>
    <option value="CR">Costa Rica</option>
    <option value="CU">Cuba</option>
    <option value="DK">Dinamarca</option>
    <option value="EC">Ecuador</option>
    <option value="EG">Egipto</option>
    <option value="SV">El Salvador</option>
    <option value="AE">Emiratos Árabes</option>
    <option value="SK">Eslovaquia</option>
    <option value="SI">Eslovenia</option>
    <option value="ES">España</option>
    <option value="US">Estados Unidos</option>
    <option value="EE">Estonia</option>
    <option value="ET">Etiopía</option>
    <option value="PH">Filipinas</option>
    <option value="FI">Finlandia</option>
    <option value="FR">Francia</option>
    <option value="GH">Ghana</option>
    <option value="GR">Grecia</option>
    <option value="GT">Guatemala</option>
    <option value="HN">Honduras</option>
    <option value="HU">Hungría</option>
    <option value="IN">India</option>
    <option value="ID">Indonesia</option>
    <option value="IQ">Irak</option>
    <option value="IR">Irán</option>
    <option value="IE">Irlanda</option>
    <option value="IL">Israel</option>
    <option value="IT">Italia</option>
    <option value="JP">Japón</option>
    <option value="JO">Jordania</option>
    <option value="KZ">Kazajistán</option>
    <option value="KE">Kenia</option>
    <option value="LV">Letonia</option>
    <option value="LB">Líbano</option>
    <option value="LT">Lituania</option>
    <option value="LU">Luxemburgo</option>
    <option value="MX">México</option>
    <option value="MA">Marruecos</option>
    <option value="NL">Países Bajos</option>
    <option value="NG">Nigeria</option>
    <option value="NO">Noruega</option>
    <option value="NZ">Nueva Zelanda</option>
    <option value="PK">Pakistán</option>
    <option value="PA">Panamá</option>
    <option value="PY">Paraguay</option>
    <option value="PE">Perú</option>
    <option value="PL">Polonia</option>
    <option value="PT">Portugal</option>
    <option value="GB">Reino Unido</option>
    <option value="CZ">República Checa</option>
    <option value="DO">República Dominicana</option>
    <option value="RO">Rumanía</option>
    <option value="RU">Rusia</option>
    <option value="SA">Arabia Saudí</option>
    <option value="SN">Senegal</option>
    <option value="RS">Serbia</option>
    <option value="ZA">Sudáfrica</option>
    <option value="SE">Suecia</option>
    <option value="CH">Suiza</option>
    <option value="TH">Tailandia</option>
    <option value="TW">Taiwán</option>
    <option value="TZ">Tanzania</option>
    <option value="TR">Turquía</option>
    <option value="UA">Ucrania</option>
    <option value="UG">Uganda</option>
    <option value="UY">Uruguay</option>
    <option value="VE">Venezuela</option>
    <option value="VN">Vietnam</option>
  </select>
</div>

<div v-if="form.scope === 'regional'" class="fg" style="margin-top:12px">
  <label>Región / Provincia *</label>
  <input type="text" v-model="form.convocatoria_region" placeholder="Ej: Noord-Holland, Cataluña, Île-de-France">
</div>

<div v-if="form.scope === 'regional'" class="fg" style="margin-top:12px">
  <label>Institución <span style="font-weight:400;opacity:.6">(opcional)</span></label>
  <input type="text" v-model="form.convocatoria_institucion" placeholder="Ej: Utrecht University, Hospital Vall d'Hebron">
  <div class="char-c" style="text-align:left;margin-top:4px;opacity:.6">Si es una convocatoria universitaria o laboral, indica el nombre.</div>
</div>

<div v-if="form.scope === 'regional' && form.convocatoria_institucion" class="fg" style="margin-top:12px">
 <label>Dominio de email institucional *</label>
<div style="display:flex;align-items:center;gap:0">
  <div style="padding:9px 10px;background:var(--bg3);border:.5px solid var(--border);border-right:none;border-radius:var(--r) 0 0 var(--r);font-size:15px;color:var(--text3);font-family:'DM Sans',sans-serif">@</div>
  <input type="text" v-model="form.dominio_email" placeholder="uu.nl, uab.cat, upf.edu" style="border-radius:0 var(--r) var(--r) 0;flex:1">
</div>
<div class="char-c" style="text-align:left;margin-top:4px;opacity:.6">Solo la parte después de la @ — por ejemplo: uu.nl</div>
</div>
      <div v-if="form.scope === 'regional' && form.convocatoria_institucion && form.dominio_email" 
  style="background:var(--bg2);border:.5px solid var(--border);border-radius:var(--r2);padding:12px;margin-top:12px">
  <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:10px">
    ¿A quién va dirigida esta convocatoria?
  </div>
  <div style="display:flex;flex-direction:column;gap:8px">
    <div @click="form.requiere_censo = false"
      style="display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:var(--r);cursor:pointer;transition:all .15s"
      :style="{background: !form.requiere_censo ? 'rgba(124,111,255,.08)' : 'var(--bg3)', border: !form.requiere_censo ? '.5px solid var(--accent)' : '.5px solid var(--border)'}">
      <div style="width:14px;height:14px;border-radius:50%;border:.5px solid var(--border2);flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center"
        :style="{borderColor: !form.requiere_censo ? 'var(--accent)' : 'var(--border2)', background: !form.requiere_censo ? 'var(--accent)' : 'transparent'}">
        <div v-if="!form.requiere_censo" style="width:5px;height:5px;border-radius:50%;background:white"></div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:500;margin-bottom:3px">A toda la institución</div>
        <div style="font-size:9px;color:var(--text3);line-height:1.5">Cualquier miembro con email @{{ form.dominio_email || 'tuinstitucion.edu' }} puede participar</div>
      </div>
    </div>
    <div @click="form.requiere_censo = true"
      style="display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:var(--r);cursor:pointer;transition:all .15s"
      :style="{background: form.requiere_censo ? 'rgba(124,111,255,.08)' : 'var(--bg3)', border: form.requiere_censo ? '.5px solid var(--accent)' : '.5px solid var(--border)'}">
      <div style="width:14px;height:14px;border-radius:50%;border:.5px solid var(--border2);flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center"
        :style="{borderColor: form.requiere_censo ? 'var(--accent)' : 'var(--border2)', background: form.requiere_censo ? 'var(--accent)' : 'transparent'}">
        <div v-if="form.requiere_censo" style="width:5px;height:5px;border-radius:50%;background:white"></div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:500;margin-bottom:3px">A un departamento o grupo concreto</div>
        <div style="font-size:9px;color:var(--text3);line-height:1.5">Crea un censo dinámico y adhiérete — los miembros se verifican entre sí, solo entran quienes son avalados por compañeros del grupo</div>
      </div>
    </div>
  </div>
</div>
    </div>
    <div style="display:flex;gap:12px">
      <div class="fg" style="flex:1"><label>Fecha del evento *</label>
        <input type="date" v-model="form.starts_at" :min="minDate">
      </div>
      <div class="fg" style="flex:1"><label>Nivel de riesgo</label>
        <select v-model="form.risk_level">
          <option value="low">Bajo — democracia plena</option>
          <option value="med">Medio — restricciones</option>
          <option value="high">Alto — régimen autoritario</option>
          <option value="critical">Crítico — represión activa</option>
        </select>
      </div>
    </div>
          <div v-if="form.risk_level === 'high' || form.risk_level === 'critical'" class="risk-warn" style="display:flex">
      ⚠️ Se activará Tor + cifrado adicional automáticamente.
    </div>
    <div class="mod-box">
  <div class="mod-h">✅ Criterios de validación automática</div>
  <div class="mod-steps">
    <div class="mstep"><div class="mn">1</div>Fuente verificable — enlace a artículo, documento oficial o dato estadístico</div>
    <div class="mstep"><div class="mn">2</div>Destinatario público — institución con dinero o mandato público</div>
    <div class="mstep"><div class="mn">3</div>Denuncia de abuso — no solicitudes de mejora ni preferencias políticas</div>
    <div class="mstep"><div class="mn">4</div>Verbos de acción — exigir, denunciar, dimitir. No: pedir, solicitar, proponer</div>
  </div>
</div>
   
      <button class="btn-primary" style="width:100%;margin-bottom:18px" @click="submit">Crear convocatoria →</button>
  </div>
</div>
  </div>
  
</template>
<style scoped>
.info-icon { position: relative; cursor: pointer; font-size: 12px; margin-left: 4px; }
.tooltip-box {
  position: absolute; left: 20px; top: -4px; z-index: 100;
  background: var(--bg2); border: .5px solid var(--border2);
  border-radius: var(--r); padding: 8px 10px;
  font-size: 10px; color: var(--text2); width: 220px;
  line-height: 1.5; font-weight: 400;
}
</style>

<script setup>
import { reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useUiStore }       from '@/stores/ui.js';
import { REGIONS }          from '@/constants.js';

const router   = useRouter();
const protests = useProtestsStore();
const ui       = useUiStore();

  const minDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
const form = reactive({
  title: '', description: '', demands: '', focal_point: '',
  scope: 'national', region: null,
  duration_h: 36, risk_level: 'low', starts_at: '',
  convocatoria_pais: '',
  convocatoria_region: '',
  convocatoria_institucion: '',
  dominio_email: '',
  tipo_abuso: '',
  fuente_url: '',
  requiere_censo: false,
  
});
  const tooltip = ref(null);
  const fuenteStatus = ref(null);
const fuenteName = ref('');

async function verificarFuente(domain) {
  // Dominios oficiales — aprobación automática
  const oficiales = ['.gov', '.gob', '.edu', '.europa.eu', '.un.org', '.who.int', '.gc.ca', '.gouv.fr', '.gob.es', '.gov.uk'];
  if (oficiales.some(tld => domain.endsWith(tld))) return 'oficial';

  // Consulta a Wikidata
  const query = `
    SELECT ?label WHERE {
      ?item wdt:P856 ?url .
      ?item wdt:P31 ?type .
      VALUES ?type { wd:Q1193236 wd:Q11033 wd:Q1004705 wd:Q7275 wd:Q2297946 wd:Q1002697 wd:Q35127 }
      FILTER(CONTAINS(LCASE(str(?url)), "${domain}"))
      ?item rdfs:label ?label FILTER(LANG(?label) = "es" || LANG(?label) = "en")
    } LIMIT 1
  `;
  `;
  try {
    const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`);
    const data = await res.json();
    if (data.results.bindings.length > 0) {
      fuenteName.value = data.results.bindings[0].label.value;
      return 'verified';
    }
  } catch { /* silencioso */ }
  return 'unknown';
}

watch(() => form.fuente_url, async (url) => {
  fuenteStatus.value = null;
  fuenteName.value = '';
  if (!url || url.length < 10) return;
  try {
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      new URL(fullUrl); // valida que sea URL válida
      const domain = new URL(fullUrl).hostname.replace('www.', '');
    fuenteStatus.value = 'checking';
    fuenteStatus.value = await verificarFuente(domain);
  } catch {
    fuenteStatus.value = 'invalid';
  }
});

function showTooltip(id) { tooltip.value = id; }
function hideTooltip() { tooltip.value = null; }

const scopes = [
  { key:'national', icon:'🏛️', label:'Nacional', badgeClass:'sb-national', badgeLabel:'Solo ciudadanos del país', bg:'rgba(124,111,255,.08)', desc:'Solo participan dispositivos cuya SIM + IP correspondan al país de la convocatoria.' },
  { key:'regional', icon:'🌐', label:'Local',  badgeClass:'sb-regional', badgeLabel:'Ámbito local',          bg:'rgba(255,179,71,.08)',   desc:'Convocatoria de ámbito local' },
  { key:'global',   icon:'🌍', label:'Global',    badgeClass:'sb-global',   badgeLabel:'Cualquier ciudadano',      bg:'rgba(76,255,164,.08)',   desc:'Sin restricción geográfica.' },
];

function selectScope(s) {
  form.scope = s;
  form.region = null;
  if (s === 'regional') form.duration_h = 8;
  else if (s === 'national') form.duration_h = 36;
  else form.duration_h = 72;
}

function submit() {
  if (!form.title.trim())       { ui.showToast('El título es obligatorio'); return; }
  if (!form.description.trim()) { ui.showToast('La descripción es obligatoria'); return; }
  if (!form.demands.trim())     { ui.showToast('Indica qué exigís'); return; }
  if (!form.focal_point.trim()) { ui.showToast('El punto focal es obligatorio'); return; }
  if (!form.starts_at) { ui.showToast('La fecha del evento es obligatoria'); return; }
  if (form.scope === 'national' && !form.convocatoria_pais) { ui.showToast('Selecciona el país de la convocatoria'); return; }
  if (form.scope === 'regional' && !form.convocatoria_pais) { ui.showToast('Selecciona el país de la convocatoria'); return; }
  if (form.scope === 'regional' && !form.convocatoria_region.trim()) { ui.showToast('Indica la región o provincia'); return; }
  if (form.scope === 'regional' && form.convocatoria_institucion && !form.dominio_email.trim()) { ui.showToast('Indica el dominio de email institucional'); return; }
  if (!form.tipo_abuso) { ui.showToast('Selecciona el tipo de abuso'); return; }
if (!form.fuente_url.trim()) { ui.showToast('Indica la fuente que acredita el hecho'); return; }
  const VERBOS_PROHIBIDOS = ['apoyar','respaldar','celebrar','felicitar','pedir','solicitar','rogar','desear','esperar','agradecer','proponer','sugerir','recomendar','mejorar','support','endorse','celebrate','congratulate','ask','request','beg','wish','hope','thank','propose','suggest','recommend','improve'];
const VERBOS_PERMITIDOS = ['exigi','denuncia','demanda','rechaza','condena','ces','dimt','investig','public','revel','restitu','par','deten','suspend','demand','denounce','reject','condemn','dismiss','resign','investigate','publish','reveal','restore','stop','halt','suspend'];

const demandsLower = form.demands.toLowerCase();
const tieneProhibido = VERBOS_PROHIBIDOS.some(v => demandsLower.includes(v));
const tienePermitido = VERBOS_PERMITIDOS.some(v => demandsLower.includes(v));

if (tieneProhibido && !window.confirm('Detectamos un verbo que puede debilitar tu demanda ("solicitar", "pedir", etc.).\n\n¿Quieres continuar de todas formas?')) return;
if (!tienePermitido) { ui.showToast('Las exigencias deben incluir verbos como "exigir", "denunciar" o "demandar".'); return; }
const confirmMsg = `¿Confirmas que quieres publicar esta convocatoria?\n\n"${form.title}"\n\nUna vez publicada no podrá editarse ni eliminarse.`;
  if (!window.confirm(confirmMsg)) return;
  // Mapa de códigos ISO a nombres de país
const PAIS_NOMBRES = {
  'NL': 'Países Bajos', 'ES': 'España', 'DE': 'Alemania', 'FR': 'Francia',
  'GB': 'Reino Unido', 'IT': 'Italia', 'PT': 'Portugal', 'BE': 'Bélgica',
  'CH': 'Suiza', 'AT': 'Austria', 'SE': 'Suecia', 'NO': 'Noruega',
  'DK': 'Dinamarca', 'FI': 'Finlandia', 'PL': 'Polonia', 'CZ': 'República Checa',
  'SK': 'Eslovaquia', 'HU': 'Hungría', 'RO': 'Rumanía', 'BG': 'Bulgaria',
  'HR': 'Croacia', 'SI': 'Eslovenia', 'EE': 'Estonia', 'LV': 'Letonia',
  'LT': 'Lituania', 'LU': 'Luxemburgo', 'IE': 'Irlanda', 'GR': 'Grecia',
  'US': 'Estados Unidos', 'CA': 'Canadá', 'MX': 'México', 'AR': 'Argentina',
  'BR': 'Brasil', 'CL': 'Chile', 'CO': 'Colombia', 'PE': 'Perú',
  'VE': 'Venezuela', 'EC': 'Ecuador', 'BO': 'Bolivia', 'PY': 'Paraguay',
  'UY': 'Uruguay', 'CR': 'Costa Rica', 'PA': 'Panamá', 'GT': 'Guatemala',
  'HN': 'Honduras', 'SV': 'El Salvador', 'CU': 'Cuba', 'DO': 'República Dominicana',
  'JP': 'Japón', 'CN': 'China', 'KR': 'Corea del Sur', 'IN': 'India',
  'AU': 'Australia', 'NZ': 'Nueva Zelanda', 'ZA': 'Sudáfrica', 'NG': 'Nigeria',
  'EG': 'Egipto', 'MA': 'Marruecos', 'KE': 'Kenia', 'ET': 'Etiopía',
  'GH': 'Ghana', 'SN': 'Senegal', 'TZ': 'Tanzania', 'UG': 'Uganda',
  'TR': 'Turquía', 'SA': 'Arabia Saudí', 'AE': 'Emiratos Árabes', 'IL': 'Israel',
  'IQ': 'Irak', 'IR': 'Irán', 'JO': 'Jordania', 'LB': 'Líbano',
  'RU': 'Rusia', 'UA': 'Ucrania', 'RS': 'Serbia', 'AF': 'Afganistán',
  'PK': 'Pakistán', 'ID': 'Indonesia', 'PH': 'Filipinas', 'VN': 'Vietnam',
  'TH': 'Tailandia', 'TW': 'Taiwán', 'KZ': 'Kazajistán',
};
  protests.createProtest({
  ...form,
  starts_at: form.starts_at ? form.starts_at + 'T08:00:00.000Z' : null,
  convocatoria_pais: form.convocatoria_pais || null,
  convocatoria_region: form.convocatoria_region || null,
  convocatoria_institucion: form.convocatoria_institucion || null,
  dominio_email: form.dominio_email || null,
  tipo_abuso: form.tipo_abuso || null,
  fuente_url: form.fuente_url || null,
  requiere_censo: form.requiere_censo || false,
  country: form.convocatoria_pais || null,
  country_name: PAIS_NOMBRES[form.convocatoria_pais] || form.convocatoria_pais || 'regional',
});
  ui.showToast('✓ Convocatoria creada — ya aparece en el mapa');
  router.push('/');
}
</script>
