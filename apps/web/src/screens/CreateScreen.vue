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
      <span v-else-if="targetStatus==='REJECTED'">❌ {{ targetName }} — {{ targetType }} — {{ $t('create.errTargetRejectedShort') }}</span>
      <span v-else-if="targetStatus==='NEEDS_REVIEW'">⚠️ {{ targetName }} — {{ $t('create.errTargetReview') }}</span>
      <span v-else-if="targetStatus==='CHECKING'">🔍 {{ $t('create.errTargetChecking') }}</span>
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

  <!-- Checking spinner -->
  <div v-if="sourceChecking" style="font-size:11px;color:var(--text3);margin-top:6px;display:flex;align-items:center;gap:6px">
    <span style="animation:spin 1s linear infinite;display:inline-block">🔄</span> {{ $t('create.fuenteChecking') }}
  </div>

  <!-- Validation card -->
  <div v-else-if="sourceResult" style="margin-top:8px;border-radius:10px;overflow:hidden;border:.5px solid var(--border2)">
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px"
      :style="{
        background: sourceResult.source_validation_status === 'VERIFIED_SOURCE' ? 'rgba(76,255,164,.08)' :
                    sourceResult.source_validation_status === 'RELEVANT_SOURCE'  ? 'rgba(76,255,164,.06)' :
                    sourceResult.source_validation_status === 'WEAK_SOURCE'      ? 'rgba(255,179,71,.08)' :
                    sourceResult.source_validation_status === 'PAYWALLED_SOURCE' ? 'rgba(255,179,71,.06)' :
                    sourceResult.source_validation_status === 'BLOCKED_SOURCE'   ? 'rgba(255,94,91,.08)'  :
                    'rgba(255,255,255,.04)'
      }">
      <span style="font-size:18px">
        {{ sourceResult.source_validation_status === 'VERIFIED_SOURCE' ? '✅' :
           sourceResult.source_validation_status === 'RELEVANT_SOURCE'  ? '✅' :
           sourceResult.source_validation_status === 'WEAK_SOURCE'      ? '⚠️' :
           sourceResult.source_validation_status === 'PAYWALLED_SOURCE' ? '🔒' :
           sourceResult.source_validation_status === 'BLOCKED_SOURCE'   ? '❌' :
           sourceResult.source_validation_status === 'UNAVAILABLE_SOURCE' ? '⚠️' : '🔍' }}
      </span>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;font-weight:700;margin-bottom:1px"
          :style="{
            color: ['VERIFIED_SOURCE','RELEVANT_SOURCE'].includes(sourceResult.source_validation_status) ? 'var(--accent2)' :
                   ['WEAK_SOURCE','PAYWALLED_SOURCE','UNAVAILABLE_SOURCE'].includes(sourceResult.source_validation_status) ? 'var(--accent4)' :
                   'var(--accent3)'
          }">
          {{ sourceResult.source_domain }}
          <span style="font-weight:400;opacity:.6;text-transform:capitalize"> · {{ sourceResult.source_type?.replace(/_/g,' ') }}</span>
        </div>
        <div style="font-size:10px;color:var(--text2);line-height:1.4">{{ sourceResult.message }}</div>
      </div>
      <div style="flex-shrink:0;text-align:center">
        <div style="font-size:14px;font-weight:800;line-height:1"
          :style="{color: sourceResult.source_confidence_score >= 60 ? 'var(--accent2)' : sourceResult.source_confidence_score >= 40 ? 'var(--accent4)' : 'var(--accent3)'}">
          {{ sourceResult.source_confidence_score ?? '—' }}
        </div>
        <div style="font-size:8px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">score</div>
      </div>
    </div>
    <div v-if="sourceResult.source_title" style="padding:8px 14px;border-top:.5px solid var(--border);background:var(--bg2)">
      <div style="font-size:11px;font-weight:600;margin-bottom:2px;color:var(--text)">{{ sourceResult.source_title }}</div>
      <div v-if="sourceResult.source_description" style="font-size:10px;color:var(--text2);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">
        {{ sourceResult.source_description }}
      </div>
      <div style="display:flex;gap:12px;margin-top:5px;font-size:9px;color:var(--text3)">
        <span v-if="sourceResult.published_at">📅 {{ sourceResult.published_at?.substring(0,10) }}</span>
        <span v-if="sourceResult.source_author">✍️ {{ sourceResult.source_author }}</span>
        <span v-if="sourceResult.language">🌐 {{ sourceResult.language }}</span>
      </div>
    </div>
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
<div v-if="form.scope === 'national' || form.scope === 'regional'" class="fg" style="margin-top:12px">
  <label>{{ $t('create.paisLabel') }}</label>
  <select v-model="form.convocatoria_pais">
    <option value="">{{ $t('create.paisPlaceholder') }}</option>
    <option v-for="c in sortedCountries" :key="c.code" :value="c.code">{{ c.name }}</option>
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

<div v-show="form.scope === 'regional' && form.convocatoria_institucion" class="fg" style="margin-top:12px">
 <label>{{ $t('create.dominioLabel') }}</label>
<div style="display:flex;align-items:center;gap:0">
  <div style="padding:9px 10px;background:var(--bg3);border:.5px solid var(--border);border-right:none;border-radius:var(--r) 0 0 var(--r);font-size:15px;color:var(--text3);font-family:'DM Sans',sans-serif">@</div>
  <input type="text" v-model="form.dominio_email" placeholder="uu.nl, uab.cat, upf.edu" style="border-radius:0 var(--r) var(--r) 0;flex:1">
</div>
<div class="char-c" style="text-align:left;margin-top:4px;opacity:.6">{{ $t('create.dominioHint') }}</div>
</div>
      <div v-show="form.scope === 'regional' && form.convocatoria_institucion && form.dominio_email" 
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
    <!-- Ends at preview -->
    <div v-if="form.starts_at && endsAt" style="font-size:12px;color:var(--text2);margin-bottom:12px;padding:8px 12px;background:var(--bg2);border-radius:var(--r);border:.5px solid var(--border)">
      📅 {{ $t('create.endsAt') }}: <strong>{{ endsAt }}</strong>
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
  <div style="margin-top:10px;padding-top:10px;border-top:.5px solid var(--border);font-size:10px;color:var(--text3);font-style:italic;text-align:center">
    {{ $t('create.principleNote') }}
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
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
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
const { t, locale } = useI18n({ useScope: 'global' });

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
const sourceChecking = ref(false);
const sourceResult   = ref(null);

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
  'Q30185','Q1255921','Q294414','Q4164871','Q699567','Q83307',
  'Q372436','Q107363442','Q48352','Q2101','Q212238','Q13218630',
  'Q16533','Q193391','Q82955','Q1097498','Q15275719','Q42178','Q486839',
  'Q902522','Q62078547','Q875538','Q38723','Q189004','Q23002054',
  // Public institution types
  'Q166107',  // overheidsorgaan / public body (Netherlands)
  'Q2085381', // department of government
  'Q17320256',// public body (generic)
  'Q28863770',// public institution
  'Q970671',  // public enterprise
  'Q1301371', // national agency
  'Q1149035', // cabinet (government)
  'Q2188189', // municipal council
  'Q253019',  // prefecture
  'Q1752939', // administrative division
  'Q7210356', // political organisation
  'Q4120845', // regional government
  'Q6243229', // regulatory agency
  'Q748720',  // public authority
  'Q31855',   // inspectorate
  'Q2275247', // national commission
  // Supranational and intergovernmental
  'Q170156',  // intergovernmental organisation (EU, UN, NATO, Council of Europe...)
  'Q484652',  // international organisation
  'Q7207745', // supranational organisation
  'Q1172599', // multinational organisation
  'Q1063239', // intergovernmental panel
  'Q245065',  // intergovernmental body
]);

const REJECTED_TYPES = new Set([
  'Q5','Q4830453','Q431289','Q476028','Q215380','Q11424',
]);

async function searchWikidata(q) {
  if (!q || q.length < 2) { targetSuggestions.value = []; return; }
  try {
    const lang = ui.lang || 'en';
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=${lang}&uselang=${lang}&limit=20&format=json&origin=*`;
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

const API_BASE = import.meta.env.VITE_API_URL || 'https://vozciudadanaapi-production.up.railway.app';
let sourceDebounce = null;

watch(() => form.fuente_url, (url) => {
  sourceResult.value  = null;
  fuenteStatus.value  = null;
  clearTimeout(sourceDebounce);
  if (!url || url.length < 10) return;
  sourceDebounce = setTimeout(() => validateSource(url), 800);
});

async function validateSource(url) {
  sourceChecking.value = true;
  sourceResult.value   = null;
  try {
    const res = await fetch(`${API_BASE}/api/source/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_url:  url,
        title:       form.title       || '',
        demands:     form.demands     || '',
        tipo_abuso:  form.tipo_abuso  || '',
        target_name: form.focal_point || '',
      }),
    });
    const data = await res.json();
    sourceResult.value = data;
    fuenteStatus.value = ['VERIFIED_SOURCE','RELEVANT_SOURCE','WEAK_SOURCE','PAYWALLED_SOURCE'].includes(data.source_validation_status)
      ? 'verified' : 'unknown';
  } catch {
    fuenteStatus.value = 'unknown';
  } finally {
    sourceChecking.value = false;
  }
}

function showTooltip(id) { tooltip.value = id; }
function hideTooltip() { tooltip.value = null; }

const COUNTRIES = [
  { code:'AF', en:'Afghanistan',        es:'Afganistán',      fr:'Afghanistan',        zh:'阿富汗' },
  { code:'DE', en:'Germany',            es:'Alemania',        fr:'Allemagne',          zh:'德国' },
  { code:'AR', en:'Argentina',          es:'Argentina',       fr:'Argentine',          zh:'阿根廷' },
  { code:'AU', en:'Australia',          es:'Australia',       fr:'Australie',          zh:'澳大利亚' },
  { code:'AT', en:'Austria',            es:'Austria',         fr:'Autriche',           zh:'奥地利' },
  { code:'BE', en:'Belgium',            es:'Bélgica',         fr:'Belgique',           zh:'比利时' },
  { code:'BO', en:'Bolivia',            es:'Bolivia',         fr:'Bolivie',            zh:'玻利维亚' },
  { code:'BR', en:'Brazil',             es:'Brasil',          fr:'Brésil',             zh:'巴西' },
  { code:'CA', en:'Canada',             es:'Canadá',          fr:'Canada',             zh:'加拿大' },
  { code:'CL', en:'Chile',              es:'Chile',           fr:'Chili',              zh:'智利' },
  { code:'CN', en:'China',              es:'China',           fr:'Chine',              zh:'中国' },
  { code:'CO', en:'Colombia',           es:'Colombia',        fr:'Colombie',           zh:'哥伦比亚' },
  { code:'KR', en:'South Korea',        es:'Corea del Sur',   fr:'Corée du Sud',       zh:'韩国' },
  { code:'CR', en:'Costa Rica',         es:'Costa Rica',      fr:'Costa Rica',         zh:'哥斯达黎加' },
  { code:'CU', en:'Cuba',               es:'Cuba',            fr:'Cuba',               zh:'古巴' },
  { code:'DK', en:'Denmark',            es:'Dinamarca',       fr:'Danemark',           zh:'丹麦' },
  { code:'EC', en:'Ecuador',            es:'Ecuador',         fr:'Équateur',           zh:'厄瓜多尔' },
  { code:'EG', en:'Egypt',              es:'Egipto',          fr:'Égypte',             zh:'埃及' },
  { code:'SV', en:'El Salvador',        es:'El Salvador',     fr:'Salvador',           zh:'萨尔瓦多' },
  { code:'AE', en:'UAE',                es:'Emiratos Árabes', fr:'Émirats arabes',     zh:'阿联酋' },
  { code:'SK', en:'Slovakia',           es:'Eslovaquia',      fr:'Slovaquie',          zh:'斯洛伐克' },
  { code:'SI', en:'Slovenia',           es:'Eslovenia',       fr:'Slovénie',           zh:'斯洛文尼亚' },
  { code:'ES', en:'Spain',              es:'España',          fr:'Espagne',            zh:'西班牙' },
  { code:'US', en:'United States',      es:'Estados Unidos',  fr:'États-Unis',         zh:'美国' },
  { code:'EE', en:'Estonia',            es:'Estonia',         fr:'Estonie',            zh:'爱沙尼亚' },
  { code:'ET', en:'Ethiopia',           es:'Etiopía',         fr:'Éthiopie',           zh:'埃塞俄比亚' },
  { code:'PH', en:'Philippines',        es:'Filipinas',       fr:'Philippines',        zh:'菲律宾' },
  { code:'FI', en:'Finland',            es:'Finlandia',       fr:'Finlande',           zh:'芬兰' },
  { code:'FR', en:'France',             es:'Francia',         fr:'France',             zh:'法国' },
  { code:'GH', en:'Ghana',              es:'Ghana',           fr:'Ghana',              zh:'加纳' },
  { code:'GR', en:'Greece',             es:'Grecia',          fr:'Grèce',              zh:'希腊' },
  { code:'GT', en:'Guatemala',          es:'Guatemala',       fr:'Guatemala',          zh:'危地马拉' },
  { code:'HN', en:'Honduras',           es:'Honduras',        fr:'Honduras',           zh:'洪都拉斯' },
  { code:'HU', en:'Hungary',            es:'Hungría',         fr:'Hongrie',            zh:'匈牙利' },
  { code:'IN', en:'India',              es:'India',           fr:'Inde',               zh:'印度' },
  { code:'ID', en:'Indonesia',          es:'Indonesia',       fr:'Indonésie',          zh:'印度尼西亚' },
  { code:'IQ', en:'Iraq',               es:'Irak',            fr:'Irak',               zh:'伊拉克' },
  { code:'IR', en:'Iran',               es:'Irán',            fr:'Iran',               zh:'伊朗' },
  { code:'IE', en:'Ireland',            es:'Irlanda',         fr:'Irlande',            zh:'爱尔兰' },
  { code:'IL', en:'Israel',             es:'Israel',          fr:'Israël',             zh:'以色列' },
  { code:'IT', en:'Italy',              es:'Italia',          fr:'Italie',             zh:'意大利' },
  { code:'JP', en:'Japan',              es:'Japón',           fr:'Japon',              zh:'日本' },
  { code:'JO', en:'Jordan',             es:'Jordania',        fr:'Jordanie',           zh:'约旦' },
  { code:'KZ', en:'Kazakhstan',         es:'Kazajistán',      fr:'Kazakhstan',         zh:'哈萨克斯坦' },
  { code:'KE', en:'Kenya',              es:'Kenia',           fr:'Kenya',              zh:'肯尼亚' },
  { code:'LV', en:'Latvia',             es:'Letonia',         fr:'Lettonie',           zh:'拉脱维亚' },
  { code:'LB', en:'Lebanon',            es:'Líbano',          fr:'Liban',              zh:'黎巴嫩' },
  { code:'LT', en:'Lithuania',          es:'Lituania',        fr:'Lituanie',           zh:'立陶宛' },
  { code:'LU', en:'Luxembourg',         es:'Luxemburgo',      fr:'Luxembourg',         zh:'卢森堡' },
  { code:'MX', en:'Mexico',             es:'México',          fr:'Mexique',            zh:'墨西哥' },
  { code:'MA', en:'Morocco',            es:'Marruecos',       fr:'Maroc',              zh:'摩洛哥' },
  { code:'MT', en:'Malta',              es:'Malta',           fr:'Malte',              zh:'马耳他' },
  { code:'NL', en:'Netherlands',        es:'Países Bajos',    fr:'Pays-Bas',           zh:'荷兰' },
  { code:'NG', en:'Nigeria',            es:'Nigeria',         fr:'Nigéria',            zh:'尼日利亚' },
  { code:'NO', en:'Norway',             es:'Noruega',         fr:'Norvège',            zh:'挪威' },
  { code:'NZ', en:'New Zealand',        es:'Nueva Zelanda',   fr:'Nouvelle-Zélande',   zh:'新西兰' },
  { code:'PK', en:'Pakistan',           es:'Pakistán',        fr:'Pakistan',           zh:'巴基斯坦' },
  { code:'PA', en:'Panama',             es:'Panamá',          fr:'Panama',             zh:'巴拿马' },
  { code:'PY', en:'Paraguay',           es:'Paraguay',        fr:'Paraguay',           zh:'巴拉圭' },
  { code:'PE', en:'Peru',               es:'Perú',            fr:'Pérou',              zh:'秘鲁' },
  { code:'PL', en:'Poland',             es:'Polonia',         fr:'Pologne',            zh:'波兰' },
  { code:'PT', en:'Portugal',           es:'Portugal',        fr:'Portugal',           zh:'葡萄牙' },
  { code:'GB', en:'United Kingdom',     es:'Reino Unido',     fr:'Royaume-Uni',        zh:'英国' },
  { code:'CZ', en:'Czech Republic',     es:'República Checa', fr:'République tchèque', zh:'捷克' },
  { code:'DO', en:'Dominican Republic', es:'Rep. Dominicana', fr:'Rép. dominicaine',   zh:'多米尼加' },
  { code:'RO', en:'Romania',            es:'Rumanía',         fr:'Roumanie',           zh:'罗马尼亚' },
  { code:'RU', en:'Russia',             es:'Rusia',           fr:'Russie',             zh:'俄罗斯' },
  { code:'SA', en:'Saudi Arabia',       es:'Arabia Saudí',    fr:'Arabie saoudite',    zh:'沙特阿拉伯' },
  { code:'SN', en:'Senegal',            es:'Senegal',         fr:'Sénégal',            zh:'塞内加尔' },
  { code:'RS', en:'Serbia',             es:'Serbia',          fr:'Serbie',             zh:'塞尔维亚' },
  { code:'ZA', en:'South Africa',       es:'Sudáfrica',       fr:'Afrique du Sud',     zh:'南非' },
  { code:'SE', en:'Sweden',             es:'Suecia',          fr:'Suède',              zh:'瑞典' },
  { code:'CH', en:'Switzerland',        es:'Suiza',           fr:'Suisse',             zh:'瑞士' },
  { code:'TH', en:'Thailand',           es:'Tailandia',       fr:'Thaïlande',          zh:'泰国' },
  { code:'TW', en:'Taiwan',             es:'Taiwán',          fr:'Taïwan',             zh:'台湾' },
  { code:'TZ', en:'Tanzania',           es:'Tanzania',        fr:'Tanzanie',           zh:'坦桑尼亚' },
  { code:'TR', en:'Turkey',             es:'Turquía',         fr:'Turquie',            zh:'土耳其' },
  { code:'UA', en:'Ukraine',            es:'Ucrania',         fr:'Ukraine',            zh:'乌克兰' },
  { code:'UG', en:'Uganda',             es:'Uganda',          fr:'Ouganda',            zh:'乌干达' },
  { code:'UY', en:'Uruguay',            es:'Uruguay',         fr:'Uruguay',            zh:'乌拉圭' },
  { code:'VE', en:'Venezuela',          es:'Venezuela',       fr:'Venezuela',          zh:'委内瑞拉' },
  { code:'VN', en:'Vietnam',            es:'Vietnam',         fr:'Viêt Nam',           zh:'越南' },
];

const endsAt = computed(() => {
  if (!form.starts_at) return null;
  const start = new Date(form.starts_at + 'T08:00:00.000Z');
  const end = new Date(start.getTime() + form.duration_h * 3_600_000);
  return end.toLocaleString(locale.value || 'en', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
});

const sortedCountries = computed(() => {
  const lang = (locale.value || 'en').substring(0, 2);
  const key = ['es','fr','zh'].includes(lang) ? lang : 'en';
  return [...COUNTRIES]
    .map(c => ({ code: c.code, name: c[key] }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

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
  if (targetStatus.value === 'REJECTED') { ui.showToast(t('create.errTargetRejected')); return; }
  if (targetStatus.value === 'CHECKING') { ui.showToast(t('create.errTargetChecking')); return; }
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
  router.push('/');
  setTimeout(() => {
    ui.showToast(t('create.createdSaldo'));
  }, 800);
}
</script>
