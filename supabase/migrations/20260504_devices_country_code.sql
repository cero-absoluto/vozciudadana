-- ============================================================
--  Voice Protest — add country_code to devices
-- ============================================================

alter table devices
  add column if not exists country_code char(2)
    references country_codes(iso2)
    on update cascade
    on delete set null;
