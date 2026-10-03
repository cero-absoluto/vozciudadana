-- VP-ISS-012: prevent partial overwrites of final integrity snapshots.
-- Explicit scoped Project Owner authorisation: 3 October 2026.
-- Existing snapshots and historical protests-side v1/v2 discrepancies are
-- preserved. Recalculation/migration of historical evidence is not performed.
-- CREATE OR REPLACE preserves the existing owner and EXECUTE grants.
-- Security invoker remains the default; no privilege escalation.
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('public.calculate_integrity_hash_v2(uuid)') IS NULL THEN
    RAISE EXCEPTION 'VP_INTEGRITY_FUNCTION_MISSING';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.calculate_integrity_hash_v2(p_protest_id uuid)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_protest     RECORD;
  v_existing    RECORD;
  v_commitments TEXT;
  v_cities      TEXT;
  v_reliability TEXT;
  v_first       TIMESTAMPTZ;
  v_last        TIMESTAMPTZ;
  v_first_text  TEXT;
  v_last_text   TEXT;
  v_input       TEXT;
  v_hash        TEXT;
  v_city_json   JSONB;
  v_rel_json    JSONB;
  v_comm_json   JSONB;
BEGIN
  SELECT title, demands, scope, country, count, cities, starts_at, ends_at
  INTO v_protest
  FROM public.protests WHERE id = p_protest_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP_INTEGRITY_PROTEST_NOT_FOUND';
  END IF;

  -- Final snapshots are immutable through this routine. Repeated calls
  -- return the recorded hash before touching participant data.
  SELECT integrity_version, integrity_hash, canonical_input,
         total_adhesions, public_commitments
  INTO v_existing
  FROM public.integrity_records
  WHERE protest_id = p_protest_id;

  IF FOUND THEN
    IF v_existing.integrity_version IS DISTINCT FROM 2
       OR v_existing.integrity_hash IS NULL
       OR v_existing.canonical_input IS NULL
       OR encode(extensions.digest(v_existing.canonical_input, 'sha256'), 'hex')
          IS DISTINCT FROM v_existing.integrity_hash THEN
      RAISE EXCEPTION 'VP_INTEGRITY_EXISTING_SNAPSHOT_REQUIRES_REVIEW';
    END IF;
    IF jsonb_typeof(v_existing.public_commitments) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'VP_INTEGRITY_EXISTING_SNAPSHOT_REQUIRES_REVIEW';
    END IF;
    IF v_existing.total_adhesions IS DISTINCT FROM
       jsonb_array_length(v_existing.public_commitments) THEN
      RAISE EXCEPTION 'VP_INTEGRITY_EXISTING_SNAPSHOT_REQUIRES_REVIEW';
    END IF;
    RETURN v_existing.integrity_hash;
  END IF;

  UPDATE public.adhesions
  SET public_commitment = encode(extensions.digest(p_protest_id::TEXT || nullifier, 'sha256'), 'hex')
  WHERE protest_id = p_protest_id AND deleted_at IS NULL AND public_commitment IS NULL;

  SELECT COALESCE(STRING_AGG(public_commitment, '|' ORDER BY public_commitment), '')
  INTO v_commitments
  FROM public.adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL;

  SELECT
    COALESCE(STRING_AGG(ciudad || ':' || cnt::TEXT, ',' ORDER BY ciudad), ''),
    COALESCE(jsonb_object_agg(ciudad, cnt), '{}')
  INTO v_cities, v_city_json
  FROM (
    SELECT ciudad, COUNT(*) AS cnt
    FROM public.adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL AND ciudad IS NOT NULL
    GROUP BY ciudad
  ) c;

  SELECT
    COALESCE(STRING_AGG(fiabilidad::TEXT || ':' || cnt::TEXT, ',' ORDER BY fiabilidad), ''),
    COALESCE(jsonb_object_agg(fiabilidad::TEXT, cnt), '{}')
  INTO v_reliability, v_rel_json
  FROM (
    SELECT fiabilidad, COUNT(*) AS cnt
    FROM public.adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL
    GROUP BY fiabilidad
  ) r;

  SELECT MIN(created_at), MAX(created_at)
  INTO v_first, v_last
  FROM public.adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL;

  v_first_text := COALESCE(v_first::TEXT, '');
  v_last_text  := COALESCE(v_last::TEXT, '');

  SELECT COALESCE(jsonb_agg(public_commitment ORDER BY public_commitment), '[]')
  INTO v_comm_json
  FROM public.adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL;

  v_input :=
    p_protest_id::TEXT                          || '|' ||
    COALESCE(v_protest.title, '')               || '|' ||
    COALESCE(v_protest.demands, '')             || '|' ||
    COALESCE(v_protest.scope, '')               || '|' ||
    COALESCE(v_protest.country, '')             || '|' ||
    COALESCE(v_protest.count::TEXT, '0')       || '|' ||
    COALESCE(v_protest.cities::TEXT, '0')      || '|' ||
    v_reliability                               || '|' ||
    v_cities                                    || '|' ||
    v_first_text                                || '|' ||
    v_last_text                                 || '|' ||
    v_commitments;

  v_hash := encode(extensions.digest(v_input, 'sha256'), 'hex');

  INSERT INTO public.integrity_records (
    protest_id, integrity_version, integrity_hash, canonical_input,
    public_commitments, total_adhesions, city_distribution,
    reliability_breakdown, first_adhesion, last_adhesion,
    first_adhesion_text, last_adhesion_text,
    closed_at, calculated_at
  ) VALUES (
    p_protest_id, 2, v_hash, v_input,
    v_comm_json, COALESCE(v_protest.count, 0), v_city_json,
    v_rel_json, v_first, v_last,
    v_first_text, v_last_text,
    NOW(), NOW()
  );

  RETURN v_hash;
END;
$function$
