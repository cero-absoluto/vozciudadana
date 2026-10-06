# Durable integration: installation review package

This is an isolated candidate, not a production activation package. The Owner's
2026-10-06 gate permits local implementation, disposable DBs, tests and documents.
Publication, merge, production DDL and activation are outside this gate.

## Composition and data boundaries

`createParticipationRouteRehearsal` requires a registered durable store. There is
no memory fallback. An event/phone/device binding is a keyed HMAC, not a phone or
funding identity. Request keys produce a separate keyed operation reference.
The store commits `preparing` before cost preparation. A different unresolved
request stops; a crashed preparation is review, never an automatic resend.
After a committed exposure the binding becomes immutable. Dispatch uses the
existing durable provider claim; replicas and route restarts cannot reclaim it.

The optional private lookup vault replaces the adapter's ephemeral lookup. Its
separate NOLOGIN role has no route, ledger or donor privileges. AES-256-GCM uses
an externally supplied 32-byte key, a random nonce and the opaque operation UUID
as authenticated data. Neither keys nor plaintext provider references are
persisted in the DB. The key must differ from route/funding/participation keys;
production composition and custody are not established by test keys.
Unreadable/missing/expired references stop checks/collection and never resend.
TTL is set by the DB at at most 30 days; runtime cannot extend it. Expired purge
is granted to a separate retention-only role: it can delete expired rows, cannot read ciphertext or remove live rows, and is not a financial journal deletion. Earlier
purpose-end deletion and a scheduled production retention job require reviewed
composition; expiration alone does not certify physical removal.

Actors are checked for superuser, BYPASSRLS and mixed privileged memberships
before each transaction. All application functions are SECURITY INVOKER with
fixed search paths. Grants and RLS coexist. DML rights remain trusted operator
boundaries, not proof against a compromised actor. The parent UPDATE grant is
for row locking; a trigger denies actual mutations by the route actor.

## Closure, legacy coexistence and UI

The separate participation cutoff records a closed event without setting legacy
`status=closed`, touching the final hash, resetting balances or settling funds.
It only admits an ended event with a candidate binding. Pending/unknown costs
still block settlement; no settlement endpoint is activated.

Ko-fi → personal PayPal remains the Owner-authorised provisional channel.
Existing events and their writers are not enrolled. Candidate scopes cannot
receive legacy manual/Ko-fi writes. Without separately qualified incoming funds
and budget, new scopes remain inactive. There is no opening-balance import or
historical correction. Funding-page translations distinguish approved cumulative
€100/event and €1,000/year policy from unaccredited legacy enforcement.
This UI change is local only, not a statement that today's hosted page changed.

## Exact inventory and proposed order

Run `node scripts/i4-installation-manifest.mjs` from the repository root. It
prints SHA-256 fingerprints and the source commit. Dirty work is explicitly
labelled. Both installationAllowed and activationAllowed are false. There are
no deploy commands. `scripts/i4-installation-preflight.sql` inventories function,
trigger, ACL and RLS metadata in a read-only transaction, without participant
rows. It has not been executed against production in this package.

`sql/durable-route-candidate.sql` is a **draft**, deliberately outside Supabase
migrations and guarded by a disposable fixture marker. The earlier scope SQL
also requires a fixture. Neither is installable on normal production. A pinned
CLI-generated migration is not fabricated; the prior CLI telemetry rejection is
not bypassed. Installing these drafts as production migrations is a stop condition.

Future sequence, requiring its own reviewed executable production manifest:

1. Refresh read-only metadata, including cron and every financial writer.
2. Reconcile exact definitions/roles with the manifest; stop on drift.
3. Produce genuine production-compatible DDL, actor custody and compatibility.
4. Verify native PG17 concurrency, restoration, closure and institutional flow.
5. Obtain installation gate; install inert with no scopes and no route activation.
6. Verify installed metadata and unchanged legacy operation.
7. Only with qualified provider, budgets, fee/completeness/FX evidence and an
   activation gate, enrol an explicitly inventoried new cohort and cut off rivals.

This package does not pretend steps 3–7 are executed. Legacy exceptions cannot
be transformed into compliant funding by a label or a UI banner.

## Validation and rollback

PGlite route tests exercise actual Fastify handlers and the existing admission
SQL, recomposed routes/provider, encrypted lookup, crash/binding failure,
expiry/purge, role boundaries, closure and a disposable dump/restore.
The native harness adds two-actor 20-client races, durable recompose, deferred
COMMIT failure and parent-cutoff competition on a fresh loopback PG17 DB.
Its status is recorded in the delivery report, not inferred from prepared code.

Before activation: leave composition absent from server.js, retain journals,
revert candidate code as an isolated git revert. Restore only a disposable test
DB in this gate. No destructive financial down migration. After actual movement:
pause new operations, preserve evidence, investigate, and use separately
authorised forward corrections; never restore 90/10 or erase final records.
