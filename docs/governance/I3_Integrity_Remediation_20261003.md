# Voice Protest — Phase I3 integrity remediation

**Date:** 3 October 2026
**Outcome:** Legacy trigger retired; historical evidence preserved; VP-ISS-012 remains open.

---

## Phase I3 verification addendum — 3 October 2026

**Authority:** Project Owner's explicit A3 — SCOPED MODIFICATION for I3, carried forward in the continuation instruction supplied on 3 October 2026.
**Scope:** VP-SEC-027 and VP-ISS-012 only. This addendum preserves all earlier historical content and identifiers.

**CURRENT VERIFIED FACT:** Production inspection found `trigger_hash_integridad` present but disabled (`tgenabled = 'D'`) before this operation. The date, actor and authority of that earlier disablement were not established. This operation does not claim to have performed it.

Migration `20261003185040_retire_legacy_integrity_trigger` removed only that trigger from `public.protests`. It preserved `calcular_hash_integridad()`, `calculate_integrity_hash_v2(uuid)`, the other protests triggers and the closure cron. Exact SQL is committed on GitHub main in commit `44a5d85c58735b41eb77f71e2cc02cd9b36065bf`.

Verification found zero remaining named legacy triggers. Before/after whole-table fingerprints matched for `protests`, `integrity_records` and `adhesions`. Function definitions, other trigger definitions and the closure command also matched. No historical evidence was recomputed and no event, snapshot or participant row was modified by I3.

The preserved hybrid is `c1c10dba-b6c0-4827-af52-ec52b726a106`:

- protests version: 1; hash: `cc2d22963c8bdadd4bf90755d7d9748647905c617f8646c6df5cc925cab38b40`;
- integrity_records version: 2; hash: `db1fece446a60d13fc40a3d848925d729b4fed62236e26cb800d8b2fa8ccee6e`;
- current count, snapshot total and commitments length: all zero;
- snapshot closed_at/calculated_at: `2026-08-09 06:08:52.30858+00`;
- stored canonical input reproduces the snapshot SHA-256; the public integrity-data endpoint serves that v2 snapshot and its returned payload independently reproduces the same hash.

**HISTORICAL FACT:** Commit `badc775` added the 9 August timestamp-format fix, including a loop calling v2 for every already-hashed protest without synchronising the protests-side version/hash.
**INFERENCE:** That loop is consistent with the hybrid's v2 snapshot timestamp and explains a plausible creation path. The actual historical execution/caller was not independently established.
**UNKNOWN:** Exact inputs, algorithm version and execution path that produced the stored v1 hash. Neither the current delimited legacy SHA-256 formula nor recovered undelimited formula reproduced it from current fields in the UTC/Europe-Amsterdam variants checked. This does not establish tampering or an incident.

**Incident status:** No incident established by this I3 inspection. A vulnerable mechanism, a mixed-version state and uncertain provenance are not incident evidence.

**VP-SEC-027 — REMEDIATED / VERIFIED:** The identified future interference path through the legacy trigger is removed. This status does not close independent retention, lifecycle, finance or snapshot-upsert findings.

**VP-ISS-012 — OPEN / UNRESOLVED:** The existing cross-table v1/v2 discrepancy is preserved and documented, not migrated or accepted as risk. The canonical issue also describes partial `ON CONFLICT DO UPDATE` inside v2; direct inspection confirms that code remains. Dropping the legacy trigger does not fix that separate partial-update defect. The three inspected snapshots currently have valid hashes and matching adhesion/commitment totals; this does not prove future recalculation safe.

**Railway:** The API watches `/apps/api/**`. Its deployment for migration commit `44a5d85` was `SKIPPED`, as expected. No manual redeploy, restart, provider change or privilege escalation was performed.

**Scope exclusions:** VP-SEC-032 remains AWAITING OWNER DECISION; all other listed non-I3 matters retain their existing status. No Phase I4 action is authorised by this record.

**Authority at I3 close:** Return automatically to A1 — READ-ONLY. No continuing A3, production-write or financial authority.

## Verification evidence

| Item | Before | After |
| --- | --- | --- |
| protests whole-table fingerprint (MD5, equality check only) | 9f668f1864f9796f12e9ace27473edb9 | 9f668f1864f9796f12e9ace27473edb9 |
| integrity_records whole-table fingerprint | f4ee072a272619b9eebfd6acfe84d5ed | f4ee072a272619b9eebfd6acfe84d5ed |
| adhesions whole-table fingerprint | 8d496eba2c41937f52cb7d60c3f541e4 | 8d496eba2c41937f52cb7d60c3f541e4 |
| legacy function definition fingerprint | 3c8ad3d8b6edc58c561faeffe61c699e | 3c8ad3d8b6edc58c561faeffe61c699e |
| v2 function definition fingerprint | a69e8ac9672a3346f44af089dd2b2cd0 | a69e8ac9672a3346f44af089dd2b2cd0 |
| closure command fingerprint | d3e1cea5c807c72c348bcab7b53cc1e6 | d3e1cea5c807c72c348bcab7b53cc1e6 |
| legacy trigger | present, disabled | absent |

These fingerprints establish equality of the inspected database representations, not a public cryptographic proof or a replacement for SHA-256 integrity evidence.

The two other protests inspected, `3de5405e-a8d6-43b1-8dca-32ebb74060f8` and `9774b676-a6a2-41ea-93d2-cf525fa9b21b`, retain matching protests/snapshot v2 hashes and totals of 2 and 6 respectively. All three stored canonical inputs reproduce their snapshot hashes.

No synthetic production event was created and no live closure/anonymisation job was invoked for testing. Verification covers the targeted schema change, data preservation and current public snapshot, not all future closure paths.

---

## Phase I3 follow-up — VP-ISS-012 snapshot persistence — 3 October 2026

**Authority:** Explicit Project Owner authorisation in this continuation after the proposal to prevent partial updates while preserving existing snapshots. Temporary A3 is limited to this VP-ISS-012 correction and its verification/documentation.

**CURRENT VERIFIED FACT:** Migration `20261003190433_preserve_integrity_snapshots_on_repeat` is applied to production and committed on GitHub main at `a8a7110090b24beca14bb9632dc61ad37daa07b5`.

`calculate_integrity_hash_v2(uuid)` now locks the parent protests row, matching the locking order used by the inspected adhesion RPC. If a valid v2 snapshot already exists, it returns the recorded hash before modifying participant data. Existing non-v2, invalid-hash or inconsistent-count snapshots cause a review-required exception without automatic repair. New snapshots retain the prior v2 canonical format and are inserted once; the partial `ON CONFLICT DO UPDATE` branch is removed. No historical recalculation or reconciliation is performed by this migration.

**Verification:** An isolated in-memory Postgres test using PGlite 0.5.8 and its pgcrypto extension reproduced the old defect (2 stored adhesions / 3 commitments after recalculation), then passed nine correction checks: valid first snapshot; unchanged repeat; repeat after changed live adhesions; repeat after participant data removal; preserved hybrid metadata; empty-event snapshot; missing-event rejection; inconsistent-total rejection; invalid-hash rejection; and legacy-version review requirement. The first-snapshot/unchanged-repeat check is combined in the test output. This test does not stress-test multiple database sessions.

Production calls to the corrected function for each of the three existing snapshots returned the recorded hash twice. Whole-table fingerprints for `protests`, `integrity_records` and `adhesions` remained unchanged after those calls. The existing function owner, EXECUTE ACL, security-invoker setting and configuration remained unchanged. The closure cron was not modified and the retired legacy trigger remains absent.

**VP-ISS-012 — PARTIALLY REMEDIATED / VERIFIED FOR THE PARTIAL-UPDATE DEFECT:** The unsafe partial snapshot-overwrite path is corrected. The separately documented historical protests-side v1 / snapshot-side v2 discrepancy for `c1c10dba-b6c0-4827-af52-ec52b726a106` remains preserved and **AWAITING OWNER DECISION ON HISTORICAL RECONCILIATION**. This is not a risk acceptance, an incident finding, or approval to replace the historical hash. The earlier OPEN entry records the pre-follow-up state and is retained chronologically.

**VP-SEC-027:** REMEDIATED / VERIFIED for the removed legacy trigger; unchanged by this follow-up.

**Other scope:** No I4, financial-model implementation, permission escalation, cron change, manual Railway deployment or historical data migration is included. All non-I3 findings retain their prior status.

**Authority after follow-up:** A1 — READ-ONLY. Temporary A3 ends after verification and documentation.

### Reproduce the isolated regression test

Install `@electric-sql/pglite@0.5.8` in a temporary test directory, copy `tests/integrity-snapshot-repeat.mjs` there so it can resolve that package, and run it with the absolute paths to these two repository files as arguments:

1. `supabase/migrations/20261003190433_preserve_integrity_snapshots_on_repeat.sql`
2. `supabase/migrations/20260809_fix_hash_timestamp_format.sql`

The test loads the function body from the new migration and the historical implementation from the timestamp-format migration. It uses synthetic data only; it does not connect to Supabase or Railway. Migration application and preservation of production owner/ACL were checked separately through the authorised Supabase connection.
