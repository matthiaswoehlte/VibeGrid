# VibeGrid — Claude Context

> This file is read automatically by every Claude Code instance working in this repo.
> It provides project context, conventions, and constraints.
> Do NOT put role assignments here — roles are given via session start prompts.

---

## What is VibeGrid

VibeGrid is a music-animation studio app. Users import an image and an audio track,
place beat-synchronized visual effects on a timeline, preview on a canvas stage,
and export the result as a WebM video.

**Target platforms:** Browser (Vercel), iOS App Store, Google Play Store (via Capacitor, v0.2)

**Spec:** `docs/superpowers/specs/2026-05-19-vibegrid-design.md` — single source of truth.
When in doubt, the spec wins. If the spec is ambiguous, STOP and ask Matthias.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript strict |
| Styling | Tailwind CSS + CSS custom properties |
| State | Zustand 4 + persist middleware |
| Audio | Web Audio API |
| Rendering | Canvas 2D API, plugin-based FX |
| Drag & Drop | @dnd-kit/core |
| Toasts | sonner |
| Storage | Cloudflare R2 (EU Jurisdiction) via @aws-sdk/client-s3 |
| Deployment | Vercel (Node.js Runtime) |
| Testing | Vitest + @testing-library/react + MSW + Playwright |
| CI | GitHub Actions |

---

## Non-Negotiable Rules

### 1. SSR / Capacitor Safety
**Never** access `window`, `AudioContext`, `HTMLCanvasElement`, `OffscreenCanvas`
at module top level. Always lazy-init inside `useEffect` or behind `isClient()`:

```ts
import { isClient } from '@/lib/utils/is-client';
if (!isClient()) return;
```

This protects both Next.js SSR build and the future Capacitor wrapper.

### 2. No Blobs in localStorage
The Zustand `persist` middleware must **never** serialize:
- `AudioBuffer`, `ImageBitmap`, `Blob`, `File`
- Any in-flight upload state
- Any transient export state
- Action functions (set*, do*)

Only serializable data (URLs, metadata, primitive state) goes to localStorage.

### 3. Pointer Events over Mouse Events
All interactive canvas and timeline elements use `onPointerDown/Move/Up`,
never `onMouseDown/Move/Up`. This prepares touch support for Capacitor v0.2.

### 4. Test-First
Every new module ships with tests. Tests are written BEFORE implementation
(fail first, then implement). No module is "done" without passing tests.

### 5. Pure Functions in lib/timeline/ and lib/audio/grid.ts
These modules have zero side effects. No I/O, no time, no React.
Any function that isn't pure belongs in a different module.

### 6. One Concern Per Commit
Commits are granular. Each commit message follows:
`type(scope): description`
Types: feat, fix, test, chore, docs, refactor, ci

---

## Module Map

```
lib/renderer/     Canvas loop, FX plugin interface, FX registry
lib/fx/           FX plugins (contour, sweep, pulse, particles)
lib/audio/        AudioEngine, beat detector, grid math
lib/timeline/     Types, selectors, operations — PURE, no React
lib/store/        Zustand store + slices
lib/storage/      StorageAdapter interface + R2StorageAdapter
lib/export/       VideoExporter (MediaRecorder wrapper)
lib/utils/        isClient() and other shared utilities
app/(studio)/     Next.js studio routes + layout
app/api/          API routes (upload → R2, projects → D1 stub)
components/       UI components (pixel-perfect to PicTune handoff)
db/schema.sql     D1 schema (prepared, not yet applied)
tests/            unit/, integration/, e2e/
```

---

## Plan Execution Order

| Plan | Module | Status |
|---|---|---|
| 0 | Scaffold & Tooling | ✅ Done |
| 1 | Timeline (pure) | ✅ Done |
| 2 | Audio Engine & Beat Detection | ✅ Done |
| 3 | Renderer + FX Plugins | ✅ Done |
| 4 | Storage & API Layer | ✅ Done |
| 5 | UI Components | ✅ Done |
| 6 | Export Pipeline (realtime + offline) | ✅ Done |
| 7 | Auth (Better-Auth) | ✅ Done |
| 8a | SceneFlow Fundament | ✅ Done |
| 8b | Story-Input + Sonnet + Storyboard | ✅ Done |
| 8c | fal.ai Render-Pipeline | ✅ Done |
| 8d | Timeline-Integration + Beat-Snap | ⬜ Pending |

**Rule:** Never start Plan N+1 before Plan N passes all verification gates.

---

## Verification Gate (every plan)

```bash
npm run typecheck    # tsc --noEmit clean
npm run lint         # eslint clean
npm test             # all unit + integration tests green
npm run build        # next build succeeds
```

---

## Design Tokens (Dark Mode only — no toggle)

```css
--bg: #0c0d12          /* page background */
--surface-1: #14161f   /* panel background */
--surface-2: #1a1d2a   /* card / input background */
--surface-3: #232739   /* hover state */
--border: rgba(255,255,255,0.06)
--text: #e8eaf0
--text-dim: #aab0c4
--text-muted: #6b7088
--a1: #a86bff          /* accent (electric default) */
--a2: #5a8fff
--a3: #2ee0d0
```

Accent themes via `data-accent` on `<html>`: `electric` | `sunset` | `acid` | `neon`

---

## Environment Variables

See `.env.example`. Never commit `.env.local`.
Never log R2 credentials. Never pass credentials to client-side code.

---

## Out of Scope for v0.1

- Authentication / multi-user
- D1 active read/write (schema only)
- Full mobile UI (stubs only)
- Capacitor build
- WebGL renderer
- Glitch / Shake / Flare / Sparkle FX
- R2 upload of exported video
- MP4 / WebCodecs export
