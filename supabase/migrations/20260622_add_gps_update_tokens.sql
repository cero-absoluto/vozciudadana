-- Migration: GPS update tokens for post-adhesion GPS reinforcement
--
-- Design (June 2026, auditor approved):
-- - Token is emitted at join time and returned in the 201 response
-- - Frontend stores token in sessionStorage (not localStorage — expires with session)
-- - PATCH /api/protests/:id/adhesion uses token to identify adhesion
-- - Token is single-use: invalidated after first GPS update
-- - Token expires after 24h
-- - nullifier is NEVER sent to the client (auditor requirement)

create table if not exists gps_update_tokens (
  token       text        primary key,
  adhesion_id uuid        not null references adhesions(id) on delete cascade,
  protest_id  uuid        not null references protests(id)  on delete cascade,
  used        boolean     not null default false,
  expires_at  timestamptz not null default (now() + interval '24 hours'),
  created_at  timestamptz not null default now()
);

-- Index for fast lookup by token
create index if not exists gps_update_tokens_adhesion_idx
  on gps_update_tokens (adhesion_id);

-- Auto-cleanup: tokens older than 48h can be deleted
comment on table gps_update_tokens is
  'Single-use tokens for post-adhesion GPS update. Expires 24h after issuance. Never exposes nullifier to client.';
