-- Rollback only if the exact IDV-04 definition is still present. No historical updates.
BEGIN;
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.verify_institutional_challenge_and_create_adhesion(text,uuid,text,text,text,text,text,text,text,text,timestamp with time zone,uuid)'::regprocedure)) IS DISTINCT FROM 'd8e31ef25d9fba467752dc9f9ae911e4' THEN RAISE EXCEPTION 'VP_IDV04_ROLLBACK_DRIFT'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.verify_institutional_challenge_and_create_adhesion(p_email_hash text, p_protest_id uuid, p_submitted_otp_hash text, p_identity_subject_hash text, p_nullifier text, p_ciudad text, p_region text, p_pais text, p_pais_code text, p_idioma text, p_institutional_expires_at timestamp with time zone, p_challenge_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_otp record;
  v_result jsonb;
BEGIN
  IF p_email_hash IS DISTINCT FROM p_identity_subject_hash THEN RAISE EXCEPTION 'IDENTITY_MISMATCH'; END IF;
  SELECT id, otp_hash, expires_at, consumed_at, attempt_count
    INTO v_otp
    FROM public.email_otp_requests
    WHERE id=p_challenge_id AND email_hash = p_email_hash AND protest_id = p_protest_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP_OTP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_otp.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'VP_OTP_ALREADY_USED' USING ERRCODE = 'P0001';
  END IF;

  IF v_otp.expires_at IS NULL OR v_otp.expires_at <= now() THEN
    RAISE EXCEPTION 'VP_OTP_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  -- VP-SEC-014: failed attempts are counted transactionally against this
  -- specific request row, not left to an in-memory or per-process limiter
  -- alone. After 5 wrong codes the row is dead regardless of whether it has
  -- technically expired yet.
  IF v_otp.attempt_count >= 5 THEN
    RAISE EXCEPTION 'VP_TOO_MANY_ATTEMPTS' USING ERRCODE = 'P0001';
  END IF;

  IF v_otp.otp_hash IS DISTINCT FROM p_submitted_otp_hash THEN
    UPDATE public.email_otp_requests SET attempt_count = attempt_count + 1 WHERE id = v_otp.id;
    RETURN jsonb_build_object('error','VP_WRONG_OTP');
  END IF;

  -- Consume now, before creating the adhesion — if create_verified_adhesion
  -- below raises, this UPDATE rolls back together with it (same
  -- transaction), so a failed adhesion never leaves the OTP burned.
  UPDATE public.email_otp_requests SET consumed_at = now() WHERE id = v_otp.id;

  v_result := public.create_verified_adhesion(
    p_protest_id               => p_protest_id,
    p_identity_subject_hash    => p_identity_subject_hash,
    p_verification_method      => 'institutional_email_otp',
    p_nullifier                => p_nullifier,
    p_device_id                => NULL,
    p_doc_hash                 => NULL,
    p_ciudad                   => p_ciudad,
    p_region                   => p_region,
    p_pais                     => p_pais,
    p_pais_code                => p_pais_code,
    p_idioma                   => p_idioma,
    p_adhesion_osm_id          => NULL,
    p_gps_confirmed            => false,
    p_fiabilidad               => 90,
    p_senales                  => 'email_otp,ip',
    p_institutional_email_hash => p_email_hash,
    p_institutional_expires_at => p_institutional_expires_at
  );

  RETURN v_result;
END;
$function$
;
COMMIT;
