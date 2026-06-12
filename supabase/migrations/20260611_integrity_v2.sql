-- Migration: Public integrity commitments (v2)
-- Date: 2026-06-11
-- Purpose: Add columns, index and cron job for the v2 integrity system.
--   v1 = internal HMAC-SHA256 seal (existing, not publicly reproducible)
--   v2 = SHA256 over public_commitments (publicly verifiable by anyone)
--
-- public_commitment = SHA256(protest_id + nullifier)
-- This is unique per adhesion AND per protest — prevents cross-protest correlation.
-- Can be published without revealing phone numbers or internal identifiers.
--
-- NOTE: calculate_integrity_hash_v2() is intentionally defined only in
-- 20260611_integrity_records.sql to ensure the permanent integrity snapshot
-- is always written to integrity_records.
-- Do not redefine it here.

-- ── 1. Add public_commitment column to adhesions ──────────────────────────
ALTER TABLE adhesions
  ADD COLUMN IF NOT EXISTS public_commitment TEXT;

-- ── 2. Add integrity versioning and timestamp to protests ─────────────────
ALTER TABLE protests
  ADD COLUMN IF NOT EXISTS integrity_version      INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS integrity_calculated_at TIMESTAMPTZ;

-- ── 3. calculate_integrity_hash_v2() — defined in 20260611_integrity_records.sql
-- See that file for the full implementation including integrity_records snapshot.
-- Do not redefine here.

-- ── 4. Update auto-close job to use v2 ───────────────────────────────────
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
      UPDATE protests
      SET status = 'closed'
      WHERE status = 'active' AND ends_at < NOW()
      RETURNING id, saldo_euros, title
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

-- ── 5. Index for public commitments ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_adhesions_commitment
  ON adhesions(protest_id, public_commitment)
  WHERE public_commitment IS NOT NULL;

COMMENT ON COLUMN adhesions.public_commitment IS
  'SHA256(protest_id + nullifier). Unique per adhesion and per protest. '
  'Safe to publish — does not reveal phone number and prevents cross-protest correlation. '
  'Used for v2 publicly verifiable integrity hash.';

COMMENT ON COLUMN protests.integrity_version IS
  '1 = internal HMAC-SHA256 seal (not publicly reproducible). '
  '2 = SHA256 over public_commitments (publicly verifiable by anyone).';

COMMENT ON COLUMN protests.integrity_calculated_at IS
  'Timestamp when integrity hash was calculated. Useful for audit trail.';
