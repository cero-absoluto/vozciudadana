// Historic rows lack the OSM object type. A bare numeric OSM ID cannot prove
// an entity match (node/way/relation have separate ID spaces). Require the
// declared country and territorial name; describe this as a geocoder match.
const validCountry = value => typeof value === 'string' && value.length === 2 && /^[A-Z]{2}$/.test(value);
const normalize = value => typeof value === 'string' ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase() : null;
export function matchesDeclaredTerritory(protest, evidence) {
  if (!['local','regional'].includes(protest.scope) || evidence.gps_confirmed !== true || !validCountry(protest.country) || !validCountry(evidence.pais_code) || evidence.pais_code !== protest.country) return false;
  const name = protest.scope === 'local' ? evidence.ciudad : evidence.region;
  return !!normalize(name) && normalize(name) === normalize(protest.convocatoria_ciudad_nombre);
}
export function geographicBreakdown(protest, adhesions) {
  let gps_local=0, gps_nacional=0, nacionales_sin_gps=0, internacionales=0, sin_pais=0;
  for (const a of adhesions) {
    if (matchesDeclaredTerritory(protest,a)) gps_local++;
    else if (!validCountry(a.pais_code) || !validCountry(protest.country)) sin_pais++;
    else if (a.pais_code !== protest.country) internacionales++;
    else if (a.gps_confirmed === true) gps_nacional++;
    else nacionales_sin_gps++;
  }
  return {municipio:protest.convocatoria_ciudad_nombre,scope:protest.scope,gps_local,gps_nacional,nacionales_sin_gps,internacionales,sin_pais,total:adhesions.length,reported_total:Number.isSafeInteger(protest.count)&&protest.count>=0?protest.count:null,
    local_verified:{count:gps_local,total:adhesions.length,geo_scope_match:protest.scope==='local'?'municipality':'region',geo_scope_source:'gps_geocoder_name_country'}};
}
