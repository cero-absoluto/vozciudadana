# Voice Protest — Public Integrity Log

This log is updated manually. Entries are added by commit after each event closes. There is no automatic update — every entry is a deliberate, traceable action.

This file records the public integrity hashes of closed Voice Protest events.

Each entry can be independently verified against:

* The public report: `https://voiceprotest.org/#/informe/{protest_id}`
* The public API: `https://api.voiceprotest.org/api/public/protests/{protest_id}/integrity-data`

Voice Protest integrity records are designed to make later manipulation of published results detectable. Any modification of adhesion data after closure would produce a different integrity hash.

## Integrity versions

| Version | Description |
|---------|-------------|
| v1 | Internal integrity seal (HMAC-SHA256). Not fully publicly reproducible without the server secret. |
| v2 | Publicly reproducible integrity record using public commitments (SHA256). Verifiable by anyone. |

## How to verify a v2 hash

1. Fetch `GET https://api.voiceprotest.org/api/public/protests/{id}/integrity-data`
2. Sort `public_commitments` alphabetically
3. Build the city distribution string: `city1:count1,city2:count2,...` (sorted by city name)
4. Build the reliability string: `score1:count1,score2:count2,...` (sorted by score)
5. Concatenate: `protest_id|title|demands|scope|country|count|cities_count|reliability|cities|first_adhesion|last_adhesion|sorted_commitments_joined_with_|`
6. Calculate the SHA256 of that string
7. Compare with the `integrity_hash` in this log

The in-app verifier (🔍 button in the public report) performs this calculation automatically.

## 2026

| Closed at (UTC) | Protest ID | Title | Verified adhesions | Version | Integrity hash | Report |
|-----------------|------------|-------|--------------------|---------|----------------|--------|
| 2026-07-25 14:00 | `3de5405e-a8d6-43b1-8dca-32ebb74060f8` | Contra el desplilfarro del Gobierno catalán de Illa | 2 | v2 | `004d8fedd0e15d8c3fa4a9dad8281ac13492f3f0317b5846a4e3cf63e956c637` | https://voiceprotest.org/#/informe/3de5405e-a8d6-43b1-8dca-32ebb74060f8 |
| 2026-07-31 14:00 | `9774b676-a6a2-41ea-93d2-cf525fa9b21b` | Recinto ferial en Las Llamas: los vecinos exigen participar en la decisión | 6 | v2 | `f9b048c884950967933b3cbd74cb0edfeae3721033c104a8e0e9473c26e55f33` | https://voiceprotest.org/#/informe/9774b676-a6a2-41ea-93d2-cf525fa9b21b |

Not yet listed: `c1c10dba-b6c0-4827-af52-ec52b726a106` (closed 2026-07-07), which carries an integrity_version 1 hash computed by an older, pre-v2 mechanism with no corresponding `integrity_records` entry — it predates the fixes of 9 August 2026 and has not yet been re-verified end-to-end. Pending a decision on whether to recompute it under v2 before adding it here.

This log is updated manually when a protest closes. Each entry is a permanent Git commit. Source code: github.com/cero-absoluto/vozciudadana — AGPL 3.0


## Dated clarification — 3 October 2026 (Phase I3)

The earlier "Not yet listed" paragraph is preserved as a historical statement. Current production inspection found a corresponding v2 `integrity_records` snapshot for `c1c10dba-b6c0-4827-af52-ec52b726a106`, calculated on 9 August 2026. Its SHA-256 is `db1fece446a60d13fc40a3d848925d729b4fed62236e26cb800d8b2fa8ccee6e`; both its stored canonical input and the public integrity-data payload independently reproduce that hash. It has zero adhesions and zero commitments.

The protests row still carries version 1 and hash `cc2d22963c8bdadd4bf90755d7d9748647905c617f8646c6df5cc925cab38b40`. The exact origin of that older hash has not been established. This cross-table discrepancy is retained; this note does not reconcile the versions, replace the earlier evidence, establish an incident, accept the discrepancy as risk, or add a reconciled event entry to the table above.

I3 removed the disabled legacy trigger by migration `20261003185040_retire_legacy_integrity_trigger`, preserving all existing rows, hashes and snapshots. VP-SEC-027 is remediated/verified for that interference path; VP-ISS-012 remains open, including the partial snapshot-upsert defect. See [I3 verification record](governance/I3_Integrity_Remediation_20261003.md).
