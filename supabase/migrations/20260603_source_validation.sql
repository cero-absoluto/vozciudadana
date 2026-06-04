-- Migration: Source validation system
-- Date: 2026-06-03
-- Purpose: Store source validation results and add source metadata to protests

-- ── 1. Source validations cache table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS source_validations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url               TEXT NOT NULL,
  canonical_url            TEXT,
  source_domain            TEXT,
  source_type              TEXT,
  source_title             TEXT,
  source_description       TEXT,
  source_author            TEXT,
  published_at             TEXT,
  language                 TEXT,
  preview_image            TEXT,
  source_confidence_score  INTEGER,
  source_relevance_score   INTEGER,
  source_validation_status TEXT,
  source_validation_source TEXT,
  source_checked_at        TIMESTAMPTZ DEFAULT now(),
  source_error             TEXT,
  created_at               TIMESTAMPTZ DEFAULT now()
);

-- Index for fast domain lookup
CREATE INDEX IF NOT EXISTS idx_source_validations_domain
  ON source_validations(source_domain);

-- Index for URL deduplication
CREATE INDEX IF NOT EXISTS idx_source_validations_url
  ON source_validations(source_url);

-- ── 2. Add source metadata columns to protests table ──────────────────────
ALTER TABLE protests
  ADD COLUMN IF NOT EXISTS source_domain            TEXT,
  ADD COLUMN IF NOT EXISTS source_type              TEXT,
  ADD COLUMN IF NOT EXISTS source_title             TEXT,
  ADD COLUMN IF NOT EXISTS source_description       TEXT,
  ADD COLUMN IF NOT EXISTS source_author            TEXT,
  ADD COLUMN IF NOT EXISTS published_at             TEXT,
  ADD COLUMN IF NOT EXISTS source_confidence_score  INTEGER,
  ADD COLUMN IF NOT EXISTS source_relevance_score   INTEGER,
  ADD COLUMN IF NOT EXISTS source_validation_status TEXT DEFAULT 'NEEDS_REVIEW',
  ADD COLUMN IF NOT EXISTS source_validation_source TEXT,
  ADD COLUMN IF NOT EXISTS source_checked_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_error             TEXT;

-- Index for filtering by validation status
CREATE INDEX IF NOT EXISTS idx_protests_source_validation
  ON protests(source_validation_status);

COMMENT ON TABLE source_validations IS 'Cache of source URL validation results';
COMMENT ON COLUMN protests.source_validation_status IS
  'VERIFIED_SOURCE | RELEVANT_SOURCE | WEAK_SOURCE | UNAVAILABLE_SOURCE | PAYWALLED_SOURCE | UNRELATED_SOURCE | BLOCKED_SOURCE | NEEDS_REVIEW';
COMMENT ON COLUMN protests.source_confidence_score IS
  'Composite score 0-100: domain(35) + access(15) + meta(10) + date(10) + canonical(5) + relevance(30)';
