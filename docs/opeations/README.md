# Operations Documentation

This folder contains operational and technical reference documents for Voice Protest.

These documents describe how specific systems work, how to configure them, and how to maintain them. They are not constitutional documents — they do not define what Voice Protest is or what it claims.

## Documents in this folder

**Ko-fi_Reference.md**
Complete Ko-fi reference: initial setup, webhook configuration, content-type technical notes, donation routing, multi-protest mapping guide, Supabase verification queries and troubleshooting.

## Related documentation

Constitutional documents (what Voice Protest is and claims) are in `/docs/canonical/`.

Governance history (audit records, correction history) is in `/docs/governance/`.

## Pending additions

The following operational references are not yet documented here and should be added to keep this folder complete:

* **Environment & secrets configuration (Railway).** The backend now refuses to start in production if the identity-hashing secrets are missing, so these are boot-critical: `PHONE_HASH_SECRET` (used for both phone and institutional-email identity hashes) and `NULLIFIER_SECRET` (per-convocatoria nullifiers). A reference should list all required environment variables and the fail-fast behaviour.
* **Data retention & maintenance jobs.** The 90-day retention of adhesion data is a Supabase-side concern (e.g. a `pg_cron` job or scheduled function) and is not visible in the repository. Its existence and schedule should be documented and verified here.
