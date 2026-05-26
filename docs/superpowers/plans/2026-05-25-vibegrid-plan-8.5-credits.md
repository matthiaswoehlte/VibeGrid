# CC #1 Prompt — Plan 8.5: Credit-System (vor 8c-Live)

**Priorität: Sofort — kein 8c-Testlauf ohne diesen Plan.**
Plan 8.6 (Admin-UI) folgt danach. Für den 8c-Test reicht direktes SQL-Grant.

> Revision 4 — 2026-05-25
> Rev. 2: B1–B4, W3–W8, D1–D5, E1–E3 aus erstem Review.
> Rev. 3: W1–W6, D1–D4, E1–E3 aus zweitem Review.
> Rev. 4: W1-Residual (Blocker: settled_reserve_id-Linkage), W2-R, W3-R, D1-R, D2-R, D3-R.

---

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Baseline: HEAD post-Plan-8c (**861 Tests**, Store v6, fal.ai-Pipeline
implementiert, noch nicht getestet).

Schreibe nur den **Plan** — noch keinen Code.

---

## Schritt 0 — Codebase lesen (vor Plan schreiben)

CC #1 liest und dokumentiert:

1. `db/migrations/001_VG_projects.sql` Z. 7–11 — Authz-Kommentar (RLS-Pattern).
2. `db/migrations/002_VG_sceneflow.sql` Z. 96 — `status CHECK`-Constraint.
3. `lib/sceneflow/scenes-db.ts`:
   - `setNeutralVideoUrlAndClaimLipsync` — atomic JSONB-Guard (Vorbild B2)
   - `patchSceneRender({ onlyIfNull })` — Idempotenz-Muster (Vorbild W4)
4. `lib/sceneflow/validation.ts` Z. 24–28 — Signatur-Vorbild (W7: characters[])
5. `app/api/sceneflow/stories/[id]/status-all/route.ts` — Response-Struktur
6. `app/api/sceneflow/stories/[id]/route.ts` — PATCH-Handler (für E3: creditBudget)
7. Alle fal.ai-Submit-Einstiegspunkte aus Plan 8c (5 Routes)

---

## Was Plan 8.5 leistet

1. **Migration 006** — `VG_user_credits` + `VG_credit_transactions`
2. **Credit-Helper** — vollständige Public API mit atomic decrement + Reserve-Pattern
3. **Pre-flight Estimator** — Kosten schätzen + Hard Stop
4. **Deduct-Integration** in alle sceneflow-Routes
5. **CreditDisplay** im SceneFlow-Header (via status-all-Piggyback)
6. **Per-Story Budget-Cap** — User-selbst-gesetztes Limit

**Nicht in diesem Plan:** Admin-UI → Plan 8.6.
Testguthaben für 8c-Test per SQL:
```sql
INSERT INTO public."VG_user_credits" (user_id, balance)
VALUES ('deine-user-id', 10000)
ON CONFLICT (user_id) DO UPDATE SET balance = 10000;
```

---

## Datenmodell

### Migration 006 — snake_case, UUID, korrekte RLS

```sql
-- Filename: db/migrations/006_VG_credits.sql
-- Authz: Better-Auth (kein Supabase Auth, auth.uid() always NULL).
-- Pattern wie 001–005: deny anon/authenticated, grant service_role.
-- Per-User-Scope via WHERE user_id = $1 im API-Layer.

CREATE TABLE IF NOT EXISTS public."VG_user_credits" (
  user_id         TEXT        PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  balance         INTEGER     NOT NULL DEFAULT 500 CHECK (balance >= 0),
  lifetime_spent  INTEGER     NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."VG_credit_transactions" (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  amount          INTEGER     NOT NULL,
  -- positiv = Aufladung/Refund, negativ = Verbrauch/Reserve
  balance_after   INTEGER     NOT NULL,
  action          TEXT        NOT NULL,
  -- 'flux_image' | 'kling_video_5s' | 'kling_video_10s'
  -- | 'sync_lipsync_5s' | 'sync_lipsync_10s' | 'musetalk' | 'elevenlabs_tts' | 'edge_tts'
  -- | 'reserve' | 'reserve_settle' | 'reserve_refund'
  -- | 'admin_grant' | 'onboarding_default'
  -- [Fix D2] 'story_budget_refund' entfernt — kein definierter Trigger
  story_id        TEXT,
  scene_id        TEXT,
  meta            JSONB,
  -- { fal_request_id, model_id, duration_sec, fal_cost_usd_cents,
  --   reserved_amount, overage_credits,
  --   settled_reserve_id?: string,  -- kommagetrennte UUIDs der gesettleten reserve-Transactions
  --   reason?: string               -- z.B. 'implicit_cancel_on_retry'
  -- }
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_credit_transactions_user_id_idx"
  ON public."VG_credit_transactions"(user_id);
CREATE INDEX IF NOT EXISTS "VG_credit_transactions_created_at_idx"
  ON public."VG_credit_transactions"(created_at DESC);
CREATE INDEX IF NOT EXISTS "VG_credit_transactions_scene_id_idx"
  ON public."VG_credit_transactions"(scene_id)
  WHERE scene_id IS NOT NULL;  -- für getOpenReserve-Query

-- RLS — selbes Pattern wie 001_VG_projects.sql
ALTER TABLE public."VG_user_credits"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."VG_credit_transactions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "VG_policy_user_credits_deny_anon"
  ON public."VG_user_credits"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "VG_policy_credit_transactions_deny_anon"
  ON public."VG_credit_transactions"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

GRANT ALL ON public."VG_user_credits"        TO service_role;
GRANT ALL ON public."VG_credit_transactions" TO service_role;
REVOKE ALL ON public."VG_user_credits"        FROM anon, authenticated;
REVOKE ALL ON public."VG_credit_transactions" FROM anon, authenticated;

-- VG_story_scenes CHECK-Constraint unverändert — kein neuer Status-Enum
-- Insufficient-Credits → status='error', error_message='insufficient credits'

-- Per-Story Budget-Cap
ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS credit_budget INTEGER DEFAULT NULL;
  -- NULL = kein Limit. Positiver Wert = max Credits für diese Story.
```

### Credit-Einheit

**1 Credit = $0.01 (Cent).** 500 Credits = $5.00.
`CHECK (balance >= 0)` — negativer Balance DB-seitig unmöglich.

---

## Kosten-Tabelle

```typescript
// lib/credits/cost-table.ts
// Stand: 2026-05-25 · Quelle: fal.ai pricing page
// Konservativ gerundet (aufwärts auf nächsten vollen Cent).

export const COST_TABLE = {
  flux_image:       3,    // $0.025/Bild → 3¢
  kling_video_5s:   90,   // $0.85/5s-Clip → 90¢
  kling_video_10s:  155,  // $1.50/10s-Clip → 155¢
  sync_lipsync_5s:  40,   // $0.35/5s → 40¢
  sync_lipsync_10s: 65,   // $0.60/10s → 65¢
  musetalk:         55,   // $0.50/Clip → 55¢
  elevenlabs_tts:   2,    // $0.01/Call → 2¢
  edge_tts:         0,    // kostenlos
} as const;

export type CreditAction =
  | keyof typeof COST_TABLE
  | 'reserve' | 'reserve_settle' | 'reserve_refund'
  | 'admin_grant' | 'onboarding_default';
  // [Fix D2] 'story_budget_refund' entfernt

export const SAFETY_BUFFER = 100; // $1.00 — Hard-Stop-Puffer
```

---

## Feature 1 — Credit-Helper

### [Fix E1] Vollständige Public API — Überblick

```typescript
// lib/credits/credits.ts (server-only)
// Vorbild: setNeutralVideoUrlAndClaimLipsync + patchSceneRender in scenes-db.ts

// [Fix W6] Hot-Path: nur SELECT, kein UPSERT — für status-all (alle 5 s)
export async function readBalance(userId: string): Promise<number>
// → SELECT balance FROM VG_user_credits WHERE user_id = $1
// → gibt 0 zurück wenn keine Row

// Lazy Init + onboarding_default — für Submit-Paths (schreiben sowieso)
export async function getBalance(userId: string): Promise<number>
// CTE: UPSERT + onboarding_default-Transaction + SELECT

// Aufladung — Admin-Grant, Refunds
export async function grantCredits(
  userId: string, amount: number, action: CreditAction, meta?: object
): Promise<number>

// Atomarer Abzug — direkte Calls (FLUX, TTS, Retry)
export async function deductCredits(
  userId: string, amount: number, action: CreditAction, meta?: object
): Promise<number>

// Reserve bei langläufigem Submit
export async function reserveCredits(
  userId: string, amount: number,
  meta: { story_id: string, scene_id: string, model_id: string }
): Promise<number>

// Settle nach COMPLETED — sceneId → getOpenReserveRows intern [Fix W1-Residual]
export async function settleReserve(
  userId: string, sceneId: string, actual: number, meta: object
): Promise<void>

// Refund nach FAILED/CANCELLED [Fix W3-R]
export async function refundReserve(
  userId: string, sceneId: string, meta: object
): Promise<void>

// Summe offener Reserves (für Anzeige / Pre-flight)
export async function getOpenReserve(sceneId: string): Promise<number>

// Budget-Auswertung
export async function getStorySpend(storyId: string): Promise<number>

// Interne Helpers (nicht exportiert):
// getOpenReserveRows(sceneId): Promise<{id,amount}[]>  — IDs + Beträge für settled_reserve_id [Fix W1-Residual]
// logTransaction(userId, amount, balanceAfter, action, meta?): Promise<void> [Fix W3-R]
```

---

### getBalance — Lazy Init mit CTE-Onboarding-Log

**[Fix W3]** Onboarding-Transaction wird atomar im selben Statement geloggt:

```typescript
async function getBalance(userId: string): Promise<number> {
  // CTE: UPSERT + sofortige Transaction-Logging wenn neu angelegt
  await db.query(`
    WITH ins AS (
      INSERT INTO public."VG_user_credits" (user_id, balance)
      VALUES ($1, 500)
      ON CONFLICT (user_id) DO NOTHING
      RETURNING user_id, balance
    )
    INSERT INTO public."VG_credit_transactions"
      (user_id, amount, balance_after, action)
    SELECT user_id, balance, balance, 'onboarding_default' FROM ins
  `, [userId]);

  const { rows } = await db.query(
    `SELECT balance FROM public."VG_user_credits" WHERE user_id = $1`,
    [userId]
  );
  return rows[0].balance;
}
```

---

### deductCredits — Atomic + Postgres-CHECK-Catch

**[Fix B2, Fix E2]:**

```typescript
async function deductCredits(
  userId: string, amount: number, action: CreditAction, meta?: object
): Promise<number> {
  try {
    const { rows, rowCount } = await db.query(`
      UPDATE public."VG_user_credits"
      SET balance        = balance - $1,
          lifetime_spent = lifetime_spent + $1,
          updated_at     = now()
      WHERE user_id = $2 AND balance >= $1
      RETURNING balance
    `, [amount, userId]);

    if (rowCount === 0) throw new InsufficientCreditsError(userId, amount);

    const newBalance = rows[0].balance;
    await logTransaction(userId, -amount, newBalance, action, meta);
    return newBalance;
  } catch (err: any) {
    // [Fix E2] Postgres CHECK-Constraint (balance >= 0) als Fallback
    if (err.code === '23514') throw new InsufficientCreditsError(userId, amount);
    throw err;
  }
}
```

---

### grantCredits — SQL explizit

**[Fix W4]:**

```typescript
async function grantCredits(
  userId: string, amount: number, action: CreditAction, meta?: object
): Promise<number> {
  const { rows } = await db.query(`
    UPDATE public."VG_user_credits"
    SET balance    = balance + $1,
        updated_at = now()
    WHERE user_id  = $2
    RETURNING balance
  `, [amount, userId]);

  if (rows.length === 0) throw new Error(`User credits row not found: ${userId}`);
  const newBalance = rows[0].balance;
  await logTransaction(userId, +amount, newBalance, action, meta);
  return newBalance;
}
```

---

### Reserve-Pattern für langläufige Jobs

**[Fix W1-Residual]** `getOpenReserve` braucht die Transaction-IDs um Settle/Refund
korrekt als "verarbeitet" zu markieren. Zwei interne Helpers:

```typescript
// Interne Helper — nicht in Public API

// Gibt offene Reserve-Rows zurück (noch nicht gesettlet/refundet)
async function getOpenReserveRows(
  sceneId: string
): Promise<Array<{ id: string, amount: number }>> {
  const { rows } = await db.query(`
    SELECT id, amount
    FROM public."VG_credit_transactions"
    WHERE scene_id = $1
      AND action   = 'reserve'
      AND id::text NOT IN (
        SELECT COALESCE(meta->>'settled_reserve_id', '')
        FROM public."VG_credit_transactions"
        WHERE scene_id = $1
          AND action IN ('reserve_settle', 'reserve_refund')
      )
  `, [sceneId]);
  return rows;
}

// Summe der offenen Reserves (für Pre-flight-Anzeige)
async function getOpenReserve(sceneId: string): Promise<number> {
  const rows = await getOpenReserveRows(sceneId);
  return rows.reduce((s, r) => s + (-r.amount), 0);
}

// [W3-R] logTransaction — interner Helper
async function logTransaction(
  userId: string,
  amount: number,
  balanceAfter: number,
  action: CreditAction,
  meta?: object
): Promise<void> {
  await db.query(`
    INSERT INTO public."VG_credit_transactions"
      (user_id, amount, balance_after, action, story_id, scene_id, meta)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    userId, amount, balanceAfter, action,
    (meta as any)?.story_id  ?? null,
    (meta as any)?.scene_id  ?? null,
    meta ? JSON.stringify(meta) : null
  ]);
}
```

**[Fix W1-Residual]** `settleReserve` emittiert in **allen drei Zweigen** eine
`reserve_settle`-Transaction mit `settled_reserve_id` — sonst bleiben Reserves
ewig "offen" in `getOpenReserveRows`:

```typescript
async function settleReserve(
  userId: string, sceneId: string, actual: number, meta: object
): Promise<void> {
  const open = await getOpenReserveRows(sceneId);
  if (open.length === 0) return;
  const reserved     = open.reduce((s, r) => s + (-r.amount), 0);
  const settledIds   = open.map(r => r.id).join(',');
  const currentBal   = await readBalance(userId);

  if (actual < reserved) {
    // Differenz zurückgeben
    await grantCredits(userId, reserved - actual, 'reserve_settle', {
      ...meta, reserved_amount: reserved, settled_reserve_id: settledIds
    });
  } else if (actual > reserved) {
    // [Fix W2-R] kein -1-Sentinel — frischer Balance via readBalance
    console.warn(`Credit overage scene ${sceneId}: reserved=${reserved} actual=${actual}`);
    await logTransaction(userId, 0, currentBal, 'reserve_settle', {
      ...meta, reserved_amount: reserved,
      overage_credits: actual - reserved, settled_reserve_id: settledIds
    });
  } else {
    // actual === reserved — Null-Transaction als "verarbeitet"-Marker [Fix W1-Residual]
    await logTransaction(userId, 0, currentBal, 'reserve_settle', {
      ...meta, reserved_amount: reserved, settled_reserve_id: settledIds
    });
  }
}

// [Fix W3-R] refundReserve — vollständiger Code-Block
async function refundReserve(
  userId: string, sceneId: string, meta: object
): Promise<void> {
  const open = await getOpenReserveRows(sceneId);
  if (open.length === 0) return;
  const total      = open.reduce((s, r) => s + (-r.amount), 0);
  const settledIds = open.map(r => r.id).join(',');
  await grantCredits(userId, total, 'reserve_refund', {
    ...meta, settled_reserve_id: settledIds
  });
}
```
```

**[Fix W4]** Deduct nur wenn `patchSceneRender.rowCount === 1`:

```typescript
// In GET /api/sceneflow/scenes/[sceneId]/status
const patched = await patchSceneRender(sceneId, { videoUrl, onlyIfNull: true });
if (patched.rowCount === 1) {
  await settleReserve(userId, sceneId, COST_TABLE.kling_video_5s, meta);
}
// rowCount === 0 → anderer Poller war schneller → kein Deduct, kein Logging
```

**[Fix W5]** Retry vor neuem Reserve immer alten Refunden:

```typescript
// In POST /api/sceneflow/scenes/[sceneId]/retry-video
// Schritt 1: alte offene Reserve refunden (falls IN_PROGRESS bei fal)
const openReserve = await getOpenReserve(sceneId);
if (openReserve > 0) {
  await refundReserve(userId, sceneId, { reason: 'implicit_cancel_on_retry' });
}
// Schritt 2: neue Reserve für den Retry-Call buchen
await reserveCredits(userId, estimatedCost, meta);
```

---

### getStorySpend — SQL explizit

**[Fix W4]:**

```typescript
async function getStorySpend(storyId: string): Promise<number> {
  const { rows } = await db.query(`
    SELECT COALESCE(SUM(-amount), 0)::int AS spent
    FROM public."VG_credit_transactions"
    WHERE story_id = $1
      AND action IN (
        'flux_image', 'kling_video_5s', 'kling_video_10s',
        'sync_lipsync_5s', 'sync_lipsync_10s', 'musetalk',
        'elevenlabs_tts', 'reserve'
      )
  `, [storyId]);
  // 'reserve' zählt mit — zeigt real reservierten Stand vor Settle
  return rows[0].spent;
}
```

---

### Refund-on-Failure-Policy

| fal-Job-Status | Credit-Aktion |
|---|---|
| `COMPLETED` | `settleReserve(userId, sceneId, actual, meta)` |
| `FAILED` | `refundReserve(userId, sceneId, meta)` |
| `CANCELLED` | `refundReserve(userId, sceneId, meta)` |
| Retry | `refundReserve` alte Reserve → `reserveCredits` neue Reserve [Fix W5] |

---

## Feature 2 — Pre-flight Estimator

```typescript
// lib/credits/estimator.ts
// Analog zu validateScenesForGeneration(scenes, story, characters)

export function estimatePhase1Cost(
  scenes: SceneRecord[],
  story: StoryRecord,
  characters: CharacterRecord[]  // für voice_provider-Lookup
): number

export function estimatePhase2Cost(
  scenes: SceneRecord[],
  story: StoryRecord
): number
```

**Estimator-Logik:**
```
Phase 1 pro Szene:
  image: COST_TABLE.flux_image (alle außer endcard)
  audio: character.voice_provider === 'elevenlabs' → elevenlabs_tts
         character.voice_provider === 'edge'       → edge_tts (0)

Phase 2 pro Szene:
  action:  kling_video_{duration}s
  dialog:  kling_video_{duration}s + sync_lipsync_{duration}s
           (oder musetalk je story.lipsync_model)
  endcard: 0

Gesamt × 1.1 (10%-Puffer), aufgerundet auf ganzen Credit.
```

### Hard Stop — Pre-flight als Comfort-Check

**[Fix D4]** Pre-flight ist informativ (für Fehlertext). Atomic Reserve ist die
verbindliche Prüfung. Bei `InsufficientCreditsError` auf Reserve → 402 mit
frisch gelesenem Balance:

```typescript
// Vor Phase-2-Submit
const estimate = estimatePhase2Cost(scenes, story);
const balance  = await readBalance(userId);  // [Fix W6] kein Lazy-Init-Overhead

// Comfort-Check (für lesbaren Fehlertext im Pre-flight)
if (balance < estimate + SAFETY_BUFFER) {
  return Response.json({
    error: `You do not have sufficient credits to perform this action. ` +
           `This run requires approximately ${estimate} credits ` +
           `(plus a $1.00 safety buffer), but your current balance is ${balance} credits.`
  }, { status: 402 });
}

// Atomic Reserve (verbindliche Prüfung — kann trotzdem scheitern bei Race)
try {
  await reserveCredits(userId, estimate, meta);
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    const freshBalance = await readBalance(userId);
    return Response.json({
      error: `You do not have sufficient credits to perform this action. ` +
             `Your current balance is ${freshBalance} credits.`
    }, { status: 402 });
  }
  throw err;
}
```

### Per-Story Budget-Cap

```typescript
if (story.credit_budget !== null) {
  const alreadySpent = await getStorySpend(storyId);
  const remaining    = story.credit_budget - alreadySpent;
  if (estimate > remaining) {
    return Response.json({
      error: `This run would exceed your story budget of ${story.credit_budget} credits. ` +
             `Already spent: ${alreadySpent}. Estimated cost: ${estimate}.`
    }, { status: 402 });
  }
}
```

Budget-Cap-Feld im SceneFlow Story-Setup editierbar (optional, leer = kein Limit).

---

## Feature 3 — Integration in alle fal.ai-Routes

| Route | Aktion |
|---|---|
| `POST generate-images-and-voices` | `readBalance` pre-flight → FLUX: `deductCredits` direkt nach `fal.subscribe` |
| `POST generate-videos` | `readBalance` pre-flight → `reserveCredits` pro Szene |
| `GET scenes/[sceneId]/status` | COMPLETED: `settleReserve` wenn `patchSceneRender.rowCount===1`. FAILED: `refundReserve`. |
| `POST retry-image` | `readBalance` pre-flight (3 Credits) → `deductCredits` nach Erfolg |
| `POST retry-video` | `refundReserve` alte Reserve → `readBalance` pre-flight → `reserveCredits` |

**Frontend bei HTTP 402:** Toast (rot), Text aus `error`-Feld.
Bestehende Toast-Infrastruktur — keine neue Komponente.

---

## Feature 4 — CreditDisplay

**[Fix W6]** `status-all`-Route ruft `readBalance(userId)` (nur SELECT):

```typescript
// Response erweitert:
{ scenes: SceneStatusPayload[], balance: number }
```

`CreditDisplay.tsx` liest `balance` aus dem 5-s-Poll — kein eigener Endpoint.
Anzeige: `💳 487 Credits` — im SceneFlow-Header rechts.

---

## File Map

| Datei | Aktion |
|---|---|
| `db/migrations/006_VG_credits.sql` | CREATE |
| `lib/credits/cost-table.ts` | CREATE |
| `lib/credits/credits.ts` | CREATE — readBalance, getBalance (CTE-lazy-init), grantCredits, deductCredits (atomic + 23514-catch), reserveCredits, getOpenReserve, settleReserve, refundReserve, getStorySpend |
| `lib/credits/estimator.ts` | CREATE — estimatePhase1Cost, estimatePhase2Cost |
| `app/api/sceneflow/stories/[id]/generate-images-and-voices/route.ts` | MODIFY — pre-flight + deduct |
| `app/api/sceneflow/stories/[id]/generate-videos/route.ts` | MODIFY — pre-flight + reserve |
| `app/api/sceneflow/scenes/[sceneId]/status/route.ts` | MODIFY — settle/refund (onlyIfNull-guard) + NODE_ENV-gated `?simulateStatus` query param [Fix D3] |
| `app/api/sceneflow/stories/[id]/status-all/route.ts` | MODIFY — balance via readBalance |
| `app/api/sceneflow/stories/[id]/route.ts` | MODIFY — PATCH: creditBudget-Feld [Fix E3] |
| `app/api/sceneflow/scenes/[sceneId]/retry-image/route.ts` | MODIFY — pre-flight |
| `app/api/sceneflow/scenes/[sceneId]/retry-video/route.ts` | MODIFY — refund-old-reserve + pre-flight + reserve |
| `components/SceneFlow/CreditDisplay.tsx` | CREATE |

---

## Tests

**`tests/unit/credits/credits.test.ts`** — ≥ 10:
- `getBalance`: lazy init — neuer User bekommt 500 Credits, `onboarding_default` geloggt
- `getBalance`: idempotent — zweiter Call ändert nichts, kein zweiter Transaction-Log
- `getBalance` (parallel × 2 für neuen User): genau **1** `onboarding_default`-Transaction [Fix D3-R]
- `readBalance`: gibt 0 zurück wenn kein Row (kein UPSERT)
- `deductCredits` (atomic): Balance sinkt korrekt, Transaction geloggt
- `deductCredits`: wirft `InsufficientCreditsError` bei `balance < amount`
- `deductCredits`: normalisiert Postgres-23514 zu `InsufficientCreditsError`
- `reserveCredits` → `settleReserve` (actual < reserved): Differenz zurückgegeben, `settled_reserve_id` gesetzt [Fix W1-Residual]
- `reserveCredits` → `settleReserve` (actual === reserved): Null-Marker-Transaction emittiert, `settled_reserve_id` gesetzt [Fix W1-Residual]
- `reserveCredits` → `settleReserve` (actual > reserved): Overage geloggt, kein Crash, kein -1 in `balance_after` [Fix W2-R]
- `refundReserve`: volle Reserve zurückgebucht, `settled_reserve_id` gesetzt [Fix W3-R]
- `getOpenReserve`: gibt 0 nach `settleReserve` zurück (nicht doppelt zählen) [Fix W1-Residual]

**`tests/unit/credits/estimator.test.ts`** — ≥ 5:
- Phase 1: 2 Dialog (ElevenLabs) + 1 Action → korrekte Summe inkl. 10%-Puffer
- Phase 1: Edge TTS → 0 Credits für Audio
- Phase 2: Action 5s → 90 Credits
- Phase 2: Dialog 5s (sync-lipsync) → 130 Credits
- Phase 2: Endcard → 0 Credits

**`tests/unit/credits/hard-stop.test.ts`** — ≥ 5:
- 402 wenn `readBalance < estimate + SAFETY_BUFFER`
- Fehlertext enthält estimate + balance
- Atomic-Reserve scheitert bei Race → 402 mit frischem Balance
- Story-Budget-Cap: 402 wenn estimate > remainingBudget
- PATCH `/api/sceneflow/stories/[id]` mit `{ creditBudget: 1000 }` → `story.credit_budget = 1000` [Fix D1-R]
- PATCH mit `{ creditBudget: null }` → `story.credit_budget = NULL` (Cap entfernt) [Fix D1-R]

**`tests/unit/credits/idempotency.test.ts`** — ≥ 3:
- `patchSceneRender.rowCount === 0` → kein settle, kein Logging
- Zwei parallele Deduct-Calls → nur einer erfolgreich
- Retry: `getOpenReserve > 0` → refund vor neuem reserve [Fix W5]

**`tests/unit/credits/refund-on-failure.test.ts`** — ≥ 2: [Fix D1]
- Status-Endpoint: fal-Status FAILED → `refundReserve` aufgerufen, Transaction geloggt
- Status-Endpoint: fal-Status COMPLETED + `rowCount===0` → kein settle (anderer Poller)

Mindest: **≥ 25 neue Tests**

---

## Verification Gate

Baseline: **861 Tests**.
Ziel: **≥ 886 Tests**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**
```
# Balance 10 setzen (SQL) → Phase-1-Button → 402-Toast sichtbar
# Text enthält Estimate + Balance — lesbar auf Englisch
# Story-Budget auf 50 Credits → 5-Szenen-Run → 402 wegen Budget-Cap
# Balance 10000 → Phase 1 → Bilder erscheinen → Balance sinkt in DB
# Transaction-Log: onboarding_default + flux_image-Einträge sichtbar
# status-all-Response enthält balance-Feld → CreditDisplay aktualisiert
# Phase 2 → Reserve gebucht → COMPLETED + patchSceneRender.rowCount===1 → settle
# reserve_settle-Transaction sichtbar, Differenz korrekt
# Retry-Video → alter reserve_refund + neuer reserve in Transactions
# Zwei parallele Polls (DevTools: 2×status-call) → nur ein settle in Transaction-Log
# [Fix D3] FAILED simulieren: im Status-Endpoint ?simulateStatus=FAILED
#   (nur NODE_ENV !== 'production') → refund sichtbar
```

**[Fix D3] Test-Seam für FAILED-Simulation:**
```typescript
// In GET /api/sceneflow/scenes/[sceneId]/status/route.ts
const simulatedStatus = process.env.NODE_ENV !== 'production'
  ? url.searchParams.get('simulateStatus')
  : null;
const jobStatus = simulatedStatus ?? await fal.queue.status(...);
```

---

## Commit-Struktur

```
feat(db): migration 006 — VG_user_credits + VG_credit_transactions
feat(credits): cost-table — fal.ai Kosten (Stand 2026-05-25)
feat(credits): credits — readBalance, getBalance CTE, deduct atomic, reserve/settle/refund
feat(credits): estimator — Phase1/2 mit characters[]
feat(api): sceneflow routes — pre-flight + reserve/settle/refund + retry-refund
feat(api): status-all — readBalance in Response
feat(api): stories PATCH — creditBudget-Feld
feat(sceneflow): CreditDisplay — balance im Header
test: credits + estimator + hard-stop + idempotency + refund-on-failure
```

---

## Out of Scope → Plan 8.6

- Admin-UI (`/admin`-Seiten + API-Routes)
- `requireAdminSession`-Helper
- User sperren / Credits manuell vergeben über UI

---

Abgabe: `2026-05-25-vibegrid-plan-8.5-v3-credits.md`
