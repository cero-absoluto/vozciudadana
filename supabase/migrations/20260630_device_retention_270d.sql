-- ============================================================================
-- Verified-device retention: 270-day sliding inactivity window.
--
-- Completes the device-retention rule the application already assumes
-- (apps/api/src/routes/protests.js refreshes devices.last_seen on each
-- adhesion) but that was missing from the database layer: the last_seen
-- column and the purge job did not exist, so device pseudonyms were retained
-- indefinitely and the application's last_seen write failed silently
-- ('last_seen refresh failed').
--
-- WHAT THIS DOES:
--   1. Adds devices.last_seen (backfilled from the device's most recent
--      adhesion, else verified_at / created_at) and indexes it.
--   2. Deletes — once now, and daily thereafter — every device whose last_seen
--      is older than 270 days AND that is no longer referenced by any adhesion.
--
-- WHY "no longer referenced" is both safe and required:
--   adhesions.device_id is a FK to devices(id). Anonymised adhesions hold a
--   NULL device_id (see 20260628_anonymize_old_adhesions.sql), so a device
--   whose adhesions have all been anonymised — or that never adhered — has no
--   referencing rows and can be removed without violating the FK. A device
--   still referenced by a live adhesion is left untouched until that adhesion
--   is anonymised. The window is sliding: an active participant's last_seen is
--   refreshed on every adhesion and never expires; a device that returns after
--   deletion simply re-verifies once by SMS.
--
-- Idempotent and safe to re-run.
-- ============================================================================

create extension if not exists pg_cron;

-- ── 1. Column + backfill + index ────────────────────────────────────────────
alter table devices add column if not exists last_seen timestamptz;

-- Backfill existing rows to their best-known last activity: the most recent
-- adhesion for the device, falling back to verification, then creation time.
-- adhesions.created_at is aggregate-grade and is preserved through
-- anonymisation, so it remains a valid signal even for closed protests.
update devices d
set last_seen = coalesce(
  (select max(a.created_at) from adhesions a where a.device_id = d.id),
  d.verified_at,
  d.created_at
)
where d.last_seen is null;

-- New devices (inserted at verification) get last_seen = now() by default.
alter table devices alter column last_seen set default now();
alter table devices alter column last_seen set not null;

create index if not exists idx_devices_last_seen on devices(last_seen);

comment on column devices.last_seen is
  'Last effective activity, refreshed on each adhesion. Governs the 270-day '
  'sliding inactivity window after which an unreferenced device is deleted.';

-- ── 2. One-time purge of already-overdue, unreferenced devices ──────────────
delete from devices d
where d.last_seen < now() - interval '270 days'
  and not exists (select 1 from adhesions a where a.device_id = d.id);

-- ── 3. Daily purge job ──────────────────────────────────────────────────────
-- Runs at 03:30 UTC, after the 03:00 anonymisation job, so that adhesions
-- closed >90 days ago have already had their device_id nulled and the devices
-- they referenced become eligible the same night.
do $$
declare v_jobid integer;
begin
  select jobid into v_jobid from cron.job where jobname = 'cleanup-inactive-devices' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

select cron.schedule(
  'cleanup-inactive-devices',
  '30 3 * * *',
  $$
    delete from devices d
    where d.last_seen < now() - interval '270 days'
      and not exists (select 1 from adhesions a where a.device_id = d.id);
  $$
);
