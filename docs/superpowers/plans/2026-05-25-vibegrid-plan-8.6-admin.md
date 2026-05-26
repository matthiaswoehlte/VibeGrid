# CC #1 Prompt — Plan 8.6: Admin-Seite (Rev. 2)

**Priorität: Nach 8c-Live-Test.**
Credits laufen (Plan 8.5, 906 Tests, HEAD 84706b6).

> Revision 3 — 2026-05-25
> Rev. 2: B1–B3, W1–W5, D1–D4, E1–E2 aus erstem Review.
> Rev. 3: W1-R (?.()??-Bug), W2-R (doppelter getSession → requireUserSession),
>          D1-R (Session-Tabellen-Name in Schritt 0), D2-R (Self-Ban-Guard).

---

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Baseline: HEAD 84706b6 (**906 Tests**, Credits live).

Schreibe nur den **Plan** — noch keinen Code.

---

## Schritt 0 — Codebase lesen (vor Plan schreiben)

CC #1 liest und dokumentiert:

1. `lib/auth/better-auth-server.ts` — **Pflicht**:
   - Exakter Import-Pfad und Name des `auth`-Exports
   - Signatur von `auth.api.getSession` (nimmt `{ headers: Headers }`)
   - Ob `@better-auth/admin`-Plugin installiert ist (`package.json` + Plugin-Config)
   - Welche Methoden das Plugin ggf. auf `auth.api` ergänzt
     (z. B. `banUser`, `revokeUserSessions`, `setRole`)
2. User-Tabelle tatsächliches Schema:
   ```sql
   SELECT column_name, data_type, column_default
   FROM information_schema.columns
   WHERE table_name = 'user' ORDER BY ordinal_position;
   ```
   Drei mögliche Ergebnisse → Plan-Header updaten:
   - **A)** `role` + `banned` existieren, Plugin installiert → kein Migration nötig
   - **B)** `role` + `banned` existieren, kein Plugin → Migration 007 nur für `ban_reason`
   - **C)** Spalten fehlen → Migration 007 komplett (Spalten + Admin-Defaults)
3. `middleware.ts` — aktuellen Auth-Guard-Code lesen
4. **Session-Tabellen-Name verifizieren** — Plan-B3 macht `DELETE FROM "session"`.
   Prüfen ob Better-Auth `session` oder `sessions` heißt:
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name ILIKE '%session%';
   ```
   Ergebnis im Plan-Header notieren. Ein falscher Tabellenname → 500 beim ersten Ban-Test.
5. Bestehende Toast-Komponente — Pfad notieren
6. `lib/credits/credits.ts` — `CreditTransactionMeta`-Type lokalisieren

---

## [Fix E1] Bewusste Entscheidung: Better-Auth Admin-Plugin

Das Plugin (`@better-auth/admin`) bringt fertige `auth.api`-Methoden mit:
`banUser`, `unbanUser`, `setRole`, `revokeUserSessions`, `listUsers`.

**Wenn Schritt 0 zeigt: Plugin bereits installiert + role/banned-Spalten existieren:**
→ Plugin-Methoden verwenden. Kein eigener Ban-SQL. `auth.api.banUser` macht
Session-Revoke automatisch. Plan-B3-Fix entfällt — Plugin erledigt es.

**Wenn Plugin nicht installiert:**
→ Eigene Implementation wie unten beschrieben. Migration 007 anlegen.
Entscheidung bewusst im Commit-Message dokumentieren:
`"feat(auth): admin-guard — own impl, plugin not used because [Grund aus Schritt-0]"`

CC #1 dokumentiert die Entscheidung im Plan-Header.

---

## [Fix B1+B2] Feature 1 — Auth-Guards

Zwei getrennte Helpers — Pages und API-Routes haben unterschiedliche
Header-Quellen und unterschiedliche Fehlerbehandlung.

```typescript
// lib/auth/admin-guard.ts
import 'server-only';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import type { Session } from '@/lib/auth/better-auth-server';

// [Fix B1] Page/Layout-Variante — wirft NEXT_REDIRECT (korrekt in Server-Components)
export async function requireAdminPage(): Promise<Session> {
  const session = await auth.api.getSession({ headers: headers() });
  if (!session?.user)          redirect('/login');
  if (session.user.role !== 'admin') redirect('/');
  // [Fix B3] Banned-Check
  if (session.user.banned)     redirect('/');
  return session;
}

// [Fix B2] API-Route-Variante — gibt Response zurück, kein redirect()
export async function requireAdminApi(
  req: Request
): Promise<{ session: Session } | { response: Response }> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return { response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  if (session.user.role !== 'admin') {
    return { response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  // [Fix B3] Banned-Check
  if (session.user.banned) {
    return { response: NextResponse.json({ error: 'banned' }, { status: 403 }) };
  }
  return { session };
}
```

**Aufrufmuster in jeder Admin-API-Route:**
```typescript
const guard = await requireAdminApi(req);
if ('response' in guard) return guard.response;
const { session } = guard;
```

**Aufrufmuster in Layout/Page:**
```typescript
const session = await requireAdminPage();
```

---

## [Fix B3] Feature 2 — Banning mit Enforcement

Banning ohne Enforcement ist wirkungslos. Zwei Teile:

### Teil A: Ban setzen + Session revoken

```typescript
// POST /api/admin/users/[id]/ban
// Body: { banned: boolean, reason?: string }
// [Fix D2-R] Self-Ban-Guard: Admin darf sich nicht selbst sperren
if (targetUserId === session.user.id) {
  return NextResponse.json({ error: 'You cannot ban your own account.' }, { status: 400 });
}

if (banned) {
  // [Fix W1-R] Explizites if/else — kein ?.()??-Anti-Pattern
  if (typeof auth.api.banUser === 'function') {
    // Plugin vorhanden: banUser + Session-Revoke intern
    await auth.api.banUser({ userId: targetUserId, banReason: reason });
  } else {
    // Kein Plugin: SQL + manueller Session-Delete
    await db.query(
      `UPDATE "user" SET banned = true, ban_reason = $1 WHERE id = $2`,
      [reason ?? null, targetUserId]
    );
    // [Fix D1-R] Tabellen-Name aus Schritt 0 — "session" oder "sessions"
    await db.query(`DELETE FROM "session" WHERE user_id = $1`, [targetUserId]);
  }
} else {
  // Entsperren — [Fix W1-R] ebenfalls explizit
  if (typeof auth.api.unbanUser === 'function') {
    await auth.api.unbanUser({ userId: targetUserId });
  } else {
    await db.query(
      `UPDATE "user" SET banned = false, ban_reason = NULL WHERE id = $1`,
      [targetUserId]
    );
  }
}
```

### Teil B: Banned-Check in Non-Admin-Routes — ohne doppelten getSession-Call

**[Fix W2-R]** `requireNotBanned` würde in den fal-Routes einen zweiten
`auth.api.getSession`-Call auslösen — die Routes rufen `getSession` bereits
für Credits und Pre-flight auf. Stattdessen: gemeinsamer Helper der Session
einmal holt und banned + userId in einem Zug liefert:

```typescript
// lib/auth/admin-guard.ts — Ergänzung
export type UserSession = {
  userId: string;
  banned: boolean;
  role:   string;
};

export async function requireUserSession(
  req: Request
): Promise<UserSession | Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (session.user.banned) {
    return NextResponse.json({ error: 'Your account has been suspended.' }, { status: 403 });
  }
  return {
    userId: session.user.id,
    banned: session.user.banned ?? false,
    role:   session.user.role  ?? 'user',
  };
}
```

In allen fal.ai-Submit-Routes **ersetzt** `requireUserSession` den bisherigen
separaten `getSession`-Call vollständig:

```typescript
// Vorher (zwei getSession-Calls pro Request):
// const bannedCheck = await requireNotBanned(req);
// if (bannedCheck) return bannedCheck;
// const session = await auth.api.getSession(...); // noch ein Mal!

// Nachher (einmal):
const userSession = await requireUserSession(req);
if (userSession instanceof Response) return userSession;
const { userId } = userSession;
```

`requireNotBanned` entfällt damit — kein separater Export mehr.

**KNOWN_LIMITATIONS.md Eintrag:**
```
Banned sessions: Existing sessions remain valid until they expire naturally
(~7 days). New requests to AI-generation routes are blocked immediately.
```

---

## [Fix W5] Feature 3 — TransactionMeta Erweiterung

In `lib/credits/credits.ts` — `CreditTransactionMeta` um `admin_id` erweitern:

```typescript
type CreditTransactionMeta = {
  // ... bestehende Felder ...
  admin_id?: string;   // [Plan 8.6] wer hat den Grant ausgestellt
  reason?:   string;
};
```

`grantCredits` in Admin-Route immer mit `admin_id`:
```typescript
await grantCredits(userId, amount, 'admin_grant', {
  admin_id: session.user.id,
  reason: body.reason
});
```

---

## [Fix W3] Feature 4 — Dashboard via lib/admin/stats.ts

Server-Components fetchen **nicht** ihren eigenen API-Endpoint.
Direkt die Lib-Funktion importieren — spart Auth-Roundtrip + 50–100 ms Latenz.

```typescript
// lib/admin/stats.ts (server-only)
export async function getDashboardStats(): Promise<DashboardStats>

// app/admin/page.tsx
const session = await requireAdminPage();
const stats   = await getDashboardStats();
```

### [Fix W1] Dashboard SQL — konkret

```sql
-- Aktive User (Session in letzten 30 Tagen)
SELECT COUNT(DISTINCT user_id)::int AS active_users
FROM session WHERE expires_at > now() - interval '30 days';

-- Gesamt Credits vergeben (admin_grant + onboarding_default)
SELECT COALESCE(SUM(amount), 0)::int AS total_granted
FROM "VG_credit_transactions"
WHERE action IN ('admin_grant', 'onboarding_default');

-- Credits verbraucht (alle Cost-Actions)
SELECT COALESCE(SUM(-amount), 0)::int AS total_spent
FROM "VG_credit_transactions"
WHERE action IN (
  'flux_image', 'kling_video_5s', 'kling_video_10s',
  'sync_lipsync_5s', 'sync_lipsync_10s', 'musetalk', 'elevenlabs_tts'
);

-- fal.ai Calls letzte 30 Tage
SELECT COUNT(*)::int AS fal_calls_30d
FROM "VG_credit_transactions"
WHERE action IN (
  'flux_image', 'kling_video_5s', 'kling_video_10s',
  'sync_lipsync_5s', 'sync_lipsync_10s', 'musetalk', 'elevenlabs_tts'
) AND created_at > now() - interval '30 days';

-- Letzte 20 Transactions (alle User)
SELECT ct.*, u.email, u.name
FROM "VG_credit_transactions" ct
JOIN "user" u ON u.id = ct.user_id
ORDER BY ct.created_at DESC LIMIT 20;
```

### Dashboard Layout

```
┌─── Admin Dashboard ─────────────────────────────────────────────┐
│  Aktive User (30d): 11   Credits vergeben: 5.500 ($55.00)        │
│  Credits verbraucht: 234 ($2.34)   fal.ai Calls (30d): 47       │
│                                                                   │
│  Letzte Transaktionen ──────────────────────────────────────── │
│  User | Action | Amount | Balance After | Story | Zeit           │
│  (Link zu /admin/users/[id])                                     │
└───────────────────────────────────────────────────────────────────┘
```

---

## Feature 5 — User-Liste

### [Fix W2] SQL mit COALESCE

```sql
SELECT
  u.id, u.name, u.email, u.role, u.banned, u.created_at,
  COALESCE(c.balance,        0) AS balance,
  COALESCE(c.lifetime_spent, 0) AS lifetime_spent
FROM "user" u
LEFT JOIN public."VG_user_credits" c ON c.user_id = u.id
ORDER BY u.created_at DESC;
```

`balance = null` (User noch nie eingeloggt) → `COALESCE` → 0. Kein NaN im UI.

```
┌─── User-Liste ─────────────────────────────────────────────────────┐
│  [Suche: Name / Email ______________]                               │
│  Name         | Email          | Role  | Balance | Banned | ▶      │
│  Matthias W.  | matthias@...   | admin | 9.873   | —      | →      │
│  Demo User     | user@...      | user  | 500     | —      | →      │
│  Test User 2    | user2@...     | user  | 0       | ✗ Ban  | →      │
└─────────────────────────────────────────────────────────────────────┘
```

Suche: Client-seitig. Klick → `/admin/users/[id]`.

---

## Feature 6 — User-Detail

```
┌─── Demo Admin ─────────────────────────────────────────────┐
│  Email: demo-admin@example.com                                │
│  Role: admin   Banned: false   Mitglied seit: 15.02.2026         │
│  Balance: 9.873 Credits ($98.73)   Lifetime Spent: 127 ($1.27)   │
│                                                                   │
│  [ Betrag: _____ ]  [ Grund: _______________ ]  [Vergeben]       │
│  [User sperren] / [User entsperren]                               │
│                                                                   │
│  Transaktions-History (25/Seite, paginiert)                       │
│  Datum | Action | Amount | Balance After | admin_id | Story       │
└───────────────────────────────────────────────────────────────────┘
```

---

## Admin API-Routes

```
GET  /api/admin/users
  → requireAdminApi(req)
  → SQL mit COALESCE (siehe Feature 5)

POST /api/admin/users/[id]/grant-credits
  Body: { amount: number, reason?: string }
  → requireAdminApi(req)
  → grantCredits(userId, amount, 'admin_grant', { admin_id, reason })

POST /api/admin/users/[id]/ban
  Body: { banned: boolean, reason?: string }
  → requireAdminApi(req)
  → Plugin-banUser ODER SQL + Session-Delete (je Schritt-0-Ergebnis)

GET  /api/admin/users/[id]/transactions?page=1
  → requireAdminApi(req)
  → SELECT ... WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25 OFFSET ...

GET  /api/admin/dashboard
  → requireAdminApi(req) (für externe Konsumenten, z. B. Admin-CLI)
  → getDashboardStats() — dieselbe Lib-Funktion wie Page
```

---

## [Fix W4] Migration-Naming

Wenn Spalten fehlen (Schritt 0, Variante C):
**`007_VG_user_role_banned.sql`** — kein `a`-Suffix.

```sql
-- Filename: db/migrations/007_VG_user_role_banned.sql
ALTER TABLE public."user"
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin')),
  ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ban_reason TEXT;

UPDATE public."user"
SET role = 'admin'
WHERE email IN (
  'demo-admin@example.com',
  'estonia.woehlte@gmail.com',
  'test.woehlte@gmail.com',
  'heidrun.woehlte@gmail.com'
);
```

---

## File Map

| Datei | Aktion |
|---|---|
| `db/migrations/007_VG_user_role_banned.sql` | CREATE — **nur wenn Spalten fehlen** (Schritt 0) |
| `lib/auth/admin-guard.ts` | CREATE — `requireAdminPage`, `requireAdminApi`, `requireUserSession` (ersetzt requireNotBanned) [Fix B1+B2+B3+W2-R] |
| `lib/admin/stats.ts` | CREATE — `getDashboardStats()` mit allen 5 SQL-Queries [Fix W3] |
| `lib/credits/credits.ts` | MODIFY — `CreditTransactionMeta` um `admin_id` erweitern [Fix W5] |
| `app/admin/layout.tsx` | CREATE — `requireAdminPage()` |
| `app/admin/page.tsx` | CREATE — Dashboard via `getDashboardStats()` |
| `app/admin/users/page.tsx` | CREATE — User-Liste |
| `app/admin/users/[id]/page.tsx` | CREATE — User-Detail |
| `app/api/admin/users/route.ts` | CREATE — GET mit COALESCE-SQL [Fix W2] |
| `app/api/admin/users/[id]/grant-credits/route.ts` | CREATE |
| `app/api/admin/users/[id]/ban/route.ts` | CREATE — Ban + Session-Revoke [Fix B3] |
| `app/api/admin/users/[id]/transactions/route.ts` | CREATE |
| `app/api/admin/dashboard/route.ts` | CREATE |
| `app/api/sceneflow/stories/[id]/generate-images-and-voices/route.ts` | MODIFY — `requireUserSession` ersetzt separaten `getSession`-Call [Fix W2-R] |
| `app/api/sceneflow/stories/[id]/generate-videos/route.ts` | MODIFY — `requireUserSession` |
| `app/api/sceneflow/scenes/[sceneId]/retry-image/route.ts` | MODIFY — `requireUserSession` |
| `app/api/sceneflow/scenes/[sceneId]/retry-video/route.ts` | MODIFY — `requireUserSession` |
| `components/Admin/AdminShell.tsx` | CREATE — Nav-Links + Logout-Button + Layout [Fix D1] |
| `components/Admin/UserTable.tsx` | CREATE |
| `components/Admin/CreditGrantModal.tsx` | CREATE |
| `components/Admin/TransactionHistory.tsx` | CREATE |
| `components/Admin/BanButton.tsx` | CREATE |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY — Banning-Session-Hinweis [Fix B3] |

---

## Tests

**[Fix D2] redirect()-Mock-Vorlage** — für alle admin-guard-Tests:

```typescript
// tests/unit/auth/admin-guard.test.ts
import { vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  })
}));
vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers())
}));
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession: vi.fn() } }
}));
```

**`tests/unit/auth/admin-guard.test.ts`** — ≥ 9:
- `requireAdminPage`: kein Session → `NEXT_REDIRECT:/login`
- `requireAdminPage`: `role === 'user'` → `NEXT_REDIRECT:/`
- `requireAdminPage`: `banned === true` → `NEXT_REDIRECT:/`
- `requireAdminPage`: `role === 'admin'` → gibt Session zurück
- `requireAdminApi`: kein Session → `{ response: 401 }`
- `requireAdminApi`: `role === 'user'` → `{ response: 403 }`
- `requireAdminApi`: `banned === true` → `{ response: 403 }`
- `requireAdminApi`: `role === 'admin'` → `{ session }`
- `requireUserSession`: banned → `Response 403`, unbanned → `{ userId, role }` [Fix W2-R]

**`tests/unit/api/admin.test.ts`** — ≥ 6:
- `GET /api/admin/users` ohne Admin-Session → 401
- `POST grant-credits` → Balance steigt, `admin_id` in Transaction-Meta
- `POST ban` → `banned = true`, Session-Rows gelöscht [Fix B3]
- `POST ban` mit eigenem userId → 400 "cannot ban your own account" [Fix D2-R]
- `POST unban` → explizit Plugin-Pfad ODER SQL-Pfad, nicht beides [Fix W1-R]
- `GET transactions` paginiert korrekt
- `COALESCE`: User ohne `VG_user_credits`-Row → balance = 0 [Fix W2]

**[Fix D4] `tests/unit/api/banned-enforcement.test.ts`** — ≥ 2:
- `POST generate-videos` mit banned User → 403 (via `requireUserSession`)
- `requireUserSession` macht genau **einen** `getSession`-Call pro Request [Fix W2-R]

Mindest: **≥ 17 neue Tests**

---

## Verification Gate

Baseline: **906 Tests**.
Ziel: **≥ 923 Tests**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**
```
# Schritt 0: Session-Tabellen-Name in DB bestätigt (session oder sessions) [Fix D1-R]
# Schritt 0: Plugin-Entscheidung im Plan-Header dokumentiert
# Als normaler User → /admin → Redirect zu /
# Als Admin → /admin → Dashboard mit korrekten Stats
# Dashboard: kein Crash bei 0 Transaktionen
# User "Demo User": balance = 0 (kein NaN)
# 100 Credits vergeben → Transaction zeigt admin_id
# Admin versucht sich selbst zu sperren → 400 "cannot ban your own account" [Fix D2-R]
# User sperren → banned=true + Session-Rows weg; Unban → nur ein DB-Pfad aktiv [Fix W1-R]
# Gesperrter User → generate-videos → 403 sofort, ein einziger getSession-Call [Fix W2-R]
# DevTools: generate-videos macht keinen doppelten Better-Auth-Lookup
# /api/admin/users ohne Token → 401 (kein redirect-Loop)
# KNOWN_LIMITATIONS zeigt Banning-Session-Hinweis
```

---

## Commit-Struktur

```
feat(db): migration 007 — role + banned columns (falls nötig, sonst skip)
feat(auth): admin-guard — requireAdminPage, requireAdminApi, requireUserSession
feat(admin): stats lib — getDashboardStats mit konkreten SQL-Queries
feat(credits): CreditTransactionMeta — admin_id ergänzt
feat(admin): layout + dashboard + users-list + user-detail pages
feat(admin): admin API routes — users, grant-credits, ban+revoke (W1-R fix), transactions
feat(admin): AdminShell + UserTable + CreditGrantModal + TransactionHistory + BanButton
feat(api): sceneflow routes — requireUserSession integration (replaces double-getSession)
docs(limitations): Banning-Session-Hinweis
test: admin-guard + admin-api + banned-enforcement
```

---

## Out of Scope (kommt später)

- Lemon Squeezy Webhooks → automatisches Aufladen
- Credit-Pakete / Preisseite
- Role-Management über UI
- Bulk-Grant (Credits an alle User)
- Middleware-Level-Ban (DB-Check auf jeden Request)

---

Abgabe: `2026-05-25-vibegrid-plan-8.6-v2-admin.md`
