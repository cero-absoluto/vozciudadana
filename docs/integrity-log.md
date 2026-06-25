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
| — | — | No closed protests yet | — | — | — | — |

This log is updated manually when a protest closes. Each entry is a permanent Git commit. Source code: github.com/cero-absoluto/vozciudadana — AGPL 3.0
