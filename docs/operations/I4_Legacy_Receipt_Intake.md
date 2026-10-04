# I4 — isolated legacy receipt intake

Owner Gate: Project Owner “autorizo”, 2026-10-04 22:17:45 Europe/Berlin. A3 is limited to this isolated implementation, tests, validation branch and documentation. Production, main, payment accounts, balances and historical records are outside this gate. Return to A1 after verification.

## Receipt is not payment qualification

The fixture receives a synthetic authenticated notice into a private immutable journal. It creates no intent, identity, quota, cash account, allocation, refund or settlement. A response always states `allocation: review`, `fundsMoved: false`, `paymentVerified: false`, `simulated: true`. No 90/10 rule applies. No real June payment or existing event balance is imported or reconciled.

`20261004201818_funding_legacy_receipt_journal.sql` creates operations, conflicts, an independent ingestion role and one SECURITY INVOKER function with a fixed search path. Private API `legacyReceipt.js` exposes an optional `/fixture/legacy-receipts` test route. The production server and legacy Ko-fi route are unchanged. Both adapter and service reject production mode.

## Minimal data and authority

Only synthetic reference, integer minor-unit amount, explicit uppercase currency, optional declared event UUID and optional declared ISO timestamp are accepted. Unknown fields, raw payloads, donor metadata and real provider identifiers are rejected. A SHA-256 binding covers normalized fields. Currency is not converted. Declared event and time are claims, with no foreign key or allocation implication; database receipt time is separate.

Provider/cohort/domain are fixed fixture values. Evidence reference `e0000000-0000-0000-0000-000000000001` identifies the synthetic shared-token adapter configuration; it does not identify externally verified payment evidence or a real provider signature. Receipt authentication uses a distinct synthetic secret from finance, Owner and participation. Real provider authentication, identifier minimization/key rotation, custody and retention qualification remain pending.

`funding_legacy_receipt_ingest` has no financial, review or service role membership. Its trusted raw INSERT boundary permits journal writing and is not a protection against a compromised ingest operator fabricating authenticated provenance. Application normalization and controlled adapter configuration are therefore required. Review receives selected columns only, excluding operation reference and binding digest; finance cannot access the schema. Anonymous and authenticated clients have no access or function execution. Journal UPDATE/DELETE triggers reject changes, including ordinary owner DML; a database administrator remains capable of altering schema or disabling controls.

## Idempotency and acknowledgment

One operation is unique within provider/cohort/source domain/reference. A transaction advisory lock serializes receipt and conflict creation. Exact retries return the original receipt and receipt time. Changed bindings create immutable conflict records without replacing the original. Repeated identical conflicts share one conflict ID. Digest reuse with inconsistent fields is rejected. These guarantees do not claim cross-domain identity or deduplication of different real provider references.

The API returns success only after COMMIT completes. Commit failure rolls back and returns unavailable. Lost response after a successful commit also returns unavailable; retry recovers the existing receipt. No financial effect accompanies either outcome. Native tests include twenty independent connections, observed lock waits, deferred commit failure and response loss. The actual external webhook acknowledgment/retry protocol still needs separate provider qualification.

## Rollback and verification

Rollback for the isolated fixture is reverting these code changes and rebuilding the disposable database. Never delete or rewrite committed production evidence as a rollback. This migration is not authorized for production installation. No existing financial migration is executed against production. Native CI must pass without skipped concurrency tests before documenting completion of this package. I4 as a whole remains open; this package is not a production cutover or PSP qualification.
