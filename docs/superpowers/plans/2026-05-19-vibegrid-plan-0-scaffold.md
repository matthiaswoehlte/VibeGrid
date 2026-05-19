# VibeGrid Plan 0 — Scaffold & Tooling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the empty VibeGrid Next.js 14 / TypeScript / Tailwind project with permanent dark mode, design tokens from the PicTune handoff, fonts, an empty Zustand store, an `isClient()` SSR guard, and the full test + lint + CI infrastructure — so every later subsystem plan can drop in its modules and tests without touching tooling.

**Architecture:** App Router with a `(studio)` route group; permanent dark mode via `<html class="dark">` plus CSS custom properties on `:root`; Zustand store split across slices that later plans extend; Vitest (jsdom, `singleThread`) as the unit/integration runner; Playwright reserved for e2e; GitHub Actions for typecheck + lint + test on every PR. No business logic in this plan — only scaffolding and a smoke test that proves the test infra runs.

**Tech Stack:**
- Next.js 14 (App Router), React 18, TypeScript strict
- Tailwind CSS 3 + PostCSS + custom-property design tokens (PicTune handoff)
- `next/font/google` — Space Grotesk + JetBrains Mono (variable, `display: 'swap'`)
- Zustand 4 + `persist` middleware (localStorage)
- Sonner (toasts)
- Vitest 1 + `@testing-library/react` + jsdom
- Playwright (config only; first e2e test ships in Plan 6)
- ESLint (`eslint-config-next`) + Prettier
- GitHub Actions (Node 20)

**Spec reference:** `docs/superpowers/specs/2026-05-19-vibegrid-design.md` §2, §3.2, §9, §11.

**Verification gate (must pass before Plan 1 starts):**
```
npm run typecheck   # tsc --noEmit clean
npm run lint        # eslint clean
npm test            # vitest smoke test green
npm run build       # next build succeeds
```

---

## Task 1: package.json, tsconfig, base scripts

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next-env.d.ts` (auto-generated, but reserve the path)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "vibegrid",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "format": "prettier --write ."
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "zustand": "4.5.4",
    "sonner": "1.5.0"
  },
  "devDependencies": {
    "@playwright/test": "1.45.0",
    "@testing-library/jest-dom": "6.4.6",
    "@testing-library/react": "16.0.0",
    "@testing-library/user-event": "14.5.2",
    "@types/node": "20.14.10",
    "@types/react": "18.3.3",
    "@types/react-dom": "18.3.0",
    "@vitejs/plugin-react": "4.3.1",
    "autoprefixer": "10.4.19",
    "eslint": "8.57.0",
    "eslint-config-next": "14.2.5",
    "eslint-config-prettier": "9.1.0",
    "jsdom": "24.1.0",
    "postcss": "8.4.39",
    "prettier": "3.3.3",
    "tailwindcss": "3.4.6",
    "typescript": "5.5.3",
    "vitest": "1.6.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`** (Next.js 14 defaults + strict)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext", "webworker"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "_design-handoff"]
}
```

- [ ] **Step 3: Install**

Run: `npm install`
Expected: completes without peer-dep errors. `next-env.d.ts` is generated on first `next dev` or `next build`; you may pre-create it as empty if `tsc --noEmit` complains.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: PASS — no files to typecheck yet, exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore(scaffold): add package.json, tsconfig (strict)"
```

---

## Task 2: Minimal Next.js app — root layout via studio route group

**Files:**
- Create: `next.config.mjs`
- Create: `app/layout.tsx`
- Create: `app/(studio)/page.tsx`

> Route group `(studio)` in parentheses adds **no** URL segment — so `app/(studio)/page.tsx` serves at `/`. This is intentional: v0.1 has a single screen, and the group lets us add `app/(studio)/projects/page.tsx` later without touching imports. The studio layout (with Toaster) lands in Task 5.

- [ ] **Step 1: Write `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true
  }
};

export default nextConfig;
```

- [ ] **Step 2: Write `app/layout.tsx`** (root)

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VibeGrid',
  description: 'Music-animation studio'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
```

> `globals.css` is created in Task 3. The import is added here so the file exists by the time you build.

- [ ] **Step 3: Write the placeholder studio page**

`app/(studio)/page.tsx`:

```tsx
export default function StudioPage() {
  return (
    <main className="grid min-h-screen place-items-center">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">VibeGrid</h1>
        <p className="mt-2 opacity-60">Studio scaffold — modules land in Plan 1+.</p>
      </div>
    </main>
  );
}
```

> Tailwind classes will resolve correctly once Task 3 wires `globals.css`. The placeholder works without the design tokens; theming arrives in Task 3.

- [ ] **Step 4: Verify build does NOT yet succeed**

Run: `npm run build`
Expected: FAILS on missing `./globals.css`. That's correct — Task 3 fixes it.

- [ ] **Step 5: Commit**

```bash
git add next.config.mjs app/layout.tsx 'app/(studio)/page.tsx'
git commit -m "chore(scaffold): next.config + root layout + studio route group"
```

---

## Task 3: Tailwind + PostCSS + globals.css with PicTune design tokens

**Files:**
- Create: `tailwind.config.ts`
- Create: `postcss.config.mjs`
- Create: `app/globals.css`

- [ ] **Step 1: Write `tailwind.config.ts`** — tokens exposed as Tailwind colors

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-alt': 'var(--bg-alt)',
        'surface-1': 'var(--surface-1)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        'surface-4': 'var(--surface-4)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        text: 'var(--text)',
        'text-dim': 'var(--text-dim)',
        'text-muted': 'var(--text-muted)',
        'text-faint': 'var(--text-faint)',
        a1: 'var(--a1)',
        a2: 'var(--a2)',
        a3: 'var(--a3)'
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
};

export default config;
```

- [ ] **Step 2: Write `postcss.config.mjs`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
```

- [ ] **Step 3: Write `app/globals.css`** — base tokens copied verbatim from `_design-handoff/pictune/project/styles.css`; accent themes selectable via `data-accent` on `<html>` (Spec §9)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: #0c0d12;
  --bg-alt: #0f1118;
  --surface-1: #14161f;
  --surface-2: #1a1d2a;
  --surface-3: #232739;
  --surface-4: #2d3245;

  --border: rgba(255, 255, 255, 0.06);
  --border-strong: rgba(255, 255, 255, 0.12);

  --text: #e8eaf0;
  --text-dim: #aab0c4;
  --text-muted: #6b7088;
  --text-faint: #474b5d;
}

/* Default accent (electric) — overridden by data-accent attribute on <html> */
:root,
[data-accent='electric'] {
  --a1: #a86bff;
  --a2: #5a8fff;
  --a3: #2ee0d0;
}
[data-accent='sunset'] {
  --a1: #ff6b6b;
  --a2: #ff9f5a;
  --a3: #ffd06b;
}
[data-accent='acid'] {
  --a1: #b8ff5a;
  --a2: #5affb8;
  --a3: #5ab8ff;
}
[data-accent='neon'] {
  --a1: #ff5af0;
  --a2: #5af0ff;
  --a3: #f0ff5a;
}

html,
body {
  background-color: var(--bg);
  color: var(--text);
  font-family: var(--font-sans), system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 4: Verify build succeeds**

Run: `npm run build`
Expected: PASS — Next produces `.next/` output. The root page redirects to `/studio` which still 404s; that's expected until Task 5.

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts postcss.config.mjs app/globals.css
git commit -m "chore(scaffold): tailwind + PicTune design tokens in globals.css"
```

---

## Task 4: Fonts — Space Grotesk + JetBrains Mono via next/font

**Files:**
- Create: `app/fonts.ts`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Write `app/fonts.ts`**

```ts
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';

export const fontSans = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap'
});

export const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap'
});
```

- [ ] **Step 2: Modify `app/layout.tsx`** — wire font variables + default accent onto `<html>`

```tsx
import type { Metadata } from 'next';
import { fontSans, fontMono } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'VibeGrid',
  description: 'Music-animation studio'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${fontSans.variable} ${fontMono.variable}`}
      data-accent="electric"
    >
      <body>{children}</body>
    </html>
  );
}
```

> `data-accent` defaults to `electric` and is later swapped at runtime (Plan 5 UI). Setting it on `<html>` (not `<body>`) means SSR-rendered markup already carries the correct CSS selector — no flicker on hydration.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS. Next downloads and inlines the fonts at build time.

- [ ] **Step 4: Commit**

```bash
git add app/fonts.ts app/layout.tsx
git commit -m "chore(scaffold): wire Space Grotesk + JetBrains Mono via next/font"
```

---

## Task 5: Studio layout — Toaster + dark frame

**Files:**
- Create: `app/(studio)/layout.tsx`
- Modify: `app/(studio)/page.tsx` — re-style with design tokens now that they exist

- [ ] **Step 1: Write `app/(studio)/layout.tsx`** — Toaster + dark frame

```tsx
import { Toaster } from 'sonner';

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      {children}
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text)'
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Restyle the placeholder page with the design tokens**

`app/(studio)/page.tsx`:

```tsx
export default function StudioPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg text-text">
      <div className="text-center">
        <h1 className="font-sans text-2xl font-semibold">VibeGrid</h1>
        <p className="mt-2 text-text-dim">Studio scaffold — modules land in Plan 1+.</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run build && npm run dev`
Expected: build PASS; `http://localhost:3000` renders the placeholder with `--bg` background and Space Grotesk.

Stop the dev server (Ctrl+C) before continuing.

- [ ] **Step 4: Commit**

```bash
git add 'app/(studio)/layout.tsx' 'app/(studio)/page.tsx'
git commit -m "chore(scaffold): studio layout with Sonner Toaster"
```

---

## Task 6: `isClient()` SSR/Capacitor guard utility

**Files:**
- Create: `lib/utils/is-client.ts`
- Create: `tests/unit/utils/is-client.test.ts`

> Spec §3.2 requires `isClient()` in both `lib/audio/` and `lib/renderer/`. Defining it once in `lib/utils/` and re-exporting from each module keeps the rule DRY.

- [ ] **Step 1: Write the failing test**

`tests/unit/utils/is-client.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isClient } from '@/lib/utils/is-client';

describe('isClient', () => {
  it('returns true in jsdom environment (window is defined)', () => {
    expect(isClient()).toBe(true);
  });
});
```

> The test depends on Vitest, which is wired in Task 8. **Defer running this test until Step 4 of Task 8.** Write the file now so it's committed with the utility.

- [ ] **Step 2: Write the utility**

`lib/utils/is-client.ts`:

```ts
export function isClient(): boolean {
  return typeof window !== 'undefined';
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/utils/is-client.ts tests/unit/utils/is-client.test.ts
git commit -m "feat(utils): isClient() SSR/Capacitor guard + test"
```

---

## Task 7: Zustand store skeleton

**Files:**
- Create: `lib/store/index.ts`
- Create: `lib/store/types.ts`

> v0.1 stores combine timeline, audio-grid, media-refs, and UI tweaks. Plans 1, 2, and 5 fill in their slices; this task ships the skeleton plus the `persist` middleware with blob-exclusion rules already in place.

- [ ] **Step 1: Write `lib/store/types.ts`**

```ts
export interface UIState {
  zoom: number;
  inspectorOpen: boolean;
}

export interface AppState {
  ui: UIState;
  setZoom(zoom: number): void;
  setInspectorOpen(open: boolean): void;
}
```

> Timeline, audio-grid, and media-ref slices are appended to `AppState` in their respective plans. Keeping the type extensible (interface, not type alias) is intentional.

- [ ] **Step 2: Write `lib/store/index.ts`**

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppState } from './types';

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ui: { zoom: 1, inspectorOpen: true },
      setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
      setInspectorOpen: (open) => set((s) => ({ ui: { ...s.ui, inspectorOpen: open } }))
    }),
    {
      name: 'vibegrid-store',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Persist only serializable data slices — never actions, never blobs.
      // Later plans extend this object with timeline, audioGrid, mediaRefs.
      partialize: (state) => ({
        ui: state.ui
      })
    }
  )
);
```

> Actions (`setZoom`, `setInspectorOpen`, …) must **never** be in the `partialize` return — Zustand otherwise serializes the function references, producing console warnings and unreliable rehydration. Every plan that adds a slice must also add it here explicitly.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/store/index.ts lib/store/types.ts
git commit -m "feat(store): zustand skeleton with persist (blob exclusion in Plan 5)"
```

---

## Task 8: Vitest config + setup + smoke test

**Files:**
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `tests/unit/smoke.test.ts`

> Spec §11.1: `environment: 'jsdom'`, `resources: 'usable'`, `singleThread: true`. The last setting is required because jsdom + worker parallelism deadlocks Vitest on Node 20.

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { resources: 'usable' } },
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
    poolOptions: { threads: { singleThread: true } },
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**']
  }
});
```

- [ ] **Step 2: Write `vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Write the smoke test**

`tests/unit/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest smoke', () => {
  it('runs in jsdom and arithmetic still works', () => {
    expect(2 + 2).toBe(4);
    expect(typeof window).toBe('object');
  });
});
```

- [ ] **Step 4: Run all tests** (smoke + the `isClient` test from Task 6)

Run: `npm test`
Expected: 2 files, 2 tests, all PASS.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts vitest.setup.ts tests/unit/smoke.test.ts
git commit -m "test(infra): vitest config + jsdom setup + smoke test"
```

---

## Task 9: Playwright config (e2e infra ready, no tests yet)

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/.gitkeep`

> The first e2e test (`smoke.spec.ts`) ships in Plan 6 with the export pipeline. Right now we only confirm the runner installs and the config typechecks.

- [ ] **Step 1: Write `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
```

- [ ] **Step 2: Create the e2e directory placeholder**

```bash
mkdir -p tests/e2e
touch tests/e2e/.gitkeep
```

- [ ] **Step 3: Install Playwright browsers** (developer machine only — CI runs `npx playwright install --with-deps` in the workflow)

Run: `npx playwright install chromium`
Expected: downloads chromium build.

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e/.gitkeep
git commit -m "test(infra): playwright config (first e2e test in Plan 6)"
```

---

## Task 10: ESLint + Prettier

**Files:**
- Create: `.eslintrc.json`
- Create: `.prettierrc`
- Create: `.prettierignore`

- [ ] **Step 1: Write `.eslintrc.json`**

```json
{
  "extends": ["next/core-web-vitals", "prettier"],
  "rules": {
    "@next/next/no-html-link-for-pages": "off"
  }
}
```

- [ ] **Step 2: Write `.prettierrc`**

```json
{
  "singleQuote": true,
  "trailingComma": "none",
  "printWidth": 100,
  "semi": true,
  "arrowParens": "always"
}
```

- [ ] **Step 3: Write `.prettierignore`**

```
.next
node_modules
_design-handoff
coverage
*.lock
package-lock.json
```

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS — no warnings on the current scaffold.

- [ ] **Step 5: Run format check**

Run: `npx prettier --check .`
Expected: PASS. If it fails, run `npm run format` and re-commit.

- [ ] **Step 6: Commit**

```bash
git add .eslintrc.json .prettierrc .prettierignore
git commit -m "chore(scaffold): eslint (next/core-web-vitals) + prettier"
```

---

## Task 11: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

> Spec §11.8: typecheck + lint + test on every PR. E2E only on push to `main`.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test

  e2e:
    runs-on: ubuntu-latest
    needs: unit
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npm run test:e2e
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: typecheck + lint + test on PR; e2e on push to main"
```

---

## Task 12: KNOWN_LIMITATIONS.md stub

**Files:**
- Create: `KNOWN_LIMITATIONS.md`

> Spec §8.3 requires this file with realtime-export caveats and iOS WebM notes. Filled out fully in Plan 6 when the exporter ships; here we just create the file with the manual checklist anchor.

- [ ] **Step 1: Write `KNOWN_LIMITATIONS.md`**

```markdown
# Known Limitations — VibeGrid v0.1

This file is the canonical reference for v0.1 caveats. Each section is filled in by the plan that lands the corresponding feature.

## Export (Plan 6)

_To be filled in by Plan 6._

- WebM not natively playable in iOS Safari (relevant for v0.2 Capacitor build).
- Realtime export — user must not switch tabs (browsers throttle RAF in the background).
- Browser-specific codec support varies.

## Manual verification checklist (run before release)

_To be filled in incrementally. Source of truth: spec §11.7._

- [ ] Image upload → canvas shows image.
- [ ] Audio upload → waveform visible.
- [ ] "Detect BPM" → progress indicator, value applied.
- [ ] Play → all 4 FX fire visibly at least once.
- [ ] Inspector slider changes FX param live.
- [ ] Export starts, REC indicator visible.
- [ ] Exported WebM opens in VLC / Chrome.
- [ ] Retina display: canvas output sharp (DPR fix verified).
- [ ] Tab switch during recording: warning toast appears.
- [ ] Export filename has correct timestamp (no `undefined`).
- [ ] Memory not permanently elevated after export (object URL revoked).
```

- [ ] **Step 2: Commit**

```bash
git add KNOWN_LIMITATIONS.md
git commit -m "docs: stub KNOWN_LIMITATIONS.md (filled in by Plan 6)"
```

---

## Task 13: Final verification gate

**No new files. Run the full gate before declaring Plan 0 done.**

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Format check**

Run: `npx prettier --check .`
Expected: PASS.

- [ ] **Step 4: Tests**

Run: `npm test`
Expected: 2 test files (smoke, is-client), all green.

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: Next builds successfully. Output mentions `app/(studio)/page` as a static route.

- [ ] **Step 6: Manual smoke**

Run: `npm run dev`
Expected: `http://localhost:3000` renders the placeholder. Background `--bg` (#0c0d12), heading "VibeGrid" in Space Grotesk. Stop the server with Ctrl+C.

- [ ] **Step 7: Push & open PR for review**

```bash
git push -u origin main
```

> Subsequent plans should run on feature branches; Plan 0 lands on `main` because the spec already lives there and the scaffold has no functional risk.

---

## Done condition

All 13 tasks committed, all six verification steps green. The repo is now a clean Next.js 14 + Tailwind + Zustand + Vitest + Playwright + ESLint + CI shell with PicTune design tokens and the `isClient()` guard already in place. **Plan 1 (Timeline) can start.**
