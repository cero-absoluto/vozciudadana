BEGIN READ ONLY;
WITH allowed(tbl,col) AS (SELECT t.key,j.value FROM jsonb_each('{"protests":["status","id","title","description","demands","country","country_name","scope","region","focal_point","category","risk_level","starts_at","ends_at","created_at","convocatoria_pais","convocatoria_region","convocatoria_institucion","convocatoria_ciudad_nombre","dominio_email","fuente_url","tipo_abuso","source_type","hash_integridad","integrity_calculated_at","ultima_donacion","target_wikidata_id","count","heat","cities","cities_count","viral_count","convocatoria_lat","convocatoria_lon","saldo_euros","donaciones_count","donaciones_total","source_confidence_score","integrity_version","convocatoria_osm_id","requiere_censo"],"country_codes":["iso2","dial_code","flag","name"],"donaciones":["protest_id","importe","created_at"]}'::jsonb)t CROSS JOIN LATERAL jsonb_array_elements_text(t.value)j(value)),
 roles(role) AS (VALUES ('anon'::text),('authenticated'::text)),
 relations AS (SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
 violations AS (
 SELECT r.role,'relation_write'::text kind,c.relname::text object FROM relations c CROSS JOIN roles r WHERE c.relkind IN ('r','p','v','m','f') AND has_table_privilege(r.role,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
 UNION ALL SELECT r.role,'column_access',c.relname||'.'||a.attname FROM relations c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN roles r WHERE c.relkind IN ('r','p','v','m','f') AND ((has_column_privilege(r.role,c.oid,a.attnum,'SELECT') AND (c.relkind<>'r' OR NOT EXISTS(SELECT 1 FROM allowed x WHERE x.tbl=c.relname AND x.col=a.attname))) OR has_column_privilege(r.role,c.oid,a.attnum,'INSERT,UPDATE,REFERENCES'))
 UNION ALL SELECT r.role,'sequence_access',c.relname FROM relations c CROSS JOIN roles r WHERE c.relkind='S' AND has_sequence_privilege(r.role,c.oid,'USAGE,SELECT,UPDATE')
 UNION ALL SELECT r.role,'function_execute',p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN roles r WHERE n.nspname='public' AND has_function_privilege(r.role,p.oid,'EXECUTE')
 UNION ALL SELECT r.role,'schema_create','public' FROM roles r WHERE has_schema_privilege(r.role,'public','CREATE')
 UNION ALL SELECT 'all','rls_disabled',c.relname FROM relations c WHERE c.relkind IN ('r','p') AND NOT c.relrowsecurity
 UNION ALL SELECT 'service_role','missing_crud',c.relname FROM relations c CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'))v(priv) WHERE c.relkind IN ('r','p') AND NOT has_table_privilege('service_role',c.oid,v.priv)
 UNION ALL SELECT 'service_role','gps_rpc_missing','consume_gps_reinforcement' WHERE to_regprocedure('public.consume_gps_reinforcement(text,uuid,bigint,text,text,text,text)') IS NULL
)
SELECT jsonb_build_object('checked_at_utc',clock_timestamp(),'metadata_only',true,'violation_count',(SELECT count(*) FROM violations),'violations',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM violations v),'[]'::jsonb)) AS boundary_check;
ROLLBACK;
