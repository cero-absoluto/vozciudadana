-- Captured from read-only metadata; no participant data.
-- SHA256 of captured definition: f1a8ec5edab6fbb9b4140360ef6c48dfb943a99428a349389000d2a04ffa7158
CREATE OR REPLACE FUNCTION public.create_verified_adhesion(p_protest_id uuid, p_identity_subject_hash text, p_verification_method text, p_nullifier text, p_device_id text, p_doc_hash text, p_ciudad text, p_region text, p_pais text, p_pais_code text, p_idioma text, p_adhesion_osm_id bigint, p_gps_confirmed boolean, p_fiabilidad integer, p_senales text, p_institutional_email_hash text, p_institutional_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_protest       record;
  v_adhesion_id   uuid;
  v_created_at    timestamptz;
BEGIN
  SELECT id, ends_at, saldo_euros
    INTO v_protest
    FROM protests
    WHERE id = p_protest_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP_PROTEST_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_protest.ends_at < now() THEN
    RAISE EXCEPTION 'VP_PROTEST_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  IF v_protest.saldo_euros IS NOT NULL AND v_protest.saldo_euros <= 0 THEN
    RAISE EXCEPTION 'VP_BALANCE_EXHAUSTED' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    IF p_institutional_email_hash IS NOT NULL THEN
      INSERT INTO institutional_members (email_hash, protest_id, expires_at)
      VALUES (p_institutional_email_hash, p_protest_id, p_institutional_expires_at);
    END IF;

    v_created_at := date_trunc('hour', now());

    IF p_verification_method NOT IN ('phone_otp', 'institutional_email_otp', 'qr', 'eid') THEN
      RAISE EXCEPTION 'VP_INVALID_VERIFICATION_METHOD' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO adhesions (
      protest_id, device_id, phone_hash, identity_subject_hash, verification_method,
      doc_hash, ciudad, region, pais, pais_code, idioma, nullifier, created_at,
      fiabilidad, senales, gps_confirmed, adhesion_osm_id
    ) VALUES (
      p_protest_id, p_device_id, p_identity_subject_hash, p_identity_subject_hash, p_verification_method,
      p_doc_hash, p_ciudad, p_region, p_pais, p_pais_code, p_idioma, p_nullifier, v_created_at,
      p_fiabilidad, p_senales, p_gps_confirmed, p_adhesion_osm_id
    )
    RETURNING id INTO v_adhesion_id;
  EXCEPTION
    WHEN unique_violation THEN
      DECLARE
        v_constraint text;
      BEGIN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint IN ('adhesions_active_nullifier_unique', 'adhesions_active_device_unique') THEN
          RAISE EXCEPTION 'VP_ALREADY_JOINED' USING ERRCODE = 'P0001';
        ELSIF v_constraint = 'institutional_member_unique' THEN
          RAISE EXCEPTION 'VP_MEMBERSHIP_ALREADY_EXISTS' USING ERRCODE = 'P0001';
        ELSE
          RAISE;
        END IF;
      END;
  END;

  UPDATE protests SET count = count + 1 WHERE id = p_protest_id;
  PERFORM update_cities_count(p_protest_id);

  IF p_device_id IS NOT NULL THEN
    UPDATE devices SET last_seen = now() WHERE id = p_device_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_adhesion_id, 'created_at', v_created_at,
    'ciudad', p_ciudad, 'region', p_region, 'pais', p_pais,
    'adhesion_osm_id', p_adhesion_osm_id
  );
END;
$function$
