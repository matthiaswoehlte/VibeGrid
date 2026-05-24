# VibeGrid Plan 8a — SceneFlow Fundament

> **For agentic workers:** Plan execution policy (overrides skill defaults):
> direct-on-main, sequential, one commit per task, optional final review.
> NO subagent ceremony. CC #2 (tester) verifies live in parallel.

**Goal:** Zweiter Tab "SceneFlow" in VibeGrid mit Tab-Navigation, drei neuen DB-Tabellen (Characters/Stories/Story-Scenes), serverseitiger CRUD, Character Manager UI und leerer Storyboard-Shell. KEINE fal.ai-Calls und KEINE Sonnet-Integration — das ist reine Infrastruktur.

**Architecture:** Wiederverwendung der Plan-7-Patterns (pg Pool, Better-Auth Session-Check in API-Routes, RLS-Lockdown auf VG_-Tabellen, Service-Role-only DB-Zugriff). SceneFlow ist mode-switched innerhalb der bestehenden Studio-Route — kein eigenes Routing-Subtree. Mode-State als transienter Slice in `useAppStore` (Pattern wie `mobileUI`).

**Tech Stack:** Next.js 14 + Better-Auth (Plan 7) + Supabase Postgres + Zustand + Tailwind + `@fal-ai/client` (nur als dep für 8c — in 8a nur Typen-Import).

---

## Context

Baseline: HEAD post-Plan-7-incl-video-hotfix (`fac2d2d` + die nachfolgenden CI/Video-Fixes). **731 Tests** grün, Store v6, Better-Auth + VG_projects in Production-Use.

Plan 7 hat die volle DB+Auth-Schicht in Production gebracht. Plan 8a baut darauf auf: zweiter Workspace-Modus für KI-gestützten Story-Builder (SceneFlow). 8a ist explizit nur das **Fundament** — Tabellen, CRUD, UI-Shell. fal.ai und Sonnet kommen in 8b und 8c. "In VibeGrid öffnen"-Pipeline in 8d.

### Codebase-Analyse (Schritt 0 durchgeführt)

| Befund | Konsequenz für Plan 8a |
|---|---|
| Studio läuft auf `/` (Route Group `app/(studio)`), nicht auf `/studio` | SceneFlow lebt im selben Route Group. Mode-Switch via Conditional Rendering, KEIN nested `/sceneflow`-Subroute |
| TopBar hat zwei Cluster (links: Project/Transport; rechts: Export/Logout) | TabSwitcher kommt ganz links, restliche Cluster werden via `appMode === 'vibegrid'` conditional gerendert |
| `lib/store/mobile-ui-slice.ts` ist der etablierte Pattern für transiente UI-Slices (excluded from `partialize`) | `appMode` folgt dem 1:1 als `app-mode-slice.ts` |
| `lib/db/pg.ts`, `lib/auth/better-auth-server.ts`, `VG_fn_touch_updated_at`-Function, `scripts/apply-migration.mjs`, `vi.hoisted`-Mock-Pattern | Alles aus Plan 7 wiederverwendbar — keine Re-Implementierung |
| `lib/storage/r2-adapter.ts:createR2StorageAdapter().uploadImage(file)` POSTet an `/api/upload`, gibt `MediaRef` zurück | Character-Reference-Image-Upload nutzt das wieder — wir extrahieren nur `.url` und schreiben in `VG_characters.reference_image_url` (keine Media-Library-Pollution) |
| `lib/project/db.ts` (server-side CRUD), `app/api/projects/*` (API-Routes), `lib/project/api-client.ts` (client-fetch + 401-handling) | Pattern 1:1 reusable — Plan 8a kopiert die Struktur, nur tableName + Spalten anders |

---

## Goal

Sechs Features als reine Fundament-Schicht:

1. **Tab-Navigation** in der TopBar: VibeGrid / SceneFlow, aktiver Tab markiert via `--a1`.
2. **Datenmodell** in Supabase: `VG_characters`, `VG_stories`, `VG_story_scenes` mit RLS-Lockdown.
3. **Serverseitige CRUD** für Characters und Stories (Scenes-Befüllung kommt in 8b).
4. **API-Routes** mit Better-Auth-Session-Check.
5. **fal.ai Client-Stub** — Typen + NotImplemented-Throws (echte Calls in 8c).
6. **Character Manager UI** (Modal) + **leere SceneFlow-Shell** (StoryList + Story-Creation).

## Out of Scope

- **Sonnet Story-Aufteilung** → Plan 8b
- **Story-Input UI** (Story-Text-Textarea, Stil-Eingabe, Charaktere-Auswahl im Story-Setup) → Plan 8b
- **Storyboard mit Szenen-Karten** → Plan 8b
- **fal.ai echte API-Calls** (Image-Gen, Video-Gen, LipSync, Inpainting) → Plan 8c
- **TTS** (Azure + ElevenLabs) → Plan 8c
- **"In VibeGrid öffnen"** (Transfer von SceneFlow-Output in VibeGrid-Timeline) → Plan 8d
- **Bild-aus-Prompt generieren** (Character-Form: der `Generieren`-Button ist disabled in 8a)
- **R2-Key-Pfad-Migration** (Character-Images landen weiterhin unter `anonymous/default/image/…` — siehe Plan 7 KNOWN_LIMITATIONS, gleicher Punkt)

---

## Architecture insights

### 1. `appMode` als transienter Slice in `useAppStore`

Vorbild: `lib/store/mobile-ui-slice.ts` ist genau dieselbe Klasse von State — UI-only, transient, kein DOM-tree-Abhängigkeit. Die Slice-Datei dort dokumentiert die Begründung explizit (vermeidet Provider-Plumbing für viele Konsumenten).

`appMode` hat dieselben Eigenschaften:
- Wird von TopBar (TabSwitcher), Studio-Page (Conditional-Rendering), evtl. einzelnen Hooks gelesen
- Soll **nicht** persistiert werden — ein Reload startet immer im VibeGrid-Modus (matches mobileUI's Verhalten)
- Globaler State, also kein React-Context nötig

```ts
// lib/store/app-mode-slice.ts (NEU)
export type AppMode = 'vibegrid' | 'sceneflow';
export interface AppModeState { appMode: AppMode; }
export interface AppModeActions { setAppMode(mode: AppMode): void; }
export const initialAppModeState: AppModeState = { appMode: 'vibegrid' };
```

Slice wird in `useAppStore` via `...createAppModeSlice(set, get, store)` eingebunden, analog zu `createMobileUISlice`. Da `partialize` nur explizite Felder zurückgibt (siehe Plan 7 `lib/store/persist-shape.ts`), wird `appMode` automatisch nicht persistiert — keine zusätzliche Migration nötig.

### 2. Character Manager als Modal, NICHT als Route

Studio läuft auf `/` (Route Group `(studio)`). Eine nested Route wie `/sceneflow/characters` würde:
- Eigene `page.tsx` brauchen, die wieder durch die Middleware muss
- Den `appMode`-State invalidieren (page navigation = full mount-tree-Wechsel)
- Inkonsistent mit Project Management sein (ProjectListDrawer aus Plan 7 ist auch Modal, nicht Route)

Entscheidung: `CharacterManager.tsx` ist ein Drawer/Modal, geöffnet via Button in der `SceneFlowShell`-Toolbar. Same Pattern wie `ProjectListDrawer`. Beim Schließen bleibt der SceneFlow-Modus aktiv.

### 3. TopBar mode-aware

Aktuelle TopBar hat zwei flex-Cluster:
- **Links:** Transport, BPMBadge, ProjectNameField, SaveProjectButton, ProjectsButton
- **Rechts:** RecIndicator, FlowModeToggle, NewProjectButton, Dev:Clear, ExportButton, LogoutButton

VibeGrid-Modus zeigt alles. SceneFlow-Modus zeigt nur TabSwitcher (links) + LogoutButton (rechts). Plan-8a-Edit: TabSwitcher wird leftmost rendered, beide bestehende Cluster werden in `{appMode === 'vibegrid' && (…)}` gewrappt (außer LogoutButton, der ist mode-unabhängig).

Studio-Specific Props (`engine`, `canvasRef`, `videoEngine`, `videoDecoderPool`, `getImageBitmap`) bleiben in TopBar's Signature — werden im VibeGrid-Modus an `useVideoExporter` durchgereicht, im SceneFlow-Modus ignoriert (kein Refactor jetzt, hält Plan 8a klein).

### 4. Studio-Page mode-aware Workspace

`app/(studio)/page.tsx` rendert aktuell `<Workspace .../>`. Plan-8a-Edit: ergänzt `<SceneFlowShell />` und schaltet via `appMode`. `Workspace` bleibt mounted aber via CSS hidden im SceneFlow-Modus (`display: none`), damit der State nicht verloren geht (Engine, Canvas, useVideoEngine bleiben aktiv im Hintergrund). Dieselbe Logik andersrum: SceneFlow-Shell bleibt mounted aber hidden im VibeGrid-Modus.

Alternative: Conditional unmount. Verworfen, weil das den AudioContext + VideoDecoderPool bei jedem Tab-Wechsel zerstören würde. Pre-Loads gingen verloren. Hidden ist die richtige Wahl.

```tsx
// app/(studio)/page.tsx (Edit-Hint)
<div className={appMode === 'vibegrid' ? '' : 'hidden'}>
  <Workspace ... />
</div>
{/* SceneFlow shell only renders DOM when appMode === 'sceneflow' is reached
    once; afterwards stays in tree with display toggle. */}
{sceneFlowMounted && (
  <div className={appMode === 'sceneflow' ? '' : 'hidden'}>
    <SceneFlowShell />
  </div>
)}
```

`sceneFlowMounted` lazy-mountet — ein User der nie auf SceneFlow klickt zahlt keinen Render-Overhead.

### 5. Character-Reference-Image-Upload via bestehendem R2-Adapter

`createR2StorageAdapter().uploadImage(file)` POSTet an `/api/upload` (bestehend), bekommt einen `MediaRef` zurück. Wir extrahieren nur `.url` und schreiben sie in `VG_characters.reference_image_url`. Keine `addMediaRef`-Call → der upload landet nicht in der Media Library. Im R2-Bucket landet er unter dem existierenden `anonymous/default/image/{uuid}.png`-Pfad (siehe Plan-7 KNOWN_LIMITATIONS — Pfad-Migration ist v0.2).

### 6. fal.ai Client als reiner Stub in 8a

`@fal-ai/client@1.10.1` wird als dep installiert, weil:
- Plan 8c braucht ihn sowieso
- Type-Imports (z.B. für model-IDs) brauchbar schon in Plan 8a
- Install-Schritt einmal sauber jetzt, statt mitten in 8c

Aber die Funktionen `generateImage`, `generateVideo`, `generateLipSync` werfen `Error('not implemented until Plan 8c')`. Tests pinnen das.

`FAL_KEY` aus `process.env` lesen mit Throw-On-Missing genauso wie `DATABASE_URL` in `lib/db/pg.ts`. Vitest setup.ts seedet einen Dummy-Wert.

### 7. Datenmodell — vollständige SQL-Migration

```sql
-- db/migrations/002_VG_sceneflow.sql

-- ---------- VG_characters ----------
CREATE TABLE IF NOT EXISTS public."VG_characters" (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('person', 'group')),
  reference_image_url TEXT,
  voice_provider      TEXT CHECK (voice_provider IN ('azure', 'elevenlabs')),
  voice_id            TEXT,
  image_prompt        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_idx_characters_user_id"
  ON public."VG_characters"(user_id);

ALTER TABLE public."VG_characters" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VG_policy_characters_deny_anon" ON public."VG_characters";
CREATE POLICY "VG_policy_characters_deny_anon" ON public."VG_characters"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

GRANT ALL ON public."VG_characters" TO service_role;
REVOKE ALL ON public."VG_characters" FROM anon, authenticated;

DROP TRIGGER IF EXISTS "VG_trigger_characters_touch_updated_at" ON public."VG_characters";
CREATE TRIGGER "VG_trigger_characters_touch_updated_at"
  BEFORE UPDATE ON public."VG_characters"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();

-- ---------- VG_stories ----------
CREATE TABLE IF NOT EXISTS public."VG_stories" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Untitled Story',
  format        TEXT NOT NULL DEFAULT '16:9'
                CHECK (format IN ('16:9', '9:16', '4:3')),
  visual_style  TEXT,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'generating', 'done', 'error')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_idx_stories_user_id_updated_at"
  ON public."VG_stories"(user_id, updated_at DESC);

ALTER TABLE public."VG_stories" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VG_policy_stories_deny_anon" ON public."VG_stories";
CREATE POLICY "VG_policy_stories_deny_anon" ON public."VG_stories"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

GRANT ALL ON public."VG_stories" TO service_role;
REVOKE ALL ON public."VG_stories" FROM anon, authenticated;

DROP TRIGGER IF EXISTS "VG_trigger_stories_touch_updated_at" ON public."VG_stories";
CREATE TRIGGER "VG_trigger_stories_touch_updated_at"
  BEFORE UPDATE ON public."VG_stories"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();

-- ---------- VG_story_scenes ----------
CREATE TABLE IF NOT EXISTS public."VG_story_scenes" (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id              UUID NOT NULL REFERENCES public."VG_stories"(id) ON DELETE CASCADE,
  scene_order           INTEGER NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('action', 'dialog', 'endcard')),
  image_prompt          TEXT,
  motion_prompt         TEXT,
  camera_control        JSONB,
  duration              INTEGER NOT NULL DEFAULT 5,
  audio_type            TEXT NOT NULL DEFAULT 'none'
                        CHECK (audio_type IN ('none', 'voiceover', 'lipsync')),
  tts_text              TEXT,
  speaking_character_id UUID REFERENCES public."VG_characters"(id) ON DELETE SET NULL,
  transition            TEXT NOT NULL DEFAULT 'last-frame'
                        CHECK (transition IN ('last-frame', 'crossfade', 'cut')),
  start_frame_mode      TEXT NOT NULL DEFAULT 'auto'
                        CHECK (start_frame_mode IN ('auto', 'from-previous', 'custom')),
  start_frame_url       TEXT,
  image_url             TEXT,
  video_url             TEXT,
  audio_url             TEXT,
  end_frame_url         TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'generating', 'done', 'error')),
  error_message         TEXT,
  fal_request_ids       JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_idx_story_scenes_story_id"
  ON public."VG_story_scenes"(story_id, scene_order);

ALTER TABLE public."VG_story_scenes" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VG_policy_story_scenes_deny_anon" ON public."VG_story_scenes";
CREATE POLICY "VG_policy_story_scenes_deny_anon" ON public."VG_story_scenes"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

GRANT ALL ON public."VG_story_scenes" TO service_role;
REVOKE ALL ON public."VG_story_scenes" FROM anon, authenticated;

DROP TRIGGER IF EXISTS "VG_trigger_story_scenes_touch_updated_at" ON public."VG_story_scenes";
CREATE TRIGGER "VG_trigger_story_scenes_touch_updated_at"
  BEFORE UPDATE ON public."VG_story_scenes"
  FOR EACH ROW EXECUTE FUNCTION public."VG_fn_touch_updated_at"();
```

Die `VG_fn_touch_updated_at`-Function existiert bereits aus `001_VG_projects.sql`; `CREATE OR REPLACE FUNCTION` ist idempotent — keine Konflikte beim erneuten Apply.

---

## File map

| Datei | Aktion |
|---|---|
| `package.json` | modify — add `@fal-ai/client` |
| `db/migrations/002_VG_sceneflow.sql` | **CREATE** |
| `lib/fal/client.ts` | **CREATE** — Stub + Typen |
| `lib/sceneflow/types.ts` | **CREATE** — Character/Story/Scene TS-Types matching DB schema |
| `lib/sceneflow/characters-db.ts` | **CREATE** — server-only CRUD |
| `lib/sceneflow/stories-db.ts` | **CREATE** — server-only CRUD (minimal: create/list/delete; update via Story-Patch in 8b) |
| `app/api/sceneflow/characters/route.ts` | **CREATE** — POST/GET |
| `app/api/sceneflow/characters/[id]/route.ts` | **CREATE** — PATCH/DELETE |
| `app/api/sceneflow/stories/route.ts` | **CREATE** — POST/GET |
| `app/api/sceneflow/stories/[id]/route.ts` | **CREATE** — DELETE |
| `lib/sceneflow/api-client.ts` | **CREATE** — fetch wrappers für Client (reuse 401-redirect-Pattern aus Plan 7) |
| `lib/hooks/useSceneFlowCharacters.ts` | **CREATE** — Client-Hook (list + create + patch + delete + R2-Upload-Helper) |
| `lib/hooks/useSceneFlowStories.ts` | **CREATE** — Client-Hook (list + create + delete) |
| `lib/store/app-mode-slice.ts` | **CREATE** — appMode slice |
| `lib/store/types.ts` | modify — AppState extends AppModeState/AppModeActions |
| `lib/store/index.ts` | modify — wire `createAppModeSlice` |
| `components/TopBar/TabSwitcher.tsx` | **CREATE** — VibeGrid/SceneFlow Buttons |
| `components/TopBar/index.tsx` | modify — TabSwitcher leftmost + conditional rendering rest |
| `components/SceneFlow/SceneFlowShell.tsx` | **CREATE** — Shell mit Toolbar + StoryList |
| `components/SceneFlow/CharacterManager.tsx` | **CREATE** — Modal (open/close pattern wie ProjectListDrawer) |
| `components/SceneFlow/CharacterCard.tsx` | **CREATE** |
| `components/SceneFlow/CharacterForm.tsx` | **CREATE** — Upload + Form (Generieren-Button disabled in 8a) |
| `components/SceneFlow/StoryList.tsx` | **CREATE** |
| `components/SceneFlow/NewStoryButton.tsx` | **CREATE** — öffnet kleine Create-Dialog |
| `app/(studio)/page.tsx` | modify — SceneFlowShell mode-switched |
| `.env.example` | modify — `FAL_KEY` |
| `.env.local` | modify (durch User oder automatisch beim ersten Run-Failure) — `FAL_KEY` |
| `vitest.setup.ts` | modify — seed Dummy `FAL_KEY` |
| `docs/KNOWN_LIMITATIONS.md` | modify — Plan 8a Eintrag |
| `tests/unit/sceneflow/characters-db.test.ts` | **CREATE** (≥ 5) |
| `tests/unit/sceneflow/stories-db.test.ts` | **CREATE** (≥ 3) |
| `tests/unit/fal/client.test.ts` | **CREATE** (≥ 2) |
| `tests/integration/api/sceneflow-characters.test.ts` | **CREATE** (≥ 3) |
| `tests/integration/api/sceneflow-stories.test.ts` | **CREATE** (≥ 2) |
| `tests/unit/store/app-mode-slice.test.ts` | **CREATE** (≥ 2) |

Total Tests: **≥ 17 neu** (Architekt-Ziel: ≥ 13).

---

## Tasks

### Task 0 — Baseline check + install `@fal-ai/client`

**Files:** `package.json`

- [ ] **Step 1: Baseline-Check**

```powershell
git status   # nur ignorierbare untracked files
npm test -- --run   # ~731 passing
npm run typecheck && npm run lint && npm run build
```

Expected: alles grün, ~731 Tests passing. **Baseline = 731** (Plan 7 + Video-Hotfix).

- [ ] **Step 2: Install `@fal-ai/client`**

```powershell
npm install @fal-ai/client
```

`legacy-peer-deps=true` ist in `.npmrc` aktiv (seit Plan 7 fix) — npm löst sauber.

- [ ] **Step 3: Verify install**

```powershell
node -e "const fs=require('fs'); console.log('fal-ai/client', JSON.parse(fs.readFileSync('node_modules/@fal-ai/client/package.json','utf8')).version)"
```

Expected: Version `1.10.1` oder neuer.

- [ ] **Step 4: Commit**

```powershell
git add package.json package-lock.json
git commit -m "chore(deps): add @fal-ai/client for Plan 8a/8c SceneFlow"
```

---

### Task 1 — SQL migration 002 + apply

**Files:** Create `db/migrations/002_VG_sceneflow.sql`

- [ ] **Step 1: Write SQL** — vollständigen Inhalt aus "Architecture insights §7 Datenmodell" 1:1 übernehmen.

- [ ] **Step 2: Apply Migration**

```powershell
node -r dotenv/config scripts/apply-migration.mjs db/migrations/002_VG_sceneflow.sql dotenv_config_path=.env.local
```

Expected: `OK — applied db/migrations/002_VG_sceneflow.sql`.

- [ ] **Step 3: Verify Lockdown gegen anon-key**

```powershell
curl -i -H "apikey: $env:NEXT_PUBLIC_SUPABASE_ANON_KEY" "$env:NEXT_PUBLIC_SUPABASE_URL/rest/v1/VG_characters?select=id&limit=1"
```

Expected: `{"code":"42501", … "permission denied for table VG_characters"}`. Wiederholen für `VG_stories` und `VG_story_scenes`.

- [ ] **Step 4: Commit**

```powershell
git add db/migrations/002_VG_sceneflow.sql
git commit -m "feat(db): VG_characters + VG_stories + VG_story_scenes schema + RLS"
```

---

### Task 2 — `lib/sceneflow/types.ts`

**Files:** Create `lib/sceneflow/types.ts`

- [ ] **Step 1: Implement** (kein Test-File-Need — pure Types)

```ts
// lib/sceneflow/types.ts

export type CharacterType = 'person' | 'group';
export type VoiceProvider = 'azure' | 'elevenlabs';

export interface CharacterRecord {
  id: string;
  user_id: string;
  name: string;
  type: CharacterType;
  reference_image_url: string | null;
  voice_provider: VoiceProvider | null;
  voice_id: string | null;
  image_prompt: string | null;
  created_at: string;
  updated_at: string;
}

export type StoryFormat = '16:9' | '9:16' | '4:3';
export type StoryStatus = 'draft' | 'generating' | 'done' | 'error';

export interface StoryRecord {
  id: string;
  user_id: string;
  title: string;
  format: StoryFormat;
  visual_style: string | null;
  status: StoryStatus;
  created_at: string;
  updated_at: string;
}

export type SceneType = 'action' | 'dialog' | 'endcard';
export type AudioType = 'none' | 'voiceover' | 'lipsync';
export type Transition = 'last-frame' | 'crossfade' | 'cut';
export type StartFrameMode = 'auto' | 'from-previous' | 'custom';
export type SceneStatus = 'pending' | 'generating' | 'done' | 'error';

export interface CameraControl {
  zoom: number;
  panX: number;
  panY: number;
  motionIntensity: number;
}

export interface SceneRecord {
  id: string;
  story_id: string;
  scene_order: number;
  type: SceneType;
  image_prompt: string | null;
  motion_prompt: string | null;
  camera_control: CameraControl | null;
  duration: number;
  audio_type: AudioType;
  tts_text: string | null;
  speaking_character_id: string | null;
  transition: Transition;
  start_frame_mode: StartFrameMode;
  start_frame_url: string | null;
  image_url: string | null;
  video_url: string | null;
  audio_url: string | null;
  end_frame_url: string | null;
  status: SceneStatus;
  error_message: string | null;
  fal_request_ids: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Typecheck**

```powershell
npm run typecheck
```

- [ ] **Step 3: Commit**

```powershell
git add lib/sceneflow/types.ts
git commit -m "feat(sceneflow): Character/Story/Scene TS types matching DB schema"
```

---

### Task 3 — `lib/sceneflow/characters-db.ts`

**Files:** Create `lib/sceneflow/characters-db.ts`, `tests/unit/sceneflow/characters-db.test.ts`

- [ ] **Step 1: Write tests first**

```ts
// tests/unit/sceneflow/characters-db.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db/pg', () => ({ pool: { query: queryMock } }));

import {
  createCharacter,
  listCharacters,
  updateCharacter,
  deleteCharacter
} from '@/lib/sceneflow/characters-db';

beforeEach(() => queryMock.mockReset());

describe('characters-db CRUD', () => {
  it('createCharacter inserts the full field set, returns id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'char-1' }] });
    const id = await createCharacter({
      userId: 'u-1',
      name: 'Magdalena',
      type: 'person',
      referenceImageUrl: 'https://r2/m.png',
      voiceProvider: 'elevenlabs',
      voiceId: 'xyz',
      imagePrompt: null
    });
    expect(id).toBe('char-1');
    expect(queryMock.mock.calls[0]![0]).toMatch(/INSERT INTO "VG_characters"/);
    expect(queryMock.mock.calls[0]![1]).toEqual([
      'u-1',
      'Magdalena',
      'person',
      'https://r2/m.png',
      'elevenlabs',
      'xyz',
      null
    ]);
  });

  it('listCharacters scopes to user_id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listCharacters('u-1');
    expect(queryMock.mock.calls[0]![0]).toMatch(/WHERE user_id = \$1/);
    expect(queryMock.mock.calls[0]![1]).toEqual(['u-1']);
  });

  it('updateCharacter — SET-builder branches on each optional field', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await updateCharacter({
      userId: 'u-1',
      characterId: 'char-1',
      patch: { name: 'Magda', voiceId: 'abc' }
    });
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/SET name = \$1, voice_id = \$2 WHERE id = \$3 AND user_id = \$4/);
    expect(vals).toEqual(['Magda', 'abc', 'char-1', 'u-1']);
  });

  it('updateCharacter — empty patch is a no-op, returns false', async () => {
    const ok = await updateCharacter({ userId: 'u-1', characterId: 'char-1', patch: {} });
    expect(ok).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('deleteCharacter filters by user_id (no cross-user delete)', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await deleteCharacter({ userId: 'u-1', characterId: 'char-1' });
    expect(queryMock.mock.calls[0]![1]).toEqual(['char-1', 'u-1']);
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests → FAIL** (module doesn't exist).

- [ ] **Step 3: Implement**

```ts
// lib/sceneflow/characters-db.ts
import 'server-only';
import { pool } from '@/lib/db/pg';
import type { CharacterRecord, CharacterType, VoiceProvider } from './types';

export interface CreateCharacterInput {
  userId: string;
  name: string;
  type: CharacterType;
  referenceImageUrl: string | null;
  voiceProvider: VoiceProvider | null;
  voiceId: string | null;
  imagePrompt: string | null;
}

export async function createCharacter(input: CreateCharacterInput): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO "VG_characters"
     (user_id, name, type, reference_image_url, voice_provider, voice_id, image_prompt)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.userId,
      input.name,
      input.type,
      input.referenceImageUrl,
      input.voiceProvider,
      input.voiceId,
      input.imagePrompt
    ]
  );
  return rows[0]!.id;
}

export async function listCharacters(userId: string): Promise<CharacterRecord[]> {
  const { rows } = await pool.query<CharacterRecord>(
    `SELECT id, user_id, name, type, reference_image_url, voice_provider,
            voice_id, image_prompt, created_at, updated_at
     FROM "VG_characters" WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

export interface UpdateCharacterPatch {
  name?: string;
  type?: CharacterType;
  referenceImageUrl?: string | null;
  voiceProvider?: VoiceProvider | null;
  voiceId?: string | null;
  imagePrompt?: string | null;
}

export async function updateCharacter(args: {
  userId: string;
  characterId: string;
  patch: UpdateCharacterPatch;
}): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  const p = args.patch;
  if (p.name !== undefined) { sets.push(`name = $${n++}`); vals.push(p.name); }
  if (p.type !== undefined) { sets.push(`type = $${n++}`); vals.push(p.type); }
  if (p.referenceImageUrl !== undefined) {
    sets.push(`reference_image_url = $${n++}`); vals.push(p.referenceImageUrl);
  }
  if (p.voiceProvider !== undefined) {
    sets.push(`voice_provider = $${n++}`); vals.push(p.voiceProvider);
  }
  if (p.voiceId !== undefined) { sets.push(`voice_id = $${n++}`); vals.push(p.voiceId); }
  if (p.imagePrompt !== undefined) {
    sets.push(`image_prompt = $${n++}`); vals.push(p.imagePrompt);
  }
  if (sets.length === 0) return false;

  vals.push(args.characterId, args.userId);
  const { rowCount } = await pool.query(
    `UPDATE "VG_characters" SET ${sets.join(', ')} WHERE id = $${n++} AND user_id = $${n}`,
    vals
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteCharacter(args: {
  userId: string;
  characterId: string;
}): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM "VG_characters" WHERE id = $1 AND user_id = $2`,
    [args.characterId, args.userId]
  );
  return (rowCount ?? 0) > 0;
}
```

- [ ] **Step 4: Run tests → PASS**

```powershell
npm test -- --run tests/unit/sceneflow/characters-db.test.ts
```

- [ ] **Step 5: Commit**

`types.ts` ist schon in Task 2 gelandet — nur die zwei neuen Files committen.

```powershell
git add lib/sceneflow/characters-db.ts tests/unit/sceneflow/characters-db.test.ts
git commit -m "feat(sceneflow): server-side CRUD characters — user-scoped pg queries"
```

---

### Task 4 — `lib/sceneflow/stories-db.ts`

**Files:** Create `lib/sceneflow/stories-db.ts`, `tests/unit/sceneflow/stories-db.test.ts`

- [ ] **Step 1: Tests first** (≥ 3)

```ts
// tests/unit/sceneflow/stories-db.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db/pg', () => ({ pool: { query: queryMock } }));

import { createStory, listStories, deleteStory } from '@/lib/sceneflow/stories-db';

beforeEach(() => queryMock.mockReset());

describe('stories-db CRUD', () => {
  it('createStory inserts title/format/visualStyle, returns id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'story-1' }] });
    const id = await createStory({
      userId: 'u-1', title: 'My Story', format: '16:9', visualStyle: 'cinematic'
    });
    expect(id).toBe('story-1');
    expect(queryMock.mock.calls[0]![0]).toMatch(/INSERT INTO "VG_stories"/);
    expect(queryMock.mock.calls[0]![1]).toEqual(['u-1', 'My Story', '16:9', 'cinematic']);
  });

  it('listStories ordered by updated_at DESC, user-scoped', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listStories('u-1');
    expect(queryMock.mock.calls[0]![0]).toMatch(
      /WHERE user_id = \$1 ORDER BY updated_at DESC/
    );
  });

  it('deleteStory user-scoped — returns false on miss', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    const ok = await deleteStory({ userId: 'u-1', storyId: 'story-x' });
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests → FAIL**

- [ ] **Step 3: Implement**

```ts
// lib/sceneflow/stories-db.ts
import 'server-only';
import { pool } from '@/lib/db/pg';
import type { StoryRecord, StoryFormat } from './types';

export interface CreateStoryInput {
  userId: string;
  title: string;
  format: StoryFormat;
  visualStyle: string | null;
}

export async function createStory(input: CreateStoryInput): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO "VG_stories" (user_id, title, format, visual_style)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.userId, input.title, input.format, input.visualStyle]
  );
  return rows[0]!.id;
}

export async function listStories(userId: string): Promise<StoryRecord[]> {
  const { rows } = await pool.query<StoryRecord>(
    `SELECT id, user_id, title, format, visual_style, status, created_at, updated_at
     FROM "VG_stories" WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
}

export async function deleteStory(args: {
  userId: string;
  storyId: string;
}): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM "VG_stories" WHERE id = $1 AND user_id = $2`,
    [args.storyId, args.userId]
  );
  return (rowCount ?? 0) > 0;
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```powershell
git add lib/sceneflow/stories-db.ts tests/unit/sceneflow/stories-db.test.ts
git commit -m "feat(sceneflow): server-side CRUD stories (minimal — scenes in 8b)"
```

---

### Task 5 — `lib/fal/client.ts` Stub

**Files:** Create `lib/fal/client.ts`, `tests/unit/fal/client.test.ts`, modify `.env.example`, modify `vitest.setup.ts`

- [ ] **Step 1: Seed FAL_KEY in vitest.setup.ts**

Append to the env-var seed block at the top:

```ts
if (!process.env.FAL_KEY) {
  process.env.FAL_KEY = 'test-fal-key-not-real';
}
```

- [ ] **Step 2: Tests first**

```ts
// tests/unit/fal/client.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('fal client stub', () => {
  it('generateImage throws "not implemented until Plan 8c"', async () => {
    const { generateImage } = await import('@/lib/fal/client');
    await expect(
      generateImage({ prompt: 'x', model: 'fal-ai/flux/dev' })
    ).rejects.toThrow(/not implemented until Plan 8c/);
  });

  it('throws at import time when FAL_KEY is missing', async () => {
    const orig = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    vi.resetModules();
    await expect(import('@/lib/fal/client')).rejects.toThrow(/FAL_KEY/);
    process.env.FAL_KEY = orig;
  });
});
```

- [ ] **Step 3: Implement**

```ts
// lib/fal/client.ts
import 'server-only';

if (!process.env.FAL_KEY) {
  throw new Error('FAL_KEY is not set — required for SceneFlow fal.ai integration');
}

export type FalImageModel =
  | 'fal-ai/flux/dev'
  | 'fal-ai/seedream-3'
  | 'fal-ai/ideogram-v3';

export type FalVideoModel =
  | 'fal-ai/kling-video/v1.5/pro/image-to-video'
  | 'fal-ai/kling-video/v2.1/pro/image-to-video'
  | 'fal-ai/minimax-video-01-live';

export type FalLipSyncModel =
  | 'fal-ai/sync-lipsync'
  | 'fal-ai/omnihuman-lite';

export interface CameraControl {
  zoom: number;
  panX: number;
  panY: number;
  motionIntensity: number;
}

export interface FalImageGenInput {
  prompt: string;
  model: FalImageModel;
  imageSize?: '16:9' | '9:16' | '4:3';
  referenceImageUrl?: string;
}

export interface FalVideoGenInput {
  imageUrl: string;
  motionPrompt: string;
  model: FalVideoModel;
  duration: number;
  cameraControl?: CameraControl;
}

export interface FalLipSyncInput {
  referenceImageUrl: string;
  audioUrl: string;
  backgroundImageUrl?: string;
  model: FalLipSyncModel;
}

const NOT_IMPL_MSG = (fn: string): string =>
  `fal.ai ${fn}: not implemented until Plan 8c`;

export async function generateImage(_input: FalImageGenInput): Promise<string> {
  throw new Error(NOT_IMPL_MSG('generateImage'));
}

export async function generateVideo(_input: FalVideoGenInput): Promise<string> {
  throw new Error(NOT_IMPL_MSG('generateVideo'));
}

export async function generateLipSync(_input: FalLipSyncInput): Promise<string> {
  throw new Error(NOT_IMPL_MSG('generateLipSync'));
}
```

- [ ] **Step 4: Update `.env.example`**

Append at the end:

```
# --- Plan 8 / SceneFlow: fal.ai ---
# Generate at https://fal.ai/dashboard/keys.
FAL_KEY=
```

- [ ] **Step 5: Tests pass**

- [ ] **Step 6: Commit**

```powershell
git add lib/fal/client.ts tests/unit/fal/client.test.ts .env.example vitest.setup.ts
git commit -m "feat(fal): client stub — types + NotImplemented throws (real calls in 8c)"
```

---

### Task 6 — API routes characters

**Files:** Create `app/api/sceneflow/characters/route.ts`, `app/api/sceneflow/characters/[id]/route.ts`, `tests/integration/api/sceneflow-characters.test.ts`

- [ ] **Step 1: Tests first** (≥ 3)

```ts
// tests/integration/api/sceneflow-characters.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock, getSession } = vi.hoisted(() => ({
  dbMock: {
    createCharacter: vi.fn(),
    listCharacters: vi.fn(),
    updateCharacter: vi.fn(),
    deleteCharacter: vi.fn()
  },
  getSession: vi.fn()
}));
vi.mock('@/lib/sceneflow/characters-db', () => dbMock);
vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession } }
}));

import { POST as postChars, GET as getChars } from '@/app/api/sceneflow/characters/route';
import {
  PATCH as patchChar,
  DELETE as delChar
} from '@/app/api/sceneflow/characters/[id]/route';

beforeEach(() => {
  Object.values(dbMock).forEach((m) => m.mockReset());
  getSession.mockReset();
});

describe('POST /api/sceneflow/characters', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await postChars(
      new Request('http://x/api/sceneflow/characters', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(401);
  });

  it('400 on missing name/type', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    const res = await postChars(
      new Request('http://x/api/sceneflow/characters', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(400);
  });

  it('201 + creates character with session user id', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.createCharacter.mockResolvedValue('char-1');
    const res = await postChars(
      new Request('http://x/api/sceneflow/characters', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Magdalena',
          type: 'person',
          referenceImageUrl: 'https://r2/m.png',
          voiceProvider: 'elevenlabs',
          voiceId: 'xyz',
          imagePrompt: null
        }),
        headers: { 'content-type': 'application/json' }
      })
    );
    expect(res.status).toBe(201);
    expect(dbMock.createCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', name: 'Magdalena', type: 'person' })
    );
    const json = await res.json();
    expect(json.id).toBe('char-1');
  });
});

describe('GET /api/sceneflow/characters', () => {
  it('lists characters of the current user only', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.listCharacters.mockResolvedValue([]);
    const res = await getChars(new Request('http://x/api/sceneflow/characters'));
    expect(res.status).toBe(200);
    expect(dbMock.listCharacters).toHaveBeenCalledWith('u-1');
  });
});

describe('PATCH/DELETE /api/sceneflow/characters/[id]', () => {
  it('PATCH delegates patch shape to updateCharacter', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.updateCharacter.mockResolvedValue(true);
    const res = await patchChar(
      new Request('http://x/api/sceneflow/characters/char-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'M' }),
        headers: { 'content-type': 'application/json' }
      }),
      { params: { id: 'char-1' } }
    );
    expect(res.status).toBe(200);
    expect(dbMock.updateCharacter).toHaveBeenCalledWith({
      userId: 'u-1',
      characterId: 'char-1',
      patch: expect.objectContaining({ name: 'M' })
    });
  });

  it('DELETE 404 when row missing', async () => {
    getSession.mockResolvedValue({ user: { id: 'u-1' } });
    dbMock.deleteCharacter.mockResolvedValue(false);
    const res = await delChar(new Request('http://x'), { params: { id: 'char-x' } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests → FAIL** (route-files missing)

- [ ] **Step 3: Implement collection route**

```ts
// app/api/sceneflow/characters/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { createCharacter, listCharacters } from '@/lib/sceneflow/characters-db';
import type { CharacterType, VoiceProvider } from '@/lib/sceneflow/types';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const list = await listCharacters(session.user.id);
  return NextResponse.json({ characters: list });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b?.name !== 'string' || b.name.trim() === '') {
    return NextResponse.json({ error: 'invalid name' }, { status: 400 });
  }
  if (b.type !== 'person' && b.type !== 'group') {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  const id = await createCharacter({
    userId: session.user.id,
    name: b.name,
    type: b.type as CharacterType,
    referenceImageUrl: (b.referenceImageUrl as string | null | undefined) ?? null,
    voiceProvider: (b.voiceProvider as VoiceProvider | null | undefined) ?? null,
    voiceId: (b.voiceId as string | null | undefined) ?? null,
    imagePrompt: (b.imagePrompt as string | null | undefined) ?? null
  });
  return NextResponse.json({ id }, { status: 201 });
}
```

- [ ] **Step 4: Implement [id] route**

```ts
// app/api/sceneflow/characters/[id]/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { updateCharacter, deleteCharacter } from '@/lib/sceneflow/characters-db';
import type { UpdateCharacterPatch } from '@/lib/sceneflow/characters-db';

export const runtime = 'nodejs';

async function getUserId(req: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user.id ?? null;
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const ok = await updateCharacter({
    userId,
    characterId: params.id,
    patch: body as UpdateCharacterPatch
  });
  if (!ok) return NextResponse.json({ error: 'not found or unchanged' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ok = await deleteCharacter({ userId, characterId: params.id });
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Tests pass + build clean**

- [ ] **Step 6: Commit**

```powershell
git add app/api/sceneflow/characters tests/integration/api/sceneflow-characters.test.ts
git commit -m "feat(sceneflow): API routes characters — POST/GET + [id] PATCH/DELETE"
```

---

### Task 7 — API routes stories

**Files:** Create `app/api/sceneflow/stories/route.ts`, `app/api/sceneflow/stories/[id]/route.ts`, `tests/integration/api/sceneflow-stories.test.ts`

Same shape as Task 6 — POST/GET on the collection route, DELETE on the `[id]` route. Use `createStory`, `listStories`, `deleteStory` from `lib/sceneflow/stories-db`.

- [ ] **Step 1: Test (≥ 2)** — POST 401 without session; POST 201 with valid body; GET lists user-scoped.

- [ ] **Step 2: Implement collection route** — analog zu characters/route.ts; Validierungen:
  - `title: string` (default `'Untitled Story'`)
  - `format: '16:9' | '9:16' | '4:3'` (default `'16:9'`)
  - `visualStyle: string | null` (optional)

- [ ] **Step 3: Implement [id] route** — nur `DELETE` in Plan 8a (PATCH kommt in 8b für Story-Updates).

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```powershell
git add app/api/sceneflow/stories tests/integration/api/sceneflow-stories.test.ts
git commit -m "feat(sceneflow): API routes stories — POST/GET + [id] DELETE"
```

---

### Task 8 — `appMode` Slice in `useAppStore`

**Files:** Create `lib/store/app-mode-slice.ts`, modify `lib/store/types.ts` + `lib/store/index.ts`, create `tests/unit/store/app-mode-slice.test.ts`

- [ ] **Step 1: Tests first** (≥ 2)

```ts
// tests/unit/store/app-mode-slice.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';

beforeEach(() => {
  useAppStore.setState({ appMode: 'vibegrid' });
});

describe('appMode slice', () => {
  it('default mode is "vibegrid"', () => {
    expect(useAppStore.getState().appMode).toBe('vibegrid');
  });

  it('setAppMode flips the value reactively', () => {
    useAppStore.getState().setAppMode('sceneflow');
    expect(useAppStore.getState().appMode).toBe('sceneflow');
    useAppStore.getState().setAppMode('vibegrid');
    expect(useAppStore.getState().appMode).toBe('vibegrid');
  });
});
```

- [ ] **Step 2: Implement slice**

```ts
// lib/store/app-mode-slice.ts
import type { StateCreator } from 'zustand';
import type { AppState } from './types';

export type AppMode = 'vibegrid' | 'sceneflow';

export interface AppModeState {
  appMode: AppMode;
}

export interface AppModeActions {
  setAppMode(mode: AppMode): void;
}

export const initialAppModeState: AppModeState = { appMode: 'vibegrid' };

/**
 * Plan 8a — transient app-mode slice. Mirrors `mobileUI` semantics:
 * lives in `useAppStore` (so consumers can subscribe directly without
 * a separate zustand store), excluded from `partialize` (so a reload
 * always lands the user back in the VibeGrid tab).
 */
export const createAppModeSlice: StateCreator<
  AppState,
  [],
  [],
  AppModeState & AppModeActions
> = (set) => ({
  appMode: initialAppModeState.appMode,
  setAppMode: (appMode) => set({ appMode })
});
```

- [ ] **Step 3: Wire into types + store**

`lib/store/types.ts` — extend `AppState`:

```ts
import type { AppMode } from './app-mode-slice';
// ...
export interface AppState {
  // ... existing fields
  appMode: AppMode;
  setAppMode(mode: AppMode): void;
}
```

`lib/store/index.ts` — import + spread:

```ts
import { createAppModeSlice } from './app-mode-slice';
// ... inside the create(persist((set, get, store) => ({...})))
...createAppModeSlice(set, get, store)
```

Place the spread next to `...createMobileUISlice(set, get, store)`.

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```powershell
git add lib/store/app-mode-slice.ts lib/store/types.ts lib/store/index.ts tests/unit/store/app-mode-slice.test.ts
git commit -m "feat(store): appMode slice (vibegrid | sceneflow) — transient, no persist"
```

---

### Task 9 — `TabSwitcher` + TopBar conditional rendering

**Files:** Create `components/TopBar/TabSwitcher.tsx`, modify `components/TopBar/index.tsx`

- [ ] **Step 1: Implement TabSwitcher**

```tsx
// components/TopBar/TabSwitcher.tsx
'use client';
import { useAppStore } from '@/lib/store';
import type { AppMode } from '@/lib/store/app-mode-slice';

const TABS: ReadonlyArray<{ mode: AppMode; label: string }> = [
  { mode: 'vibegrid', label: 'VibeGrid' },
  { mode: 'sceneflow', label: 'SceneFlow' }
];

export function TabSwitcher() {
  const appMode = useAppStore((s) => s.appMode);
  const setAppMode = useAppStore((s) => s.setAppMode);
  return (
    <div className="flex items-center gap-1 mr-2">
      {TABS.map((t) => {
        const active = appMode === t.mode;
        return (
          <button
            key={t.mode}
            type="button"
            onClick={() => setAppMode(t.mode)}
            aria-pressed={active}
            className={
              'h-7 px-3 text-xs uppercase tracking-wider rounded transition-colors ' +
              (active
                ? 'bg-[var(--a1)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]')
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Modify TopBar** — TabSwitcher leftmost; existing left + right clusters wrapped:

```tsx
// components/TopBar/index.tsx — Edit-Hint
// at the top:
import { TabSwitcher } from './TabSwitcher';
import { useAppStore } from '@/lib/store';

// inside the component, before return:
const appMode = useAppStore((s) => s.appMode);

// in JSX, restructure the header:
return (
  <header className="h-12 px-2 md:px-3 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-1)]">
    <div className="flex items-center gap-2 md:gap-3">
      <TabSwitcher />
      {appMode === 'vibegrid' && (
        <>
          <Transport engine={engine} />
          <BPMBadge />
          <ProjectNameField />
          <SaveProjectButton />
          <ProjectsButton />
        </>
      )}
    </div>
    <div className="flex items-center gap-1 md:gap-2">
      {appMode === 'vibegrid' && (
        <>
          <RecIndicator onCancel={() => exporter.cancel()} />
          <FlowModeToggle />
          <NewProjectButton />
          {process.env.NODE_ENV === 'development' && (
            <button /* … Dev: Clear unchanged … */>Dev: Clear</button>
          )}
          <ExportButton onStart={() => exporter.start()} />
        </>
      )}
      <LogoutButton />
    </div>
  </header>
);
```

`LogoutButton` ist bewusst NICHT in der conditional — Logout funktioniert in beiden Modi.

- [ ] **Step 3: Typecheck + build clean**

- [ ] **Step 4: Manual smoke** (CC #2): TabSwitcher sichtbar, Klick wechselt Hervorhebung, VibeGrid-Controls verschwinden im SceneFlow-Modus.

- [ ] **Step 5: Commit**

```powershell
git add components/TopBar/TabSwitcher.tsx components/TopBar/index.tsx
git commit -m "feat(topbar): TabSwitcher (VibeGrid/SceneFlow) + mode-aware cluster rendering"
```

---

### Task 10 — Client API + Hooks

**Files:** Create `lib/sceneflow/api-client.ts`, `lib/hooks/useSceneFlowCharacters.ts`, `lib/hooks/useSceneFlowStories.ts`

- [ ] **Step 1: API client** (reuse 401-redirect-Pattern aus Plan 7)

```ts
// lib/sceneflow/api-client.ts
import type { CharacterRecord, StoryRecord, StoryFormat } from './types';
import type { UpdateCharacterPatch } from './characters-db';

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.assign('/login?expired=1');
    throw new Error('Session expired');
  }
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return res.json() as Promise<T>;
}

// Characters
export async function apiListCharacters(): Promise<{ characters: CharacterRecord[] }> {
  return json(await fetch('/api/sceneflow/characters'));
}
export async function apiCreateCharacter(input: {
  name: string;
  type: 'person' | 'group';
  referenceImageUrl: string | null;
  voiceProvider: 'azure' | 'elevenlabs' | null;
  voiceId: string | null;
  imagePrompt: string | null;
}): Promise<{ id: string }> {
  return json(
    await fetch('/api/sceneflow/characters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    })
  );
}
export async function apiPatchCharacter(
  id: string,
  patch: UpdateCharacterPatch
): Promise<{ ok: true }> {
  return json(
    await fetch('/api/sceneflow/characters/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch)
    })
  );
}
export async function apiDeleteCharacter(id: string): Promise<{ ok: true }> {
  return json(
    await fetch('/api/sceneflow/characters/' + encodeURIComponent(id), {
      method: 'DELETE'
    })
  );
}

// Stories
export async function apiListStories(): Promise<{ stories: StoryRecord[] }> {
  return json(await fetch('/api/sceneflow/stories'));
}
export async function apiCreateStory(input: {
  title: string;
  format: StoryFormat;
  visualStyle: string | null;
}): Promise<{ id: string }> {
  return json(
    await fetch('/api/sceneflow/stories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    })
  );
}
export async function apiDeleteStory(id: string): Promise<{ ok: true }> {
  return json(
    await fetch('/api/sceneflow/stories/' + encodeURIComponent(id), {
      method: 'DELETE'
    })
  );
}
```

- [ ] **Step 2: Hooks** — schlanke client-side state + refetch helpers

```ts
// lib/hooks/useSceneFlowCharacters.ts
'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiListCharacters } from '@/lib/sceneflow/api-client';
import type { CharacterRecord } from '@/lib/sceneflow/types';

export function useSceneFlowCharacters() {
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { characters } = await apiListCharacters();
      setCharacters(characters);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => { /* errors surfaced by api-client toasts */ });
  }, [refresh]);

  return { characters, loading, refresh };
}
```

```ts
// lib/hooks/useSceneFlowStories.ts
'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiListStories } from '@/lib/sceneflow/api-client';
import type { StoryRecord } from '@/lib/sceneflow/types';

export function useSceneFlowStories() {
  const [stories, setStories] = useState<StoryRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { stories } = await apiListStories();
      setStories(stories);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  return { stories, loading, refresh };
}
```

- [ ] **Step 3: Typecheck**

- [ ] **Step 4: Commit**

```powershell
git add lib/sceneflow/api-client.ts lib/hooks/useSceneFlowCharacters.ts lib/hooks/useSceneFlowStories.ts
git commit -m "feat(sceneflow): client api + useSceneFlowCharacters/Stories hooks"
```

---

### Task 11 — `CharacterManager` UI (Modal)

**Files:** Create `components/SceneFlow/CharacterCard.tsx`, `components/SceneFlow/CharacterForm.tsx`, `components/SceneFlow/CharacterManager.tsx`

- [ ] **Step 1: CharacterCard**

```tsx
// components/SceneFlow/CharacterCard.tsx
'use client';
import type { CharacterRecord } from '@/lib/sceneflow/types';

export function CharacterCard({
  character,
  onEdit,
  onDelete
}: {
  character: CharacterRecord;
  onEdit(): void;
  onDelete(): void;
}) {
  return (
    <div className="flex items-center gap-3 bg-[var(--surface-2)] rounded-lg p-2">
      {character.reference_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={character.reference_image_url}
          alt={character.name}
          className="w-12 h-12 object-cover rounded-full bg-[var(--surface-3)]"
        />
      ) : (
        <div className="w-12 h-12 rounded-full bg-[var(--surface-3)] flex items-center justify-center text-xl text-[var(--text-muted)]">
          {character.type === 'group' ? '👥' : '👤'}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text)] truncate">{character.name}</span>
          <span className="text-[10px] uppercase text-[var(--text-muted)]">
            {character.type}
          </span>
        </div>
        <div className="text-[10px] text-[var(--text-muted)] truncate">
          {character.voice_provider
            ? `${character.voice_provider} · ${character.voice_id ?? ''}`
            : 'Keine Stimme'}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="text-xs text-[var(--a2)] hover:text-[var(--a1)] px-2"
      >
        Bearbeiten
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Löschen"
        className="text-xs text-[var(--text-muted)] hover:text-red-400 px-2"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 2: CharacterForm**

```tsx
// components/SceneFlow/CharacterForm.tsx
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { createR2StorageAdapter } from '@/lib/storage/r2-adapter';
import {
  apiCreateCharacter,
  apiPatchCharacter
} from '@/lib/sceneflow/api-client';
import type {
  CharacterRecord,
  CharacterType,
  VoiceProvider
} from '@/lib/sceneflow/types';

export function CharacterForm({
  existing,
  onSaved,
  onCancel
}: {
  existing: CharacterRecord | null;
  onSaved(): void;
  onCancel(): void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<CharacterType>(existing?.type ?? 'person');
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(
    existing?.reference_image_url ?? null
  );
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider | null>(
    existing?.voice_provider ?? null
  );
  const [voiceId, setVoiceId] = useState(existing?.voice_id ?? '');
  const [imagePrompt, setImagePrompt] = useState(existing?.image_prompt ?? '');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function onUpload(file: File) {
    setUploading(true);
    try {
      const adapter = createR2StorageAdapter();
      const ref = await adapter.uploadImage(file);
      setReferenceImageUrl(ref.url);
      toast.success('Bild hochgeladen');
    } catch (e) {
      toast.error('Upload fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name fehlt');
      return;
    }
    setBusy(true);
    try {
      if (existing) {
        await apiPatchCharacter(existing.id, {
          name,
          type,
          referenceImageUrl,
          voiceProvider,
          voiceId: voiceId.trim() || null,
          imagePrompt: imagePrompt.trim() || null
        });
        toast.success('Charakter aktualisiert');
      } else {
        await apiCreateCharacter({
          name,
          type,
          referenceImageUrl,
          voiceProvider,
          voiceId: voiceId.trim() || null,
          imagePrompt: imagePrompt.trim() || null
        });
        toast.success('Charakter angelegt');
      }
      onSaved();
    } catch (e) {
      toast.error('Speichern fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">Name</span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
        />
      </label>

      <div className="flex gap-3">
        <label className="text-xs text-[var(--text)]">
          <input
            type="radio"
            name="type"
            value="person"
            checked={type === 'person'}
            onChange={() => setType('person')}
          />{' '}
          Person
        </label>
        <label className="text-xs text-[var(--text)]">
          <input
            type="radio"
            name="type"
            value="group"
            checked={type === 'group'}
            onChange={() => setType('group')}
          />{' '}
          Gruppe
        </label>
      </div>

      <div>
        <span className="text-xs text-[var(--text-dim)]">Referenzbild</span>
        <div className="mt-1 flex items-center gap-2">
          {referenceImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={referenceImageUrl}
              alt="Referenz"
              className="w-12 h-12 object-cover rounded bg-[var(--surface-3)]"
            />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
            disabled={uploading}
            className="text-xs text-[var(--text-dim)]"
          />
        </div>
      </div>

      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">
          Bild-Prompt (für künftige KI-Generierung)
        </span>
        <textarea
          value={imagePrompt}
          onChange={(e) => setImagePrompt(e.target.value)}
          rows={2}
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
        />
        <button
          type="button"
          disabled
          title="Aktiv ab Plan 8c"
          className="mt-1 text-xs text-[var(--text-muted)] opacity-50 cursor-not-allowed"
        >
          ✨ Generieren (kommt in Plan 8c)
        </button>
      </label>

      <div className="flex gap-3 items-end">
        <label className="flex-1">
          <span className="text-xs text-[var(--text-dim)]">Stimme</span>
          <select
            value={voiceProvider ?? ''}
            onChange={(e) =>
              setVoiceProvider((e.target.value as VoiceProvider) || null)
            }
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
          >
            <option value="">—</option>
            <option value="azure">Azure Neural</option>
            <option value="elevenlabs">ElevenLabs</option>
          </select>
        </label>
        {voiceProvider && (
          <label className="flex-1">
            <span className="text-xs text-[var(--text-dim)]">
              {voiceProvider === 'azure' ? 'Azure Voice Name' : 'ElevenLabs Voice ID'}
            </span>
            <input
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              placeholder={
                voiceProvider === 'azure' ? 'de-DE-KillianNeural' : 'voice_id_xyz'
              }
              className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
            />
          </label>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] px-3 py-1"
        >
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={busy || uploading}
          className="bg-[var(--a1)] text-white text-xs px-3 py-1 rounded disabled:opacity-50"
        >
          {busy ? '...' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: CharacterManager** (Modal)

```tsx
// components/SceneFlow/CharacterManager.tsx
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSceneFlowCharacters } from '@/lib/hooks/useSceneFlowCharacters';
import { apiDeleteCharacter } from '@/lib/sceneflow/api-client';
import { CharacterCard } from './CharacterCard';
import { CharacterForm } from './CharacterForm';
import type { CharacterRecord } from '@/lib/sceneflow/types';

export function CharacterManager({
  open,
  onClose
}: {
  open: boolean;
  onClose(): void;
}) {
  const { characters, loading, refresh } = useSceneFlowCharacters();
  const [editing, setEditing] = useState<CharacterRecord | null>(null);
  const [creating, setCreating] = useState(false);

  async function del(c: CharacterRecord) {
    if (!confirm(`Charakter "${c.name}" wirklich löschen?`)) return;
    try {
      await apiDeleteCharacter(c.id);
    } catch (e) {
      toast.error('Löschen fehlgeschlagen: ' + (e as Error).message);
      return;
    }
    refresh().catch(() => {});
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50" onPointerDown={onClose}>
      <div
        className="absolute right-0 top-0 bottom-0 w-96 bg-[var(--surface-1)] border-l border-[var(--border)] p-4 overflow-y-auto"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[var(--text)]">Charaktere</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        {creating || editing ? (
          <CharacterForm
            existing={editing}
            onSaved={() => {
              setCreating(false);
              setEditing(null);
              refresh().catch(() => {});
            }}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="bg-[var(--a1)] text-white text-xs px-3 py-1 rounded mb-3"
            >
              + Neuer Charakter
            </button>
            {loading && (
              <div className="text-xs text-[var(--text-dim)]">Lädt...</div>
            )}
            {!loading && characters.length === 0 && (
              <div className="text-xs text-[var(--text-dim)]">
                Noch keine Charaktere.
              </div>
            )}
            <ul className="space-y-2">
              {characters.map((c) => (
                <li key={c.id}>
                  <CharacterCard
                    character={c}
                    onEdit={() => setEditing(c)}
                    onDelete={() => del(c)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + build clean**

- [ ] **Step 5: Manual smoke** (CC #2): Modal öffnet via SceneFlowShell-Button (kommt in T12), Charakter anlegen mit Upload, Edit, Delete.

- [ ] **Step 6: Commit**

```powershell
git add components/SceneFlow/CharacterCard.tsx components/SceneFlow/CharacterForm.tsx components/SceneFlow/CharacterManager.tsx
git commit -m "feat(sceneflow): CharacterManager — list + form + R2 upload + edit/delete"
```

---

### Task 12 — `StoryList` + `NewStoryButton` + `SceneFlowShell`

**Files:** Create `components/SceneFlow/NewStoryButton.tsx`, `components/SceneFlow/StoryList.tsx`, `components/SceneFlow/SceneFlowShell.tsx`

- [ ] **Step 1: NewStoryButton** (kleiner Inline-Create-Dialog)

```tsx
// components/SceneFlow/NewStoryButton.tsx
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiCreateStory } from '@/lib/sceneflow/api-client';
import type { StoryFormat } from '@/lib/sceneflow/types';

export function NewStoryButton({ onCreated }: { onCreated(): void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<StoryFormat>('16:9');
  const [visualStyle, setVisualStyle] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiCreateStory({
        title: title.trim() || 'Untitled Story',
        format,
        visualStyle: visualStyle.trim() || null
      });
      toast.success('Story angelegt');
      setOpen(false);
      setTitle('');
      setVisualStyle('');
      onCreated();
    } catch (e) {
      toast.error('Anlegen fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-[var(--a1)] text-white text-xs px-3 py-1 rounded"
      >
        + Neue Story
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4" onPointerDown={() => setOpen(false)}>
          <form
            onSubmit={submit}
            onPointerDown={(e) => e.stopPropagation()}
            className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-4 w-96 space-y-3"
          >
            <h3 className="text-sm font-bold text-[var(--text)]">Neue Story</h3>
            <label className="block">
              <span className="text-xs text-[var(--text-dim)]">Titel</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled Story"
                className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--text-dim)]">Format</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as StoryFormat)}
                className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
              >
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Portrait)</option>
                <option value="4:3">4:3</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-[var(--text-dim)]">Visueller Stil (optional)</span>
              <input
                value={visualStyle}
                onChange={(e) => setVisualStyle(e.target.value)}
                placeholder="cinematisch, warmes Licht ..."
                className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] px-3 py-1"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={busy}
                className="bg-[var(--a1)] text-white text-xs px-3 py-1 rounded disabled:opacity-50"
              >
                {busy ? '...' : 'Anlegen'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: StoryList**

```tsx
// components/SceneFlow/StoryList.tsx
'use client';
import { toast } from 'sonner';
import { useSceneFlowStories } from '@/lib/hooks/useSceneFlowStories';
import { apiDeleteStory } from '@/lib/sceneflow/api-client';
import type { StoryRecord, StoryStatus } from '@/lib/sceneflow/types';

const STATUS_DOT: Record<StoryStatus, string> = {
  draft: 'bg-[var(--text-muted)]',
  generating: 'bg-orange-400',
  done: 'bg-green-400',
  error: 'bg-red-400'
};

export function StoryList() {
  const { stories, loading, refresh } = useSceneFlowStories();

  async function del(s: StoryRecord) {
    if (!confirm(`Story "${s.title}" wirklich löschen?`)) return;
    try {
      await apiDeleteStory(s.id);
    } catch (e) {
      toast.error('Löschen fehlgeschlagen: ' + (e as Error).message);
      return;
    }
    refresh().catch(() => {});
  }

  if (loading) return <div className="text-xs text-[var(--text-dim)]">Lädt...</div>;
  if (stories.length === 0) {
    return (
      <div className="text-sm text-[var(--text-dim)] mt-12 text-center">
        Noch keine Stories. Klicke <strong>+ Neue Story</strong> um zu beginnen.
      </div>
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mt-4">
      {stories.map((s) => (
        <li
          key={s.id}
          className="bg-[var(--surface-2)] rounded-lg p-3 flex flex-col gap-2"
        >
          <div className="flex items-center gap-2">
            <span className={'w-2 h-2 rounded-full ' + STATUS_DOT[s.status]} />
            <span className="text-sm text-[var(--text)] truncate flex-1">{s.title}</span>
            <span className="text-[10px] uppercase text-[var(--text-muted)]">
              {s.format}
            </span>
          </div>
          <div className="text-[10px] text-[var(--text-muted)] truncate">
            {s.visual_style ?? 'Kein Stil gesetzt'}
          </div>
          <div className="flex justify-between items-center pt-1">
            <span className="text-[10px] text-[var(--text-muted)]">
              {new Date(s.updated_at).toLocaleDateString()}
            </span>
            <button
              type="button"
              onClick={() => del(s)}
              title="Löschen"
              className="text-xs text-[var(--text-muted)] hover:text-red-400"
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: SceneFlowShell**

```tsx
// components/SceneFlow/SceneFlowShell.tsx
'use client';
import { useState } from 'react';
import { CharacterManager } from './CharacterManager';
import { NewStoryButton } from './NewStoryButton';
import { StoryList } from './StoryList';

/**
 * Plan 8a — SceneFlow shell. Renders inside the studio page when
 * appMode === 'sceneflow'. Holds the characters/stories toolbar and
 * the story list. Storyboard view (per-story scene editor) lives
 * in plan 8b.
 */
export function SceneFlowShell() {
  const [charactersOpen, setCharactersOpen] = useState(false);
  // StoryList holds its own data via useSceneFlowStories. NewStoryButton
  // triggers a refresh in StoryList via the shared hook — hoist refetch
  // here so the button can drive it.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
      <div className="max-w-5xl mx-auto p-6">
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
        {/* key forces StoryList to remount after a create so its
            useEffect-driven refresh refires. Simpler than threading
            a refresh ref. */}
        <StoryList key={refreshKey} />
      </div>
      <CharacterManager
        open={charactersOpen}
        onClose={() => setCharactersOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + build clean**

- [ ] **Step 5: Commit**

```powershell
git add components/SceneFlow/NewStoryButton.tsx components/SceneFlow/StoryList.tsx components/SceneFlow/SceneFlowShell.tsx
git commit -m "feat(sceneflow): SceneFlowShell — StoryList + NewStoryButton + Characters entry"
```

---

### Task 13 — Wire SceneFlowShell into Studio-Page

**Files:** modify `app/(studio)/page.tsx`

- [ ] **Step 1: Edit page.tsx** — wrap `<Workspace />` in mode-aware container, mount lazy `<SceneFlowShell />`:

```tsx
// app/(studio)/page.tsx — Edit-Hint
// Add to imports:
import { useAppStore } from '@/lib/store';
import { SceneFlowShell } from '@/components/SceneFlow/SceneFlowShell';

// Inside StudioPage component body:
const appMode = useAppStore((s) => s.appMode);
const [sceneFlowMounted, setSceneFlowMounted] = useState(false);
useEffect(() => {
  if (appMode === 'sceneflow' && !sceneFlowMounted) setSceneFlowMounted(true);
}, [appMode, sceneFlowMounted]);

// In the JSX, wrap <Workspace ... /> + <SceneFlowShell />:
return (
  <DndContext sensors={sensors} autoScroll={false}>
    <div className="flex flex-col h-screen bg-[var(--bg)] text-[var(--text)]">
      <TopBar ... /> {/* unchanged */}
      <div className={appMode === 'vibegrid' ? 'flex flex-1 min-h-0' : 'hidden'}>
        <Workspace ... /> {/* unchanged props */}
      </div>
      {sceneFlowMounted && (
        <div className={appMode === 'sceneflow' ? 'flex flex-1 min-h-0' : 'hidden'}>
          <SceneFlowShell />
        </div>
      )}
      <TabBar />
      <MediaDrawer />
      <FXDrawer />
      <InspectorSheet />
    </div>
  </DndContext>
);
```

(The exact wrap-div around `<Workspace />` is needed because the existing layout relies on `flex flex-1 min-h-0` on the inner Workspace container — CC#1 verifies the actual layout and replicates it on the SceneFlow side.)

Also adjust `useState` import — already present in the file (line 2 region).

- [ ] **Step 2: Typecheck + build**

- [ ] **Step 3: Manual smoke** (CC #2):
  - VibeGrid-Tab → Studio, Engines aktiv
  - SceneFlow-Tab → leere Story-Liste, Audio-Engine bleibt im Hintergrund
  - Charaktere öffnen + anlegen → erscheint in Liste
  - Story anlegen → erscheint in StoryList
  - Tab wechseln → VibeGrid-State unverändert (Clips, Playhead-Position, geladenes Projekt)

- [ ] **Step 4: Commit**

```powershell
git add app/\(studio\)/page.tsx
git commit -m "feat(studio): mode-aware page — Workspace vs SceneFlowShell"
```

---

### Task 14 — KNOWN_LIMITATIONS

**Files:** modify `docs/KNOWN_LIMITATIONS.md`

- [ ] **Step 1: Append** before "Manual verification checklist":

```markdown
## Plan 8a — SceneFlow Fundament

### Reine Fundament-Schicht — kein KI-Funktionsumfang

Plan 8a liefert nur die Infrastruktur: zweiter Tab "SceneFlow", drei neue
DB-Tabellen (`VG_characters`, `VG_stories`, `VG_story_scenes`), CRUD-API,
Character Manager UI, leere Storyboard-Shell. Echte fal.ai-Calls, Sonnet-
Aufteilung, TTS und der "In-VibeGrid-öffnen"-Transfer kommen in 8b/8c/8d.

Konsequenzen für Tester:
- `+ Neue Story` legt einen Story-Record an, der bis 8b leer bleibt (keine
  Szenen-Befüllung möglich, kein Storyboard-View).
- `Bild-Prompt → Generieren`-Button in der Character-Form ist disabled
  und mit Tooltip "Aktiv ab Plan 8c" versehen.
- `lib/fal/client.ts` ist ein Stub — jeder Call wirft `Error('… not
  implemented until Plan 8c')`. Tests pinnen das.

### Mode-Switch erhält State, kostet aber Render-Cost

Beim Tab-Wechsel werden Workspace und SceneFlowShell NICHT unmounted —
sie bekommen `display: none`. Begründung: ein Unmount würde den AudioEngine
und den VideoDecoderPool zerstören, alle Pre-Loads wären weg. State-
Persistenz übersteigt die paar Frames Render-Cost.

SceneFlow-Shell ist `lazy-mounted`: der erste Klick auf "SceneFlow" mountet
sie, danach bleibt sie im Tree. Ein User, der ausschließlich VibeGrid nutzt,
zahlt keinen Initial-Render für SceneFlow.

### Character-Reference-Image-Upload re-uses `/api/upload`

Character-Bilder laufen durch denselben R2-Upload-Pfad wie VibeGrid-
Medien (`createR2StorageAdapter().uploadImage()`). Sie landen unter
`anonymous/default/image/{uuid}.png` — der R2-Key-Migration-Punkt aus
Plan 7 KNOWN_LIMITATIONS gilt unverändert. Wir extrahieren nur die `.url`
und schreiben sie in `VG_characters.reference_image_url`; der MediaRef
wird NICHT in die VibeGrid-Mediathek eingehängt.

### fal.ai-Setup vor Plan 8c

`FAL_KEY` muss in `.env.local` gesetzt sein bevor 8c implementiert wird.
In Plan 8a reicht ein beliebiger nicht-leerer Wert (das Modul wirft beim
Import wenn die Variable fehlt). Echte Keys aus
[fal.ai dashboard/keys](https://fal.ai/dashboard/keys) — kein Public-Key,
nur server-side genutzt.
```

- [ ] **Step 2: Commit**

```powershell
git add docs/KNOWN_LIMITATIONS.md
git commit -m "docs(limitations): Plan 8a — SceneFlow scope, mode-switch, character upload"
```

---

### Task 15 — Final verify + push

- [ ] **Step 1: Full gate green**

```powershell
npm run typecheck
npm run lint
npm test -- --run    # Erwartung ≥ 731 + 17 = ≥ 748
npm run build
```

- [ ] **Step 2: Manual smoke checklist** (CC #2):
  - [ ] Login → Studio. TopBar zeigt `[VibeGrid|SceneFlow]` ganz links, aktiver Tab markiert
  - [ ] Click "SceneFlow" → Workspace verschwindet, leere SceneFlow-Shell erscheint mit `[👤 Charaktere] [+ Neue Story]`
  - [ ] Click "Charaktere" → Drawer öffnet rechts, "Noch keine Charaktere"
  - [ ] Click "+ Neuer Charakter" → Form. Name "Magdalena", Type "Person", Bild upload, Stimme "Azure" + "de-DE-KillianNeural" → Speichern → Charakter in Liste
  - [ ] Edit-Klick → Form mit prefilled Werten → Name auf "Magda" ändern → Speichern → Liste aktualisiert
  - [ ] Delete-Klick → Confirm → Charakter weg
  - [ ] Drawer schließen → SceneFlowShell zurück mit leerer StoryListe
  - [ ] Click "+ Neue Story" → Dialog. Titel "Erste Geschichte", Format 16:9, Stil "cinematisch" → Anlegen → Story-Kachel erscheint mit grauem Status-Dot
  - [ ] Click "VibeGrid" → SceneFlow verschwindet, Studio kommt zurück. Geladenes Projekt + Playhead-Position sind unverändert
  - [ ] Click "SceneFlow" wieder → Charaktere und Story sind noch da (durch refresh-on-mount)
  - [ ] Logout-Button (rechts) sichtbar in beiden Modi
  - [ ] Anon-key REST: alle drei `VG_*`-Tabellen werfen `permission denied for table ...`
  - [ ] Direkt-curl `/api/sceneflow/characters` ohne Session → 401

- [ ] **Step 3: Push**

```powershell
git push origin main
```

- [ ] **Step 4: Verify CI grün** (siehe Plan 7 — `.npmrc` ist gesetzt, npm ci sollte sauber durchlaufen).

---

## Verification gate

```powershell
npm test -- --run    # ≥ 748 passing (731 + 17)
npm run typecheck    # clean
npm run lint         # clean
npm run build        # clean — Bundle-Delta ~30-60 kB (SceneFlow-Komponenten)
```

Bundle-Delta-Erwartung: **~30-60 kB** für die SceneFlow-Komponenten + Hooks. Der `@fal-ai/client` selbst landet nicht im Client-Bundle (`server-only`-Import in `lib/fal/client.ts`).

---

## Commit-Struktur (Summary)

```
chore(deps): add @fal-ai/client for Plan 8a/8c SceneFlow
feat(db): VG_characters + VG_stories + VG_story_scenes schema + RLS
feat(sceneflow): Character/Story/Scene TS types matching DB schema
feat(sceneflow): server-side CRUD characters — user-scoped pg queries
feat(sceneflow): server-side CRUD stories (minimal — scenes in 8b)
feat(fal): client stub — types + NotImplemented throws (real calls in 8c)
feat(sceneflow): API routes characters — POST/GET + [id] PATCH/DELETE
feat(sceneflow): API routes stories — POST/GET + [id] DELETE
feat(store): appMode slice (vibegrid | sceneflow) — transient, no persist
feat(topbar): TabSwitcher (VibeGrid/SceneFlow) + mode-aware cluster rendering
feat(sceneflow): client api + useSceneFlowCharacters/Stories hooks
feat(sceneflow): CharacterManager — list + form + R2 upload + edit/delete
feat(sceneflow): SceneFlowShell — StoryList + NewStoryButton + Characters entry
feat(studio): mode-aware page — Workspace vs SceneFlowShell
docs(limitations): Plan 8a — SceneFlow scope, mode-switch, character upload
```

15 Commits, ein Concern je Commit, granular und reviewbar.

---

## Risk + Tradeoff Notes

1. **Better-Auth-Wiederverwendung kein Risiko mehr** — Plan 7 hat den Stack bestätigt; Service-Role-Pattern, RLS-Lockdown und Session-Validation sind Production-tested. Plan 8a wendet dieselben Patterns auf neue Tabellen an.

2. **Mode-Switch via `display: none` statt Conditional-Mount** — bewusste Entscheidung. Workspace mounted zu unmounten würde `useAudioEngine`, `useVideoEngine`, `useVideoDecoderPool` zerstören. Bei häufigem Tab-Wechsel = Pre-Load-Verlust + AudioContext-Recreation. Display-toggle ist günstiger trotz dem dass der DOM voll bleibt.

3. **`createR2StorageAdapter().uploadImage()` Reuse für Charaktere** — Vorteil: kein neuer Upload-Pfad, kein extra API-Route-Setup. Nachteil: Character-Image landet im selben R2-Anonymous-Pfad wie VibeGrid-Medien, was die spätere v0.2-User-Path-Migration miterbt. Akzeptiert.

4. **fal.ai dep installieren obwohl 8a nicht callt** — vermeidet einen zweiten Install-Schritt in 8c und macht die Type-Imports schon jetzt verfügbar. Dependency-Size minimal (~50 kB unminified). Server-only-Import, kein Client-Bundle.

5. **Story-Scenes-Tabelle ohne CRUD in 8a** — Schema ist da, aber `lib/sceneflow/scenes-db.ts` und API-Routes für Szenen-Befüllung folgen in 8b mit dem Sonnet-Output. Plan 8a soll bewusst klein bleiben.

6. **Keine Story-Update-Route in 8a** — `PATCH /api/sceneflow/stories/[id]` kommt erst wenn 8b den Storyboard-View einführt (dort braucht's title/visualStyle-Edit). Plan 8a kann nur create/list/delete.

---

## Done-Definition (für CC #2)

CC #2 darf Plan 8a als "erledigt" markieren, wenn:

- Alle 15 Commits auf `main` gepusht sind und CI grün läuft
- `npm test -- --run` zeigt ≥ 748 passing, 0 failing
- Live-Smoke-Checks (alle in T15 Step 2) ✅
- KNOWN_LIMITATIONS-Section ist im File
- Drei `VG_*`-Tabellen mit anon-key über REST → `permission denied`
- Verschiedener User-Account sieht NICHT die Charaktere/Stories des ersten Users (RLS-Defense-in-Depth verifiziert)

Abgabe-Datei: `docs/superpowers/plans/2026-05-24-vibegrid-plan-8a-sceneflow-fundament.md` (dieses Dokument).
