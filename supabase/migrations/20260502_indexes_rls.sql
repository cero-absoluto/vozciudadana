-- ============================================================
--  Voice Protest — indexes, RLS hardening, updated_at column
-- ============================================================

-- ── Indexes on adhesions ─────────────────────────────────────
-- Foreign-key lookups (all adhesions for a protest / for a device)
create index if not exists idx_adhesions_protest_id on adhesions(protest_id);
create index if not exists idx_adhesions_device_id  on adhesions(device_id);

-- ── Indexes on protests ──────────────────────────────────────
-- Active-protest filter is the hot read path: ends_at > now()
create index if not exists idx_protests_ends_at on protests(ends_at desc);
-- Scope / country filters used in GET /api/protests
create index if not exists idx_protests_scope   on protests(scope);
create index if not exists idx_protests_country on protests(country);

-- ── Index on otp_requests ────────────────────────────────────
-- Rate-limit queries look up by phone_hash
create index if not exists idx_otp_requests_phone_hash on otp_requests(phone_hash);

-- ── RLS on otp_requests (was missing) ───────────────────────
alter table otp_requests enable row level security;

create policy "otp_requests_service_only"
  on otp_requests for all
  using (auth.role() = 'service_role');

-- ── updated_at column on protests ────────────────────────────
alter table protests
  add column if not exists updated_at timestamptz not null default now();

-- Auto-update updated_at on every row change
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_protests_updated_at on protests;
create trigger trg_protests_updated_at
  before update on protests
  for each row execute function set_updated_at();
