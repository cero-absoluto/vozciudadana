# I4 isolated funding implementation

This module is deliberately not imported by src/server.js. No production environment variable enables it. Use dependency injection in isolated tests or a separately composed local server. Never give it a production database connection.

Policy approved by Owner: event contributions exclusively verification/SMS, cumulative EUR100 per verified telephone identity/event; event and general contributions share EUR1000 per calendar year. Grants are independent; restricted grants retain purpose. Historical 90/10 superseded. No donor benefits.

The simulator never sends SMS, contacts a payment provider, creates a checkout URL or handles real money. Grant metadata/accounts and cost/settlement SQL are isolated fixtures only, with no API for accepting a grant or performing settlement. Financial identities use funding-only secrets and server-selected purpose/year; no participation records are used.

Timezone is mandatory configuration; Europe/Amsterdam was explicitly approved in the temporal-v2 gate (see below). Key rotation is not exposed: v1 only. No refunds, FX, fees, raw webhook persistence or automatic expiry/cup restoration. Expired payments and unknown intents are durably quarantined without automatic allocation. Provider tickets/fees, production OTP integration/policy, review tooling, legal retention and historical annual usage remain launch blockers.

Reservation failure rolls back; provider checkout failure retains the reservation. All payments are simulator-labelled. Cost keys must be random funding-only references and must not encode participant, phone or adhesion identifiers.

SQL uses SECURITY INVOKER and a private NOLOGIN role. The role is created only in isolation; its parent row-lock privileges must be reviewed before any production migration. Nothing updates legacy balances or public integrity records. Production cutover, cron replacement and historical reconciliation are absent pending a separate Owner Gate.

## Authorized isolated follow-up (2026-10-03)
New cost commitments lock the event parent before the account and require a non-null active event window, in addition to an open account. Repeating an existing cost key while the account remains open creates no new commitment; an already reserved cost can finish after event end so settlement can reconcile it. This does not authorize new post-close costs or change historical data.

The native concurrency harness requires a fresh PostgreSQL 17 database named exactly `i4_isolated`, on loopback. It adds simultaneous cost reservations, a controlled parent-lock/end transition for contribution/cost/closure, and confirmation racing settlement. These tests are prepared but not verified until native PostgreSQL 17 runs them. The harness bounds statement/lock waits and rolls back its controlling transaction on failure.

## UUID case canonicalization follow-up (2026-10-03)
Event UUIDs are canonicalized to lowercase before HMAC generation and before challenge/session storage. Case variants must share one event quota; existing lowercase v1 HMAC output remains unchanged. An API regression verifies EUR60 plus EUR40 across case variants, rejects EUR60 plus EUR50 and any further cent, and checks canonical session values before PostgreSQL receives them. A fixed synthetic v1 vector verifies compatibility. No historical token rewrite, production change or data migration is included.

## Shared isolated financial authentication (2026-10-04)
The isolated service now requires the funding_shared_auth migration. It stores challenge/session/rate state in funding_auth_private rather than process Maps; unavailable storage fails closed. The original parent lock guard/RLS compatibility migration is still required.

The central test_policy row explicitly contains test-only parameters: three starts/10 minutes, five attempts, five-minute challenge TTL, ten-minute session TTL and 30-second verification/send bound. These values are not approved production policy. Application replicas cannot update test_policy. No production integration or provider account is introduced.

Starting a challenge consumes shared capacity before simulator work. Verifying claims a challenge and attempt atomically, then calls the simulator outside any DB transaction. A current operation UUID and DB-clock lease fence completion. Consuming the challenge and storing one session are atomic. Stale, uncertain or timed-out operations cannot issue another session; lost responses require a new verification. A recomposed instance can use a valid shared session.

Phone and OTP are not stored; session bearers are returned once and stored as funding-domain HMAC digests. Funding quota tokens/rate tokens remain pseudonymous, separate from participation. The simulated provider still keeps its own test-only challenge IDs/checkouts; no promise is made about future provider retention or reliable erasure of runtime memory. The loopback server and test route compositions disable request logging.

Auth tables have RLS and no client-role access. SECURITY INVOKER functions require explicit runtime table DML grants: the financial runtime is a trusted auth-state operator, not an adversarial SQL principal. It cannot change test_policy, parent event fields or DDL under the tested grants. These controls do not certify resistance to many-number abuse or a compromised runtime.

cleanup_expired is an explicit harness operation; it preserves challenges referenced by live sessions and does not delete financial quotas or ledger. No production cron, legal-retention rule or real key rotation is activated. The complete 16 auth regressions plus six new native PostgreSQL cases cover distributed quota, claims, retries, clock/lease expiry, injected commit faults, response loss, access and privacy. Run npm run test:funding; CI requires native PostgreSQL and rejects skipped concurrency.

## Owner-approved calendar policy / isolated temporal v2 (2026-10-04)
Europe/Amsterdam is now explicitly approved for the financial calendar year. A contribution belongs to the year of its effective successful payment, supported by authenticated provider evidence; webhook receipt, intent creation and bank payout are separate facts. Provider/timestamp mapping is still an activation gate.

Migration funding_temporal_v2 adds temporal_policy, immutable temporal_intents and immutable temporal_receipts. It does not backfill dates into v1. reserve_v2 uses the DB clock, clips validity to year/event end and rejects insufficient windows before checkout. The central ten-minute duration is simulator-only; a thirty-minute minimum cannot be served by this duration and fails closed. No provider is selected or presumed compatible.

confirm_v2 can credit a pre-deadline payment delivered later while its reservation is retained. It records paid/received instants separately and deduplicates by payment and delivery identifiers. Missing/unreliable/out-of-window evidence goes to review, with no automatic year reassignment, quota release, refund or reopening of a final settlement. v1 remains usable for legacy, with both public private-schema wrapper and legacy helper explicitly rejecting v2 intents that require temporal evidence.

The authenticated simulator supplies bound intent/amount/currency evidence and a payment timestamp from its adapter clock; caller-paidAt is ignored. Immediate mock callbacks record immediate simulated payment, while delayed tests explicitly record payment before delivery. This is not a real provider authentication/retention implementation. The isolated service now derives the policy year from DB configuration and requires a new OTP when that year changes; event HMAC/quota remains cumulative.

Temporal tests use an owner-controlled clock override only in ephemeral fixtures; runtime cannot alter the real clock function or central policy. New native tests cover delayed duplicate deliveries, cancellation/confirmation, a parent-lock barrier at midnight and confirmation/settlement. No production clock override, migration, provider operation or legacy financial rewrite occurs.
