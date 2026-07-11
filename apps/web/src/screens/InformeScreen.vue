<template>
  <div class="screen active" id="s-informe">
    <div class="scroll" style="padding:24px 20px;max-width:900px;margin:0 auto">

      <!-- Cargando -->
      <div v-if="loading" style="text-align:center;padding:60px">
        <div class="spin-ring" style="margin:0 auto 16px"></div>
        <div style="font-size:14px;color:var(--text3)">{{ $t('informe.loading') }}</div>
      </div>

      <!-- Error -->
      <div v-else-if="error" style="text-align:center;padding:60px;color:var(--accent3);font-size:16px">
        {{ $t('informe.notFound') }}
      </div>

      <!-- Informe -->
      <div v-else-if="data" class="informe-layout">

        <!-- ═══════════════════════════════════════════════
             COLUMNA IZQUIERDA
        ════════════════════════════════════════════════ -->
        <div class="informe-left">

          <!-- Cabecera -->
          <div style="margin-bottom:28px">
            <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:2px;margin-bottom:10px">
              {{ $t('informe.headerLabel') }}
            </div>
            <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:26px;letter-spacing:-.5px;line-height:1.25;margin-bottom:14px;color:var(--text)">
              {{ data.protest.title }}
            </div>
            <div style="font-size:14px;color:var(--text2);line-height:1.7;margin-bottom:12px">
              {{ data.protest.demands }}
            </div>
            <div v-if="data.protest.fuente_url" style="font-size:13px;color:var(--text3);margin-top:8px;display:flex;gap:6px;align-items:flex-start">
              <span>{{ $t('informe.fuente') }}</span>
              <a :href="data.protest.fuente_url" target="_blank"
                style="color:var(--accent);text-decoration:underline;word-break:break-all;line-height:1.5">
                {{ data.protest.fuente_url }}
              </a>
            </div>
            <div v-if="data.protest.tipo_abuso" style="font-size:13px;color:var(--text3);margin-top:6px">
              {{ $t('informe.tipoAbuso') }}
              <span style="color:var(--accent4);font-weight:600">{{ tipoAbusoLabel }}</span>
            </div>
            <div style="font-size:13px;color:var(--text3);margin-top:6px">
              {{ formatDate(data.protest.starts_at) }} → {{ formatDate(data.protest.ends_at) }}
            </div>
          </div>

          <!-- BLOQUE — Titular político -->
          <div class="inf-block" style="margin-bottom:20px">
            <div class="inf-block-title">{{ $t('informe.headlineBlock') }}</div>
            <div style="font-size:15px;font-weight:600;line-height:1.65;color:var(--text)">
              {{ $t('informe.headline', { count: data.total_adhesiones, country: data.protest.country_name, focal: data.protest.focal_point, demands: data.protest.demands }) }}
            </div>
          </div>

          <!-- BLOQUE — Alcance de la evidencia -->
          <div v-if="data.evidential_scope" class="inf-block" style="margin-bottom:20px">
            <div class="inf-block-title">{{ $t('evidence.title') }}</div>

            <div style="margin-top:10px">
              <div class="inf-section-label">{{ $t('evidence.demonstratesTitle') }}</div>
              <ul class="inf-list inf-list-green">
                <li v-for="(it,i) in data.evidential_scope.demonstrates" :key="'ev-d-'+i">{{ $t('evidence.'+it.key, it.params || {}) }}</li>
              </ul>
            </div>

            <div v-if="data.evidential_scope.participation_rate" style="margin-top:10px;font-size:14px;color:var(--text)">
              {{ $t('evidence.participationRate', {
                   count: data.evidential_scope.participation_rate.count,
                   eligible: data.evidential_scope.participation_rate.eligible,
                   rate: data.evidential_scope.participation_rate.rate }) }}
            </div>

            <div style="margin-top:14px">
              <div class="inf-section-label">{{ $t('evidence.outsideScopeTitle') }}</div>
              <ul class="inf-list inf-list-muted">
                <li v-for="(it,i) in data.evidential_scope.outside_scope" :key="'ev-o-'+i">{{ $t('evidence.'+it.key, it.params || {}) }}</li>
              </ul>
            </div>

            <div style="margin-top:14px">
              <div class="inf-section-label">{{ $t('evidence.methodsTitle') }}</div>
              <ul class="inf-list inf-list-muted">
                <li v-for="(it,i) in data.evidential_scope.methods" :key="'ev-m-'+i">{{ $t('evidence.'+it.key, it.params || {}) }}</li>
              </ul>
            </div>

            <div v-if="data.evidential_scope.admission_rules && data.evidential_scope.admission_rules.length" style="margin-top:14px">
              <div class="inf-section-label">{{ $t('evidence.admissionTitle') }}</div>
              <ul class="inf-list inf-list-muted">
                <li v-for="(it,i) in data.evidential_scope.admission_rules" :key="'ev-a-'+i">{{ $t('evidence.'+it.key, it.params || {}) }}</li>
              </ul>
            </div>
          </div>

          <!-- BLOQUE — Distribución geográfica -->
          <div class="inf-block" style="margin-bottom:20px">
            <div class="inf-block-title">{{ $t('informe.geoTitle') }}</div>
            <div style="font-size:14px;color:var(--text2);line-height:2;margin-bottom:10px">
              <strong style="color:var(--text)">{{ $t('informe.geoByRegion') }}</strong><br>
              <span v-for="(count, region) in data.distribucion_regiones" :key="region">
                {{ region }}: {{ count }} {{ count > 1 ? $t('informe.adhesiones') : $t('informe.adhesion') }} ·
              </span>
            </div>
            <div style="font-size:14px;color:var(--text2);line-height:2">
              <strong style="color:var(--text)">{{ $t('informe.geoByCity') }}</strong><br>
              <span v-for="ciudad in data.distribucion_ciudades.slice(0,10)" :key="ciudad">
                {{ ciudad }} ·
              </span>
              <span v-if="data.distribucion_ciudades.length > 10">
                {{ $t('informe.moreCities', { n: data.distribucion_ciudades.length - 10 }) }}
              </span>
            </div>
          </div>

        </div><!-- fin columna izquierda -->

        <!-- ═══════════════════════════════════════════════
             COLUMNA DERECHA
        ════════════════════════════════════════════════ -->
        <div class="informe-right">

          <!-- BLOQUE — Los tres números -->
          <div class="inf-block" style="margin-bottom:20px">
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
            </div>
          </div>

          <!-- BLOQUE — Calidad de la verificación -->
          <div class="inf-block" style="margin-bottom:20px">
            <div class="inf-block-title">{{ $t('informe.fiabilidadTitle') }}</div>
            <div v-if="data.desglose_fiabilidad" style="display:flex;flex-direction:column;gap:14px">

              <div v-if="data.desglose_fiabilidad.alta.count > 0">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
                  <span style="color:var(--accent2);font-weight:600">{{ $t('informe.fiabilidadAlta') }}</span>
                  <span style="color:var(--text2)">{{ data.desglose_fiabilidad.alta.count }} {{ $t('informe.ciudadanos') }}</span>
                </div>
                <div style="background:var(--bg4);border-radius:6px;height:10px;overflow:hidden">
                  <div :style="{width: pct(data.desglose_fiabilidad.alta.count) + '%', background:'var(--accent2)', height:'100%', borderRadius:'6px', transition:'width .5s'}"></div>
                </div>
                <div style="font-size:12px;color:var(--text3);margin-top:4px;line-height:1.5">{{ data.desglose_fiabilidad.alta.descripcion }}</div>
              </div>

              <div v-if="data.desglose_fiabilidad.media.count > 0">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
                  <span style="color:var(--accent4);font-weight:600">{{ $t('informe.fiabilidadMedia') }}</span>
                  <span style="color:var(--text2)">{{ data.desglose_fiabilidad.media.count }} {{ $t('informe.ciudadanos') }}</span>
                </div>
                <div style="background:var(--bg4);border-radius:6px;height:10px;overflow:hidden">
                  <div :style="{width: pct(data.desglose_fiabilidad.media.count) + '%', background:'var(--accent4)', height:'100%', borderRadius:'6px', transition:'width .5s'}"></div>
                </div>
                <div style="font-size:12px;color:var(--text3);margin-top:4px;line-height:1.5">{{ data.desglose_fiabilidad.media.descripcion }}</div>
              </div>

              <div v-if="data.desglose_fiabilidad.base.count > 0">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
                  <span style="color:var(--accent);font-weight:600">{{ $t('informe.fiabilidadBase') }}</span>
                  <span style="color:var(--text2)">{{ data.desglose_fiabilidad.base.count }} {{ $t('informe.ciudadanos') }}</span>
                </div>
                <div style="background:var(--bg4);border-radius:6px;height:10px;overflow:hidden">
                  <div :style="{width: pct(data.desglose_fiabilidad.base.count) + '%', background:'var(--accent)', height:'100%', borderRadius:'6px', transition:'width .5s'}"></div>
                </div>
                <div style="font-size:12px;color:var(--text3);margin-top:4px;line-height:1.5">{{ data.desglose_fiabilidad.base.descripcion }}</div>
              </div>

              <div v-if="data.desglose_fiabilidad.sin_dato.count > 0">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
                  <span style="color:var(--text3);font-weight:600">{{ $t('informe.fiabilidadSin') }}</span>
                  <span style="color:var(--text2)">{{ data.desglose_fiabilidad.sin_dato.count }} {{ $t('informe.ciudadanos') }}</span>
                </div>
                <div style="font-size:12px;color:var(--text3);line-height:1.5">{{ $t('informe.fiabilidadSinDesc') }}</div>
              </div>

            </div>
            <div v-else style="font-size:14px;color:var(--text3)">{{ $t('informe.fiabilidadNoData') }}</div>
          </div>

          <!-- BLOQUE LOCAL — Desglose geográfico -->
          <div v-if="data.desglose_geografico_local" class="inf-block" style="margin-bottom:20px">
            <div class="inf-block-title">📍 {{ $t('informe.geoLocalTitle') }}</div>
            <div style="font-size:13px;color:var(--text3);margin-bottom:16px;line-height:1.6">
              {{ data.desglose_geografico_local.scope === 'regional'
                ? $t('informe.geoRegionalSubtitle', { region: data.desglose_geografico_local.municipio })
                : $t('informe.geoLocalSubtitle', { municipio: data.desglose_geografico_local.municipio }) }}
            </div>
            <div style="margin-bottom:14px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font-size:14px;font-weight:600;color:var(--accent2)">📍 {{ $t('informe.geoLocalVerified') }}</span>
                <span style="font-size:14px;color:var(--text)">{{ data.desglose_geografico_local.gps_local }}</span>
              </div>
              <div style="height:8px;background:var(--bg3);border-radius:6px;overflow:hidden">
                <div :style="barStyleLocal(data.desglose_geografico_local.gps_local, 'var(--accent2)')"></div>
              </div>
              <div style="font-size:12px;color:var(--text3);margin-top:4px;line-height:1.5">{{ $t('informe.geoLocalVerifiedDesc', { municipio: data.desglose_geografico_local.municipio }) }}</div>
            </div>
            <div style="margin-bottom:14px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font-size:14px;font-weight:600;color:var(--accent4)">🌐 {{ $t('informe.geoNational') }}</span>
                <span style="font-size:14px;color:var(--text)">{{ data.desglose_geografico_local.nacionales_sin_gps }}</span>
              </div>
              <div style="height:8px;background:var(--bg3);border-radius:6px;overflow:hidden">
                <div :style="barStyleLocal(data.desglose_geografico_local.nacionales_sin_gps, 'var(--accent4)')"></div>
              </div>
              <div style="font-size:12px;color:var(--text3);margin-top:4px;line-height:1.5">{{ $t('informe.geoNationalDesc') }}</div>
            </div>
            <div v-if="data.desglose_geografico_local.internacionales > 0" style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font-size:14px;font-weight:600;color:var(--accent)">🌍 {{ $t('informe.geoInternational') }}</span>
                <span style="font-size:14px;color:var(--text)">{{ data.desglose_geografico_local.internacionales }}</span>
              </div>
              <div style="height:8px;background:var(--bg3);border-radius:6px;overflow:hidden">
                <div :style="barStyleLocal(data.desglose_geografico_local.internacionales, 'var(--accent)')"></div>
              </div>
              <div style="font-size:12px;color:var(--text3);margin-top:4px;line-height:1.5">{{ $t('informe.geoInternationalDesc') }}</div>
            </div>
          </div>

          <!-- BLOQUE — GPS -->
          <div class="inf-block" style="margin-bottom:20px">
            <div class="inf-block-title">{{ $t('informe.gpsTitle') }}</div>
            <div style="display:flex;gap:10px;margin-bottom:12px">
              <div style="flex:1;background:rgba(76,255,164,.06);border:.5px solid rgba(76,255,164,.2);border-radius:var(--r);padding:14px;text-align:center">
                <div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--accent2)">{{ data.adhesiones_con_gps }}</div>
                <div style="font-size:13px;color:var(--text3);margin-top:4px">{{ $t('informe.gpsVerified') }}</div>
              </div>
              <div style="flex:1;background:rgba(124,111,255,.06);border:.5px solid var(--border);border-radius:var(--r);padding:14px;text-align:center">
                <div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--accent)">{{ data.adhesiones_sin_gps }}</div>
                <div style="font-size:13px;color:var(--text3);margin-top:4px">{{ $t('informe.gpsSim') }}</div>
              </div>
            </div>
            <div style="font-size:13px;color:var(--text3);line-height:1.7">{{ $t('informe.gpsNote') }}</div>
          </div>

          <!-- BLOQUE — Señal de humanidad -->
          <div class="inf-block" style="margin-bottom:20px">
            <div class="inf-block-title">{{ $t('informe.humanidadTitle') }}</div>
            <div style="font-size:14px;color:var(--text2);line-height:2">
              · {{ data.paises_distintos }} {{ data.paises_distintos === 1 ? $t('informe.pais') : $t('informe.paises') }}<br>
              · {{ data.idiomas_distintos }} {{ data.idiomas_distintos === 1 ? $t('informe.idioma') : $t('informe.idiomas') }}<br>
              · {{ $t('informe.firstAdhesion') }} {{ formatDateTime(data.primera_adhesion) }}<br>
              · {{ $t('informe.lastAdhesion') }} {{ formatDateTime(data.ultima_adhesion) }}
            </div>
          </div>

          <!-- BLOQUE — Velocidad de crecimiento -->
          <div class="inf-block" style="margin-bottom:20px">
            <div class="inf-block-title">{{ $t('informe.velocidadTitle') }}</div>
            <div v-if="data.velocidad">
              <div style="display:flex;gap:10px;margin-bottom:14px">
                <div style="flex:1;background:var(--bg3);border-radius:var(--r);padding:14px;text-align:center">
                  <div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--accent2)">{{ data.velocidad.media_diaria }}</div>
                  <div style="font-size:13px;color:var(--text3);margin-top:4px">{{ $t('informe.velocidadMediaDiaria') }}</div>
                </div>
                <div v-if="data.velocidad.dia_pico" style="flex:1;background:var(--bg3);border-radius:var(--r);padding:14px;text-align:center">
                  <div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--accent)">{{ data.velocidad.dia_pico.count }}</div>
                  <div style="font-size:13px;color:var(--text3);margin-top:4px">{{ $t('informe.velocidadPico') }} {{ formatDate(data.velocidad.dia_pico.fecha) }}</div>
                </div>
              </div>
              <div style="font-size:13px;color:var(--text3);margin-bottom:8px">{{ $t('informe.velocidadPorDia') }}</div>
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
            <div v-else style="font-size:14px;color:var(--text3)">{{ $t('informe.velocidadNoData') }}</div>
          </div>

          <!-- BLOQUE — Cadena de verificación -->
          <div class="inf-block" style="margin-bottom:20px">
            <div class="inf-block-title">{{ $t('informe.chainTitle') }}</div>
            <div style="font-size:14px;color:var(--text2);line-height:1.8">
              {{ $t('informe.chainBody') }}
            </div>
          </div>

          <!-- BLOQUE — Sello de integridad -->
          <div class="inf-block" style="margin-bottom:28px">
            <div class="inf-block-title">{{ $t('informe.selloTitle') }}</div>

            <div v-if="data.protest.hash_integridad" style="margin-bottom:14px;padding:14px 16px;background:rgba(76,255,164,.06);border:.5px solid rgba(76,255,164,.25);border-radius:var(--r)">
              <div style="font-size:12px;color:var(--text3);margin-bottom:8px">{{ $t('informe.selloHashLabel') }}</div>
              <div style="font-family:monospace;font-size:12px;color:var(--accent2);word-break:break-all;margin-bottom:10px;line-height:1.6">{{ data.protest.hash_integridad }}</div>
              <div style="font-size:13px;color:var(--text3);line-height:1.6">{{ $t('informe.selloDesc') }}</div>
              <div style="font-size:12px;color:var(--text3);margin-top:8px;padding-top:8px;border-top:.5px solid var(--border);font-family:monospace;opacity:.7;line-height:1.5">{{ $t('informe.selloVerify') }}</div>
            </div>
            <div v-else style="margin-bottom:14px;padding:12px 14px;background:var(--bg2);border:.5px solid var(--border);border-radius:var(--r);font-size:14px;color:var(--text3);line-height:1.6">
              ⏳ {{ $t('informe.selloHashPending') }}
            </div>

            <div v-if="data.protest.hash_integridad" style="margin-top:10px;margin-bottom:14px">
              <button @click="verifyIntegrity"
                style="width:100%;padding:10px;background:rgba(76,255,164,.08);border:.5px solid rgba(76,255,164,.3);border-radius:var(--r);color:var(--accent2);font-size:13px;font-weight:600;cursor:pointer">
                🔍 {{ verifyState === 'running' ? $t('informe.verifyRunning') : $t('informe.verifyBtn') }}
              </button>
              <div v-if="verifyResult" style="margin-top:10px;padding:10px 12px;border-radius:var(--r);font-size:13px;line-height:1.6"
                :style="verifyResult === 'ok' ? 'background:rgba(76,255,164,.08);border:.5px solid rgba(76,255,164,.3)' : verifyResult === 'v1' ? 'background:rgba(124,111,255,.08);border:.5px solid rgba(124,111,255,.3)' : 'background:rgba(255,80,80,.08);border:.5px solid rgba(255,80,80,.3)'">
                {{ verifyResult === 'ok' ? $t('informe.verifyOk') : verifyResult === 'v1' ? $t('informe.verifyV1') : $t('informe.verifyFail') }}
              </div>
            </div>

            <div style="font-size:13px;color:var(--text2);line-height:1.9">
              {{ $t('informe.selloSourceDesc') }}<br>
              <button
                onclick="window.open('https://github.com/cero-absoluto/vozciudadana','_blank')"
                style="background:transparent;border:.5px solid var(--accent);border-radius:var(--r);padding:6px 14px;color:var(--accent);cursor:pointer;font-size:13px;margin-top:6px;margin-bottom:4px">
                {{ $t('informe.selloSourceBtn') }}
              </button><br>
              {{ $t('informe.selloGenerated') }} {{ formatDateTime(new Date().toISOString()) }}<br>
              {{ $t('informe.selloId') }} <span style="font-family:monospace;font-size:12px;color:var(--accent2)">{{ $route.params.id }}</span><br>
              <span style="color:var(--text3);font-size:12px">{{ $t('informe.selloBlockchain') }}</span>
            </div>
          </div>

        </div><!-- fin columna derecha -->

        <!-- Botones -->
        <div style="display:flex;gap:10px;margin-top:4px;flex-wrap:wrap">
          <button class="btn-primary" style="flex:1;padding:12px" @click="$router.back()">{{ $t('informe.back') }}</button>
          <button class="btn-primary" style="flex:1;padding:12px;background:var(--accent2);color:#000" @click="downloadPDF">{{ $t('informe.downloadPdf') }}</button>
          <button class="btn-primary" style="flex:1;padding:12px;background:rgba(76,111,255,.2);border:.5px solid #4C6FFF;color:#4C6FFF" @click="showEmbed=true">{{ $t('informe.embedBtn') }}</button>
        </div>

        <!-- Embed modal -->
        <div v-if="showEmbed" style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999;display:flex;align-items:center;justify-content:center;padding:24px" @click.self="showEmbed=false">
          <div style="background:#13111F;border:.5px solid rgba(255,255,255,.1);border-radius:16px;padding:24px;max-width:500px;width:100%">
            <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px">{{ $t('informe.embedTitle') }}</div>
            <div style="font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.7">{{ $t('informe.embedDesc') }}</div>
            <div style="background:#0C0B14;border:.5px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;font-family:monospace;font-size:12px;color:#4CFFA4;word-break:break-all;margin-bottom:14px;line-height:1.7">{{ embedCode }}</div>
            <div style="display:flex;gap:10px">
              <button class="btn-primary" style="flex:1;background:#4C6FFF" @click="copyEmbed">{{ copied ? $t('informe.embedCopied') : $t('informe.embedCopy') }}</button>
              <button class="btn-primary" style="flex:1;background:transparent;border:.5px solid var(--border2);color:var(--text2)" @click="showEmbed=false">{{ $t('informe.embedClose') }}</button>
            </div>
            <div style="margin-top:18px;padding-top:16px;border-top:.5px solid var(--border)">
              <div style="font-size:12px;color:var(--text2);margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px">{{ $t('informe.embedPreview') }}</div>
              <div style="background:#0C0B14;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px 20px;max-width:320px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                  <span style="font-size:12px;font-weight:700;color:#4CFFA4;text-transform:uppercase">🗳 Voice Protest</span>
                  <span style="font-size:12px;color:#4CFFA4;background:rgba(76,255,164,.1);border-radius:20px;padding:2px 7px">● LIVE</span>
                </div>
                <div style="font-size:12px;font-weight:600;color:#fff;margin-bottom:6px;line-height:1.4">{{ data?.protest?.title }}</div>
                <div style="font-size:28px;font-weight:800;color:#4CFFA4;line-height:1">{{ data?.total_adhesiones?.toLocaleString('en') }}</div>
                <div style="font-size:12px;color:#8884AA;margin-bottom:10px">{{ $t('informe.embedVerifiedCitizens') }}</div>
                <div style="background:#4C6FFF;border-radius:8px;padding:8px;text-align:center;font-size:12px;font-weight:700;color:#fff">{{ $t('informe.embedJoin') }}</div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
.inf-block {
  background: var(--bg2);
  border: .5px solid var(--border);
  border-radius: var(--r2);
  padding: 18px 20px;
  margin-bottom: 8px;
}
.inf-block-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text3);
  margin-bottom: 12px;
}
.inf-section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text2);
  margin-bottom: 8px;
}
.inf-list {
  margin: 0;
  padding-left: 20px;
  font-size: 14px;
  line-height: 1.75;
}
.inf-list li {
  margin-bottom: 4px;
}
.inf-list-green {
  color: var(--text);
}
.inf-list-muted {
  color: var(--text3);
}
.inf-stats-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}
.inf-sc {
  background: var(--bg3);
  border: .5px solid var(--border);
  border-radius: var(--r);
  padding: 14px 8px;
  text-align: center;
}
.inf-sc-n {
  font-family: 'Syne', sans-serif;
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
}
.inf-sc-l {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .8px;
  color: var(--text3);
  margin-top: 6px;
}
</style>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import * as api from '@/services/api.js';
import { jsPDF } from 'jspdf';

const route = useRoute();
const { t } = useI18n();

const tipoAbusoLabel = computed(() => {
  const tipo = data.value?.protest?.tipo_abuso;
  const map = {
    corruption:        t('informe.abusoCorrupcion'),
    nepotism:          t('informe.abusoNepotismo'),
    rights_violation:  t('informe.abusoDerechos'),
    negligence:        t('informe.abusoNegligencia'),
    repression:        t('informe.abusoRepresion'),
    opacity:           t('informe.abusoOpacidad'),
    other_public_abuse: t('informe.abusoOtro'),
  };
  return map[tipo] || tipo || '—';
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
    if (version < 2) {
      verifyResult.value = 'v1';
      verifyState.value  = 'idle';
      return;
    }
    const apiUrl = import.meta.env.VITE_API_URL;
    const res = await fetch(`${apiUrl}/api/public/protests/${route.params.id}/integrity-data`);
    if (!res.ok) throw new Error('Failed to fetch integrity data');
    const d = await res.json();
    const sorted = [...d.public_commitments].sort();
    const cities = Object.entries(d.city_distribution || {})
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([k,v]) => `${k}:${v}`).join(',');
    const rel = Object.entries(d.reliability_breakdown || {})
      .sort((a,b) => a[0] - b[0])
      .map(([k,v]) => `${k}:${v}`).join(',');
    const input = [
      d.protest_id, d.title, d.demands, d.scope, d.country,
      d.total_adhesions, d.cities_count,
      rel, cities,
      d.first_adhesion || '',
      d.last_adhesion  || '',
      sorted.join('|')
    ].join('|');
    const msgBuffer  = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray  = Array.from(new Uint8Array(hashBuffer));
    const hashHex    = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    verifyResult.value = hashHex === d.integrity_hash ? 'ok' : 'fail';
  } catch {
    verifyResult.value = 'fail';
  } finally {
    verifyState.value = 'idle';
  }
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

function pctLocal(count) {
  const total = data.value?.desglose_geografico_local?.total;
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function barStyleLocal(count, color) {
  return {
    width: pctLocal(count) + '%',
    background: color,
    height: '100%',
    borderRadius: '6px',
    transition: 'width .5s',
  };
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
  function line() { doc.setDrawColor(76,255,164); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); nl(6); }
  function h2(txt) { doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(76,255,164); doc.text(txt.toUpperCase(), M, y); nl(8); }
  function body(txt, opts={}) {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(11); doc.setTextColor(220,218,240);
    const lines = doc.splitTextToSize(txt, CW);
    lines.forEach(l => { if (y > 265) { doc.addPage(); setPageBg(); y = 22; } doc.text(l, M, y); nl(7); });
  }
  function kv(k, v) {
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(76,255,164);
    doc.text(k + ':', M, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(240,238,255);
    const val = doc.splitTextToSize(String(v), CW - 48);
    doc.text(val[0], M + 48, y);
    nl(7);
  }
  function setPageBg() { doc.setFillColor(12,11,20); doc.rect(0,0,210,297,'F'); }

  setPageBg();
  y = 20;

  doc.setFillColor(30,27,50); doc.rect(0, 10, 210, 30, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(76,255,164);
  doc.text('VOICE PROTEST — VERIFIED PUBLIC REPORT', M, 18);
  doc.setFontSize(8); doc.setTextColor(180,178,200);
  doc.text('www.voiceprotest.org', M, 24);
  doc.setFontSize(8); doc.setTextColor(140,138,170);
  doc.text('Generated: ' + new Date().toISOString(), M, 30);
  y = 46;

  doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(255,255,255);
  const titleLines = doc.splitTextToSize(d.protest.title, CW);
  titleLines.forEach(l => { doc.text(l, M, y); nl(8); });
  nl(2);

  if (d.protest.demands && d.protest.focal_point) {
    doc.setFillColor(20,18,35); doc.rect(M-2, y-4, CW+4, 14, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,179,71);
    const headline = d.total_adhesiones + ' verified citizens demand to ' + d.protest.focal_point + ': ' + d.protest.demands;
    const hl = doc.splitTextToSize(headline, CW);
    hl.forEach(l => { doc.text(l, M, y); nl(5); });
    nl(3);
  }

  line();
  h2('1. CONVOCATION DETAILS');
  kv('Country', d.protest.country_name || '—');
  kv('Scope', d.protest.scope || '—');
  kv('Focal point', d.protest.focal_point || '—');
  kv('Start date', d.protest.starts_at ? new Date(d.protest.starts_at).toLocaleDateString('en-GB') : '—');
  kv('End date', d.protest.ends_at ? new Date(d.protest.ends_at).toLocaleDateString('en-GB') : '—');
  if (d.protest.tipo_abuso) kv('Abuse type', d.protest.tipo_abuso);
  if (d.protest.fuente_url) kv('Source', d.protest.fuente_url);
  if (d.protest.demands) { nl(1); body('Demands: ' + d.protest.demands); }
  nl(2); line();

  h2('2. KEY FIGURES');
  kv('Total verified adhesions', d.total_adhesiones);
  kv('Distinct cities', d.ciudades_distintas);
  kv('Distinct countries', d.paises_distintos);
  kv('Distinct languages', d.idiomas_distintos);
  kv('Adhesions with GPS', d.adhesiones_con_gps + ' (' + Math.round(d.adhesiones_con_gps/Math.max(d.total_adhesiones,1)*100) + '%)');
  kv('First adhesion', d.primera_adhesion ? new Date(d.primera_adhesion).toLocaleString('en-GB') : '—');
  kv('Last adhesion', d.ultima_adhesion ? new Date(d.ultima_adhesion).toLocaleString('en-GB') : '—');
  nl(2); line();

  h2('3. VERIFICATION QUALITY');
  if (d.desglose_fiabilidad) {
    const fi = d.desglose_fiabilidad;
    if (fi.alta?.count > 0) kv('High reliability (85-95%)', fi.alta.count + ' citizens');
    if (fi.media?.count > 0) kv('Medium reliability (75-84%)', fi.media.count + ' citizens');
    if (fi.base?.count > 0) kv('Base reliability (60-74%)', fi.base.count + ' citizens');
    if (fi.sin_dato?.count > 0) kv('Unclassified', fi.sin_dato.count + ' citizens');
  }
  nl(2); line();

  h2('4. GEOGRAPHIC DISTRIBUTION');
  if (d.distribucion_regiones && Object.keys(d.distribucion_regiones).length > 0) {
    body('By region:', {bold:true});
    Object.entries(d.distribucion_regiones).forEach(([r, c]) => body('  ' + r + ': ' + c + ' adhesion' + (c>1?'s':'') ));
    nl(1);
  }
  if (d.distribucion_ciudades?.length > 0) {
    body('Top cities: ' + d.distribucion_ciudades.slice(0,15).join(' · '));
  }
  nl(2); line();

  h2('5. VERIFICATION CHAIN');
  body('Each adhesion was verified through: reCAPTCHA v3 + SMS OTP + HMAC-SHA256 pseudonymisation + device uniqueness.');
  nl(2); line();

  h2('6. TRANSPARENCY SEAL');
  kv('Convocation ID', route.params.id);
  kv('Open source', 'github.com/cero-absoluto/vozciudadana (AGPL 3.0)');
  kv('Report generated', new Date().toISOString());
  if (d.protest.hash_integridad) {
    nl(1);
    body('Integrity hash (HMAC-SHA256 at closure):', {bold:true});
    doc.setFont('courier','normal'); doc.setFontSize(9); doc.setTextColor(76,255,164);
    const hashLines = doc.splitTextToSize(d.protest.hash_integridad, CW);
    hashLines.forEach(l => { doc.text(l, M, y); nl(4); });
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(20,18,35); doc.rect(0, 285, 210, 12, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(140,138,170);
    doc.text('Voice Protest — Verified Citizen Protest Platform — AGPL 3.0', M, 291);
    doc.text('Page ' + i + ' of ' + totalPages, W - M, 291, {align:'right'});
  }

  const filename = 'vozciudadana-report-' + d.protest.title.replace(/[^a-z0-9]/gi,'-').toLowerCase().slice(0,40) + '.pdf';
  doc.save(filename);
}
</script>
