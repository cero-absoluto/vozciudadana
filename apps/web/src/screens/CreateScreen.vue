<template>
  <div class="screen active" id="s-create">
    <div class="create-scroll">
  <!-- COLUMNA IZQUIERDA -->
  <div>
        <div class="fg"><label>Título *</label>
      <input type="text" v-model="form.title" maxlength="120" placeholder="Ej: Contra la corrupción del gobierno">
      <div class="char-c">{{ form.title.length }}/120</div>
    </div>
    <div class="fg"><label>Descripción *</label>
      <textarea v-model="form.description" rows="2" maxlength="500" placeholder="Explica el motivo con hechos concretos."></textarea>
      <div class="char-c">{{ form.description.length }}/500</div>
    </div>
    <div class="fg"><label>Qué exigimos *</label>
      <textarea v-model="form.demands" rows="2" maxlength="300" placeholder="Ej: Que dimita el presidente · Que se retire la ley"></textarea>
      <div class="char-c">{{ form.demands.length }}/300</div>
    </div>
    <div class="fg"><label>Punto focal *</label>
      <input type="text" v-model="form.focal_point" placeholder="Ej: Congreso de los Diputados, Madrid">
    </div>
    <div class="fg"><label>Categoría</label>
      <select v-model="form.category">
        <option value="corruption">Corrupción</option>
        <option value="rights">Derechos humanos</option>
        <option value="political">Política y democracia</option>
        <option value="environment">Medio ambiente</option>
        <option value="social">Social y laboral</option>
      </select>
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
  <input type="text" v-model="form.dominio_email" placeholder="Ej: uu.nl, uab.cat, upf.edu">
  <div class="char-c" style="text-align:left;margin-top:4px;opacity:.6">Los participantes verificarán su pertenencia con su email institucional.</div>
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
      <div class="mod-h">⚖️ Proceso de moderación independiente</div>
      <div class="mod-steps">
        <div class="mstep"><div class="mn">1</div>Verificación automática de criterios objetivos</div>
        <div class="mstep"><div class="mn">2</div>Verificación: sin incitación al odio ni datos falsos</div>
        <div class="mstep"><div class="mn">3</div>Si se aprueba, entra en cola de impulso de su país</div>
        <div class="mstep"><div class="mn">4</div>La ciudadanía impulsa. La más impulsada sube al mapa.</div>
      </div>
    </div>
   
      <button class="btn-primary" style="width:100%;margin-bottom:18px" @click="submit">Crear convocatoria →</button>
  </div>
</div>
  </div>
</template>

<script setup>
import { reactive } from 'vue';
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
  category: 'corruption', scope: 'national', region: null,
  duration_h: 36, risk_level: 'low', starts_at: '',
  convocatoria_pais: '',
  convocatoria_region: '',
  convocatoria_institucion: '',
  dominio_email: '',
});

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
const confirmMsg = `¿Confirmas que quieres publicar esta convocatoria?\n\n"${form.title}"\n\nUna vez publicada no podrá editarse ni eliminarse.`;
  if (!window.confirm(confirmMsg)) return;
  protests.createProtest({
  ...form,
  starts_at: form.starts_at ? form.starts_at + 'T08:00:00.000Z' : null,
  convocatoria_pais: form.convocatoria_pais || null,
  convocatoria_region: form.convocatoria_region || null,
  convocatoria_institucion: form.convocatoria_institucion || null,
  dominio_email: form.dominio_email || null,
});
  ui.showToast('✓ Convocatoria creada — ya aparece en el mapa');
  router.push('/');
}
</script>
