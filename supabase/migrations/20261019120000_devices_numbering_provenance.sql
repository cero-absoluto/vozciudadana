-- ============================================================================
-- H7 — provenance of the country used for NATIONAL eligibility.
--
-- REVIEW-ONLY FILE: prepared for audit and tested on a disposable local
-- database. It must NOT be applied to production (or any shared copy) without
-- the Owner's express authorization. Deployment order if ever authorized:
-- apply this migration BEFORE deploying the API that writes these columns
-- (the API's verify-otp writes them; without them that call fails).
--
-- WHAT THIS DOES: adds three nullable columns to `devices`, written by the
-- server at OTP verification time from the verified number:
--   numbering_country       ISO 3166-1 alpha-2, only when resolution is
--                           'resolved_unshared' or 'resolved_shared_unique'; NULL otherwise
--   numbering_resolution    'resolved_unshared' | 'resolved_shared_unique'
--                           | 'shared_calling_code' | 'no_result'
--   numbering_meta_version  which metadata AND which criterion (R-N2) produced it
-- ('resolved_shared_unique' = shared calling code, but exactly one country's
-- metadata validates the full number; added in the R-N2 revision. This file has
-- not been applied anywhere, so it is edited in place rather than adding a second
-- migration; the constraint is dropped and re-created so a re-run also upgrades.)
-- It identifies the NUMBERING PLAN of the number: not nationality, residence,
-- location or the real country of SIM registration.
--
-- WHAT THIS DOES NOT DO:
--   * No backfill. Rows that exist today keep all three columns NULL, which
--     means "no reliable provenance": the API asks those devices for a fresh
--     verification only when they join a NATIONAL convocatoria.
--   * No change to adhesions, nullifiers, hashes, integrity records or any
--     historical data. `devices.country_code` (client-declared) stays as
--     informational data and is no longer used for eligibility.
--   * No foreign key on numbering_country: country_codes only covers a subset
--     of ISO countries and the derivation must not depend on that table.
--
-- Idempotent and safe to re-run.
-- ============================================================================

alter table devices
  add column if not exists numbering_country       char(2),
  add column if not exists numbering_resolution    text,
  add column if not exists numbering_meta_version  text;

alter table devices drop constraint if exists devices_numbering_provenance_coherent;
alter table devices add constraint devices_numbering_provenance_coherent check (
  -- no provenance at all (legacy rows) …
  (numbering_resolution is null and numbering_country is null and numbering_meta_version is null)
  or
  -- … or a complete, coherent derivation
  (numbering_resolution is not null
    and numbering_resolution in ('resolved_unshared', 'resolved_shared_unique', 'shared_calling_code', 'no_result')
    and numbering_meta_version is not null
    and ((numbering_resolution in ('resolved_unshared', 'resolved_shared_unique') and numbering_country is not null)
      or (numbering_resolution not in ('resolved_unshared', 'resolved_shared_unique') and numbering_country is null)))
);

comment on column devices.numbering_country is
  'Numbering-plan country of the OTP-verified number, server-derived; only when numbering_resolution is resolved_unshared or resolved_shared_unique. Not nationality, residence or location.';
comment on column devices.numbering_resolution is
  'resolved_unshared | resolved_shared_unique | shared_calling_code | no_result. NULL = no reliable provenance (legacy row).';
