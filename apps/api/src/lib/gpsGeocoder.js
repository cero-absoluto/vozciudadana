// A successful HTTP/JSON exchange alone is not geographic evidence.
// Keep this contract common to initial admission and later reinforcement.
export async function parseGpsGeocoderResponse(response, scope) {
  if (response?.ok !== true) throw new Error('Geocoder unavailable');
  const data = await response.json();
  const address = data?.address;
  const place = value => typeof value === 'string' && value.trim() && value.length <= 512 ? value.trim() : null;
  if (!data || Array.isArray(data) || data.error || !address || Array.isArray(address) || typeof address !== 'object') {
    throw new Error('Invalid geocoder evidence');
  }
  const code = typeof address.country_code === 'string' ? address.country_code.toUpperCase() : '';
  const ciudad = ['city','town','village','suburb','hamlet','locality','municipality'].map(key => place(address[key])).find(Boolean) || null;
  const region = place(address.state) || place(address.county);
  if (!/^[A-Z]{2}$/.test(code) || !(ciudad || region)) throw new Error('Incomplete geocoder evidence');
  const osmId = typeof data.osm_id === 'number' || typeof data.osm_id === 'string' && /^\d+$/.test(data.osm_id) ? Number(data.osm_id) : null;
  return {
    ciudad, region, pais: place(address.country), pais_code: code,
    adhesion_osm_id: ['local','regional'].includes(scope) && Number.isSafeInteger(osmId) && osmId > 0 ? osmId : null,
  };
}
