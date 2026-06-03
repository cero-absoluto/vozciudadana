-- Migration: Add Wikidata target validation fields to protests table
-- Date: 2026-06-03
-- Purpose: Store validated entity information for the "Who is it directed at?" field

ALTER TABLE protests
  ADD COLUMN IF NOT EXISTS target_wikidata_id  TEXT,
  ADD COLUMN IF NOT EXISTS target_type         TEXT,
  ADD COLUMN IF NOT EXISTS target_country      TEXT,
  ADD COLUMN IF NOT EXISTS target_validation   TEXT DEFAULT 'NEEDS_REVIEW';

-- Index for filtering by validation status
CREATE INDEX IF NOT EXISTS idx_protests_target_validation ON protests(target_validation);

-- Set existing protests as NEEDS_REVIEW (they were created before validation existed)
UPDATE protests
  SET target_validation = 'NEEDS_REVIEW'
  WHERE target_validation IS NULL;

COMMENT ON COLUMN protests.target_wikidata_id IS 'Wikidata entity ID (e.g. Q9531 for BBC)';
COMMENT ON COLUMN protests.target_type        IS 'Entity type from Wikidata (e.g. Public Broadcaster)';
COMMENT ON COLUMN protests.target_country     IS 'Country of the entity from Wikidata';
COMMENT ON COLUMN protests.target_validation  IS 'ALLOWED | REJECTED | NEEDS_REVIEW';
