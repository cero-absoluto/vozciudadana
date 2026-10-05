# I4 — Integrated SMS candidate, inert and isolated

Owner authorization: 2026-10-05 05:52:32 UTC / 07:52:32 Europe/Madrid. Temporary A3 covers isolated implementation, validation branch/CI and documentation, followed by A1. No production, real SDK transport, account, payment, SMS, FX, settlement or historical correction.

## What is composed

`blockedTwilioAdapter.js` uses the installed Twilio SDK (lockfile 5.13.1) with an HTTP client that only calls an injected in-memory responder. There is no HTTP implementation in that client, and no default transport fallback. Its credentials, service, destination and OTP are synthetic constants. SDK methods for sending, checking and paginated Attempts are exercised. Requests to other origins or paths and redirects to other endpoints are rejected. Auto-retry is disabled; pagination is bounded before requesting another page. The responder itself is a trusted test dependency, not a sandbox for arbitrary user code.

`smsIntegrationCandidate.js` composes existing SMS exposure/claim/journal with the exact component journal. A new immutable scope binding joins only operation IDs and event/purpose. Preparation is resumable across its separate committed transactions; a failed later binding leaves a hold, rather than falsely sending or freeing money. Dispatch checks that binding before attempting the durable claim. Only the claimant invokes the blocked adapter. Failed/ambiguous SDK outcomes become unknown; lost claim COMMIT responses never redispatch. Lost receipt acknowledgement leaves the claim intact.

The bridge migration creates one private table, one restricted NOLOGIN actor and three SECURITY INVOKER functions. RLS and grants permit only the specific operation scope reads needed by the bridge; no identity, annual limits or ledger access is granted. Direct actor INSERT remains a trusted capability boundary, as do existing SMS executor core grants. No claim of compromised-operator containment or production writer exclusion follows from this candidate.

## Financial and provider boundaries

Channel attempts are separate components; fee is a separate unknown component. Normalized price is a string with explicit currency. Provider raw payload, phone, OTP, credentials, donor HMAC and adhesion ID do not enter the journals. References use a separate HMAC domain. The lookup from operation to SDK verification SID is process-local, unexposed and disposable. Restart loses it: check/collection return a sanitized unavailable response and retain the hold; they do not resend. A durable restricted lookup store, its custody and retention remain production prerequisites.

Provider dateUpdated is not a reliable source ordinal here. All observations remain provisional at source revision 1. A different price for the same component records a conflict and review while preserving its original; receipt order or a newer timestamp does not overwrite it. Fee and finality have no qualified source, so the candidate cannot issue a completeness proof or call final attestation. Collections fail before journaling if a page, binding or value is invalid. Partial database ingestion can commit before a later failure, so retry is idempotent and no completed acknowledgement is returned prematurely.

Observed account evidence is USD/Pay as you go, and the Owner-provided June summary is estimated, includes all subaccounts, and separates channel segments from verifications. It is not ingested as per-operation evidence or used as a tariff. EUR exposure remains held when USD prices arrive. No monetary conversion, synthetic fee default, application or settlement is exposed. The aggregate DTO always reports settlementBlocked and never combines currencies.

## OTP, participation and closure

Private handlers compose request/verify/join for a disposable Fastify harness. Registration defaults to absent and rejects production mode. Admission, token issuance and join authorization are injected responsibilities of the participation domain; they are not supplied by a caller boolean. Generic OTP and institutional participation remain policy-pending in the enabled candidate. Dispatch accepted alone does not issue an authentication token. Verify approval can invoke participation-owned token issuance but never certifies a cost. Join removes sms_sent from the forwarded input and makes no financial write.

These handlers are not mounted by server.js, users.js or protests.js. Production routes, anti-bot checks, identity verification, institutional RPCs, UI and the legacy balance decrement remain untouched. Handler tests prove composition under the supplied participation authority; they do not homologate the real participation RPC or its policy. Production activation needs the full route/identity policy and SQL/cron/trigger writer exclusion diff.

Close uses the existing guarded wrapper, requires an ended event, blocks later dispatch, preserves the final hash and refuses settlement. Late price collection can still preserve evidence. No production cron or trigger was stopped or replaced.

## Validation and failures retained

Initial directed run: 0 PASS / 9 FAIL because the internal provider bridge lacked the required synthetic provider kind. That composition marker was added without weakening the existing factory guard. Second run: 7 PASS / 2 FAIL: tests tried closing an event before its end and expected a public RLS-hidden UPDATE to throw. Tests now explicitly check early closure rejection, expire only disposable events, and distinguish hidden public rows from restricted bridge denial. Third run: 9 PASS, followed by 10 PASS after actual disposable Fastify route coverage. Later runs reflect subsequent code changes and final CI evidence in the project report.

Native CI adds four cases: restricted bridge actor/permissions, twenty prepare/send/collect retries, deferred binding COMMIT and ambiguous claim recovery, and close/late evidence preservation. Pools are closed before the remaining suites. PGlite serializes its transactions and is not native concurrency evidence.

Rollback: remove private harness registration or candidate files and rebuild the disposable DB, preserving evidence. No production installation or real movement exists to reverse. No upgrade of SDK or Supabase dependencies, no balance backfill, no importing historical Twilio/PayPal data. I4 remains OPEN after this package; PayPal qualification remains Owner-deferred until the future Stichting.
