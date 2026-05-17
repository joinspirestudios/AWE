# Create

AI-powered carousel generator.

## Stack

- **Frontend**: Next.js 15 (App Router) + React 19 + Tailwind v4 + Zustand
- **Editor**: Konva.js via react-konva
- **Local persistence**: IndexedDB via Dexie
- **AI**: Multi-provider router (Claude / Gemini / OpenAI / Replicate)
- **Backend**: Vercel serverless + Supabase (Postgres, Auth, Storage)
- **Analytics**: PostHog
- **Background jobs**: Inngest
- **Reference fetching**: Apify (Instagram, TikTok, LinkedIn scrapers)
- **Language**: TypeScript strict everywhere
- **Lint/format**: Biome

## Repository layout

```
create-app/
├── app/                    # Next.js application (the actual product)
├── packages/
│   ├── scene/              # Carousel data model (Zod schemas + types)
│   ├── ai/                 # Multi-provider AI layer
│   ├── editor/             # Konva-based editor lib (stub)
│   └── shared/             # Cross-cutting utilities
└── supabase/
    └── migrations/         # SQL migrations
```

## Getting started

```bash
# Use Node 20
nvm use

# Install dependencies (pnpm workspaces)
pnpm install

# Run the dev server
pnpm dev
```

The app will be at http://localhost:3000.

## Environment variables

Copy `app/.env.example` to `app/.env.local` and fill in:

- `ANTHROPIC_API_KEY` — Claude
- `GOOGLE_AI_API_KEY` — Gemini
- `OPENAI_API_KEY` — embeddings only
- `REPLICATE_API_TOKEN` — image generation
- `APIFY_API_TOKEN` — reference scraping
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — when we wire Supabase
- `NEXT_PUBLIC_POSTHOG_KEY` — analytics

## Commands

| Command | What |
|---|---|
| `pnpm dev` | Run the app (port 3000) |
| `pnpm build` | Build the Next.js app for production |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm lint` | Biome check |
| `pnpm lint:fix` | Biome check + autofix |
| `pnpm format` | Format with Biome |

## Deploying to Vercel

`vercel.json` at the root tells Vercel everything it needs:
- Install via `pnpm install` (works with or without committed lockfile)
- Build only the `app` package via `pnpm --filter app build`
- Output goes to `app/.next`
- Framework preset: Next.js

You don't need to set a Root Directory in the Vercel dashboard — leave it at the
repo root. For best results, commit `pnpm-lock.yaml` after your first local
`pnpm install` so Vercel reproduces the exact dependency tree.

## Workspace packages

Anything imported as `@app/scene`, `@app/ai`, `@app/editor`, or `@app/shared` is
a local workspace package. They're resolved by pnpm and consumed directly from
their `src/` folders no build step required during development.

## License

Proprietary. All rights reserved.
