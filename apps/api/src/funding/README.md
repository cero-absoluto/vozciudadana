# I4 isolated funding implementation

This module is deliberately not imported by src/server.js. No production environment variable enables it. Use dependency injection in isolated tests or a separately composed local server. Never give it a production database connection.

Policy approved by Owner: event contributions exclusively verification/SMS, cumulative EUR100 per verified telephone identity/event; event and general contributions share EUR1000 per calendar year. Grants are independent; restricted grants retain purpose. Historical 90/10 superseded. No donor benefits.

The simulator never sends SMS, contacts a payment provider, creates a checkout URL or handles real money. Grant metadata/accounts and cost/settlement SQL are isolated fixtures only, with no API for accepting a grant or performing settlement. Financial identities use funding-only secrets and server-selected purpose/year; no participation records are used.

Timezone is mandatory configuration; Europe/Amsterdam was explicitly approved in the temporal-v2 gate (see below). Key rotation is not exposed: v1 only. No real refund/fee operations, FX conversion, raw webhook persistence or automatic expiry/quota restoration. The historical v1 fee/net columns are allocation compatibility fields, not evidence of actual PSP net cash. Expired payments and unknown intents are durably quarantined without automatic allocation. Provider tickets/fees, production OTP integration/policy, review tooling, legal retention and historical annual usage remain launch blockers.

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


## Owner-approved gross/fees/refunds/disputes package (2026-10-04)
The Owner explicitly approved policy1–8 and the bounded isolated package in review-report version12. Migration 20261004061929_funding_costs_exceptions.sql was generated with pinned Supabase CLI2.81.3. Earlier migrations and payment records are preserved. This adds synthetic funds allocation, never real PSP writes or production DDL.

Individual annual/event caps record effectively charged gross. Paid refunds, disputes and recoveries never restore these caps. Only a definitive pre-charge cancellation releases reserved capacity and its fee hold once. General sustainability covers operational fees; event gross remains intact and restricted grants are not fallback coverage. New checkout requires a known simulator fee bound plus available general budget. The default zero mock fee is a fixture, not an approved tariff. New fees/refund holds/costs share a transaction-scoped operational-budget lock, followed by parent/quota and sorted account locks as applicable; no DB transaction is held over adapter work.

Private immutable provider_movements retains minimal cash facts even when unknown, foreign-currency, excessive or insufficiently covered. movement_allocations identifies what was actually assigned to funds. Unexpected negative cash remains unallocated exposure: new candidate checkouts and SMS commitments pause conservatively across the whole isolated runtime. A pre-existing final settlement stays immutable; a not-yet-final event cannot settle while its negative cash remains unallocated. No negative event/general balance is invented to hide the exposure. Settlement, held refunds and costs compete for principal without double use.

financial_review_decisions/revocations are append-only, runtime-readable and not runtime-writable. Tests seed approvals only as the ephemeral DB owner; there is no application Owner-auth integration. Refund authorization is bound to payment, amount, source and operation, checks expiry/revocation before reservation and cannot exceed remaining gross. The source may be uncommitted event principal or specifically approved general coverage. A timely held refund remains attributable when its cash callback arrives later; revocation sends the fact to review. A held refund is not itself a PSP action. Expired/revoked approval cannot create a new reservation. Restricted grants, unrelated events and final accounts are ineligible sources.

Processing fees, principal refunds/dispute debits and genuine cash recoveries add balanced ledger transactions. Status-only pending/failed/opened/resolved facts have zero cash; they do not debit/credit principal. Failed refunds release operational holds, not donor quota. A distinct extra debit stays visible for review; automatic principal allocation and ordinary coverage never exceed gross across refund/dispute principal, net of evidenced recoveries. Exceptional excess has no automatic allocation path. Positive recovery must reference a matching allocated negative movement, cannot exceed it cumulatively, and goes to general if its original event is final. An unallocated debit plus recovery remains review until a separately approved exception/reconciliation procedure exists; the net is not silently cleared.

Only isolated /simulator/movements and authenticated /simulator/movement-status register/read facts. Adapter-owned evidence binds identifiers, kind, signed amount, currency and operation/related references; a caller timestamp or ownerApproved boolean does not authorize anything. There is no command to initiate a real refund, respond to a dispute or contact a provider. Public balances explicitly describe fund allocations, not certified cash reconciliation; operational status separately reports unallocated debit/credit/net by currency. Foreign currency is retained, never converted. No raw payload or payment/participation/donor identifiers are stored.

Runtime table DML remains a trusted journal-operator boundary, as in prior packages; this does not certify a compromised runtime. SECURITY INVOKER, RLS, fixed search paths and denied client roles remain. The allocation helper rechecks eligible source, evidence, caps, related debit and Owner decision so its direct invocation cannot bypass the normal function checks. Operator/provider adoption, fee bounds, real budgets, Owner authentication, retention and exceptional reconciliation remain activation gates.

Rollback is a reviewed git revert of this isolated package and reconstruction of the ephemeral DB, preserving historical commits and evidence. No destructive down migration or real-money data repair is provided. All funding/auth/temporal/RLS/rollback/integrity regressions and added native PostgreSQL17 races remain mandatory in CI. Return A1 after execution evidence is documented; I4 overall remains OPEN.


## Owner-authorized isolated review authority (2026-10-04)
The Owner explicitly answered “si, autorizo” to review-report version14's concrete package. Migration 20261004065228_funding_owner_review.sql was generated by CLI2.81.3. It creates funding_review NOLOGIN without superuser/BYPASSRLS/DDL/service_role or funding_runtime membership. Finance runtime is not a member of the review role. A separately composed isolatedReview.js uses a dedicated reviewer connection and a test-only Owner authenticator whose secret differs from finance, participation and PSP secrets. Each operation rejects privileged/mixed-role connections; no production environment switch enables the module. This is not production Owner authentication.

The reviewer can SELECT minimal case/funds/decision tables, read only the id/kind/event/amount/state columns of intents, and INSERT decisions/revocations/provenance. It cannot read donor annual/event tokens, quota/auth tables or ledger, execute financial apply functions, update balances/state, or write PSP journal. review_authorizations is immutable and links unique request UUID, decision/kind, movement if applicable, evidence UUID, simulated_owner, effective DB actor and timestamp. A deferred trigger requires provenance for writes by the restricted review authority; old fixture decisions are preserved and labelled legacy_fixture_unknown when no provenance exists. The reviewer is a trusted authority issuer, not a guarantee against its compromise: invoker functions require INSERT grants, so raw SQL by that authority remains in its trust boundary. Runtime cannot impersonate it.

GET /review/cases paginates unallocated cash facts with bounded keyset cursor/limit; GET /review/cases/:ref also permits inspection after assignment and links decisions/reservations. Responses distinguish gross, cash, available/held balances, final status and review flags; cash reconciliation is never certified by this module. These are observations for review, not proof of a cause or a legal ruling. No free-text note/raw evidence payload is accepted: opaque evidence UUID references an external synthetic evidence item; an ID does not prove real PSP evidence. Logs remain disabled in test compositions.

POST /review/decisions accepts only refund_authorize/cover_exposure with bound request/payment/amount/source/expiry/evidence/movement. It checks confirmed temporal-v2 payment, eligible source, known EUR debit/effective date, remaining gross, absent allocation and available funds as appropriate. It records authority and provenance in one statement transaction, without reserving or moving funds. Responses say fundsMoved=false and requiresFinancialRecheck=true. The financial role must separately recheck and use existing reservation/allocation functions. Changes between approval and use can make a previously valid decision unusable. Replays return the same decision, do not renew expiry or add capacity; changed evidence/payload conflicts. POST /review/decisions/:id/revocations appends an idempotent revocation and never alters the original decision or transfers money.

Foreign currency, missing/unreliable evidence, excess principal, unallocated debit/recovery and insufficient coverage remain pending under the existing policy. Neither approving nor inspecting a case removes exposure; no generic resolve/delete/force button is provided. A final event stays final. Budget/tariff, actual Owner identity/auth, retention/rotation, provider contracts and cutover remain separate gates. No external messages, real financial command, provider SDK, production DDL, history repair, main/PR/merge/deploy or canonical writeback occurs.

Acceptance includes twelve local regressions, the existing financial/integrity suites and three new native PostgreSQL17 cases: separate inherited reviewer privilege boundary, twenty duplicate approvals and twenty duplicate revocations/independent cash apply. The native test reports the actual nonprivileged review login, while Owner service tests reject privileged DB composition. Rollback is a git revert and reconstruction of the ephemeral DB only, preserving history/evidence. Record actual CI result in the report, then return A1; I4 overall remains OPEN.


## Owner-authorized offline provider contracts — 2026-10-04
The Owner answered “autorizo” to the concrete package in review report version16. Temporary A3 covers closed in-memory provider-shaped fixtures, private OTP/checkout/ingress bindings, migration/API/tests/docs and the existing validation branch/CI only. This is not provider selection, a provider account, a contract or activation. No SDK, network transport, real SMS/payment, main/PR/merge/deploy or production DDL is included.

Migration 20261004072447_funding_offline_provider_bindings.sql was generated with pinned Supabase CLI2.81.3. All earlier migrations remain unchanged. SECURITY INVOKER functions and runtime-only RLS protect minimal references; clients and the independent review role cannot use ingress. The trusted financial runtime remains the evidence boundary. Binding provenance is immutable; OTP-reference cleanup follows the existing challenge lifecycle. No new financial retention period, key rotation or historical rewrite is inferred.

The offline adapter verifies HMAC over exact raw request bytes before JSON or DB work, bounds payload/header size, rejects ambiguous/stale fixture delivery signatures and refuses live events. It accepts only branded closed transport and explicit offline fixture payloads. The unsigned simulator ingress is disabled for this adapter. The 300-second signature tolerance is a test fixture setting, not a production policy. Provider customer/phone/email fields and raw payload are discarded; only normalized payment facts/references are journalled. References and HMACs remain potentially pseudonymous; this does not certify provider retention or erasure of process memory.

OTP confirmation uses a pre-bound verification reference under the active shared DB claim/lease, without retrieving a stored phone. Checkout validates both provider creation time and integer-second expiry against the actual remaining window. The default 1800-second minimum cannot fit the unchanged 600-second temporal test policy and fails before provider checkout or quota mutation. Successful-path tests deliberately use a synthetic 60-second minimum, not a claim that Stripe accepts this duration. A lost checkout response retains reserved capacity; an unbound callback cannot invent checkout provenance.

Successful payment time comes only from private synthetic provider evidence, never event.created, caller-paidAt or receipt time. Amount/currency/intent/checkout mismatches, unsupported asynchronous statuses, unknown payment, absent proof and incompatible final state retain review without inferred credit or quota restoration. Event delivery is atomic with confirmation and immutable minimal ingress; normalized conflicting replay fails. Effective December payment can be delivered in January without changing year. Final history remains final.

Sixteen isolated contract tests and three native restricted-login concurrency cases supplement prior suites. Native tests race twenty OTP claims across independently recomposed adapters, twenty signed payment replays, and twenty late-year replays. Actual CI counts/commit/tree and PostgreSQL actors are recorded in the review report after execution. Rollback is a git revert plus rebuilding only the ephemeral database; no financial undo operation. I4 remains OPEN; return A1 after bounded verification/documentation. Real provider qualification, privacy/legal retention, real Owner authentication and historical cutover remain separate gates; VP-ISS-019 CAUSE NOT ESTABLISHED, VP-SEC-032 OWNER DECISION PENDING, I3 v1 provenance unchanged.


## Owner-approved isolated privacy / quota-key continuity — 2026-10-04
The Owner answered “autorizo” to policies1–5 and the concrete package in report version18. Temporary A3 covers additive migrations, isolated private API/keyring/cleanup, tests/docs and existing validation branch/CI only. This is not production retention, a real key rotation, real Owner authentication or provider/cutover approval. No canonical governance history is rewritten.

CLI2.81.3 generated 20261004080912_funding_key_scope_continuity.sql and 20261004080913_funding_retention_controls.sql. Previous seven migrations are unchanged. Private key_versions stores purpose/version/fixture provenance and a SHA256 commitment, never key material. Synthetic split versions require separate secrets for annual/event/rate/session/OTP/provider/review and no participation secret reuse. V1 combined material is admitted only as explicit known synthetic legacy provenance. Catalog enrollment has no default: only the fixture owner can attest synthetic_closed_fixture with an opaque evidence reference. This assertion does not certify real historical completeness or actual Owner identity. Unknown enrollment, incomplete versions, wrong key material, duplicate versions and unknown provenance fail closed. This prototype conservatively requires all registered versions; retirement requires a later dependency proof and policy, not silent key removal.

Private quota_scopes/aliases bind exactly one year or event to a random canonical token (or preserve an already known v1 quota token). No universal donor/participation identity is introduced. Rate aliases are a separate ephemeral purpose, removable after the last auth dependency expires. Candidate HMACs are stored privately with the challenge, but annual/event scope is resolved only after a valid OTP under the shared claim/lease. Global transaction-scoped resolution lock is taken before challenge lock, also during cleanup. Conflicting aliases or independently used legacy tokens are not merged; rollback preserves all old evidence. Catalog and quota aliases/scopes remain immutable except authorized rate-only cleanup.

All new reservations consume the existing canonical annual/event quota row and its existing row lock, including fee/closure paths. An intent trigger rejects raw noncanonical tokens when continuity is enrolled; old service compositions are blocked until supplied a complete keyring. The legacy fixture cohort is retained when enrollment is absent, so old regressions remain executable; this is not a production coexistence/cutover plan. Real legacy-writer exclusion remains an activation gate. Sessions from known old keys can be verified by the complete keyring; new-year verification remains required. Revocation is checked against private immutable revocations on every session load across versions, without resetting quota. It is an isolated bearer operation, not Owner identity verification.

funding_cleanup is separate NOLOGIN with no financial/reviewer/service membership. It can read only expiry/dependency columns of auth and rate-only aliases/scopes, not donor payload/candidates/quota/ledger/key catalog. Finance loses DELETE and cleanup EXEC privileges. Retention policy intentionally starts empty; cleanup needs all three test-only session/challenge/rate rules, configured grace, elapsed DB-clock expiry and absence of dependencies. No legal duration or live cron is selected. OTP-reference and candidate deletion follows challenge FK cascade. Cleanup batches retain policy versions, counts, source, actor and transaction provenance; request UUID replay is idempotent. Deferred triggers prevent DELETE commit without same-transaction audit. Audit/commit faults roll back all deletions. Financial quota, ledger and final records cannot be deleted by this operator. Raw INSERT/DML operators remain trusted within their explicitly granted domains; these controls do not certify security against compromised runtime/operator/DB owner.

keyContinuity.js adds private isolated composition and cleanup.run(requestId), not production routes. Existing isolated service adds continuity and bearer revocation hooks. Provider OTP/review credentials remain simulated; the key catalog names their purpose, but does not implement real account/credential custody. Numeric cleanup fixture grace0 is explicitly seeded by test owner, not a migration default or production approval. Metadata does not certify actual provider retention or memory erasure.

New local regressions cover legacy adoption without rewriting ledger, purpose/version/material/enrollment validation, annual+event caps across keys, rate/attempt/session continuity, multi-year event quota, conflicts, atomic alias failure, revocation, grace/dependencies, absent policy, audit rollback, unauthorized deletion and role/privacy constraints. Five native cases verify operator privileges and race20 versioned reservations,20 OTP completions,20 live-auth cleanup batch replays and20 expired-auth replays preserving pending financial quota with actual inherited nonprivileged financial and cleanup logins. Execute full prior suites and record actual counts/commit/tree/PG actors in the report. Rollback is revert plus reconstructing the ephemeral DB; no real financial undo, history correction or key removal. Return A1 after documentation; I4 remains OPEN.

### Contract for future real Owner authentication (design only)
Real activation must identify the accountable human/issuer, require strong independently verified credentials and current server-side authority/revocation for each action, bind request/evidence/payment/amount/source/expiry, and audit recovery/revocation without a hidden override. The donor or PSP bearer and editable user metadata cannot confer Owner authority. Issuing a decision and applying it remain separate privileges with independent financial recheck. No actual identity provider, enrollment, credential issuance or recovery operation is activated here.

## Participation routes rehearsal (Owner gate 2026-10-05)

`participationRouteRehearsal.js` is a branded, disposable-only adapter for the
existing users/protests/Ko-fi route plugins. `server.js` never passes it, and
production rejects injected adapters. It requires the intercepted Twilio
candidate, synthetic destination, server-selected exposure bound and a private
scope lookup. It does not enable a production transport or a production flag.

The real request route retains reCAPTCHA/cooldown/rate-limit/nullifier admission
before reservation and dispatch. A caller's request key is domain-bound by the
server to event/device/telephone; retries reuse the durable operation claim.
One process serializes unresolved attempts per binding. Another process or
restart still relies on the underlying durable same-key claim, but the private
verification lookup is intentionally ephemeral: no automatic recovery or resend
is promised. Cross-process different-key admission needs a reviewed durable
binding before production. `prepared`/`review` OTP states are harness states,
not an approved modification of the live OTP schema/cron.

The actual token signer, device check, eligibility service and SQL adhesion
function run in the test harness. Scoped joins suppress the legacy SMS charge
regardless of `sms_sent`; they cannot mint a token from this flag. Manual and
Ko-fi scoped legacy writes are rejected before financial operations. Unknown
webhook handling is not silently ACKed or classified as a donation; production
needs the existing qualified inbox and its separately approved transition.

The CLI-created migration `20261005114925_funding_participation_scope_rehearsal.sql`
requires the disposable parent-fixture marker and deliberately refuses a normal
production DB. It modifies a copy of the existing SQL admission function using
an exact guard with drift rejection. Institutional admission no longer depends
on a legacy balance for enrolled fixture scopes; closure, method validity,
uniqueness and institutional membership remain in that same authority. Scope
membership is append-only. Fences reject legacy balance changes, status-closed
transfers and scoped legacy donation/movement writes. They do not constitute
containment of a compromised privileged actor or fence every unscoped general
fund write. They do not implement a public production participation closure.

Rollback in the disposable environment is disposal of that DB. A real transition
must pause new dispatch, retain evidence/holds, drain or review pending operations,
and preserve fences until all competing writers are excluded. Never rollback by
reenabling legacy financial writers over new scopes or dropping real ledgers.
The synthetic migration must not be used as a production installation plan.

The new HTTP/SQL tests intercept all network calls, simulate Google responses,
and use a limited Supabase-shaped fixture for OTP/device/cooldown lookups while
executing the actual adhesion SQL with `service_role` and its RLS constraints.
They verify routing/authority composition, not real PostgREST, Google, Twilio,
account pricing, legal retention or native PostgreSQL concurrency. Existing
institutional OTP consumption semantics are not altered or newly homologated.
The neutral UI message reuses `auth.verificationCannotContinue` for the new SMS
unavailable code. Full UI request/operation binding is not activated.


## Owner-authorized durable follow-up — 2026-10-06
The current isolated route factory requires a registered durable route store and
a candidate with an encrypted lookup vault. Per-process Maps are no longer the
route authority. See DURABLE_INSTALLATION_REVIEW.md for lifecycle, role boundaries,
legacy coexistence, preflight, draft SQL, exact manifest and rollback. No production
installer is supplied; normal DBs reject the fixture-guarded draft. The Owner keeps
Ko-fi/personal PayPal and defers new PSP homologation until the Stichting.
Native PG17 additions must actually run before their claims are verified.
