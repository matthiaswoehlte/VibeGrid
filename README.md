# VibeGrid

AI-assisted tool for generating music videos with audio-synchronized visuals.

[![VibeGrid Demo Video](https://img.youtube.com/vi/t6KrayvSNlA/hqdefault.jpg)](https://youtu.be/t6KrayvSNlA)

*A complete video produced with VibeGrid — scenes, footage, and effects generated
and synced to the music.*

## About

VibeGrid turns a storyboard into a finished music video: scene generation, image
analysis, speech, and effects, assembled along a timeline. The visuals — scenes,
video, and effects — are synchronized to the audio, so on a single action the
whole composition locks to the music. It's a fully built, end-to-end tested system.

I'm not pursuing the commercial market — the space is held by well-funded
players — so the code is open here rather than sitting unused.

## Architecture & stack

| Area           | Technology                                          |
|----------------|-----------------------------------------------------|
| Framework      | Next.js (App Router), TypeScript                    |
| Database       | PostgreSQL (versioned migrations in `db/migrations`)|
| Object storage | Cloudflare R2                                        |
| Video/image AI | fal.ai                                              |
| Image analysis | Anthropic API                                       |
| Speech (TTS)   | ElevenLabs                                          |
| Tests          | Vitest (unit/integration) · Playwright (E2E)        |

## Repository layout

- `app/` — Next.js App Router (studio, auth, API routes, storyboard)
- `components/` — UI: timeline, inspector, SceneFlow, studio
- `db/` — schema and versioned migrations
- `tests/` — `unit/`, `integration/`, `e2e/` (236 test files)
- `scripts/` — operational scripts (migrations, uploads)
- `docs/` — planning and design documents

## Local setup

> Prerequisites: Node.js (LTS), a reachable PostgreSQL instance, and API keys
> for the services used.

```bash
# Install dependencies
npm install

# Create environment variables
cp .env.example .env.local
# Fill .env.local with real values

# Apply database migrations
node scripts/apply-pending-migrations.mjs

# Development server
npm run dev

# Tests
npm test
```

### `.env.example`

```dotenv
# Database
DATABASE_URL=postgres://user:pass@host:5432/vibegrid

# Cloudflare R2
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=

# AI services
FAL_KEY=
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
```

> Reconcile the exact variable names against your local configuration — this is
> the minimum set referenced in the code.

## Notes

- **Not actively maintained.** This is a complete, working codebase, not a
  maintained open-source product. Issues and PRs aren't being tracked.
- **Audio assets not included.** The original sample packs (drum loops, etc.) are
  not part of the repo for licensing reasons — they're loaded at runtime.
  Features that access them expect your own material.

## License

MIT — see [LICENSE](./LICENSE).
