-- ============================================================================
-- Irreversible anonymisation of individual adhesion data at 90 days.
-- Replaces the soft-delete-only job from 20260605_logical_deletion.sql.
-- Privacy/security review June 2026.
--
-- WHAT HAPPENS: 90 days after a protest closes, every individual/linkable field
-- of its adhesions is set to NULL (irreversibly). The row is KEPT (structural
-- trace + aggregate), and the anonymised rows stay visible (deleted_at cleared)
-- so the closed public report keeps showing aggregate distribution — they no
-- longer hold any personal data.
--
-- NULLed (individual / linkable):
--   phone_hash, device_id, nullifier, doc_hash, public_commitment,
--   adhesion_osm_id, gps_lat, gps_lng, gps_accuracy, ciudad, region,
--   idioma, senales
--
-- KEPT (aggregate-grade, non-identifying):
--   id, protest_id, created_at, pais, gps_confirmed, fiabilidad
--
-- PRESERVED ELSEWHERE (untouched):
--   integrity_records (total_adhesions, city_distribution, reliability_breakdown,
--   public_commitments, integrity_hash, first/last adhesion) + the closed public
--   report served from it by public.js.
--
-- SAFETY GUARD: a protest is only anonymised if an integrity_record already
-- exists for it (aggregate snapshot safely preserved). Protests without one are
-- left untouched until the snapshot exists.
-- ============================================================================

-- ── 1. Marker column + relax NOT NULL on the fields we now nullify ──────────
alter table adhesions add column if not exists anonymized_at timestamptz default null;

alter table adhesions alter column phone_hash        drop not null;
alter table adhesions alter column device_id         drop not null;
-- defensive (no-op if already nullable):
alter table adhesions alter column doc_hash          drop not null;
alter table adhesions alter column nullifier         drop not null;
alter table adhesions alter column ciudad            drop not null;
alter table adhesions alter column region            drop not null;
alter table adhesions alter column idioma            drop not null;
alter table adhesions alter column senales           drop not null;
alter table adhesions alter column public_commitment drop not null;
alter table adhesions alter column adhesion_osm_id   drop not null;

-- ── 2. One-time backfill: anonymise any already-overdue adhesions now ───────
update adhesions a
set anonymized_at     = now(),
    deleted_at        = null,            -- un-hide: rows are now anonymous, keep report alive
    phone_hash        = null,
    device_id         = null,
    nullifier         = null,
    doc_hash          = null,
    public_commitment = null,
    adhesion_osm_id   = null,
    gps_lat           = null,
    gps_lng           = null,
    gps_accuracy      = null,
    ciudad            = null,
    region            = null,
    idioma            = null,
    senales           = null
where a.anonymized_at is null
  and a.protest_id in (
    select p.id from protests p
    where p.ends_at < now() - interval '90 days'
      and exists (select 1 from integrity_records ir where ir.protest_id = p.id)
  );

update protests p
set status = 'archived'
where p.status in ('active','closed')
  and p.ends_at < now() - interval '90 days'
  and exists (select 1 from integrity_records ir where ir.protest_id = p.id);

delete from push_subscriptions
where protest_id in (
  select p.id from protests p
  where p.ends_at < now() - interval '90 days'
    and exists (select 1 from integrity_records ir where ir.protest_id = p.id)
);

-- ── 3. Replace the soft-delete cron with the anonymisation cron ─────────────
do $$
declare v_jobid integer;
begin
  select jobid into v_jobid from cron.job where jobname = 'soft-delete-old-adhesions' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

select cron.schedule(
  'anonymize-old-adhesions',
  '0 3 * * *',
  $$
    update adhesions a
    set anonymized_at = now(),
        deleted_at = null,
        phone_hash = null, device_id = null, nullifier = null, doc_hash = null,
        public_commitment = null, adhesion_osm_id = null,
        gps_lat = null, gps_lng = null, gps_accuracy = null,
        ciudad = null, region = null, idioma = null, senales = null
    where a.anonymized_at is null
      and a.protest_id in (
        select p.id from protests p
        where p.ends_at < now() - interval '90 days'
          and exists (select 1 from integrity_records ir where ir.protest_id = p.id)
      );

    update protests p
    set status = 'archived'
    where p.status in ('active','closed')
      and p.ends_at < now() - interval '90 days'
      and exists (select 1 from integrity_records ir where ir.protest_id = p.id);

    delete from push_subscriptions
    where protest_id in (
      select p.id from protests p
      where p.ends_at < now() - interval '90 days'
        and exists (select 1 from integrity_records ir where ir.protest_id = p.id)
    );
  $$
);

-- ── 4. Documentation ───────────────────────────────────────────────────────
comment on column adhesions.anonymized_at is
  'Timestamp of irreversible anonymisation (90 days after protest close). When set, all individual/linkable fields are NULL; only aggregate-grade fields remain (pais, gps_confirmed, fiabilidad).';
comment on column adhesions.deleted_at is
  'Legacy soft-delete marker. Cleared on anonymisation: anonymised rows hold no personal data and stay visible so the closed report keeps its aggregate distribution. Auditable snapshot lives in integrity_records.';
