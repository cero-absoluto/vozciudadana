# I4 transition rehearsal — isolated only

Owner authorized the concrete Transition Rehearsal Package on 2026-10-04 at 18:55 Europe/Berlin. Temporary A3 covers fixture/harness/test/documentation and existing isolated branch CI only. No candidate financial code, migration, public API, production, account or provider change.

The new test-only schema stores cohort state/epoch, inventory, annual-usage evidence, immutable operation outcomes, append-only journal and invented immutable finals. A cooperative transaction barrier locks the manifest before calling existing funding SQL. Allowed writer roles are checked through actual DB membership. Replay binds the operation digest; unknown usage/inventory blocks enrolment. PAUSED blocks new entries but preserves completion of pre-existing reservations. Legacy callbacks become private fixture review facts, without new-ledger credit.

This is not a production fence: callers with privileges outside this harness can bypass the cooperative barrier. Inventory completeness/usage are seeded synthetic facts, not current production findings. Restricted test actors are trusted harness operators, not a new production authorization scheme. The observer never activates production or qualifies PayPal.

Functional tests cover historical finals, incomplete/pending/unknown evidence, displaced writer/epoch, confirmed-response replay, contradiction, pause/completion, financial failure rollback, Amsterdam-year and event cutoff, cumulative prior usage, privacy, immutability and grant/general isolation from event SMS. Native tests add independently observed lock races in both orderings, restricted legacy/candidate logins, late legacy callbacks, twenty confirmation replays, reconnect persistence, fault/retry, competing writers and pause versus new-entry/completion.

Manifest state flow: PREPARED → FROZEN → ENROLLED → REHEARSAL_ACTIVE → PAUSED. Every test verdict has productionActivation=false. All data and credentials are invented; no network/payment/SMS call. No production trigger bodies or financial records are imported.

Run with the existing test:funding workflow and I4_REQUIRE_MULTISESSION=1 against loopback PostgreSQL 17 database i4_isolated. Qualification, lifecycle and integrity suites remain mandatory. No required skip is acceptable. Without native URL, the local explicit skip is a prerequisite gap, never a native PASS.

Preparation failures retained: adding the restricted-grant fixture initially inserted a positive balance without ledger; the existing ledger_projection_mismatch guard rejected it (targeted run 11 PASS / 1 FAIL). Corrected only the fixture to use record_simulated_grant and balanced existing SQL. No candidate guard or migration changed. Corrected targeted run: 12 PASS / 0 FAIL.

Rollback: revert this test/documentation package and reconstruct the ephemeral DB, preserving evidence. An operational rollback would require its own gate: stop new entries, preserve uncertain reservations, ingest/review and append-only facts. Never restore legacy 90/10, erase ledger, correct historical funds or recompute final hashes.

Acceptance evidence and exact CI/source identifiers are recorded in Voice_Protest_I4_Isolated_Review.md after execution. Existing 228 PASS are previous evidence, not the result of this package. PayPal Business/Sandbox is deferred until Stichting formation; I4 remains OPEN. VP-ISS-019 cause and historical v1 provenance remain unestablished; VP-SEC-032 remains pending. No A4/J standing delegation is granted.

First native CI run 37220804301 / job 111490569898: funding 178 PASS / 3 FAIL / 0 SKIP; subsequent suites skipped after failure. The new fixture supplied raw annual tokens after continuity enrollment, correctly rejected with key_provenance_required. Corrected only transitionIntent fixture setup to resolve canonical annual scope across the enrolled key versions. Existing guards/migrations remain intact. This failed run is preserved, not counted as acceptance.

Second native run 37220958675 / job 111491025160: funding 178 PASS / 3 FAIL / 0 SKIP; subsequent suites skipped. After provenance correction, JS Date round-trip truncated the invented success timestamp below PostgreSQL intent creation precision; existing temporal validation correctly returned review. Fixture correction keeps created_at inside SQL as the synthetic successful instant, avoiding client timestamp conversion. No effective PayPal timestamp mapping is introduced and no temporal guard is relaxed.
