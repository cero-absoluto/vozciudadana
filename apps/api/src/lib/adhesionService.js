// ── AdhesionService (VP-SEC-008 fix, Fase 2 — Despliegue A, 23 July 2026) ──
//
// The single, conceptually authorised place in the application allowed to
// create an adhesion. Every verification method (SMS today; institutional,
// QR, eID as each migrates) proves its own identity in its own route, then
// calls this with a common VerifiedIdentity shape — this service applies
// the convocatoria's admission policy, resolves location evidence, computes
// the nullifier and reliability score, and persists everything through one
// transactional RPC (create_verified_adhesion, see the migration of the
// same name). No route should ever INSERT INTO adhesions directly.
//
// Per the auditor's framing of the division of responsibility:
//   Route:            "this proof of identity is authentic."
//   AdhesionService:  "this authentic identity may participate here."

import { createHmac } from 'crypto';
import { supabase } from '../services/supabase.js';
import { resolveLocationEvidence } from './locationEvidenceService.js';

// ── Domain errors — the route layer maps these to HTTP responses ──────────
export class AdhesionError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}
export class ProtestNotFoundError extends AdhesionError {
  constructor() { super('PROTEST_NOT_FOUND', 'Protest not found'); }
}
export class ProtestClosedError extends AdhesionError {
  constructor() { super('PROTEST_CLOSED', 'This convocatoria has closed'); }
}
export class BalanceExhaustedError extends AdhesionError {
  constructor() { super('BALANCE_EXHAUSTED', 'Esta convocatoria no tiene saldo. Apóyala con una donación.'); }
}
export class AlreadyJoinedError extends AdhesionError {
  constructor() { super('ALREADY_JOINED', 'You have already joined this convocatoria — one verified adhesion per person, per event.'); }
}
export class MembershipAlreadyExistsError extends AdhesionError {
  constructor() { super('MEMBERSHIP_ALREADY_EXISTS', 'This email has already registered institutional membership for this convocatoria.'); }
}
export class NationalCountryMismatchError extends AdhesionError {
  constructor() { super('NATIONAL_ONLY', 'protests country does not match device country'); }
}

// ── Institutional OTP errors (VP-SEC-008 Despliegue B, 24 July 2026) ──────
export class OtpNotFoundError extends AdhesionError {
  constructor() { super('OTP_NOT_FOUND', 'Código incorrecto o caducado'); }
}
export class OtpAlreadyUsedError extends AdhesionError {
  constructor() { super('OTP_ALREADY_USED', 'Código incorrecto o caducado'); }
}
export class OtpExpiredError extends AdhesionError {
  constructor() { super('OTP_EXPIRED', 'Código incorrecto o caducado'); }
}
export class TooManyAttemptsError extends AdhesionError {
  constructor() { super('TOO_MANY_ATTEMPTS', 'Demasiados intentos. Solicita un nuevo código.'); }
}
export class WrongOtpError extends AdhesionError {
  constructor() { super('WRONG_OTP', 'Código incorrecto o caducado'); }
}

const RPC_ERROR_MAP = {
  VP_PROTEST_NOT_FOUND:            ProtestNotFoundError,
  VP_PROTEST_CLOSED:               ProtestClosedError,
  VP_BALANCE_EXHAUSTED:            BalanceExhaustedError,
  VP_ALREADY_JOINED:               AlreadyJoinedError,
  VP_MEMBERSHIP_ALREADY_EXISTS:    MembershipAlreadyExistsError,
  VP_OTP_NOT_FOUND:                OtpNotFoundError,
  VP_OTP_ALREADY_USED:             OtpAlreadyUsedError,
  VP_OTP_EXPIRED:                  OtpExpiredError,
  VP_TOO_MANY_ATTEMPTS:            TooManyAttemptsError,
  VP_WRONG_OTP:                    WrongOtpError,
  // VP_INVALID_VERIFICATION_METHOD is deliberately NOT mapped to a domain
  // error here — it can only mean a bug in this service's own calling code
  // (sending a method the database doesn't recognise), never a legitimate
  // client-facing outcome. It is left to fall through to the generic
  // rethrow below, surfacing as a real 500 rather than a handled case, so
  // it cannot be mistaken for an expected rejection during testing.
};

function throwMappedRpcError(error) {
  const mapped = RPC_ERROR_MAP[error.message];
  if (mapped) throw new mapped();
  if (error.code === '23505') throw new AlreadyJoinedError();
  throw error;
}

/**
 * Verify an institutional OTP and create the adhesion atomically
 * (VP-SEC-008 Despliegue B, 24 July 2026) — calls
 * verify_institutional_otp_and_create_adhesion(), which locks and consumes
 * the OTP and calls create_verified_adhesion() internally, in one
 * transaction: a failed adhesion rolls back the OTP consumption too.
 *
 * @param {{ emailHash: string, protestId: string, submittedOtpHash: string, location: LocationEvidenceInput, institutionalExpiresAt: string }} input
 * @returns {Promise<{ id: string, created_at: string }>}
 */
export async function verifyInstitutionalOtpAndCreateAdhesion({ emailHash, protestId, submittedOtpHash, location, institutionalExpiresAt }) {
  const evidence = await resolveLocationEvidence({
    latitude: null, longitude: null, // institutional convocatorias never collect GPS
    accuracyMeters: null,
    ip: location?.ip ?? null,
    scope: 'global',
  });

  const nullifier = computeNullifier({ method: 'institutional_email_otp', subjectHash: emailHash, protestId });

  const { data, error } = await supabase.rpc('verify_institutional_otp_and_create_adhesion', {
    p_email_hash:               emailHash,
    p_protest_id:               protestId,
    p_submitted_otp_hash:       submittedOtpHash,
    p_identity_subject_hash:    emailHash,
    p_nullifier:                nullifier,
    p_ciudad:                   evidence.ciudad,
    p_region:                   evidence.region,
    p_pais:                     evidence.pais,
    p_pais_code:                evidence.pais_code,
    p_idioma:                   location?.language ?? null,
    p_institutional_expires_at: institutionalExpiresAt,
  });

  if (error) throwMappedRpcError(error);
  return data;
}

/**
 * @typedef {'phone_otp'|'institutional_email_otp'|'qr'|'eid'} VerificationMethod
 *
 * @typedef {Object} VerifiedIdentity
 * @property {string} subjectHash        HMAC of the verified identity (phone hash, email hash, eID subject, etc.)
 * @property {VerificationMethod} method
 * @property {string|null} deviceId
 * @property {string|null} countryCode   Device/SIM country, for national-scope matching
 * @property {string|null} institutionalDomain
 *
 * @typedef {Object} LocationEvidenceInput
 * @property {number|null} latitude
 * @property {number|null} longitude
 * @property {number|null} accuracyMeters
 * @property {string|null} ip
 * @property {string|null} language
 *
 * @typedef {Object} CreateVerifiedAdhesionInput
 * @property {string} protestId
 * @property {VerifiedIdentity} identity
 * @property {LocationEvidenceInput} location
 * @property {string|null} documentHash
 * @property {{ emailHash: string, expiresAt: string }|null} institutionalMembership
 */

// Domain separation for the nullifier (per the auditor): different
// verification methods do not share an identity space, and the version
// prefix lets the format evolve later without colliding with today's values.
export function computeNullifier({ method, subjectHash, protestId }) {
  const material = ['v1', method, subjectHash, protestId].join(':');
  return createHmac('sha256', process.env.NULLIFIER_SECRET || 'dev-secret')
    .update(material)
    .digest('hex');
}

// Identity-signal label shown in the reliability breakdown — 'sim' is kept
// for phone_otp specifically since that is the term already used throughout
// the Methodology and the public report; other methods are labelled by name.
function identitySignalLabel(method) {
  return method === 'phone_otp' ? 'sim' : method;
}

/**
 * @param {CreateVerifiedAdhesionInput} input
 * @returns {Promise<{ id: string, created_at: string, ciudad: string|null, region: string|null, pais: string|null, adhesion_osm_id: number|null }>}
 */
export async function createVerifiedAdhesion(input) {
  const { protestId, identity, location, documentHash, institutionalMembership } = input;

  // Convocatoria admission policy that depends on BOTH the convocatoria and
  // the verification method lives here, not in the route — per the
  // auditor, this is exactly what stops a future route (QR, eID) from
  // forgetting a restriction a route author didn't think to duplicate.
  const { data: protest, error: protestErr } = await supabase
    .from('protests')
    .select('scope, country, convocatoria_osm_id, convocatoria_ciudad_nombre, dominio_email')
    .eq('id', protestId)
    .maybeSingle();

  if (protestErr || !protest) throw new ProtestNotFoundError();

  if (protest.scope === 'national' && protest.country && identity.method === 'phone_otp') {
    if (!identity.countryCode || identity.countryCode !== protest.country) {
      throw new NationalCountryMismatchError();
    }
  }

  if (identity.method === 'institutional_email_otp' && protest.dominio_email &&
      identity.institutionalDomain?.toLowerCase() !== protest.dominio_email.toLowerCase()) {
    throw new AdhesionError('INSTITUTIONAL_DOMAIN_MISMATCH', 'Institutional domain does not match this convocatoria');
  }

  // Location resolution happens here, before the transaction — depends on
  // external services (Nominatim, ipapi.co) that must never hold a
  // PostgreSQL transaction open while they respond.
  const evidence = await resolveLocationEvidence({
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    accuracyMeters: location?.accuracyMeters ?? null,
    ip: location?.ip ?? null,
    scope: protest.scope,
  });

  const tieneGps    = evidence.gps_confirmed;
  const tieneIpPais = !!evidence.pais_code;
  let fiabilidad = 60;
  let senalesArr = ['ip'];
  const idSignal = identitySignalLabel(identity.method);
  if (tieneGps && tieneIpPais)       { fiabilidad = 95; senalesArr = ['gps', idSignal, 'ip']; }
  else if (tieneGps)                 { fiabilidad = 92; senalesArr = ['gps', idSignal]; }
  else if (tieneIpPais)              { fiabilidad = 85; senalesArr = [idSignal, 'ip']; }
  else                                { fiabilidad = 75; senalesArr = [idSignal]; }

  const nullifier = computeNullifier({ method: identity.method, subjectHash: identity.subjectHash, protestId });

  const { data, error } = await supabase.rpc('create_verified_adhesion', {
    p_protest_id:               protestId,
    p_identity_subject_hash:    identity.subjectHash,
    p_verification_method:      identity.method,
    p_nullifier:                nullifier,
    p_device_id:                identity.deviceId ?? null,
    p_doc_hash:                 documentHash ?? null,
    p_ciudad:                   evidence.ciudad,
    p_region:                   evidence.region,
    p_pais:                     evidence.pais,
    p_pais_code:                evidence.pais_code,
    p_idioma:                   location?.language ?? null,
    p_adhesion_osm_id:          evidence.adhesion_osm_id,
    p_gps_confirmed:            evidence.gps_confirmed,
    p_fiabilidad:               fiabilidad,
    p_senales:                  senalesArr.join(','),
    p_institutional_email_hash: institutionalMembership?.emailHash ?? null,
    p_institutional_expires_at: institutionalMembership?.expiresAt ?? null,
  });

  if (error) throwMappedRpcError(error);

  return data;
}
