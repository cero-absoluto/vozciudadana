-- Migration: Ko-fi → protest_id mapping table.
-- Enables multiple concurrent fundraising protests without code changes.
-- To add a new mapping: insert a row with the Ko-fi Direct Link code
-- and the corresponding protest_id. Set active = false to disable.

create table if not exists kofi_protest_map (
  id          uuid primary key default gen_random_uuid(),
  kofi_code   text not null unique,     -- Ko-fi Direct Link code (set per button in Ko-fi dashboard)
  protest_id  uuid not null references protests(id) on delete cascade,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists kofi_protest_map_code_idx
  on kofi_protest_map (kofi_code)
  where active = true;
