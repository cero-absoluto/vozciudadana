-- REVIEW CANDIDATE ONLY. No production application authorized.
-- Replaces the existing invoker trigger function; preserves owner, ACLs,
-- census bootstrap rules; broadens the existing trigger to GPS updates. No table/row/grant changes.
BEGIN;
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF md5(rtrim(pg_get_functiondef('public.enforce_census_admission()'::regprocedure), E' \t\r\n')) <> '571ff4505a3571d89cbc58e06efe35d8' THEN
  RAISE EXCEPTION 'VP_IDV_ADMISSION_BASELINE_DRIFT';
 END IF;
 IF pg_get_triggerdef((SELECT oid FROM pg_trigger WHERE tgrelid='public.adhesions'::regclass AND tgname='census_admission_guard')) IS DISTINCT FROM 'CREATE TRIGGER census_admission_guard BEFORE INSERT OR UPDATE OF protest_id, verification_method, identity_subject_hash ON public.adhesions FOR EACH ROW EXECUTE FUNCTION enforce_census_admission()' THEN
  RAISE EXCEPTION 'VP_IDV_TRIGGER_BASELINE_DRIFT';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.enforce_census_admission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE p public.protests%ROWTYPE; proof voiceprotest_private.census_creator_proofs%ROWTYPE;
BEGIN
 -- GPS-only updates follow consume_gps_reinforcement's existing SHARE lock.
 -- Avoid a SHARE -> UPDATE upgrade deadlock between different adhesions.
 -- Admission/identity changes retain the original exclusive serialisation.
 IF TG_OP='UPDATE' AND NEW.protest_id IS NOT DISTINCT FROM OLD.protest_id
  AND NEW.verification_method IS NOT DISTINCT FROM OLD.verification_method
  AND NEW.identity_subject_hash IS NOT DISTINCT FROM OLD.identity_subject_hash THEN
  SELECT * INTO p FROM public.protests WHERE id=NEW.protest_id FOR SHARE;
 ELSE
  SELECT * INTO p FROM public.protests WHERE id=NEW.protest_id FOR UPDATE;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF p.dominio_email IS NOT NULL
   AND (NEW.protest_id IS DISTINCT FROM OLD.protest_id OR NEW.verification_method IS DISTINCT FROM OLD.verification_method OR
        (NEW.identity_subject_hash IS NOT NULL AND NEW.identity_subject_hash IS DISTINCT FROM OLD.identity_subject_hash))
   AND NEW.verification_method IS DISTINCT FROM 'institutional_email_otp'
  THEN RAISE EXCEPTION 'VP_INSTITUTIONAL_VERIFICATION_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF (p.risk_level IN ('high','critical') OR p.dominio_email IS NOT NULL) AND (
   (coalesce(to_jsonb(NEW)->>'gps_lat',to_jsonb(NEW)->>'gps_lng',to_jsonb(NEW)->>'gps_accuracy') IS NOT NULL AND
    (to_jsonb(NEW)->'gps_lat' IS DISTINCT FROM to_jsonb(OLD)->'gps_lat' OR to_jsonb(NEW)->'gps_lng' IS DISTINCT FROM to_jsonb(OLD)->'gps_lng' OR to_jsonb(NEW)->'gps_accuracy' IS DISTINCT FROM to_jsonb(OLD)->'gps_accuracy')) OR
   (NEW.gps_confirmed IS TRUE AND (OLD.gps_confirmed IS DISTINCT FROM true OR NEW.protest_id IS DISTINCT FROM OLD.protest_id)) OR
   (NEW.adhesion_osm_id IS NOT NULL AND NEW.adhesion_osm_id IS DISTINCT FROM OLD.adhesion_osm_id) OR
   ('gps'=ANY(string_to_array(coalesce(NEW.senales,''),',')) AND NOT ('gps'=ANY(string_to_array(coalesce(OLD.senales,''),',')))) OR
   (NEW.gps_confirmed IS TRUE AND (
    (NEW.ciudad IS NOT NULL AND NEW.ciudad IS DISTINCT FROM OLD.ciudad) OR
    (NEW.region IS NOT NULL AND NEW.region IS DISTINCT FROM OLD.region) OR
    (NEW.pais IS NOT NULL AND NEW.pais IS DISTINCT FROM OLD.pais) OR
    (NEW.pais_code IS NOT NULL AND NEW.pais_code IS DISTINCT FROM OLD.pais_code))))
  THEN RAISE EXCEPTION 'VP_GPS_NOT_ALLOWED' USING ERRCODE='P0001'; END IF;
  IF (p.requiere_censo OR EXISTS(SELECT 1 FROM public.protests WHERE id=OLD.protest_id AND requiere_censo))
   AND (NEW.protest_id IS DISTINCT FROM OLD.protest_id OR NEW.verification_method IS DISTINCT FROM OLD.verification_method OR NEW.identity_subject_hash IS DISTINCT FROM OLD.identity_subject_hash)
   AND NOT (NEW.protest_id IS NOT DISTINCT FROM OLD.protest_id AND NEW.verification_method IS NOT DISTINCT FROM OLD.verification_method AND NEW.identity_subject_hash IS NULL AND NEW.anonymized_at IS NOT NULL)
  THEN RAISE EXCEPTION 'ADHESION_IDENTITY_IMMUTABLE'; END IF;
  RETURN NEW;
 END IF;
 -- Enforce the institutional method even when no census is required.
 IF p.dominio_email IS NOT NULL AND NEW.verification_method IS DISTINCT FROM 'institutional_email_otp' THEN
  RAISE EXCEPTION 'VP_INSTITUTIONAL_VERIFICATION_REQUIRED' USING ERRCODE='P0001';
 END IF;
 IF (p.risk_level IN ('high','critical') OR p.dominio_email IS NOT NULL)
  AND (coalesce(to_jsonb(NEW)->>'gps_lat',to_jsonb(NEW)->>'gps_lng',to_jsonb(NEW)->>'gps_accuracy') IS NOT NULL OR NEW.gps_confirmed IS TRUE OR NEW.adhesion_osm_id IS NOT NULL OR 'gps'=ANY(string_to_array(coalesce(NEW.senales,''),',')))
 THEN RAISE EXCEPTION 'VP_GPS_NOT_ALLOWED' USING ERRCODE='P0001'; END IF;
 SELECT * INTO proof FROM voiceprotest_private.census_creator_proofs WHERE protest_id=p.id;
 IF p.requiere_censo THEN
  IF NEW.verification_method='institutional_email_otp' AND EXISTS(
   SELECT 1 FROM public.groups g JOIN public.group_members m ON m.group_id=g.id
   WHERE g.protest_id=p.id AND m.email_hash=NEW.identity_subject_hash AND m.accredited_at IS NOT NULL
  ) THEN RETURN NEW; END IF;
  IF NEW.verification_method='institutional_email_otp' AND proof.used_at IS NULL AND proof.key_hash IS NOT NULL
   AND current_setting('voiceprotest.creator_proof',true)=proof.key_hash
   AND (proof.founder_hash IS NULL OR proof.founder_hash=NEW.identity_subject_hash)
   AND NOT EXISTS(SELECT 1 FROM public.groups WHERE protest_id=p.id)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'CENSUS_MEMBERSHIP_REQUIRED';
 END IF;
 RETURN NEW;
END $function$
;
DROP TRIGGER census_admission_guard ON public.adhesions;
-- Older catalogs retain raw-coordinate columns. Include only those that exist;
-- reject adding values there too, without requiring obsolete columns to exist.
DO $$ DECLARE raw_cols text; BEGIN
 SELECT string_agg(format(', %I',attname),'' ORDER BY attname) INTO raw_cols
 FROM pg_attribute WHERE attrelid='public.adhesions'::regclass AND NOT attisdropped AND attnum>0
 AND attname IN ('gps_lat','gps_lng','gps_accuracy');
 EXECUTE 'CREATE TRIGGER census_admission_guard BEFORE INSERT OR UPDATE OF protest_id, verification_method, identity_subject_hash, gps_confirmed, adhesion_osm_id, ciudad, region, pais, pais_code, senales'
  ||coalesce(raw_cols,'')||' ON public.adhesions FOR EACH ROW EXECUTE FUNCTION public.enforce_census_admission()';
END $$;
COMMIT;
