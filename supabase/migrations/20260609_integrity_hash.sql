-- Migration: Integrity hash on protest close
-- Date: 2026-06-09
-- Purpose: When a protest closes, calculate an integrity hash from all
--          its adhesion nullifiers. This hash is stored in hash_integridad
--          and published in the public report. Any post-close manipulation
--          of adhesions would change the hash, making tampering detectable.
--
-- Hash formula:
--   SHA256( protest_id || ':' || count || ':' || sorted_nullifiers_concatenated )
--
-- Nullifiers are pseudonymous identifiers — they reveal no personal data
-- but uniquely represent each adhesion. Sorting alphabetically ensures
-- the hash is deterministic regardless of insertion order.

-- ── 1. Create function to calculate integrity hash ────────────────────────
CREATE OR REPLACE FUNCTION calculate_integrity_hash(p_protest_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_count INTEGER;
  v_nullifiers TEXT;
  v_input TEXT;
BEGIN
  -- Get final adhesion count
  SELECT COUNT(*)
  INTO v_count
  FROM adhesions
  WHERE protest_id = p_protest_id
    AND deleted_at IS NULL;

  -- Concatenate all nullifiers sorted alphabetically
  SELECT STRING_AGG(nullifier, '|' ORDER BY nullifier)
  INTO v_nullifiers
  FROM adhesions
  WHERE protest_id = p_protest_id
    AND deleted_at IS NULL;

  -- Build input string
  v_input := p_protest_id::TEXT || ':' || v_count::TEXT || ':' || COALESCE(v_nullifiers, '');

  -- Return SHA256 hex digest
  RETURN encode(digest(v_input, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql;

-- ── 2. Update auto-close job to also calculate integrity hash ─────────────
SELECT cron.unschedule('auto-close-protests');

SELECT cron.schedule(
  'auto-close-protests',
  '*/30 * * * *',
  $$
    -- Close active protests that have ended
    UPDATE protests
    SET
      status = 'closed',
      hash_integridad = calculate_integrity_hash(id)
    WHERE status = 'active'
      AND ends_at < NOW();
  $$
);

-- ── 3. Backfill hash for already-closed protests without a hash ───────────
UPDATE protests
SET hash_integridad = calculate_integrity_hash(id)
WHERE status IN ('closed', 'archived')
  AND hash_integridad IS NULL;

-- ── 4. Verify the function works ──────────────────────────────────────────
-- SELECT id, count, hash_integridad FROM protests WHERE status = 'closed' LIMIT 3;

COMMENT ON FUNCTION calculate_integrity_hash IS 'Calculates SHA256 hash of protest_id + count + sorted nullifiers. Published in public report. Any post-close manipulation of adhesions changes the hash, making tampering detectable by anyone.';
