# Security Policy

Voice Protest is open-source civic infrastructure handling pseudonymous
verification of real people. We take security reports seriously and welcome
review from independent researchers, auditors and academic partners.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately, not via a public GitHub
issue.

- **Email:** voice@voiceprotest.org
- **Please include:** a description of the issue, steps to reproduce if
  possible, and the potential impact as you see it.
- **Response time:** we aim to acknowledge reports within 5 business days.

We do not currently run a paid bug bounty program. We are happy to credit
researchers publicly (with permission) once a fix is released, and to
provide a letter confirming the engagement if useful for academic or
professional purposes.

## Scope

In scope:
- `apps/api` — the Fastify backend (Railway)
- `apps/web` — the Vue 3 frontend (GitHub Pages)
- The admission and verification rules described in
  `docs/governance/5.-Security_Audit_Protest_Petition_Boundary.md`

Out of scope:
- Third-party infrastructure we depend on but do not control (Supabase,
  Twilio, Railway, GitHub Pages, reCAPTCHA) — please report those directly
  to the respective provider.
- Denial-of-service testing against the production environment
  (`api.voiceprotest.org`, `reports.voiceprotest.org`) without prior
  coordination — reach out first and we'll gladly set up a safe testing
  window or environment.

## Coordinated Disclosure

We ask for a reasonable disclosure window (90 days is a common standard,
e.g. the one OSTIF-coordinated audits follow) before any public
disclosure, so fixes can be deployed and verified. We're glad to agree on
a shorter or longer window if circumstances call for it.

## Existing Documentation

Before starting a review, please see:

- [`docs/canonical/`](docs/canonical/) — the founding principles,
  methodology, and the design document describing the intended
  architecture and privacy model.
- [`docs/governance/`](docs/governance/) — the security audit history and
  the full audit trail of changes, including past vulnerabilities found
  and fixed.

These are updated in the same change as the code whenever the
implementation changes, so they should reflect the current state of the
system, not just its original design.
