-- ============================================================
--  Voz Ciudadana — initial schema
--  Run: supabase db push  (or paste into Supabase SQL editor)
-- ============================================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ── protests ────────────────────────────────────────────────
create table if not exists protests (
  id            uuid primary key default gen_random_uuid(),
  title         text        not null,
  description   text        not null,
  demands       text,
  country       char(2),                            -- ISO alpha-2, null = global
  country_name  text        not null,
  scope         text        not null check (scope in ('national','regional','global')),
  region        text,                               -- 'eu' | 'mercosur' | 'asean' | 'latam' | 'g20'
  focal_point   text,
  category      text,
  risk_level    text        not null default 'low'
                            check (risk_level in ('low','med','high','critical')),
  count         integer     not null default 0,
  viral_count   integer     not null default 0,
  heat          smallint    not null default 5,
  cities        integer     not null default 1,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz not null,
  created_at    timestamptz not null default now()
);

-- ── devices ─────────────────────────────────────────────────
create table if not exists devices (
  id           text        primary key,            -- client-generated random hex-32
  phone_hash   text        not null unique,         -- SHA-256 of (country_code + number)
  doc_hash     text,                               -- SHA-256 of document, optional
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ── adhesions ───────────────────────────────────────────────
create table if not exists adhesions (
  id          uuid        primary key default gen_random_uuid(),
  protest_id  uuid        not null references protests(id) on delete cascade,
  device_id   text        not null references devices(id),
  phone_hash  text        not null,
  doc_hash    text,
  created_at  timestamptz not null default now(),
  unique (protest_id, device_id)                   -- one adhesion per device per protest
);

-- ── otp_requests ────────────────────────────────────────────
create table if not exists otp_requests (
  id           uuid        primary key default gen_random_uuid(),
  phone_hash   text        not null,
  requested_at timestamptz not null default now()
);

-- ── RPC helpers ─────────────────────────────────────────────
create or replace function increment_protest_count(protest_id uuid)
returns void language sql as $$
  update protests set count = count + 1 where id = protest_id;
$$;

create or replace function increment_viral_count(protest_id uuid)
returns void language sql as $$
  update protests set viral_count = viral_count + 1 where id = protest_id;
$$;

-- ── Row-Level Security ───────────────────────────────────────
alter table protests   enable row level security;
alter table devices    enable row level security;
alter table adhesions  enable row level security;

-- Public read for protests
create policy "protests_public_read" on protests for select using (true);
-- Service role writes
create policy "protests_service_write" on protests for all using (auth.role() = 'service_role');
create policy "devices_service_all"    on devices  for all using (auth.role() = 'service_role');
create policy "adhesions_service_all"  on adhesions for all using (auth.role() = 'service_role');
