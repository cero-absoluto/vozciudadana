<template>
  <div class="screen active" id="s-informe">
    <div class="scroll ir-scroll">

      <!-- Cargando -->
      <div v-if="loading" style="text-align:center;padding:80px 0">
        <div class="spin-ring" style="margin:0 auto 16px"></div>
        <div class="ir-caption">{{ $t('informe.loading') }}</div>
      </div>

      <!-- Error -->
      <div v-else-if="notFound" style="text-align:center;padding:80px 0;color:var(--accent3)">
        {{ $t('informe.notFound') }}
      </div>

      <div v-else-if="error" role="alert" style="text-align:center;padding:80px 0;color:var(--accent3)">
        <div style="margin-bottom:16px">{{ $t('informe.loadError') }}</div>
        <button type="button" class="btn-primary" @click="loadReport">{{ $t('informe.retry') }}</button>
      </div>

      <div v-else-if="data" class="ir-doc">

        <!-- ══ CABECERA DEL DOCUMENTO ══════════════════════════════════ -->
        <div class="ir-header">
          <div class="ir-header-meta">
            <span class="ir-badge">Voice Protest</span>
            <span class="ir-badge ir-badge-status">
              {{ data.protest.status === 'closed' ? '● ' + $t('informe.statusClosed') : '● ' + $t('informe.statusActive') }}
            </span>
          </div>
          <h1 class="ir-title">{{ data.protest.title }}</h1>
          <div class="ir-directed">
            <span class="ir-caption">{{ $t('detail.directedAt') }}</span>
            <span class="ir-institution">{{ data.protest.focal_point }}</span>
            <span class="ir-country" v-if="data.protest.country">{{ localizedCountryName }}</span>
          </div>
          <div class="ir-dates-row">
            <span class="ir-caption">{{ formatDate(data.protest.starts_at) }}</span>
            <span class="ir-dates-sep">→</span>
            <span class="ir-caption">{{ formatDate(data.protest.ends_at) }}</span>
          </div>
        </div>

        <!-- ══ NÚMERO PRINCIPAL ════════════════════════════════════════ -->
        <div class="ir-hero">
          <!-- Local/Regional: GPS territorial es el dato principal -->
          <template v-if="(data.protest.scope === 'local' || data.protest.scope === 'regional') && data.desglose_geografico_local">
            <div class="ir-hero-n">{{ data.desglose_geografico_local.gps_local }}</div>
            <div class="ir-hero-label">
              {{ data.protest.scope === 'local' ? $t('informe.heroLabelLocal', { territorio: data.protest.convocatoria_ciudad_nombre }) : $t('informe.heroLabelRegional', { territorio: data.protest.convocatoria_ciudad_nombre }) }}
            </div>
            <div class="ir-hero-sub" v-if="data.desglose_geografico_local.total > data.desglose_geografico_local.gps_local">
              {{ $t('informe.heroSubLocal', { total: data.desglose_geografico_local.total, nacional: data.desglose_geografico_local.nacionales_sin_gps }) }}
            </div>
          </template>

          <!-- Institucional -->
          <template v-else-if="data.protest.dominio_email">
            <div class="ir-hero-n">{{ data.total_adhesiones }}</div>
            <div class="ir-hero-label">{{ $t('informe.heroLabelInstitutional', { dominio: data.protest.dominio_email }) }}</div>
          </template>

          <!-- Nacional / Global -->
          <template v-else>
            <div class="ir-hero-n">{{ data.total_adhesiones }}</div>
            <div class="ir-hero-label">{{ $t('informe.heroLabel', { country: localizedCountryName }) }}</div>
          </template>

          <p class="ir-limits">{{ $t('informe.limitsNote') }}</p>

          <div class="ir-hero-demand">{{ data.protest.demands }}</div>
        </div>

        <p v-if="data.report_coverage && !data.report_coverage.counter_matches" class="ir-caption" role="status">{{ $t('informe.geoCounterMismatch', { analyzed: data.report_coverage.analyzed, total: data.report_coverage.counter_total }) }}</p>

        <div class="ir-divider"></div>

        <!-- ══ SOBRE LA CONVOCATORIA ═══════════════════════════════════ -->
        <section class="ir-section">
          <h2 class="ir-section-title">{{ $t('informe.sectionConvocatoria') }}</h2>

          <div v-if="data.protest.description" class="ir-prose">{{ data.protest.description }}</div>

          <div class="ir-field">
            <span class="ir-field-label">{{ $t('detail.demandsTitle') }}</span>
            <span class="ir-field-val ir-demands">{{ data.protest.demands }}</span>
          </div>

          <div class="ir-field">
            <span class="ir-field-label">{{ $t('detail.typeOfAbuse') }}</span>
            <span class="ir-field-val" style="color:var(--accent4)">{{ tipoAbusoLabel }}</span>
          </div>

          <div v-if="safeSourceUrl" class="ir-field">
            <span class="ir-field-label">{{ $t('informe.fuente') }}</span>
            <a :href="safeSourceUrl" target="_blank" rel="noopener noreferrer nofollow" class="ir-link">{{ data.protest.fuente_url }}</a>
          </div>
        </section>

        <div class="ir-divider"></div>

        <!-- ══ EVIDENCIA GEOGRÁFICA ════════════════════════════════════ -->
        <section class="ir-section">
          <h2 class="ir-section-title">{{ $t('informe.sectionGeo') }}</h2>

          <!-- Desglose local/regional -->
          <div v-if="data.desglose_geografico_local" class="ir-geo-breakdown">
            <div class="ir-geo-row">
              <div class="ir-geo-label">
                <span class="ir-geo-dot" style="background:var(--accent2)"></span>
                {{ data.desglose_geografico_local.scope === 'regional' ? $t('informe.geoRegionalVerified') : $t('informe.geoLocalVerified') }}
              </div>
              <div class="ir-geo-count" style="color:var(--accent2)">{{ data.desglose_geografico_local.gps_local }}</div>
            </div>
            <div class="ir-geo-bar-bg">
              <div class="ir-geo-bar-fill" :style="{width: pctLocal(data.desglose_geografico_local.gps_local) + '%', background: 'var(--accent2)'}"></div>
            </div>

            <div v-if="data.desglose_geografico_local.nacionales_sin_gps > 0" class="ir-geo-row" style="margin-top:12px">
              <div class="ir-geo-label">
                <span class="ir-geo-dot" style="background:var(--accent4)"></span>
                {{ $t('informe.geoNational') }}
              </div>
              <div class="ir-geo-count" style="color:var(--accent4)">{{ data.desglose_geografico_local.nacionales_sin_gps }}</div>
            </div>
            <div v-if="data.desglose_geografico_local.nacionales_sin_gps > 0" class="ir-geo-bar-bg">
              <div class="ir-geo-bar-fill" :style="{width: pctLocal(data.desglose_geografico_local.nacionales_sin_gps) + '%', background: 'var(--accent4)'}"></div>
            </div>

            <div v-if="data.desglose_geografico_local.internacionales > 0" class="ir-geo-row" style="margin-top:12px">
              <div class="ir-geo-label">
                <span class="ir-geo-dot" style="background:var(--accent)"></span>
                {{ $t('informe.geoInternational') }}
              </div>
              <div class="ir-geo-count" style="color:var(--accent)">{{ data.desglose_geografico_local.internacionales }}</div>
            </div>
            <div v-if="data.desglose_geografico_local.internacionales > 0" class="ir-geo-bar-bg">
              <div class="ir-geo-bar-fill" :style="{width: pctLocal(data.desglose_geografico_local.internacionales) + '%', background: 'var(--accent)'}"></div>
            </div>
          </div>

          <div v-if="data.desglose_geografico_local" class="ir-geo-breakdown">
            <template v-for="key in ['gps_nacional', 'sin_pais']" :key="key">
              <div class="ir-geo-row" style="margin-top:12px">
                <div class="ir-geo-label">{{ $t('informe.' + (key === 'sin_pais' ? 'geoUnknown' : 'geoOtherGps')) }}</div>
                <div class="ir-geo-count">{{ data.desglose_geografico_local[key] || 0 }}</div>
              </div>
              <div class="ir-geo-bar-bg"><div class="ir-geo-bar-fill" :style="{width: pctLocal(data.desglose_geografico_local[key] || 0) + '%', background: 'var(--accent4)'}"></div></div>
            </template>
            <p class="ir-caption">{{ $t('informe.geoCoverage', { analyzed: data.desglose_geografico_local.total, total: data.total_adhesiones }) }}</p>
            <p class="ir-caption">{{ $t('informe.geoMatchLimit') }}</p>
          </div>

          <!-- Distribución geográfica general -->
          <div v-if="hasGeoData" style="margin-top:20px">
            <div class="ir-caption" style="font-style:italic;opacity:.75;margin-bottom:10px">{{ $t('informe.geoIpCaveat') }} {{ $t('informe.placeNamesNote') }}</div>
            <div v-if="Object.keys(data.distribucion_regiones).length" style="margin-bottom:12px">
              <div class="ir-caption" style="margin-bottom:8px">{{ $t('informe.geoByRegion') }}</div>
              <div class="ir-tags">
                <span v-for="(count, region) in data.distribucion_regiones" :key="region" class="ir-tag">
                  {{ region }} <strong>{{ count }}</strong>
                </span>
              </div>
            </div>
            <div v-if="data.distribucion_ciudades.length">
              <div class="ir-caption" style="margin-bottom:8px">{{ $t('informe.geoByCity') }}</div>
              <div class="ir-tags">
                <span v-for="ciudad in data.distribucion_ciudades.slice(0,15)" :key="ciudad" class="ir-tag">{{ ciudad }}</span>
              </div>
            </div>
          </div>

          <!-- Stats secundarias -->
          <div class="ir-stats-row" style="margin-top:20px">
            <div class="ir-stat">
              <div class="ir-stat-n">{{ data.ciudades_distintas }}</div>
              <div class="ir-caption">{{ $t('informe.statCiudades') }}</div>
            </div>
            <div class="ir-stat">
              <div class="ir-stat-n">{{ data.paises_distintos }}</div>
              <div class="ir-caption">{{ data.paises_distintos === 1 ? $t('informe.pais') : $t('informe.paises') }}</div>
            </div>
            <div class="ir-stat">
              <div class="ir-stat-n">{{ data.adhesiones_con_gps }}</div>
              <div class="ir-caption">GPS ✓</div>
            </div>
          </div>

          <div class="ir-timeline-row" v-if="data.primera_adhesion">
            <span class="ir-caption">{{ $t('informe.firstAdhesion') }} {{ formatDateTime(data.primera_adhesion) }}</span>
            <span class="ir-caption">{{ $t('informe.lastAdhesion') }} {{ formatDateTime(data.ultima_adhesion) }}</span>
          </div>
        </section>

        <div class="ir-divider"></div>

        <!-- ══ CALIDAD DE LA EVIDENCIA ════════════════════════════════ -->
        <section class="ir-section">
          <h2 class="ir-section-title">{{ $t('informe.sectionQuality') }}</h2>
          <p class="ir-prose">{{ $t('informe.qualityIntro') }}</p>

          <div v-if="data.desglose_fiabilidad" class="ir-quality-bands">
            <div v-if="data.desglose_fiabilidad.alta.count > 0" class="ir-quality-band">
              <div class="ir-quality-header">
                <div>
                  <div class="ir-quality-title" style="color:var(--accent2)">{{ $t('informe.fiabilidadAlta') }}</div>
                  <div class="ir-caption">{{ $t('informe.recordedIndex', { range: '85-100' }) }}</div>
                </div>
                <div class="ir-quality-n" style="color:var(--accent2)">{{ data.desglose_fiabilidad.alta.count }}</div>
              </div>
              <div class="ir-geo-bar-bg"><div class="ir-geo-bar-fill" :style="{width:pct(data.desglose_fiabilidad.alta.count)+'%',background:'var(--accent2)'}"></div></div>
            </div>
            <div v-if="data.desglose_fiabilidad.media.count > 0" class="ir-quality-band">
              <div class="ir-quality-header">
                <div>
                  <div class="ir-quality-title" style="color:var(--accent4)">{{ $t('informe.fiabilidadMedia') }}</div>
                  <div class="ir-caption">{{ $t('informe.recordedIndex', { range: '75-84' }) }}</div>
                </div>
                <div class="ir-quality-n" style="color:var(--accent4)">{{ data.desglose_fiabilidad.media.count }}</div>
              </div>
              <div class="ir-geo-bar-bg"><div class="ir-geo-bar-fill" :style="{width:pct(data.desglose_fiabilidad.media.count)+'%',background:'var(--accent4)'}"></div></div>
            </div>
            <div v-if="data.desglose_fiabilidad.base.count > 0" class="ir-quality-band">
              <div class="ir-quality-header">
                <div>
                  <div class="ir-quality-title" style="color:var(--accent)">{{ $t('informe.fiabilidadBase') }}</div>
                  <div class="ir-caption">{{ $t('informe.recordedIndex', { range: '60-74' }) }}</div>
                </div>
                <div class="ir-quality-n" style="color:var(--accent)">{{ data.desglose_fiabilidad.base.count }}</div>
              </div>
              <div class="ir-geo-bar-bg"><div class="ir-geo-bar-fill" :style="{width:pct(data.desglose_fiabilidad.base.count)+'%',background:'var(--accent)'}"></div></div>
            </div>
          </div>
        </section>

        <div class="ir-divider"></div>

        <!-- ══ QUÉ DEMUESTRA Y QUÉ NO ═════════════════════════════════ -->
        <section v-if="data.evidential_scope" class="ir-section">
          <h2 class="ir-section-title">{{ $t('evidence.title') }}</h2>

          <details class="ir-details">
            <summary class="ir-details-summary">
              <span style="color:var(--accent2)">✓</span> {{ $t('evidence.demonstratesTitle') }}
            </summary>
            <div style="padding:10px 0 4px">
              <div v-for="(it,i) in data.evidential_scope.demonstrates" :key="'d'+i" class="ir-scope-item" style="padding:4px 0;border-bottom:.5px solid var(--border)">
                {{ $t('evidence.'+it.key, it.params || {}) }}
              </div>
            </div>
          </details>

          <details class="ir-details">
            <summary class="ir-details-summary">
              <span style="color:var(--text3)">○</span> {{ $t('evidence.outsideScopeTitle') }}
            </summary>
            <div style="padding:10px 0 4px">
              <div v-for="(it,i) in data.evidential_scope.outside_scope" :key="'o'+i" class="ir-scope-item" style="padding:4px 0;border-bottom:.5px solid var(--border)">
                {{ $t('evidence.'+it.key, it.params || {}) }}
              </div>
            </div>
          </details>
        </section>

        <div class="ir-divider"></div>

        <!-- ══ SELLO DE INTEGRIDAD ════════════════════════════════════ -->
        <section class="ir-section">
          <h2 class="ir-section-title">{{ $t('informe.selloTitle') }}</h2>

          <div v-if="data.protest.hash_integridad" class="ir-cert">
            <div class="ir-cert-header">
              <span class="ir-cert-icon">🔐</span>
              <div>
                <div class="ir-cert-title">{{ $t('informe.recordedHashLabel', { version: data.protest.integrity_version || 1 }) }}</div>
                <div class="ir-hash">{{ data.protest.hash_integridad }}</div>
              </div>
            </div>
            <div v-if="hasSnapshotV2" class="ir-snapshot">
              <div class="ir-cert-title">{{ $t('informe.snapshotHashLabel', { version: integrityData.integrity_version }) }}</div>
              <div class="ir-hash">{{ integrityData.integrity_hash }}</div>
            </div>
            <div v-if="integrityDiscrepancy" class="ir-verify-result ir-verify-v1" role="note">
              {{ $t('informe.historicalDiscrepancy') }}
            </div>
            <div v-if="integrityLoading" class="ir-caption">{{ $t('informe.verifyRunning') }}</div>
            <div v-else-if="integrityUnavailable" class="ir-caption">{{ $t('informe.verifyUnavailable') }}</div>
            <button @click="verifyIntegrity" class="ir-verify-btn" :disabled="verifyState === 'running'">
              {{ verifyState === 'running' ? $t('informe.verifyRunning') : $t('informe.verifyBtn') }}
            </button>
            <div v-if="verifyResult" class="ir-verify-result"
              :class="verifyResult === 'ok' ? 'ir-verify-ok' : ['v1', 'unavailable'].includes(verifyResult) ? 'ir-verify-v1' : 'ir-verify-fail'">
              {{ verifyResult === 'ok' ? $t(integrityDiscrepancy ? 'informe.verifySnapshotDiscrepancyOk' : hasSnapshotV2 ? 'informe.verifySnapshotOk' : 'informe.verifyOk') : verifyResult === 'v1' ? $t('informe.verifyV1') : verifyResult === 'unavailable' ? $t('informe.verifyUnavailable') : $t('informe.verifyFail') }}
            </div>
          </div>
          <div v-else class="ir-cert-pending">
            <span>⏳</span> {{ $t('informe.selloHashPending') }}
          </div>

          <!-- Acordeón: cadena de verificación + ledger -->
          <details class="ir-details">
            <summary class="ir-details-summary">{{ $t('informe.chainTitle') }}</summary>
            <div v-if="data.evidential_scope?.version === 2" class="ir-chain"><p class="ir-caption">{{ $t('informe.chainBody') }}</p><p v-for="(entry, idx) in data.evidential_scope.methods" :key="idx" class="ir-caption">{{ $t('evidence.' + entry.key, entry.params || {}) }}</p></div>
            <div v-else class="ir-chain">
              <div class="ir-chain-step">
                <div class="ir-chain-num">1</div>
                <div><strong>reCAPTCHA v3</strong><div class="ir-caption">{{ $t('informe.chain1') }}</div></div>
              </div>
              <div class="ir-chain-step">
                <div class="ir-chain-num">2</div>
                <div><strong>SMS / Email OTP</strong><div class="ir-caption">{{ $t('informe.chain2') }}</div></div>
              </div>
              <div class="ir-chain-step">
                <div class="ir-chain-num">3</div>
                <div><strong>HMAC-SHA256</strong><div class="ir-caption">{{ $t('informe.chain3') }}</div></div>
              </div>
              <div class="ir-chain-step">
                <div class="ir-chain-num">4</div>
                <div><strong>{{ $t('informe.chain4Title') }}</strong><div class="ir-caption">{{ $t('informe.chain4') }}</div></div>
              </div>
            </div>
          </details>

          <details class="ir-details">
            <summary class="ir-details-summary">{{ $t('informe.ledgerTitle') }}</summary>
            <div class="ir-caption" style="line-height:1.7;padding:12px 0">
              {{ $t('informe.ledgerV1') }}
              <strong> {{ $t('informe.ledgerV1Caveat') }}</strong> —
              {{ $t('informe.ledgerV1Detail') }}<br><br>
              {{ $t('informe.ledgerV2Pre') }} <strong style="color:var(--accent)">{{ $t('informe.ledgerV2Name') }}</strong> {{ $t('informe.ledgerV2Post') }}
              <em>{{ $t('informe.ledgerV2Planned') }}</em>
            </div>
          </details>
        </section>

        <div class="ir-divider"></div>

        <!-- ══ PIE DEL DOCUMENTO ══════════════════════════════════════ -->
        <div class="ir-footer">
          <div class="ir-footer-row">
            <span class="ir-caption">{{ $t('informe.selloGenerated') }}</span>
            <span class="ir-caption">{{ formatDateTime(new Date().toISOString()) }}</span>
          </div>
          <div class="ir-footer-row">
            <span class="ir-caption">{{ $t('informe.selloId') }}</span>
            <span class="ir-mono">{{ $route.params.id }}</span>
          </div>
          <div class="ir-footer-row">
            <a href="https://github.com/cero-absoluto/vozciudadana" target="_blank" rel="noopener noreferrer" class="ir-github-btn">
              {{ $t('informe.selloSourceBtn') }}
            </a>
          </div>
        </div>

        <!-- ══ ACCIONES ═══════════════════════════════════════════════ -->
        <p v-if="pdfError" class="ir-pdf-error" role="alert">{{ pdfError }}</p>
        <div class="ir-actions">
          <button class="btn-primary ir-btn-back" @click="$router.back()">{{ $t('informe.back') }}</button>
          <button class="btn-primary ir-btn-pdf" :disabled="pdfBusy" @click="downloadPDF">{{ $t('informe.downloadPdf') }}</button>
          <button class="ir-btn-embed" @click="showEmbed=true">{{ $t('informe.embedBtn') }}</button>
        </div>

      </div><!-- fin ir-doc -->

      <!-- EMBED MODAL -->
      <div v-if="showEmbed" style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999;display:flex;align-items:center;justify-content:center;padding:24px" @click.self="showEmbed=false">
        <div style="background:#13111F;border:.5px solid rgba(255,255,255,.1);border-radius:16px;padding:24px;max-width:500px;width:100%">
          <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px">{{ $t('informe.embedTitle') }}</div>
          <div style="font-size:15px;color:var(--text2);margin-bottom:16px;line-height:1.7">{{ $t('informe.embedDesc') }}</div>
          <div style="background:#0C0B14;border:.5px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;font-family:monospace;font-size:13px;color:#4CFFA4;word-break:break-all;margin-bottom:14px;line-height:1.7">{{ embedCode }}</div>
          <div style="display:flex;gap:10px">
            <button class="btn-primary" style="flex:1;background:#4C6FFF" @click="copyEmbed">{{ copied ? $t('informe.embedCopied') : $t('informe.embedCopy') }}</button>
            <button class="btn-primary" style="flex:1;background:transparent;border:.5px solid var(--border2);color:var(--text2)" @click="showEmbed=false">{{ $t('informe.embedClose') }}</button>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>

/* ── Scroll y documento ─────────────────────────────────────── */
.ir-scroll {
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  padding: 0 0 40px;
  box-sizing: border-box;
  overflow-x: hidden;
}

.ir-doc {
  display: flex;
  flex-direction: column;
}

/* ── Cabecera ────────────────────────────────────────────────── */
.ir-header {
  padding: 28px 24px 24px;
  border-bottom: 1px solid var(--border);
}

.ir-header-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.ir-badge {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text3);
  border: .5px solid var(--border);
  border-radius: 4px;
  padding: 3px 8px;
}

.ir-badge-status {
  color: var(--accent2);
  border-color: rgba(76,255,164,.3);
}

.ir-title {
  font-family: 'Syne', sans-serif;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--text);
  margin: 0 0 16px;
  word-break: break-word;
}

.ir-directed {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.ir-institution {
  font-family: 'Syne', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: var(--accent2);
}

.ir-country {
  font-size: 15px;
  color: var(--text);
  color: var(--text2);
}

.ir-dates-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ir-dates-sep {
  color: var(--text);
  font-size: 14px;
}

/* ── Número principal ─────────────────────────────────────────── */
.ir-hero {
  padding: 40px 24px 32px;
  border-bottom: 1px solid var(--border);
  text-align: center;
}

.ir-hero-n {
  font-family: 'Syne', sans-serif;
  font-size: clamp(72px, 20vw, 96px);
  font-weight: 800;
  line-height: 1;
  color: var(--accent2);
  letter-spacing: -2px;
  margin-bottom: 8px;
}

.ir-hero-label {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
  line-height: 1.5;
}

.ir-hero-sub {
  font-size: 16px;
  color: var(--text);
  color: var(--text3);
  margin-bottom: 20px;
}

.ir-hero-demand {
  font-size: 18px;
  color: var(--text);
  font-style: normal;
  line-height: 1.75;
  max-width: 100%;
  margin: 16px auto 0;
  padding-top: 16px;
  border-top: .5px solid var(--border);
  text-align: left;
}

/* ── Sellos ───────────────────────────────────────────────────── */
.ir-seals {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--border);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.ir-seal {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--bg);
  font-size: 15px;
  color: var(--text);
  line-height: 1.5;
}

.ir-seal-icon {
  color: var(--accent2);
  font-weight: 800;
  font-size: 15px;
  flex-shrink: 0;
}

/* ── Divisor ──────────────────────────────────────────────────── */
.ir-divider {
  height: 1px;
  background: var(--border);
  margin: 0;
}

/* ── Secciones ────────────────────────────────────────────────── */
.ir-section {
  padding: 28px 24px;
  border-bottom: 1px solid var(--border);
}

.ir-section-title {
  font-family: 'Syne', sans-serif;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--text2);
  margin: 0 0 20px;
}

.ir-prose {
  font-size: 15px;
  color: var(--text);
  line-height: 1.9;
  margin-bottom: 16px;
}

.ir-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 14px;
}

.ir-field-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text2);
}

.ir-field-val {
  font-size: 18px;
  color: var(--text);
  line-height: 1.8;
  word-break: break-word;
}

.ir-demands { font-style: italic; }

.ir-link {
  font-size: 17px;
  color: var(--accent);
  text-decoration: underline;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-height: 1.6;
}

.ir-caption {
  font-size: 16px;
  color: var(--text);
  line-height: 1.5;
}

/* ── Geografía ────────────────────────────────────────────────── */
.ir-geo-breakdown { display: flex; flex-direction: column; gap: 4px; }

.ir-geo-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}

.ir-geo-label { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 18px; }
.ir-geo-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ir-geo-count { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800; }

.ir-geo-bar-bg {
  height: 6px;
  background: var(--bg3);
  border-radius: 3px;
  overflow: hidden;
  margin-top: 4px;
}

.ir-geo-bar-fill { height: 100%; border-radius: 3px; transition: width .5s; }

.ir-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.ir-tag { font-size: 17px; color: var(--text); background: var(--bg2); border: .5px solid var(--border); border-radius: 4px; padding: 3px 9px; }

.ir-stats-row { display: flex; gap: 24px; }
.ir-stat { display: flex; flex-direction: column; gap: 2px; }
.ir-stat-n { font-family: 'Syne', sans-serif; font-size: 26px; font-weight: 800; color: var(--text); line-height: 1; }

.ir-timeline-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 12px;
}

/* ── Calidad ──────────────────────────────────────────────────── */
.ir-quality-bands { display: flex; flex-direction: column; gap: 18px; }

.ir-quality-band { display: flex; flex-direction: column; gap: 6px; }

.ir-quality-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.ir-quality-title { font-size: 18px; font-weight: 700; }
.ir-quality-n { font-family: 'Syne', sans-serif; font-size: 28px; font-weight: 800; line-height: 1; flex-shrink: 0; }

/* ── Evidencia ────────────────────────────────────────────────── */
.ir-scope-yes, .ir-scope-no {
  display: flex;
  gap: 14px;
  padding: 16px 0;
  border-bottom: .5px solid var(--border);
}

.ir-scope-no { border-bottom: none; padding-bottom: 0; }

.ir-scope-icon {
  font-size: 18px;
  font-weight: 800;
  flex-shrink: 0;
  margin-top: 2px;
}

.ir-scope-yes .ir-scope-icon { color: var(--accent2); }
.ir-scope-no  .ir-scope-icon { color: var(--text3); }

.ir-scope-heading {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text2);
  margin-bottom: 8px;
}

.ir-scope-item {
  font-size: 18px;
  color: var(--text);
  line-height: 1.85;
  margin-bottom: 4px;
}

.ir-scope-yes .ir-scope-item { color: var(--text); font-size: 18px; }
.ir-scope-no  .ir-scope-item { color: var(--text); font-size: 18px; }

/* ── Integridad ───────────────────────────────────────────────── */
.ir-cert {
  background: rgba(76,255,164,.04);
  border: .5px solid rgba(76,255,164,.2);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
}

.ir-cert-header { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
.ir-cert-icon { font-size: 22px; flex-shrink: 0; }
.ir-cert-title { font-size: 16px; color: var(--text); margin-bottom: 6px; }
.ir-snapshot { margin: 12px 0; padding-top: 12px; border-top: .5px solid var(--border); }

.ir-hash {
  font-family: monospace;
  font-size: 13px;
  color: var(--accent2);
  word-break: break-all;
  line-height: 1.7;
}

.ir-cert-pending {
  background: var(--bg2);
  border: .5px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  font-size: 18px;
  color: var(--text);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ir-verify-btn {
  width: 100%;
  padding: 11px;
  background: transparent;
  border: .5px solid rgba(76,255,164,.3);
  border-radius: 6px;
  color: var(--accent2);
  font-size: 17px;
  font-weight: 600;
  cursor: pointer;
  box-sizing: border-box;
}

.ir-verify-result { margin-top: 8px; padding: 10px 12px; border-radius: 6px; font-size: 17px; line-height: 1.6; }
.ir-verify-ok   { background: rgba(76,255,164,.06); border: .5px solid rgba(76,255,164,.25); color: var(--accent2); }
.ir-verify-v1   { background: rgba(124,111,255,.06); border: .5px solid rgba(124,111,255,.25); color: var(--accent); }
.ir-verify-fail { background: rgba(255,80,80,.06); border: .5px solid rgba(255,80,80,.25); color: var(--accent3); }

/* ── Acordeón ─────────────────────────────────────────────────── */
.ir-details {
  border-top: .5px solid var(--border);
  margin-top: 8px;
}

.ir-details-summary {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  padding: 12px 0;
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ir-details-summary::after {
  content: '›';
  font-size: 16px;
  color: var(--text3);
  transition: transform .2s;
}

.ir-details[open] .ir-details-summary::after { transform: rotate(90deg); }

.ir-chain { display: flex; flex-direction: column; gap: 12px; padding-bottom: 12px; }
.ir-chain-step { display: flex; gap: 12px; align-items: flex-start; }
.ir-chain-num {
  min-width: 24px; width: 24px; height: 24px;
  border-radius: 50%;
  background: var(--accent);
  color: #000;
  font-weight: 800;
  font-size: 12px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

/* ── Pie y acciones ───────────────────────────────────────────── */
.ir-footer {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ir-footer-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.ir-mono {
  font-family: monospace;
  font-size: 13px;
  color: var(--accent2);
  word-break: break-all;
}

.ir-github-btn {
  background: transparent;
  border: .5px solid var(--border);
  border-radius: 4px;
  padding: 6px 14px;
  color: var(--text);
  font-size: 16px;
  cursor: pointer;
}

.ir-actions {
  display: flex;
  gap: 8px;
  padding: 20px 24px;
  flex-wrap: wrap;
}

.ir-btn-back { flex: 1; padding: 14px; font-size: 17px; }
.ir-limits { margin: 16px 0 4px; padding: 10px 14px; text-align: left; border-left: 3px solid var(--accent2); background: rgba(255,255,255,.04); font-size: 13px; line-height: 1.5; color: var(--text2); }
.ir-pdf-error { margin: 0 0 10px; padding: 10px 14px; border-left: 3px solid var(--accent3); background: rgba(255,255,255,.04); font-size: 13px; line-height: 1.5; color: var(--text); }
.ir-btn-pdf  { flex: 1; padding: 14px; font-size: 17px; background: var(--accent2); color: #000; }
.ir-btn-embed {
  padding: 14px 16px;
  background: transparent;
  border: .5px solid var(--border2);
  border-radius: var(--r);
  color: var(--text);
  font-size: 16px;
  cursor: pointer;
}

/* ── Mobile adjustments ───────────────────────────────────────── */
@media (max-width: 520px) {
  .ir-header, .ir-section, .ir-footer, .ir-actions { padding-left: 16px; padding-right: 16px; }
  .ir-hero { padding: 32px 16px 24px; }
  .ir-seals { grid-template-columns: 1fr; }

  /* Tamaños legibles en móvil */
  .ir-title       { font-size: 20px; }
  .ir-institution { font-size: 18px; }
  .ir-hero-label  { font-size: 16px; }
  .ir-hero-sub    { font-size: 14px; }
  .ir-hero-demand { font-size: 15px; }
  .ir-seal        { font-size: 14px; padding: 10px 12px; }
  .ir-seal-icon   { font-size: 16px; }
  .ir-prose       { font-size: 16px; }
  .ir-field-val   { font-size: 16px; }
  .ir-field-label { font-size: 12px; }
  .ir-caption     { font-size: 13px; color: var(--text); }
  .ir-link        { font-size: 15px; }
  .ir-geo-label   { font-size: 15px; }
  .ir-geo-count   { font-size: 20px; }
  .ir-tag         { font-size: 15px; }
  .ir-stat-n      { font-size: 22px; }
  .ir-quality-title { font-size: 18px; }
  .ir-quality-n   { font-size: 24px; }
  .ir-scope-item  { font-size: 15px; }
  .ir-hash        { font-size: 12px; }
  .ir-details-summary { font-size: 15px; }
  .ir-verify-btn  { font-size: 15px; }
  .ir-verify-result { font-size: 14px; }
  .ir-btn-back, .ir-btn-pdf { font-size: 15px; padding: 12px; }
  .ir-btn-embed   { font-size: 14px; padding: 12px 14px; }
  .ir-section-title { font-size: 11px; }
  .ir-scope-heading { font-size: 11px; }
}
</style>

<script setup>
import {publicReportId} from '../lib/publicReportId.js';
import { ref, computed, onMounted } from 'vue';
import { hasIntegrityDiscrepancy, verifyIntegrityPayload } from '@/lib/integrityVerification.js';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { buildInformePdf, dateLocaleTag, freezeTranslator, PdfFontError } from '@/lib/informePdf.js';
import { localizedCountry } from '@/constants.js';

const route = useRoute();
const reportId = computed(()=>publicReportId(route.params.id));
const { t, locale } = useI18n({ useScope: 'global' });

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
const safeSourceUrl = computed(() => {
  try {
    const url = new URL(data.value?.protest?.fuente_url);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
});
const integrityData = ref(null);
const integrityLoading = ref(false);
const integrityUnavailable = ref(false);
const hasSnapshotV2 = computed(() => integrityData.value?.data_source === 'integrity_record'
  && Number(integrityData.value?.integrity_version) >= 2);
const integrityDiscrepancy = computed(() => hasIntegrityDiscrepancy(data.value?.protest, integrityData.value));
const verifyState  = ref('idle');
const verifyResult = ref(null);
const loading = ref(false);
const error = ref(false);
const notFound = ref(false);
const showEmbed = ref(false);
const copied = ref(false);

async function loadIntegrityData() {
  if(!reportId.value){integrityUnavailable.value=true;return;}
  integrityLoading.value = true;
  integrityUnavailable.value = false;
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/public/protests/${encodeURIComponent(reportId.value)}/integrity-data`);
    if (!res.ok) throw new Error();
    const payload = await res.json();
    if (payload.protest_id !== route.params.id) throw new Error();
    integrityData.value = payload;
    return payload;
  } catch {
    integrityData.value = null;
    integrityUnavailable.value = true;
    return null;
  } finally {
    integrityLoading.value = false;
  }
}

async function verifyIntegrity() {
  if (verifyState.value === 'running') return;
  verifyState.value = 'running';
  verifyResult.value = null;
  try {
    const payload = await loadIntegrityData();
    verifyResult.value = payload ? await verifyIntegrityPayload(payload, route.params.id) : 'unavailable';
  } catch { verifyResult.value = 'unavailable'; }
  finally { verifyState.value = 'idle'; }
}

const embedCode = computed(() => reportId.value ?
  `<script src="https://www.voiceprotest.org/widget.js?id=${encodeURIComponent(reportId.value)}"><\/script>` : ''
);

function copyEmbed() {
  navigator.clipboard.writeText(embedCode.value).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  });
}

async function loadReport() {
  if(!reportId.value){loading.value=false;notFound.value=true;data.value=null;return;}
  if (loading.value) return;
  loading.value = true;
  error.value = false;
  notFound.value = false;
  data.value = null;
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/protests/${encodeURIComponent(reportId.value)}/informe`);
    if (res.status === 404) { notFound.value = true; return; }
    if (!res.ok) throw new Error();
    data.value = await res.json();
  } catch { error.value = true; }
  finally { loading.value = false; }
  if (data.value?.protest?.hash_integridad) await loadIntegrityData();
}

onMounted(loadReport);

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(dateLocaleTag(locale.value), { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(dateLocaleTag(locale.value), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function pct(count) {
  const total = data.value?.total_analizado ?? data.value?.total_adhesiones;
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function pctLocal(count) {
  const dg = data.value?.desglose_geografico_local;
  const total = dg ? dg.total : data.value?.total_adhesiones;
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function maxPct(count) {
  if (!data.value?.velocidad?.adhesiones_por_dia?.length) return 0;
  const max = Math.max(...data.value.velocidad.adhesiones_por_dia.map(d => d.count));
  return max > 0 ? Math.round((count / max) * 100) : 0;
}

const pdfBusy = ref(false);
const pdfError = ref('');

async function downloadPDF() {
  const d = data.value;
  if (!d || pdfBusy.value) return;
  pdfBusy.value = true;
  pdfError.value = '';
  // Everything below is read now, before any await, so a language switch while the font is
  // downloading cannot mix languages inside one PDF.
  const lang = locale.value;
  try {
    const { doc, fileName } = await buildInformePdf({
      data: d,
      integrity: {
        hasSnapshotV2: hasSnapshotV2.value,
        snapshot: integrityData.value,
        discrepancy: integrityDiscrepancy.value,
        unavailable: integrityUnavailable.value || integrityLoading.value,
      },
      protestId: route.params.id,
      abuseLabel: tipoAbusoLabel.value,
      locale: lang,
      t: freezeTranslator(t, lang),
    });
    doc.save(fileName);
  } catch (err) {
    // No document is downloaded; the user can press the button again.
    pdfError.value = err instanceof PdfFontError ? t('informe.pdfErrorFont') : t('informe.pdfErrorGeneric');
  } finally {
    pdfBusy.value = false;
  }
}
</script>
