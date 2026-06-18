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
- **Geographically affiliation signals** — SIM, IP and optional GPS confirmation contribute to reliability scoring.
- **Publicly auditable** — integrity hashes and public commitments allow independent verification of every closed report. Results can be verified by anyone using the in-app verifier or the public API.

Available in 🇪🇸 ES · 🇬🇧 EN · 🇫🇷 FR · 🇨🇳 中文

---

## Key Features

| Feature | Description |
|---------|-------------|
| 🔒 HMAC-SHA256 pseudonymous identifier | Phone numbers are used only for verification and transformed into irreversible identifiers. |
| 🔍 Publicly verifiable reports | Closed reports include SHA-256 integrity hashes and public commitments. Anyone can verify results independently using the in-app verifier or the public API. |
| 📡 Public commitments | Per-adhesion commitments — `SHA256(protest_id + nullifier)` — enable hash verification without revealing identities or enabling cross-protest correlation. |
| 📋 Integrity log | Public record of integrity hashes maintained through GitHub. Updated manually at each protest closure. |
| 📍 GPS verification | Optional location signal raises reliability scoring |
| 👥 Dynamic census | Wave-based trust system with peer vouching for local/institutional events |
| 📧 Institutional email | Any institutional domain for university/workplace events |
| 🌍 Geographic scopes | National · Local/Regional · Global | |
| 📊 Public report | Live data, PDF export, embeddable widget for media |
| 🔌 Public API | Free, no auth required. For researchers and journalists |
| 💰 Participant funding | Per-event balance funded by participant donations |
| 📁 Persistent public record | Closed events and integrity snapshots designed to be preserved indefinitely |
| 🔔 Push notifications | Result alert at closure. Auto-deleted after event ends |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue.js 3 + Vite → GitHub Pages |
| Backend | Fastify (Node.js) → Railway |
| Database | Supabase (PostgreSQL) |
| SMS Verification | Twilio Verify |
| Email | Resend |
| Maps | OpenStreetMap / Nominatim |
| Source validation | Wikidata API |

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

---

## Project Structure

```
repo/
├── apps/
│   ├── web/          # Vue.js frontend → deployed to GitHub Pages
│   └── api/          # Fastify backend → deployed to Railway
├── supabase/         # DB schema, migrations, seed data
docs/
├── canonical/
├── governance/
└── integrity-log.md
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

# reCAPTCHA
RECAPTCHA_SECRET=

# CORS
CORS_ORIGIN=https://voiceprotest.org
```

---

## Philosophy

Voice Protest is not affiliated with any ideology, political party or institution. It is neutral infrastructure for verified participation, accessible from anywhere and without physical risk. We verify participation, not truth.
The platform records that participation occurred under its verification rules while leaving the validity of claims to public debate, journalism, institutions and courts.

- No advertising.
- No data sales.
- No institutional funding by design.

Direct personal identifiers are not stored after verification. Technical safeguards are used to help verify that each adhesion comes from a unique participant connected to the relevant community.

Sustained by participant donations. Independent by structure, not by promise.

---

## Contributing

This project is open source under AGPL 3.0. Contributions welcome.
Before contributing, please review:
- docs/canonical/VoiceProtest_AuditAlignment_v2_1.pdf
- docs/canonical/VoiceProtest_v3_(5)_beta_auditado.pdf

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
