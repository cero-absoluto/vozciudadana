-- 20260712_adhesions_pais_code.sql
--
-- Bug fix (July 2026): the public report classified adhesions as national vs
-- international by comparing localized country NAMES. The adhesion's `pais`
-- comes from ipapi.co (English, e.g. "Spain") or Nominatim with
-- Accept-Language: es (Spanish, e.g. "España"), while protests.country_name
-- is stored in Spanish. "Spain" !== "España" → every no-GPS adhesion from
-- inside the country was misclassified as international.
--
-- Fix: store the ISO 3166-1 alpha-2 country code alongside the display name
-- and classify by code. `pais` remains as the human-readable display value.
-- Existing rows keep pais_code NULL; the report falls back to the legacy
-- name comparison for those (documented limitation, resolves as old
-- adhesions are anonymized at 90 days).

ALTER TABLE adhesions
  ADD COLUMN IF NOT EXISTS pais_code text
  CHECK (pais_code IS NULL OR pais_code ~ '^[A-Z]{2}$');

COMMENT ON COLUMN adhesions.pais_code IS
  'ISO 3166-1 alpha-2 country code derived from GPS reverse geocoding or IP lookup. Used for national/international classification in the public report; language-independent, unlike pais.';
