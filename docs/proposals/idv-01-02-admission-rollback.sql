-- Restores the audited pre-candidate invoker function, without data changes.
BEGIN;
SET LOCAL lock_timeout='1500ms';
DO $$ BEGIN
 IF md5(rtrim(pg_get_functiondef('public.enforce_census_admission()'::regprocedure), E' \t\r\n')) <> '8874ca11a460facae29f110228872e91' THEN RAISE EXCEPTION 'VP_IDV_ROLLBACK_BASELINE_DRIFT'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.enforce_census_admission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE p public.protests%ROWTYPE; proof voiceprotest_private.census_creator_proofs%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.protests WHERE id=NEW.protest_id FOR UPDATE;
 IF TG_OP='UPDATE' THEN
  IF (p.requiere_censo OR EXISTS(SELECT 1 FROM public.protests WHERE id=OLD.protest_id AND requiere_censo))
   AND (NEW.protest_id IS DISTINCT FROM OLD.protest_id OR NEW.verification_method IS DISTINCT FROM OLD.verification_method OR NEW.identity_subject_hash IS DISTINCT FROM OLD.identity_subject_hash)
   AND NOT (NEW.protest_id IS NOT DISTINCT FROM OLD.protest_id AND NEW.verification_method IS NOT DISTINCT FROM OLD.verification_method AND NEW.identity_subject_hash IS NULL AND NEW.anonymized_at IS NOT NULL)
  THEN RAISE EXCEPTION 'ADHESION_IDENTITY_IMMUTABLE'; END IF;
  RETURN NEW;
 END IF;
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
CREATE TRIGGER census_admission_guard BEFORE INSERT OR UPDATE OF protest_id, verification_method, identity_subject_hash ON public.adhesions FOR EACH ROW EXECUTE FUNCTION public.enforce_census_admission();
COMMIT;
