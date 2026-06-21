-- Migration: add local scope support with municipality OSM ID
-- 
-- Design decision (June 2026):
-- For local protests, participants are NOT excluded by GPS location.
-- GPS is used as a verification signal that enriches the public report
-- with a local/national/international breakdown. This preserves the
-- core principle: Voice Protest verifies participation, not legitimacy.
--
-- The convocante selects a municipality via Nominatim search.
-- The osm_id is stored and used to classify adhesions in the report:
--   - GPS confirmed within municipality → local verified
--   - SIM national, no local GPS         → national participant
--   - SIM foreign                         → international participant

alter table protests
  add column if not exists convocatoria_osm_id      bigint default null,
  add column if not exists convocatoria_ciudad_nombre text  default null;

-- Index for efficient report queries filtering by osm_id
create index if not exists protests_osm_id_idx
  on protests (convocatoria_osm_id)
  where convocatoria_osm_id is not null;

-- Also store osm_id on adhesions for efficient local/non-local classification
-- in the public report without needing to re-geocode at report generation time.
alter table adhesions
  add column if not exists adhesion_osm_id bigint default null;

comment on column protests.convocatoria_osm_id is
  'OSM relation ID of the municipality (admin_level=8). Required for scope=local protests. Used to classify adhesions as local/national/international in the public report.';

comment on column protests.convocatoria_ciudad_nombre is
  'Human-readable municipality name as returned by Nominatim. Stored for display purposes only — all comparisons use convocatoria_osm_id.';

comment on column adhesions.adhesion_osm_id is
  'OSM relation ID of the municipality where the participant was located at adhesion time (from GPS reverse geocoding). Null if GPS was not provided or reverse geocoding failed.';
