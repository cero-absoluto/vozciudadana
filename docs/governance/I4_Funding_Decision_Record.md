# I4 funding decision — prepared canonical appendix

Date: 2026-10-03. Decision ID: not assigned; inspect latest canonical numbering before assignment.

POLICY: OWNER APPROVED, confirmed in this continuation. VP-DEC-034 historical 90/10 model is SUPERSEDED, not reinterpreted. Preserve its original record and append this replacement relationship when canonical writeback is separately undertaken. This local file does not claim that the canonical Decision Log was updated.

Event contributions: exclusively verification/SMS while active; cumulative EUR100 per verified telephone identity/event, included in EUR1000 per calendar year combined with general individual donations. Ring-fenced until closure and settlement; unused balance then goes to general sustainability. No present ownership by an unincorporated Stichting.

Telephone identity is not civil identity; multi-SIM residual accepted. No identity documents solely to remove that risk. Ordinary donor-data minimization: no names, address, civil identifiers or clear phone retained absent a concrete legal obligation. OTP and funding-specific HMAC, separate keys/domains from participation, no routine financial/participation joins; HMAC treated as pseudonymization where applicable.

General donations independent of event SMS. Grants independent of individual cap and with restricted-purpose accounting where applicable.

Funding may support Voice Protest as infrastructure but may not purchase influence over participation, evidence, visibility, governance, participant data, or the causes that use the infrastructure.

TECHNICAL AUTHORITY: Owner authorised A3 on 3 October 2026 only for isolated implementation and tests of the Proposed Implementation Package. No main publication, production DDL, live cron or provider changes, transfers, refunds, settlement or legacy balance reconciliation. Return A1 after the isolated reviewable deliverable is documented.

VP-ISS-008 reproduced on synthetic data; future settlement avoids the double-UPDATE pattern. VP-ISS-017 addressed in new isolated transaction functions, not in deployed legacy webhook. VP-ISS-019 remains CAUSE NOT ESTABLISHED / AWAITING SPECIFIC RECONCILIATION AUTHORISATION. VP-SEC-041 anonymous INSERT remediation remains unchanged. VP-SEC-032 remains AWAITING OWNER DECISION.

Pending technical/policy activation decisions: provider, annual attribution timezone/date, fees, refunds, legal retention and responsibility, historical annual usage, key rotation and cutover. No assumed approvals for these.

## Authorized isolated follow-up — 2026-10-03
Owner authorization: “aurorizo”, responding to the expressly delimited follow-up gate for documentation, event cost-window validation/correction, and additional concurrency tests. Authority is temporary A3 isolated only; no production activation or real financial operations.

CURRENT VERIFIED FACT: regressions reproduced acceptance of new cost reservations after end and before start while the synthetic event account remained open. This is a defect in the isolated candidate, not evidence of a production incident. Corrected by parent-before-account locking and active-window validation for new commitments. Previously committed costs may finish after end to allow reconciliation. No new governance identifier is assigned.

Native multisesion coverage expanded for cost oversubscription, an end transition under parent lock, and confirmation/settlement races. Execution remains pending infrastructure; prepared tests do not establish concurrent correctness. Report command corrected to the exact accepted database name `i4_isolated`. Return to A1 after this bounded delivery; I4 remains OPEN.

## Owner-authorized UUID canonicalization — 2026-10-03
The Owner explicitly answered “autorizo” to A3 limited to UUID normalization and isolated regressions. CURRENT VERIFIED FACT: before the change, the verified API accepted EUR60 under a lowercase UUID plus a EUR50 reservation under its uppercase equivalent because distinct HMACs partitioned one event's quota. This reproduced a defect in the isolated candidate, not an incident involving production or real money.

Normalize UUID case before funding HMAC generation and challenge/session storage. Tests must verify one cumulative event quota, canonical event IDs sent from both sessions to SQL, and exact preservation of the prior lowercase v1 HMAC vector. No token backfill, historical rewriting, production activation or extension of authority. Concurrency PostgreSQL 17 remains pending; return A1 after this reviewable delivery.

## Owner-authorized isolated CI publication — 2026-10-04
The Owner answered “autorizo” to the proposed CI gate: temporarily A3, publish only i4-validation-20261003 to the public repository and run ephemeral PostgreSQL 17 tests. This expressly supersedes the no-push restriction only for that named branch. No PR, merge, main update, deployment, provider change, real financial operation or legacy correction.

Preflight verified existing web publishing workflow still triggers push only for main; both Railway services still follow main, no staged changes. The CI workflow grants contents:read, disables persisted checkout credentials, uses synthetic database credentials, and requires native concurrency rather than allowing a skipped test to approve validation.

Harness-only adjustments: refresh statistics snapshots during lock polling and record actual server version. No financial rules changed. Record remote commit/run/results after execution; full I4 status remains OPEN until all separately identified blockers are resolved. Return A1 after documenting this bounded package.

## Owner-authorized isolated RLS compatibility — 2026-10-04
Owner response: “si. autorizo” to the bounded compatibility package and publication to the existing i4-validation-20261003 branch. Temporary A3 is limited to isolated code, fixtures and CI; no production DDL, main update, deployment or financial operations.

The isolated fixture now mirrors observed parent RLS policies and broad client table grants. Synthetic legacy trigger bodies count calls; they do not execute production financial logic. Reproduction establishes that the original financial role cannot lock the enrolled parent under these policies. Migration 20261004050924_funding_rls_compatibility.sql grants only UPDATE(ultima_donacion) as the lock privilege, revokes UPDATE(id), and adds an enrolled-event RLS policy plus a BEFORE UPDATE statement guard. Actual financial-role parent writes, including zero-row writes and ordinary inheriting actors, are rejected. No SECURITY DEFINER or BYPASSRLS is introduced. Schema owner/superuser remain trusted DDL authorities, not financial runtime actors.

Native concurrency uses a separate LOGIN inheriting funding_runtime, with assertions proving no superuser, BYPASSRLS or service_role membership. Administrative connections initialize synthetic fixtures and model the independent event end transition only. Five dedicated RLS regressions cover the before/after lifecycle, unchanged parent data and trigger counters, denied parent mutation, inheritance and denied private access for anon/authenticated. Native CI results are recorded in the review report after execution. This mirror is not a production deployment test. Return A1 after documentation; I4 remains OPEN.

## Owner-authorized isolated shared OTP/session package — 2026-10-04
Owner explicitly answered “Autorizo” to the concrete shared-auth package and existing-branch CI publication. Temporary A3 covers isolated storage, migration, simulator integration, tests and documentation only. No production, main, PR/merge, provider accounts/contracts, real SMS/payments, history/cutover, legal-retention/calendar decisions or rotation of real secrets.

HISTORICAL FACT: A1 reproduction accepted six starts across two instances because each had its own three-start Map. This was a synthetic candidate limitation, not evidence of abuse or a production incident. CURRENT VERIFIED FACT: the candidate now uses private PostgreSQL shared windows, fenced challenge claims and digest-only sessions. DB-clock expiry and atomic consumption prevent duplicate session creation. DB/adapter failure is fail-closed, with no Map fallback. Central parameters remain test-only, not approved launch policy.

Migration 20261004052915_funding_shared_auth.sql was created by pinned CLI 2.81.3. All functions are SECURITY INVOKER, private tables have RLS and no anon/authenticated grants. Runtime auth-table DML is explicitly trusted; it is not a guarantee against a compromised runtime. Runtime cannot change the central test policy. No legacy parent/financial records are updated. Controlled auth cleanup never resets financial quota or ledger.

Validation: sixteen new isolated auth regressions and six native cases are required along with the prior funding/integrity suites. Record executed CI evidence in the review report. Return A1 after bounded verification and documentation; I4 remains OPEN and VP-ISS-019 cause remains unestablished.

## Owner-approved annual chronology / isolated temporal v2 — 2026-10-04
The Owner answered “si. autorizo” to the presented policy1–6 and bounded implementation package. APPROVED: Europe/Amsterdam financial calendar year; attribution by effective successful payment evidenced by the provider; receipt/intent/payout are distinct; ordinary checkout cannot authorize payment in another year; delayed valid evidence preserves the payment year; out-of-window or uncertain payment remains review without automatic reassignment, refund or capacity release; new-year OTP required and event quota cumulative. This is not a tax/accounting legal ruling or provider selection. Canonical Decision Log writeback is not claimed; no new historical ID is invented.

Temporary A3 covers new isolated migration, API/simulator v2, regressions/documentation and existing validation branch/CI only. Migration 20261004055625_funding_temporal_v2.sql was generated by CLI2.81.3. New append-only temporal metadata preserves unknown v1 chronology. Both v1 confirmation entry points deny v2 intents without temporal evidence, retaining legacy behavior for old intents. New flow uses DB time, requires bound adapter evidence, checks payment window/year and final-account compatibility. Application runtime remains a trusted finance operator; no SECURITY DEFINER/BYPASSRLS introduced.

No production, main, PR/merge, provider account/contract, real SMS/payment/refund/transfer, historical correction or secret rotation is authorized. Central ten-minute duration is test-only; real provider compatibility remains to prove. Tests use owner-controlled synthetic clocks only in ephemeral DB, with restricted application connections. Record actual CI evidence in the review report. Return A1 after verification/documentation; I4 remains OPEN and VP-ISS-019 CAUSE NOT ESTABLISHED.


## Owner-approved operational costs / cash exceptions — 2026-10-04
Owner explicitly answered “aprobado” to policy1–8 and the concrete fee/refund/dispute isolated package in review-report version12. The approved caps are gross; general covers operational fees; known bounded fee coverage precedes checkout; paid refunds/disputes do not restore quota; a voluntary refund needs a concrete Owner decision; committed/final event principal cannot be made negative or silently reopened; forced debit remains a visible unallocated cash fact when coverage/policy is insufficient; cash debits, pending/failed/resolved statuses and genuine recoveries are distinct. No real tariff, budget, legal refund entitlement or PSP contract is inferred. No invented Decision Log identifier or canonical writeback is claimed.

Temporary A3 is limited to new migration, isolated simulator/API/private cash journal, fee/refund reservations, concrete synthetic Owner-decision checks, regression/native tests and documentation plus publication on existing i4-validation-20261003 only. Migration 20261004061929_funding_costs_exceptions.sql was generated by CLI2.81.3; v1/v2 migration files, earlier payment records, quota attribution and final historical records remain preserved. New fields are future candidate design, not corrections of current financial data.

CURRENT VERIFIED FACT: the candidate includes append-only provider facts/allocations/Owner decisions, balanced adjustments, known-bound fee holds, minimum-source/remaining-gross checks and conservative exposure pause. Closed final snapshots remain final. SECURITY INVOKER/RLS/private runtime and existing auth/temporal protections remain. Runtime is a trusted finance operator; no claim of immunity to its compromise. Owner decisions are seeded only by the ephemeral fixture owner, not application input. Real Owner identity/auth and provider evidence mapping still require separate activation design.

Native tests require the actual non-superuser, non-BYPASSRLS, non-service-role login on ephemeral PostgreSQL17. Local PGlite is not claimed as native concurrency evidence. Execute the complete suites and record final CI run/commit/tree/counts in the review report. No main, PR/merge/deploy, production, SMS, provider account/contract/write, real transfer/refund/settlement, historical annual usage repair, secret rotation or VP-ISS-019 adjustment is included. VP-ISS-019 CAUSE NOT ESTABLISHED; VP-SEC-032 OWNER DECISION PENDING. Return A1 after bounded testing/documentation; I4 overall OPEN.
