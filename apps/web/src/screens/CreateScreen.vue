<template>
  <div class="screen active" id="s-create">
    <div class="create-scroll">
      <div class="form-h">Nueva convocatoria</div>
      <div class="form-sub">Define el alcance geográfico. Es irreversible una vez publicada.</div>

      <div class="fg"><label>Título *</label>
        <input type="text" v-model="form.title" maxlength="120" placeholder="Ej: Contra la corrupción del gobierno">
        <div class="char-c">{{ form.title.length }}/120</div>
      </div>
      <div class="fg"><label>Descripción *</label>
        <textarea v-model="form.description" rows="3" maxlength="500" placeholder="Explica el motivo con hechos concretos."></textarea>
        <div class="char-c">{{ form.description.length }}/500</div>
      </div>
      <div class="fg"><label>Qué exigimos *</label>
        <textarea v-model="form.demands" rows="3" maxlength="300" placeholder="Ej: Que dimita el presidente · Que se retire la ley"></textarea>
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

      <!-- Scope selector -->
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
        <div v-if="form.scope === 'regional'" class="region-picker" style="display:block">
          <div class="rp-label">Selecciona el bloque regional</div>
          <div class="region-chips">
            <div v-for="[key, r] in Object.entries(REGIONS)" :key="key"
              class="rchip" :class="{on: form.region === key}"
              @click="form.region = key">
              {{ r.icon }} {{ r.name }}
            </div>
          </div>
        </div>
      </div>

      <div class="fg"><label>Duración</label>
        <select v-model="form.duration_h">
          <option value="2">2 horas (estándar)</option>
          <option value="6">6 horas</option>
          <option value="24">24 horas</option>
          <option value="48">48 horas (internacional)</option>
        </select>
      </div>
      <div class="fg"><label>Nivel de riesgo</label>
        <select v-model="form.risk_level">
          <option value="low">Bajo — democracia plena</option>
          <option value="med">Medio — restricciones</option>
          <option value="high">Alto — régimen autoritario</option>
          <option value="critical">Crítico — represión activa</option>
        </select>
      </div>
      <div v-if="form.risk_level === 'high' || form.risk_level === 'critical'" class="risk-warn" style="display:flex">
        ⚠️ Se activará Tor + cifrado adicional automáticamente.
      </div>

      <div class="mod-box">
        <div class="mod-h">⚖️ Proceso de moderación independiente</div>
        <div class="mod-steps">
          <div class="mstep"><div class="mn">1</div>Panel de ciudadanos voluntarios sin afiliación política</div>
          <div class="mstep"><div class="mn">2</div>Verificación: sin incitación al odio ni datos falsos</div>
          <div class="mstep"><div class="mn">3</div>Si se aprueba, entra en cola de impulso de su país</div>
          <div class="mstep"><div class="mn">4</div>La ciudadanía impulsa. La más impulsada sube al mapa.</div>
        </div>
      </div>

      <button class="btn-primary" style="width:100%;margin-bottom:18px" @click="submit">Crear convocatoria (modo demo) →</button>
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

const form = reactive({
  title: '', description: '', demands: '', focal_point: '',
  category: 'corruption', scope: 'national', region: null,
  duration_h: '2', risk_level: 'low',
});

const scopes = [
  { key:'national', icon:'🏛️', label:'Nacional', badgeClass:'sb-national', badgeLabel:'Solo ciudadanos del país', bg:'rgba(124,111,255,.08)', desc:'Solo participan dispositivos cuya SIM + IP correspondan al país de la convocatoria.' },
  { key:'regional', icon:'🌐', label:'Regional',  badgeClass:'sb-regional', badgeLabel:'Bloque definido',          bg:'rgba(255,179,71,.08)',   desc:'Abierto a todos los países miembros del bloque. Ej: UE, MERCOSUR, ASEAN.' },
  { key:'global',   icon:'🌍', label:'Global',    badgeClass:'sb-global',   badgeLabel:'Cualquier ciudadano',      bg:'rgba(76,255,164,.08)',   desc:'Sin restricción geográfica.' },
];

function selectScope(s) {
  form.scope = s;
  form.region = null;
}

function submit() {
  if (!form.title.trim())       { ui.showToast('El título es obligatorio'); return; }
  if (!form.description.trim()) { ui.showToast('La descripción es obligatoria'); return; }
  if (!form.demands.trim())     { ui.showToast('Indica qué exigís'); return; }
  if (!form.focal_point.trim()) { ui.showToast('El punto focal es obligatorio'); return; }
  if (form.scope === 'regional' && !form.region) { ui.showToast('Selecciona el bloque regional'); return; }
const confirmMsg = `¿Confirmas que quieres publicar esta convocatoria?\n\n"${form.title}"\n\nUna vez publicada no podrá editarse ni eliminarse.`;
  if (!window.confirm(confirmMsg)) return;
  protests.createProtest({ ...form });
  ui.showToast('✓ Convocatoria creada — ya aparece en el mapa');
  router.push('/');
}
</script>
