# IDV-01 / IDV-02: PostgreSQL rehearsal

Run from repository root:

```sh
npm ci --ignore-scripts --prefix automation/security-database/native
node automation/identity-admission/launch.mjs
```

Uses the existing lockfile's pinned PostgreSQL 17.6 native binary and pg client.
The launcher creates and removes a temporary cluster, listening only on loopback
port 55451, and refuses to continue if that port cannot be bound. No credentials,
provider accounts, production connection strings or user data are required.

The fixture reconstructs the relevant columns from audited metadata; groups and
creator-proof tables are minimal synthetic scaffolds. It is not a reproduction
of the full production schema, RLS, OTP transactions or the whole application.
It runs the real audited admission function, the proposed replacement, trigger
and rollback against real PostgreSQL locks. Synthetic role grants are test-only.

Checks include non-census institutional admission, high/critical and institutional
GPS, legacy raw-coordinate fields, maintenance/anonymisation, existing member and
founder-proof paths, parallel SHARE locks, ACL/owner preservation, rollback/reapply.

Only `docs/proposals/idv-01-02-admission.sql` and its rollback are proposed database
changes. Nothing in this runner applies them to Supabase. Before any publication,
verify the live catalog and exact baseline (the SQL aborts on function/trigger
drift), obtain publication authorization, and run the relevant effective permission
and health checks. Do not run the synthetic scaffolding against production.
