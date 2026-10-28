BEGIN;
SET LOCAL lock_timeout='5s';
DO $acl$
DECLARE tbl text; sig text; cols text; r text; a record; allowed text[]; priv text; had_execute boolean; seq_privs text[];
 tables text[] := ARRAY['institutional_members','groups','email_otp_rate_limit','devices','group_members','country_codes','push_subscriptions','admin_log','invite_links','source_validations','donaciones','protests','otp_requests','platform_fund','gps_update_tokens','financial_movements','kofi_protest_map','email_otp_requests','integrity_records','census_otp_requests','vouches','vouch_requests','adhesions','otp_quota_buckets']::text[];
 functions text[] := ARRAY['calculate_integrity_hash(uuid)','calcular_hash_integridad()','create_verified_adhesion(uuid,text,text,text,text,text,text,text,text,text,text,bigint,boolean,integer,text,text,timestamp with time zone)','apply_gps_reinforcement(uuid,boolean,bigint,text,text,text,text,integer,text)','check_otp_rate_limit(text,text,text,uuid)','get_otp_cooldown(text)','transfer_protest_surplus_to_platform_fund()','check_donation_limit(uuid,numeric)','update_cities_count(uuid)','increment_protest_count(uuid)','increment_viral_count(uuid)','set_updated_at()','get_cities_count(uuid)','process_vouch(uuid,text,text)','verify_institutional_otp_and_create_adhesion(text,uuid,text,text,text,text,text,text,text,text,timestamp with time zone)','calculate_integrity_hash_v2(uuid)','reserve_census_otp(text,uuid,text,text,text)','consume_census_otp(text,uuid,text,uuid)','found_census_group(uuid,text,text,text)','census_group_action(uuid,text,text,uuid,text,text)','check_institutional_otp_rate_limit(text,uuid,text,text)','reserve_institutional_otp(text,uuid,text,text,text,text)','enforce_census_admission()','verify_census_founder_adhesion(text,uuid,text,text,text,text,text,text,text,text,timestamp with time zone,text,uuid)','verify_institutional_challenge_and_create_adhesion(text,uuid,text,text,text,text,text,text,text,text,timestamp with time zone,uuid)','create_census_protest(jsonb,text)','erase_anonymized_identity()','save_owned_push_subscription(text,text,text,text,uuid,text,text)','consume_shared_otp_quota(text,text,text)','reserve_sms_otp(text,text,text,uuid)']::text[];
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m','f','p')) THEN RAISE EXCEPTION 'VP_ACL_UNREVIEWED_RELATION'; END IF;
 -- Exact catalog identity: a changed table/function inventory requires fresh review.
 IF (SELECT array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C") FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') IS DISTINCT FROM (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(tables)x)
 OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')<>cardinality(functions) THEN RAISE EXCEPTION 'VP_ACL_CATALOG_DRIFT'; END IF;
 FOREACH sig IN ARRAY functions LOOP IF to_regprocedure('public.'||sig) IS NULL THEN RAISE EXCEPTION 'VP_ACL_FUNCTION_DRIFT'; END IF; END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (c.relowner<>current_user::regrole OR EXISTS(SELECT 1 FROM aclexplode(c.relacl) grant_entry WHERE grant_entry.grantor<>current_user::regrole))) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proowner<>current_user::regrole OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) grant_entry WHERE grant_entry.grantor<>current_user::regrole))) THEN RAISE EXCEPTION 'VP_ACL_OWNER_OR_GRANTOR_REQUIRED'; END IF;
 FOREACH tbl IN ARRAY tables LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||tbl)) THEN RAISE EXCEPTION 'VP_ACL_RLS_REQUIRED'; END IF;
  FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP IF NOT has_table_privilege('service_role','public.'||tbl,priv) THEN RAISE EXCEPTION 'VP_ACL_SERVICE_PRIVILEGE_REQUIRED'; END IF; END LOOP;
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',tbl);
  SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid=to_regclass('public.'||tbl) AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC,anon,authenticated',cols,tbl);
 END LOOP;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S')<>1 OR to_regclass('public.platform_fund_id_seq') IS NULL THEN RAISE EXCEPTION 'VP_ACL_SEQUENCE_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='public.platform_fund_id_seq'::regclass AND (c.relowner<>current_user::regrole OR EXISTS(SELECT 1 FROM aclexplode(c.relacl) grant_entry WHERE grant_entry.grantor<>current_user::regrole))) THEN RAISE EXCEPTION 'VP_ACL_OWNER_OR_GRANTOR_REQUIRED'; END IF;
 SELECT array_agg(x) INTO seq_privs FROM unnest(ARRAY['USAGE','SELECT','UPDATE'])x WHERE has_sequence_privilege('service_role','public.platform_fund_id_seq',x);
 REVOKE ALL ON SEQUENCE public.platform_fund_id_seq FROM PUBLIC,anon,authenticated;
 FOREACH priv IN ARRAY coalesce(seq_privs,ARRAY[]::text[]) LOOP EXECUTE 'GRANT '||priv||' ON SEQUENCE public.platform_fund_id_seq TO service_role'; END LOOP;
 FOREACH priv IN ARRAY ARRAY['USAGE','SELECT','UPDATE'] LOOP IF has_sequence_privilege('anon','public.platform_fund_id_seq',priv) OR has_sequence_privilege('authenticated','public.platform_fund_id_seq',priv) OR has_sequence_privilege('service_role','public.platform_fund_id_seq',priv) IS DISTINCT FROM (priv=ANY(coalesce(seq_privs,ARRAY[]::text[]))) THEN RAISE EXCEPTION 'VP_ACL_SEQUENCE_BOUNDARY'; END IF; END LOOP;
 REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
 GRANT SELECT (status,id,title,description,demands,country,country_name,scope,region,focal_point,category,risk_level,starts_at,ends_at,created_at,convocatoria_pais,convocatoria_region,convocatoria_institucion,convocatoria_ciudad_nombre,dominio_email,fuente_url,tipo_abuso,source_type,hash_integridad,integrity_calculated_at,ultima_donacion,target_wikidata_id,count,heat,cities,cities_count,viral_count,convocatoria_lat,convocatoria_lon,saldo_euros,donaciones_count,donaciones_total,source_confidence_score,integrity_version,convocatoria_osm_id,requiere_censo) ON public.protests TO anon,authenticated;
 GRANT SELECT (iso2,dial_code,flag,name) ON public.country_codes TO anon,authenticated;
 GRANT SELECT (protest_id,importe,created_at) ON public.donaciones TO anon,authenticated;
 FOREACH sig IN ARRAY functions LOOP
  had_execute:=has_function_privilege('service_role','public.'||sig,'EXECUTE');
  EXECUTE 'REVOKE ALL ON FUNCTION public.'||sig||' FROM PUBLIC,anon,authenticated';
  IF had_execute THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||sig||' TO service_role'; END IF;
  IF has_function_privilege('service_role','public.'||sig,'EXECUTE') IS DISTINCT FROM had_execute THEN RAISE EXCEPTION 'VP_ACL_SERVICE_EXECUTE_CHANGED'; END IF;
 END LOOP;
 FOREACH tbl IN ARRAY tables LOOP FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP IF NOT has_table_privilege('service_role','public.'||tbl,priv) THEN RAISE EXCEPTION 'VP_ACL_SERVICE_PRIVILEGE_CHANGED'; END IF; END LOOP; END LOOP;
 -- Verify effective privileges, including inherited ones. Any unexpected grant rolls back everything.
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_schema_privilege(r,'public','CREATE') THEN RAISE EXCEPTION 'VP_ACL_INHERITED_CREATE'; END IF;
  FOREACH sig IN ARRAY functions LOOP IF has_function_privilege(r,'public.'||sig,'EXECUTE') THEN RAISE EXCEPTION 'VP_ACL_INHERITED_EXECUTE'; END IF; END LOOP;
  FOREACH tbl IN ARRAY tables LOOP
   allowed:=CASE tbl WHEN 'protests' THEN ARRAY['status','id','title','description','demands','country','country_name','scope','region','focal_point','category','risk_level','starts_at','ends_at','created_at','convocatoria_pais','convocatoria_region','convocatoria_institucion','convocatoria_ciudad_nombre','dominio_email','fuente_url','tipo_abuso','source_type','hash_integridad','integrity_calculated_at','ultima_donacion','target_wikidata_id','count','heat','cities','cities_count','viral_count','convocatoria_lat','convocatoria_lon','saldo_euros','donaciones_count','donaciones_total','source_confidence_score','integrity_version','convocatoria_osm_id','requiere_censo']::text[] WHEN 'country_codes' THEN ARRAY['iso2','dial_code','flag','name']::text[] WHEN 'donaciones' THEN ARRAY['protest_id','importe','created_at']::text[] ELSE ARRAY[]::text[] END;
   FOREACH priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP IF has_table_privilege(r,'public.'||tbl,priv) THEN RAISE EXCEPTION 'VP_ACL_INHERITED_WRITE'; END IF; END LOOP;
   FOR a IN SELECT attnum,attname FROM pg_attribute WHERE attrelid=to_regclass('public.'||tbl) AND attnum>0 AND NOT attisdropped LOOP
    IF has_column_privilege(r,'public.'||tbl,a.attname,'SELECT') IS DISTINCT FROM (a.attname=ANY(allowed)) OR has_column_privilege(r,'public.'||tbl,a.attname,'INSERT') OR has_column_privilege(r,'public.'||tbl,a.attname,'UPDATE') OR has_column_privilege(r,'public.'||tbl,a.attname,'REFERENCES') THEN RAISE EXCEPTION 'VP_ACL_COLUMN_BOUNDARY'; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
END $acl$;
NOTIFY pgrst, 'reload schema';
COMMIT;
