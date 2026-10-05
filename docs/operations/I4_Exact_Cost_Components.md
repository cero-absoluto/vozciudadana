# I4 — Isolated exact decimal cost components

Owner Gate: approved 2026-10-05 04:56:27 UTC. Scope is synthetic validation only, temporary A3 followed by A1. This module is not mounted in production. No payment, settlement, refund, SMS, exchange conversion, ledger entry, quota adjustment or production migration is authorized by this package.

## Model and invariants

Migration `20261005045706_funding_exact_cost_components.sql` creates five private append-only tables: operations, components, component revisions, conflicts and aggregate attestations. An on-demand snapshot is a rebuildable projection. Components support channel attempts and verification fees. Their references are globally unique across operations; revisions are unique per component and source revision. A repeated identical revision is idempotent. A conflicting revision records a conflict without replacing its original. The highest source revision is current, regardless of arrival order; historical revisions are not added together.

Inputs are decimal strings, with at most 18 integer and 12 fractional digits, stored as numeric(30,12). Invalid syntax and excessive precision are rejected without rounding or truncation. Original lexical evidence is retained; canonical binding removes insignificant trailing fractional zeros. Zero is explicit evidence, distinct from missing price. Aggregation uses PostgreSQL numeric sums and returns strings separately for each explicit currency. There is no exchange rate, combined currency total or EUR ledger posting.

Missing prices, provisional evidence, conflicts, unassigned purpose or unknown event cannot become completed. Finality requires an exact current snapshot, complete component manifest and an explicit fee basis: one verification fee when required, none when not applicable. A later changed current revision preserves the original attestation and changes the projection to review. Elapsed time, delivery, approval and missing provider records do not establish financial finality.

## Authority and privacy

Two NOLOGIN, non-superuser, non-bypass roles separate ingestion and calculation. Neither has finance, service, reviewer or Owner membership. RLS and explicit grants limit ingestion to facts and calculation to snapshots and attestations; no ledger or annual quota access is granted. Five SECURITY INVOKER functions use fixed search paths and actor checks. Tests exercise actual login actors on native PostgreSQL, including attempted role escalation and financial writes.

The JavaScript service exposes open, receive, inspect and attest only in isolated mode. Its ingestion, proof, funding, Owner and participation secrets must be distinct. Accepted fields contain no phone, donor HMAC, adhesion identifier, email or raw provider payload. References are synthetic; future real references require their own pseudonymization and retention assessment.

The completeness issuer is a trusted fixture boundary, not a PSP, identity provider or real Owner evidence system. Its opaque proof map is process-local: restart loses handles, while persisted database facts and attestations remain. A trusted issuer can issue a new bound proof; callers cannot make evidence final by supplying a boolean. Direct SQL insert grants are restricted trusted actor capabilities, not a claim that arbitrary provider evidence is authenticated. Production custody, provider authorization, durable proof issuance, retention and privileged actor exclusions remain separate unresolved gates.

## Transaction and failure behavior

Responses follow COMMIT. Failed commits roll back and return no success acknowledgement. Lost responses after successful commits retry idempotently. Operation locks serialize ingestion and finality; finality checks a current snapshot after acquiring the same lock. Immutable triggers prohibit rewriting facts and attestations. Native tests use twenty concurrent clients for duplicate ingress, conflicts and duplicate finality, and an observed waiting transaction for stale proof rejection.

## Verification and rollback

Run the funding, integrity, qualification and lifecycle suites. Native CI must run PostgreSQL 17 with required multi-session validation and zero skips; PGlite is supplementary and does not establish native concurrency. The initial targeted run had eight passes and one test assertion failure: public fixture RLS can hide all rows from UPDATE rather than raise a permission error. The assertion was corrected to distinguish that behavior from exact-cost actor permission denial; no permission was relaxed.

Rollback consists of stopping the isolated harness and discarding its isolated database or fixture schema after preserving evidence. Do not reverse financial transactions or run this migration on production. The production branch and real accounts remain untouched. I4 remains open until separately authorized operational integration and its prerequisites are complete.
