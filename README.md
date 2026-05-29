# Voz Ciudadana

**Plataforma de protesta ciudadana verificada, anónima y sin censura.**

Voz Ciudadana permite a ciudadanos adherirse a convocatorias de denuncia verificadas, con identidad protegida mediante hash SHA-256. Cada adhesión es anónima, verificada y contabilizada de forma transparente.

## Características principales

- 🔒 Anonimato total — el número de teléfono o email se convierte en huella matemática irreversible
- 📍 Verificación geográfica — SIM + IP confirman la pertenencia al país o región
- 👥 Censo dinámico — sistema de ondas de confianza con avales entre compañeros
- 📧 Verificación institucional — email corporativo para convocatorias universitarias o laborales
- 🌍 Alcance configurable — nacional, local o global
- ⛓️ Blockchain (en desarrollo) — conteos inmutables y verificables públicamente

## Stack tecnológico

- **Frontend:** Vue.js 3 + Vite — desplegado en GitHub Pages
- **Backend:** Fastify (Node.js) — desplegado en Railway
- **Base de datos:** Supabase (PostgreSQL)
- **Verificación SMS:** Twilio
- **Verificación email:** Resend
- **Verificación de fuentes:** Wikidata API

## URLs

- **App:** https://cero-absoluto.github.io/vozciudadana/
- **API:** https://vozciudadanaapi-production.up.railway.app

## Autoría

**Voz Ciudadana** es un proyecto original de **Judith Galan Mayoral**.

Concepto y desarrollo: Judith Galan Mayoral  
Diseño y programación: JL DD
Repositorio: https://github.com/cero-absoluto/vozciudadana  
© 2026 Judith Galan Mayoral. Todos los derechos reservados.

# Voz Ciudadana — Monorepo

```
repo/
├── apps/
│   ├── web/          # Vite frontend → deployed to GitHub Pages
│   └── api/          # Fastify backend (deploy to Railway / Fly.io / etc.)
├── supabase/         # DB schema, migrations, seed data
├── .github/
│   └── workflows/
│       └── deploy.yml   # CI/CD: build web → gh-pages branch
└── package.json      # npm workspaces root
```

## Quick start

```bash
# Install all workspace deps
npm install

# Run frontend dev server  (http://localhost:5173)
npm run dev:web

# Run API dev server        (http://localhost:3000)
npm run dev:api

# Run API dev server + Web dev server
dev: npm run dev:api + npm run dev:web desde la raíz.

```


## Web (`apps/web`)

Built with **Vite**. The `base` is set to `/vozciudadana/` for GitHub Pages.

| Command | Description |
|---|---|
| `npm run dev:web` | Vite dev server with HMR |
| `npm run build` | Production build → `apps/web/dist/` |
| `npm run preview` | Preview the production build locally |

Pushes to `main` automatically trigger the GitHub Actions deploy workflow.

## API (`apps/api`)

**Fastify** + **Supabase**. Copy `.env.example` to `.env` and fill in your credentials.

```bash
cp apps/api/.env.example apps/api/.env
npm run dev:api
```

## Database (`supabase/`)

Uses the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
# Start local Supabase stack
supabase start

# Apply migrations
supabase db push

# Local migration (http://localhost:54323)
supabase migration up

# Seed demo data
supabase db reset --db-url <local-url> < supabase/seed.sql
```
