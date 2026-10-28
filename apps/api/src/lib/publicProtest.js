// Explicit public contract: adding a database column must not publish it.
const strings = `status id title description demands country country_name scope region focal_point category risk_level
starts_at ends_at created_at convocatoria_pais convocatoria_region convocatoria_institucion
convocatoria_ciudad_nombre dominio_email fuente_url tipo_abuso source_type hash_integridad
integrity_calculated_at ultima_donacion target_wikidata_id`.split(/\s+/);
const numbers = `count heat cities cities_count viral_count convocatoria_lat convocatoria_lon
saldo_euros donaciones_count donaciones_total source_confidence_score integrity_version`.split(/\s+/);
export const publicProtestSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    ...Object.fromEntries(strings.map(key => [key, {type:'string', nullable:true}])),
    ...Object.fromEntries(numbers.map(key => [key, {type:'number', nullable:true}])),
    convocatoria_osm_id: {anyOf:[{type:'number'},{type:'string'},{type:'null'}]},
    requiere_censo: {type:'boolean', nullable:true},
  },
};
export const PUBLIC_PROTEST_FIELDS = Object.freeze(Object.keys(publicProtestSchema.properties));
export const PUBLIC_PROTEST_SELECT = PUBLIC_PROTEST_FIELDS.join(',');
export function toPublicProtest(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  return Object.fromEntries(PUBLIC_PROTEST_FIELDS.filter(key => Object.hasOwn(record,key)).map(key => [key,record[key]]));
}

// Known internal/unused columns at the metadata snapshot; unknown columns also stay excluded.
export const EXCLUDED_PROTEST_FIELDS = Object.freeze(["updated_at", "target_type", "target_country", "target_validation", "source_domain", "source_title", "source_description", "source_author", "published_at", "source_relevance_score", "source_validation_status", "source_validation_source", "source_checked_at", "source_error", "indexnow_last_notified_at"]);
