-- ============================================================================
-- Enable Row Level Security on every public table still missing it.
-- Security review June 2026. Table list verified against live pg_tables.
--
-- Threat closed: with RLS off, anyone holding the (semi-public) anon key could
-- read/write these tables directly through Supabase's PostgREST API, bypassing
-- the backend entirely (SMS OTP, Wikidata, admission rules, HMAC, nullifiers).
--
-- Safe for the backend: the API uses SUPABASE_SERVICE_ROLE_KEY, which has
-- BYPASSRLS. Enabling RLS denies anon/authenticated direct access; the backend
-- is unaffected. Re-runnable (drop policy if exists) — mirrors
-- 20260620_fix_protests_rls_service_role.sql.
-- ============================================================================

-- ── Grafo de identidad / verificación ──────────────────────────────────────
alter table groups enable row level security;
drop policy if exists groups_service_only on groups;
create policy groups_service_only on groups for all to service_role using (true) with check (true);

alter table group_members enable row level security;
drop policy if exists group_members_service_only on group_members;
create policy group_members_service_only on group_members for all to service_role using (true) with check (true);

alter table vouches enable row level security;
drop policy if exists vouches_service_only on vouches;
create policy vouches_service_only on vouches for all to service_role using (true) with check (true);

alter table vouch_requests enable row level security;
drop policy if exists vouch_requests_service_only on vouch_requests;
create policy vouch_requests_service_only on vouch_requests for all to service_role using (true) with check (true);

alter table invite_links enable row level security;
drop policy if exists invite_links_service_only on invite_links;
create policy invite_links_service_only on invite_links for all to service_role using (true) with check (true);

alter table institutional_members enable row level security;
drop policy if exists institutional_members_service_only on institutional_members;
create policy institutional_members_service_only on institutional_members for all to service_role using (true) with check (true);

alter table email_otp_requests enable row level security;
drop policy if exists email_otp_requests_service_only on email_otp_requests;
create policy email_otp_requests_service_only on email_otp_requests for all to service_role using (true) with check (true);

alter table email_otp_rate_limit enable row level security;
drop policy if exists email_otp_rate_limit_service_only on email_otp_rate_limit;
create policy email_otp_rate_limit_service_only on email_otp_rate_limit for all to service_role using (true) with check (true);

-- ── Financiero (especialmente sensible) ────────────────────────────────────
alter table platform_fund enable row level security;
drop policy if exists platform_fund_service_only on platform_fund;
create policy platform_fund_service_only on platform_fund for all to service_role using (true) with check (true);

alter table financial_movements enable row level security;
drop policy if exists financial_movements_service_only on financial_movements;
create policy financial_movements_service_only on financial_movements for all to service_role using (true) with check (true);

alter table kofi_protest_map enable row level security;
drop policy if exists kofi_protest_map_service_only on kofi_protest_map;
create policy kofi_protest_map_service_only on kofi_protest_map for all to service_role using (true) with check (true);

-- ── Integridad / fuentes / auditoría admin ─────────────────────────────────
alter table integrity_records enable row level security;
drop policy if exists integrity_records_service_only on integrity_records;
create policy integrity_records_service_only on integrity_records for all to service_role using (true) with check (true);

alter table source_validations enable row level security;
drop policy if exists source_validations_service_only on source_validations;
create policy source_validations_service_only on source_validations for all to service_role using (true) with check (true);

alter table admin_log enable row level security;
drop policy if exists admin_log_service_only on admin_log;
create policy admin_log_service_only on admin_log for all to service_role using (true) with check (true);

