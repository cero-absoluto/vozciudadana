-- ============================================================================
-- Fix the real convocatoria-closure mechanism (24 July 2026)
--
-- Discovered while wiring IndexNow to a "closure" event: there is no such
-- event today because the two pieces of infrastructure that were supposed
-- to provide it have been silently broken since they were written.
--
-- 1. The scheduled job 'auto-close-protests' (20260611_integrity_v2.sql,
--    running every 30 minutes via pg_cron) filters and writes a `status`
--    column on `protests` — a column that has never existed on this table
--    (confirmed against the original schema, 20260501_init.sql, and every
--    migration since). Every single run of this job has failed silently
--    inside pg_cron since 11 June 2026; nothing in the application would
--    ever have surfaced this, since pg_cron logs failures internally
--    (cron.job_run_details), not anywhere the app or its logs would show.
--
-- 2. calculate_integrity_hash_v2() (20260611_integrity_records.sql) selects
--    a column named `cities_count` — the real column, since the original
--    schema, has always been named `cities`. Even if the closure job above
--    had worked, this function would have failed too.
--
-- The practical result: Principle 7 of the Founding Principles ("At the
-- closure of each convocation, Voice Protest computes a cryptographic
-- integrity hash...") has never actually executed in production. Every
-- closed convocatoria's hash_integridad is empty, including real ones
-- (Las Llamas, closed days before this fix). This is not a "not built yet"
-- gap — the code existed and looked complete; it silently never ran.
--
-- Fixed here: the closure job no longer depends on any `status` column —
-- it uses `ends_at < NOW() AND hash_integridad IS NULL` as both the
-- "needs closing" condition and its own idempotency guard (once
-- hash_integridad is set, a protest is never picked up again, so this can
-- safely keep running every 30 minutes indefinitely). The hash function
-- now reads `cities`, matching the real schema.
-- ============================================================================

-- ── 1. Fix calculate_integrity_hash_v2(): cities_count → cities ──────────
CREATE OR REPLACE FUNCTION calculate_integrity_hash_v2(p_protest_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_protest     RECORD;
  v_commitments TEXT;
  v_cities      TEXT;
  v_reliability TEXT;
  v_first       TIMESTAMPTZ;
  v_last        TIMESTAMPTZ;
  v_input       TEXT;
  v_hash        TEXT;
  v_city_json   JSONB;
  v_rel_json    JSONB;
  v_comm_json   JSONB;
BEGIN
  SELECT title, demands, scope, country, count, cities, starts_at, ends_at
  INTO v_protest
  FROM protests WHERE id = p_protest_id;

  -- Generate public_commitments if not already done
  UPDATE adhesions
  SET public_commitment = encode(digest(p_protest_id::TEXT || nullifier, 'sha256'), 'hex')
  WHERE protest_id = p_protest_id AND deleted_at IS NULL AND public_commitment IS NULL;

  -- Sorted commitments string
  SELECT COALESCE(STRING_AGG(public_commitment, '|' ORDER BY public_commitment), '')
  INTO v_commitments
  FROM adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL;

  -- City distribution
  SELECT
    COALESCE(STRING_AGG(ciudad || ':' || cnt::TEXT, ',' ORDER BY ciudad), ''),
    COALESCE(jsonb_object_agg(ciudad, cnt), '{}')
  INTO v_cities, v_city_json
  FROM (
    SELECT ciudad, COUNT(*) AS cnt
    FROM adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL AND ciudad IS NOT NULL
    GROUP BY ciudad
  ) c;

  -- Reliability breakdown
  SELECT
    COALESCE(STRING_AGG(fiabilidad::TEXT || ':' || cnt::TEXT, ',' ORDER BY fiabilidad), ''),
    COALESCE(jsonb_object_agg(fiabilidad::TEXT, cnt), '{}')
  INTO v_reliability, v_rel_json
  FROM (
    SELECT fiabilidad, COUNT(*) AS cnt
    FROM adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL
    GROUP BY fiabilidad
  ) r;

  -- First and last adhesion
  SELECT MIN(created_at), MAX(created_at)
  INTO v_first, v_last
  FROM adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL;

  -- Public commitments as JSON array
  SELECT COALESCE(jsonb_agg(public_commitment ORDER BY public_commitment), '[]')
  INTO v_comm_json
  FROM adhesions WHERE protest_id = p_protest_id AND deleted_at IS NULL;

  -- Build canonical input
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
    COALESCE(v_first::TEXT, '')                 || '|' ||
    COALESCE(v_last::TEXT, '')                  || '|' ||
    v_commitments;

  v_hash := encode(digest(v_input, 'sha256'), 'hex');

  -- Save permanent integrity record
  INSERT INTO integrity_records (
    protest_id, integrity_version, integrity_hash, canonical_input,
    public_commitments, total_adhesions, city_distribution,
    reliability_breakdown, first_adhesion, last_adhesion,
    closed_at, calculated_at
  ) VALUES (
    p_protest_id, 2, v_hash, v_input,
    v_comm_json, COALESCE(v_protest.count, 0), v_city_json,
    v_rel_json, v_first, v_last,
    NOW(), NOW()
  )
  ON CONFLICT (protest_id) DO UPDATE SET
    integrity_hash    = EXCLUDED.integrity_hash,
    canonical_input   = EXCLUDED.canonical_input,
    public_commitments = EXCLUDED.public_commitments,
    calculated_at     = NOW();

  RETURN v_hash;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Fix the closure job: no `status` column, ever ─────────────────────
DO $$
DECLARE v_jobid INTEGER;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'auto-close-protests' LIMIT 1;
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END $$;

SELECT cron.schedule(
  'auto-close-protests',
  '*/30 * * * *',
  $$
    WITH closing AS (
      -- "Needs closing" = past its end date AND not yet processed. No
      -- status column involved — hash_integridad IS NULL is both the
      -- filter and the idempotency guard: once set, never picked up again.
      SELECT id, saldo_euros, title
      FROM protests
      WHERE ends_at < NOW() AND hash_integridad IS NULL
    ),
    hashed AS (
      UPDATE protests
      SET
        hash_integridad          = calculate_integrity_hash_v2(id),
        integrity_version        = 2,
        integrity_calculated_at  = NOW()
      WHERE id IN (SELECT id FROM closing)
      RETURNING id, saldo_euros, title
    ),
    surplus AS (
      INSERT INTO platform_fund (type, amount, source, protest_id, description)
      SELECT 'income', saldo_euros, 'protest_surplus', id, 'Surplus from closed protest: ' || title
      FROM hashed WHERE saldo_euros > 0
      RETURNING protest_id, amount
    ),
    movements AS (
      INSERT INTO financial_movements (type, protest_id, amount, destination, description)
      SELECT 'protest_surplus', protest_id, amount, 'platform_fund',
             'Surplus transferred to platform fund on protest close'
      FROM surplus
    )
    UPDATE protests SET saldo_euros = 0 WHERE id IN (SELECT id FROM hashed) AND saldo_euros > 0;
  $$
);

-- ── 3. Catch up every already-closed convocatoria right now ──────────────
-- Without this, the fix above only helps convocatorias that close from now
-- on — every one that already passed its ends_at before today (Las Llamas
-- included) would sit unclosed until the next 30-minute tick picks it up
-- anyway, but running it once here immediately closes the backlog rather
-- than waiting.
DO $$
DECLARE v_protest RECORD;
BEGIN
  FOR v_protest IN
    SELECT id FROM protests WHERE ends_at < NOW() AND hash_integridad IS NULL
  LOOP
    UPDATE protests
    SET hash_integridad = calculate_integrity_hash_v2(v_protest.id),
        integrity_version = 2,
        integrity_calculated_at = NOW()
    WHERE id = v_protest.id;
  END LOOP;
END $$;
