// ── LocationEvidenceService (VP-SEC-008 fix, Fase 2 — Despliegue A) ────────
//
// Extracted from what used to be inline in routes/protests.js's /join
// handler, so every verification method (SMS today; institutional, QR, eID
// as they migrate) resolves location the same way, with the same timeouts
// and the same fallback order. Per the auditor: this must run BEFORE the
// database transaction, not inside it — it depends on two external services
// (Nominatim, ipapi.co) that can be slow or briefly unavailable, and a
// transaction should never be left open waiting on an HTTP call outside the
// database. A failure here degrades the evidence (less certain city/region,
// gps_confirmed=false) — it never blocks the adhesion itself.

/**
 * @typedef {Object} LocationEvidenceInput
 * @property {number|null} latitude
 * @property {number|null} longitude
 * @property {number|null} accuracyMeters
 * @property {string|null} ip
 * @property {'local'|'regional'|'national'|'global'} scope
 *
 * @typedef {Object} LocationEvidenceResult
 * @property {string|null} ciudad
 * @property {string|null} region
 * @property {string|null} pais
 * @property {string|null} pais_code
 * @property {number|null} adhesion_osm_id
 * @property {boolean} gps_confirmed
 */

/**
 * @param {LocationEvidenceInput} input
 * @returns {Promise<LocationEvidenceResult>}
 */
export async function resolveLocationEvidence({ latitude, longitude, accuracyMeters, ip, scope }) {
  // Bounds validation (VP-SEC-004) — an out-of-range value is treated
  // exactly like no GPS being provided at all, never trusted at face value.
  const gps_lat = (typeof latitude === 'number' && latitude >= -90 && latitude <= 90) ? latitude : null;
  const gps_lng = (typeof longitude === 'number' && longitude >= -180 && longitude <= 180) ? longitude : null;
  const gps_accuracy = (typeof accuracyMeters === 'number' && accuracyMeters > 0 && accuracyMeters <= 50_000) ? accuracyMeters : null;

  let ciudad = null, region = null, pais = null, pais_code = null, adhesion_osm_id = null;
  let gps_confirmed = false;

  if (gps_lat != null && gps_lng != null) {
    try {
      const zoomLevel = scope === 'regional' ? 6 : 10;
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${gps_lat}&lon=${gps_lng}&format=json&zoom=${zoomLevel}`,
        { headers: { 'Accept-Language': 'es', 'User-Agent': 'VozCiudadana/1.0' }, signal: AbortSignal.timeout(6000) }
      );
      const geoData = await geoRes.json();
      ciudad = geoData.address?.city || geoData.address?.town || geoData.address?.village ||
               geoData.address?.suburb || geoData.address?.hamlet ||
               geoData.address?.locality || geoData.address?.municipality || null;
      region = geoData.address?.state || geoData.address?.county || null;
      pais   = geoData.address?.country || null;
      pais_code = geoData.address?.country_code?.toUpperCase() || null;

      if (geoData.osm_id && (scope === 'local' || scope === 'regional')) {
        adhesion_osm_id = parseInt(geoData.osm_id);
      }
      gps_confirmed = true;
    } catch {
      // Nominatim slow/unavailable — degrade to IP below, never block.
    }
  }

  if (!ciudad && ip) {
    try {
      const geoRes = await fetch(`https://ipapi.co/${ip}/json/`, {
        headers: { 'User-Agent': 'VoiceProtest/1.0 (voiceprotest.org)' },
        signal: AbortSignal.timeout(4000),
      });
      const geo = await geoRes.json();
      ciudad = geo.city || null;
      region = geo.region || null;
      pais   = geo.country_name || null;
      // ipapi returns names in ENGLISH ("Spain") while convocatoria.country_name
      // is stored in Spanish ("España") — never compare names, only ISO codes.
      pais_code = (geo.country_code || geo.country || '').toUpperCase() || null;
      if (pais_code && !/^[A-Z]{2}$/.test(pais_code)) pais_code = null;
    } catch {
      // ipapi slow/unavailable too — the adhesion proceeds with no
      // geographic signal at all, which is an honest, lower-confidence
      // outcome, not a failure.
    }
  }

  return { ciudad, region, pais, pais_code, adhesion_osm_id, gps_confirmed };
}
