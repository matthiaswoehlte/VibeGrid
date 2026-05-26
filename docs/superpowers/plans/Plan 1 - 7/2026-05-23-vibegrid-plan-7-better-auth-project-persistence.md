# VibeGrid Plan 7 — Better-Auth Login + VG_projects Save/Load

> **For agentic workers:** Plan execution policy (overrides skill defaults):
> direct-on-main, sequential, one commit per task, optional final review.
> NO subagent ceremony. CC #2 (tester instance) verifies live in parallel.

---

## Architect Review Round 1 — Fixes applied (2026-05-23)

| # | Original Issue | Fix |
|---|---|---|
| 🔴 1 | Middleware lädt `pg` über `auth.api.getSession` — bricht im Edge Runtime. `runtime: 'nodejs'` ist in Next.js 14 nur experimentell hinter `experimental.nodeMiddleware`. | **Task 4 umgestellt auf Lightweight Cookie-Check** (Architekt-Option A). Middleware liest nur die `vibegrid.session_token`-Cookie, kein `pg`-Import, läuft im Edge. Echte Session-Validierung passiert weiterhin in jeder API-Route mit `auth.api.getSession`. Trade-off (gültig gestaltete aber DB-seitig abgelaufene Cookie kann `/studio` erreichen, scheitert aber an jeder API-Action mit 401) ist akzeptabel für v0.1, dokumentiert in KNOWN_LIMITATIONS. |
| 🟡 2 | `updateProject` baut SQL via Template-Literal mit positions-abhängigen `$N` — schwer zu lesen, kombinierter Branch (`name + serialized`) ungetestet. | **Task 9 refaktorisiert** auf SET-Builder + Counter, kombinierter Branch eigener Test. |
| 🟡 3 | `ProjectListDrawer.del()` schluckt API-Fehler — Liste wird trotzdem lokal geleert, User sieht keinen Fehler. | **Task 13 ergänzt** um `.catch()` mit `toast.error` und early-return ohne Liste-Update. |
| 🟢 4 | `pg.test.ts` Cache-Bust via `?fresh=` ist Vitest-Resolver-abhängig und unreliable. | **Task 1 Test umgeschrieben** auf `vi.isolateModules` (Vitest-natives Modul-Reset). |

---

## Context

Baseline: HEAD post-5.8b (`247f9c1`+). **~684 Tests**, Store v6, typecheck/lint/build clean.

Plan 7 zieht Auth + Projekt-Persistierung von v0.2 in v0.1 vor (Spec §0 Z. 11, 594 markiert beide explizit als v0.2). Begründung: ohne Persistierung ist VibeGrid nicht produktnutzbar — User verlieren ihre Arbeit beim Reload.

### DB-Analyse (vor Plan-Schreiben durchgeführt)

Die Supabase-Instanz `your-supabase-ref` ist die die bestehende Supabase/Better-Auth-Instanz. Wichtige Findings:

1. **Auth-Stack ist Better-Auth, NICHT Supabase Auth.** Existierende Tabellen: `user`, `account`, `session`, `passkey`, `twoFactor`, `verification`, `invitation`, `organization`, `member` — exakt das Better-Auth-Schema mit `username`/`twoFactor`/`passkey`/`organization`-Plugins.
2. **`user.id` ist `text`** (CUID/Nano-ID), NICHT `uuid`. FKs auf User müssen `TEXT REFERENCES public."user"(id)` sein. Quoting: in PostgREST/SQL ist `user` ein reserved word → immer quoten als `"user"`.
3. **Service-Role-Key bekommt `permission denied for table "user"` und `account` über PostgREST** — Better-Auth-Tabellen sind hart geschützt gegen direkte REST-Reads. VibeGrid darf NIE direkt `"user"`/`account` über die REST-API lesen.
4. **Multi-Tenancy via `organization` + `member` + `session.activeOrganizationId`** — ignoriert in v0.1 (siehe Tenancy-Entscheidung unten).
5. **Bestehende Konvention `video_project`:** `userId TEXT FK → "user"(id)`, kein `organizationId`, keine sichtbaren RLS-Policies über PostgREST.
6. **`account.providerId`-Werte:** nicht über REST lesbar; per Konfigurations-Konvention enthält die Instanz `credential` (Email/Password) sowie OAuth-Provider. VibeGrid aktiviert in v0.1 NUR `emailAndPassword`.

---

## Goal

Zwei Features:

1. **Login** via Better-Auth (Email + Passwort) auf eigener Domain. Eigene Better-Auth-Cookie, separater Login-Flow gegen die gemeinsame `"user"`/`session`-Tabelle. Bestehende Credentials funktionieren.
2. **Save/Load von Projekten** in `VG_projects`. Server-side Authz in Next.js API-Routes mit Better-Auth-Session-Validierung. Client hat KEINEN Direkt-Zugriff auf die Supabase-REST-API.

## Out of Scope

- **Signup / Registrierung** — nur bestehende User können sich einloggen (v0.2: Signup-Flow).
- **OAuth-Provider** — `emailAndPassword: { enabled: true }` ist genug für v0.1. Spätere Provider werden in Better-Auth-Server-Config nachgezogen.
- **2FA, Passkeys** — Better-Auth-Plugins, in v0.1 nicht aktiviert. Falls ein User mit aktivem 2FA in der bestehenden Instanz sich in VibeGrid einloggt: Login schlägt fehl mit "2FA required" — Hinweis in KNOWN_LIMITATIONS.
- **Team-Sharing via Organization** — VG_projects ist strict user-scoped (kein `organization_id`). Team-Sichtbarkeit + Member-Sharing kommt v0.2.
- **Asset-Transfer zwischen Projekten / Projekt-Duplikation** — v0.2.
- **Offline-First / Konflikt-Resolution** — v0.2.
- **RLS via `auth.uid()`** — funktioniert nicht weil Better-Auth keine Supabase-JWTs ausgibt. Defense-in-depth via "REVOKE FROM anon, authenticated" + Service-Role-only-Access.
- **R2-Key-Migration von `anonymous`/`default` auf echte `userId`/`projectId`** — out of scope für Plan 7. Bestehende Uploads bleiben unter `anonymous/default/`; neue Uploads bleiben es auch bis ein separater Plan das auf `{userId}/{projectId}/` umstellt.

---

## Architecture insights

### 1. Better-Auth in VibeGrid (Same DB, neue Domain → eigene Cookie)

```ts
// lib/auth/better-auth-server.ts
import 'server-only';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: { enabled: true, autoSignIn: false },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  trustedOrigins: [process.env.NEXT_PUBLIC_BASE_URL!],
  advanced: {
    cookiePrefix: 'vibegrid' // separate Cookie-Namespace vom bestehendes Setup
  }
});
export type Session = typeof auth.$Infer.Session;
```

- Konfiguration aktiviert NUR `emailAndPassword`. Die Plugins, die die bestehende Instanz betreibt (`username`, `twoFactor`, `passkey`, `organization`), bleiben in VibeGrid AUS — VibeGrid liest aus den DB-Tabellen, die diese Plugins schreiben, aber führt selbst keine eigenen Schreibvorgänge mit den Plugin-Features durch.
- `cookiePrefix: 'vibegrid'` trennt die VibeGrid-Session-Cookie von einer (potenziell existierenden) Better-Auth-Cookie der anderen App. Damit kein Schaden entsteht, falls jemals beide Apps gleichzeitig dieselbe Domain bekommen sollten.
- `autoSignIn: false` — Better-Auth's Auto-Login nach Signup ist hier sinnlos (kein Signup-Flow).

### 2. Kein PostgREST für VG_projects — Direct-pg via Next.js API-Routes

PostgREST-Zugriff fällt aus zwei Gründen aus:

1. RLS via `auth.uid() = user_id` funktioniert nicht (Better-Auth ≠ Supabase Auth-JWT).
2. Service-Role-Key kann nicht client-side genutzt werden (Vollzugriff).

Konsequenz: **Alle VG_projects-Operationen laufen über Next.js API-Routes** mit:
- `pg.Pool` connection via `DATABASE_URL` (gleicher Connection-String wie Better-Auth).
- Auth-Check per `auth.api.getSession({ headers })` aus Better-Auth.
- Authz: explizit `WHERE user_id = $sessionUserId` in jeder SQL-Query — RLS ist Defense-in-Depth, NICHT Primary Authz.

### 3. Defense-in-Depth auf VG_projects-Schema

```sql
-- VG_projects ist NUR über service_role schreib-/lesbar (Next.js API-Route).
-- anon / authenticated rolle bekommen permission denied bei Direkt-REST-Zugriff.
GRANT ALL ON public."VG_projects" TO service_role;
REVOKE ALL ON public."VG_projects" FROM anon, authenticated;

-- RLS als zweite Schicht aktivieren (auch wenn service_role sie bypassed).
ALTER TABLE public."VG_projects" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "VG_policy_projects_deny_anon" ON public."VG_projects"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
```

Begründung: Falls jemals ein Anon-Key ins Client-Bundle leaked, ist die Tabelle nach wie vor unerreichbar. Service-Role-Key lebt ausschließlich server-side (process.env, nicht NEXT_PUBLIC_…).

### 4. State-Serialisierung & Migrations-Reuse

Der Zustand-Store hat bereits `partialize` (`lib/store/index.ts:137-162`) und `migrate` (`lib/store/index.ts:14-45`). Plan 7 extrahiert beide in ein eigenes Modul, damit der DB-Save-Pfad dieselbe Logik nutzt.

```ts
// lib/store/persist-shape.ts (NEU)
import type { AppState } from './types';

export interface PersistedShape {
  ui: { zoom: number };
  timeline: AppState['timeline'];
  audio: AppState['audio'];
  media: { mediaRefs: AppState['media']['mediaRefs'] };
}

export const STORE_VERSION = 6 as const;

export function toPersistedShape(state: AppState): PersistedShape {
  return {
    ui: { zoom: state.ui.zoom },
    timeline: { ...state.timeline, playhead: { ...state.timeline.playhead, playing: false } },
    audio: state.audio,
    media: { mediaRefs: state.media.mediaRefs }
  };
}
```

```ts
// lib/project/serialize.ts (NEU)
import { toPersistedShape, STORE_VERSION } from '@/lib/store/persist-shape';
import type { AppState } from '@/lib/store/types';

export interface SerializedProject {
  store_version: number;
  state: ReturnType<typeof toPersistedShape>;
}

export function serializeProject(state: AppState): SerializedProject {
  return { store_version: STORE_VERSION, state: toPersistedShape(state) };
}
```

```ts
// lib/project/deserialize.ts (NEU)
import { migrate } from '@/lib/store/index';
import { useAppStore } from '@/lib/store';

export function applySerializedProject(serialized: SerializedProject): void {
  const migrated = migrate(serialized.state, serialized.store_version) as Partial<AppState>;
  useAppStore.setState((current) => ({
    ...current,
    ui: { ...current.ui, ...(migrated.ui ?? {}) },
    timeline: { ...current.timeline, ...(migrated.timeline ?? {}) },
    audio: { ...current.audio, ...(migrated.audio ?? {}) },
    media: { ...current.media, ...(migrated.media ?? {}) }
  }));
}
```

Begründung: `migrate` ist seit Plan 5.9c bereits exported und idempotent. Wir nutzen ihn 1:1.

### 5. Auto-Save — debounced, nur für gespeicherte Projekte

```ts
// lib/hooks/useAutoSave.ts
// Watches store changes via useAppStore.subscribe(); only fires if a
// projectId is set (= the project was explicitly saved at least once).
// Debounce 30 s. Cancellation on unmount.
```

Neue/ungespeicherte Projekte triggern KEINEN Auto-Save — nur explizites `Save As`. Damit kein versehentlicher "ghost project" entsteht beim Experimentieren.

### 6. Logout & Session-Expiry

- Logout-Button in TopBar → ruft `authClient.signOut()` → Cookie wird gelöscht → Redirect auf `/login`.
- Session-Expiry: Middleware sieht abgelaufene Cookie → Redirect auf `/login?expired=1` mit Toast.

### 7. Datenmodell — vollständige SQL-Migration

```sql
-- db/migrations/001_VG_projects.sql
CREATE TABLE IF NOT EXISTS public."VG_projects" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'Untitled Project',
  store_version INTEGER NOT NULL,
  state         JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_idx_projects_user_id_updated_at"
  ON public."VG_projects"(user_id, updated_at DESC);

ALTER TABLE public."VG_projects" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "VG_policy_projects_deny_anon" ON public."VG_projects"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

GRANT ALL ON public."VG_projects" TO service_role;
REVOKE ALL ON public."VG_projects" FROM anon, authenticated;

-- updated_at automatic refresh.
CREATE OR REPLACE FUNCTION public."VG_fn_touch_updated_at"()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER "VG_trigger_projects_touch_updated_at"
  BEFORE UPDATE ON public."VG_projects"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();
```

Naming follows the architect's `VG_` prefix convention: Tabelle, Index, Function, Trigger, Policy.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `package.json` | modify | Add deps: `better-auth`, `pg`, `@types/pg` |
| `.env.local` | already prepared | `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `.env.example` | modify | Add `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_BASE_URL` |
| `lib/db/pg.ts` | **CREATE** | Singleton `Pool` for server-side DB |
| `lib/auth/better-auth-server.ts` | **CREATE** | `betterAuth()` instance + `Session` type |
| `lib/auth/better-auth-client.ts` | **CREATE** | `createAuthClient()` + `useSession` |
| `app/api/auth/[...all]/route.ts` | **CREATE** | Better-Auth Next.js handler |
| `middleware.ts` | **CREATE** | Session guard: `/studio*` ohne Session → `/login` |
| `app/(auth)/layout.tsx` | **CREATE** | Auth-Screen-Shell (dark mode, centered) |
| `app/(auth)/login/page.tsx` | **CREATE** | Email/password form |
| `lib/store/persist-shape.ts` | **CREATE** | Extract `toPersistedShape` + `STORE_VERSION` |
| `lib/store/index.ts` | modify | Use `toPersistedShape` in `partialize` (DRY) |
| `lib/project/types.ts` | **CREATE** | `ProjectRecord`, `SerializedProject` |
| `lib/project/serialize.ts` | **CREATE** | `serializeProject(state)` |
| `lib/project/deserialize.ts` | **CREATE** | `applySerializedProject(serialized)` |
| `lib/project/db.ts` | **CREATE** | server-only CRUD via pg |
| `lib/project/api-client.ts` | **CREATE** | Client-side fetch wrapper |
| `lib/hooks/useAutoSave.ts` | **CREATE** | Debounced auto-save (30 s) |
| `lib/hooks/useCurrentProject.ts` | **CREATE** | Project-id state + name |
| `app/api/projects/route.ts` | **CREATE** | `POST` = create, `GET` = list |
| `app/api/projects/[id]/route.ts` | **CREATE** | `GET`/`PATCH`/`DELETE` |
| `components/Studio/ProjectListDrawer.tsx` | **CREATE** | Modal mit Project-Liste |
| `components/TopBar/LogoutButton.tsx` | **CREATE** | Logout-Action |
| `components/TopBar/SaveProjectButton.tsx` | **CREATE** | Save / Save As |
| `components/TopBar/ProjectNameField.tsx` | **CREATE** | Editable name |
| `components/TopBar/index.tsx` | modify | Mount Logout + SaveProject + ProjectName |
| `db/migrations/001_VG_projects.sql` | **CREATE** | Tabelle + RLS + Trigger |
| `scripts/apply-migration.mjs` | **CREATE** | Node-Script läuft .sql via pg gegen `DATABASE_URL` |
| `docs/KNOWN_LIMITATIONS.md` | modify | Plan 7 Eintrag |
| `tests/unit/project/serialize.test.ts` | **CREATE** | ≥ 3 |
| `tests/unit/project/deserialize.test.ts` | **CREATE** | ≥ 3 |
| `tests/unit/hooks/useAutoSave.test.tsx` | **CREATE** | ≥ 3 |
| `tests/integration/api/projects.test.ts` | **CREATE** | ≥ 3 (mocked pg + mocked session) |
| `tests/integration/middleware-session.test.ts` | **CREATE** | ≥ 2 |

Total Tests: **≥ 14 neu** (Ziel laut Prompt: ≥ 10).

---

## Tasks

### Task 0 — Baseline check + dependency-add

**Files:** `package.json`

- [ ] **Step 1: Baseline-Check**

```powershell
git status   # nur ignorierbare untracked files
npm test -- --run   # ~684 passing
npm run typecheck && npm run lint && npm run build
```

Expected: alles grün, ~684 Tests passing.

- [ ] **Step 2: Dependencies installieren**

```powershell
npm install better-auth pg
npm install -D @types/pg
```

- [ ] **Step 3: Verify install**

```powershell
node -e "console.log(require('better-auth/package.json').version, require('pg/package.json').version)"
```

Expected: zwei Versionsnummern, kein Error.

- [ ] **Step 4: Commit**

```powershell
git add package.json package-lock.json
git commit -m "chore(deps): add better-auth + pg for Plan 7 auth/persistence"
```

---

### Task 1 — `lib/db/pg.ts` (singleton Pool)

**Files:** Create `lib/db/pg.ts`

- [ ] **Step 1: Write test first**

```ts
// tests/unit/db/pg.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('pg pool module', () => {
  it('exports a singleton — repeated imports return the same Pool instance', async () => {
    const a = (await import('@/lib/db/pg')).pool;
    const b = (await import('@/lib/db/pg')).pool;
    expect(a).toBe(b);
  });

  it('throws if DATABASE_URL is missing', async () => {
    const orig = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    // vi.isolateModules forces a fresh evaluation — the module-level
    // env check runs again instead of returning the cached export.
    await expect(
      vi.isolateModulesAsync(async () => {
        await import('@/lib/db/pg');
      })
    ).rejects.toThrow(/DATABASE_URL/);
    process.env.DATABASE_URL = orig;
  });
});
```

Note: `vi.isolateModulesAsync` is the right API for an async dynamic import inside the isolation boundary. If your Vitest version (1.6.x) only ships sync `vi.isolateModules`, wrap the import in `await Promise.resolve().then(() => import(...))` inside the sync callback or upgrade. The Plan-7 baseline runs Vitest 1.6.1 — `isolateModulesAsync` was added in 1.5; should be fine.

- [ ] **Step 2: Run test → expect FAIL** (`lib/db/pg.ts` doesn't exist).

```powershell
npm test -- --run tests/unit/db/pg.test.ts
```

- [ ] **Step 3: Implement**

```ts
// lib/db/pg.ts
import 'server-only';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — required for VG_projects persistence');
}

export const pool: Pool = (globalThis as { __vgPgPool?: Pool }).__vgPgPool ??= new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,                            // hobby tier: keep low
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});
```

Notes: `server-only` schützt vor versehentlichem Client-Bundle. `globalThis`-Singleton überlebt Next.js Dev-Hot-Reload (HMR re-evaluiert das Modul, sonst doppelte Pools).

- [ ] **Step 4: Run test → PASS**.
- [ ] **Step 5: Commit**

```powershell
git add lib/db/pg.ts tests/unit/db/pg.test.ts
git commit -m "feat(db): pg pool singleton via DATABASE_URL"
```

---

### Task 2 — Better-Auth Server-Instance

**Files:** Create `lib/auth/better-auth-server.ts`

- [ ] **Step 1: Test first**

```ts
// tests/unit/auth/server.test.ts
import { describe, it, expect } from 'vitest';

describe('better-auth server', () => {
  it('exports an `auth` instance with handler() callable', async () => {
    const { auth } = await import('@/lib/auth/better-auth-server');
    expect(typeof auth.handler).toBe('function');
  });

  it('emailAndPassword is enabled (no other providers in v0.1)', async () => {
    const { auth } = await import('@/lib/auth/better-auth-server');
    // Better-Auth doesn't expose its config object, but the routes
    // reflect enabled providers. `/sign-in/email` should exist.
    const req = new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: '', password: '' })
    });
    const res = await auth.handler(req);
    // Empty body → 400 from the route, NOT 404. Confirms route is mounted.
    expect(res.status).not.toBe(404);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement**

```ts
// lib/auth/better-auth-server.ts
import 'server-only';
import { betterAuth } from 'better-auth';
import { pool } from '@/lib/db/pg';

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET is not set');
}
if (!process.env.NEXT_PUBLIC_BASE_URL) {
  throw new Error('NEXT_PUBLIC_BASE_URL is not set');
}

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NEXT_PUBLIC_BASE_URL,
  emailAndPassword: { enabled: true, autoSignIn: false },
  session: {
    expiresIn: 60 * 60 * 24 * 7,   // 7 days
    updateAge: 60 * 60 * 24         // refresh once a day
  },
  trustedOrigins: [process.env.NEXT_PUBLIC_BASE_URL],
  advanced: {
    cookiePrefix: 'vibegrid',
    useSecureCookies: process.env.NODE_ENV === 'production'
  }
});

export type Session = typeof auth.$Infer.Session;
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```powershell
git add lib/auth/better-auth-server.ts tests/unit/auth/server.test.ts
git commit -m "feat(auth): better-auth server instance — emailAndPassword only"
```

---

### Task 3 — Better-Auth Client + Next.js API handler

**Files:** Create `lib/auth/better-auth-client.ts`, `app/api/auth/[...all]/route.ts`

- [ ] **Step 1: Implement client**

```ts
// lib/auth/better-auth-client.ts
'use client';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BASE_URL!
});

export const { useSession, signIn, signOut } = authClient;
```

- [ ] **Step 2: Implement Next.js handler**

```ts
// app/api/auth/[...all]/route.ts
import { auth } from '@/lib/auth/better-auth-server';
import { toNextJsHandler } from 'better-auth/next-js';

export const { POST, GET } = toNextJsHandler(auth);
```

- [ ] **Step 3: Verify**

```powershell
npm run dev   # in another shell
curl -i http://localhost:3000/api/auth/get-session
# Expected: 200 OK with { "data": null, "error": null } (no session yet)
```

- [ ] **Step 4: Commit**

```powershell
git add lib/auth/better-auth-client.ts app/api/auth/
git commit -m "feat(auth): better-auth react client + Next.js [...all] handler"
```

---

### Task 4 — Session-Guard Middleware (Edge-compatible cookie check)

**Files:** Create `middleware.ts`

**Design (post Architect Review):** Next.js 14 Middleware läuft im Edge Runtime. `pg.Pool` ist Edge-inkompatibel (braucht `net`/`tls`). Statt `auth.api.getSession` (was indirekt `pg` lädt) prüft die Middleware nur die **Anwesenheit** der Better-Auth-Session-Cookie. Die echte DB-Validierung passiert ohnehin in jeder API-Route. Konsequenz: eine syntaktisch valide aber DB-seitig abgelaufene Cookie kann `/studio` rendern lassen, scheitert dann aber an jedem API-Call mit 401. Studio-Client behandelt 401 als "Session expired" → Redirect auf `/login`. Dokumentiert in KNOWN_LIMITATIONS.

- [ ] **Step 1: Test first**

```ts
// tests/integration/middleware-session.test.ts
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function nextReq(path: string, cookies?: Record<string, string>) {
  const req = new NextRequest(`http://localhost:3000${path}`);
  if (cookies) {
    for (const [k, v] of Object.entries(cookies)) {
      req.cookies.set(k, v);
    }
  }
  return req;
}

describe('middleware cookie guard (Edge-compatible)', () => {
  it('redirects /studio to /login when no session cookie present', async () => {
    const res = await middleware(nextReq('/studio'));
    expect(res?.status).toBe(307);
    const loc = res!.headers.get('location') ?? '';
    expect(loc).toContain('/login');
    expect(loc).toContain('from=%2Fstudio');
  });

  it('passes through /studio when vibegrid.session_token cookie present', async () => {
    const res = await middleware(
      nextReq('/studio', { 'vibegrid.session_token': 'cookie-value-not-validated-here' })
    );
    // NextResponse.next() returns a response with no redirect.
    expect(res?.headers.get('location')).toBeNull();
  });

  it('accepts the chunked-cookie variant (Better-Auth splits large cookies)', async () => {
    const res = await middleware(
      nextReq('/studio', { 'vibegrid.session_token.0': 'chunk-0' })
    );
    expect(res?.headers.get('location')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test → FAIL** (no middleware.ts).

- [ ] **Step 3: Implement**

```ts
// middleware.ts (project root, not under app/)
import { NextResponse, type NextRequest } from 'next/server';

// Better-Auth stores its session in a cookie prefixed by the configured
// `cookiePrefix` (we set 'vibegrid' in lib/auth/better-auth-server.ts).
// Large cookies are split into `.0`, `.1`, ... chunks — we accept either
// the base name or the first chunk as a "session present" signal.
//
// This is a CHEAP check — it verifies cookie presence only, not validity.
// Server-side authority over the session lives in each API route via
// `auth.api.getSession({ headers })`. A client holding a tampered or
// DB-expired cookie can render the /studio shell but every data action
// returns 401, which the Studio client surfaces as a session-expired
// toast + redirect to /login.

export function middleware(req: NextRequest) {
  const hasCookie =
    req.cookies.has('vibegrid.session_token') ||
    req.cookies.has('vibegrid.session_token.0');

  if (!hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('from', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Edge-runtime by default — that's now correct because we no longer
  // import `pg` / `better-auth/server` here.
  matcher: ['/studio/:path*']
};
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Verify Edge-compatibility — `npm run build` must succeed**

```powershell
npm run build
```

Expected: Next.js build prints `Middleware (edge)` for the route group, no `net`/`tls` errors. Bundle is tiny (~kB), no `pg` in middleware chunk.

- [ ] **Step 6: Add client-side 401 handling**

Update `lib/project/api-client.ts` (Task 11) to redirect to `/login?expired=1` on 401 responses. This is the second-tier guard for cookies that pass the cheap check but fail server validation. (Note in Task 11: ensure `json<T>` checks `res.status === 401` and triggers `window.location.assign('/login?expired=1')` before throwing.)

- [ ] **Step 7: Commit**

```powershell
git add middleware.ts tests/integration/middleware-session.test.ts
git commit -m "feat(auth): edge-compatible middleware cookie guard for /studio"
```

---

### Task 5 — Login-Screen

**Files:** Create `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`

- [ ] **Step 1: Implement layout**

```tsx
// app/(auth)/layout.tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-6">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement login page**

```tsx
// app/(auth)/login/page.tsx
'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/auth/better-auth-client';
import { toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await signIn.email({ email, password });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message ?? 'Login fehlgeschlagen');
      return;
    }
    const target = search.get('from') ?? '/studio';
    router.push(target);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-xl font-bold text-[var(--text)]">VibeGrid Login</h1>
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">Email</span>
        <input
          type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
        />
      </label>
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">Password</span>
        <input
          type="password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
        />
      </label>
      <button
        type="submit" disabled={busy}
        className="w-full bg-[var(--a1)] text-white py-2 rounded disabled:opacity-50"
      >
        {busy ? '...' : 'Sign In'}
      </button>
      <p className="text-[11px] text-[var(--text-muted)] text-center">
        Bestehende Accounts. Kein Signup in v0.1.
      </p>
    </form>
  );
}
```

- [ ] **Step 3: Manual smoke (CC #2 verifiziert)**

```powershell
npm run dev
# Browser → http://localhost:3000/studio → redirect /login?from=/studio
# Enter known credentials → /studio öffnet sich
# Wrong password → Toast "Invalid credentials"
```

- [ ] **Step 4: Commit**

```powershell
git add app/\(auth\)
git commit -m "feat(auth): login page — email/password + redirect-back"
```

---

### Task 6 — SQL migration + apply-script

**Files:** Create `db/migrations/001_VG_projects.sql`, `scripts/apply-migration.mjs`

- [ ] **Step 1: Write SQL** (siehe "7. Datenmodell" oben — übernehmen 1:1).

- [ ] **Step 2: Write apply-script**

```js
// scripts/apply-migration.mjs
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-migration.mjs <path-to-sql>');
  process.exit(1);
}

const sql = await readFile(file, 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(sql);
  console.log('OK — applied', file);
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(2);
} finally {
  await pool.end();
}
```

Note: needs `dotenv` to read `.env.local`. Add as dev-dep:

```powershell
npm install -D dotenv
```

- [ ] **Step 3: Apply**

```powershell
node -r dotenv/config scripts/apply-migration.mjs db/migrations/001_VG_projects.sql dotenv_config_path=.env.local
```

Expected: `OK — applied db/migrations/001_VG_projects.sql`.

- [ ] **Step 4: Verify via PostgREST** (sollte 401/403 zurückgeben für anon):

```powershell
curl -i -H "apikey: $env:NEXT_PUBLIC_SUPABASE_ANON_KEY" "$env:NEXT_PUBLIC_SUPABASE_URL/rest/v1/VG_projects?select=id&limit=1"
```

Expected: `{"code":"42501","message":"permission denied for table VG_projects"}` — Defense-in-Depth funktioniert.

- [ ] **Step 5: Commit**

```powershell
git add db/migrations/001_VG_projects.sql scripts/apply-migration.mjs package.json package-lock.json
git commit -m "feat(db): VG_projects schema — table + RLS lockdown + updated_at trigger"
```

---

### Task 7 — Store-Shape extrahieren (DRY-Refactor)

**Files:** Create `lib/store/persist-shape.ts`, modify `lib/store/index.ts`

- [ ] **Step 1: Test first**

```ts
// tests/unit/store/persist-shape.test.ts
import { describe, it, expect } from 'vitest';
import { toPersistedShape, STORE_VERSION } from '@/lib/store/persist-shape';

describe('toPersistedShape', () => {
  it('forces playhead.playing to false (snapshot reload safety)', () => {
    const state = {
      ui: { zoom: 1, selectedClipId: 'x', automationEditorClipId: null, automationSnap: 'off', exportState: {}, flowMode: false },
      timeline: { tracks: [], clips: [], playhead: { beats: 12, playing: true }, zoom: 1, snap: 'beat' },
      audio: { grid: { bpm: 120, offsetMs: 0, source: 'detected' } },
      media: { mediaRefs: [], videoLoadProgress: { v1: { received: 1, total: 2 } } }
    } as never;
    const out = toPersistedShape(state);
    expect(out.timeline.playhead.playing).toBe(false);
  });

  it('drops transient ui fields (only zoom kept)', () => {
    const state = { ui: { zoom: 1.5, selectedClipId: 'x' }, timeline: { playhead: {} }, audio: {}, media: { mediaRefs: [] } } as never;
    expect(toPersistedShape(state).ui).toEqual({ zoom: 1.5 });
  });

  it('drops media.videoLoadProgress (transient)', () => {
    const state = { ui: { zoom: 1 }, timeline: { playhead: {} }, audio: {}, media: { mediaRefs: [{ id: 'a' }], videoLoadProgress: { a: { received: 1, total: 2 } } } } as never;
    const out = toPersistedShape(state);
    expect(out.media).toEqual({ mediaRefs: [{ id: 'a' }] });
  });

  it('STORE_VERSION matches lib/store/index.ts persist `version`', async () => {
    // Static guarantee: bumping the store version must bump persist-shape too.
    expect(STORE_VERSION).toBe(6);
  });
});
```

- [ ] **Step 2: Implement persist-shape.ts** (siehe Code in Architecture-Section 4).

- [ ] **Step 3: Refactor index.ts**

In `lib/store/index.ts`, ersetze die inline `partialize`-Logik durch:

```ts
import { toPersistedShape, STORE_VERSION } from './persist-shape';

// ...
{
  name: 'vibegrid-store',
  version: STORE_VERSION,
  // ...
  partialize: (state) => toPersistedShape(state)
}
```

- [ ] **Step 4: Run all tests — must still pass (regression check)**

```powershell
npm test -- --run
```

Expected: ~684 + 4 neue = ~688 passing.

- [ ] **Step 5: Commit**

```powershell
git add lib/store/persist-shape.ts lib/store/index.ts tests/unit/store/persist-shape.test.ts
git commit -m "refactor(store): extract toPersistedShape + STORE_VERSION (DRY for Plan 7)"
```

---

### Task 8 — Project types + serialize/deserialize

**Files:** Create `lib/project/types.ts`, `lib/project/serialize.ts`, `lib/project/deserialize.ts`

- [ ] **Step 1: Tests first**

```ts
// tests/unit/project/serialize.test.ts
import { describe, it, expect } from 'vitest';
import { serializeProject } from '@/lib/project/serialize';

describe('serializeProject', () => {
  it('returns store_version + state', () => {
    const out = serializeProject({
      ui: { zoom: 1, selectedClipId: null, automationEditorClipId: null, automationSnap: 'off', exportState: {}, flowMode: false },
      timeline: { tracks: [], clips: [], playhead: { beats: 0, playing: false }, zoom: 1, snap: 'beat' },
      audio: { grid: { bpm: 120, offsetMs: 0, source: 'manual' } },
      media: { mediaRefs: [], videoLoadProgress: {} }
    } as never);
    expect(out.store_version).toBe(6);
    expect(out.state.timeline).toBeDefined();
  });

  it('serialized payload is JSON-safe (no functions, no symbols)', () => {
    const out = serializeProject({
      ui: { zoom: 2 }, timeline: { playhead: {} }, audio: {}, media: { mediaRefs: [] }
    } as never);
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
  });

  it('serialized media excludes blob URLs — only canonical R2 URLs survive', () => {
    const out = serializeProject({
      ui: {}, timeline: { playhead: {} }, audio: {},
      media: { mediaRefs: [{ id: 'a', url: 'https://r2.example/x.png', kind: 'image' }] }
    } as never);
    expect(out.state.media.mediaRefs[0]?.url.startsWith('https://')).toBe(true);
  });
});
```

```ts
// tests/unit/project/deserialize.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { applySerializedProject } from '@/lib/project/deserialize';

beforeEach(() => {
  useAppStore.setState(useAppStore.getState());
});

describe('applySerializedProject', () => {
  it('hydrates timeline from a fresh v6 payload', () => {
    applySerializedProject({
      store_version: 6,
      state: {
        ui: { zoom: 1.25 },
        timeline: { tracks: [], clips: [{ id: 'c1', trackId: 't1', kind: 'pulse', fxId: 'pulse', startBeat: 0, lengthBeats: 4, label: 'P' }], playhead: { beats: 0, playing: false }, zoom: 1, snap: 'beat' },
        audio: { grid: { bpm: 124, offsetMs: 0, source: 'detected' } },
        media: { mediaRefs: [] }
      }
    });
    expect(useAppStore.getState().timeline.clips).toHaveLength(1);
    expect(useAppStore.getState().ui.zoom).toBe(1.25);
  });

  it('runs `migrate` for older store_versions (v4 snapshot upgrades to v6)', () => {
    applySerializedProject({
      store_version: 4,
      state: {
        ui: { zoom: 1 },
        timeline: { tracks: [{ id: 't1', kind: 'contour', name: 'C', muted: false }], clips: [], playhead: { beats: 0, playing: false }, zoom: 1, snap: 'beat' },
        audio: { grid: { bpm: 120, offsetMs: 0, source: 'manual' } },
        media: { mediaRefs: [] }
      }
    } as never);
    // v5→v6 migration must collapse `contour` track kind to `fx`.
    expect(useAppStore.getState().timeline.tracks[0]?.kind).toBe('fx');
  });

  it('preserves current ui transient fields not in payload', () => {
    useAppStore.setState((s) => ({ ui: { ...s.ui, flowMode: true } }));
    applySerializedProject({
      store_version: 6,
      state: { ui: { zoom: 2 }, timeline: { tracks: [], clips: [], playhead: { beats: 0, playing: false }, zoom: 1, snap: 'beat' }, audio: { grid: { bpm: 120, offsetMs: 0, source: 'manual' } }, media: { mediaRefs: [] } }
    });
    expect(useAppStore.getState().ui.flowMode).toBe(true); // transient survived
    expect(useAppStore.getState().ui.zoom).toBe(2);        // persisted applied
  });
});
```

- [ ] **Step 2: Run tests → FAIL** (modules don't exist).

- [ ] **Step 3: Implement** (siehe Architecture-Section 4).

```ts
// lib/project/types.ts
import type { PersistedShape } from '@/lib/store/persist-shape';

export interface SerializedProject {
  store_version: number;
  state: PersistedShape;
}

export interface ProjectRecord {
  id: string;
  user_id: string;
  name: string;
  store_version: number;
  state: PersistedShape;
  created_at: string;
  updated_at: string;
}
```

```ts
// lib/project/serialize.ts
import { toPersistedShape, STORE_VERSION } from '@/lib/store/persist-shape';
import type { AppState } from '@/lib/store/types';
import type { SerializedProject } from './types';

export function serializeProject(state: AppState): SerializedProject {
  return { store_version: STORE_VERSION, state: toPersistedShape(state) };
}
```

```ts
// lib/project/deserialize.ts
import { migrate, useAppStore } from '@/lib/store';
import type { AppState } from '@/lib/store/types';
import type { SerializedProject } from './types';

export function applySerializedProject(serialized: SerializedProject): void {
  const migrated = (migrate(serialized.state, serialized.store_version) ?? serialized.state) as Partial<AppState>;
  useAppStore.setState((current) => ({
    ...current,
    ui: { ...current.ui, ...(migrated.ui ?? {}) },
    timeline: { ...current.timeline, ...(migrated.timeline ?? {}) },
    audio: { ...current.audio, ...(migrated.audio ?? {}) },
    media: { ...current.media, ...(migrated.media ?? {}) }
  }));
}
```

- [ ] **Step 4: Run tests → PASS**

- [ ] **Step 5: Commit**

```powershell
git add lib/project/types.ts lib/project/serialize.ts lib/project/deserialize.ts tests/unit/project/
git commit -m "feat(project): serialize/deserialize + migrate-on-load reuse"
```

---

### Task 9 — Server-side DB-CRUD (`lib/project/db.ts`)

**Files:** Create `lib/project/db.ts`

- [ ] **Step 1: Tests first** (mock pg)

```ts
// tests/unit/project/db.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db/pg', () => ({ pool: { query: queryMock } }));

import { createProject, listProjects, loadProject, updateProject, deleteProject } from '@/lib/project/db';

beforeEach(() => queryMock.mockReset());

describe('project db CRUD', () => {
  it('createProject inserts with user_id + name + state + version, returns id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'p-1' }] });
    const id = await createProject({
      userId: 'u-1', name: 'X', serialized: { store_version: 6, state: { ui: {}, timeline: {}, audio: {}, media: {} } as never }
    });
    expect(id).toBe('p-1');
    expect(queryMock.mock.calls[0][0]).toMatch(/INSERT INTO "VG_projects"/);
    expect(queryMock.mock.calls[0][1]).toEqual(['u-1', 'X', 6, expect.any(Object)]);
  });

  it('loadProject filters by user_id (no cross-user reads)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'p-1', user_id: 'u-1', name: 'X', store_version: 6, state: {}, created_at: 't', updated_at: 't' }] });
    await loadProject({ userId: 'u-1', projectId: 'p-1' });
    expect(queryMock.mock.calls[0][1]).toEqual(['p-1', 'u-1']);
  });

  it('loadProject returns null when user-id mismatch (defense in depth)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await loadProject({ userId: 'u-1', projectId: 'p-foreign' });
    expect(res).toBeNull();
  });

  it('updateProject — name-only branch builds correct SQL', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await updateProject({ userId: 'u-1', projectId: 'p-1', patch: { name: 'New' } });
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/SET name = \$1 WHERE id = \$2 AND user_id = \$3/);
    expect(vals).toEqual(['New', 'p-1', 'u-1']);
  });

  it('updateProject — serialized-only branch builds correct SQL', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await updateProject({
      userId: 'u-1', projectId: 'p-1',
      patch: { serialized: { store_version: 6, state: { ui: {}, timeline: {}, audio: {}, media: {} } as never } }
    });
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/SET state = \$1, store_version = \$2 WHERE id = \$3 AND user_id = \$4/);
    expect(vals).toEqual([{ ui: {}, timeline: {}, audio: {}, media: {} }, 6, 'p-1', 'u-1']);
  });

  it('updateProject — combined branch (name + serialized) builds correct SQL', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await updateProject({
      userId: 'u-1', projectId: 'p-1',
      patch: { name: 'New', serialized: { store_version: 6, state: { ui: {}, timeline: {}, audio: {}, media: {} } as never } }
    });
    const [sql, vals] = queryMock.mock.calls[0]!;
    // Order: serialized fields first (set up by patch.serialized branch), then name.
    expect(sql).toMatch(/SET state = \$1, store_version = \$2, name = \$3 WHERE id = \$4 AND user_id = \$5/);
    expect(vals).toEqual([{ ui: {}, timeline: {}, audio: {}, media: {} }, 6, 'New', 'p-1', 'u-1']);
  });

  it('updateProject — empty patch is a no-op, returns false', async () => {
    const ok = await updateProject({ userId: 'u-1', projectId: 'p-1', patch: {} });
    expect(ok).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// lib/project/db.ts
import 'server-only';
import { pool } from '@/lib/db/pg';
import type { SerializedProject, ProjectRecord } from './types';

export async function createProject(args: {
  userId: string;
  name: string;
  serialized: SerializedProject;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO "VG_projects" (user_id, name, store_version, state)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [args.userId, args.name, args.serialized.store_version, args.serialized.state]
  );
  return rows[0]!.id;
}

export async function listProjects(userId: string): Promise<Array<Pick<ProjectRecord, 'id' | 'name' | 'updated_at'>>> {
  const { rows } = await pool.query(
    `SELECT id, name, updated_at FROM "VG_projects"
     WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
}

export async function loadProject(args: { userId: string; projectId: string }): Promise<ProjectRecord | null> {
  const { rows } = await pool.query<ProjectRecord>(
    `SELECT id, user_id, name, store_version, state, created_at, updated_at
     FROM "VG_projects" WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [args.projectId, args.userId]
  );
  return rows[0] ?? null;
}

export async function updateProject(args: {
  userId: string;
  projectId: string;
  patch: { name?: string; serialized?: SerializedProject };
}): Promise<boolean> {
  // SET-Builder pattern — eindeutig, einheitlich, leicht zu reviewen.
  // Reihenfolge: serialized-Felder zuerst, dann name. Tests pinnen die
  // Reihenfolge an, damit künftige Refactorings nicht still scheitern.
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;

  if (args.patch.serialized !== undefined) {
    sets.push(`state = $${n++}`);
    vals.push(args.patch.serialized.state);
    sets.push(`store_version = $${n++}`);
    vals.push(args.patch.serialized.store_version);
  }
  if (args.patch.name !== undefined) {
    sets.push(`name = $${n++}`);
    vals.push(args.patch.name);
  }
  if (sets.length === 0) return false; // empty-patch no-op

  vals.push(args.projectId, args.userId);
  const { rowCount } = await pool.query(
    `UPDATE "VG_projects" SET ${sets.join(', ')} WHERE id = $${n++} AND user_id = $${n}`,
    vals
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteProject(args: { userId: string; projectId: string }): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM "VG_projects" WHERE id = $1 AND user_id = $2`,
    [args.projectId, args.userId]
  );
  return (rowCount ?? 0) > 0;
}
```

- [ ] **Step 3: Run tests → PASS**

- [ ] **Step 4: Commit**

```powershell
git add lib/project/db.ts tests/unit/project/db.test.ts
git commit -m "feat(project): server-side DB CRUD via pg — user-id scoped"
```

---

### Task 10 — Next.js API-Routes

**Files:** Create `app/api/projects/route.ts`, `app/api/projects/[id]/route.ts`

- [ ] **Step 1: Test first**

```ts
// tests/integration/api/projects.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbMock = {
  createProject: vi.fn(), listProjects: vi.fn(),
  loadProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn()
};
const getSession = vi.fn();

vi.mock('@/lib/project/db', () => dbMock);
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession } }
}));

import { POST as projectsPost, GET as projectsGet } from '@/app/api/projects/route';

beforeEach(() => {
  Object.values(dbMock).forEach((m) => m.mockReset());
  getSession.mockReset();
});

describe('POST /api/projects', () => {
  it('returns 401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await projectsPost(new Request('http://x/api/projects', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('creates project with session.user.id', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.createProject.mockResolvedValue('p-1');
    const body = { name: 'My', serialized: { store_version: 6, state: { ui: {}, timeline: {}, audio: {}, media: {} } } };
    const res = await projectsPost(new Request('http://x/api/projects', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(201);
    expect(dbMock.createProject).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1', name: 'My' }));
    const json = await res.json();
    expect(json.id).toBe('p-1');
  });
});

describe('GET /api/projects', () => {
  it('lists projects of the current user only', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.listProjects.mockResolvedValue([{ id: 'p-1', name: 'X', updated_at: 't' }]);
    const res = await projectsGet(new Request('http://x/api/projects'));
    expect(res.status).toBe(200);
    expect(dbMock.listProjects).toHaveBeenCalledWith('u-1');
  });
});
```

- [ ] **Step 2: Implement collection route**

```ts
// app/api/projects/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { createProject, listProjects } from '@/lib/project/db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const list = await listProjects(session.user.id);
  return NextResponse.json({ projects: list });
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json();
  if (typeof body?.name !== 'string' || !body?.serialized) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const id = await createProject({ userId: session.user.id, name: body.name, serialized: body.serialized });
  return NextResponse.json({ id }, { status: 201 });
}
```

- [ ] **Step 3: Implement [id] route**

```ts
// app/api/projects/[id]/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { loadProject, updateProject, deleteProject } from '@/lib/project/db';

export const runtime = 'nodejs';

async function requireSession(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return null;
  return session;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const rec = await loadProject({ userId: session.user.id, projectId: params.id });
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(rec);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json();
  const ok = await updateProject({
    userId: session.user.id,
    projectId: params.id,
    patch: { name: body?.name, serialized: body?.serialized }
  });
  if (!ok) return NextResponse.json({ error: 'not found or unchanged' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ok = await deleteProject({ userId: session.user.id, projectId: params.id });
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Tests pass; build clean**

- [ ] **Step 5: Commit**

```powershell
git add app/api/projects tests/integration/api/projects.test.ts
git commit -m "feat(project): API routes — POST/GET /projects + GET/PATCH/DELETE [id]"
```

---

### Task 11 — Client-API + Hooks

**Files:** Create `lib/project/api-client.ts`, `lib/hooks/useCurrentProject.ts`, `lib/hooks/useAutoSave.ts`

- [ ] **Step 1: Implement api-client**

```ts
// lib/project/api-client.ts
import type { SerializedProject, ProjectRecord } from './types';

async function json<T>(res: Response): Promise<T> {
  // 401 = session expired or invalid. Middleware-Cookie-Check kann das
  // nicht fangen (Cookie ist da, aber DB-seitig ungültig). Redirect zur
  // Login-Seite mit ?expired=1 — die Login-Page kann optional einen
  // "Session abgelaufen, bitte neu anmelden" Hinweis zeigen.
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.assign('/login?expired=1');
    throw new Error('Session expired'); // never reached visually, but kills the await chain
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

export async function apiCreateProject(name: string, serialized: SerializedProject): Promise<{ id: string }> {
  return json(await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, serialized }) }));
}
export async function apiListProjects(): Promise<{ projects: Array<{ id: string; name: string; updated_at: string }> }> {
  return json(await fetch('/api/projects'));
}
export async function apiLoadProject(id: string): Promise<ProjectRecord> {
  return json(await fetch('/api/projects/' + encodeURIComponent(id)));
}
export async function apiPatchProject(id: string, patch: { name?: string; serialized?: SerializedProject }): Promise<{ ok: true }> {
  return json(await fetch('/api/projects/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }));
}
export async function apiDeleteProject(id: string): Promise<{ ok: true }> {
  return json(await fetch('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' }));
}
```

- [ ] **Step 2: Implement useCurrentProject**

```ts
// lib/hooks/useCurrentProject.ts
import { create } from 'zustand';

interface CurrentProjectState {
  projectId: string | null;
  projectName: string;
  setProject(id: string | null, name?: string): void;
  setProjectName(name: string): void;
}

export const useCurrentProject = create<CurrentProjectState>((set) => ({
  projectId: null,
  projectName: 'Untitled Project',
  setProject: (id, name) => set({ projectId: id, projectName: name ?? 'Untitled Project' }),
  setProjectName: (name) => set({ projectName: name })
}));
```

Begründung: separate Zustand-Instanz (NICHT in `useAppStore`) — Current-Project-ID ist Session-Lokal, soll NICHT mit dem Projekt-Content selbst persistiert werden.

- [ ] **Step 3: Test useAutoSave first**

```tsx
// tests/unit/hooks/useAutoSave.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';

const patchMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/project/api-client', () => ({
  apiPatchProject: patchMock
}));

import { useAutoSave } from '@/lib/hooks/useAutoSave';

function Harness() {
  useAutoSave({ debounceMs: 50 });
  return null;
}

beforeEach(() => {
  patchMock.mockReset().mockResolvedValue({ ok: true });
  useCurrentProject.setState({ projectId: null, projectName: 'X' });
});

describe('useAutoSave', () => {
  it('does not fire when projectId is null', async () => {
    render(<Harness />);
    act(() => { useAppStore.setState((s) => ({ ui: { ...s.ui, zoom: 2 } })); });
    await new Promise((r) => setTimeout(r, 80));
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('fires once after debounce when projectId is set', async () => {
    useCurrentProject.setState({ projectId: 'p-1', projectName: 'X' });
    render(<Harness />);
    act(() => { useAppStore.setState((s) => ({ ui: { ...s.ui, zoom: 2 } })); });
    await new Promise((r) => setTimeout(r, 80));
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock.mock.calls[0][0]).toBe('p-1');
  });

  it('coalesces rapid changes into a single save', async () => {
    useCurrentProject.setState({ projectId: 'p-1', projectName: 'X' });
    render(<Harness />);
    act(() => {
      useAppStore.setState((s) => ({ ui: { ...s.ui, zoom: 2 } }));
      useAppStore.setState((s) => ({ ui: { ...s.ui, zoom: 3 } }));
      useAppStore.setState((s) => ({ ui: { ...s.ui, zoom: 4 } }));
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(patchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Implement useAutoSave**

```ts
// lib/hooks/useAutoSave.ts
'use client';
import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';
import { serializeProject } from '@/lib/project/serialize';
import { apiPatchProject } from '@/lib/project/api-client';

export interface UseAutoSaveOptions {
  debounceMs?: number;
}

export function useAutoSave(opts: UseAutoSaveOptions = {}): void {
  const debounce = opts.debounceMs ?? 30_000;
  const pendingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const projectId = useCurrentProject.getState().projectId;
      if (!projectId) return;          // unsaved project — no auto-save
      if (pendingTimeout.current) clearTimeout(pendingTimeout.current);
      pendingTimeout.current = setTimeout(() => {
        apiPatchProject(projectId, { serialized: serializeProject(state) }).catch(() => {
          /* swallow; UI shows a toast on explicit save errors */
        });
      }, debounce);
    });
    return () => {
      unsub();
      if (pendingTimeout.current) clearTimeout(pendingTimeout.current);
    };
  }, [debounce]);
}
```

- [ ] **Step 5: Run tests → PASS**

- [ ] **Step 6: Commit**

```powershell
git add lib/project/api-client.ts lib/hooks/useCurrentProject.ts lib/hooks/useAutoSave.ts tests/unit/hooks/useAutoSave.test.tsx
git commit -m "feat(project): api-client + useCurrentProject + useAutoSave (debounced 30s)"
```

---

### Task 12 — TopBar-Integration (Logout, Save, ProjectName)

**Files:** `components/TopBar/LogoutButton.tsx`, `components/TopBar/SaveProjectButton.tsx`, `components/TopBar/ProjectNameField.tsx`, modify `components/TopBar/index.tsx`

- [ ] **Step 1: Implement Logout**

```tsx
// components/TopBar/LogoutButton.tsx
'use client';
import { signOut } from '@/lib/auth/better-auth-client';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await signOut();
    router.push('/login');
  }
  return (
    <button onClick={logout} className="text-xs text-[var(--text-dim)] hover:text-[var(--text)] px-2">
      Logout
    </button>
  );
}
```

- [ ] **Step 2: Implement SaveProjectButton + ProjectNameField**

```tsx
// components/TopBar/SaveProjectButton.tsx
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';
import { apiCreateProject, apiPatchProject } from '@/lib/project/api-client';
import { serializeProject } from '@/lib/project/serialize';

export function SaveProjectButton() {
  const [busy, setBusy] = useState(false);
  async function onSave() {
    setBusy(true);
    const state = useAppStore.getState();
    const cur = useCurrentProject.getState();
    try {
      if (cur.projectId === null) {
        const { id } = await apiCreateProject(cur.projectName, serializeProject(state));
        useCurrentProject.getState().setProject(id, cur.projectName);
        toast.success('Projekt gespeichert');
      } else {
        await apiPatchProject(cur.projectId, { serialized: serializeProject(state) });
        toast.success('Gespeichert');
      }
    } catch (e) {
      toast.error('Speichern fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={onSave} disabled={busy} className="text-xs bg-[var(--a1)] text-white px-3 py-1 rounded disabled:opacity-50">
      {busy ? '...' : 'Save'}
    </button>
  );
}
```

```tsx
// components/TopBar/ProjectNameField.tsx
'use client';
import { useState } from 'react';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';
import { apiPatchProject } from '@/lib/project/api-client';

export function ProjectNameField() {
  const projectId = useCurrentProject((s) => s.projectId);
  const name = useCurrentProject((s) => s.projectName);
  const setName = useCurrentProject((s) => s.setProjectName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  async function commit() {
    setEditing(false);
    setName(draft);
    if (projectId) await apiPatchProject(projectId, { name: draft }).catch(() => {});
  }

  return editing ? (
    <input
      autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
      onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      className="text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded px-1 py-0.5"
    />
  ) : (
    <button onClick={() => { setDraft(name); setEditing(true); }} className="text-sm text-[var(--text)]">
      {name}
    </button>
  );
}
```

- [ ] **Step 3: Mount in TopBar/index.tsx** — Read existing file first, append `LogoutButton`, `SaveProjectButton`, `ProjectNameField` to the existing layout. CC #1 reads `components/TopBar/index.tsx` and inserts the three components without disturbing the current layout/elements.

- [ ] **Step 4: Add `useAutoSave()` call in `app/(studio)/layout.tsx` (or wherever the Studio root component lives)** — `CC #1 verifies path` and adds `useAutoSave()` as a side-effect hook in a top-level `'use client'` component.

- [ ] **Step 5: Manual smoke** (CC #2): Login → Save → verifiziere in DB. Toast erscheint. Name editable.

- [ ] **Step 6: Commit**

```powershell
git add components/TopBar/
git commit -m "feat(topbar): Logout + Save + editable ProjectName"
```

---

### Task 13 — ProjectListDrawer

**Files:** `components/Studio/ProjectListDrawer.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/Studio/ProjectListDrawer.tsx
'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';
import { apiListProjects, apiLoadProject, apiDeleteProject } from '@/lib/project/api-client';
import { applySerializedProject } from '@/lib/project/deserialize';

interface ProjectListDrawerProps {
  open: boolean;
  onClose(): void;
}

export function ProjectListDrawer({ open, onClose }: ProjectListDrawerProps) {
  const [list, setList] = useState<Array<{ id: string; name: string; updated_at: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiListProjects().then((r) => setList(r.projects)).catch((e) => toast.error('Liste fehlgeschlagen: ' + e.message)).finally(() => setLoading(false));
  }, [open]);

  async function load(id: string) {
    try {
      const rec = await apiLoadProject(id);
      applySerializedProject({ store_version: rec.store_version, state: rec.state });
      useCurrentProject.getState().setProject(rec.id, rec.name);
      toast.success('Projekt geladen');
      onClose();
    } catch (e) {
      toast.error('Laden fehlgeschlagen: ' + (e as Error).message);
    }
  }

  async function del(id: string) {
    if (!confirm('Projekt wirklich löschen?')) return;
    try {
      await apiDeleteProject(id);
    } catch (e) {
      toast.error('Löschen fehlgeschlagen: ' + (e as Error).message);
      return; // Liste NICHT lokal updaten — sonst sieht User leere Liste, lädt neu, Projekt ist wieder da.
    }
    setList((xs) => xs.filter((x) => x.id !== id));
    if (useCurrentProject.getState().projectId === id) {
      useCurrentProject.getState().setProject(null);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50" onPointerDown={onClose}>
      <div className="absolute right-0 top-0 bottom-0 w-80 bg-[var(--surface-1)] border-l border-[var(--border)] p-4 overflow-y-auto"
           onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-[var(--text)] mb-3">Projekte</h2>
        {loading && <div className="text-xs text-[var(--text-dim)]">Lädt...</div>}
        {!loading && list.length === 0 && <div className="text-xs text-[var(--text-dim)]">Noch keine Projekte.</div>}
        <ul className="space-y-1">
          {list.map((p) => (
            <li key={p.id} className="flex items-center justify-between bg-[var(--surface-2)] rounded px-2 py-1">
              <button onClick={() => load(p.id)} className="text-xs text-[var(--text)] hover:text-[var(--a1)] truncate flex-1 text-left">
                {p.name}
              </button>
              <button onClick={() => del(p.id)} className="text-xs text-[var(--text-dim)] hover:text-red-400 ml-2">✕</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in TopBar** — add a "Projects" button that toggles `open` state and renders `<ProjectListDrawer open={...} onClose={...} />`.

- [ ] **Step 3: Manual smoke** (CC #2): Login → Save 2 Projekte → Drawer öffnen → Liste zeigt beide → Klick lädt → Delete entfernt.

- [ ] **Step 4: Commit**

```powershell
git add components/Studio/ProjectListDrawer.tsx components/TopBar/index.tsx
git commit -m "feat(studio): ProjectListDrawer — list/load/delete projects"
```

---

### Task 14 — KNOWN_LIMITATIONS

**Files:** modify `docs/KNOWN_LIMITATIONS.md`

- [ ] **Step 1: Append new section** before "Manual verification checklist" (Z. 367):

```markdown
## Plan 7 — Better-Auth Login + VG_projects

### Auth-Stack: Better-Auth, NOT Supabase Auth

VibeGrid teilt eine bestehende Supabase-Postgres-Instanz mit anderen Apps der gleichen Org. Die Instanz nutzt **Better-Auth** für User-Management (Tabellen: `"user"`, `account`, `session`, `passkey`, `twoFactor`, `verification`). Konsequenzen:

- VibeGrid läuft Better-Auth in einer eigenen Instanz (`lib/auth/better-auth-server.ts`) mit `cookiePrefix: 'vibegrid'`. Die Cookie ist getrennt von anderen Apps.
- v0.1 aktiviert NUR `emailAndPassword`. Keine OAuth-Provider, kein Signup, keine 2FA/Passkey-Flows in VibeGrid (auch wenn die DB-Tabellen für andere Apps existieren).
- User mit aktivem 2FA bei der Schwester-App: Login in VibeGrid schlägt fehl. Workaround v0.1: 2FA-User loggt sich bei der Schwester-App ein, dort 2FA deaktivieren, in VibeGrid neu einloggen, später wieder aktivieren. v0.2: 2FA-Plugin in VibeGrid Better-Auth aktivieren.
- Domain-Strategie v0.1: VibeGrid läuft auf eigener Domain → separater Login-Schritt. SSO-Cookie-Share via Parent-Domain ist v0.2 wenn Subdomain-Setup steht.

### Service-Role-only DB-Zugriff für VG_projects

Better-Auth gibt keine Supabase-Auth-JWTs aus → klassische Supabase-RLS-Policies via `auth.uid() = user_id` funktionieren nicht. Authz läuft server-side:

- VG_projects ist `REVOKE ALL FROM anon, authenticated` + RLS-Policy `USING (false)` für Defense-in-Depth.
- Schreib-/Lesezugriff ausschließlich via Next.js API-Routes mit Service-Role-Connection (`lib/db/pg.ts`), gefiltert nach `session.user.id`.
- Falls jemals der Anon-Key in einem Client-Bundle leaked: VG_projects bleibt unerreichbar.

### Two-tier session enforcement (cookie-check + API-side validation)

Next.js 14 Middleware läuft im Edge Runtime — `pg` ist dort nicht ladbar. Die Middleware (`middleware.ts`) prüft daher NUR die Anwesenheit der `vibegrid.session_token`-Cookie, ohne DB-Roundtrip. Die echte Session-Validierung passiert in jeder API-Route via `auth.api.getSession({ headers })` (Node-Runtime).

Konsequenzen:

- **Tampered oder DB-seitig abgelaufene Cookie** kann durch die Middleware durch → `/studio`-Shell rendert. Beim ersten API-Call (Project-Liste laden) kommt 401 zurück. Der `api-client.ts`-`json<T>`-Helper fängt 401 ab und redirected via `window.location.assign('/login?expired=1')`.
- **Window flash für expired sessions**: Wenige Millisekunden zwischen Shell-Render und Redirect zeigen den leeren Studio-Skelett-State. In v0.1 akzeptiert; v0.2 fügt einen Server-Component-Session-Check im `/studio`-Layout hinzu, der diesen Flash eliminiert.
- **Logout-Race**: Falls ein User in Tab A Logout klickt und Tab B parallel ein API-Action triggert, kann Tab B den Server-401 erst nach dem Logout-Roundtrip sehen. Akzeptabel.

### Hidden params bei Auto-Preset (carry-over aus Plan 5.8b)

Unverändert — siehe Plan 5.8b-Section.

### Store-Migration beim Projekt-Laden

Beim `Load Project` läuft die existierende `migrate(persistedState, version)`-Kette (`lib/store/index.ts:14`) auch für DB-gespeicherte Snapshots. Ein Projekt das mit Store-v4 gespeichert wurde wird beim Laden zu v6 migriert. Der DB-Eintrag selbst bleibt unverändert (no in-place upgrade) — erst beim nächsten Save wird der upgraded State zurückgeschrieben.

### Auto-Save Semantik

- Nur aktiv wenn `useCurrentProject.projectId !== null` (Projekt wurde mindestens einmal explizit gespeichert).
- 30 Sekunden debounced — schnelle Sequenz von Store-Updates ergibt EIN Netzwerk-Roundtrip.
- Fehler werden silently swallow'd — der nächste explizite Save zeigt den Toast. v0.2: Sticky Toast mit Retry für persistente Save-Failures.

### R2-Key-Format

`{userId}/{projectId}/{kind}/{uuid}.{ext}` (Spec §7) bleibt in v0.1 weiterhin `anonymous/default/…` — der Upload-Pfad wurde von Plan 7 NICHT angefasst, weil Bestandsuploads vorher unter dem Anonymous-Key liegen und ein Live-Rename komplex wäre. Konsequenz: in v0.1 sehen alle eingeloggten User dieselben R2-Buckets-Inhalte, sind aber per VG_projects.state.media.mediaRefs-Sichtbarkeit nur an ihre eigenen Projekt-Snapshots gebunden. v0.2 migriert Upload-Pfade auf echte userId/projectId und stellt einen Backfill-Script bereit.
```

- [ ] **Step 2: Commit**

```powershell
git add docs/KNOWN_LIMITATIONS.md
git commit -m "docs(limitations): Plan 7 — Better-Auth, server-side authz, auto-save"
```

---

### Task 15 — Final verify + push

- [ ] **Step 1: All gates green**

```powershell
npm run typecheck
npm run lint
npm test -- --run    # Erwartung ≥ 684 + 14 = ≥ 698
npm run build
```

- [ ] **Step 2: Manual smoke checklist** (CC #2 verifiziert):
  - [ ] `/studio` ohne Session → Redirect `/login?from=/studio`
  - [ ] Login mit bestehendem User → /studio öffnet sich
  - [ ] Falsches Passwort → Toast "Invalid credentials"
  - [ ] Save (neues Projekt) → DB-Eintrag in `VG_projects` (Supabase Studio Table Editor)
  - [ ] Reload → ProjectListDrawer → Klick → State identisch wiederhergestellt
  - [ ] Edit nach Load → 30 s warten → `updated_at` in DB aktualisiert (auto-save)
  - [ ] Rename → DB `name` aktualisiert
  - [ ] Delete → Eintrag weg, ProjectList aktualisiert
  - [ ] Logout → /login
  - [ ] Anderer User: ProjectListDrawer zeigt NICHT die Projekte des ersten Users
  - [ ] Direkt-curl ohne Session: `curl -i http://localhost:3000/api/projects` → 401
  - [ ] Direkt-Supabase-curl mit anon-key auf `VG_projects` → `permission denied`
  - [ ] Expired-Session-Flow: Cookie in DevTools manipulieren auf einen nicht-mehr-gültigen Wert → `/studio` lädt → erster API-Call gibt 401 → Client redirected auf `/login?expired=1` (Browser-URL aktualisiert sich)
  - [ ] Delete-Fehler-Toast: DevTools Network → POST `/api/projects/<id>` blockieren mit "Block request URL" → Delete im Drawer klicken → Toast "Löschen fehlgeschlagen" erscheint, Liste bleibt unverändert

- [ ] **Step 3: Push**

```powershell
git push origin main
```

---

## Verification gate

```powershell
npm test -- --run    # ≥ 698 passing (684 + 14 neu)
npm run typecheck    # clean
npm run lint         # clean
npm run build        # clean — Bundle-Delta < 80 kB (better-auth react-client + login route)
```

Bundle-Delta-Erwartung: **~50-80 kB minified** (`better-auth/react` client + Login-Route + ProjectListDrawer). Server-side `pg` und `better-auth/server` landen NICHT im Client-Bundle (`'use server' / 'server-only'` schützt).

---

## Commit-Struktur (Summary)

```
chore(deps): add better-auth + pg for Plan 7 auth/persistence
feat(db): pg pool singleton via DATABASE_URL
feat(auth): better-auth server instance — emailAndPassword only
feat(auth): better-auth react client + Next.js [...all] handler
feat(auth): edge-compatible middleware cookie guard for /studio
feat(auth): login page — email/password + redirect-back
feat(db): VG_projects schema — table + RLS lockdown + updated_at trigger
refactor(store): extract toPersistedShape + STORE_VERSION (DRY for Plan 7)
feat(project): serialize/deserialize + migrate-on-load reuse
feat(project): server-side DB CRUD via pg — user-id scoped
feat(project): API routes — POST/GET /projects + GET/PATCH/DELETE [id]
feat(project): api-client + useCurrentProject + useAutoSave (debounced 30s)
feat(topbar): Logout + Save + editable ProjectName
feat(studio): ProjectListDrawer — list/load/delete projects
docs(limitations): Plan 7 — Better-Auth, server-side authz, auto-save
```

15 Commits. Pro Commit ein in sich abgeschlossenes Stück Funktionalität.

---

## Risk + Tradeoff Notes

1. **Better-Auth-Setup-Friction** — Better-Auth's Pool-Adapter erwartet leere Tabellen die es selbst initialisiert. Hier sind Tabellen bereits von einer anderen App geschrieben. Erwartetes Verhalten: Better-Auth liest/schreibt durch, weil das Schema identisch ist (gleiche `username`-/`twoFactor`-/`passkey`-Plugins aktiv beim Setup der DB). Falls Better-Auth beim Boot eine Migration laufen lässt und kollidiert: CC #1 disabled die Migrate-Phase explizit über die Config (`database: { generateSchema: false }` o.ä.) oder nutzt den `customSession` Plugin-Pfad. **Mitigation:** Task 2 enthält einen Test, der eine Auth-Route trifft. Wenn beim Implementieren ein Schema-Konflikt auftritt, surfaced er sofort.

2. **Runtime-Split: Middleware Edge, API-Routes Node** — Middleware (`middleware.ts`) läuft Edge (cookie-only check, kein `pg`). API-Routes (`app/api/projects/**`, `app/api/auth/[...all]`) laufen `runtime: 'nodejs'`, weil `pg` und `better-auth/server` Edge-inkompatibel sind. Folge: cold-start für Project-Saves ist ein Node-cold-start (~200-400 ms auf Vercel), für die Edge-Middleware sub-50 ms. Akzeptabel — Edge-Middleware ist die teure-Wegfilterung (Logged-out-Traffic), Node-Routes sind die teure-Inhaltswegfilterung (Logged-in DB-Operationen).

3. **R2-Key-Migration NICHT in Plan 7** — explizit out-of-scope (siehe KNOWN_LIMITATIONS). Bestehende `anonymous/default/`-Pfade bleiben. Bei Multi-User-Live-Betrieb müssen User akzeptieren, dass ihre R2-Uploads bis zur v0.2-Migration unter dem gemeinsamen Bucket-Pfad liegen (DSGVO-Risiko abklären falls produktiv).

4. **No connection-pool stress test** — `pg.Pool` mit `max: 5` reicht für die Vercel-Function-Concurrency, könnte aber bei Spike-Last 503 produzieren. v0.2: PgBouncer-Modus (`pgbouncer=true` ist im DATABASE_URL schon gesetzt, gut!) + max=2.

5. **Auto-Save kann Saves verlieren beim Tab-Close** — `setTimeout` läuft nach Unmount nicht mehr. v0.2: `beforeunload`-Handler der einen sync flush erzwingt.

---

## Done-Definition (für CC #2)

CC #2 darf Plan 7 als "erledigt" markieren, wenn:

- Alle 15 Commits auf `main` gepusht sind.
- `npm test -- --run` zeigt ≥ 698 passing, 0 failing.
- Live-Smoke (Liste oben) alle 13 Checks ✅.
- KNOWN_LIMITATIONS-Section ist im File.
- Eine zweite Browser-Session mit anderem User-Account sieht NICHT die Projekte des ersten Users (RLS-Defense-in-Depth verifiziert).

Abgabe-Datei: `docs/superpowers/plans/2026-05-23-vibegrid-plan-7-better-auth-project-persistence.md` (dieser Plan).
