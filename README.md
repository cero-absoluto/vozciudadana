🗳️ Voice Protest
Verified, pseudonymous and uncensored citizen protest platform.
> *"A street protest measures who can be there that day. We measure real support — with mathematical guarantees that each adhesion is a real person from the right country."*
![Live App](https://img.shields.io/badge/Live%20App-cero--absoluto.github.io-4CFFA4?style=flat-square)
![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue?style=flat-square)
![API](https://img.shields.io/badge/Public%20API-Open%20Data-orange?style=flat-square)
---
What is Voice Protest?
Voice Protest is a civic tech platform that allows citizens to adhere to verified protest events with full identity protection. It is not a petition platform — it only accepts formal complaints about public abuse (corruption, nepotism, negligence, repression) directed at institutions with public funds or mandate.
Every adhesion is:
Anonymous — phone number is SHA-256 hashed locally before leaving the device
Verified — real phone number via SMS OTP (one number = one adhesion)
Geographically validated — SIM prefix + IP + optional GPS
Publicly auditable — all counts are transparent and open
Available in 🇪🇸 ES · 🇬🇧 EN · 🇫🇷 FR · 🇨🇳 中文
---
Key Features
Feature	Description
🔒 SHA-256 local hashing	Phone number hashed on-device. Identity never stored or transmitted
📍 GPS verification	Optional location boost raises reliability to 95%
👥 Dynamic census	Wave-based trust system with peer vouching for local events
📧 Institutional email	Any institutional domain for university/workplace events
🌍 Geographic scopes	National (SIM+IP verified) · Local · Global
📊 Public report	Live data, PDF export, embeddable widget for media
🔌 Public API	Free, no auth required. For researchers and journalists
💰 Citizen funding	Per-event balance funded by citizen donations
📁 Archive	Permanent record of all closed events
🔔 Push notifications	1h-before-close alert. Auto-deleted after event ends
⛓️ Blockchain	Immutable counts — in development
🧅 Tor routing	For high-risk regimes — in development
---
Tech Stack
Layer	Technology
Frontend	Vue.js 3 + Vite → GitHub Pages
Backend	Fastify (Node.js) → Railway
Database	Supabase (PostgreSQL)
SMS Verification	Twilio Verify
Email	Resend
Maps	OpenStreetMap / Nominatim
Source validation	Wikidata API
---
Public API
Free, open, no authentication required. Rate limit: 120 req/min.
```
GET /api/public/stats              # Global platform statistics
GET /api/public/protests           # List all protests (filter by status, scope, country)
GET /api/public/protests/:id       # Full data for a single protest
```
Base URL: `https://api.voiceprotest.org`
Interactive documentation available in-app under INFO → Open Data → Public API.
---
Embeddable Widget
Any media outlet can embed a live protest counter with one line of HTML:
```html
<script src="https://voiceprotest.org/widget.js?id=PROTEST_ID"></script>
```
Shows: live counter · event title · cities · countries · "Join privately" button. Updates every 30 seconds.
---
Reliability Scoring
Signals	Score
GPS + SIM + IP	95%
GPS + SIM	92%
SIM + IP	85%
SIM only	75%
IP only	60%
Institutional email OTP	90%
---
Project Structure
```
repo/
├── apps/
│   ├── web/          # Vue.js frontend → deployed to GitHub Pages
│   └── api/          # Fastify backend → deployed to Railway
├── supabase/         # DB schema, migrations, seed data
├── .github/
│   └── workflows/
│       └── deploy.yml   # CI/CD: build web → gh-pages branch
└── package.json      # npm workspaces root
```
---
Quick Start
```bash
# Install all workspace deps
npm install

# Run frontend dev server (http://localhost:5173)
npm run dev:web

# Run API dev server (http://localhost:3000)
npm run dev:api
```
Web (`apps/web`)
Built with Vite. The base is set to / for GitHub Pages with a custom domain.
Command	Description
`npm run dev:web`	Vite dev server with HMR
`npm run build`	Production build → `apps/web/dist/`
`npm run preview`	Preview the production build locally
Pushes to `main` automatically trigger the GitHub Actions deploy workflow.
API (`apps/api`)
Fastify + Supabase. Copy `.env.example` to `.env` and fill in your credentials.
```bash
cp apps/api/.env.example apps/api/.env
npm run dev:api
```
Database (`supabase/`)
```bash
# Start local Supabase stack
supabase start

# Apply migrations
supabase db push

# Seed demo data
supabase db reset --db-url <local-url> < supabase/seed.sql
```
---
Environment Variables
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

# Security
NULLIFIER_SECRET=
ADMIN_SECRET=

# CORS
CORS_ORIGIN=https://voiceprotest.org
```
---
Philosophy
Voice Protest has no ideology. It is neutral infrastructure for democratic expression, accessible from anywhere, without physical risk.
No advertising — ever
No data sales — ever
No institutional funding — by design
No identity stored — mathematically guaranteed
Sustained by citizen donations. Independent by structure, not by promise.
---
Contributing
This project is open source under AGPL 3.0. Contributions welcome.
Areas where help is most needed:
i18n — extending translations to all components
Tor integration for high-risk countries
Blockchain ledger implementation
Native iOS / Android apps
Please open an issue before submitting a pull request.
---
Links
Live app: https://voiceprotest.org
Public API: https://api.voiceprotest.org/api/public
Repository: https://github.com/cero-absoluto/vozciudadana
---
Authorship
Voice Protest is an original project by Judith Galan Mayoral.
Concept and development: Judith Galan Mayoral  
Technical collaboration -Core Developer: JL - username: KIU - DD  
License: AGPL 3.0 — publicly auditable  
© 2026 Judith Galan Mayoral
