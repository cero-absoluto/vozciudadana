<template>
  <div class="screen active" id="s-informe">
    <div class="scroll ir-scroll">

      <!-- Cargando -->
      <div v-if="loading" style="text-align:center;padding:80px 0">
        <div class="spin-ring" style="margin:0 auto 16px"></div>
        <div class="ir-caption">{{ $t('informe.loading') }}</div>
      </div>

      <!-- Error -->
      <div v-else-if="error" style="text-align:center;padding:80px 0;color:var(--accent3)">
        {{ $t('informe.notFound') }}
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
            <div class="ir-hero-sub" v-if="data.total_adhesiones > data.desglose_geografico_local.gps_local">
              {{ $t('informe.heroSubLocal', { total: data.total_adhesiones, nacional: data.desglose_geografico_local.gps_nacional }) }}
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

          <div class="ir-hero-demand">{{ data.protest.demands }}</div>
        </div>

        <!-- ══ SELLOS DE VERIFICACIÓN ══════════════════════════════════ -->
        <div class="ir-seals">
          <div class="ir-seal">
            <span class="ir-seal-icon">✓</span>
            <span>{{ $t('informe.sealUnique') }}</span>
          </div>
          <div class="ir-seal">
            <span class="ir-seal-icon">✓</span>
            <span>{{ $t('informe.sealOne') }}</span>
          </div>
          <div class="ir-seal">
            <span class="ir-seal-icon">✓</span>
            <span>{{ $t('informe.sealPrivacy') }}</span>
          </div>
          <div class="ir-seal">
            <span class="ir-seal-icon">✓</span>
            <span>{{ $t('informe.sealAuditable') }}</span>
          </div>
        </div>

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

          <div v-if="data.protest.fuente_url" class="ir-field">
            <span class="ir-field-label">{{ $t('informe.fuente') }}</span>
            <a :href="data.protest.fuente_url" target="_blank" class="ir-link">{{ data.protest.fuente_url }}</a>
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

          <!-- Distribución geográfica general -->
          <div v-if="hasGeoData" style="margin-top:20px">
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
                  <div class="ir-caption">{{ data.desglose_fiabilidad.alta.descripcion }}</div>
                </div>
                <div class="ir-quality-n" style="color:var(--accent2)">{{ data.desglose_fiabilidad.alta.count }}</div>
              </div>
              <div class="ir-geo-bar-bg"><div class="ir-geo-bar-fill" :style="{width:pct(data.desglose_fiabilidad.alta.count)+'%',background:'var(--accent2)'}"></div></div>
            </div>
            <div v-if="data.desglose_fiabilidad.media.count > 0" class="ir-quality-band">
              <div class="ir-quality-header">
                <div>
                  <div class="ir-quality-title" style="color:var(--accent4)">{{ $t('informe.fiabilidadMedia') }}</div>
                  <div class="ir-caption">{{ data.desglose_fiabilidad.media.descripcion }}</div>
                </div>
                <div class="ir-quality-n" style="color:var(--accent4)">{{ data.desglose_fiabilidad.media.count }}</div>
              </div>
              <div class="ir-geo-bar-bg"><div class="ir-geo-bar-fill" :style="{width:pct(data.desglose_fiabilidad.media.count)+'%',background:'var(--accent4)'}"></div></div>
            </div>
            <div v-if="data.desglose_fiabilidad.base.count > 0" class="ir-quality-band">
              <div class="ir-quality-header">
                <div>
                  <div class="ir-quality-title" style="color:var(--accent)">{{ $t('informe.fiabilidadBase') }}</div>
                  <div class="ir-caption">{{ data.desglose_fiabilidad.base.descripcion }}</div>
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

          <div class="ir-scope-yes">
            <div class="ir-scope-icon">✓</div>
            <div>
              <div class="ir-scope-heading">{{ $t('evidence.demonstratesTitle') }}</div>
              <div v-for="(it,i) in data.evidential_scope.demonstrates" :key="'d'+i" class="ir-scope-item">
                {{ $t('evidence.'+it.key, it.params || {}) }}
              </div>
            </div>
          </div>

          <div class="ir-scope-no">
            <div class="ir-scope-icon">○</div>
            <div>
              <div class="ir-scope-heading">{{ $t('evidence.outsideScopeTitle') }}</div>
              <div v-for="(it,i) in data.evidential_scope.outside_scope" :key="'o'+i" class="ir-scope-item">
                {{ $t('evidence.'+it.key, it.params || {}) }}
              </div>
            </div>
          </div>
        </section>

        <div class="ir-divider"></div>

        <!-- ══ SELLO DE INTEGRIDAD ════════════════════════════════════ -->
        <section class="ir-section">
          <h2 class="ir-section-title">{{ $t('informe.selloTitle') }}</h2>

          <div v-if="data.protest.hash_integridad" class="ir-cert">
            <div class="ir-cert-header">
              <span class="ir-cert-icon">🔐</span>
              <div>
                <div class="ir-cert-title">{{ $t('informe.selloHashLabel') }}</div>
                <div class="ir-hash">{{ data.protest.hash_integridad }}</div>
              </div>
            </div>
            <button @click="verifyIntegrity" class="ir-verify-btn">
              {{ verifyState === 'running' ? $t('informe.verifyRunning') : $t('informe.verifyBtn') }}
            </button>
            <div v-if="verifyResult" class="ir-verify-result"
              :class="verifyResult === 'ok' ? 'ir-verify-ok' : verifyResult === 'v1' ? 'ir-verify-v1' : 'ir-verify-fail'">
              {{ verifyResult === 'ok' ? $t('informe.verifyOk') : verifyResult === 'v1' ? $t('informe.verifyV1') : $t('informe.verifyFail') }}
            </div>
          </div>
          <div v-else class="ir-cert-pending">
            <span>⏳</span> {{ $t('informe.selloHashPending') }}
          </div>

          <!-- Acordeón: cadena de verificación + ledger -->
          <details class="ir-details">
            <summary class="ir-details-summary">{{ $t('informe.chainTitle') }}</summary>
            <div class="ir-chain">
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
            <button onclick="window.open('https://github.com/cero-absoluto/vozciudadana','_blank')" class="ir-github-btn">
              {{ $t('informe.selloSourceBtn') }}
            </button>
          </div>
        </div>

        <!-- ══ ACCIONES ═══════════════════════════════════════════════ -->
        <div class="ir-actions">
          <button class="btn-primary ir-btn-back" @click="$router.back()">{{ $t('informe.back') }}</button>
          <button class="btn-primary ir-btn-pdf" @click="downloadPDF">{{ $t('informe.downloadPdf') }}</button>
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
  max-width: 680px;
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
  font-size: 21px;
  font-weight: 800;
  line-height: 1.35;
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
  font-size: 14px;
  color: var(--text2);
}

.ir-dates-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ir-dates-sep {
  color: var(--text3);
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
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
  line-height: 1.5;
}

.ir-hero-sub {
  font-size: 13px;
  color: var(--text3);
  margin-bottom: 20px;
}

.ir-hero-demand {
  font-size: 14px;
  color: var(--text);
  font-style: italic;
  line-height: 1.7;
  max-width: 480px;
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
  font-size: 16px;
  color: var(--text);
  line-height: 1.8;
  word-break: break-word;
}

.ir-demands { font-style: italic; }

.ir-link {
  font-size: 14px;
  color: var(--accent);
  text-decoration: underline;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-height: 1.6;
}

.ir-caption {
  font-size: 13px;
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

.ir-geo-label { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 16px; }
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
.ir-tag { font-size: 15px; color: var(--text); background: var(--bg2); border: .5px solid var(--border); border-radius: 4px; padding: 3px 9px; }

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

.ir-quality-title { font-size: 16px; font-weight: 700; }
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
  font-size: 16px;
  color: var(--text);
  line-height: 1.85;
  margin-bottom: 4px;
}

.ir-scope-yes .ir-scope-item { color: var(--text); font-size: 16px; }

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
.ir-cert-title { font-size: 14px; color: var(--text); margin-bottom: 6px; }

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
  font-size: 15px;
  color: var(--text);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ir-verify-btn {
  width: 100%;
  padding: 10px;
  background: transparent;
  border: .5px solid rgba(76,255,164,.3);
  border-radius: 6px;
  color: var(--accent2);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-sizing: border-box;
}

.ir-verify-result { margin-top: 8px; padding: 10px 12px; border-radius: 6px; font-size: 15px; line-height: 1.6; }
.ir-verify-ok   { background: rgba(76,255,164,.06); border: .5px solid rgba(76,255,164,.25); color: var(--accent2); }
.ir-verify-v1   { background: rgba(124,111,255,.06); border: .5px solid rgba(124,111,255,.25); color: var(--accent); }
.ir-verify-fail { background: rgba(255,80,80,.06); border: .5px solid rgba(255,80,80,.25); color: var(--accent3); }

/* ── Acordeón ─────────────────────────────────────────────────── */
.ir-details {
  border-top: .5px solid var(--border);
  margin-top: 8px;
}

.ir-details-summary {
  font-size: 15px;
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
  font-size: 14px;
  cursor: pointer;
}

.ir-actions {
  display: flex;
  gap: 8px;
  padding: 20px 24px;
  flex-wrap: wrap;
}

.ir-btn-back { flex: 1; padding: 13px; font-size: 16px; }
.ir-btn-pdf  { flex: 1; padding: 13px; font-size: 16px; background: var(--accent2); color: #000; }
.ir-btn-embed {
  padding: 12px 16px;
  background: transparent;
  border: .5px solid var(--border2);
  border-radius: var(--r);
  color: var(--text);
  font-size: 15px;
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
  .ir-quality-title { font-size: 16px; }
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
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { jsPDF } from 'jspdf';
import { localizedCountry } from '@/constants.js';

const route = useRoute();
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
const verifyState  = ref('idle');
const verifyResult = ref(null);
const loading = ref(true);
const error = ref(false);
const showEmbed = ref(false);
const copied = ref(false);

async function verifyIntegrity() {
  if (verifyState.value === 'running') return;
  verifyState.value = 'running';
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
  const dg = data.value?.desglose_geografico_local;
  const total = dg ? (dg.gps_local + dg.nacionales_sin_gps + dg.internacionales) : data.value?.total_adhesiones;
  if (!total) return 0;
  return Math.round((count / total) * 100);
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
  function kv(k, v) {
    const label = k + ':';
    const val = String(v);
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(76,255,164);
    const labelW = doc.getTextWidth(label);
    if (labelW > 44) {
      doc.text(label, M, y); nl(5);
      doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(240,238,255);
      const lines = doc.splitTextToSize(val, CW - 8);
      lines.forEach(l => { if (y > 265) { doc.addPage(); setPageBg(); y = 22; } doc.text(l, M + 8, y); nl(6); });
    } else {
      doc.text(label, M, y);
      doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(240,238,255);
      doc.text(doc.splitTextToSize(val, CW - 48)[0], M + 48, y); nl(7);
    }
  }
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
  if (d.protest.fuente_url) {
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(76,255,164);
    doc.text('Fuente:', M, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(100,160,255);
    const urlLines = doc.splitTextToSize(d.protest.fuente_url, CW - 48);
    urlLines.forEach((l, i) => { doc.text(l, i === 0 ? M+48 : M+4, y); nl(5); });
    nl(2);
  }
  if (d.protest.demands) { nl(1); body('Demandas: ' + d.protest.demands); }
  nl(2); line();

  h2('3. RESULTADOS');
  if ((d.protest.scope === 'local' || d.protest.scope === 'regional') && d.desglose_geografico_local) {
    const territorio = d.protest.convocatoria_ciudad_nombre || '—';
    kv('GPS verificado en ' + territorio, d.desglose_geografico_local.gps_local + ' participantes');
    if (d.desglose_geografico_local.gps_nacional > 0) kv('Participantes nacionales adicionales', d.desglose_geografico_local.gps_nacional);
    if (d.desglose_geografico_local.internacionales > 0) kv('Participantes internacionales', d.desglose_geografico_local.internacionales);
    kv('Total adhesiones verificadas', d.total_adhesiones);
  } else if (d.protest.dominio_email) {
    kv('Miembros verificados de ' + d.protest.dominio_email, d.total_adhesiones);
  } else {
    kv('Adhesiones verificadas', d.total_adhesiones);
    kv('Países distintos', d.paises_distintos);
  }
  if (d.ciudades_distintas > 0) kv('Ciudades distintas', d.ciudades_distintas);
  kv('Primera adhesión', d.primera_adhesion ? new Date(d.primera_adhesion).toLocaleString('es-ES') : '—');
  kv('Última adhesión', d.ultima_adhesion ? new Date(d.ultima_adhesion).toLocaleString('es-ES') : '—');
  nl(2); line();

  h2('4. DISTRIBUCIÓN GEOGRÁFICA');
  if (d.desglose_geografico_local) {
    const dg = d.desglose_geografico_local;
    body('Verificación territorial (' + (dg.municipio || dg.scope) + '):');
    if (dg.gps_local > 0) body('  GPS confirmado dentro del territorio: ' + dg.gps_local);
    if (dg.gps_nacional > 0) body('  Participantes nacionales sin GPS: ' + dg.gps_nacional);
    if (dg.internacionales > 0) body('  Participantes internacionales: ' + dg.internacionales);
    nl(1);
  }
  if (d.distribucion_regiones && Object.keys(d.distribucion_regiones).length) {
    body('Por región:');
    Object.entries(d.distribucion_regiones).forEach(([r,c]) => body('  ' + r + ': ' + c));
  }
  if (d.distribucion_ciudades?.length) body('Ciudades: ' + d.distribucion_ciudades.slice(0,15).join(' · '));
  nl(2); line();

  h2('5. ' + t('informe.chainTitle').toUpperCase());
  body('1. reCAPTCHA v3 — ' + t('informe.chain1'));
  body('2. SMS/Email OTP — ' + t('informe.chain2'));
  body('3. HMAC-SHA256 — ' + t('informe.chain3'));
  body('4. ' + t('informe.chain4Title') + ' — ' + t('informe.chain4'));
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
