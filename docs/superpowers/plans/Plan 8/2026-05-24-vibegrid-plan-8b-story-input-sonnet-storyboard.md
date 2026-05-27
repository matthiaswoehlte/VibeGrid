# VibeGrid Plan 8b — Story-Input + Sonnet-Aufteilung + Storyboard

> **For agentic workers:** Plan execution policy (overrides skill defaults):
> direct-on-main, sequential, one commit per task, optional final review.
> NO subagent ceremony. CC #2 (tester) verifies live in parallel.

**Goal:** Die in Plan 8a angelegte leere SceneFlow-Shell füllt sich mit
Leben: Story-Detail-Navigation, Setup-Form (Titel/Format/Stil/Charaktere),
Freitext-Story-Input mit `@`-Validierung, **Sonnet-gestützte Szenen-
Aufteilung via Tool-Use + Prompt-Caching**, vollständiges Szenen-CRUD,
editierbarer Storyboard-View mit Karten und Endcard-Editor. **Keine
fal.ai-Calls** — Bilder/Videos sind in Plan 8c.

**Architecture:** Wiederverwendung des Anthropic-Stacks aus
`lib/ai/anthropic.ts` (Auto-Preset, Plan 5.8) — Singleton-Client mit
`getAnthropicConfig()`, Model `claude-sonnet-4-6`. Sonnet liefert Output
über Tool-Use, der Server validiert/coerced jede Szene gegen die
Character-Liste, schreibt atomar in einer Transaction. Mode-Switch
innerhalb der existierenden SceneFlow-Shell — kein eigenes Routing,
`activeStoryId`-State im lokalen Component-State.

**Tech Stack:** Next.js 14 + Better-Auth (Plan 7) + Supabase Postgres +
Zustand + Tailwind + `@anthropic-ai/sdk@^0.30.1` (bereits installiert,
Plan 5.8 + Plan 8b nutzen denselben Client).

---

## Context

Baseline: HEAD post-Plan-8a + Workspace-Layout-Fix (`002f5ba`).
**754 Tests** grün, Store v6, Better-Auth in Production, VG_characters
+ VG_stories + VG_story_scenes als Tabellen vorhanden mit RLS-Lockdown.
SceneFlow-Tab zeigt aktuell `+ Neue Story` + Story-Kacheln; Klick auf
eine Kachel macht **nichts** (kein `onSelect`).

Plan 8a war reine Infrastruktur. Plan 8b ist der erste richtige
KI-Funktionsumfang in SceneFlow: User beschreibt Story als Freitext,
Sonnet zerlegt sie in ~5-15 Szenen mit ausformulierten Bild-Prompts,
Kamera-Parametern, Dialog-Texten. Der User editiert nach.

### Codebase-Analyse (Schritt 0 durchgeführt)

| Befund | Konsequenz für Plan 8b |
|---|---|
| `@anthropic-ai/sdk@^0.30.1` bereits installiert (Plan 5.8 Auto-Preset) | Kein Install-Schritt nötig |
| `ANTHROPIC_API_KEY` bereits in `.env.example` Zeile 27 | Kein `.env.example`-Edit |
| `lib/ai/anthropic.ts` hat lazy-Singleton `getClient()` + `analyzeImageForFx()` | `getClient` wird exportiert (`getAnthropicClient`), Sceneflow-Funktion lebt daneben in `lib/sceneflow/sonnet.ts` |
| `lib/ai/env.ts` exportiert `getAnthropicConfig()` mit Model-Pin `claude-sonnet-4-6` | Wiederverwendet, kein Parallel-Env-Handling |
| `app/api/analyze-image/route.ts` ist die einzige existierende Anthropic-API-Route | Pattern (`runtime='nodejs'`, Session-Check via auth, Error-Mapping) kopiert |
| `VG_stories` hat **keine** `characters`- und keine `story_text`-Spalte | Migration 003 hinzufügen (JSONB + TEXT) |
| `VG_story_scenes` hat 25 Felder, davon ~10 Sonnet-relevant | Mapping-Tabelle im Server: Sonnet-Subset → DB-Vollset |
| `stories-db.ts` hat nur `create/list/delete`, kein `updateStory`/`loadStory` | Beide hinzufügen + PATCH-Route |
| `characters-db.ts` hat keine bulk-by-ids-Query | `listCharactersByIds(userId, ids[])` hinzufügen (Architekt: gehört zu characters-db, nicht stories-db) |
| `app/api/sceneflow/stories/[id]/route.ts` hat nur DELETE | PATCH hinzufügen |
| `SceneFlowShell` mountet nur StoryList + Charaktere-Button + NewStoryButton, **kein** Story-Detail | Conditional-Render auf `activeStoryId` |
| `StoryList` rendert Kacheln ohne `onSelect`-Handler | Prop ergänzen, Kachel wird Button |

---

## Goal — Sieben Features

1. **Story-Detail-Navigation** (Klick-Kachel → DetailView, ← Zurück)
2. **Story-Setup-Form** (Titel/Format/Stil/Charaktere) mit PATCH-Persistenz
3. **Story-Text-Eingabe** + `@`-Validierung + "Mit KI aufteilen"-Button
4. **Sonnet-Aufteilung** via Tool-Use, Prompt-Cache, Coerce-Guardrails
5. **Szenen-CRUD** (server-side bulk-insert + JOIN-Ownership, REST API)
6. **Storyboard-View** mit editierbaren Szenen-Karten + Endcard-Editor
7. **AbortController-PATCH-Pipeline** (debounced, Last-Write-Wins)

## Out of Scope

- **fal.ai Image-Gen / Video-Gen / LipSync** → Plan 8c
- **TTS** (Azure + ElevenLabs) → Plan 8c
- **End-Frame-Extraktion + `start_frame_url`-Pipeline** → Plan 8c
- **Retry-Buttons** auf Szenen-Karten (disabled in 8b, aktiv in 8c)
- **"In VibeGrid öffnen"**-Transfer von SceneFlow-Output in VibeGrid-Timeline → Plan 8d
- **Drag-and-Drop Szenen-Reihenfolge** → nach Praxis-Feedback, nur [↑][↓]-Buttons in 8b
- **Merge-Logik bei Re-Generate** — Plan 8b ist destruktiv (alte Szenen weg) mit Confirm. Merge kommt wenn Bedarf da ist
- **`cta_text` als eigene Spalte** für Endcards — Plan 8b nutzt `tts_text`-Slot, eigene Spalte in späterem Plan

---

## Architecture insights

### 1. Anthropic-Client-Wiederverwendung

`lib/ai/anthropic.ts` hat aktuell `getClient()` als file-private Helper.
Plan 8b exportiert ihn als `getAnthropicClient()` plus passenden
Test-Reset-Hook. Das ist die einzige Änderung an dem File. Plan-8b-
spezifische Logik lebt in `lib/sceneflow/sonnet.ts`:

```ts
// lib/sceneflow/sonnet.ts
import 'server-only';
import { getAnthropicClient, getAnthropicConfig } from '@/lib/ai/anthropic';
// ...generateScenesViaSonnet(...) implementation
```

Gleicher Singleton, gleicher API-Key-Throw, gleiche Test-Mock-
Strategie. Memory + DRY: zwei AI-Features (Auto-Preset, Sceneflow)
teilen sich denselben Client.

### 2. Sonnet-Output via Tool-Use, NICHT "Antworte nur mit JSON"

Anthropic-SDK kann `tools: [...]` mit JSON-Schema definieren. Das
Modell ruft das Tool mit garantiert-schema-konformem Argument auf —
keine Markdown-Fences, keine Erklärungen davor/danach, keine
abgeschnittenen JSON-Trailer bei langem Output.

```ts
const tool = {
  name: 'submit_scenes',
  description: 'Submit the structured scene list for the story.',
  input_schema: { /* siehe Task 9 unten */ }
} as const;

const res = await cli.messages.create({
  model: cfg.model,
  max_tokens: 16000,
  system: [
    { type: 'text', text: SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' } },
    { type: 'text', text: characterContext,
      cache_control: { type: 'ephemeral' } }
  ],
  tools: [tool],
  tool_choice: { type: 'tool', name: 'submit_scenes' },
  messages: [{ role: 'user', content: storyText }]
});
```

Response-Parsing:
```ts
const block = res.content.find((b) => b.type === 'tool_use' && b.name === 'submit_scenes');
if (!block || block.type !== 'tool_use') {
  throw new Error('Sonnet did not call submit_scenes');
}
const raw = block.input as { scenes: SonnetSceneShape[] };
```

### 3. Hallucination-Guardrails (Coerce-Layer)

Sonnet-Output **niemals direkt** in die DB schreiben — die FK auf
`speaking_character_id` würde bei einer halluzinierten UUID explodieren.
5-Punkt-Coerce zwischen Sonnet-Response und INSERT:

1. **`speaking_character_id`** muss in der Story-Character-Liste sein —
   sonst `null` + `console.warn`.
2. **`duration`** clampen auf `[1, 8]`.
3. **`camera_control`** clampen: `zoom`/`panX`/`panY` auf `[-5, 5]`,
   `motionIntensity` auf `[1, 10]`.
4. **`scene_order`** server-side neu durchnumerieren (1, 2, 3, …) —
   ignoriere was Sonnet liefert (Lücken/Duplikate kommen vor).
5. **`audio_type` ↔ `tts_text` ↔ `speaking_character_id`-Konsistenz:**
   wenn `audio_type === 'none'` → `tts_text = null` UND
   `speaking_character_id = null` erzwingen.

### 4. Sonnet-Output ≠ DB-Schema

`SceneRecord` hat 25 Felder. Sonnet liefert nur die kreativen ~10.
Server-Mapping füllt die Rest-Defaults — diese Tabelle ist die
**autoritative Spezifikation** für den Mapping-Layer:

| DB-Feld | Quelle |
|---|---|
| `id` | DB `gen_random_uuid()` |
| `story_id` | URL-Param |
| `scene_order` | Server-Renumbering |
| `type` | Sonnet |
| `image_prompt` | Sonnet |
| `motion_prompt` | Sonnet |
| `camera_control` | Sonnet (gecoercd) |
| `duration` | Sonnet (gecoercd) |
| `audio_type` | Sonnet |
| `tts_text` | Sonnet (gecoercd auf `null` wenn `audio_type='none'`) |
| `speaking_character_id` | Sonnet (gecoercd gegen Character-Liste) |
| `transition` | Sonnet |
| `start_frame_mode` | Sonnet |
| `start_frame_url` | `null` (kommt in 8c) |
| `image_url` | `null` (kommt in 8c) |
| `video_url` | `null` (kommt in 8c) |
| `audio_url` | `null` (kommt in 8c) |
| `end_frame_url` | `null` (kommt in 8c) |
| `status` | `'pending'` |
| `error_message` | `null` |
| `fal_request_ids` | `null` |
| `created_at` / `updated_at` | DB `now()` |

### 5. Transaction-Semantik bei Re-Generate

`POST /api/sceneflow/stories/[id]/generate-scenes` muss
`deleteScenesByStory` + `createScenes` atomar machen, und die alten
Szenen erst LÖSCHEN nachdem Sonnet erfolgreich geantwortet hat. Sonst
sieht der User bei einem API-Fehler ein leeres Storyboard.

```ts
// 1. Sonnet-Call (außerhalb der Transaction — kein DB-Lock während IO)
const rawScenes = await generateScenesViaSonnet({ ... });

// 2. Coerce + Validate (server-side, kein DB-Touch)
const mappedScenes = coerceAndMap(rawScenes, characters, storyId);

// 3. Transaction: DELETE alte + INSERT neue
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await deleteScenesByStory(storyId, client);
  const created = await createScenes(storyId, mappedScenes, client);
  await client.query('COMMIT');
  return created;
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

Sonnet-Fehler → alte Szenen bleiben (Schritt 1 wirft, Schritt 3 startet
nie). Schritt-3-Fehler → ROLLBACK, alte Szenen bleiben. Das ist der
kritischste CC#2-Smoke-Check.

### 6. Scene-Ownership via JOIN

`VG_story_scenes` hat keine `user_id`-Spalte (Story besitzt die Szene,
User besitzt die Story). Jede mutierende Operation muss den User-Check
über JOIN im **selben SQL-Statement** machen — niemals zwei separate
Queries (Race-Condition).

```sql
-- updateScene
UPDATE "VG_story_scenes" s
SET ${setClause}, updated_at = now()
FROM "VG_stories" st
WHERE s.id = $${sceneIdParam}
  AND s.story_id = st.id
  AND st.user_id = $${userIdParam}
```

`rowCount === 0` heißt: Szene existiert nicht ODER gehört anderem User
→ 404 (nicht 403 — keine Existenz-Verraten).

### 7. AbortController-PATCH-Pipeline

Debounced PATCHes (500ms) auf Textareas + Slidern brauchen
Last-Write-Wins-Semantik. Pro `(sceneId, field)` einen
`AbortController` halten; vor jedem neuen PATCH den vorherigen
abbrechen:

```ts
// useSceneFlowScenes
const aborts = useRef(new Map<string, AbortController>());
function patchField(sceneId, field, value) {
  const key = `${sceneId}:${field}`;
  aborts.current.get(key)?.abort();
  const ctl = new AbortController();
  aborts.current.set(key, ctl);
  return debouncedFetch(`/api/sceneflow/scenes/${sceneId}`, {
    method: 'PATCH',
    signal: ctl.signal,
    body: JSON.stringify({ [field]: value })
  });
}
```

`AbortError` wird stillschweigend geschluckt (das war beabsichtigt).
Server lebt mit Last-Write-Wins via `updated_at`.

### 8. Reorder via Single-Endpoint, NICHT zwei Client-PATCHes

`[↑][↓]`-Tausch braucht atomares Swap. Zwei Client-PATCHes (`A` mit
neuer order, `B` mit neuer order) erzeugen Zwischenstufen wo beide
Szenen denselben `scene_order` haben → temporäre Duplikate. Stattdessen:

```
POST /api/sceneflow/stories/[id]/scenes/reorder
Body: { aId: string, bId: string }
```

Server macht `swapSceneOrder` als Transaction mit zwei UPDATEs unter
einer einzigen BEGIN/COMMIT.

### 9. Endcard hat eigenen Editor

`SceneCard` rendert für `scene.type === 'endcard'` einen anderen
Component: `EndcardEditor`. Kein Image-/Motion-Prompt, kein
Kamera-Block, kein Audio-Block — nur:
- CTA-Text (`tts_text`-Slot wird semantisch zu CTA — siehe
  KNOWN_LIMITATIONS, eigene `cta_text`-Spalte folgt in spätem Plan)
- Transition + Duration

---

## File map

| Datei | Aktion |
|---|---|
| `db/migrations/003_VG_stories_text_and_characters.sql` | **CREATE** — JSONB + TEXT Spalten |
| `lib/ai/anthropic.ts` | modify — `getClient` als Export + Test-Reset |
| `lib/sceneflow/types.ts` | modify — `StoryRecord` um `characters`/`story_text` |
| `lib/sceneflow/characters-db.ts` | modify — `listCharactersByIds` |
| `lib/sceneflow/stories-db.ts` | modify — `updateStory` + `loadStory` |
| `lib/sceneflow/scenes-db.ts` | **CREATE** — bulk-insert, JOIN-Ownership, swap |
| `lib/sceneflow/sonnet.ts` | **CREATE** — Tool-Use + Cache + Coerce |
| `lib/sceneflow/api-client.ts` | modify — Szenen-Wrapper + generate + reorder |
| `lib/hooks/useSceneFlowScenes.ts` | **CREATE** — Client-Hook + AbortController-Map |
| `app/api/sceneflow/stories/[id]/route.ts` | modify — PATCH hinzufügen |
| `app/api/sceneflow/stories/[id]/scenes/route.ts` | **CREATE** — GET/POST |
| `app/api/sceneflow/stories/[id]/scenes/reorder/route.ts` | **CREATE** |
| `app/api/sceneflow/stories/[id]/generate-scenes/route.ts` | **CREATE** |
| `app/api/sceneflow/scenes/[sceneId]/route.ts` | **CREATE** — PATCH/DELETE |
| `components/SceneFlow/SceneFlowShell.tsx` | modify — `activeStoryId` State |
| `components/SceneFlow/StoryList.tsx` | modify — `onSelect`-Prop |
| `components/SceneFlow/StoryDetailView.tsx` | **CREATE** |
| `components/SceneFlow/StorySetupForm.tsx` | **CREATE** |
| `components/SceneFlow/StoryTextInput.tsx` | **CREATE** — Textarea + `@`-validate |
| `components/SceneFlow/Storyboard.tsx` | **CREATE** |
| `components/SceneFlow/SceneCard.tsx` | **CREATE** — action/dialog Variante |
| `components/SceneFlow/EndcardEditor.tsx` | **CREATE** — endcard Variante |
| `components/SceneFlow/CameraControlSliders.tsx` | **CREATE** |
| `docs/KNOWN_LIMITATIONS.md` | modify — Plan 8b Eintrag |
| `tests/unit/sceneflow/scenes-db.test.ts` | **CREATE** (≥ 6) |
| `tests/unit/sceneflow/sonnet.test.ts` | **CREATE** (≥ 5) |
| `tests/unit/sceneflow/stories-db-update.test.ts` | **CREATE** (≥ 2) |
| `tests/integration/api/sceneflow-scenes.test.ts` | **CREATE** (≥ 4) |
| `tests/integration/api/sceneflow-generate-scenes.test.ts` | **CREATE** (≥ 3) |

Total Tests: **≥ 20 neu** (Architekt-Ziel war ≥ 18).

---

## Tasks

### Task 0 — Baseline check

**Files:** keine

- [ ] **Step 1: Status + Baseline**

```powershell
git status   # nur ignorierbare untracked files
npm test -- --run   # 754 passing
npm run typecheck && npm run lint && npm run build
```

Expected: alles grün, 754 Tests passing. **Baseline = 754**
(Plan 8a + Workspace-Layout-Fix).

- [ ] **Step 2: ANTHROPIC_API_KEY-Probe**

```powershell
node -e "console.log('key set?', !!process.env.ANTHROPIC_API_KEY)" 2>$null
node -r dotenv/config -e "console.log('key set?', !!process.env.ANTHROPIC_API_KEY)" dotenv_config_path=.env.local
```

Zweite Zeile muss `key set? true` liefern. Wenn nicht: User bittet
in `.env.local` setzen (Standard-Auto-Preset-Key reicht — selbe Engine).

---

### Task 1 — Migration 003: `VG_stories.characters` JSONB + `story_text` TEXT

**Files:** Create `db/migrations/003_VG_stories_text_and_characters.sql`

- [ ] **Step 1: SQL schreiben**

```sql
-- db/migrations/003_VG_stories_text_and_characters.sql
--
-- Plan 8b — VG_stories um zwei Spalten erweitern:
--  - `characters`: JSONB-Array von Character-UUIDs (welche Charaktere
--    sind in der Story eingebunden)
--  - `story_text`: Freitext-Beschreibung der Story (vor Sonnet-Aufteilung)
--
-- Beide Spalten sind NOT NULL nur in der applikatorischen Logik —
-- die DB akzeptiert NULL für rückwärtskompatible Pre-8b-Records.
-- DEFAULT '[]'::jsonb für `characters` damit listStories einen
-- vorhersagbaren Wert liefert.

ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS characters JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS story_text TEXT;
```

- [ ] **Step 2: Apply**

```powershell
node -r dotenv/config scripts/apply-migration.mjs db/migrations/003_VG_stories_text_and_characters.sql dotenv_config_path=.env.local
```

Expected: `OK — applied db/migrations/003_VG_stories_text_and_characters.sql`.

- [ ] **Step 3: Verify Spalten existieren**

```powershell
node -r dotenv/config -e "import('pg').then(async (pg) => { const c = new pg.Client({ connectionString: process.env.DIRECT_URL }); await c.connect(); const r = await c.query(\`SELECT column_name FROM information_schema.columns WHERE table_name='VG_stories' AND column_name IN ('characters','story_text')\`); console.log(r.rows); await c.end(); })" dotenv_config_path=.env.local
```

Expected: zwei Rows (`characters`, `story_text`).

- [ ] **Step 4: Anon-key bleibt gelockt**

```powershell
$URL = (Select-String -Path .env.local -Pattern "^NEXT_PUBLIC_SUPABASE_URL=").Line.Split('=',2)[1].Trim('"')
$KEY = (Select-String -Path .env.local -Pattern "^NEXT_PUBLIC_SUPABASE_ANON_KEY=").Line.Split('=',2)[1].Trim('"')
curl -s -H "apikey: $KEY" "$URL/rest/v1/VG_stories?select=id,characters&limit=1"
```

Expected: `{"code":"42501", … "permission denied for table VG_stories"}` —
RLS aus Plan 8a gilt weiter, neue Spalten ändern nichts.

- [ ] **Step 5: Commit**

```powershell
git add db/migrations/003_VG_stories_text_and_characters.sql
git commit -m "feat(db): VG_stories.characters JSONB + story_text TEXT (migration 003)"
```

---

### Task 2 — `lib/ai/anthropic.ts`: Export `getAnthropicClient` + Test-Hook

**Files:** modify `lib/ai/anthropic.ts`

Aktuell ist `getClient()` file-private. Plan 8b braucht ihn als Export,
damit `lib/sceneflow/sonnet.ts` ihn benutzen kann ohne den ganzen
`analyzeImageForFx`-Apparat zu duplizieren. Test-Reset-Hook
(`_resetAnthropicClientForTests`) existiert schon.

- [ ] **Step 1: Edit**

```ts
// vor:
let client: Anthropic | null = null;
function getClient(): Anthropic { ... }

// nach:
let client: Anthropic | null = null;
export function getAnthropicClient(): Anthropic {
  if (client) return client;
  const cfg = getAnthropicConfig();
  client = new Anthropic({ apiKey: cfg.apiKey });
  return client;
}
// internal alias bleibt für analyzeImageForFx (kein Diff dort nötig)
function getClient(): Anthropic { return getAnthropicClient(); }
```

`getAnthropicConfig` aus `./env` ist schon importiert.
`_resetAnthropicClientForTests` reicht für beide Konsumenten.

- [ ] **Step 2: Typecheck**

```powershell
npm run typecheck
```

- [ ] **Step 3: Bestehende analyze-image-Tests müssen grün bleiben**

```powershell
npm test -- --run tests/unit/ai
```

Expected: keine Regression.

- [ ] **Step 4: Commit**

```powershell
git add lib/ai/anthropic.ts
git commit -m "feat(ai): export getAnthropicClient for SceneFlow Sonnet reuse"
```

---

### Task 3 — `lib/sceneflow/types.ts`: `StoryRecord` erweitern

**Files:** modify `lib/sceneflow/types.ts`

- [ ] **Step 1: Edit `StoryRecord`**

```ts
export interface StoryRecord {
  id: string;
  user_id: string;
  title: string;
  format: StoryFormat;
  visual_style: string | null;
  status: StoryStatus;
  // Plan 8b additions:
  characters: string[];      // JSONB array of VG_characters.id (UUIDs)
  story_text: string | null; // user's freetext story description
  created_at: string;
  updated_at: string;
}
```

`SceneRecord` aus Plan 8a bleibt unverändert (alle 25 Felder existieren
bereits in der DB).

- [ ] **Step 2: Typecheck**

`stories-db.ts`-Queries müssen die neuen Spalten lesen — wird in Task 4
gefixt. Typecheck wirft hier noch nichts weil die Felder optional in
Reads sind. Wenn doch: Task 4 sofort danach.

- [ ] **Step 3: Commit (zusammen mit Task 4)**

Typen alleine ohne DB-Layer-Use sind nicht commit-würdig — Task 4 folgt.

---

### Task 4 — `stories-db.ts`: `updateStory` + `loadStory` + erweiterte `listStories`

**Files:** modify `lib/sceneflow/stories-db.ts`, create `tests/unit/sceneflow/stories-db-update.test.ts`

- [ ] **Step 1: Tests first (≥ 2)**

```ts
// tests/unit/sceneflow/stories-db-update.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db/pg', () => ({ pool: { query: queryMock } }));

import { updateStory, loadStory } from '@/lib/sceneflow/stories-db';

beforeEach(() => queryMock.mockReset());

describe('stories-db updateStory + loadStory', () => {
  it('updateStory — SET-builder branches on each field, JSON.stringify on characters', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await updateStory({
      userId: 'u-1',
      storyId: 's-1',
      patch: {
        title: 'New Title',
        characters: ['c-1', 'c-2'],
        storyText: 'A long story'
      }
    });
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/SET title = \$1, characters = \$2::jsonb, story_text = \$3 WHERE id = \$4 AND user_id = \$5/);
    expect(vals).toEqual(['New Title', JSON.stringify(['c-1', 'c-2']), 'A long story', 's-1', 'u-1']);
  });

  it('updateStory — empty patch → false, no SQL', async () => {
    const ok = await updateStory({ userId: 'u-1', storyId: 's-1', patch: {} });
    expect(ok).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('loadStory — user-scoped, returns null when not owned', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const row = await loadStory({ userId: 'u-1', storyId: 's-x' });
    expect(row).toBeNull();
    expect(queryMock.mock.calls[0]![1]).toEqual(['s-x', 'u-1']);
  });
});
```

- [ ] **Step 2: Tests fail (Module exports nicht vorhanden)**

```powershell
npm test -- --run tests/unit/sceneflow/stories-db-update.test.ts
```

Expected: fail (loadStory + updateStory existieren nicht).

- [ ] **Step 3: Implement**

```ts
// lib/sceneflow/stories-db.ts (additions)
import type { StoryRecord, StoryFormat } from './types';

// ... existing createStory/listStories/deleteStory unchanged ...

export interface UpdateStoryPatch {
  title?: string;
  format?: StoryFormat;
  visualStyle?: string | null;
  characters?: string[];
  storyText?: string | null;
}

export async function updateStory(args: {
  userId: string;
  storyId: string;
  patch: UpdateStoryPatch;
}): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  const p = args.patch;
  if (p.title !== undefined) { sets.push(`title = $${n++}`); vals.push(p.title); }
  if (p.format !== undefined) { sets.push(`format = $${n++}`); vals.push(p.format); }
  if (p.visualStyle !== undefined) {
    sets.push(`visual_style = $${n++}`); vals.push(p.visualStyle);
  }
  if (p.characters !== undefined) {
    sets.push(`characters = $${n++}::jsonb`); vals.push(JSON.stringify(p.characters));
  }
  if (p.storyText !== undefined) {
    sets.push(`story_text = $${n++}`); vals.push(p.storyText);
  }
  if (sets.length === 0) return false;
  vals.push(args.storyId, args.userId);
  const { rowCount } = await pool.query(
    `UPDATE "VG_stories" SET ${sets.join(', ')} WHERE id = $${n++} AND user_id = $${n}`,
    vals
  );
  return (rowCount ?? 0) > 0;
}

export async function loadStory(args: {
  userId: string;
  storyId: string;
}): Promise<StoryRecord | null> {
  const { rows } = await pool.query<StoryRecord>(
    `SELECT id, user_id, title, format, visual_style, status,
            characters, story_text, created_at, updated_at
     FROM "VG_stories" WHERE id = $1 AND user_id = $2`,
    [args.storyId, args.userId]
  );
  return rows[0] ?? null;
}
```

Auch `listStories` muss die neuen Spalten zurückgeben — Edit
ergänzen:

```ts
export async function listStories(userId: string): Promise<StoryRecord[]> {
  const { rows } = await pool.query<StoryRecord>(
    `SELECT id, user_id, title, format, visual_style, status,
            characters, story_text, created_at, updated_at
     FROM "VG_stories" WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
}
```

- [ ] **Step 4: Tests pass**

```powershell
npm test -- --run tests/unit/sceneflow/
```

Bestehender `stories-db.test.ts` aus Plan 8a darf nicht brechen
(neue SELECT-Spalten sind aufwärts­kompatibel im Test mit
`rows: []`-Mock).

- [ ] **Step 5: Commit**

```powershell
git add lib/sceneflow/types.ts lib/sceneflow/stories-db.ts tests/unit/sceneflow/stories-db-update.test.ts
git commit -m "feat(sceneflow): StoryRecord.characters/story_text + updateStory + loadStory"
```

---

### Task 5 — `characters-db.ts`: `listCharactersByIds`

**Files:** modify `lib/sceneflow/characters-db.ts`, modify `tests/unit/sceneflow/characters-db.test.ts`

Architekt-Note: gehört semantisch in characters-db, nicht stories-db.

- [ ] **Step 1: Test ergänzen (im bestehenden File)**

```ts
// Append zu tests/unit/sceneflow/characters-db.test.ts
describe('listCharactersByIds', () => {
  it('queries with user_id filter AND id = ANY(uuids[])', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listCharactersByIds('u-1', ['c-1', 'c-2']);
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/WHERE user_id = \$1 AND id = ANY\(\$2::uuid\[\]\)/);
    expect(vals).toEqual(['u-1', ['c-1', 'c-2']]);
  });

  it('listCharactersByIds — empty ids array → returns [] without SQL', async () => {
    const rows = await listCharactersByIds('u-1', []);
    expect(rows).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
```

Import-Block oben ergänzen: `import { …, listCharactersByIds } from '@/lib/sceneflow/characters-db';`

- [ ] **Step 2: Implement**

```ts
// lib/sceneflow/characters-db.ts — append
export async function listCharactersByIds(
  userId: string,
  ids: string[]
): Promise<CharacterRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<CharacterRecord>(
    `SELECT id, user_id, name, type, reference_image_url, voice_provider,
            voice_id, image_prompt, created_at, updated_at
     FROM "VG_characters"
     WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, ids]
  );
  return rows;
}
```

- [ ] **Step 3: Tests pass**

```powershell
npm test -- --run tests/unit/sceneflow/characters-db.test.ts
```

Expected: 5 + 2 = 7 passing.

- [ ] **Step 4: Commit**

```powershell
git add lib/sceneflow/characters-db.ts tests/unit/sceneflow/characters-db.test.ts
git commit -m "feat(sceneflow): listCharactersByIds for story-character lookup"
```

---

### Task 6 — PATCH `/api/sceneflow/stories/[id]`

**Files:** modify `app/api/sceneflow/stories/[id]/route.ts`

- [ ] **Step 1: Implement PATCH-Handler**

```ts
// app/api/sceneflow/stories/[id]/route.ts (additions)
import { updateStory } from '@/lib/sceneflow/stories-db';
import type { UpdateStoryPatch } from '@/lib/sceneflow/stories-db';

const VALID_FORMATS = ['16:9', '9:16', '4:3'] as const;

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const patch: UpdateStoryPatch = {};
  if (typeof b.title === 'string') patch.title = b.title;
  if (typeof b.format === 'string') {
    if (!VALID_FORMATS.includes(b.format as (typeof VALID_FORMATS)[number])) {
      return NextResponse.json({ error: 'invalid format' }, { status: 400 });
    }
    patch.format = b.format as UpdateStoryPatch['format'];
  }
  if ('visualStyle' in b) {
    patch.visualStyle = (b.visualStyle as string | null | undefined) ?? null;
  }
  if (Array.isArray(b.characters)) {
    // shallow validate: alle string-IDs
    if (b.characters.some((c) => typeof c !== 'string')) {
      return NextResponse.json({ error: 'invalid characters' }, { status: 400 });
    }
    patch.characters = b.characters as string[];
  }
  if ('storyText' in b) {
    patch.storyText = (b.storyText as string | null | undefined) ?? null;
  }
  const ok = await updateStory({
    userId: session.user.id,
    storyId: params.id,
    patch
  });
  if (!ok) return NextResponse.json({ error: 'not found or unchanged' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

DELETE-Handler aus Plan 8a bleibt unverändert.

- [ ] **Step 2: Tests** — der bestehende `sceneflow-stories.test.ts`
  bekommt einen neuen `describe('PATCH …')`-Block mit ≥ 2 Tests:
  401 ohne Session, 200 mit gültigem Patch + Validierung dass
  `updateStory` mit richtigen Argumenten gerufen wurde.

- [ ] **Step 3: Run all api tests**

```powershell
npm test -- --run tests/integration/api/
```

- [ ] **Step 4: Commit**

```powershell
git add app/api/sceneflow/stories/[id]/route.ts tests/integration/api/sceneflow-stories.test.ts
git commit -m "feat(sceneflow): PATCH /stories/[id] — title/format/style/chars/text"
```

---

### Task 7 — `scenes-db.ts`: bulk-insert, JOIN-Ownership, swap

**Files:** Create `lib/sceneflow/scenes-db.ts`, `tests/unit/sceneflow/scenes-db.test.ts`

- [ ] **Step 1: Tests first (≥ 6)**

```ts
// tests/unit/sceneflow/scenes-db.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';

const { queryMock, connectMock } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const clientQueryMock = vi.fn();
  const releaseMock = vi.fn();
  const connectMock = vi.fn(() => Promise.resolve({
    query: clientQueryMock,
    release: releaseMock
  } as unknown as PoolClient));
  return { queryMock, connectMock, clientQueryMock, releaseMock };
});
vi.mock('@/lib/db/pg', () => ({
  pool: { query: queryMock, connect: connectMock }
}));

import {
  createScenes,
  listScenes,
  updateScene,
  deleteScene,
  deleteScenesByStory,
  swapSceneOrder
} from '@/lib/sceneflow/scenes-db';

beforeEach(() => {
  queryMock.mockReset();
  connectMock.mockClear();
});

describe('scenes-db', () => {
  it('createScenes — multi-VALUES insert, returns full records', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'sc-1' }, { id: 'sc-2' }]
    });
    const ids = await createScenes('story-1', [
      { scene_order: 1, type: 'action', image_prompt: 'a', motion_prompt: 'm',
        camera_control: { zoom: 0, panX: 0, panY: 0, motionIntensity: 5 },
        duration: 5, audio_type: 'none', tts_text: null,
        speaking_character_id: null, transition: 'last-frame',
        start_frame_mode: 'auto', status: 'pending', fal_request_ids: null },
      { scene_order: 2, type: 'endcard', image_prompt: 'b', motion_prompt: '',
        camera_control: null, duration: 3, audio_type: 'none', tts_text: 'CTA',
        speaking_character_id: null, transition: 'crossfade',
        start_frame_mode: 'from-previous', status: 'pending', fal_request_ids: null }
    ]);
    expect(ids).toEqual([{ id: 'sc-1' }, { id: 'sc-2' }]);
    const [sql] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO "VG_story_scenes"/);
    expect(sql).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, \$6\$?, \$/);
    // 14 columns, 2 rows → 28 params total
  });

  it('listScenes — JOIN VG_stories, scoped by user_id, ORDER BY scene_order', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listScenes('u-1', 'story-1');
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/FROM "VG_story_scenes" s/);
    expect(sql).toMatch(/JOIN "VG_stories" st ON s.story_id = st.id/);
    expect(sql).toMatch(/WHERE st.id = \$1 AND st.user_id = \$2/);
    expect(sql).toMatch(/ORDER BY s.scene_order/);
    expect(vals).toEqual(['story-1', 'u-1']);
  });

  it('updateScene — SET-builder + JOIN-Ownership in single UPDATE', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await updateScene({
      userId: 'u-1', sceneId: 'sc-1',
      patch: { image_prompt: 'new', duration: 7 }
    });
    expect(ok).toBe(true);
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/UPDATE "VG_story_scenes" s/);
    expect(sql).toMatch(/SET image_prompt = \$1, duration = \$2/);
    expect(sql).toMatch(/FROM "VG_stories" st/);
    expect(sql).toMatch(/WHERE s.id = \$3 AND s.story_id = st.id AND st.user_id = \$4/);
    expect(vals).toEqual(['new', 7, 'sc-1', 'u-1']);
  });

  it('updateScene — empty patch → false, no SQL', async () => {
    const ok = await updateScene({ userId: 'u-1', sceneId: 'sc-1', patch: {} });
    expect(ok).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('updateScene — rowCount=0 (foreign user) → false', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    const ok = await updateScene({
      userId: 'u-1', sceneId: 'sc-x',
      patch: { duration: 5 }
    });
    expect(ok).toBe(false);
  });

  it('swapSceneOrder — runs both UPDATEs inside one transaction', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rowCount: 1 }),
      release: vi.fn()
    };
    connectMock.mockResolvedValueOnce(client as unknown as PoolClient);
    await swapSceneOrder({ userId: 'u-1', aId: 'sc-1', bId: 'sc-2' });
    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toMatch(/CREATE TEMP TABLE|UPDATE "VG_story_scenes"/);
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Tests fail (Module nicht da)**

- [ ] **Step 3: Implement**

```ts
// lib/sceneflow/scenes-db.ts
import 'server-only';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db/pg';
import type { SceneRecord, CameraControl } from './types';

const SCENE_INSERT_COLS = [
  'story_id', 'scene_order', 'type', 'image_prompt', 'motion_prompt',
  'camera_control', 'duration', 'audio_type', 'tts_text',
  'speaking_character_id', 'transition', 'start_frame_mode',
  'status', 'fal_request_ids'
] as const;

export interface NewSceneInput {
  scene_order: number;
  type: SceneRecord['type'];
  image_prompt: string;
  motion_prompt: string;
  camera_control: CameraControl | null;
  duration: number;
  audio_type: SceneRecord['audio_type'];
  tts_text: string | null;
  speaking_character_id: string | null;
  transition: SceneRecord['transition'];
  start_frame_mode: SceneRecord['start_frame_mode'];
  status: SceneRecord['status'];
  fal_request_ids: Record<string, string> | null;
}

export async function createScenes(
  storyId: string,
  scenes: NewSceneInput[],
  txClient?: PoolClient
): Promise<SceneRecord[]> {
  if (scenes.length === 0) return [];
  const cols = SCENE_INSERT_COLS;
  const placeholders = scenes
    .map((_, i) => {
      const base = i * cols.length;
      return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
    })
    .join(', ');
  const values = scenes.flatMap((s) => [
    storyId,
    s.scene_order,
    s.type,
    s.image_prompt,
    s.motion_prompt,
    s.camera_control === null ? null : JSON.stringify(s.camera_control),
    s.duration,
    s.audio_type,
    s.tts_text,
    s.speaking_character_id,
    s.transition,
    s.start_frame_mode,
    s.status,
    s.fal_request_ids === null ? null : JSON.stringify(s.fal_request_ids)
  ]);
  const sql = `INSERT INTO "VG_story_scenes" (${cols.join(', ')})
               VALUES ${placeholders} RETURNING *`;
  const q = txClient ?? pool;
  const { rows } = await q.query<SceneRecord>(sql, values);
  return rows;
}

export async function listScenes(
  userId: string,
  storyId: string
): Promise<SceneRecord[]> {
  const { rows } = await pool.query<SceneRecord>(
    `SELECT s.id, s.story_id, s.scene_order, s.type, s.image_prompt,
            s.motion_prompt, s.camera_control, s.duration, s.audio_type,
            s.tts_text, s.speaking_character_id, s.transition,
            s.start_frame_mode, s.start_frame_url, s.image_url,
            s.video_url, s.audio_url, s.end_frame_url, s.status,
            s.error_message, s.fal_request_ids, s.created_at, s.updated_at
     FROM "VG_story_scenes" s
     JOIN "VG_stories" st ON s.story_id = st.id
     WHERE st.id = $1 AND st.user_id = $2
     ORDER BY s.scene_order ASC`,
    [storyId, userId]
  );
  return rows;
}

export interface UpdateScenePatch {
  type?: SceneRecord['type'];
  image_prompt?: string;
  motion_prompt?: string;
  camera_control?: CameraControl | null;
  duration?: number;
  audio_type?: SceneRecord['audio_type'];
  tts_text?: string | null;
  speaking_character_id?: string | null;
  transition?: SceneRecord['transition'];
  start_frame_mode?: SceneRecord['start_frame_mode'];
}

const UPDATABLE_FIELDS: ReadonlyArray<keyof UpdateScenePatch> = [
  'type', 'image_prompt', 'motion_prompt', 'camera_control',
  'duration', 'audio_type', 'tts_text', 'speaking_character_id',
  'transition', 'start_frame_mode'
];

export async function updateScene(args: {
  userId: string;
  sceneId: string;
  patch: UpdateScenePatch;
}): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  for (const k of UPDATABLE_FIELDS) {
    const v = args.patch[k];
    if (v === undefined) continue;
    if (k === 'camera_control') {
      sets.push(`${k} = $${n++}::jsonb`);
      vals.push(v === null ? null : JSON.stringify(v));
    } else {
      sets.push(`${k} = $${n++}`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return false;
  vals.push(args.sceneId, args.userId);
  const sceneIdParam = n++;
  const userIdParam = n;
  const { rowCount } = await pool.query(
    `UPDATE "VG_story_scenes" s
     SET ${sets.join(', ')}, updated_at = now()
     FROM "VG_stories" st
     WHERE s.id = $${sceneIdParam}
       AND s.story_id = st.id
       AND st.user_id = $${userIdParam}`,
    vals
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteScene(args: {
  userId: string;
  sceneId: string;
}): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM "VG_story_scenes" s
     USING "VG_stories" st
     WHERE s.id = $1 AND s.story_id = st.id AND st.user_id = $2`,
    [args.sceneId, args.userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteScenesByStory(
  storyId: string,
  txClient?: PoolClient
): Promise<void> {
  const q = txClient ?? pool;
  await q.query(
    `DELETE FROM "VG_story_scenes" WHERE story_id = $1`,
    [storyId]
  );
}

/**
 * Atomar `scene_order` zwischen zwei Szenen tauschen.
 * Beide Szenen müssen demselben User UND derselben Story gehören.
 */
export async function swapSceneOrder(args: {
  userId: string;
  aId: string;
  bId: string;
}): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 1. Hole beide Szenen mit Ownership-Check
    const { rows } = await client.query<{ id: string; scene_order: number; story_id: string }>(
      `SELECT s.id, s.scene_order, s.story_id
       FROM "VG_story_scenes" s
       JOIN "VG_stories" st ON s.story_id = st.id
       WHERE s.id = ANY($1::uuid[]) AND st.user_id = $2`,
      [[args.aId, args.bId], args.userId]
    );
    if (rows.length !== 2 || rows[0]!.story_id !== rows[1]!.story_id) {
      await client.query('ROLLBACK');
      return false;
    }
    const a = rows.find((r) => r.id === args.aId)!;
    const b = rows.find((r) => r.id === args.bId)!;
    // 2. Swap via Negativwert-Zwischenschritt (Unique-Constraint-frei
    //    weil scene_order keinen Constraint hat — aber save-by-design)
    await client.query(
      `UPDATE "VG_story_scenes" SET scene_order = $1 WHERE id = $2`,
      [b.scene_order, a.id]
    );
    await client.query(
      `UPDATE "VG_story_scenes" SET scene_order = $1 WHERE id = $2`,
      [a.scene_order, b.id]
    );
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Tests pass**

```powershell
npm test -- --run tests/unit/sceneflow/scenes-db.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add lib/sceneflow/scenes-db.ts tests/unit/sceneflow/scenes-db.test.ts
git commit -m "feat(sceneflow): scenes-db — bulk-insert + JOIN-ownership + swap"
```

---

### Task 8 — Scenes API Routes (GET/POST/PATCH/DELETE/reorder)

**Files:** Create `app/api/sceneflow/stories/[id]/scenes/route.ts`,
`app/api/sceneflow/stories/[id]/scenes/reorder/route.ts`,
`app/api/sceneflow/scenes/[sceneId]/route.ts`,
`tests/integration/api/sceneflow-scenes.test.ts`

- [ ] **Step 1: Tests first (≥ 4)**

Tests folgen dem Pattern aus `sceneflow-characters.test.ts`
(vi.hoisted + Mock von `scenes-db` + Mock von `auth.api.getSession`).
Mindest-Cases:
- GET /api/sceneflow/stories/[id]/scenes — 401 ohne Session,
  200 mit listScenes-Mock
- PATCH /api/sceneflow/scenes/[sceneId] — 401, 400 invalid json,
  404 wenn updateScene false
- DELETE /api/sceneflow/scenes/[sceneId] — 401, 404
- POST /api/sceneflow/stories/[id]/scenes/reorder — 401,
  200 mit swapSceneOrder-Mock, 400 wenn aId === bId

- [ ] **Step 2: Implement collection route**

```ts
// app/api/sceneflow/stories/[id]/scenes/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { listScenes, createScenes } from '@/lib/sceneflow/scenes-db';
import type { NewSceneInput } from '@/lib/sceneflow/scenes-db';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const scenes = await listScenes(session.user.id, params.id);
  return NextResponse.json({ scenes });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  // Manueller Bulk-Insert (für Tests + Edge-Cases — Sonnet hat
  // eigene Route /generate-scenes). Plan 8b nutzt diese Route
  // nicht aus dem UI heraus.
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const b = body as { scenes?: unknown };
  if (!Array.isArray(b.scenes)) {
    return NextResponse.json({ error: 'invalid scenes' }, { status: 400 });
  }
  // Defense in Depth: verify story belongs to user
  const { loadStory } = await import('@/lib/sceneflow/stories-db');
  const story = await loadStory({ userId: session.user.id, storyId: params.id });
  if (!story) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const created = await createScenes(params.id, b.scenes as NewSceneInput[]);
  return NextResponse.json({ scenes: created }, { status: 201 });
}
```

- [ ] **Step 3: Implement scene-detail route**

```ts
// app/api/sceneflow/scenes/[sceneId]/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { updateScene, deleteScene } from '@/lib/sceneflow/scenes-db';
import type { UpdateScenePatch } from '@/lib/sceneflow/scenes-db';

export const runtime = 'nodejs';

async function userId(req: Request): Promise<string | null> {
  const s = await auth.api.getSession({ headers: req.headers });
  return s?.user.id ?? null;
}

export async function PATCH(
  req: Request,
  { params }: { params: { sceneId: string } }
): Promise<Response> {
  const uid = await userId(req);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const ok = await updateScene({
    userId: uid,
    sceneId: params.sceneId,
    patch: body as UpdateScenePatch
  });
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: { sceneId: string } }
): Promise<Response> {
  const uid = await userId(req);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ok = await deleteScene({ userId: uid, sceneId: params.sceneId });
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Implement reorder route**

```ts
// app/api/sceneflow/stories/[id]/scenes/reorder/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { swapSceneOrder } from '@/lib/sceneflow/scenes-db';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const b = body as { aId?: unknown; bId?: unknown };
  if (typeof b.aId !== 'string' || typeof b.bId !== 'string' || b.aId === b.bId) {
    return NextResponse.json({ error: 'invalid scene ids' }, { status: 400 });
  }
  const ok = await swapSceneOrder({
    userId: session.user.id, aId: b.aId, bId: b.bId
  });
  if (!ok) return NextResponse.json({ error: 'not found or cross-story' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Tests pass + build clean**

- [ ] **Step 6: Commit**

```powershell
git add app/api/sceneflow/stories/[id]/scenes app/api/sceneflow/scenes tests/integration/api/sceneflow-scenes.test.ts
git commit -m "feat(sceneflow): scene API routes — list/create/patch/delete/reorder"
```

---

### Task 9 — `lib/sceneflow/sonnet.ts`: Tool-Use + Cache + Coerce

**Files:** Create `lib/sceneflow/sonnet.ts`, `tests/unit/sceneflow/sonnet.test.ts`

- [ ] **Step 1: Tests first (≥ 5)**

```ts
// tests/unit/sceneflow/sonnet.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { messagesCreate } = vi.hoisted(() => ({ messagesCreate: vi.fn() }));
vi.mock('@/lib/ai/anthropic', () => ({
  getAnthropicClient: () => ({ messages: { create: messagesCreate } }),
  getAnthropicConfig: () => ({ apiKey: 'test', model: 'claude-sonnet-4-6' })
}));
// re-export passthrough from env
vi.mock('@/lib/ai/env', () => ({
  getAnthropicConfig: () => ({ apiKey: 'test', model: 'claude-sonnet-4-6' })
}));

import { generateScenesViaSonnet, coerceSonnetScenes } from '@/lib/sceneflow/sonnet';

beforeEach(() => messagesCreate.mockReset());

const stubResponse = (scenes: unknown[]) => ({
  content: [{
    type: 'tool_use',
    name: 'submit_scenes',
    input: { scenes }
  }],
  usage: { input_tokens: 100, output_tokens: 200 }
});

describe('sonnet.generateScenesViaSonnet', () => {
  it('extracts tool_use input correctly', async () => {
    messagesCreate.mockResolvedValueOnce(stubResponse([
      { scene_order: 1, type: 'action', image_prompt: 'a',
        motion_prompt: 'm', camera_control: { zoom: 0, panX: 0, panY: 0, motionIntensity: 5 },
        duration: 5, audio_type: 'none', transition: 'last-frame', start_frame_mode: 'auto' }
    ]));
    const res = await generateScenesViaSonnet({
      storyText: 'A short story',
      story: { id: 's', title: 't', format: '16:9', visual_style: null,
        characters: [], story_text: 'A short story' } as never,
      characters: []
    });
    expect(res.scenes).toHaveLength(1);
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: 'tool', name: 'submit_scenes' }
      })
    );
  });

  it('throws when Sonnet does not call submit_scenes (text-only response)', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Sorry, cannot help' }],
      usage: { input_tokens: 50, output_tokens: 10 }
    });
    await expect(
      generateScenesViaSonnet({
        storyText: 'x',
        story: { id: 's', title: 't', format: '16:9', visual_style: null,
          characters: [], story_text: 'x' } as never,
        characters: []
      })
    ).rejects.toThrow(/did not call submit_scenes/);
  });
});

describe('sonnet.coerceSonnetScenes', () => {
  it('null-out speaking_character_id when not in character list', () => {
    const scenes = coerceSonnetScenes(
      [{ scene_order: 1, type: 'dialog', image_prompt: 'a',
         motion_prompt: 'm', camera_control: { zoom: 0, panX: 0, panY: 0, motionIntensity: 5 },
         duration: 5, audio_type: 'voiceover', tts_text: 'hi',
         speaking_character_id: 'hallucinated-uuid',
         transition: 'last-frame', start_frame_mode: 'auto' }],
      [{ id: 'real-c-1' } as never]
    );
    expect(scenes[0]!.speaking_character_id).toBe(null);
  });

  it('clamps duration to [1, 8]', () => {
    const scenes = coerceSonnetScenes([
      { scene_order: 1, type: 'action', image_prompt: 'a',
        motion_prompt: 'm', camera_control: null,
        duration: 99, audio_type: 'none',
        transition: 'last-frame', start_frame_mode: 'auto' }
    ], []);
    expect(scenes[0]!.duration).toBe(8);
  });

  it('clamps camera_control values', () => {
    const scenes = coerceSonnetScenes([
      { scene_order: 1, type: 'action', image_prompt: 'a',
        motion_prompt: 'm',
        camera_control: { zoom: 99, panX: -99, panY: 0, motionIntensity: 50 },
        duration: 5, audio_type: 'none',
        transition: 'last-frame', start_frame_mode: 'auto' }
    ], []);
    expect(scenes[0]!.camera_control).toEqual({
      zoom: 5, panX: -5, panY: 0, motionIntensity: 10
    });
  });

  it('renumbers scene_order to 1,2,3 even if Sonnet gives gaps', () => {
    const scenes = coerceSonnetScenes([
      { scene_order: 5, type: 'action', image_prompt: 'a',
        motion_prompt: '', camera_control: null, duration: 5,
        audio_type: 'none', transition: 'cut', start_frame_mode: 'auto' },
      { scene_order: 99, type: 'endcard', image_prompt: '',
        motion_prompt: '', camera_control: null, duration: 3,
        audio_type: 'none', transition: 'crossfade', start_frame_mode: 'from-previous' }
    ], []);
    expect(scenes.map((s) => s.scene_order)).toEqual([1, 2]);
  });

  it('forces tts_text=null + speaking_character_id=null when audio_type=none', () => {
    const scenes = coerceSonnetScenes([
      { scene_order: 1, type: 'action', image_prompt: 'a',
        motion_prompt: '', camera_control: null, duration: 5,
        audio_type: 'none', tts_text: 'leftover',
        speaking_character_id: 'real-c-1',
        transition: 'cut', start_frame_mode: 'auto' }
    ], [{ id: 'real-c-1' } as never]);
    expect(scenes[0]!.tts_text).toBe(null);
    expect(scenes[0]!.speaking_character_id).toBe(null);
  });
});
```

- [ ] **Step 2: Tests fail (module nicht da)**

- [ ] **Step 3: Implement** — Komplettes Listing siehe Architecture
  Insights §2/§3/§4. Wichtige Punkte beim Schreiben:

```ts
// lib/sceneflow/sonnet.ts
import 'server-only';
import { getAnthropicClient, getAnthropicConfig } from '@/lib/ai/anthropic';
import type { CharacterRecord } from './types';
import type { StoryRecord } from './types';
import type { NewSceneInput } from './scenes-db';

const SUBMIT_SCENES_TOOL = {
  name: 'submit_scenes',
  description: 'Submit the structured scene list for the story.',
  input_schema: {
    type: 'object',
    properties: {
      scenes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            scene_order: { type: 'integer', minimum: 1 },
            type: { type: 'string', enum: ['action', 'dialog', 'endcard'] },
            image_prompt: { type: 'string' },
            motion_prompt: { type: 'string' },
            camera_control: {
              type: ['object', 'null'],
              properties: {
                zoom: { type: 'number' },
                panX: { type: 'number' },
                panY: { type: 'number' },
                motionIntensity: { type: 'number' }
              }
            },
            duration: { type: 'integer' },
            audio_type: { type: 'string', enum: ['none', 'voiceover', 'lipsync'] },
            tts_text: { type: ['string', 'null'] },
            speaking_character_id: { type: ['string', 'null'] },
            transition: { type: 'string', enum: ['last-frame', 'crossfade', 'cut'] },
            start_frame_mode: { type: 'string', enum: ['auto', 'from-previous', 'custom'] }
          },
          required: [
            'scene_order', 'type', 'image_prompt', 'motion_prompt',
            'duration', 'audio_type', 'transition', 'start_frame_mode'
          ]
        }
      }
    },
    required: ['scenes']
  }
} as const;

const SYSTEM_PROMPT = `Du bist ein professioneller Video-Storyboard-Autor.
Deine Aufgabe: Eine Story-Beschreibung in eine strukturierte Szenen-Liste
für KI-Video-Generierung aufteilen, und sie über das submit_scenes-Tool
abzugeben.

Regeln:
- Jede Szene 1–8 Sekunden (Standard: 5s)
- @Name-Referenzen im Story-Text werden durch Charakter-Details ersetzt
  (Namen + visuelle Beschreibung); die Charaktere sind im nächsten
  System-Block aufgelistet
- image_prompt: vollständig ausformuliert auf Englisch, visuellen
  Stil bereits eingearbeitet, fotorealistisch
- motion_prompt: Kamera-Beschreibung auf Englisch
- camera_control: zoom -5..+5, panX -5..+5, panY -5..+5, motionIntensity 1..10
- tts_text: ausformuliert, natürliche Sprache (Deutsch wenn Story auf
  Deutsch, sonst Englisch); null für action/endcard-Szenen ohne Audio
- speaking_character_id: GENAU eine der UUIDs aus der Charakter-Liste
  oder null — KEINE erfundenen IDs
- scene_order: 1, 2, 3, ... fortlaufend ohne Lücken
- Erste Szene: start_frame_mode = "auto"
- Folge-Szenen: start_frame_mode = "from-previous"
- Dialog/LipSync-Szenen: transition = "last-frame"
- Crossfade für emotionale Übergänge
- Immer mit einer endcard-Szene abschließen (type = "endcard")`;

interface SonnetSceneRaw {
  scene_order: number;
  type: 'action' | 'dialog' | 'endcard';
  image_prompt: string;
  motion_prompt: string;
  camera_control: { zoom: number; panX: number; panY: number; motionIntensity: number } | null;
  duration: number;
  audio_type: 'none' | 'voiceover' | 'lipsync';
  tts_text?: string | null;
  speaking_character_id?: string | null;
  transition: 'last-frame' | 'crossfade' | 'cut';
  start_frame_mode: 'auto' | 'from-previous' | 'custom';
}

const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));

export function coerceSonnetScenes(
  raw: SonnetSceneRaw[],
  characters: Pick<CharacterRecord, 'id'>[]
): NewSceneInput[] {
  const validIds = new Set(characters.map((c) => c.id));
  return raw.map((s, idx): NewSceneInput => {
    const cameraCtl = s.camera_control
      ? {
          zoom: clamp(s.camera_control.zoom, -5, 5),
          panX: clamp(s.camera_control.panX, -5, 5),
          panY: clamp(s.camera_control.panY, -5, 5),
          motionIntensity: Math.round(clamp(s.camera_control.motionIntensity, 1, 10))
        }
      : null;
    const duration = Math.round(clamp(s.duration, 1, 8));
    const noAudio = s.audio_type === 'none';
    let speaker = s.speaking_character_id ?? null;
    if (speaker !== null && !validIds.has(speaker)) {
      console.warn(`[sonnet] hallucinated speaking_character_id ${speaker} — null-ing`);
      speaker = null;
    }
    return {
      scene_order: idx + 1,                       // renumber!
      type: s.type,
      image_prompt: s.image_prompt,
      motion_prompt: s.motion_prompt,
      camera_control: cameraCtl,
      duration,
      audio_type: s.audio_type,
      tts_text: noAudio ? null : (s.tts_text ?? null),
      speaking_character_id: noAudio ? null : speaker,
      transition: s.transition,
      start_frame_mode: s.start_frame_mode,
      status: 'pending',
      fal_request_ids: null
    };
  });
}

export async function generateScenesViaSonnet(args: {
  storyText: string;
  story: StoryRecord;
  characters: CharacterRecord[];
}): Promise<{ scenes: NewSceneInput[]; usage: { input_tokens: number; output_tokens: number } }> {
  const cli = getAnthropicClient();
  const cfg = getAnthropicConfig();

  const characterContext = args.characters.length === 0
    ? 'No characters defined.'
    : `Available characters (use their UUIDs verbatim in speaking_character_id):\n` +
      args.characters
        .map((c) => `- ${c.name} [${c.type}] uuid=${c.id}${c.image_prompt ? ` · visual: ${c.image_prompt}` : ''}`)
        .join('\n');

  const storyContext =
    `Story title: ${args.story.title}\n` +
    `Format: ${args.story.format}\n` +
    (args.story.visual_style ? `Visual style: ${args.story.visual_style}\n` : '');

  const res = await cli.messages.create({
    model: cfg.model,
    max_tokens: 16000,
    system: [
      { type: 'text', text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' } },
      { type: 'text', text: characterContext,
        cache_control: { type: 'ephemeral' } }
    ],
    tools: [SUBMIT_SCENES_TOOL],
    tool_choice: { type: 'tool', name: 'submit_scenes' },
    messages: [
      { role: 'user', content: `${storyContext}\n\nStory:\n${args.storyText}` }
    ]
  });

  const block = res.content.find(
    (b): b is Extract<typeof b, { type: 'tool_use' }> =>
      b.type === 'tool_use' && b.name === 'submit_scenes'
  );
  if (!block) {
    throw new Error('Sonnet did not call submit_scenes — got text response instead');
  }
  const rawScenes = (block.input as { scenes: SonnetSceneRaw[] }).scenes;
  const scenes = coerceSonnetScenes(rawScenes, args.characters);

  return {
    scenes,
    usage: {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens
    }
  };
}
```

- [ ] **Step 4: Tests pass**

```powershell
npm test -- --run tests/unit/sceneflow/sonnet.test.ts
```

- [ ] **Step 5: Typecheck + Build**

```powershell
npm run typecheck && npm run build
```

Wichtig: `cli.messages.create({ system: [...] })` mit Array statt
string ist gültiges Anthropic-SDK-API (`@anthropic-ai/sdk@^0.30.1`
unterstützt das). Falls TypeScript-Typen das nicht akzeptieren:
SDK auf neueste Patch-Version updaten oder `as never`-Cast (zuletzt).

- [ ] **Step 6: Commit**

```powershell
git add lib/sceneflow/sonnet.ts tests/unit/sceneflow/sonnet.test.ts
git commit -m "feat(sceneflow): sonnet client — tool-use + prompt-cache + coerce guardrails"
```

---

### Task 10 — `/api/sceneflow/stories/[id]/generate-scenes` Route

**Files:** Create `app/api/sceneflow/stories/[id]/generate-scenes/route.ts`,
`tests/integration/api/sceneflow-generate-scenes.test.ts`

- [ ] **Step 1: Tests first (≥ 3)**

```ts
// tests/integration/api/sceneflow-generate-scenes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sonnetMock, scenesDbMock, storiesDbMock, charsDbMock, getSession, poolConnect } =
  vi.hoisted(() => {
    const clientQuery = vi.fn();
    const clientRelease = vi.fn();
    return {
      sonnetMock: { generateScenesViaSonnet: vi.fn() },
      scenesDbMock: {
        deleteScenesByStory: vi.fn(),
        createScenes: vi.fn()
      },
      storiesDbMock: { loadStory: vi.fn() },
      charsDbMock: { listCharactersByIds: vi.fn() },
      getSession: vi.fn(),
      poolConnect: vi.fn(() =>
        Promise.resolve({ query: clientQuery, release: clientRelease })),
      clientQuery, clientRelease
    };
  });

vi.mock('@/lib/sceneflow/sonnet', () => sonnetMock);
vi.mock('@/lib/sceneflow/scenes-db', () => scenesDbMock);
vi.mock('@/lib/sceneflow/stories-db', () => storiesDbMock);
vi.mock('@/lib/sceneflow/characters-db', () => charsDbMock);
vi.mock('@/lib/db/pg', () => ({ pool: { connect: poolConnect } }));
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession } }
}));

import { POST } from '@/app/api/sceneflow/stories/[id]/generate-scenes/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/sceneflow/stories/[id]/generate-scenes', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(
      new Request('http://x', { method: 'POST', body: '{}' }),
      { params: { id: 'story-1' } }
    );
    expect(res.status).toBe(401);
  });

  it('happy path — Sonnet → coerce → TX(delete+insert)', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    storiesDbMock.loadStory.mockResolvedValue({
      id: 'story-1', user_id: 'u-1', title: 't', format: '16:9',
      visual_style: null, characters: ['c-1'], story_text: 'A story',
      status: 'draft', created_at: '', updated_at: ''
    });
    charsDbMock.listCharactersByIds.mockResolvedValue([{ id: 'c-1', name: 'A', type: 'person' }]);
    sonnetMock.generateScenesViaSonnet.mockResolvedValue({
      scenes: [{ scene_order: 1, type: 'action' /* ... */ }],
      usage: { input_tokens: 100, output_tokens: 50 }
    });
    scenesDbMock.createScenes.mockResolvedValue([
      { id: 'sc-1', scene_order: 1 /* full record */ }
    ]);
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ storyText: 'A story' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'story-1' } }
    );
    expect(res.status).toBe(200);
    // Wichtig: delete kommt im TX-Client, nicht direkt
    expect(scenesDbMock.deleteScenesByStory).toHaveBeenCalled();
    expect(scenesDbMock.createScenes).toHaveBeenCalled();
  });

  it('Sonnet error → OLD SCENES STAY (no delete, no insert)', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    storiesDbMock.loadStory.mockResolvedValue({
      id: 'story-1', user_id: 'u-1', title: 't', format: '16:9',
      visual_style: null, characters: [], story_text: 'A story',
      status: 'draft', created_at: '', updated_at: ''
    });
    charsDbMock.listCharactersByIds.mockResolvedValue([]);
    sonnetMock.generateScenesViaSonnet.mockRejectedValue(new Error('Sonnet 500'));
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ storyText: 'A story' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'story-1' } }
    );
    expect(res.status).toBe(502);
    expect(scenesDbMock.deleteScenesByStory).not.toHaveBeenCalled();
    expect(scenesDbMock.createScenes).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// app/api/sceneflow/stories/[id]/generate-scenes/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { pool } from '@/lib/db/pg';
import { loadStory } from '@/lib/sceneflow/stories-db';
import { listCharactersByIds } from '@/lib/sceneflow/characters-db';
import { generateScenesViaSonnet } from '@/lib/sceneflow/sonnet';
import { deleteScenesByStory, createScenes } from '@/lib/sceneflow/scenes-db';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const storyText = (body as { storyText?: unknown }).storyText;
  if (typeof storyText !== 'string' || storyText.trim().length === 0) {
    return NextResponse.json({ error: 'empty storyText' }, { status: 400 });
  }

  // 1. Story laden + Ownership-Check
  const story = await loadStory({ userId: session.user.id, storyId: params.id });
  if (!story) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // 2. Charaktere der Story laden
  const characters = await listCharactersByIds(session.user.id, story.characters);
  if (characters.length === 0) {
    return NextResponse.json({ error: 'no characters in story' }, { status: 400 });
  }

  // 3. Server-side @Name-Validierung (Defense in Depth)
  const knownNames = new Set(characters.map((c) => c.name.toLowerCase()));
  const referenced = Array.from(storyText.matchAll(/@(\w+)/g)).map((m) => m[1]!.toLowerCase());
  const unknown = referenced.find((n) => !knownNames.has(n));
  if (unknown !== undefined) {
    return NextResponse.json(
      { error: `unknown character @${unknown}` },
      { status: 400 }
    );
  }

  // 4. Sonnet-Call — Fehler hier bedeutet OLD SCENES BLEIBEN
  let sonnetResult;
  try {
    sonnetResult = await generateScenesViaSonnet({
      storyText, story, characters
    });
  } catch (e) {
    console.error('[generate-scenes] sonnet error', e);
    return NextResponse.json(
      { error: 'sonnet call failed: ' + (e as Error).message },
      { status: 502 }
    );
  }

  // 5. Token-Usage loggen
  console.log('[generate-scenes]', {
    storyId: params.id,
    input_tokens: sonnetResult.usage.input_tokens,
    output_tokens: sonnetResult.usage.output_tokens,
    scene_count: sonnetResult.scenes.length
  });

  // 6. Transaktion: DELETE alte + INSERT neue
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await deleteScenesByStory(params.id, client);
    const created = await createScenes(params.id, sonnetResult.scenes, client);
    await client.query('COMMIT');
    return NextResponse.json({ scenes: created });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[generate-scenes] tx error', e);
    return NextResponse.json(
      { error: 'database tx failed: ' + (e as Error).message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```powershell
git add app/api/sceneflow/stories/[id]/generate-scenes tests/integration/api/sceneflow-generate-scenes.test.ts
git commit -m "feat(sceneflow): generate-scenes route — Sonnet→coerce→TX rollback semantics"
```

---

### Task 11 — Client API + `useSceneFlowScenes`-Hook

**Files:** modify `lib/sceneflow/api-client.ts`, create `lib/hooks/useSceneFlowScenes.ts`

- [ ] **Step 1: api-client erweitern**

```ts
// lib/sceneflow/api-client.ts (additions)
import type { SceneRecord } from './types';
import type { UpdateScenePatch, NewSceneInput } from './scenes-db';

export async function apiListScenes(storyId: string): Promise<{ scenes: SceneRecord[] }> {
  return json(await fetch(`/api/sceneflow/stories/${encodeURIComponent(storyId)}/scenes`));
}

export async function apiPatchScene(
  sceneId: string,
  patch: UpdateScenePatch,
  signal?: AbortSignal
): Promise<{ ok: true }> {
  return json(
    await fetch(`/api/sceneflow/scenes/${encodeURIComponent(sceneId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
      signal
    })
  );
}

export async function apiDeleteScene(sceneId: string): Promise<{ ok: true }> {
  return json(
    await fetch(`/api/sceneflow/scenes/${encodeURIComponent(sceneId)}`, {
      method: 'DELETE'
    })
  );
}

export async function apiReorderScenes(
  storyId: string,
  aId: string,
  bId: string
): Promise<{ ok: true }> {
  return json(
    await fetch(`/api/sceneflow/stories/${encodeURIComponent(storyId)}/scenes/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aId, bId })
    })
  );
}

export async function apiGenerateScenes(
  storyId: string,
  storyText: string
): Promise<{ scenes: SceneRecord[] }> {
  return json(
    await fetch(`/api/sceneflow/stories/${encodeURIComponent(storyId)}/generate-scenes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storyText })
    })
  );
}

export async function apiPatchStory(
  storyId: string,
  patch: {
    title?: string;
    format?: '16:9' | '9:16' | '4:3';
    visualStyle?: string | null;
    characters?: string[];
    storyText?: string | null;
  }
): Promise<{ ok: true }> {
  return json(
    await fetch(`/api/sceneflow/stories/${encodeURIComponent(storyId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch)
    })
  );
}
```

- [ ] **Step 2: Hook**

```ts
// lib/hooks/useSceneFlowScenes.ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apiListScenes,
  apiPatchScene,
  apiDeleteScene,
  apiReorderScenes,
  apiGenerateScenes
} from '@/lib/sceneflow/api-client';
import type { SceneRecord } from '@/lib/sceneflow/types';
import type { UpdateScenePatch } from '@/lib/sceneflow/scenes-db';

const DEBOUNCE_MS = 500;

export function useSceneFlowScenes(storyId: string | null) {
  const [scenes, setScenes] = useState<SceneRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // AbortController-Map: key = `${sceneId}:${field}`. Vor jedem
  // neuen PATCH den vorherigen abbrechen → Last-Write-Wins.
  const aborts = useRef(new Map<string, AbortController>());
  const debounceTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const refresh = useCallback(async () => {
    if (!storyId) {
      setScenes([]);
      return;
    }
    setLoading(true);
    try {
      const { scenes } = await apiListScenes(storyId);
      setScenes(scenes);
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  /**
   * Debounced PATCH mit AbortController. Pro `(sceneId, field)`
   * wird der vorherige Request abgebrochen.
   */
  const patchField = useCallback(
    (sceneId: string, field: keyof UpdateScenePatch, value: unknown) => {
      const key = `${sceneId}:${String(field)}`;
      // Optimistic UI: lokal sofort updaten
      setScenes((cur) =>
        cur.map((s) => (s.id === sceneId ? { ...s, [field]: value } : s))
      );
      // Debounce + Abort
      clearTimeout(debounceTimers.current.get(key));
      const timer = setTimeout(() => {
        aborts.current.get(key)?.abort();
        const ctl = new AbortController();
        aborts.current.set(key, ctl);
        apiPatchScene(sceneId, { [field]: value } as UpdateScenePatch, ctl.signal).catch(
          (e: unknown) => {
            if (e instanceof Error && e.name === 'AbortError') return;
            console.error('[sceneflow] patch failed', e);
          }
        );
      }, DEBOUNCE_MS);
      debounceTimers.current.set(key, timer);
    },
    []
  );

  /**
   * Sofortiger (nicht-debounced) PATCH — für Select/Radio/Buttons.
   * Trotzdem AbortController-geschützt.
   */
  const patchFieldImmediate = useCallback(
    async (sceneId: string, field: keyof UpdateScenePatch, value: unknown) => {
      const key = `${sceneId}:${String(field)}`;
      aborts.current.get(key)?.abort();
      const ctl = new AbortController();
      aborts.current.set(key, ctl);
      setScenes((cur) =>
        cur.map((s) => (s.id === sceneId ? { ...s, [field]: value } : s))
      );
      try {
        await apiPatchScene(sceneId, { [field]: value } as UpdateScenePatch, ctl.signal);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        throw e;
      }
    },
    []
  );

  const remove = useCallback(async (sceneId: string) => {
    await apiDeleteScene(sceneId);
    await refresh();
  }, [refresh]);

  const reorder = useCallback(
    async (aId: string, bId: string) => {
      if (!storyId) return;
      await apiReorderScenes(storyId, aId, bId);
      await refresh();
    },
    [storyId, refresh]
  );

  const generate = useCallback(
    async (storyText: string) => {
      if (!storyId) return;
      setGenerating(true);
      try {
        const { scenes } = await apiGenerateScenes(storyId, storyText);
        setScenes(scenes);
      } finally {
        setGenerating(false);
      }
    },
    [storyId]
  );

  // Cleanup: alle Abort-Controller + Timer
  useEffect(() => {
    return () => {
      aborts.current.forEach((c) => c.abort());
      debounceTimers.current.forEach((t) => clearTimeout(t));
      aborts.current.clear();
      debounceTimers.current.clear();
    };
  }, []);

  return {
    scenes, loading, generating,
    refresh, patchField, patchFieldImmediate, remove, reorder, generate
  };
}
```

- [ ] **Step 3: Typecheck**

- [ ] **Step 4: Commit**

```powershell
git add lib/sceneflow/api-client.ts lib/hooks/useSceneFlowScenes.ts
git commit -m "feat(sceneflow): api-client scenes + useSceneFlowScenes (AbortController debounce)"
```

---

### Task 12 — SceneFlowShell + StoryList Navigation

**Files:** modify `components/SceneFlow/SceneFlowShell.tsx`, modify `components/SceneFlow/StoryList.tsx`

- [ ] **Step 1: StoryList — `onSelect`-Prop ergänzen**

```tsx
// components/SceneFlow/StoryList.tsx (mod)
export function StoryList({ onSelect }: { onSelect(storyId: string): void }) {
  // ... bestehende Logik
  // Die Kachel-li wird zu einem Button-li mit onClick={() => onSelect(s.id)}
  // Delete-Button bekommt onPointerDown-stopPropagation, damit Klick auf
  // [✕] nicht die Story öffnet.
}
```

Konkret in der `<li>`:
```tsx
<li
  key={s.id}
  onClick={() => onSelect(s.id)}
  className="bg-[var(--surface-2)] rounded-lg p-3 flex flex-col gap-2 cursor-pointer hover:bg-[var(--surface-3)]"
>
  ...
  <button
    onClick={(e) => { e.stopPropagation(); del(s); }}
    ...
  >✕</button>
</li>
```

- [ ] **Step 2: SceneFlowShell — `activeStoryId` State + Conditional**

```tsx
// components/SceneFlow/SceneFlowShell.tsx (rewrite)
'use client';
import { useState } from 'react';
import { CharacterManager } from './CharacterManager';
import { NewStoryButton } from './NewStoryButton';
import { StoryList } from './StoryList';
import { StoryDetailView } from './StoryDetailView';

export function SceneFlowShell() {
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeStoryId, setActiveStoryId] = useState<string | null>(null);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
      <div className="max-w-5xl mx-auto p-6">
        {activeStoryId === null ? (
          <>
            <div className="flex items-center gap-3 mb-2">
              <button
                type="button"
                onClick={() => setCharactersOpen(true)}
                className="text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] px-3 py-1 rounded border border-[var(--border)]"
              >
                👤 Charaktere
              </button>
              <NewStoryButton onCreated={() => setRefreshKey((k) => k + 1)} />
            </div>
            <StoryList key={refreshKey} onSelect={setActiveStoryId} />
          </>
        ) : (
          <StoryDetailView
            storyId={activeStoryId}
            onBack={() => setActiveStoryId(null)}
          />
        )}
      </div>
      <CharacterManager
        open={charactersOpen}
        onClose={() => setCharactersOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck** (StoryDetailView existiert noch nicht — kommt Task 13)

Vorübergehend wird Task 13 zusammen committed. Oder Stub-File zuerst,
dann Detail in 13. Plan: Stub `StoryDetailView.tsx` jetzt mit
`return <div>TODO</div>` + komplette Logik in Task 13.

```tsx
// components/SceneFlow/StoryDetailView.tsx (Stub für Task 12)
'use client';
export function StoryDetailView({
  onBack
}: { storyId: string; onBack(): void }) {
  return (
    <div>
      <button onClick={onBack}>← Zurück</button>
      <div>TODO: StoryDetailView</div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```powershell
git add components/SceneFlow/SceneFlowShell.tsx components/SceneFlow/StoryList.tsx components/SceneFlow/StoryDetailView.tsx
git commit -m "feat(sceneflow): SceneFlowShell + StoryList navigation (activeStoryId)"
```

---

### Task 13 — StoryDetailView + StorySetupForm

**Files:** modify `components/SceneFlow/StoryDetailView.tsx`,
create `components/SceneFlow/StorySetupForm.tsx`

- [ ] **Step 1: StorySetupForm**

```tsx
// components/SceneFlow/StorySetupForm.tsx
'use client';
import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { apiPatchStory } from '@/lib/sceneflow/api-client';
import { useSceneFlowCharacters } from '@/lib/hooks/useSceneFlowCharacters';
import type { StoryRecord, StoryFormat, CharacterRecord } from '@/lib/sceneflow/types';

const DEBOUNCE_MS = 500;

export function StorySetupForm({
  story,
  onPatched
}: {
  story: StoryRecord;
  onPatched(patch: Partial<StoryRecord>): void;
}) {
  const { characters: allChars } = useSceneFlowCharacters();
  const [title, setTitle] = useState(story.title);
  const [format, setFormat] = useState<StoryFormat>(story.format);
  const [visualStyle, setVisualStyle] = useState(story.visual_style ?? '');
  const [selected, setSelected] = useState<string[]>(story.characters);
  const [showCharPicker, setShowCharPicker] = useState(false);
  const titleTimer = useRef<ReturnType<typeof setTimeout>>();
  const styleTimer = useRef<ReturnType<typeof setTimeout>>();
  const aborts = useRef(new Map<string, AbortController>());

  // Sync if story changes externally (z.B. nach Server-Refresh)
  useEffect(() => { setTitle(story.title); }, [story.title]);
  useEffect(() => { setFormat(story.format); }, [story.format]);
  useEffect(() => { setVisualStyle(story.visual_style ?? ''); }, [story.visual_style]);
  useEffect(() => { setSelected(story.characters); }, [story.characters]);

  function debouncedPatch<T>(key: string, ms: number, patch: () => Promise<unknown>) {
    aborts.current.get(key)?.abort();
    const ctl = new AbortController();
    aborts.current.set(key, ctl);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        patch().then(() => resolve(), () => resolve());
      }, ms);
    });
  }

  function patchTitle(v: string) {
    setTitle(v);
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      apiPatchStory(story.id, { title: v.trim() || 'Untitled Story' })
        .then(() => onPatched({ title: v.trim() || 'Untitled Story' }))
        .catch(() => toast.error('Titel-Speichern fehlgeschlagen'));
    }, DEBOUNCE_MS);
  }
  function patchFormat(v: StoryFormat) {
    setFormat(v);
    apiPatchStory(story.id, { format: v })
      .then(() => onPatched({ format: v }))
      .catch(() => toast.error('Format-Speichern fehlgeschlagen'));
  }
  function patchVisualStyle(v: string) {
    setVisualStyle(v);
    clearTimeout(styleTimer.current);
    styleTimer.current = setTimeout(() => {
      const val = v.trim() || null;
      apiPatchStory(story.id, { visualStyle: val })
        .then(() => onPatched({ visual_style: val }))
        .catch(() => toast.error('Stil-Speichern fehlgeschlagen'));
    }, DEBOUNCE_MS);
  }
  function toggleChar(charId: string) {
    const next = selected.includes(charId)
      ? selected.filter((id) => id !== charId)
      : [...selected, charId];
    setSelected(next);
    apiPatchStory(story.id, { characters: next })
      .then(() => onPatched({ characters: next }))
      .catch(() => toast.error('Charaktere-Speichern fehlgeschlagen'));
  }

  const selectedChars = allChars.filter((c) => selected.includes(c.id));
  const unselectedChars = allChars.filter((c) => !selected.includes(c.id));

  return (
    <section className="space-y-3 bg-[var(--surface-1)] rounded-lg p-4 border border-[var(--border)]">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-[var(--text-dim)]">Titel</span>
          <input
            value={title}
            onChange={(e) => patchTitle(e.target.value)}
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--text-dim)]">Format</span>
          <select
            value={format}
            onChange={(e) => patchFormat(e.target.value as StoryFormat)}
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
          >
            <option value="16:9">16:9 (Landscape)</option>
            <option value="9:16">9:16 (Portrait)</option>
            <option value="4:3">4:3</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">Visueller Stil</span>
        <input
          value={visualStyle}
          onChange={(e) => patchVisualStyle(e.target.value)}
          placeholder="cinematisch, warmes Licht ..."
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
        />
      </label>
      <div>
        <span className="text-xs text-[var(--text-dim)]">Charaktere</span>
        <div className="mt-1 flex flex-wrap gap-1 items-center">
          {selectedChars.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleChar(c.id)}
              className="text-xs bg-[var(--surface-3)] text-[var(--text)] px-2 py-0.5 rounded-full"
              title="Entfernen"
            >
              @{c.name} ×
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowCharPicker((v) => !v)}
            className="text-xs text-[var(--a2)] hover:text-[var(--a1)] px-2 py-0.5"
          >
            + Charakter wählen
          </button>
        </div>
        {showCharPicker && (
          <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto bg-[var(--surface-2)] border border-[var(--border)] rounded p-2">
            {unselectedChars.length === 0 && (
              <li className="text-xs text-[var(--text-dim)]">
                Keine weiteren Charaktere — neue über Charaktere-Drawer anlegen.
              </li>
            )}
            {unselectedChars.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => { toggleChar(c.id); setShowCharPicker(false); }}
                  className="w-full text-left text-xs text-[var(--text)] hover:bg-[var(--surface-3)] rounded px-2 py-1"
                >
                  @{c.name} <span className="text-[var(--text-muted)]">[{c.type}]</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[10px] text-[var(--text-muted)]">
        Änderungen wirken sich erst beim nächsten „Mit KI aufteilen" auf bestehende Szenen aus.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: StoryDetailView (Stub aus Task 12 ersetzen)**

```tsx
// components/SceneFlow/StoryDetailView.tsx
'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { StorySetupForm } from './StorySetupForm';
import { StoryTextInput } from './StoryTextInput';
import { Storyboard } from './Storyboard';
import { useSceneFlowScenes } from '@/lib/hooks/useSceneFlowScenes';
import { useSceneFlowCharacters } from '@/lib/hooks/useSceneFlowCharacters';
import type { StoryRecord } from '@/lib/sceneflow/types';

export function StoryDetailView({
  storyId,
  onBack
}: {
  storyId: string;
  onBack(): void;
}) {
  const [story, setStory] = useState<StoryRecord | null>(null);
  const [storyLoading, setStoryLoading] = useState(false);
  const { scenes, generating, generate, patchField, patchFieldImmediate, remove, reorder, refresh } =
    useSceneFlowScenes(storyId);
  const { characters: allChars } = useSceneFlowCharacters();

  useEffect(() => {
    setStoryLoading(true);
    fetch(`/api/sceneflow/stories?withScenes=0`)  // listStories — wir suchen die Story
      .then((r) => r.json())
      .then((data: { stories: StoryRecord[] }) => {
        const found = data.stories.find((s) => s.id === storyId) ?? null;
        setStory(found);
      })
      .catch(() => toast.error('Story-Laden fehlgeschlagen'))
      .finally(() => setStoryLoading(false));
  }, [storyId]);

  if (storyLoading) {
    return <div className="text-xs text-[var(--text-dim)]">Story wird geladen ...</div>;
  }
  if (!story) {
    return (
      <div>
        <button type="button" onClick={onBack} className="text-xs text-[var(--a2)] hover:text-[var(--a1)] mb-3">
          ← Zurück
        </button>
        <div className="text-sm text-[var(--text-dim)]">Story nicht gefunden.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-[var(--a2)] hover:text-[var(--a1)]"
        >
          ← Zurück zu Stories
        </button>
        <h2 className="text-sm font-bold text-[var(--text)] truncate">{story.title}</h2>
      </div>
      <StorySetupForm
        story={story}
        onPatched={(patch) => setStory((s) => (s ? { ...s, ...patch } : s))}
      />
      <StoryTextInput
        story={story}
        characters={allChars.filter((c) => story.characters.includes(c.id))}
        scenesExist={scenes.length > 0}
        generating={generating}
        onGenerate={(text) => generate(text)}
        onStoryTextPatched={(text) =>
          setStory((s) => (s ? { ...s, story_text: text } : s))
        }
      />
      <Storyboard
        scenes={scenes}
        characters={allChars}
        onPatchField={patchField}
        onPatchFieldImmediate={patchFieldImmediate}
        onDelete={remove}
        onReorder={reorder}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck** — StoryTextInput + Storyboard sind noch Stubs.
  Stub-Files anlegen damit der Build durchläuft; volle Logik in Tasks 14 + 16.

- [ ] **Step 4: Commit (zusammen mit Stub-Stories)**

```powershell
# Nach Task 13 + Stubs für 14/16:
git add components/SceneFlow/StoryDetailView.tsx components/SceneFlow/StorySetupForm.tsx components/SceneFlow/StoryTextInput.tsx components/SceneFlow/Storyboard.tsx
git commit -m "feat(sceneflow): StoryDetailView + StorySetupForm + child stubs"
```

---

### Task 14 — StoryTextInput + `@`-Validate + "Mit KI aufteilen"

**Files:** modify `components/SceneFlow/StoryTextInput.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/SceneFlow/StoryTextInput.tsx
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiPatchStory } from '@/lib/sceneflow/api-client';
import type { StoryRecord, CharacterRecord } from '@/lib/sceneflow/types';

const DEBOUNCE_MS = 500;
const RE_REF = /@(\w+)/g;

export function StoryTextInput({
  story,
  characters,
  scenesExist,
  generating,
  onGenerate,
  onStoryTextPatched
}: {
  story: StoryRecord;
  characters: CharacterRecord[];
  scenesExist: boolean;
  generating: boolean;
  onGenerate(text: string): void;
  onStoryTextPatched(text: string | null): void;
}) {
  const [text, setText] = useState(story.story_text ?? '');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setText(story.story_text ?? ''); }, [story.id, story.story_text]);

  const { unknownRefs } = useMemo(() => {
    const known = new Set(characters.map((c) => c.name.toLowerCase()));
    const refs = Array.from(text.matchAll(RE_REF)).map((m) => m[1]!);
    const unknown = refs.filter((r) => !known.has(r.toLowerCase()));
    return { unknownRefs: Array.from(new Set(unknown)) };
  }, [text, characters]);

  function onChange(v: string) {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const val = v.trim() === '' ? null : v;
      apiPatchStory(story.id, { storyText: val })
        .then(() => onStoryTextPatched(val))
        .catch(() => toast.error('Story-Text-Speichern fehlgeschlagen'));
    }, DEBOUNCE_MS);
  }

  const disabledReason =
    characters.length === 0
      ? 'Bitte mindestens einen Charakter auswählen'
      : text.trim().length === 0
      ? 'Story-Text fehlt'
      : unknownRefs.length > 0
      ? `Unbekannte Referenz: @${unknownRefs[0]}`
      : null;

  async function doGenerate() {
    if (disabledReason) return;
    if (scenesExist) {
      const ok = window.confirm(
        'Alle bestehenden Szenen werden ersetzt — manuelle Bearbeitungen gehen verloren. Trotzdem fortfahren?'
      );
      if (!ok) return;
    }
    // Story-Text persistieren falls noch nicht (User klickt Generate
    // direkt nach Tippen, vor Debounce-Ablauf)
    if (story.story_text !== text) {
      try {
        await apiPatchStory(story.id, { storyText: text });
        onStoryTextPatched(text);
      } catch {
        toast.error('Story-Text-Speichern fehlgeschlagen');
        return;
      }
    }
    try {
      await onGenerate(text);
      toast.success('Szenen erzeugt');
    } catch (e) {
      toast.error('Sonnet-Fehler: ' + (e as Error).message);
    }
  }

  return (
    <section className="space-y-2 bg-[var(--surface-1)] rounded-lg p-4 border border-[var(--border)]">
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">Beschreibe deine Story</span>
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          placeholder="Eine Frau (@Magdalena) geht durch einen Wald ..."
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-sm"
        />
      </label>
      {unknownRefs.length > 0 && (
        <div className="text-xs text-red-400">
          Unbekannte Charakter-Referenzen: {unknownRefs.map((r) => `@${r}`).join(', ')}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={doGenerate}
          disabled={disabledReason !== null || generating}
          title={disabledReason ?? undefined}
          className="bg-[var(--a1)] text-white text-xs px-3 py-1 rounded disabled:opacity-50"
        >
          {generating ? '... Sonnet arbeitet ...' : 'Mit KI aufteilen →'}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck + Manual smoke**

- [ ] **Step 3: Commit**

```powershell
git add components/SceneFlow/StoryTextInput.tsx
git commit -m "feat(sceneflow): StoryTextInput — @-validate + Mit-KI-aufteilen + confirm"
```

---

### Task 15 — CameraControlSliders

**Files:** create `components/SceneFlow/CameraControlSliders.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/SceneFlow/CameraControlSliders.tsx
'use client';
import type { CameraControl } from '@/lib/sceneflow/types';

interface Props {
  value: CameraControl;
  onChange(next: CameraControl): void;
}

function Slider({
  label, value, min, max, step, onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(v: number): void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] text-[var(--text-muted)]">
        {label}: <span className="text-[var(--text)]">{value.toFixed(step < 1 ? 1 : 0)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--a1)]"
      />
    </label>
  );
}

export function CameraControlSliders({ value, onChange }: Props) {
  return (
    <div className="space-y-1 bg-[var(--surface-3)] rounded p-2">
      <div className="text-[10px] uppercase text-[var(--text-muted)] tracking-wider">Kamera</div>
      <div className="grid grid-cols-3 gap-2">
        <Slider
          label="Zoom"
          value={value.zoom}
          min={-5} max={5} step={0.5}
          onChange={(zoom) => onChange({ ...value, zoom })}
        />
        <Slider
          label="Pan L/R"
          value={value.panX}
          min={-5} max={5} step={0.5}
          onChange={(panX) => onChange({ ...value, panX })}
        />
        <Slider
          label="Pan U/D"
          value={value.panY}
          min={-5} max={5} step={0.5}
          onChange={(panY) => onChange({ ...value, panY })}
        />
      </div>
      <Slider
        label="Bewegungsintensität"
        value={value.motionIntensity}
        min={1} max={10} step={1}
        onChange={(motionIntensity) => onChange({ ...value, motionIntensity })}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add components/SceneFlow/CameraControlSliders.tsx
git commit -m "feat(sceneflow): CameraControlSliders (zoom + panX + panY + intensity)"
```

---

### Task 16 — Storyboard + SceneCard + EndcardEditor

**Files:** modify `components/SceneFlow/Storyboard.tsx`,
create `components/SceneFlow/SceneCard.tsx`,
create `components/SceneFlow/EndcardEditor.tsx`

- [ ] **Step 1: EndcardEditor**

```tsx
// components/SceneFlow/EndcardEditor.tsx
'use client';
import { useEffect, useState, useRef } from 'react';
import type { SceneRecord, Transition } from '@/lib/sceneflow/types';
import type { UpdateScenePatch } from '@/lib/sceneflow/scenes-db';

const DEBOUNCE_MS = 500;

export function EndcardEditor({
  scene,
  onPatchField,
  onPatchFieldImmediate
}: {
  scene: SceneRecord;
  onPatchField(sceneId: string, field: keyof UpdateScenePatch, value: unknown): void;
  onPatchFieldImmediate(sceneId: string, field: keyof UpdateScenePatch, value: unknown): Promise<void>;
}) {
  const [cta, setCta] = useState(scene.tts_text ?? '');
  const t = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { setCta(scene.tts_text ?? ''); }, [scene.id, scene.tts_text]);

  function onCtaChange(v: string) {
    setCta(v);
    clearTimeout(t.current);
    t.current = setTimeout(() => onPatchField(scene.id, 'tts_text', v || null), DEBOUNCE_MS);
  }

  return (
    <div className="space-y-2 p-3 bg-[var(--surface-3)] rounded">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        Endcard
      </div>
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">CTA-Text</span>
        <textarea
          value={cta}
          onChange={(e) => onCtaChange(e.target.value)}
          rows={2}
          placeholder="Folge mir für mehr Geschichten ..."
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-[var(--text-muted)]">Dauer</span>
          <input
            type="number"
            min={1} max={8}
            value={scene.duration}
            onChange={(e) =>
              onPatchFieldImmediate(scene.id, 'duration', Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 5)))
            }
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-[var(--text-muted)]">Transition</span>
          <select
            value={scene.transition}
            onChange={(e) =>
              onPatchFieldImmediate(scene.id, 'transition', e.target.value as Transition)
            }
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          >
            <option value="last-frame">Last frame</option>
            <option value="crossfade">Crossfade</option>
            <option value="cut">Cut</option>
          </select>
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: SceneCard** (action/dialog Variante)

```tsx
// components/SceneFlow/SceneCard.tsx
'use client';
import { useEffect, useState, useRef } from 'react';
import { CameraControlSliders } from './CameraControlSliders';
import { EndcardEditor } from './EndcardEditor';
import type {
  SceneRecord,
  CameraControl,
  AudioType,
  Transition,
  StartFrameMode,
  CharacterRecord
} from '@/lib/sceneflow/types';
import type { UpdateScenePatch } from '@/lib/sceneflow/scenes-db';

const DEBOUNCE_MS = 500;

const DEFAULT_CAMERA: CameraControl = {
  zoom: 0, panX: 0, panY: 0, motionIntensity: 5
};

export function SceneCard({
  scene,
  characters,
  canMoveUp,
  canMoveDown,
  onPatchField,
  onPatchFieldImmediate,
  onDelete,
  onMoveUp,
  onMoveDown
}: {
  scene: SceneRecord;
  characters: CharacterRecord[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPatchField(sceneId: string, field: keyof UpdateScenePatch, value: unknown): void;
  onPatchFieldImmediate(sceneId: string, field: keyof UpdateScenePatch, value: unknown): Promise<void>;
  onDelete(sceneId: string): void;
  onMoveUp(): void;
  onMoveDown(): void;
}) {
  const [imagePrompt, setImagePrompt] = useState(scene.image_prompt ?? '');
  const [motionPrompt, setMotionPrompt] = useState(scene.motion_prompt ?? '');
  const [ttsText, setTtsText] = useState(scene.tts_text ?? '');
  const imgT = useRef<ReturnType<typeof setTimeout>>();
  const motT = useRef<ReturnType<typeof setTimeout>>();
  const ttsT = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setImagePrompt(scene.image_prompt ?? ''); }, [scene.id, scene.image_prompt]);
  useEffect(() => { setMotionPrompt(scene.motion_prompt ?? ''); }, [scene.id, scene.motion_prompt]);
  useEffect(() => { setTtsText(scene.tts_text ?? ''); }, [scene.id, scene.tts_text]);

  function delTextarea(field: keyof UpdateScenePatch, v: string, ref: typeof imgT) {
    clearTimeout(ref.current);
    ref.current = setTimeout(() => onPatchField(scene.id, field, v), DEBOUNCE_MS);
  }

  if (scene.type === 'endcard') {
    return (
      <SceneCardShell
        scene={scene}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDelete={() => onDelete(scene.id)}
      >
        <EndcardEditor
          scene={scene}
          onPatchField={onPatchField}
          onPatchFieldImmediate={onPatchFieldImmediate}
        />
      </SceneCardShell>
    );
  }

  const camera = scene.camera_control ?? DEFAULT_CAMERA;

  return (
    <SceneCardShell
      scene={scene}
      canMoveUp={canMoveUp}
      canMoveDown={canMoveDown}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onDelete={() => onDelete(scene.id)}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Bild</span>
          <textarea
            value={imagePrompt}
            onChange={(e) => { setImagePrompt(e.target.value); delTextarea('image_prompt', e.target.value, imgT); }}
            rows={3}
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          />
          <div className="aspect-video bg-[var(--surface-3)] rounded flex items-center justify-center text-[10px] text-[var(--text-muted)]">
            Bild kommt in Plan 8c
          </div>
        </div>
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Video</span>
          <textarea
            value={motionPrompt}
            onChange={(e) => { setMotionPrompt(e.target.value); delTextarea('motion_prompt', e.target.value, motT); }}
            rows={3}
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          />
          <div className="aspect-video bg-[var(--surface-3)] rounded flex items-center justify-center text-[10px] text-[var(--text-muted)]">
            Video kommt in Plan 8c
          </div>
        </div>
      </div>

      <div>
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Startbild</span>
        <div className="flex gap-3 mt-1 text-xs text-[var(--text)]">
          {(['auto', 'from-previous', 'custom'] as StartFrameMode[]).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="radio"
                name={`sfm-${scene.id}`}
                checked={scene.start_frame_mode === m}
                onChange={() => onPatchFieldImmediate(scene.id, 'start_frame_mode', m)}
              />
              {m === 'auto' ? 'Auto' : m === 'from-previous' ? 'Letzter Frame' : 'Upload (8c)'}
            </label>
          ))}
        </div>
      </div>

      <CameraControlSliders
        value={camera}
        onChange={(next) => onPatchField(scene.id, 'camera_control', next)}
      />

      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Audio</span>
        <div className="flex gap-3 text-xs text-[var(--text)]">
          {(['none', 'voiceover', 'lipsync'] as AudioType[]).map((a) => (
            <label key={a} className="flex items-center gap-1">
              <input
                type="radio"
                name={`audio-${scene.id}`}
                checked={scene.audio_type === a}
                onChange={() => onPatchFieldImmediate(scene.id, 'audio_type', a)}
              />
              {a === 'none' ? 'Kein Audio' : a === 'voiceover' ? 'Voiceover' : 'Dialog/LipSync'}
            </label>
          ))}
        </div>
        {scene.audio_type !== 'none' && (
          <>
            <select
              value={scene.speaking_character_id ?? ''}
              onChange={(e) =>
                onPatchFieldImmediate(scene.id, 'speaking_character_id', e.target.value || null)
              }
              className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
            >
              <option value="">— Charakter wählen —</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>@{c.name}</option>
              ))}
            </select>
            <textarea
              value={ttsText}
              onChange={(e) => { setTtsText(e.target.value); delTextarea('tts_text', e.target.value, ttsT); }}
              rows={2}
              placeholder="TTS-Text ..."
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-[var(--text-muted)]">Dauer (s)</span>
          <input
            type="number"
            min={1} max={8}
            value={scene.duration}
            onChange={(e) => onPatchFieldImmediate(scene.id, 'duration', Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 5)))}
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-[var(--text-muted)]">Transition</span>
          <select
            value={scene.transition}
            onChange={(e) => onPatchFieldImmediate(scene.id, 'transition', e.target.value as Transition)}
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          >
            <option value="last-frame">Last frame</option>
            <option value="crossfade">Crossfade</option>
            <option value="cut">Cut</option>
          </select>
        </label>
      </div>
    </SceneCardShell>
  );
}

function SceneCardShell({
  scene, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onDelete, children
}: {
  scene: SceneRecord;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp(): void;
  onMoveDown(): void;
  onDelete(): void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-[var(--text)]">
          Szene {scene.scene_order}
        </span>
        <span className="text-[10px] uppercase text-[var(--text-muted)] tracking-wider">
          {scene.type}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          disabled={!canMoveUp}
          onClick={onMoveUp}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-30 px-2"
          title="Nach oben"
        >↑</button>
        <button
          type="button"
          disabled={!canMoveDown}
          onClick={onMoveDown}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-30 px-2"
          title="Nach unten"
        >↓</button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Szene ${scene.scene_order} löschen?`)) onDelete();
          }}
          className="text-xs text-[var(--text-muted)] hover:text-red-400 px-2"
          title="Löschen"
        >×</button>
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Storyboard**

```tsx
// components/SceneFlow/Storyboard.tsx
'use client';
import { SceneCard } from './SceneCard';
import type { SceneRecord, CharacterRecord } from '@/lib/sceneflow/types';
import type { UpdateScenePatch } from '@/lib/sceneflow/scenes-db';

export function Storyboard({
  scenes,
  characters,
  onPatchField,
  onPatchFieldImmediate,
  onDelete,
  onReorder
}: {
  scenes: SceneRecord[];
  characters: CharacterRecord[];
  onPatchField(sceneId: string, field: keyof UpdateScenePatch, value: unknown): void;
  onPatchFieldImmediate(sceneId: string, field: keyof UpdateScenePatch, value: unknown): Promise<void>;
  onDelete(sceneId: string): Promise<void>;
  onReorder(aId: string, bId: string): Promise<void>;
}) {
  if (scenes.length === 0) {
    return (
      <div className="text-sm text-[var(--text-dim)] py-8 text-center bg-[var(--surface-1)] rounded-lg border border-[var(--border)]">
        Noch keine Szenen. Klicke <strong>Mit KI aufteilen</strong> sobald Story-Text + Charaktere stehen.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {scenes.map((s, i) => (
        <li key={s.id}>
          <SceneCard
            scene={s}
            characters={characters}
            canMoveUp={i > 0}
            canMoveDown={i < scenes.length - 1}
            onPatchField={onPatchField}
            onPatchFieldImmediate={onPatchFieldImmediate}
            onDelete={(id) => { onDelete(id).catch(() => {}); }}
            onMoveUp={() => { onReorder(s.id, scenes[i - 1]!.id).catch(() => {}); }}
            onMoveDown={() => { onReorder(s.id, scenes[i + 1]!.id).catch(() => {}); }}
          />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Typecheck + Build clean**

- [ ] **Step 5: Manual smoke** (CC #2)
  - Mit Story angelegt + Charaktere ausgewählt: "Mit KI aufteilen" → Karten erscheinen
  - Textarea ändern → DevTools zeigt PATCH nach 500ms
  - Slider bewegen → PATCH, kein Wert-Flackern
  - [↑][↓] → Reihenfolge tauscht
  - [×] → Confirm → Szene weg
  - Endcard-Karte zeigt nur CTA-Text-Editor, keine Image-/Motion-Prompts

- [ ] **Step 6: Commit**

```powershell
git add components/SceneFlow/SceneCard.tsx components/SceneFlow/EndcardEditor.tsx components/SceneFlow/Storyboard.tsx
git commit -m "feat(sceneflow): Storyboard + SceneCard + EndcardEditor (debounced PATCH)"
```

---

### Task 17 — KNOWN_LIMITATIONS

**Files:** modify `docs/KNOWN_LIMITATIONS.md`

- [ ] **Step 1: Append** (vor "Manual verification checklist"):

```markdown
## Plan 8b — Story-Input + Sonnet-Aufteilung + Storyboard

### Sonnet-Aufteilung ist destruktiv bei Re-Generate

"Mit KI aufteilen" löscht alle bestehenden Szenen und ersetzt sie
durch frische Sonnet-Ausgabe. Manuelle Bearbeitungen gehen verloren.
Der Confirm-Dialog warnt explizit. Merge-Logik (User-Edits zu
generierten Szenen mergen) ist out of scope für 8b — wird wenn
nötig in spätem Plan ergänzt.

### Sonnet-Fehler → alte Szenen bleiben (Transaction-Rollback)

Der Sonnet-Call passiert AUSSERHALB der DB-Transaction. Erst wenn
Sonnet erfolgreich geantwortet hat, beginnt die DELETE+INSERT-
Transaktion. Bei Sonnet-Timeout oder API-Fehler bleibt das Storyboard
unverändert. Verifiziert in `tests/integration/api/sceneflow-generate-scenes.test.ts`
und im manuellen DevTools-Network-Block-Smoke-Check.

### `tts_text` als CTA-Slot für Endcard ist pragmatisch

Die Endcard-Karte nutzt `VG_story_scenes.tts_text` für den CTA-Text
("Folge mir für mehr ..."). Eine eigene `cta_text`-Spalte wäre
semantisch sauberer — wird in einem späteren Plan als eigene Spalte
nachgezogen. Bis dahin: der Endcard-Renderer (8c) liest `tts_text`
als CTA, der TTS-Pfad ignoriert Endcards.

### `speaking_character_id` Hallucination-Schutz

Sonnet bekommt die Character-UUIDs als Kontext. Wenn das Modell
trotzdem eine erfundene UUID liefert (passiert bei langen Listen),
würde der FK-Constraint den INSERT brechen. Server-side Coerce-Logik
in `lib/sceneflow/sonnet.ts:coerceSonnetScenes()` validiert jede UUID
gegen die Story-Character-Liste und null-t bei Miss. Plus
`console.warn` für Cost-Audit (häufige Hallucination → System-Prompt
ergänzen).

### Anthropic prompt cache (5-Min-TTL)

System-Prompt + Charakter-Kontext sind mit `cache_control: ephemeral`
markiert. Mehrfaches "Mit KI aufteilen" innerhalb von 5 Minuten
spart ~80% Input-Tokens. Token-Usage wird über `console.log` aus der
generate-scenes-Route in den Server-Log geschrieben — für
Production-Cost-Audit auswerten.

### `@anthropic-ai/sdk@^0.30.1` — Tool-Use mit `system: [...]`-Array

Plan 8b nutzt System-Prompt als Array (zwei Blöcke mit eigenem
Cache-Control), nicht als String. Das SDK akzeptiert beides;
`@anthropic-ai/sdk@^0.30.1` unterstützt die Array-Form. Bei zukünftigem
SDK-Update muss Tool-Use + System-Array kompatibel bleiben.
```

- [ ] **Step 2: Commit**

```powershell
git add docs/KNOWN_LIMITATIONS.md
git commit -m "docs(limitations): Plan 8b — Sonnet semantics + endcard CTA + prompt cache"
```

---

### Task 18 — Final verify + push

- [ ] **Step 1: Full gate**

```powershell
npm run typecheck
npm run lint
npm test -- --run    # ≥ 754 + 20 = ≥ 774
npm run build
```

- [ ] **Step 2: Manual smoke checklist** (CC #2)

> **Architekt-Highlight:** Der kritischste Test ist
> "Sonnet-Fehler → alte Szenen bleiben". Explizit mit DevTools Network-
> Block auf `/api/sceneflow/stories/[id]/generate-scenes` verifizieren.

  - [ ] Login → SceneFlow-Tab → leere StoryListe
  - [ ] `+ Neue Story` → Story-Kachel erscheint
  - [ ] Klick Kachel → StoryDetailView öffnet sich, "← Zurück" oben
  - [ ] Setup-Form: Titel ändern → DevTools zeigt PATCH 500ms später
  - [ ] Format-Select ändern → sofortiger PATCH
  - [ ] Visueller Stil ändern → PATCH 500ms
  - [ ] Charakter hinzufügen → `@Name`-Badge erscheint, PATCH
  - [ ] Story-Text eingeben mit `@Magdalena` → kein Fehler
  - [ ] `@Unbekannt` reinschreiben → roter Inline-Fehler, Button disabled
  - [ ] Charakter entfernen → Story-Text-Refs werden ungültig → Button disabled
  - [ ] Charakter wieder hinzufügen → Button aktiv → "Mit KI aufteilen" klicken
  - [ ] Spinner → Karten erscheinen (~3-10 Karten + Endcard)
  - [ ] Image-Prompt-Textarea editieren → PATCH 500ms (DevTools)
  - [ ] Kamera-Slider bewegen → PATCH 500ms
  - [ ] Audio-Type "Dialog" wählen → Character-Dropdown + TTS-Textarea erscheinen
  - [ ] Charakter im Dropdown wählen → PATCH
  - [ ] [↑] auf Szene 2 → tauscht mit Szene 1, scene_order aktualisiert
  - [ ] [×] auf eine Szene → Confirm → weg
  - [ ] Endcard-Karte zeigt KEINE Image-/Motion-Prompts, nur CTA-Text + Dauer + Transition
  - [ ] **Kritisch:** DevTools → Network-Block `/generate-scenes` → "Mit KI aufteilen" → 502, **alte Karten bleiben sichtbar** ✅
  - [ ] Tab → VibeGrid → Playhead/Clips unverändert (8a-Smoke bleibt grün)
  - [ ] Anon-Key REST auf `VG_story_scenes` → `permission denied`

- [ ] **Step 3: Push**

```powershell
git push origin main
```

- [ ] **Step 4: CI grün**

---

## Verification gate

```powershell
npm test -- --run    # ≥ 774 passing (754 + 20)
npm run typecheck    # clean
npm run lint         # clean
npm run build        # clean
```

Bundle-Delta-Erwartung: **~40-80 kB** (Storyboard + SceneCard +
StoryDetailView + Hook). Anthropic-SDK + Sonnet-Logik sind
`server-only` und landen nicht im Client-Bundle.

---

## Commit-Struktur (Summary)

```
feat(db): VG_stories.characters JSONB + story_text TEXT (migration 003)
feat(ai): export getAnthropicClient for SceneFlow Sonnet reuse
feat(sceneflow): StoryRecord.characters/story_text + updateStory + loadStory
feat(sceneflow): listCharactersByIds for story-character lookup
feat(sceneflow): PATCH /stories/[id] — title/format/style/chars/text
feat(sceneflow): scenes-db — bulk-insert + JOIN-ownership + swap
feat(sceneflow): scene API routes — list/create/patch/delete/reorder
feat(sceneflow): sonnet client — tool-use + prompt-cache + coerce guardrails
feat(sceneflow): generate-scenes route — Sonnet→coerce→TX rollback semantics
feat(sceneflow): api-client scenes + useSceneFlowScenes (AbortController debounce)
feat(sceneflow): SceneFlowShell + StoryList navigation (activeStoryId)
feat(sceneflow): StoryDetailView + StorySetupForm + child stubs
feat(sceneflow): StoryTextInput — @-validate + Mit-KI-aufteilen + confirm
feat(sceneflow): CameraControlSliders (zoom + panX + panY + intensity)
feat(sceneflow): Storyboard + SceneCard + EndcardEditor (debounced PATCH)
docs(limitations): Plan 8b — Sonnet semantics + endcard CTA + prompt cache
```

16 Commits, eine Sache je Commit, granular und reviewbar.

---

## Risk + Tradeoff Notes

1. **Sonnet hallucinates speaking_character_id** — server-side Coerce
   schützt vor FK-Bruch. Wenn Hallucination häufig auftritt: System-
   Prompt um Beispiel + explizite UUID-Whitelist im Kontext verschärfen.

2. **Re-Generate ist destruktiv** — User-Confirm + KNOWN_LIMITATIONS-
   Eintrag. Merge-Logik (User-Edits zu Sonnet-Output mergen) ist
   komplex und out of scope; wenn Praxis zeigt dass nötig, separater
   Plan.

3. **`tts_text` als Endcard-CTA-Slot** — pragmatisch. Eigene
   `cta_text`-Spalte wäre sauberer, wird später nachgezogen (Architekt-
   Note).

4. **AbortController-Pattern bei Slidern erzeugt viele Aborts** —
   debounce 500ms federt das ab; ein gehaltener Slider triggert nur
   einen PATCH pro 500ms.

5. **Anthropic prompt cache nur auf System-Prompt** — Story-Text ist
   die User-Message, die ist NICHT gecached. Cache-Vorteil entsteht
   bei mehreren Re-Generates derselben Story innerhalb 5 Min oder
   bei vielen Stories desselben Users mit gleicher Charakter-Liste.

6. **Tool-Use mit `claude-sonnet-4-6` ist robust** — `analyze-image`
   nutzt das Modell schon erfolgreich. Bei zukünftigem Modell-Upgrade
   (Sonnet 4.7+): `lib/ai/env.ts` aktualisieren, kein Code-Change in
   8b.

7. **`@anthropic-ai/sdk@^0.30.1` Tool-Use + Array-System-Prompt** —
   beide Features sind stabil seit SDK 0.27. Bei SDK-Update auf 0.x
   die Tool-Schema-Form gegen Release-Notes prüfen.

---

## Done-Definition (für CC #2)

CC #2 darf Plan 8b als "erledigt" markieren, wenn:

- Alle 16 Commits auf `main` gepusht sind und CI grün läuft
- `npm test -- --run` zeigt ≥ 774 passing, 0 failing
- Live-Smoke-Checks (alle in T18 Step 2) ✅, **insbesondere** der
  DevTools-Network-Block-Test für Sonnet-Fehler-Rollback
- KNOWN_LIMITATIONS-Section ist im File
- `VG_story_scenes` mit anon-key über REST → `permission denied`
- Verschiedener User-Account sieht NICHT die Szenen des ersten Users
  (RLS-Defense-in-Depth verifiziert)
- Sonnet-Token-Logs erscheinen im Server-Log
