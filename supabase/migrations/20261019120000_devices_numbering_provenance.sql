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
--                           'resolved_unshared'; NULL otherwise
--   numbering_resolution    'resolved_unshared' | 'shared_calling_code' | 'no_result'
--   numbering_meta_version  which metadata produced the derivation
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

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'devices_numbering_provenance_coherent'
  ) then
    alter table devices add constraint devices_numbering_provenance_coherent check (
      -- no provenance at all (legacy rows) …
      (numbering_resolution is null and numbering_country is null and numbering_meta_version is null)
      or
      -- … or a complete, coherent derivation
      (numbering_resolution is not null
        and numbering_resolution in ('resolved_unshared', 'shared_calling_code', 'no_result')
        and numbering_meta_version is not null
        and ((numbering_resolution = 'resolved_unshared' and numbering_country is not null)
          or (numbering_resolution <> 'resolved_unshared' and numbering_country is null)))
    );
  end if;
end $$;

comment on column devices.numbering_country is
  'Numbering-plan country of the OTP-verified number, server-derived; only when numbering_resolution = resolved_unshared. Not nationality, residence or location.';
comment on column devices.numbering_resolution is
  'resolved_unshared | shared_calling_code | no_result. NULL = no reliable provenance (legacy row).';
