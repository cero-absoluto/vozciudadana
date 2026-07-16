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

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body:    body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error ?? json.message ?? `API error ${res.status}`);
    if (json.code) err.code = json.code;
    // status + reason let callers tell "the server rejected this input"
    // (4xx, with a human-readable reason) apart from "the network/API is
    // down" (thrown before a response was ever received, see below) — the
    // two need very different handling: a rejection must be shown to the
    // user, never silently treated as if it had succeeded.
    err.status = res.status;
    err.reason = json.reason ?? null;
    throw err;
  }
  return json;
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
export function createProtest(data) {
  return request('POST', '/api/protests', data);
}

/**
 * Join a protest (pseudonymous verified adhesion).
 * @param {number|string} protestId
 * @param {{ phone_hash: string, doc_hash?: string, device_id: string, recaptcha_token: string }} payload
 * @returns {Promise<{ receipt: string }>}
 *
 * Replaces: protests.joinProtest() local mutation in stores/protests.js
 */
export function joinProtest(protestId, payload) {
  return request('POST', `/api/protests/${protestId}/join`, payload);
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
 * @param {{ phone: string, otp: string, device_id: string }} payload
 * @returns {Promise<{ verified: boolean, device_id: string }>}
 *
 * Replaces: verifyOTP() fake navigation in AuthScreen.vue
 */
export function verifyOtp(payload) {
  return request('POST', '/api/users/verify-otp', payload);
}

/**
 * Fetch the active protest locks for a device.
 * @param {string} deviceId
 * @returns {Promise<Array>}
 *
 * Replaces: useDeviceStore().getLocks() localStorage read in stores/device.js
 */
export function fetchDeviceLocks(deviceId) {
  return request('GET', `/api/users/device/${deviceId}/locks`);
}

export function fetchDevice(deviceId) {
  return request('GET', `/api/users/device/${deviceId}`);
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
export function sendEmailOtp(payload) {
  return request('POST', '/api/institucional/send-otp', payload);
}

/**
 * Verificar OTP de email institucional y registrar adhesión.
 * @param {{ email: string, otp: string, protest_id: string }} payload
 * @returns {Promise<{ receipt: string }>}
 */
export function verifyEmailOtp(payload) {
  return request('POST', '/api/institucional/verify-otp', payload);
}
// ── Grafo de vouches ───────────────────────────────────────────────────────────

/**
 * Crear un grupo con nodo génesis.
 * @param {{ protest_id: string, genesis_hash: string, name: string }} payload
 * @returns {Promise<{ group_id: string }>}
 */
export function crearGrupo(payload) {
  return request('POST', '/api/grupos/crear', payload);
}

/**
 * Solicitar unirse a un grupo.
 * @param {string} groupId
 * @param {{ email_hash: string }} payload
 * @returns {Promise<{ requested: boolean }>}
 */
export function solicitarUnirse(groupId, payload) {
  return request('POST', `/api/grupos/${groupId}/solicitar`, payload);
}

/**
 * Avalar a un candidato.
 * @param {string} groupId
 * @param {{ voucher_hash: string, candidate_hash: string }} payload
 * @returns {Promise<Object>}
 */
export function darVouch(groupId, payload) {
  return request('POST', `/api/grupos/${groupId}/vouch`, payload);
}

/**
 * Obtener el estado del grupo.
 * @param {string} groupId
 * @param {string} [emailHash]
 * @returns {Promise<Object>}
 */
export function fetchGrupoEstado(groupId, emailHash) {
  const qs = emailHash ? `?email_hash=${emailHash}` : '';
  return request('GET', `/api/grupos/${groupId}/estado${qs}`);
}

/**
 * Generar link de invitación personal.
 * @param {string} groupId
 * @param {{ inviter_hash: string }} payload
 * @returns {Promise<{ token: string, url: string }>}
 */
export function generarInvite(groupId, payload) {
  return request('POST', `/api/grupos/${groupId}/invite`, payload);
}
/**
 * Buscar el grupo asociado a una convocatoria.
 * @param {string} protestId
 * @returns {Promise<{ group_id: string, name: string }>}
 */
export function fetchGrupoPorConvocatoria(protestId) {
  return request('GET', `/api/grupos/convocatoria/${protestId}`);
}
