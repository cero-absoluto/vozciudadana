export function hasIntegrityDiscrepancy(protest, payload) {
  if (!protest || !payload || Number(payload.integrity_version) < 2) return false;
  return Number(protest.integrity_version || 1) !== Number(payload.integrity_version)
    || protest.hash_integridad !== payload.integrity_hash;
}

export async function verifyIntegrityPayload(payload, protestId) {
  if (!payload || payload.protest_id !== protestId) throw new Error('Unexpected integrity response');
  if (Number(payload.integrity_version) < 2) return 'v1';
  if (!Array.isArray(payload.public_commitments)
      || typeof payload.integrity_hash !== 'string'
      || !payload.city_distribution || !payload.reliability_breakdown) {
    throw new Error('Incomplete integrity response');
  }
  const sorted = [...payload.public_commitments].sort();
  const cities = Object.entries(payload.city_distribution)
    .sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}:${v}`).join(',');
  const reliability = Object.entries(payload.reliability_breakdown)
    .sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(',');
  const input = [
    payload.protest_id, payload.title, payload.demands, payload.scope, payload.country,
    payload.total_adhesions, payload.cities_count, reliability, cities,
    payload.first_adhesion || '', payload.last_adhesion || '', sorted.join('|'),
  ].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hash = Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  return hash === payload.integrity_hash ? 'ok' : 'fail';
}
