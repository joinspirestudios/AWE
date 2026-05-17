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
| `pnpm build` | Build everything |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm lint` | Biome check |
| `pnpm lint:fix` | Biome check + autofix |
| `pnpm format` | Format with Biome |

## Workspace packages

Anything imported as `@app/scene`, `@app/ai`, `@app/editor`, or `@app/shared` is
a local workspace package. They're resolved by pnpm and consumed directly from
their `src/` folders — no build step required during development.

## License

Proprietary. All rights reserved.
