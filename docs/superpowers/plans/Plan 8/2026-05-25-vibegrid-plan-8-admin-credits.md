# CC #1 Prompt — Plan 8-admin: Credit-System + Admin-Seite

**Priorität: Vor erstem 8c-Testlauf implementieren.**
Kein fal.ai-Call darf live gehen bevor das Credit-System steht.

---

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Baseline: HEAD post-Plan-8c (**~827 Tests**, Store v6, fal.ai-Pipeline
implementiert aber noch nicht getestet).

Schreibe nur den **Plan** — noch keinen Code.

---

## Schritt 0 — Codebase lesen (vor Plan schreiben)

CC #1 liest und dokumentiert:

1. **bestehendes Token-Logging** — wie werden dort API-Kosten protokolliert?
   Tabellenstruktur, Felder, wie wird nach einem Call geloggt? Dieses Muster
   direkt übernehmen.
2. `lib/auth/` oder ähnlich — wie wird die aktuelle Session/User in
   Server-Komponenten und API-Routes ausgelesen? (`getServerSession`, `auth()` o.ä.)
3. `lib/fal/client.ts` — alle Submit-/Subscribe-Funktionen, die echte
   fal.ai-Kosten verursachen (aus Plan 8c)
4. `lib/sceneflow/render-pipeline.ts` — Einstiegspunkte für Phase 1 + Phase 2
5. `app/api/sceneflow/` — alle Routes die fal.ai-Calls auslösen
6. User-Tabelle Schema bestätigen: `role: 'admin' | 'user'` + `banned: boolean`
   (aus DB-Dump bekannt, aber echten Tabellennamen + ORM-Typ lesen)
7. Ob `paymentsCustomerId` bereits für Credits genutzt wird (wahrscheinlich nein)
8. Bestehende Middleware/Auth-Guards — wie wird heute `role === 'admin'`
   geprüft (falls überhaupt)?

---

## Was Plan 8-admin leistet

1. **Credit-Tabellen** — Migration 006: `VG_user_credits` + `VG_credit_transactions`
2. **Credit-Helper** — lesen, abziehen, aufladen, mit Transaction-Log
3. **Pre-flight Cost Estimator** — schätzt Kosten vor jedem Run ab
4. **Hard Stop** — blockiert jeden fal.ai-Call wenn Guthaben zu knapp
5. **Admin-Seite** `/admin` — User-Liste, Credits vergeben, User sperren
6. **Onboarding-Default** — neue User erhalten automatisch 500 Credits ($5.00)

---

## Datenmodell

### Migration 006

```sql
-- Filename: db/migrations/006_VG_credits.sql

-- Guthaben pro User (getrennt von Better Auth User-Tabelle)
CREATE TABLE IF NOT EXISTS public."VG_user_credits" (
  "userId"        TEXT        PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "balance"       INTEGER     NOT NULL DEFAULT 500,  -- in Cents (500 = $5.00)
  "lifetimeSpent" INTEGER     NOT NULL DEFAULT 0,
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Alle Credit-Bewegungen (Audit-Log)
CREATE TABLE IF NOT EXISTS public."VG_credit_transactions" (
  "id"          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"      TEXT        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "amount"      INTEGER     NOT NULL,  -- positiv = Aufladung, negativ = Verbrauch
  "balanceAfter" INTEGER    NOT NULL,
  "action"      TEXT        NOT NULL,
  -- z.B. 'flux_image', 'kling_video_5s', 'kling_video_10s',
  --       'sync_lipsync', 'musetalk', 'elevenlabs_tts',
  --       'admin_grant', 'onboarding_default'
  "storyId"     TEXT,       -- optional, für Kontext
  "sceneId"     TEXT,       -- optional, für Kontext
  "meta"        JSONB,      -- fal request_id, Modell-ID, etc.
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_credit_transactions_userId_idx"
  ON public."VG_credit_transactions"("userId");
CREATE INDEX IF NOT EXISTS "VG_credit_transactions_createdAt_idx"
  ON public."VG_credit_transactions"("createdAt" DESC);

-- Row Level Security
ALTER TABLE public."VG_user_credits"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."VG_credit_transactions" ENABLE ROW LEVEL SECURITY;

-- User sieht nur eigene Zeilen
CREATE POLICY "credits_own" ON public."VG_user_credits"
  FOR SELECT USING (auth.uid()::text = "userId");
CREATE POLICY "transactions_own" ON public."VG_credit_transactions"
  FOR SELECT USING (auth.uid()::text = "userId");
-- Server-Side (service_role) darf alles — kein zusätzliches Policy nötig
```

### Credit-Einheit

**1 Credit = $0.01** (Cent-genau, INTEGER in DB, keine Floating-Point-Fehler).

Anzeige im UI: `"Credits: 347"` oder `"$3.47"` — beides aus demselben Wert.

---

## Kosten-Tabelle (Schätzwerte, konservativ)

| Action | fal.ai Kosten ca. | Credits (gerundet oben) |
|---|---|---|
| `flux_image` | $0.025 | **3** |
| `kling_video_5s` | $0.85 | **90** |
| `kling_video_10s` | $1.50 | **155** |
| `sync_lipsync_5s` | $0.35 | **40** |
| `sync_lipsync_10s` | $0.60 | **65** |
| `musetalk` | $0.50 | **55** |
| `elevenlabs_tts` | $0.01 | **2** |
| `edge_tts` | $0.00 | **0** |

Diese Tabelle lebt in `lib/credits/cost-table.ts` als `const` — kein Magic
Number, einzige Quelle der Wahrheit.

---

## Feature 1 — Credit-Helper

```typescript
// lib/credits/credits.ts (server-only)

// Aktuelles Guthaben lesen
getBalance(userId: string): Promise<number>

// Guthaben prüfen ohne zu verbuchen (Pre-flight)
hasEnoughCredits(userId: string, estimatedCost: number): Promise<boolean>

// Credits verbuchen (nach erfolgreichem Call) + Transaction loggen
deductCredits(userId: string, amount: number, action: CreditAction,
              meta?: { storyId?, sceneId?, falRequestId?, modelId? }): Promise<number>
// Returns: neuer Balance. Throws wenn Balance < 0 nach Abzug.

// Credits aufladen (Admin oder Onboarding)
grantCredits(userId: string, amount: number, action: 'admin_grant' | 'onboarding_default',
             adminId?: string): Promise<number>

// Onboarding: nur wenn noch kein VG_user_credits-Eintrag existiert
initUserCredits(userId: string): Promise<void>
// → INSERT INTO VG_user_credits (userId, balance) VALUES (?, 500) ON CONFLICT DO NOTHING
// → loggt 'onboarding_default' +500
```

**Idempotenz bei deductCredits:** Vor dem Abzug prüfen ob `balance - amount >= 0`.
Wenn nicht → throw `InsufficientCreditsError`. Kein negativer Balance möglich.

---

## Feature 2 — Pre-flight Cost Estimator

```typescript
// lib/credits/estimator.ts

// Schätzt die Gesamtkosten eines Phase-1-Runs
estimatePhase1Cost(scenes: SceneRecord[], story: StoryRecord): number

// Schätzt die Gesamtkosten eines Phase-2-Runs
estimatePhase2Cost(scenes: SceneRecord[], story: StoryRecord): number

// Schätzt Einzelbild-Retry
estimateImageRetryCost(): number  // → 3 Credits (flux_image)

// Schätzt Video-Retry
estimateVideoRetryCost(scene: SceneRecord): number
// → 90 oder 155 Credits je nach duration, +40/55 wenn dialog
```

### Estimator-Logik Phase 2

```
Pro Szene:
  action:  kling_video_{duration}s
  dialog:  kling_video_{duration}s + sync_lipsync_{duration}s (oder musetalk)
  endcard: 0

Gesamt-Schätzung × 1.1 (10% Puffer für unbekannte Variablen)
```

### Hard-Stop-Schwelle

Ein Run wird geblockt wenn: `balance < estimatedCost + 100`

Der 100-Credit-Puffer ($1.00) schützt vor Kosten-Abweichungen bei langen
Videos oder Retries die während eines Runs entstehen.

---

## Feature 3 — Hard Stop in allen fal.ai-Routes

**Vor jedem fal.ai-Submit** (Phase 1 + Phase 2 + Retry):

```typescript
// In generate-images-and-voices/route.ts
const estimate = estimatePhase1Cost(scenes, story);
if (!(await hasEnoughCredits(userId, estimate + 100))) {
  return Response.json(
    { error: "You do not have sufficient credits to perform this action. " +
             `This run requires approximately ${estimate} credits, ` +
             `but your balance is ${balance}.` },
    { status: 402 }
  );
}
```

**Nach jedem erfolgreichen fal.ai-Call** (in Status-Endpoint wenn COMPLETED):

```typescript
await deductCredits(userId, COST_TABLE.kling_video_5s, 'kling_video_5s', {
  sceneId, storyId, falRequestId: request_id, modelId: story.video_model
});
```

**Hard Stop im Status-Endpoint während laufendem Run:**
Wenn beim Poll ein weiterer Step (z.B. LipSync nach Kling) gestartet werden
soll: nochmals `hasEnoughCredits` prüfen. Falls nicht → Szene auf
`status: 'paused_insufficient_credits'` setzen, kein weiteres Submit.

### Frontend-Reaktion auf HTTP 402

```typescript
if (response.status === 402) {
  const { error } = await response.json();
  showCreditErrorToast(error);  // Toast-Komponente, rot, mit Link zu "Get Credits"
  return;
}
```

Credit-Balance immer sichtbar im SceneFlow-Header: `💳 347 Credits`

---

## Feature 4 — Admin-Seite `/admin`

### Auth-Guard

```typescript
// app/admin/layout.tsx
const session = await getServerSession(); // oder bestehende Auth-Methode
if (session?.user?.role !== 'admin') {
  redirect('/');
}
```

Route ist **Server-Side-Only**. Kein Client-seitiger Role-Check als einzige
Absicherung — der Server-Guard ist primär.

### Seiten-Struktur

```
/admin                    → Dashboard (Stats-Übersicht)
/admin/users              → User-Liste mit Suche
/admin/users/[id]         → User-Detail: Credits, Transaktionen, Ban
```

### Dashboard `/admin`

```
┌─── Admin Dashboard ──────────────────────────────────────┐
│  Aktive User: 11    Gesamt Credits vergeben: 5.500        │
│  Credits verbraucht (gesamt): 234  ($2.34)                │
│  fal.ai Calls heute: 12                                   │
│                                                           │
│  Letzte Transaktionen ────────────────────────────────── │
│  [Tabelle: userId, action, amount, balanceAfter, Zeit]    │
└──────────────────────────────────────────────────────────┘
```

### User-Liste `/admin/users`

Tabelle mit Spalten:
`Name | Email | Role | Balance | Lifetime Spent | Banned | Aktionen`

Aktionen pro Zeile:
- **[Credits vergeben]** → Modal: Betrag eingeben (in Credits), Grund optional
- **[Sperren / Entsperren]** → setzt `banned = true/false` auf User-Tabelle

Suche: Live-Filter nach Name / Email (Client-seitig, kein Extra-API-Call).

### User-Detail `/admin/users/[id]`

```
┌─── Demo Admin ──────────────────────────────────────┐
│  Email: demo-admin@example.com                        │
│  Role: admin   Banned: false                              │
│                                                           │
│  Balance: 487 Credits ($4.87)                             │
│  Lifetime Spent: 13 Credits ($0.13)                       │
│                                                           │
│  [Credits vergeben: ___  Grund: ___________  [Vergeben]]  │
│  [Sperren]                                                │
│                                                           │
│  Transaktions-History ─────────────────────────────────  │
│  Datum | Action | Amount | Balance After | Story/Scene    │
│  (paginiert, 25 pro Seite)                                │
└──────────────────────────────────────────────────────────┘
```

### Admin API-Routes

```
POST /api/admin/users/[id]/grant-credits
  Body: { amount: number, reason?: string }
  Auth: role === 'admin' (server-side check)
  → grantCredits(userId, amount, 'admin_grant', adminId)

POST /api/admin/users/[id]/ban
  Body: { banned: boolean, reason?: string }
  Auth: role === 'admin'
  → UPDATE "user" SET banned = ?, banReason = ? WHERE id = ?

GET /api/admin/users
  Auth: role === 'admin'
  → Alle User + Balances (JOIN VG_user_credits)

GET /api/admin/users/[id]/transactions
  Auth: role === 'admin'
  → VG_credit_transactions WHERE userId = ? ORDER BY createdAt DESC
```

---

## Feature 5 — Onboarding-Default

Beim ersten Login / nach Registrierung: `initUserCredits(userId)` aufrufen.

Wo: im Auth-Callback oder in einem Middleware-Hook nach Session-Erstellung.
CC #1 liest die bestehende Auth-Flow-Implementierung und findet den richtigen
Einstiegspunkt (z.B. `onSignIn`-Callback in Better Auth Config).

`initUserCredits` ist idempotent (`ON CONFLICT DO NOTHING`) — kann mehrfach
aufgerufen werden ohne Schaden.

Bestehende User (ohne `VG_user_credits`-Eintrag) bekommen beim ersten
Admin-Seitenaufruf oder beim nächsten Login automatisch 500 Credits.

---

## Token-Logging nach bestehendes Muster

CC #1 liest das bestehendes Logging **zuerst** (Schritt 0) und übernimmt
Struktur + Namenskonventionen direkt. Das `meta`-JSONB-Feld in
`VG_credit_transactions` spiegelt das dortige Logging-Muster.

Ziel: Admin sieht in der Transaction-History dieselbe Informationstiefe
wie im bestehenden bestehendes Token-Log — `falRequestId`, `modelId`,
`sceneId`, `storyId` direkt verknüpfbar.

---

## Migration 006

```sql
-- Filename: db/migrations/006_VG_credits.sql
-- (vollständiger SQL-Block siehe Sektion "Datenmodell" oben)
```

---

## File Map

| Datei | Aktion |
|---|---|
| `db/migrations/006_VG_credits.sql` | CREATE |
| `lib/credits/cost-table.ts` | CREATE — Kosten-Konstanten |
| `lib/credits/credits.ts` | CREATE — getBalance, deductCredits, grantCredits, initUserCredits |
| `lib/credits/estimator.ts` | CREATE — Phase1/2 Cost Estimation |
| `app/admin/layout.tsx` | CREATE — Admin Auth-Guard |
| `app/admin/page.tsx` | CREATE — Dashboard |
| `app/admin/users/page.tsx` | CREATE — User-Liste |
| `app/admin/users/[id]/page.tsx` | CREATE — User-Detail |
| `app/api/admin/users/route.ts` | CREATE — GET alle User |
| `app/api/admin/users/[id]/grant-credits/route.ts` | CREATE |
| `app/api/admin/users/[id]/ban/route.ts` | CREATE |
| `app/api/admin/users/[id]/transactions/route.ts` | CREATE |
| `app/api/sceneflow/stories/[id]/generate-images-and-voices/route.ts` | MODIFY — Pre-flight + Deduct |
| `app/api/sceneflow/stories/[id]/generate-videos/route.ts` | MODIFY — Pre-flight + Deduct |
| `app/api/sceneflow/scenes/[id]/status/route.ts` | MODIFY — Deduct nach COMPLETED + Hard Stop |
| `app/api/sceneflow/scenes/[sceneId]/retry-image/route.ts` | MODIFY — Pre-flight |
| `app/api/sceneflow/scenes/[sceneId]/retry-video/route.ts` | MODIFY — Pre-flight |
| `components/SceneFlow/CreditDisplay.tsx` | CREATE — Balance-Anzeige im Header |
| `components/Admin/UserTable.tsx` | CREATE |
| `components/Admin/CreditGrantModal.tsx` | CREATE |
| `components/Admin/TransactionHistory.tsx` | CREATE |

---

## Tests

**`tests/unit/credits/credits.test.ts`** — ≥ 5:
- `getBalance`: gibt korrekten Wert zurück
- `deductCredits`: Balance sinkt korrekt, Transaction geloggt
- `deductCredits`: throws `InsufficientCreditsError` wenn Balance < amount
- `grantCredits`: Balance steigt, Transaction geloggt
- `initUserCredits`: idempotent (zweiter Call ändert nichts)

**`tests/unit/credits/estimator.test.ts`** — ≥ 4:
- Phase 1: 3 Szenen (2 dialog, 1 action) → korrekte Summe
- Phase 2: action → nur Kling-Kosten
- Phase 2: dialog → Kling + LipSync
- Phase 2: endcard → 0 Credits
- Hard-Stop-Schwelle: estimate + 100 > balance → `hasEnoughCredits` false

**`tests/unit/credits/hard-stop.test.ts`** — ≥ 3:
- Route gibt 402 zurück wenn Credits nicht reichen
- 402-Response enthält lesbaren Fehlertext auf Englisch
- Nach erfolgreichen fal-Call: Balance korrekt reduziert

Mindest: **≥ 12 neue Tests**

---

## Verification Gate

Baseline: **~827 Tests**.
Ziel: **≥ 839 Tests**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**
```
# Als Admin einloggen → /admin erreichbar
# Als normaler User → /admin → Redirect zu /
# Admin: User "Demo User" öffnen → Balance 500 (Onboarding-Default)
# Admin: 100 Credits vergeben → Balance 600, Transaction sichtbar
# Admin: User sperren → banned = true sichtbar
# Admin: User entsperren → banned = false
# SceneFlow: Story mit 5 Szenen → Phase-1-Button zeigt Kosten-Schätzung
# Balance auf 10 Credits setzen (Admin) → Phase-1-Button → 402 Toast sichtbar
# "You do not have sufficient credits" Meldung korrekt
# Phase 1 mit genug Credits durchlaufen → Balance sinkt, Transactions in /admin sichtbar
# fal-Request-ID in Transaction-Meta sichtbar
```

---

## Commit-Struktur

```
feat(db): migration 006 — VG_user_credits + VG_credit_transactions
feat(credits): cost-table — fal.ai Kosten-Konstanten
feat(credits): credits helper — balance, deduct, grant, init
feat(credits): estimator — Phase 1 + Phase 2 cost estimation
feat(api): admin users + grant-credits + ban routes
feat(admin): layout auth-guard + dashboard
feat(admin): users list + user detail page
feat(admin): UserTable + CreditGrantModal + TransactionHistory components
feat(sceneflow): CreditDisplay im SceneFlow-Header
feat(api): sceneflow routes — pre-flight + deduct integration
feat(auth): initUserCredits bei Onboarding
test: credits helper + estimator + hard-stop
```

---

## Out of Scope (kommt später)

- Lemon Squeezy Webhooks → automatisches Aufladen nach Zahlung
- Credit-Pakete / Preisseite
- Per-Story Budget-Cap (User setzt selbst ein Limit)
- fal.ai Webhook statt Polling (für noch genauere Kosten-Abrechnung)

---

Abgabe: `2026-05-25-vibegrid-plan-8-admin-credits.md`
