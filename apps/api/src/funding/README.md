# I4 isolated funding implementation

This module is deliberately not imported by src/server.js. No production environment variable enables it. Use dependency injection in isolated tests or a separately composed local server. Never give it a production database connection.

Policy approved by Owner: event contributions exclusively verification/SMS, cumulative EUR100 per verified telephone identity/event; event and general contributions share EUR1000 per calendar year. Grants are independent; restricted grants retain purpose. Historical 90/10 superseded. No donor benefits.

The simulator never sends SMS, contacts a payment provider, creates a checkout URL or handles real money. Grant metadata/accounts and cost/settlement SQL are isolated fixtures only, with no API for accepting a grant or performing settlement. Financial identities use funding-only secrets and server-selected purpose/year; no participation records are used.

Timezone is mandatory configuration and remains an activation decision. Key rotation is not exposed: v1 only. No refunds, FX, fees, raw webhook persistence or automatic expiry/cup restoration. Expired payments and unknown intents are durably quarantined without automatic allocation. Provider tickets/fees, durable distributed OTP controls, review tooling, legal retention and historical annual usage remain launch blockers.

Reservation failure rolls back; provider checkout failure retains the reservation. All payments are simulator-labelled. Cost keys must be random funding-only references and must not encode participant, phone or adhesion identifiers.

SQL uses SECURITY INVOKER and a private NOLOGIN role. The role is created only in isolation; its parent row-lock privileges must be reviewed before any production migration. Nothing updates legacy balances or public integrity records. Production cutover, cron replacement and historical reconciliation are absent pending a separate Owner Gate.

## Authorized isolated follow-up (2026-10-03)
New cost commitments lock the event parent before the account and require a non-null active event window, in addition to an open account. Repeating an existing cost key while the account remains open creates no new commitment; an already reserved cost can finish after event end so settlement can reconcile it. This does not authorize new post-close costs or change historical data.

The native concurrency harness requires a fresh PostgreSQL 17 database named exactly `i4_isolated`, on loopback. It adds simultaneous cost reservations, a controlled parent-lock/end transition for contribution/cost/closure, and confirmation racing settlement. These tests are prepared but not verified until native PostgreSQL 17 runs them. The harness bounds statement/lock waits and rolls back its controlling transaction on failure.

## UUID case canonicalization follow-up (2026-10-03)
Event UUIDs are canonicalized to lowercase before HMAC generation and before challenge/session storage. Case variants must share one event quota; existing lowercase v1 HMAC output remains unchanged. An API regression verifies EUR60 plus EUR40 across case variants, rejects EUR60 plus EUR50 and any further cent, and checks canonical session values before PostgreSQL receives them. A fixed synthetic v1 vector verifies compatibility. No historical token rewrite, production change or data migration is included.
