-- Migration: Replace GPS coordinates with gps_confirmed boolean
-- Date: 2026-06-07
-- Purpose: GPS coordinates are used only for geocoding (city/region/country)
--          and must not be stored permanently. Only confirmation that GPS
--          was active at the moment of adhesion is retained.
--          This change aligns the database with the privacy policy.

-- 1. Add new boolean column
ALTER TABLE adhesions
  ADD COLUMN IF NOT EXISTS gps_confirmed BOOLEAN DEFAULT FALSE;

-- 2. Migrate existing data — any row with gps_lat set is confirmed
UPDATE adhesions
  SET gps_confirmed = TRUE
  WHERE gps_lat IS NOT NULL;

-- 3. Remove coordinate columns
ALTER TABLE adhesions
  DROP COLUMN IF EXISTS gps_lat,
  DROP COLUMN IF EXISTS gps_lng,
  DROP COLUMN IF EXISTS gps_accuracy;

-- 4. Index for report queries
CREATE INDEX IF NOT EXISTS idx_adhesions_gps_confirmed
  ON adhesions(gps_confirmed)
  WHERE gps_confirmed = TRUE;

COMMENT ON COLUMN adhesions.gps_confirmed IS
  'TRUE if GPS was active and verified at the moment of adhesion. Coordinates are never stored — only this boolean.';
