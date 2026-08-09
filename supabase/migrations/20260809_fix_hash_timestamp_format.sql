-- ============================================================================
-- Fix integrity hash timestamp format mismatch (9 August 2026)
--
-- Found via the first real end-to-end test of the "Verificar integridad"
-- button on Las Llamas: it ran (no longer erroring, per the earlier fixes
-- today) but reported a mismatch, on data nobody had touched.
--
-- Cause: calculate_integrity_hash_v2() casts first/last adhesion timestamps
-- with `::TEXT` when building the hash input — Postgres's own default
-- cast, formatted like `2026-07-16 19:00:00+00` (space-separated, no "T").
-- What gets stored in integrity_records.first_adhesion/last_adhesion,
-- though, is the raw TIMESTAMPTZ value — which PostgREST (Supabase's API
-- layer) later re-serializes to JSON as ISO 8601, e.g.
-- `2026-07-16T19:00:00+00:00`. Two different strings for the same instant,
-- so recomputing the hash client-side from the API's version can never
-- match the one computed server-side at closure time — regardless of
-- whether anything was tampered with. This is not a security bug (nothing
-- was ever actually forgeable) — it is a false-negative bug: real,
-- untampered reports would always show "mismatch".
--
-- Fixed by never re-deriving the string a second time: the exact text used
-- in the hash is now stored as its own column and returned as-is for
-- verification, instead of being reconstructed independently by two
-- different code paths (Postgres's ::TEXT cast vs PostgREST's JSON
-- serialization) that were never guaranteed to agree.
-- ============================================================================

ALTER TABLE integrity_records
  ADD COLUMN IF NOT EXISTS first_adhesion_text TEXT,
  ADD COLUMN IF NOT EXISTS last_adhesion_text TEXT;

COMMENT ON COLUMN integrity_records.first_adhesion_text IS
  'The exact string (v_first::TEXT) used inside calculate_integrity_hash_v2() when this hash was computed — not re-derived from the timestamptz column, which PostgREST would format differently (ISO 8601) than Postgres''s own ::TEXT cast, causing every independent verification to show a false mismatch.';

CREATE OR REPLACE FUNCTION calculate_integrity_hash_v2(p_protest_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_protest     RECORD;
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
  FROM protests WHERE id = p_protest_id;

  UPDATE adhesions
  SET public_commitment = encode(digest(p_protest_id::TEXT || nullifier, 'sha256'), 'hex')
  WHERE protest_id = p_protest_id AND deleted_at IS NULL AND public_commitment IS NULL;

  SELECT COALESCE(STRING_AGG(public_commitment, '|' ORDER BY public_commitment), '')
  INTO v_commitments
  FROM adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL;

  SELECT
    COALESCE(STRING_AGG(ciudad || ':' || cnt::TEXT, ',' ORDER BY ciudad), ''),
    COALESCE(jsonb_object_agg(ciudad, cnt), '{}')
  INTO v_cities, v_city_json
  FROM (
    SELECT ciudad, COUNT(*) AS cnt
    FROM adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL AND ciudad IS NOT NULL
    GROUP BY ciudad
  ) c;

  SELECT
    COALESCE(STRING_AGG(fiabilidad::TEXT || ':' || cnt::TEXT, ',' ORDER BY fiabilidad), ''),
    COALESCE(jsonb_object_agg(fiabilidad::TEXT, cnt), '{}')
  INTO v_reliability, v_rel_json
  FROM (
    SELECT fiabilidad, COUNT(*) AS cnt
    FROM adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL
    GROUP BY fiabilidad
  ) r;

  SELECT MIN(created_at), MAX(created_at)
  INTO v_first, v_last
  FROM adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL;

  -- Compute the exact text ONCE, here — this is the string that goes into
  -- the hash AND the string that gets stored for later verification. No
  -- other code path is allowed to re-derive it independently.
  v_first_text := COALESCE(v_first::TEXT, '');
  v_last_text  := COALESCE(v_last::TEXT, '');

  SELECT COALESCE(jsonb_agg(public_commitment ORDER BY public_commitment), '[]')
  INTO v_comm_json
  FROM adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL;

  v_input :=
    p_protest_id::TEXT                          || '|' ||
    COALESCE(v_protest.title, '')               || '|' ||
    COALESCE(v_protest.demands, '')             || '|' ||
    COALESCE(v_protest.scope, '')               || '|' ||
    COALESCE(v_protest.country, '')             || '|' ||
    COALESCE(v_protest.count::TEXT, '0')       || '|' ||
    COALESCE(v_protest.cities::TEXT, '0')       || '|' ||
    v_reliability                               || '|' ||
    v_cities                                    || '|' ||
    v_first_text                                || '|' ||
    v_last_text                                 || '|' ||
    v_commitments;

  v_hash := encode(digest(v_input, 'sha256'), 'hex');

  INSERT INTO integrity_records (
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
  )
  ON CONFLICT (protest_id) DO UPDATE SET
    integrity_hash       = EXCLUDED.integrity_hash,
    canonical_input      = EXCLUDED.canonical_input,
    public_commitments   = EXCLUDED.public_commitments,
    first_adhesion_text  = EXCLUDED.first_adhesion_text,
    last_adhesion_text   = EXCLUDED.last_adhesion_text,
    calculated_at        = NOW();

  RETURN v_hash;
END;
$$ LANGUAGE plpgsql;

-- Recompute for every already-closed convocatoria, so existing hashes get
-- the new exact-text columns populated too — otherwise only future
-- closures would verify correctly, leaving Las Llamas and any other
-- already-closed convocatoria still showing a false mismatch.
DO $$
DECLARE v_protest RECORD;
BEGIN
  FOR v_protest IN
    SELECT id FROM protests WHERE hash_integridad IS NOT NULL
  LOOP
    PERFORM calculate_integrity_hash_v2(v_protest.id);
  END LOOP;
END $$;
