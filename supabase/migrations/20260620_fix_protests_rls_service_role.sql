-- Fix: protests_service_write policy was applying to 'public' instead of 'service_role'.
-- Identified in security audit June 2026 (Opus 4.8 + Sonnet 4.6).
-- Without this fix, anyone with the anon key could insert directly into protests
-- via PostgREST, bypassing all backend admission rules.

drop policy if exists protests_service_write on protests;

create policy protests_service_write
  on protests for all to service_role
  using (true) with check (true);
