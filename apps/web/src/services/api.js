/**
 * API client for the Voz Ciudadana Fastify backend.
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
  if (!res.ok) throw new Error(json.message ?? `API error ${res.status}`);
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
 * Join a protest (anonymous adhesion).
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
 * Request an OTP SMS for the given phone hash.
 * @param {{ phone_hash: string, recaptcha_token: string }} payload
 * @returns {Promise<{ sent: boolean }>}
 *
 * Replaces: sendSMS() fake timeout in AuthScreen.vue
 */
export function requestOtp(payload) {
  return request('POST', '/api/users/request-otp', payload);
}

/**
 * Verify the OTP and register the device.
 * @param {{ phone_hash: string, otp: string, device_id: string }} payload
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
