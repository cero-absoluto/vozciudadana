BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.consume_gps_reinforcement(text,uuid,bigint,text,text,text,text)') IS NOT NULL THEN RAISE EXCEPTION 'VP_GPS_RPC_ALREADY_PRESENT'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES ('gps_update_tokens','token','text'),('gps_update_tokens','adhesion_id','uuid'),('gps_update_tokens','protest_id','uuid'),('gps_update_tokens','used','boolean'),('gps_update_tokens','expires_at','timestamp with time zone'),('protests','ends_at','timestamp with time zone'),('adhesions','id','uuid'),('adhesions','protest_id','uuid'),('adhesions','fiabilidad','integer'),('adhesions','senales','text'),('adhesions','anonymized_at','timestamp with time zone'),('adhesions','deleted_at','timestamp with time zone'),('protests','id','uuid'),('adhesions','gps_confirmed','boolean'),('adhesions','adhesion_osm_id','bigint'),('adhesions','ciudad','text'),('adhesions','region','text'),('adhesions','pais','text'),('adhesions','pais_code','text')) AS expected(tbl,col,typ)
 LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=expected.tbl AND c.column_name=expected.col AND c.data_type=expected.typ WHERE c.column_name IS NULL) THEN RAISE EXCEPTION 'VP_GPS_CATALOG_REQUIRED'; END IF;
END $$;
CREATE FUNCTION public.consume_gps_reinforcement(p_token text,p_protest_id uuid,p_adhesion_osm_id bigint,p_ciudad text,p_region text,p_pais text,p_pais_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='1500ms' AS $$
DECLARE t public.gps_update_tokens%ROWTYPE; a public.adhesions%ROWTYPE; deadline timestamptz; signals text[]; confidence integer; changed uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'VP_GPS_ISOLATION_REQUIRED'; END IF;
 IF p_token IS NULL OR p_token !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' OR p_protest_id IS NULL
 OR (p_pais_code IS NOT NULL AND p_pais_code !~ '^[A-Z]{2}$') OR (p_adhesion_osm_id IS NOT NULL AND p_adhesion_osm_id<=0)
 OR length(p_ciudad)>512 OR length(p_region)>512 OR length(p_pais)>512 THEN RETURN jsonb_build_object('ok',false,'code','GPS_INPUT_INVALID'); END IF;
 -- Lock order: protest -> adhesion -> token. Matches deletion cascades; never token -> adhesion.
 SELECT p.ends_at INTO deadline FROM public.protests p WHERE p.id=p_protest_id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','PROTEST_NOT_FOUND'); END IF;
 SELECT * INTO t FROM public.gps_update_tokens WHERE token=p_token;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','TOKEN_NOT_FOUND'); END IF;
 IF t.protest_id<>p_protest_id THEN RETURN jsonb_build_object('ok',false,'code','TOKEN_MISMATCH'); END IF;
 SELECT * INTO a FROM public.adhesions WHERE id=t.adhesion_id AND protest_id=p_protest_id FOR UPDATE;
 IF NOT FOUND OR a.deleted_at IS NOT NULL OR a.anonymized_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','ADHESION_UNAVAILABLE'); END IF;
 SELECT * INTO t FROM public.gps_update_tokens WHERE token=p_token AND adhesion_id=a.id AND protest_id=p_protest_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','TOKEN_NOT_FOUND'); END IF;
 IF t.used IS DISTINCT FROM false THEN RETURN jsonb_build_object('ok',false,'code','TOKEN_USED'); END IF;
 IF t.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'code','TOKEN_EXPIRED'); END IF;
 IF deadline<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'code','PROTEST_CLOSED'); END IF;
 signals:=array_remove(string_to_array(coalesce(a.senales,''),','),'');
 confidence:=CASE WHEN coalesce(a.fiabilidad,0)=0 THEN 75 ELSE a.fiabilidad END;
 IF NOT ('gps'=ANY(signals)) THEN
  signals:=array_append(signals,'gps');
  confidence:=CASE WHEN 'sim'=ANY(signals) AND 'ip'=ANY(signals) THEN 95 WHEN 'sim'=ANY(signals) THEN 92 ELSE 60 END;
 END IF;
 IF confidence<0 OR confidence>100 THEN RETURN jsonb_build_object('ok',false,'code','GPS_STATE_UNAVAILABLE'); END IF;
 UPDATE public.adhesions SET gps_confirmed=true,adhesion_osm_id=coalesce(p_adhesion_osm_id,adhesion_osm_id),
 ciudad=CASE WHEN p_ciudad IS NOT NULL OR p_region IS NOT NULL OR p_pais IS NOT NULL OR p_pais_code IS NOT NULL THEN p_ciudad ELSE ciudad END,region=CASE WHEN p_ciudad IS NOT NULL OR p_region IS NOT NULL OR p_pais IS NOT NULL OR p_pais_code IS NOT NULL THEN p_region ELSE region END,pais=CASE WHEN p_ciudad IS NOT NULL OR p_region IS NOT NULL OR p_pais IS NOT NULL OR p_pais_code IS NOT NULL THEN p_pais ELSE pais END,pais_code=CASE WHEN p_ciudad IS NOT NULL OR p_region IS NOT NULL OR p_pais IS NOT NULL OR p_pais_code IS NOT NULL THEN p_pais_code ELSE pais_code END,fiabilidad=confidence,senales=array_to_string(signals,',')
 WHERE id=a.id AND deleted_at IS NULL AND anonymized_at IS NULL AND deadline>clock_timestamp() AND t.expires_at>clock_timestamp() RETURNING id INTO changed;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code',CASE WHEN deadline<=clock_timestamp() THEN 'PROTEST_CLOSED' ELSE 'TOKEN_EXPIRED' END); END IF;
 UPDATE public.gps_update_tokens SET used=true WHERE token=p_token AND NOT used;
 IF NOT FOUND THEN RAISE EXCEPTION 'VP_GPS_TOKEN_CONSUMPTION_FAILED'; END IF;
 RETURN jsonb_build_object('ok',true,'fiabilidad',confidence,'adhesion_osm_id',p_adhesion_osm_id);
END $$;
REVOKE ALL ON FUNCTION public.consume_gps_reinforcement(text,uuid,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_gps_reinforcement(text,uuid,bigint,text,text,text,text) TO service_role;
DO $$ DECLARE f record; BEGIN
 SELECT p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig INTO f FROM pg_proc p WHERE p.oid='public.consume_gps_reinforcement(text,uuid,bigint,text,text,text,text)'::regprocedure;
 IF has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE') OR NOT has_function_privilege('service_role',f.oid,'EXECUTE') OR f.prosecdef OR NOT coalesce('search_path=""'=ANY(f.proconfig),false) OR NOT coalesce('lock_timeout=1500ms'=ANY(f.proconfig),false)
 OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN (f.proowner,'service_role'::regrole::oid)) THEN RAISE EXCEPTION 'VP_GPS_RPC_PRIVILEGE_BOUNDARY'; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
