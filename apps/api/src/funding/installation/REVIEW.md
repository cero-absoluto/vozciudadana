# I4 — inert foundation migration proposal

Prepared 2026-10-06; not applied, published or registered as a Supabase migration.

## Observed production
Read-only catalogue inspection: PostgreSQL 17.6; no funding schemas or roles. public.protests.id is UUID; starts_at/ends_at are timestamptz. Financial tables remain legacy. Six active cron jobs include closure job 20 every 30 minutes. No participant, donor or financial rows were retrieved. This does not certify every external writer.

## Exact scope
`inert-foundation.sql` creates three private schemas and three tables: installation manifest (activation structurally false), empty durable route bindings, empty encrypted lookup references. No runtime grants, policies, roles, memberships, secrets, endpoints, functions, scopes, budget or provider activation. It adds only a restrictive parent FK. It does not modify public tables, triggers, cron, RPC definitions, balances or final hashes. No provider/SMS/network calls. Ko-fi/personal PayPal stays as approved.

This is the first installation stage, not the complete funding runtime migration. Earlier isolated migration files are NOT a production deployment sequence. In particular, do not install fixture provider bindings, SMS fixture schemas, the participation scope rehearsal or the durable-route fixture SQL. These production tables intentionally collide with the fixture names to prevent accidentally applying that rehearsal later.

## Preconditions and stops
Own installation Owner Gate; backup/restore evidence; native PG17 validation of this exact package; refreshed catalogue and approval of the exact SHA256. Namespace collision or wrong parent/version stops the transaction; lock timeout is 3 seconds and statement timeout 30 seconds. No automatic retry or IF NOT EXISTS drift suppression. Review inherited/default permissions before and after installation. Administrator remains the privileged trust boundary; RLS does not restrain superusers/BYPASSRLS.

## Invariants and tests
All application roles, including service_role, have neither schema nor table grants. RLS enabled and forced, no policies. No raw identifiers or keys are stored. References have at most 30-day logical validity; physical deletion scheduling and early purpose-end deletion remain separate requirements. Binding operation_id has no exposure FK yet: runtime use must not be granted until its production exposure authority is built and constrained.

Two isolated PGlite tests pass: preserve synthetic parent/final hash, deny application roles, reject repeat/collision, rollback empty installation; reject rollback when technical evidence exists. Native PostgreSQL validation of this new package is pending; earlier CI success is not validation of this migration.

## API and rollout
No API change in this stage. Existing candidates stay isolated and disabled. Future separate stage must install production exposure/cost/ledger authority, relation constraints, immutable transitions, custody, actor separation, purpose-end cleanup and scope fencing; qualify provider and fee/FX evidence; reconcile eligible funding without historical backfill; test integration before activation Owner Gate. No new donation channel before Stichting under current Owner decision.

## Rollback
`rollback-empty-foundation.sql` checks the known manifest and absence of records, then drops exact objects with RESTRICT, never CASCADE. Extra dependencies stop. Transaction abort is rollback before commit. Once any data or subsequent runtime exists, stop and design authorised forward correction; no ledger deletion, quota reset, 90/10 restoration or destructive financial reversal.

## Registration
SQL retained as review candidate outside supabase/migrations. The previous automatic review rejected the Supabase CLI invocation involving telemetry; it has not been retried or bypassed. No migration timestamp invented. Register through the approved migration mechanism only after that tooling restriction and installation gate are resolved.
