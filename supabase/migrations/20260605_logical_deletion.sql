-- Migration: Logical deletion and protest status
-- Date: 2026-06-05
-- Author: Stichting Voice Protest
-- Purpose: Add soft-delete support to adhesions and explicit status to protests

-- ── 1. Add status field to protests ───────────────────────────────────────
ALTER TABLE protests
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'archived'));

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_protests_status
  ON protests(status);

-- Mark already-closed protests (ends_at in the past)
UPDATE protests
  SET status = 'closed'
  WHERE ends_at < NOW()
  AND status = 'active';

-- ── 2. Add soft-delete field to adhesions ─────────────────────────────────
ALTER TABLE adhesions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_adhesions_deleted_at
  ON adhesions(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ── 3. Enable pg_cron extension (if not already enabled) ──────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 4. Soft-delete job: runs daily at 03:00 UTC ───────────────────────────
-- Marks adhesions as deleted when the protest closed more than 90 days ago
SELECT cron.schedule(
  'soft-delete-old-adhesions',
  '0 3 * * *',
  $$
    UPDATE adhesions
    SET deleted_at = NOW()
    WHERE deleted_at IS NULL
    AND protest_id IN (
      SELECT id FROM protests
      WHERE ends_at < NOW() - INTERVAL '90 days'
    );

    -- Also mark the protest as archived
    UPDATE protests
    SET status = 'archived'
    WHERE status = 'closed'
    AND ends_at < NOW() - INTERVAL '90 days';
  $$
);

-- ── 5. Auto-close protests when ends_at passes ──────────────────────────
-- Note: Physical deletion not scheduled. Soft-delete is sufficient for GDPR
-- compliance. Physical deletion can be added in the future if needed.
SELECT cron.schedule(
  'auto-close-protests',
  '*/30 * * * *',
  $$
    UPDATE protests
    SET status = 'closed'
    WHERE status = 'active'
    AND ends_at < NOW();
  $$
);

COMMENT ON COLUMN adhesions.deleted_at IS
  'Soft delete timestamp. NULL = active. Set by pg_cron 90 days after protest closes. No physical deletion scheduled — soft-delete is sufficient for GDPR compliance.';

COMMENT ON COLUMN protests.status IS
  'active = ongoing | closed = ended, data retained | archived = ended 90+ days ago, adhesion data soft-deleted';
