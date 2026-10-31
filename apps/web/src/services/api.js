import { getCensusSession, saveCensusSession, clearCensusSession } from './censusAccess.js';
import {requestJson} from './requestJson.js';
import {validReceipt} from '../lib/participationOutcome.js';
export { getCensusSession } from './censusAccess.js';
/**
 * API client for the Voice Protest Fastify backend.
 *
 * All functions return the parsed JSON body on success and throw an Error
 * with a human-readable message on failure.
 *
 * Usage (once the API is deployed):
 *   import * as api from '@/services/api.js';
 *   const protests = await api.fetchProtests();
 *
 * To wire into stores, replace each `INITIAL_*` / local mutation with the
 * corresponding call below. The TODO comments in each store action point here.
 */

const BASE = import.meta.env.VITE_API_URL ?? '';

async function request(method, path, body, extraHeaders = {}) {
  return requestJson(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body:    body ? JSON.stringify(body) : undefined,
  });
}

// ── Protests ──────────────────────────────────────────────────────────────────

/**
 * Fetch active protests.
 * @param {{ scope?: string, country?: string }} [filters]
 * @returns {Promise<Array>}
 *
 * Replaces: INITIAL_PROTESTS in stores/protests.js
 * Store action: protests.restoreFromStorage() → call this first, then merge
 */
export function fetchProtests(filters = {}) {
  const params = new URLSearchParams();
  if (filters.scope)   params.set('scope',   filters.scope);
  if (filters.country) params.set('country', filters.country);
  const qs = params.toString();
  return request('GET', `/api/protests${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch a single protest by id.
 * @param {number|string} id
 * @returns {Promise<Object>}
 */
export function fetchProtest(id) {
  return request('GET', `/api/protests/${id}`);
}

/**
 * Create a new protest.
 * @param {Object} data  — fields: title, description, demands, country,
 *                         country_name, scope, region, focal_point,
 *                         category, duration_h, starts_at, risk_level
 * @returns {Promise<Object>} created protest
 *
 * Replaces: protests.createProtest() local push in stores/protests.js
 */
export async function createProtest(data) {
  if (data.requiere_censo && data.dominio_email) {
    // Check storage before creating an event whose founder proof cannot be saved.
    sessionStorage.setItem('vc_census_storage_probe', '1');
    sessionStorage.removeItem('vc_census_storage_probe');
  }
  const result = await request('POST', '/api/protests', data);
  if (result.census_creator_key) {
    sessionStorage.setItem(`vc_census_creator:${result.id}`, result.census_creator_key);
    delete result.census_creator_key;
  }
  return result;
}

/**
 * Join a protest (pseudonymous verified adhesion).
 *
 * VP-SEC-001 fix (23 July 2026): this used to send a raw phone_hash and
 * device_id, trusted directly by the server. It now sends the signed
 * participation_token issued by verifyOtp()/reauthDevice() instead — the
 * server reads the real identity from inside that token, never from
 * anything the client asserts directly in the request body.
 * @param {number|string} protestId
 * @param {{ participation_token: string, doc_hash?: string, recaptcha_token: string }} payload
 * @returns {Promise<{ receipt: string }>}
 *
 * Replaces: protests.joinProtest() local mutation in stores/protests.js
 */
export function joinProtest(protestId, payload) {
  return request('POST', `/api/protests/${protestId}/join`, payload);
}

/**
 * Reinforce an existing adhesion with GPS captured after the join call
 * already completed (Capa 1, 21 July 2026) — for someone whose first GPS
 * attempt (in AuthScreen, pre-adhesion) failed, was skipped, or silently
 * didn't happen (see the Capa 0 fix for why that used to be invisible).
 * One-time use, tied to the single-use token issued in the original join
 * response — see PATCH /api/protests/:id/adhesion in the backend, which
 * this reconnects rather than duplicates: the endpoint itself was never
 * removed, only every frontend caller of it was.
 * @param {number|string} protestId
 * @param {{ gps_update_token: string, gps_lat: number, gps_lng: number, gps_accuracy?: number }} payload
 * @returns {Promise<{ ok: boolean, fiabilidad: number, adhesion_osm_id: number|null }>}
 */
export function patchAdhesionGps(protestId, payload) {
  return request('PATCH', `/api/protests/${protestId}/adhesion`, payload);
}

/**
 * Record a viral share for a protest.
 * @param {number|string} protestId
 * @returns {Promise<{ ok: boolean }>}
 *
 * Replaces: protests.incrementViral() local +1 in stores/protests.js
 */
export function incrementViral(protestId) {
  return request('POST', `/api/protests/${protestId}/viral`);
}

// ── Users / OTP ───────────────────────────────────────────────────────────────

/**
 * Request an OTP SMS for the given phone number.
 * @param {{ phone: string, recaptcha_token: string }} payload
 * @returns {Promise<{ sent: boolean }>}
 *
 * Replaces: sendSMS() fake timeout in AuthScreen.vue
 */
export function requestOtp(payload) {
  return request('POST', '/api/users/request-otp', payload);
}

/**
 * Verify the OTP and register the device.
 *
 * VP-SEC-001/002/003 fix (23 July 2026): the response no longer includes a
 * raw phone_hash. It returns a short-lived participation_token (send this,
 * not phone_hash, to joinProtest()) and, only the very first time this
 * device is ever verified, a device_secret — store that in localStorage
 * (never sessionStorage: it must survive across sessions) and present it to
 * reauthDevice() later to skip a fresh OTP without ever exposing phone_hash.
 * @param {{ phone: string, otp: string, device_id: string }} payload
 * @returns {Promise<{ verified: boolean, device_id: string, participation_token: string, device_secret?: string }>}
 *
 * Replaces: verifyOTP() fake navigation in AuthScreen.vue
 */
export function verifyOtp(payload) {
  return request('POST', '/api/users/verify-otp', payload);
}

/**
 * Re-authenticate a returning, already-verified device without a fresh
 * OTP — requires the device_secret minted at first verification (see
 * verifyOtp()). Replaces the old, unauthenticated GET /device/:id, which
 * returned phone_hash to anyone who merely knew the device_id (VP-SEC-002).
 * @param {string} deviceId
 * @param {string} deviceSecret
 * @returns {Promise<{ authenticated: boolean, participation_token: string, country_code: string|null }>}
 */
export function reauthDevice(deviceId, deviceSecret) {
  return request('POST', `/api/users/device/${deviceId}/reauth`, { device_secret: deviceSecret });
}

/**
 * Fetch the active protest locks for a device — requires the same
 * device_secret as reauthDevice() (VP-SEC-002 fix; previously an
 * unauthenticated GET keyed only on device_id).
 * @param {string} deviceId
 * @param {string} deviceSecret
 * @returns {Promise<Array>}
 *
 * Replaces: useDeviceStore().getLocks() localStorage read in stores/device.js
 */
export function fetchDeviceLocks(deviceId, deviceSecret) {
  return request('POST', `/api/users/device/${deviceId}/locks`, { device_secret: deviceSecret });
}

// ── Reference data ────────────────────────────────────────────────────────────

/**
 * Fetch the list of country codes (static reference data, server-cached).
 * @returns {Promise<Array<{ iso2: string, dial_code: number, flag: string, name: string }>>}
 */
export function fetchCountryCodes() {
  return request('GET', '/api/country-codes');
}
// ── Verificación institucional ─────────────────────────────────────────────────

/**
 * Enviar OTP por email institucional.
 * @param {{ email: string, protest_id: string }} payload
 * @returns {Promise<{ sent: boolean }>}
 */
export async function sendEmailOtp(payload) {
  const result = await request('POST', '/api/institucional/send-otp', payload);
  if (result.challenge_id) sessionStorage.setItem(`vc_institutional_challenge:${payload.purpose === 'census' ? 'census' : 'adhesion'}:${payload.protest_id}:${payload.email.toLowerCase()}`, result.challenge_id);
  return result;
}

/**
 * Verificar OTP de email institucional y registrar adhesión.
 * @param {{ email: string, otp: string, protest_id: string }} payload
 * @returns {Promise<{ receipt: string }>}
 */
export async function verifyEmailOtp(payload) {
  const result = await request('POST', '/api/institucional/verify-otp', { ...payload, challenge_id: sessionStorage.getItem(`vc_institutional_challenge:adhesion:${payload.protest_id}:${payload.email.toLowerCase()}`) || '' });
  if (result?.verified !== true || !validReceipt(result.receipt)) throw Object.assign(new Error('INVALID_API_RESPONSE'), {code:'INVALID_API_RESPONSE'});
  if (result.census_session) {
    try { saveCensusSession(payload.protest_id, result.census_session); }
    catch { throw Object.assign(new Error('CENSUS_SESSION_NOT_SAVED'), {code:'CENSUS_SESSION_NOT_SAVED', receipt:result.receipt, verified:result.verified}); }
  }
  return result;
}
export async function verifyCensusOtp(payload) {
  const result = await request('POST', '/api/institucional/census-session', { ...payload, challenge_id: sessionStorage.getItem(`vc_institutional_challenge:census:${payload.protest_id}:${payload.email.toLowerCase()}`) || '' });
  saveCensusSession(payload.protest_id, result.census_session);
  return result;
}
async function censusRequest(method,path,body,protestId) {
  const token = getCensusSession(protestId);
  try { return await request(method,path,body,token ? { Authorization: `Bearer ${token}` } : {}); }
  catch (e) { if (e.status === 401) clearCensusSession(protestId); throw e; }
}
// ── Grafo de vouches ───────────────────────────────────────────────────────────

/**
 * Crear un grupo con nodo génesis.
 * @param {{ protest_id: string, creator_key: string, name: string }} payload
 * @returns {Promise<{ group_id: string }>}
 */
export function crearGrupo(payload) {
  return censusRequest('POST', '/api/grupos/crear', payload, payload.protest_id);
}

/**
 * Solicitar unirse a un grupo.
 * @param {string} groupId
 * @param {{ invite_token: string }} payload
 * @returns {Promise<{ requested: boolean }>}
 */
export function solicitarUnirse(groupId, payload, protestId) {
  return censusRequest('POST', `/api/grupos/${groupId}/solicitar`, payload, protestId);
}

/**
 * Avalar a un candidato.
 * @param {string} groupId
 * @param {{ candidate_id: string }} payload
 * @returns {Promise<Object>}
 */
export function darVouch(groupId, payload, protestId) {
  return censusRequest('POST', `/api/grupos/${groupId}/vouch`, payload, protestId);
}

/**
 * Obtener el estado del grupo.
 * @param {string} groupId
 * @param {string} protestId
 * @returns {Promise<Object>}
 */
export function fetchGrupoEstado(groupId, protestId) {
  return censusRequest('GET', `/api/grupos/${groupId}/estado`, undefined, protestId);
}

/**
 * Generar link de invitación personal.
 * @param {string} groupId
 * @param {Object} payload
 * @returns {Promise<{ token: string, url: string }>}
 */
export function generarInvite(groupId, payload, protestId) {
  return censusRequest('POST', `/api/grupos/${groupId}/invite`, {}, protestId);
}
/**
 * Buscar el grupo asociado a una convocatoria.
 * @param {string} protestId
 * @returns {Promise<{ group_id: string, name: string }>}
 */
export function fetchGrupoPorConvocatoria(protestId) {
  return request('GET', `/api/grupos/convocatoria/${protestId}`);
}

