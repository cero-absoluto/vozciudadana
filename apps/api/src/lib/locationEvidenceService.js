import { parseGpsGeocoderResponse } from './gpsGeocoder.js';
import { isValidClientIp, ipapiUrl } from './clientIp.js';
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
 * @property {boolean} ip_country_confirmed
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
  let ip_country_confirmed = false;

  if (gps_lat != null && gps_lng != null) {
    try {
      const zoomLevel = scope === 'regional' ? 6 : 10;
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${gps_lat}&lon=${gps_lng}&format=json&zoom=${zoomLevel}`,
        { headers: { 'Accept-Language': 'es', 'User-Agent': 'VozCiudadana/1.0' }, signal: AbortSignal.timeout(6000) }
      );
      const parsed = await parseGpsGeocoderResponse(geoRes, scope);
      ({ ciudad, region, pais, pais_code, adhesion_osm_id } = parsed);
      gps_confirmed = true;
    } catch {
      // Nominatim slow/unavailable — degrade to IP below, never block.
    }
  }

  if (!gps_confirmed && isValidClientIp(ip)) {
    try {
      const geoRes = await fetch(ipapiUrl(ip), {
        headers: { 'User-Agent': 'VoiceProtest/1.0 (voiceprotest.org)' },
        signal: AbortSignal.timeout(4000),
      });
      if (!geoRes.ok) throw new Error('IP geocoder unavailable');
      const geo = await geoRes.json();
      if (!geo || typeof geo !== 'object' || Array.isArray(geo) || geo.error) throw new Error('Invalid IP evidence');
      ciudad = geo.city || null;
      region = geo.region || null;
      pais   = geo.country_name || null;
      // ipapi returns names in ENGLISH ("Spain") while convocatoria.country_name
      // is stored in Spanish ("España") — never compare names, only ISO codes.
      const countryCode = geo.country_code || geo.country;
      pais_code = typeof countryCode === 'string' ? countryCode.toUpperCase() : null;
      if (pais_code && !/^[A-Z]{2}$/.test(pais_code)) pais_code = null;
      ip_country_confirmed = !!pais_code;
    } catch {
      // ipapi slow/unavailable too — the adhesion proceeds with no
      // geographic signal at all, which is an honest, lower-confidence
      // outcome, not a failure.
    }
  }

  const place = value => typeof value === 'string' && value.trim() && value.length <= 512 ? value.trim() : null;
  return { ciudad: place(ciudad), region: place(region), pais: place(pais), pais_code, adhesion_osm_id, gps_confirmed, ip_country_confirmed };
}
