-- Migration: Integrity hash on protest close (v2 — full report hash)
-- Date: 2026-06-09
-- Purpose: When a protest closes, calculate an integrity hash covering
--          ALL fields that appear in the public report:
--          protest metadata + results + adhesion nullifiers.
--          Any post-close modification to ANY of these fields is detectable.
--
-- Hash formula:
--   SHA256(
--     protest_id || title || demands || scope || country ||
--     count || cities_count ||
--     reliability_breakdown (JSON sorted) ||
--     city_distribution (JSON sorted) ||
--     first_adhesion_timestamp || last_adhesion_timestamp ||
--     sorted_nullifiers
--   )

-- ── 1. Drop previous version if exists ───────────────────────────────────
DROP FUNCTION IF EXISTS calculate_integrity_hash(UUID);

-- ── 2. Create full report integrity hash function ─────────────────────────
CREATE OR REPLACE FUNCTION calculate_integrity_hash(p_protest_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_protest        RECORD;
  v_nullifiers     TEXT;
  v_cities         TEXT;
  v_reliability    TEXT;
  v_first_adhesion TEXT;
  v_last_adhesion  TEXT;
  v_input          TEXT;
BEGIN
  -- Get protest metadata
  SELECT title, demands, scope, country, count, cities_count,
         starts_at, ends_at
  INTO v_protest
  FROM protests
  WHERE id = p_protest_id;

  -- Get nullifiers sorted alphabetically
  SELECT COALESCE(STRING_AGG(nullifier, '|' ORDER BY nullifier), '')
  INTO v_nullifiers
  FROM adhesions
  WHERE protest_id = p_protest_id
    AND deleted_at IS NULL;

  -- Get city distribution sorted by city name
  SELECT COALESCE(
    STRING_AGG(ciudad || ':' || cnt::TEXT, ',' ORDER BY ciudad), ''
  )
  INTO v_cities
  FROM (
    SELECT ciudad, COUNT(*) AS cnt
    FROM adhesions
    WHERE protest_id = p_protest_id
      AND deleted_at IS NULL
      AND ciudad IS NOT NULL
    GROUP BY ciudad
  ) city_counts;

  -- Get reliability breakdown sorted by score
  SELECT COALESCE(
    STRING_AGG(fiabilidad::TEXT || ':' || cnt::TEXT, ',' ORDER BY fiabilidad), ''
  )
  INTO v_reliability
  FROM (
    SELECT fiabilidad, COUNT(*) AS cnt
    FROM adhesions
    WHERE protest_id = p_protest_id
      AND deleted_at IS NULL
    GROUP BY fiabilidad
  ) rel_counts;

  -- Get first and last adhesion timestamps
  SELECT
    COALESCE(MIN(created_at)::TEXT, ''),
    COALESCE(MAX(created_at)::TEXT, '')
  INTO v_first_adhesion, v_last_adhesion
  FROM adhesions
  WHERE protest_id = p_protest_id
    AND deleted_at IS NULL;

  -- Build canonical input string
  v_input :=
    p_protest_id::TEXT                         || '|' ||
    COALESCE(v_protest.title, '')              || '|' ||
    COALESCE(v_protest.demands, '')            || '|' ||
    COALESCE(v_protest.scope, '')              || '|' ||
    COALESCE(v_protest.country, '')            || '|' ||
    COALESCE(v_protest.count::TEXT, '0')       || '|' ||
    COALESCE(v_protest.cities_count::TEXT, '0')|| '|' ||
    v_reliability                              || '|' ||
    v_cities                                   || '|' ||
    v_first_adhesion                           || '|' ||
    v_last_adhesion                            || '|' ||
    v_nullifiers;

  RETURN encode(digest(v_input, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql;

-- ── 3. Unschedule previous auto-close job ─────────────────────────────────
SELECT cron.unschedule('auto-close-protests');

-- ── 4. New auto-close job with full integrity hash ────────────────────────
SELECT cron.schedule(
  'auto-close-protests',
  '*/30 * * * *',
  $$
    UPDATE protests
    SET
      status = 'closed',
      hash_integridad = calculate_integrity_hash(id)
    WHERE status = 'active'
      AND ends_at < NOW();
  $$
);

-- ── 5. Backfill hash for already-closed protests ──────────────────────────
UPDATE protests
SET hash_integridad = calculate_integrity_hash(id)
WHERE status IN ('closed', 'archived')
  AND hash_integridad IS NULL;

-- ── 6. Update comment ─────────────────────────────────────────────────────
COMMENT ON FUNCTION calculate_integrity_hash IS 'Calculates SHA256 hash covering: protest_id, title, demands, scope, country, count, cities_count, reliability breakdown, city distribution, first/last adhesion timestamps, and sorted nullifiers. Published in public report. Any post-close modification to any of these fields changes the hash, making tampering detectable by anyone.';
