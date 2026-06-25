# 🗳️ Voice Protest

**Verified collective participation platform with pseudonymous, privacy-preserving verification.**

> *"A street protest measures who can be there that day. We measure verifiable support from those who choose to participate — using technical safeguards designed to verify that each adhesion comes from a unique participant connected to the relevant community."*

![Live App](https://img.shields.io/badge/Live%20App-voiceprotest.org-4CFFA4?style=flat-square)
![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue?style=flat-square)
![API](https://img.shields.io/badge/Public%20API-Open%20Data-orange?style=flat-square)

---

## What is Voice Protest?

Voice Protest is a civic tech platform that allows people to adhere to verified protest events with privacy-preserving verification. It is not a petition platform — it focuses on public-interest grievances directed at institutions exercising public functions, receiving public funds, or holding public responsibilities (corruption, nepotism, negligence, repression).

Every adhesion is:

- **Pseudonymous** — phone numbers are used only for verification and transformed into irreversible pseudonymous identifiers. The original number is not stored after verification.
- **Verified** — real phone number via SMS OTP. One verified number, one adhesion per protest.
- **Geographic affiliation signals** — SIM, IP and optional GPS confirmation contribute to reliability scoring.
- **Publicly auditable** — integrity hashes and public commitments allow independent verification of every closed report. Results can be verified by anyone using the in-app verifier or the public API.

Available in 🇪🇸 ES · 🇬🇧 EN · 🇫🇷 FR · 🇨🇳 中文

---

## What Voice Protest Is Not

Voice Protest is not a petition platform. Backend admission rules enforce this boundary:

- Events must allege a specific form of public abuse (corruption, rights violation, negligence, repression, opacity or nepotism).
- Sources from petition platforms (change.org, avaaz.org, etc.) are rejected as documentary sources.
- Demands phrased exclusively as requests or proposals are rejected.
- Recipients must be public institutions — political parties, private companies and individuals are not accepted. Validated server-side via Wikidata.

These rules are enforced server-side and apply equally to web users and direct API requests.

---

## Key Features

| Feature | Description |
|---------|-------------|
| 🔒 HMAC-SHA256 pseudonymous identifier | Phone numbers are used only for verification and transformed into irreversible identifiers. |
| 🔍 Publicly verifiable reports | Closed reports include SHA-256 integrity hashes and public commitments. Anyone can verify results independently using the in-app verifier or the public API. |
| 📡 Public commitments | Per-adhesion commitments — `SHA256(protest_id + nullifier)` — enable hash verification without revealing identities or enabling cross-protest correlation. |
| 📋 Integrity log | Public record of integrity hashes maintained through GitHub. Updated manually at each protest closure. |
| 📍 GPS verification | Optional location signal raises reliability scoring. GPS geocoding is always routed through the backend server — Nominatim receives the server's IP address, not the participant's. For local events, GPS classifies adhesions into three tiers in the public report: locally verified, national, and international. |
| 👥 Dynamic census | Wave-based trust system with peer vouching for local/institutional events |
| 📧 Institutional email | Any institutional domain for university/workplace events |
| 🌍 Geographic scopes | National · Regional · Local (city/municipality) · Global |
| 📊 Public report | Live data, PDF export, embeddable widget for media |
| 🔌 Public API | Free, no auth required. For researchers and journalists |
| 💰 Participant funding | Per-event balance funded by participant donations (capped at €100 per computable donation) |
| 📁 Persistent public record | Closed events and integrity snapshots designed to be preserved indefinitely |
| 🔔 Push notifications | Three automated alerts per event: when the event starts, one hour before closure (suppressed during nighttime hours in the participant's local timezone), and when the final result is published. Auto-deleted after event ends. |

---

## Geographic Scopes

Voice Protest supports four geographic scopes. The scope is declared by the event creator and determines eligibility signals, default duration, and the structure of the public report.

| Scope | Eligibility | Default duration | Notes |
|-------|-------------|-----------------|-------|
| 🏛️ National | Verified SIM from the declared country. Residents abroad with a national SIM remain eligible. | 36h (closes at 20:00 — prime time) | Geographic distribution shown in report |
| 🌐 Regional | National SIM required. Regional scope is a declaration by the creator, not a technical restriction. | 8h (closes at 16:00 — afternoon news) | For regional/provincial institutions |
| 📍 Local | Any verified phone number. GPS classifies adhesions in the report but is not required to participate. | 8h (closes at 16:00) | Municipality identified by OSM ID — validated for all 27 EU member states |
| 🌍 Global | Any verified phone number, no geographic restriction. | 72h | Geographic distribution by country shown in report |

All start times are encoded in the event creator's local timezone. 08:00 always means 08:00 in the creator's city.

For local events, the public report shows three counters: participants with GPS confirmed within the declared municipality, national participants without local GPS, and international participants. GPS is a verification signal — not a participation requirement. Voice Protest verifies participation, not legitimacy. A resident temporarily absent from the municipality retains the right to participate.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue.js 3 + Vite → GitHub Pages |
| Backend | Fastify (Node.js) → Railway |
| Database | Supabase (PostgreSQL) |
| SMS Verification | Twilio Verify |
| Email | Resend |
| GPS Geocoding | Nominatim (OpenStreetMap) — via backend proxy, never called directly from the browser |
| Municipality search | Nominatim (OpenStreetMap) — OSM relation ID (admin_level=8) for reliable cross-language matching |
| Source validation | Wikidata API |
| Donations | Ko-fi + PayPal (webhook integration with donor data minimisation) |

---

## Public API

Free, open, no authentication required. Aggregated data only. Rate limit: 120 req/min.

```
GET /api/public/stats                        # Global platform statistics
GET /api/public/protests                     # List all protests
GET /api/public/protests/:id                 # Full data for a single protest
GET /api/public/protests/:id/integrity-data  # Public commitments and hash for independent verification
```

Base URL: `https://api.voiceprotest.org`

Interactive documentation available in-app under INFO → Open Data → Public API.

---

## Embeddable Widget

Any media outlet can embed a live protest counter with one line of HTML:

```html
<script src="https://voiceprotest.org/widget.js?id=PROTEST_ID"></script>
```

Shows: live counter · event title · cities · countries · "Join privately" button. Updates every 30 seconds.

---

## Reliability Scoring

| Signals | Score |
|---------|-------|
| GPS + SIM + IP | 95% |
| GPS + SIM | 92% |
| SIM + IP | 85% |
| SIM only | 75% |
| IP only | 60% |
| Institutional email OTP | 90% |

Scores indicate verification-signal strength and are not statistical probabilities.

---

## How verification works

1. Participant provides a real phone number.
2. Twilio sends a one-time SMS code.
3. The server verifies the code, then transforms the number into an `HMAC-SHA256` pseudonymous identifier using a server-side secret. The original number is discarded.
4. A per-protest `nullifier = HMAC-SHA256(phone_hash + protest_id)` prevents duplicate adhesions.
5. A `public_commitment = SHA256(protest_id + nullifier)` is generated — safe to publish, enabling independent hash verification without revealing identity or enabling cross-protest correlation.
6. At closure, `integrity_hash = SHA256(canonical_input + sorted_public_commitments)` is calculated and anchored in the public integrity log.

Institutional participants follow the same flow with their institutional email in place of a phone number: the email is verified by one-time code and transformed into an `HMAC-SHA256` identifier server-side, with the same per-protest nullifier.

---

## Project Structure

```
repo/
├── apps/
│   ├── web/          # Vue.js frontend → deployed to GitHub Pages
│   └── api/          # Fastify backend → deployed to Railway
├── supabase/         # DB schema, migrations, seed data
├── docs/
│   ├── canonical/    # Constitutional documents — what Voice Protest is and claims
│   ├── governance/   # Audit trail, security audit records, correction history
│   ├── operations/   # Technical reference — configuration, setup, troubleshooting
│   └── integrity-log.md
├── .github/
│   └── workflows/
│       └── deploy.yml   # CI/CD: build web → gh-pages branch
└── package.json      # npm workspaces root
```

---

## Quick Start

```bash
# Install all workspace deps
npm install

# Run frontend dev server (http://localhost:5173)
npm run dev:web

# Run API dev server (http://localhost:3000)
npm run dev:api
```

**Web (`apps/web`)** — Built with Vite. Base set to `/` for GitHub Pages with custom domain.

| Command | Description |
|---------|-------------|
| `npm run dev:web` | Vite dev server with HMR |
| `npm run build` | Production build → `apps/web/dist/` |
| `npm run preview` | Preview the production build locally |

**API (`apps/api`)** — Fastify + Supabase.

```bash
cp apps/api/.env.example apps/api/.env
npm run dev:api
```

**Database (`supabase/`)**

```bash
supabase start
supabase db push
```

---

## Environment Variables

```env
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Twilio Verify
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SID=

# Resend (email)
RESEND_API_KEY=

# Push notifications (VAPID)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=

# Security — required in production
NULLIFIER_SECRET=
PHONE_HASH_SECRET=
ADMIN_SECRET=

# Costs and fees
SMS_COST_EUR=0.05
EMAIL_COST_EUR=0.01
PLATFORM_FEE_PERCENT=10
MAX_DONATION_EUR=100

# Ko-fi webhook integration
KOFI_VERIFICATION_TOKEN=

# reCAPTCHA
RECAPTCHA_SECRET=

# CORS
CORS_ORIGIN=https://voiceprotest.org
```

---

## Philosophy

Voice Protest is not affiliated with any ideology, political party or institution. It is neutral infrastructure for verified participation, accessible from anywhere and without physical risk.

We verify participation, not truth. The platform records that participation occurred under its verification rules while leaving the validity of claims to public debate, journalism, institutions and courts.

- No advertising.
- No data sales.
- No institutional funding by design.

Direct personal identifiers are not stored after verification. Technical safeguards are used to help verify that each adhesion comes from a unique participant connected to the relevant community.

Sustained by participant donations. Independent by structure, not by promise.

---

## Contributing

This project is open source under AGPL 3.0. Contributions welcome.

Before contributing, please review:
- `docs/canonical/3.-VoiceProtest_AuditAlignment_v2_1.docx` — canonical reference document
- `docs/canonical/2.-VoiceProtest_v3_5_beta_auditado_final.docx` — master design document (English)

Areas where help is most needed:

- i18n — extending translations to additional languages
- Native iOS / Android apps
- Accessibility improvements

Please open an issue before submitting a pull request.

---

## Links

- Live app: https://voiceprotest.org
- Public API: https://api.voiceprotest.org/api/public
- Integrity log: https://github.com/cero-absoluto/vozciudadana/blob/main/docs/integrity-log.md
- Repository: https://github.com/cero-absoluto/vozciudadana

---

## Authorship

Voice Protest is an original project by Judith Galan Mayoral.

Concept and development: Judith Galan Mayoral
Technical collaboration — Core Developer: JL
License: AGPL 3.0 — publicly auditable
© 2026 Judith Galan Mayoral
