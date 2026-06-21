-- Migration: add lat/lon coordinates for local scope municipality
-- These are the public geographic center coordinates of the declared municipality,
-- not participant GPS coordinates. They are used to render the protest on the world map.
-- Source: Nominatim reverse geocoding at municipality selection time.

alter table protests
  add column if not exists convocatoria_lat  float default null,
  add column if not exists convocatoria_lon  float default null;

comment on column protests.convocatoria_lat is
  'Geographic center latitude of the declared municipality (from Nominatim). Public data — not participant GPS.';
comment on column protests.convocatoria_lon is
  'Geographic center longitude of the declared municipality (from Nominatim). Public data — not participant GPS.';
