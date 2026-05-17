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

# Local migration
supabase migration up

# Seed demo data
supabase db reset --db-url <local-url> < supabase/seed.sql
```
