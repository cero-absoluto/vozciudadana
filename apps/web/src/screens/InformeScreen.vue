<template>
  <div class="screen active" id="s-informe">
    <div class="scroll inf-scroll">

      <!-- Cargando -->
      <div v-if="loading" style="text-align:center;padding:60px">
        <div class="spin-ring" style="margin:0 auto 16px"></div>
        <div style="font-size:16px;color:var(--text2)">{{ $t('informe.loading') }}</div>
      </div>

      <!-- Error -->
      <div v-else-if="error" style="text-align:center;padding:60px;color:var(--accent3);font-size:16px">
        {{ $t('informe.notFound') }}
      </div>

      <!-- ══════════════════════════════════════════════
           INFORME
      ══════════════════════════════════════════════ -->
      <div v-else-if="data">

        <!-- CABECERA — etiqueta -->
        <div class="inf-label">{{ $t('informe.headerLabel') }}</div>

        <!-- ① A QUIÉN VA DIRIGIDO -->
        <div class="inf-block inf-block-highlight">
          <div class="inf-block-title">{{ $t('detail.directedAt') }}</div>
          <div class="inf-focal">{{ data.protest.focal_point || '—' }}</div>
          <div v-if="data.protest.country" class="inf-focal-sub">{{ localizedCountryName }}</div>
        </div>

        <!-- ② CONVOCATORIA COMPLETA -->
        <div class="inf-block">
          <div class="inf-block-title">{{ $t('informe.headerLabel') }}</div>

          <div class="inf-title">{{ data.protest.title }}</div>

          <div v-if="data.protest.description" class="inf-field">
            <span class="inf-field-label">Descripción</span>
            <span class="inf-field-val">{{ data.protest.description }}</span>
          </div>

          <div class="inf-field">
            <span class="inf-field-label">{{ $t('detail.demandsTitle') }}</span>
            <span class="inf-field-val inf-demands">{{ data.protest.demands }}</span>
          </div>

          <div class="inf-field">
            <span class="inf-field-label">{{ $t('detail.typeOfAbuse') }}</span>
            <span class="inf-field-val" style="color:var(--accent4);font-weight:600">{{ tipoAbusoLabel }}</span>
          </div>

          <div v-if="data.protest.fuente_url" class="inf-field">
            <span class="inf-field-label">{{ $t('informe.fuente') }}</span>
            <a :href="data.protest.fuente_url" target="_blank" class="inf-link">{{ data.protest.fuente_url }}</a>
          </div>

          <div class="inf-dates">
            <div class="inf-date-item">
              <span class="inf-field-label">Inicio</span>
              <span class="inf-field-val">{{ formatDate(data.protest.starts_at) }}</span>
            </div>
            <div class="inf-date-sep">→</div>
            <div class="inf-date-item">
              <span class="inf-field-label">Cierre</span>
              <span class="inf-field-val">{{ formatDate(data.protest.ends_at) }}</span>
            </div>
          </div>
        </div>

        <!-- ③ TITULAR POLÍTICO -->
        <div class="inf-block inf-block-headline">
          <div class="inf-block-title">{{ $t('informe.headlineBlock') }}</div>
          <div class="inf-headline-text">
            {{ $t('informe.headline', {
              count: data.total_adhesiones,
              country: localizedCountryName,
              focal: data.protest.focal_point,
              demands: data.protest.demands
            }) }}
          </div>
        </div>

        <!-- ④ LOS NÚMEROS — adhesiones, ciudades, verificadas -->
        <div class="inf-block">
          <div class="inf-block-title">{{ $t('informe.numbersTitle') }}</div>
          <div class="inf-stats-row">
            <div class="inf-sc">
              <div class="inf-sc-n" style="color:var(--accent)">{{ data.total_adhesiones }}</div>
              <div class="inf-sc-l">{{ $t('informe.statAdhesiones') }}</div>
            </div>
            <div class="inf-sc">
              <div class="inf-sc-n" style="color:var(--accent2)">{{ data.ciudades_distintas }}</div>
              <div class="inf-sc-l">{{ $t('informe.statCiudades') }}</div>
            </div>
            <div class="inf-sc">
              <div class="inf-sc-n" style="color:var(--accent4)">100%</div>
              <div class="inf-sc-l">{{ $t('informe.statVerificadas') }}</div>
            </div>
            <div class="inf-sc">
              <div class="inf-sc-n" style="color:var(--text2)">{{ data.paises_distintos }}</div>
              <div class="inf-sc-l">{{ data.paises_distintos === 1 ? $t('informe.pais') : $t('informe.paises') }}</div>
            </div>
            <div class="inf-sc">
              <div class="inf-sc-n" style="color:var(--text2)">{{ data.idiomas_distintos }}</div>
              <div class="inf-sc-l">{{ data.idiomas_distintos === 1 ? $t('informe.idioma') : $t('informe.idiomas') }}</div>
            </div>
            <div class="inf-sc">
              <div class="inf-sc-n" style="color:var(--accent2)">{{ data.adhesiones_con_gps }}</div>
              <div class="inf-sc-l">GPS ✅</div>
            </div>
          </div>
          <div class="inf-time-row" v-if="data.primera_adhesion || data.ultima_adhesion">
            <span>· {{ $t('informe.firstAdhesion') }} {{ formatDateTime(data.primera_adhesion) }}</span>
            <span>· {{ $t('informe.lastAdhesion') }} {{ formatDateTime(data.ultima_adhesion) }}</span>
          </div>
        </div>

        <!-- ⑤ DISTRIBUCIÓN GEOGRÁFICA -->
        <div class="inf-block">
          <div class="inf-block-title">{{ $t('informe.geoTitle') }}</div>
          <div v-if="hasGeoData">
            <div v-if="Object.keys(data.distribucion_regiones).length" style="margin-bottom:12px">
              <div class="inf-section-label">{{ $t('informe.geoByRegion') }}</div>
              <div class="inf-geo-list">
                <span v-for="(count, region) in data.distribucion_regiones" :key="region" class="inf-geo-item">
                  {{ region }}: <strong>{{ count }}</strong>
                </span>
              </div>
            </div>
            <div v-if="data.distribucion_ciudades.length">
              <div class="inf-section-label">{{ $t('informe.geoByCity') }}</div>
              <div class="inf-geo-list">
                <span v-for="ciudad in data.distribucion_ciudades.slice(0,15)" :key="ciudad" class="inf-geo-item">{{ ciudad }}</span>
                <span v-if="data.distribucion_ciudades.length > 15" class="inf-geo-item" style="color:var(--text2)">
                  +{{ data.distribucion_ciudades.length - 15 }} {{ $t('informe.moreCities', { n: '' }).replace('  ','') }}
                </span>
              </div>
            </div>
          </div>
          <div v-else class="inf-empty">Sin datos geográficos disponibles</div>
        </div>

        <!-- ⑥ DESGLOSE LOCAL (solo local/regional) -->
        <div v-if="data.desglose_geografico_local" class="inf-block">
          <div class="inf-block-title">📍 {{ $t('informe.geoLocalTitle') }}</div>
          <div class="inf-section-label" style="margin-bottom:14px">
            {{ data.desglose_geografico_local.scope === 'regional'
              ? $t('informe.geoRegionalSubtitle', { region: data.desglose_geografico_local.municipio })
              : $t('informe.geoLocalSubtitle', { municipio: data.desglose_geografico_local.municipio }) }}
          </div>
          <div class="inf-geo-bar-row">
            <div class="inf-geo-bar-label">
              <span style="color:var(--accent2)">📍 {{ $t('informe.geoLocalVerified') }}</span>
              <strong>{{ data.desglose_geografico_local.gps_local }}</strong>
            </div>
            <div class="inf-bar-track"><div class="inf-bar-fill" :style="barStyleLocal(data.desglose_geografico_local.gps_local, 'var(--accent2)')"></div></div>
          </div>
          <div class="inf-geo-bar-row">
            <div class="inf-geo-bar-label">
              <span style="color:var(--accent4)">🌐 {{ $t('informe.geoNational') }}</span>
              <strong>{{ data.desglose_geografico_local.nacionales_sin_gps }}</strong>
            </div>
            <div class="inf-bar-track"><div class="inf-bar-fill" :style="barStyleLocal(data.desglose_geografico_local.nacionales_sin_gps, 'var(--accent4)')"></div></div>
          </div>
          <div v-if="data.desglose_geografico_local.internacionales > 0" class="inf-geo-bar-row">
            <div class="inf-geo-bar-label">
              <span style="color:var(--accent)">🌍 {{ $t('informe.geoInternational') }}</span>
              <strong>{{ data.desglose_geografico_local.internacionales }}</strong>
            </div>
            <div class="inf-bar-track"><div class="inf-bar-fill" :style="barStyleLocal(data.desglose_geografico_local.internacionales, 'var(--accent)')"></div></div>
          </div>
        </div>

        <!-- ⑦ CALIDAD DE VERIFICACIÓN -->
        <div class="inf-block">
          <div class="inf-block-title">{{ $t('informe.fiabilidadTitle') }}</div>

          <!-- GPS -->
          <div class="inf-gps-row">
            <div class="inf-gps-cell" style="border-color:rgba(76,255,164,.2);background:rgba(76,255,164,.05)">
              <div class="inf-gps-n" style="color:var(--accent2)">{{ data.adhesiones_con_gps }}</div>
              <div class="inf-gps-l">{{ $t('informe.gpsVerified') }}</div>
            </div>
            <div class="inf-gps-cell" style="border-color:var(--border)">
              <div class="inf-gps-n" style="color:var(--accent)">{{ data.adhesiones_sin_gps }}</div>
              <div class="inf-gps-l">{{ $t('informe.gpsSim') }}</div>
            </div>
          </div>
          <div class="inf-note" style="margin-bottom:16px">{{ $t('informe.gpsNote') }}</div>

          <!-- Bandas de fiabilidad -->
          <div v-if="data.desglose_fiabilidad" style="display:flex;flex-direction:column;gap:14px">
            <div v-if="data.desglose_fiabilidad.alta.count > 0">
              <div class="inf-rel-header">
                <span style="color:var(--accent2);font-weight:600">{{ $t('informe.fiabilidadAlta') }}</span>
                <span class="inf-rel-count">{{ data.desglose_fiabilidad.alta.count }} {{ $t('informe.ciudadanos') }}</span>
              </div>
              <div class="inf-bar-track"><div class="inf-bar-fill" :style="{width:pct(data.desglose_fiabilidad.alta.count)+'%',background:'var(--accent2)'}"></div></div>
              <div class="inf-note">{{ data.desglose_fiabilidad.alta.descripcion }}</div>
            </div>
            <div v-if="data.desglose_fiabilidad.media.count > 0">
              <div class="inf-rel-header">
                <span style="color:var(--accent4);font-weight:600">{{ $t('informe.fiabilidadMedia') }}</span>
                <span class="inf-rel-count">{{ data.desglose_fiabilidad.media.count }} {{ $t('informe.ciudadanos') }}</span>
              </div>
              <div class="inf-bar-track"><div class="inf-bar-fill" :style="{width:pct(data.desglose_fiabilidad.media.count)+'%',background:'var(--accent4)'}"></div></div>
              <div class="inf-note">{{ data.desglose_fiabilidad.media.descripcion }}</div>
            </div>
            <div v-if="data.desglose_fiabilidad.base.count > 0">
              <div class="inf-rel-header">
                <span style="color:var(--accent);font-weight:600">{{ $t('informe.fiabilidadBase') }}</span>
                <span class="inf-rel-count">{{ data.desglose_fiabilidad.base.count }} {{ $t('informe.ciudadanos') }}</span>
              </div>
              <div class="inf-bar-track"><div class="inf-bar-fill" :style="{width:pct(data.desglose_fiabilidad.base.count)+'%',background:'var(--accent)'}"></div></div>
              <div class="inf-note">{{ data.desglose_fiabilidad.base.descripcion }}</div>
            </div>
            <div v-if="data.desglose_fiabilidad.sin_dato.count > 0">
              <div class="inf-rel-header">
                <span style="color:var(--text2);font-weight:600">{{ $t('informe.fiabilidadSin') }}</span>
                <span class="inf-rel-count">{{ data.desglose_fiabilidad.sin_dato.count }} {{ $t('informe.ciudadanos') }}</span>
              </div>
              <div class="inf-note">{{ $t('informe.fiabilidadSinDesc') }}</div>
            </div>
          </div>
          <div v-else class="inf-empty">{{ $t('informe.fiabilidadNoData') }}</div>
        </div>

        <!-- ⑧ VELOCIDAD -->
        <div class="inf-block" v-if="data.velocidad">
          <div class="inf-block-title">{{ $t('informe.velocidadTitle') }}</div>
          <div class="inf-gps-row" style="margin-bottom:14px">
            <div class="inf-gps-cell">
              <div class="inf-gps-n" style="color:var(--accent2)">{{ data.velocidad.media_diaria }}</div>
              <div class="inf-gps-l">{{ $t('informe.velocidadMediaDiaria') }}</div>
            </div>
            <div v-if="data.velocidad.dia_pico" class="inf-gps-cell">
              <div class="inf-gps-n" style="color:var(--accent)">{{ data.velocidad.dia_pico.count }}</div>
              <div class="inf-gps-l">{{ $t('informe.velocidadPico') }} {{ formatDate(data.velocidad.dia_pico.fecha) }}</div>
            </div>
          </div>
          <div class="inf-note" style="margin-bottom:8px">{{ $t('informe.velocidadPorDia') }}</div>
          <div style="display:flex;align-items:flex-end;gap:3px;height:72px">
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

        <!-- ⑨ ÁMBITO DE LA EVIDENCIA -->
        <div v-if="data.evidential_scope" class="inf-block">
          <div class="inf-block-title">{{ $t('evidence.title') }}</div>

          <div style="margin-bottom:16px">
            <div class="inf-section-label">{{ $t('evidence.demonstratesTitle') }}</div>
            <ul class="inf-list inf-list-green">
              <li v-for="(it,i) in data.evidential_scope.demonstrates" :key="'d'+i">
                {{ $t('evidence.demonstrates.'+it.key, it.params || {}) }}
              </li>
            </ul>
          </div>

          <div v-if="data.evidential_scope.participation_rate" style="margin-bottom:16px;font-size:16px;color:var(--text)">
            {{ $t('evidence.participationRate', {
              count: data.evidential_scope.participation_rate.count,
              eligible: data.evidential_scope.participation_rate.eligible,
              rate: data.evidential_scope.participation_rate.rate }) }}
          </div>

          <div style="margin-bottom:16px">
            <div class="inf-section-label">{{ $t('evidence.outsideScopeTitle') }}</div>
            <ul class="inf-list inf-list-muted">
              <li v-for="(it,i) in data.evidential_scope.outside_scope" :key="'o'+i">
                {{ $t('evidence.not.'+it.key, it.params || {}) }}
              </li>
            </ul>
          </div>

          <div style="margin-bottom:16px">
            <div class="inf-section-label">{{ $t('evidence.methodsTitle') }}</div>
            <ul class="inf-list inf-list-muted">
              <li v-for="(it,i) in data.evidential_scope.methods" :key="'m'+i">
                {{ $t('evidence.methods.'+it.key, it.params || {}) }}
              </li>
            </ul>
          </div>

          <div v-if="data.evidential_scope.admission_rules && data.evidential_scope.admission_rules.length">
            <div class="inf-section-label">{{ $t('evidence.admissionTitle') }}</div>
            <ul class="inf-list inf-list-muted">
              <li v-for="(it,i) in data.evidential_scope.admission_rules" :key="'a'+i">
                {{ $t('evidence.admission.'+it.key, it.params || {}) }}
              </li>
            </ul>
          </div>
        </div>

        <!-- ⑩ CADENA DE VERIFICACIÓN -->
        <div class="inf-block">
          <div class="inf-block-title">{{ $t('informe.chainTitle') }}</div>
          <div class="inf-chain-steps">
            <div class="inf-chain-step">
              <div class="inf-chain-num">1</div>
              <div>
                <div class="inf-chain-title">reCAPTCHA v3</div>
                <div class="inf-note">Señal de humanidad — detección de bots antes de iniciar la verificación</div>
              </div>
            </div>
            <div class="inf-chain-step">
              <div class="inf-chain-num">2</div>
              <div>
                <div class="inf-chain-title">SMS / Email OTP</div>
                <div class="inf-note">Número de teléfono o email institucional real — una adhesión por número, por convocatoria</div>
              </div>
            </div>
            <div class="inf-chain-step">
              <div class="inf-chain-num">3</div>
              <div>
                <div class="inf-chain-title">HMAC-SHA256</div>
                <div class="inf-note">El número se transforma en un identificador pseudónimo irreversible. El original no se almacena</div>
              </div>
            </div>
            <div class="inf-chain-step">
              <div class="inf-chain-num">4</div>
              <div>
                <div class="inf-chain-title">Unicidad de dispositivo</div>
                <div class="inf-note">Un dispositivo por ámbito de protesta — previene la participación múltiple</div>
              </div>
            </div>
          </div>
        </div>

        <!-- ⑪ SELLO DE INTEGRIDAD -->
        <div class="inf-block" style="margin-bottom:28px">
          <div class="inf-block-title">{{ $t('informe.selloTitle') }}</div>

          <div v-if="data.protest.hash_integridad" class="inf-hash-box">
            <div class="inf-note" style="margin-bottom:8px">{{ $t('informe.selloHashLabel') }}</div>
            <div class="inf-hash">{{ data.protest.hash_integridad }}</div>
            <div class="inf-note" style="margin-top:10px;line-height:1.6">{{ $t('informe.selloDesc') }}</div>
          </div>
          <div v-else class="inf-pending-box">
            ⏳ {{ $t('informe.selloHashPending') }}
          </div>

          <!-- Verificador en app -->
          <div v-if="data.protest.hash_integridad" style="margin:14px 0">
            <button @click="verifyIntegrity" class="inf-verify-btn">
              🔍 {{ verifyState === 'running' ? $t('informe.verifyRunning') : $t('informe.verifyBtn') }}
            </button>
            <div v-if="verifyResult" class="inf-verify-result"
              :class="verifyResult === 'ok' ? 'inf-verify-ok' : verifyResult === 'v1' ? 'inf-verify-v1' : 'inf-verify-fail'">
              {{ verifyResult === 'ok' ? $t('informe.verifyOk') : verifyResult === 'v1' ? $t('informe.verifyV1') : $t('informe.verifyFail') }}
            </div>
          </div>

          <!-- Registro público v2 -->
          <div class="inf-ledger-box">
            <div class="inf-ledger-title">🔗 Registro público de integridad</div>
            <div class="inf-note" style="line-height:1.7">
              El sello actual (v1) es una prueba criptográfica interna: cualquier modificación posterior al cierre produce un hash diferente.
              <strong style="color:var(--text2)"> La verificación es confiable pero no completamente independiente</strong> —
              requiere confiar en que tanto el hash como los datos no han sido modificados simultáneamente en nuestra base de datos.<br><br>
              El <strong style="color:var(--accent)">registro público v2</strong> publicará el hash en un registro externo e independiente
              (timestamp certificado o ledger distribuido) en el momento del cierre, de forma que cualquier persona pueda verificarlo
              sin depender de Voice Protest. <em>Planificado — aún no implementado.</em>
            </div>
          </div>

          <!-- Metadatos -->
          <div class="inf-meta-grid">
            <div class="inf-meta-row">
              <span class="inf-meta-key">{{ $t('informe.selloSourceDesc') }}</span>
              <button onclick="window.open('https://github.com/cero-absoluto/vozciudadana','_blank')" class="inf-github-btn">
                {{ $t('informe.selloSourceBtn') }}
              </button>
            </div>
            <div class="inf-meta-row">
              <span class="inf-meta-key">{{ $t('informe.selloGenerated') }}</span>
              <span class="inf-meta-val">{{ formatDateTime(new Date().toISOString()) }}</span>
            </div>
            <div class="inf-meta-row">
              <span class="inf-meta-key">{{ $t('informe.selloId') }}</span>
              <span class="inf-meta-val inf-mono">{{ $route.params.id }}</span>
            </div>
          </div>
        </div>

        <!-- BOTONES -->
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px">
          <button class="btn-primary" style="flex:1;padding:12px" @click="$router.back()">{{ $t('informe.back') }}</button>
          <button class="btn-primary" style="flex:1;padding:12px;background:var(--accent2);color:#000" @click="downloadPDF">{{ $t('informe.downloadPdf') }}</button>
          <button class="btn-primary" style="flex:1;padding:12px;background:rgba(76,111,255,.2);border:.5px solid #4C6FFF;color:#4C6FFF" @click="showEmbed=true">{{ $t('informe.embedBtn') }}</button>
        </div>

        <!-- EMBED MODAL -->
        <div v-if="showEmbed" style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999;display:flex;align-items:center;justify-content:center;padding:24px" @click.self="showEmbed=false">
          <div style="background:#13111F;border:.5px solid rgba(255,255,255,.1);border-radius:16px;padding:24px;max-width:500px;width:100%">
            <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px">{{ $t('informe.embedTitle') }}</div>
            <div style="font-size:16px;color:var(--text2);margin-bottom:16px;line-height:1.7">{{ $t('informe.embedDesc') }}</div>
            <div style="background:#0C0B14;border:.5px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;font-family:monospace;font-size:14px;color:#4CFFA4;word-break:break-all;margin-bottom:14px;line-height:1.7">{{ embedCode }}</div>
            <div style="display:flex;gap:10px">
              <button class="btn-primary" style="flex:1;background:#4C6FFF" @click="copyEmbed">{{ copied ? $t('informe.embedCopied') : $t('informe.embedCopy') }}</button>
              <button class="btn-primary" style="flex:1;background:transparent;border:.5px solid var(--border2);color:var(--text2)" @click="showEmbed=false">{{ $t('informe.embedClose') }}</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Contenedor principal ─────────────────────────────────────────────── */
/* La clave: width+box-sizing garantizan que el padding no desborde.      */
/* overflow-x en el propio scroll corta cualquier hijo que se salga.      */
.inf-scroll {
  padding: 20px 16px;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  box-sizing: border-box;
  overflow-x: hidden;
}

/* Todos los bloques respetan el ancho del padre */
.inf-block {
  background: var(--bg2);
  border: .5px solid var(--border);
  border-radius: var(--r2);
  padding: 16px;
  margin-bottom: 14px;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
}
.inf-block-highlight { border-color: rgba(76,255,164,.3); background: rgba(76,255,164,.04); }
.inf-block-headline  { border-color: rgba(255,179,71,.25); background: rgba(255,179,71,.04); }
.inf-block-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text2); margin-bottom: 14px; }

/* ── Cabecera convocatoria ─────────────────────────────────────────────── */
.inf-focal     { font-family: 'Syne',sans-serif; font-size: 22px; font-weight: 800; color: var(--accent2); line-height: 1.25; word-break: break-word; }
.inf-focal-sub { font-size: 16px; color: var(--text2); margin-top: 4px; }
.inf-title     { font-family: 'Syne',sans-serif; font-size: 20px; font-weight: 800; line-height: 1.35; color: var(--text); margin-bottom: 16px; word-break: break-word; }
.inf-headline-text { font-size: 16px; font-weight: 600; line-height: 1.7; color: var(--text); word-break: break-word; }

.inf-field       { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; min-width: 0; }
.inf-field-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--text2); }
.inf-field-val   { font-size: 16px; color: var(--text); line-height: 1.65; word-break: break-word; }
.inf-demands     { color: var(--text); font-style: italic; }
.inf-link {
  font-size: 15px;
  color: var(--accent);
  text-decoration: underline;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-height: 1.6;
  display: block;
  max-width: 100%;
}

.inf-dates     { display: flex; align-items: center; gap: 10px; margin-top: 4px; flex-wrap: wrap; }
.inf-date-item { display: flex; flex-direction: column; gap: 3px; }
.inf-date-sep  { font-size: 16px; color: var(--text2); }

/* ── Estadísticas (grid) ──────────────────────────────────────────────── */
.inf-stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 14px; }
.inf-sc   { background: var(--bg3); border: .5px solid var(--border); border-radius: var(--r); padding: 12px 6px; text-align: center; min-width: 0; }
.inf-sc-n { font-family: 'Syne',sans-serif; font-size: 22px; font-weight: 800; line-height: 1; }
.inf-sc-l { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--text2); margin-top: 5px; }
.inf-time-row { display: flex; flex-direction: column; gap: 4px; font-size: 15px; color: var(--text2); }

/* ── Geografía ────────────────────────────────────────────────────────── */
.inf-section-label { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
.inf-geo-list { display: flex; flex-wrap: wrap; gap: 6px; }
.inf-geo-item { font-size: 14px; color: var(--text); background: var(--bg3); border: .5px solid var(--border); border-radius: 20px; padding: 3px 10px; }

.inf-geo-bar-row   { margin-bottom: 12px; }
.inf-geo-bar-label { display: flex; justify-content: space-between; align-items: center; font-size: 15px; margin-bottom: 6px; }
.inf-bar-track     { background: var(--bg4); border-radius: 6px; height: 10px; overflow: hidden; width: 100%; }
.inf-bar-fill      { height: 100%; border-radius: 6px; transition: width .5s; }

/* ── GPS / Fiabilidad ─────────────────────────────────────────────────── */
.inf-gps-row  { display: flex; gap: 8px; margin-bottom: 12px; }
.inf-gps-cell { flex: 1; min-width: 0; border: .5px solid var(--border); border-radius: var(--r); padding: 12px 6px; text-align: center; }
.inf-gps-n    { font-family: 'Syne',sans-serif; font-size: 26px; font-weight: 800; }
.inf-gps-l    { font-size: 14px; color: var(--text2); margin-top: 4px; }

.inf-rel-header { display: flex; justify-content: space-between; align-items: center; font-size: 15px; margin-bottom: 6px; flex-wrap: wrap; gap: 4px; }
.inf-rel-count  { color: var(--text); }

/* ── Listas de evidencia ──────────────────────────────────────────────── */
.inf-list        { margin: 0; padding-left: 18px; font-size: 16px; line-height: 1.85; }
.inf-list li     { margin-bottom: 4px; word-break: break-word; }
.inf-list-green  { color: var(--text); }
.inf-list-muted  { color: var(--text2); }

/* ── Cadena de verificación ──────────────────────────────────────────── */
.inf-chain-steps { display: flex; flex-direction: column; gap: 14px; }
.inf-chain-step  { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
.inf-chain-num   { min-width: 28px; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: #000; font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
.inf-chain-title { font-size: 16px; font-weight: 700; color: var(--text); margin-bottom: 2px; }

/* ── Sello de integridad ──────────────────────────────────────────────── */
.inf-hash-box {
  background: rgba(76,255,164,.05);
  border: .5px solid rgba(76,255,164,.25);
  border-radius: var(--r);
  padding: 14px;
  margin-bottom: 12px;
  overflow: hidden;
  width: 100%;
  box-sizing: border-box;
}
.inf-hash {
  font-family: monospace;
  font-size: 12px;
  color: var(--accent2);
  word-break: break-all;
  overflow-wrap: anywhere;
  line-height: 1.7;
  margin: 8px 0;
  width: 100%;
  display: block;
}
.inf-pending-box { background: var(--bg3); border: .5px solid var(--border); border-radius: var(--r); padding: 14px; font-size: 15px; color: var(--text2); margin-bottom: 12px; }

.inf-verify-btn    { width: 100%; padding: 10px; background: rgba(76,255,164,.08); border: .5px solid rgba(76,255,164,.3); border-radius: var(--r); color: var(--accent2); font-size: 15px; font-weight: 600; cursor: pointer; box-sizing: border-box; }
.inf-verify-result { margin-top: 10px; padding: 10px 12px; border-radius: var(--r); font-size: 15px; line-height: 1.6; }
.inf-verify-ok     { background: rgba(76,255,164,.08); border: .5px solid rgba(76,255,164,.3); }
.inf-verify-v1     { background: rgba(124,111,255,.08); border: .5px solid rgba(124,111,255,.3); }
.inf-verify-fail   { background: rgba(255,80,80,.08); border: .5px solid rgba(255,80,80,.3); }

.inf-ledger-box   { background: rgba(124,111,255,.06); border: .5px solid rgba(124,111,255,.25); border-radius: var(--r); padding: 14px; margin: 14px 0; }
.inf-ledger-title { font-size: 16px; font-weight: 700; color: var(--accent); margin-bottom: 8px; }

/* ── Metadatos finales ────────────────────────────────────────────────── */
.inf-meta-grid { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: .5px solid var(--border); }
.inf-meta-row  { display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; min-width: 0; }
.inf-meta-key  { font-size: 14px; color: var(--text2); min-width: 80px; flex-shrink: 0; }
.inf-meta-val  { font-size: 15px; color: var(--text); word-break: break-word; min-width: 0; flex: 1; }
.inf-mono {
  font-family: monospace;
  font-size: 12px;
  color: var(--accent2);
  word-break: break-all;
  overflow-wrap: anywhere;
  max-width: 100%;
  display: block;
}
.inf-github-btn { background: transparent; border: .5px solid var(--accent); border-radius: var(--r); padding: 6px 12px; color: var(--accent); cursor: pointer; font-size: 14px; }

.inf-note  { font-size: 15px; color: var(--text2); line-height: 1.7; margin-top: 6px; word-break: break-word; }
.inf-empty { font-size: 16px; color: var(--text2); }

/* ── Label global ─────────────────────────────────────────────────────── */
.inf-label { font-size: 12px; color: var(--text2); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px; }
</style>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import * as api from '@/services/api.js';
import { jsPDF } from 'jspdf';
import { localizedCountry } from '@/constants.js';

const route = useRoute();
const { t, locale } = useI18n({ useScope: 'global' });

// Mapa completo de los 16 tipos de abuso
const ABUSE_MAP = {
  corruption:         () => t('create.abusoCorrupcion'),
  influence_peddling: () => t('create.abusoInfluencias'),
  nepotism:           () => t('create.abusoNepotismo'),
  illicit_enrichment: () => t('create.abusoEnriquecimiento'),
  procurement:        () => t('create.abusoContratacion'),
  opacity:            () => t('create.abusoOpacidad'),
  info_access:        () => t('create.abusoAccesoInfo'),
  undue_delay:        () => t('create.abusoRetraso'),
  discrimination:     () => t('create.abusoDiscriminacion'),
  negligence:         () => t('create.abusoNegligencia'),
  legal_breach:       () => t('create.abusoIncumplimiento'),
  repression:         () => t('create.abusoRepresion'),
  rights_violation:   () => t('create.abusoDerechos'),
  excessive_force:    () => t('create.abusoFuerza'),
  surveillance:       () => t('create.abusoVigilancia'),
  other_public_abuse: () => t('create.abusoOtro'),
};

const tipoAbusoLabel = computed(() => {
  const tipo = data.value?.protest?.tipo_abuso;
  if (!tipo) return '—';
  return ABUSE_MAP[tipo]?.() || tipo;
});

const localizedCountryName = computed(() =>
  localizedCountry(data.value?.protest?.country, locale.value) || data.value?.protest?.country_name || '—'
);

const hasGeoData = computed(() => {
  if (!data.value) return false;
  return Object.keys(data.value.distribucion_regiones || {}).length > 0
    || (data.value.distribucion_ciudades || []).length > 0;
});

const data = ref(null);
const verifyState  = ref('idle');
const verifyResult = ref(null);

async function verifyIntegrity() {
  if (verifyState.value === 'running') return;
  verifyState.value  = 'running';
  verifyResult.value = null;
  try {
    const version = data.value?.protest?.integrity_version || 1;
    if (version < 2) { verifyResult.value = 'v1'; verifyState.value = 'idle'; return; }
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/public/protests/${route.params.id}/integrity-data`);
    if (!res.ok) throw new Error();
    const d = await res.json();
    const sorted = [...d.public_commitments].sort();
    const cities = Object.entries(d.city_distribution || {}).sort((a,b) => a[0].localeCompare(b[0])).map(([k,v]) => `${k}:${v}`).join(',');
    const rel = Object.entries(d.reliability_breakdown || {}).sort((a,b) => a[0] - b[0]).map(([k,v]) => `${k}:${v}`).join(',');
    const input = [d.protest_id, d.title, d.demands, d.scope, d.country, d.total_adhesions, d.cities_count, rel, cities, d.first_adhesion||'', d.last_adhesion||'', sorted.join('|')].join('|');
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
    verifyResult.value = hashHex === d.integrity_hash ? 'ok' : 'fail';
  } catch { verifyResult.value = 'fail'; }
  finally { verifyState.value = 'idle'; }
}

const loading = ref(true);
const error = ref(false);
const showEmbed = ref(false);
const copied = ref(false);

const embedCode = computed(() =>
  `<script src="https://www.voiceprotest.org/widget.js?id=${route.params.id}"><\/script>`
);

function copyEmbed() {
  navigator.clipboard.writeText(embedCode.value).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  });
}

onMounted(async () => {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/protests/${route.params.id}/informe`);
    if (!res.ok) throw new Error();
    data.value = await res.json();
  } catch { error.value = true; }
  finally { loading.value = false; }
});

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}
function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}
function pct(count) {
  if (!data.value?.total_adhesiones) return 0;
  return Math.round((count / data.value.total_adhesiones) * 100);
}
function pctLocal(count) {
  const total = data.value?.desglose_geografico_local?.total;
  if (!total) return 0;
  return Math.round((count / total) * 100);
}
function barStyleLocal(count, color) {
  return { width: pctLocal(count) + '%', background: color, height: '100%', borderRadius: '6px', transition: 'width .5s' };
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
  function nl(h = 7) { y += h; }
  function line() { doc.setDrawColor(76,255,164); doc.setLineWidth(0.3); doc.line(M, y, W-M, y); nl(6); }
  function h2(txt) { doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(76,255,164); doc.text(txt, M, y); nl(8); }
  function body(txt) { doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220,218,240); doc.splitTextToSize(txt, CW).forEach(l => { if (y > 265) { doc.addPage(); setPageBg(); y = 22; } doc.text(l, M, y); nl(7); }); }
  function kv(k, v) { doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(76,255,164); doc.text(k+':', M, y); doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(240,238,255); doc.text(doc.splitTextToSize(String(v), CW-48)[0], M+48, y); nl(7); }
  function setPageBg() { doc.setFillColor(12,11,20); doc.rect(0,0,210,297,'F'); }

  setPageBg(); y = 20;
  doc.setFillColor(30,27,50); doc.rect(0,10,210,30,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(76,255,164); doc.text('VOICE PROTEST — INFORME PÚBLICO VERIFICADO', M, 18);
  doc.setFontSize(8); doc.setTextColor(180,178,200); doc.text('www.voiceprotest.org', M, 24);
  doc.setFontSize(8); doc.setTextColor(140,138,170); doc.text('Generado: ' + new Date().toISOString(), M, 30);
  y = 46;

  doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(255,255,255);
  doc.splitTextToSize(d.protest.title, CW).forEach(l => { doc.text(l, M, y); nl(8); });
  nl(2); line();

  h2('1. DESTINATARIO');
  kv('Institución', d.protest.focal_point || '—');
  kv('País', d.protest.country_name || '—');
  nl(2); line();

  h2('2. CONVOCATORIA');
  kv('Inicio', d.protest.starts_at ? new Date(d.protest.starts_at).toLocaleDateString('es-ES') : '—');
  kv('Cierre', d.protest.ends_at ? new Date(d.protest.ends_at).toLocaleDateString('es-ES') : '—');
  kv('Tipo de abuso', tipoAbusoLabel.value);
  if (d.protest.fuente_url) kv('Fuente', d.protest.fuente_url);
  if (d.protest.demands) { nl(1); body('Demandas: ' + d.protest.demands); }
  nl(2); line();

  h2('3. RESULTADOS');
  kv('Adhesiones verificadas', d.total_adhesiones);
  kv('Ciudades distintas', d.ciudades_distintas);
  kv('Países distintos', d.paises_distintos);
  kv('Con GPS verificado', d.adhesiones_con_gps);
  kv('Solo SIM/IP', d.adhesiones_sin_gps);
  kv('Primera adhesión', d.primera_adhesion ? new Date(d.primera_adhesion).toLocaleString('es-ES') : '—');
  kv('Última adhesión', d.ultima_adhesion ? new Date(d.ultima_adhesion).toLocaleString('es-ES') : '—');
  nl(2); line();

  h2('4. DISTRIBUCIÓN GEOGRÁFICA');
  if (d.distribucion_regiones && Object.keys(d.distribucion_regiones).length) {
    body('Por región:');
    Object.entries(d.distribucion_regiones).forEach(([r,c]) => body('  ' + r + ': ' + c));
  }
  if (d.distribucion_ciudades?.length) body('Ciudades: ' + d.distribucion_ciudades.slice(0,15).join(' · '));
  nl(2); line();

  h2('5. CADENA DE VERIFICACIÓN');
  body('1. reCAPTCHA v3 — señal de humanidad');
  body('2. SMS/Email OTP — número real o email institucional, una adhesión por número');
  body('3. HMAC-SHA256 — el número se transforma en pseudónimo irreversible');
  body('4. Unicidad de dispositivo — un dispositivo por ámbito de protesta');
  nl(2); line();

  h2('6. SELLO DE INTEGRIDAD');
  kv('ID de convocatoria', route.params.id);
  kv('Código fuente', 'github.com/cero-absoluto/vozciudadana (AGPL 3.0)');
  kv('Generado', new Date().toISOString());
  if (d.protest.hash_integridad) {
    nl(1); body('Hash HMAC-SHA256 al cierre:');
    doc.setFont('courier','normal'); doc.setFontSize(9); doc.setTextColor(76,255,164);
    doc.splitTextToSize(d.protest.hash_integridad, CW).forEach(l => { doc.text(l, M, y); nl(4); });
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(20,18,35); doc.rect(0,285,210,12,'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(140,138,170);
    doc.text('Voice Protest — Plataforma de protesta ciudadana verificada — AGPL 3.0', M, 291);
    doc.text('Página ' + i + ' de ' + totalPages, W-M, 291, {align:'right'});
  }

  doc.save('voiceprotest-informe-' + d.protest.title.replace(/[^a-z0-9]/gi,'-').toLowerCase().slice(0,40) + '.pdf');
}
</script>
