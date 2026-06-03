<template>
  <div class="screen active" id="s-create">
    <div class="create-scroll">
  <!-- COLUMNA IZQUIERDA -->
  <div>
        <div class="fg">
  <label>{{ $t('create.titleLabel') }}
    <span class="info-icon" @mouseenter="showTooltip('title')" @mouseleave="hideTooltip()">ℹ️
      <div v-if="tooltip === 'title'" class="tooltip-box">{{ $t('create.titleTooltip') }}</div>
    </span>
  </label>
      <input type="text" v-model="form.title" maxlength="120" :placeholder="$t('create.titlePlaceholder')">
      <div class="char-c">{{ form.title.length }}/120</div>
    </div>
    <div class="fg">
  <label>{{ $t('create.descLabel') }}
    <span class="info-icon" @mouseenter="showTooltip('description')" @mouseleave="hideTooltip()">ℹ️
      <div v-if="tooltip === 'description'" class="tooltip-box">{{ $t('create.descTooltip') }}</div>
    </span>
  </label>
      <textarea v-model="form.description" rows="2" maxlength="500" :placeholder="$t('create.descPlaceholder')"></textarea>
      <div class="char-c">{{ form.description.length }}/500</div>
    </div>
    <div class="fg">
  <label>{{ $t('create.demandsLabel') }}
    <span class="info-icon" @mouseenter="showTooltip('demands')" @mouseleave="hideTooltip()">ℹ️
      <div v-if="tooltip === 'demands'" class="tooltip-box">{{ $t('create.demandsTooltip') }}</div>
    </span>
  </label>
      <textarea v-model="form.demands" rows="2" maxlength="300" :placeholder="$t('create.demandsPlaceholder')"></textarea>
      <div class="char-c">{{ form.demands.length }}/300</div>
    </div>

    <!-- ── CAMPO WIKIDATA: Who is it directed at? ── -->
    <div class="fg" style="position:relative">
  <label>{{ $t('create.focalLabel') }}
    <span class="info-icon" @mouseenter="showTooltip('focal')" @mouseleave="hideTooltip()">ℹ️
      <div v-if="tooltip === 'focal'" class="tooltip-box">{{ $t('create.focalTooltip') }}</div>
    </span>
  </label>
  <div style="position:relative">
    <input type="text"
      v-model="targetQuery"
      @input="onTargetInput"
      @blur="onTargetBlur"
      :placeholder="$t('create.focalPlaceholder')"
      autocomplete="off">
    <!-- Validation status badge -->
    <div v-if="targetStatus" style="margin-top:6px;font-size:11px;padding:6px 10px;border-radius:6px"
      :style="{
        background: targetStatus==='ALLOWED' ? 'rgba(76,255,164,.1)' : targetStatus==='REJECTED' ? 'rgba(255,94,91,.1)' : targetStatus==='CHECKING' ? 'rgba(255,255,255,.05)' : 'rgba(255,179,71,.1)',
        border: targetStatus==='ALLOWED' ? '1px solid rgba(76,255,164,.3)' : targetStatus==='REJECTED' ? '1px solid rgba(255,94,91,.3)' : targetStatus==='CHECKING' ? '1px solid var(--border)' : '1px solid rgba(255,179,71,.3)',
        color: targetStatus==='ALLOWED' ? 'var(--accent2)' : targetStatus==='REJECTED' ? 'var(--accent3)' : targetStatus==='CHECKING' ? 'var(--text3)' : 'var(--accent4)'
      }">
      <span v-if="targetStatus==='ALLOWED'">✅ {{ targetName }} — {{ targetType }} — {{ targetCountry }}</span>
      <span v-else-if="targetStatus==='REJECTED'">❌ {{ targetName }} — {{ targetType }} — Not allowed on Voice Protest</span>
      <span v-else-if="targetStatus==='NEEDS_REVIEW'">⚠️ {{ targetName }} — Needs manual review before publishing</span>
      <span v-else-if="targetStatus==='CHECKING'">🔍 Verifying with Wikidata...</span>
    </div>
    <!-- Autocomplete dropdown -->
    <div v-if="targetSuggestions.length > 0"
      style="position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:.5px solid var(--border2);border-radius:var(--r);z-index:100;max-height:200px;overflow-y:auto;margin-top:2px">
      <div v-for="s in targetSuggestions" :key="s.id"
        @mousedown.prevent="selectTarget(s)"
        style="padding:10px 14px;cursor:pointer;font-size:12px;border-bottom:.5px solid var(--border)"
        @mouseenter="e => e.target.style.background='var(--bg3)'"
        @mouseleave="e => e.target.style.background='transparent'">
        <div style="font-weight:600">{{ s.label }}</div>
        <div style="font-size:10px;color:var(--text2)">{{ s.description }}</div>
      </div>
    </div>
  </div>
</div>
    
    <div class="fg"><label>{{ $t('create.abusoLabel') }}</label>
  <select v-model="form.tipo_abuso">
    <option value="">{{ $t('create.abusoPlaceholder') }}</option>
    <option value="corrupcion">{{ $t('create.abusoCorrupcion') }}</option>
    <option value="nepotismo">{{ $t('create.abusoNepotismo') }}</option>
    <option value="derechos">{{ $t('create.abusoDerechos') }}</option>
    <option value="negligencia">{{ $t('create.abusoNegligencia') }}</option>
    <option value="represion">{{ $t('create.abusoRepresion') }}</option>
    <option value="opacidad">{{ $t('create.abusoOpacidad') }}</option>
    <option value="otro">{{ $t('create.abusoOtro') }}</option>
  </select>
</div>
<div class="fg">
  <label>{{ $t('create.fuenteLabel') }}
    <span class="info-icon" @mouseenter="showTooltip('fuente')" @mouseleave="hideTooltip()">ℹ️
      <div v-if="tooltip === 'fuente'" class="tooltip-box">{{ $t('create.fuenteTooltip') }}</div>
    </span>
  </label>
 <input type="text" v-model="form.fuente_url" :placeholder="$t('create.fuentePlaceholder')">
  <div v-if="fuenteStatus === 'checking'" style="font-size:11px;color:var(--text3);margin-top:4px">
    🔄 {{ $t('create.fuenteChecking') }}
  </div>
  <div v-else-if="fuenteStatus === 'oficial'" style="font-size:11px;color:var(--accent2);margin-top:4px">
    ✅ {{ $t('create.fuenteOficial') }}
  </div>
  <div v-else-if="fuenteStatus === 'verified'" style="font-size:11px;color:var(--accent2);margin-top:4px">
    ✅ {{ $t('create.fuenteVerified') }} — {{ fuenteName }}
  </div>
  <div v-else-if="fuenteStatus === 'unknown'" style="font-size:11px;color:var(--accent4);margin-top:4px">
    ⚠️ {{ $t('create.fuenteUnknown') }}
  </div>
  <div v-else-if="fuenteStatus === 'invalid'" style="font-size:11px;color:var(--accent3);margin-top:4px">
    ❌ {{ $t('create.fuenteInvalid') }}
  </div>
  <div v-else style="font-size:10px;color:var(--text3);margin-top:4px;opacity:.6">
    {{ $t('create.fuenteHint') }}
  </div>
</div>
  </div>

  <!-- COLUMNA DERECHA -->
  <div>
    <div class="scope-section">
      <div class="scope-section-title">{{ $t('create.scopeTitle') }}</div>
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
  <label>{{ $t('create.paisLabel') }}</label>
  <select v-model="form.convocatoria_pais">
    <option value="">{{ $t('create.paisPlaceholder') }}</option>
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
    <option value="MT">Malta</option>
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
  <label>{{ $t('create.regionLabel') }}</label>
  <input type="text" v-model="form.convocatoria_region" :placeholder="$t('create.regionPlaceholder')">
</div>

<div v-if="form.scope === 'regional'" class="fg" style="margin-top:12px">
  <label>{{ $t('create.institucionLabel') }} <span style="font-weight:400;opacity:.6">({{ $t('create.optional') }})</span></label>
  <input type="text" v-model="form.convocatoria_institucion" :placeholder="$t('create.institucionPlaceholder')">
  <div class="char-c" style="text-align:left;margin-top:4px;opacity:.6">{{ $t('create.institucionHint') }}</div>
</div>

<div v-if="form.scope === 'regional' && form.convocatoria_institucion" class="fg" style="margin-top:12px">
 <label>{{ $t('create.dominioLabel') }}</label>
<div style="display:flex;align-items:center;gap:0">
  <div style="padding:9px 10px;background:var(--bg3);border:.5px solid var(--border);border-right:none;border-radius:var(--r) 0 0 var(--r);font-size:15px;color:var(--text3);font-family:'DM Sans',sans-serif">@</div>
  <input type="text" v-model="form.dominio_email" placeholder="uu.nl, uab.cat, upf.edu" style="border-radius:0 var(--r) var(--r) 0;flex:1">
</div>
<div class="char-c" style="text-align:left;margin-top:4px;opacity:.6">{{ $t('create.dominioHint') }}</div>
</div>
      <div v-if="form.scope === 'regional' && form.convocatoria_institucion && form.dominio_email" 
  style="background:var(--bg2);border:.5px solid var(--border);border-radius:var(--r2);padding:12px;margin-top:12px">
  <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:10px">
    {{ $t('create.censoTitle') }}
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
        <div style="font-size:11px;font-weight:500;margin-bottom:3px">{{ $t('create.censoAll') }}</div>
        <div style="font-size:9px;color:var(--text3);line-height:1.5">{{ $t('create.censoAllDesc', { domain: form.dominio_email || 'tuinstitucion.edu' }) }}</div>
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
        <div style="font-size:11px;font-weight:500;margin-bottom:3px">{{ $t('create.censoDept') }}</div>
        <div style="font-size:9px;color:var(--text3);line-height:1.5">{{ $t('create.censoDeptDesc') }}</div>
      </div>
    </div>
  </div>
</div>
    </div>
    <div style="display:flex;gap:12px">
      <div class="fg" style="flex:1"><label>{{ $t('create.dateLabel') }}</label>
        <input type="date" v-model="form.starts_at" :min="minDate">
      </div>
      <div class="fg" style="flex:1"><label>{{ $t('create.riskLabel') }}</label>
        <select v-model="form.risk_level">
          <option value="low">{{ $t('create.riskLow') }}</option>
          <option value="med">{{ $t('create.riskMed') }}</option>
          <option value="high">{{ $t('create.riskHigh') }}</option>
          <option value="critical">{{ $t('create.riskCritical') }}</option>
        </select>
      </div>
    </div>
          <div v-if="form.risk_level === 'high' || form.risk_level === 'critical'" class="risk-warn" style="display:flex">
      ⚠️ {{ $t('create.riskWarn') }}
    </div>
    <div class="mod-box">
  <div class="mod-h">✅ {{ $t('create.modTitle') }}</div>
  <div class="mod-steps">
    <div class="mstep"><div class="mn">1</div>{{ $t('create.mod1') }}</div>
    <div class="mstep"><div class="mn">2</div>{{ $t('create.mod2') }}</div>
    <div class="mstep"><div class="mn">3</div>{{ $t('create.mod3') }}</div>
    <div class="mstep"><div class="mn">4</div>{{ $t('create.mod4') }}</div>
  </div>
</div>
   
      <button class="btn-primary" style="width:100%;margin-bottom:18px" @click="submit">{{ $t('create.submit') }}</button>
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
import { reactive, ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useProtestsStore } from '@/stores/protests.js';
import { useUiStore }       from '@/stores/ui.js';
import { REGIONS }          from '@/constants.js';

const router   = useRouter();
const protests = useProtestsStore();
const ui       = useUiStore();
const { t }    = useI18n();

const minDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
const form = reactive({
  title: '', description: '', demands: '', focal_point: '',
  target_wikidata_id: '', target_type: '', target_country: '', target_validation: '',
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

// ── Wikidata target validation ─────────────────────────────────────────────
const targetQuery       = ref('');
const targetSuggestions = ref([]);
const targetStatus      = ref(null);
const targetName        = ref('');
const targetType        = ref('');
const targetCountry     = ref('');
const targetWikiId      = ref('');
let targetDebounce      = null;

const ALLOWED_TYPES = new Set([
  'Q1193236','Q11033','Q1004705','Q7275','Q2297946','Q1002697',
  'Q327333','Q37260','Q35749','Q637846','Q11204','Q15284',
  'Q6465','Q7278','Q2659904','Q178706','Q1639634','Q270791',
  'Q15265344','Q3918','Q16917','Q178790','Q190928','Q35120','Q43229',
]);

const REJECTED_TYPES = new Set([
  'Q5','Q4830453','Q431289','Q476028','Q215380','Q11424',
]);

async function searchWikidata(q) {
  if (!q || q.length < 2) { targetSuggestions.value = []; return; }
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&limit=6&format=json&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    targetSuggestions.value = (data.search || []).map(s => ({
      id: s.id, label: s.label || s.id, description: s.description || '',
    }));
  } catch { targetSuggestions.value = []; }
}

async function validateTarget(wikidataId, label) {
  targetStatus.value = 'CHECKING';
  targetWikiId.value = wikidataId;
  targetName.value   = label;
  try {
    const sparql = `SELECT ?type ?typeLabel ?countryLabel WHERE {
      wd:${wikidataId} wdt:P31 ?type .
      OPTIONAL { wd:${wikidataId} wdt:P17 ?country . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    } LIMIT 10`;
    const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql) + '&format=json');
    const data = await res.json();
    const bindings = data.results.bindings;
    if (bindings.length === 0) { targetStatus.value = 'NEEDS_REVIEW'; targetType.value = 'Unknown entity'; return; }
    const countryBinding = bindings.find(b => b.countryLabel);
    targetCountry.value = countryBinding?.countryLabel?.value || '';
    let allowed = false, rejected = false, typeLabel = '';
    for (const b of bindings) {
      const typeId = b.type.value.split('/').pop();
      const tLabel = b.typeLabel?.value || typeId;
      if (!typeLabel) typeLabel = tLabel;
      if (REJECTED_TYPES.has(typeId)) { rejected = true; typeLabel = tLabel; break; }
      if (ALLOWED_TYPES.has(typeId))  { allowed  = true; typeLabel = tLabel; }
    }
    targetType.value = typeLabel;
    if (rejected) {
      targetStatus.value = 'REJECTED';
      form.focal_point = ''; form.target_wikidata_id = ''; form.target_type = ''; form.target_country = ''; form.target_validation = 'REJECTED';
    } else if (allowed) {
      targetStatus.value = 'ALLOWED';
      form.focal_point = label; form.target_wikidata_id = wikidataId; form.target_type = typeLabel; form.target_country = targetCountry.value; form.target_validation = 'ALLOWED';
    } else {
      targetStatus.value = 'NEEDS_REVIEW';
      form.focal_point = label; form.target_wikidata_id = wikidataId; form.target_type = typeLabel; form.target_country = targetCountry.value; form.target_validation = 'NEEDS_REVIEW';
    }
  } catch {
    targetStatus.value = 'NEEDS_REVIEW';
    form.focal_point = label; form.target_validation = 'NEEDS_REVIEW';
  }
}

function onTargetInput() {
  targetStatus.value = null; form.focal_point = '';
  clearTimeout(targetDebounce);
  targetDebounce = setTimeout(() => searchWikidata(targetQuery.value), 350);
}

function onTargetBlur() {
  setTimeout(() => { targetSuggestions.value = []; }, 200);
}

async function selectTarget(s) {
  targetQuery.value = s.label;
  targetSuggestions.value = [];
  await validateTarget(s.id, s.label);
}

async function verificarFuente(domain) {
  const oficiales = ['.gov', '.gob', '.edu', '.europa.eu', '.un.org', '.who.int', '.gc.ca', '.gouv.fr', '.gob.es', '.gov.uk', '.gob.mx', '.gov.au', '.gov.br', '.gouv.be'];
  const dominiosOficiales = ['boe.es', 'sepe.es', 'congreso.es', 'senado.es', 'poderjudicial.es', 'ine.es', 'europarl.europa.eu', 'eur-lex.europa.eu', 'un.org', 'who.int', 'oecd.org', 'worldbank.org', 'imf.org', 'rtve.es'];
  if (dominiosOficiales.includes(domain)) return 'oficial';
  if (oficiales.some(tld => domain.endsWith(tld))) return 'oficial';
  const query = 'SELECT ?label WHERE { ?item wdt:P856 ?url . ?item wdt:P31 ?type . VALUES ?type { wd:Q1193236 wd:Q11033 wd:Q1004705 wd:Q7275 wd:Q2297946 wd:Q1002697 wd:Q35127 } FILTER(CONTAINS(LCASE(str(?url)), "' + domain + '")) ?item rdfs:label ?label FILTER(LANG(?label) = "es" || LANG(?label) = "en") } LIMIT 1';
  try {
    const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(query) + '&format=json');
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
    new URL(fullUrl);
    const domain = new URL(fullUrl).hostname.replace('www.', '');
    fuenteStatus.value = 'checking';
    fuenteStatus.value = await verificarFuente(domain);
  } catch {
    fuenteStatus.value = 'invalid';
  }
});

function showTooltip(id) { tooltip.value = id; }
function hideTooltip() { tooltip.value = null; }

const scopes = computed(() => [
  { key:'national', icon:'🏧', label: t('create.scopeNational'), badgeClass:'sb-national', badgeLabel: t('create.scopeNationalBadge'), bg:'rgba(124,111,255,.08)', desc: t('create.scopeNationalDesc') },
  { key:'regional', icon:'🌐', label: t('create.scopeLocal'),    badgeClass:'sb-regional', badgeLabel: t('create.scopeLocalBadge'),    bg:'rgba(255,179,71,.08)',   desc: t('create.scopeLocalDesc') },
  { key:'global',   icon:'🌍', label: t('create.scopeGlobal'),   badgeClass:'sb-global',   badgeLabel: t('create.scopeGlobalBadge'),   bg:'rgba(76,255,164,.08)',   desc: t('create.scopeGlobalDesc') },
]);

function selectScope(s) {
  form.scope = s;
  form.region = null;
  if (s === 'regional') form.duration_h = 8;
  else if (s === 'national') form.duration_h = 36;
  else form.duration_h = 72;
}

function submit() {
  if (!form.title.trim())       { ui.showToast(t('create.errTitle')); return; }
  if (!form.description.trim()) { ui.showToast(t('create.errDesc')); return; }
  if (!form.demands.trim())     { ui.showToast(t('create.errDemands')); return; }
  if (!form.focal_point.trim()) { ui.showToast(t('create.errFocal')); return; }
  if (targetStatus.value === 'REJECTED') { ui.showToast('This entity is not allowed. Voice Protest only accepts public institutions.'); return; }
  if (targetStatus.value === 'CHECKING') { ui.showToast('Please wait while we verify the entity.'); return; }
  if (!form.starts_at) { ui.showToast(t('create.errDate')); return; }
  if (form.scope === 'national' && !form.convocatoria_pais) { ui.showToast(t('create.errPais')); return; }
  if (form.scope === 'regional' && !form.convocatoria_pais) { ui.showToast(t('create.errPais')); return; }
  if (form.scope === 'regional' && !form.convocatoria_region.trim()) { ui.showToast(t('create.errRegion')); return; }
  if (form.scope === 'regional' && form.convocatoria_institucion && !form.dominio_email.trim()) { ui.showToast(t('create.errDominio')); return; }
  if (!form.tipo_abuso) { ui.showToast(t('create.errAbuso')); return; }
  if (!form.fuente_url.trim()) { ui.showToast(t('create.errFuente')); return; }

  const VERBOS_PROHIBIDOS = ['apoyar','respaldar','celebrar','felicitar','pedir','solicitar','rogar','desear','esperar','agradecer','proponer','sugerir','recomendar','mejorar','support','endorse','celebrate','congratulate','ask','request','beg','wish','hope','thank','propose','suggest','recommend','improve'];
  const VERBOS_PERMITIDOS = ['exigi','denuncia','demanda','rechaza','condena','ces','dimt','investig','public','revel','restitu','par','deten','suspend','demand','denounce','reject','condemn','dismiss','resign','investigate','publish','reveal','restore','stop','halt','suspend'];

  const demandsLower = form.demands.toLowerCase();
  const tieneProhibido = VERBOS_PROHIBIDOS.some(v => demandsLower.includes(v));
  const tienePermitido = VERBOS_PERMITIDOS.some(v => demandsLower.includes(v));

  if (tieneProhibido && !window.confirm(t('create.confirmWeakVerb'))) return;
  if (!tienePermitido) { ui.showToast(t('create.errVerb')); return; }

  const confirmMsg = t('create.confirmPublish', { title: form.title });
  if (!window.confirm(confirmMsg)) return;

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
