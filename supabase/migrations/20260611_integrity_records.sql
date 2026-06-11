-- Migration: Integrity records table
-- Date: 2026-06-11
-- Purpose: Store a permanent snapshot of integrity data at protest closure.
--          After 90 days, adhesions are soft-deleted — this table preserves
--          the public_commitments and canonical payload needed for independent
--          verification permanently, without storing personal data.

-- ── 1. Create integrity_records table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrity_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protest_id          UUID NOT NULL REFERENCES protests(id) ON DELETE CASCADE,
  integrity_version   INTEGER NOT NULL DEFAULT 2,
  integrity_hash      TEXT NOT NULL,
  canonical_input     TEXT NOT NULL,
  public_commitments  JSONB NOT NULL DEFAULT '[]',
  total_adhesions     INTEGER NOT NULL DEFAULT 0,
  city_distribution   JSONB NOT NULL DEFAULT '{}',
  reliability_breakdown JSONB NOT NULL DEFAULT '{}',
  first_adhesion      TIMESTAMPTZ,
  last_adhesion       TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ NOT NULL,
  calculated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integrity_records_protest
  ON integrity_records(protest_id);

-- ── 2. Update calculate_integrity_hash_v2 to also save integrity_record ──
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
  SELECT title, demands, scope, country, count, cities_count, starts_at, ends_at
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
    COALESCE(v_protest.cities_count::TEXT, '0') || '|' ||
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

COMMENT ON TABLE integrity_records IS
  'Permanent snapshot of integrity data at protest closure. '
  'Preserved after adhesions are soft-deleted at 90 days. '
  'Enables independent public verification indefinitely.';
