# CC #1 Prompt — Schreibe Plan 8a: SceneFlow Fundament

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Baseline: HEAD post-Plan-7 (**~698 Tests**, Store v6, Better Auth aktiv).

Schreibe nur den **Plan** — noch keinen Code.

---

## Was Plan 8a leistet

VibeGrid bekommt einen zweiten Tab "SceneFlow" in der TopBar.
Plan 8a legt das Fundament: Tab-Navigation, Datenmodell, Character
Manager, fal.ai Client-Modul (Stub), leere Storyboard-Shell.

Keine fal.ai API-Calls in Plan 8a. Keine Sonnet-Integration.
Beides kommt in 8b und 8c. Plan 8a ist reine Infrastruktur.

---

## Schritt 0 — Codebase lesen (vor Plan schreiben)

CC #1 liest folgende Dateien und dokumentiert die echten Pfade:

1. `components/TopBar/index.tsx` — wie ist die TopBar heute aufgebaut?
   Wo wird der aktive Tab-State gehalten? Gibt es bereits einen
   App-Mode-State im Store?
2. `lib/store/index.ts` — Store v6 Struktur. Gibt es bereits einen
   `activeTab` oder `appMode` Slice?
3. `app/(studio)/` — Routing-Struktur. Wie ist das Studio-Layout
   aufgebaut? Wo liegt `layout.tsx`?
4. `lib/db/pg.ts` — bestehender Pool-Singleton, wird direkt
   wiederverwendet.
5. `components/` — Verzeichnis-Übersicht um Namenskollisionen zu
   vermeiden.

Erst nach dieser Analyse wird der Plan geschrieben.

---

## Feature 1 — Tab-Navigation (VibeGrid / SceneFlow)

### TopBar

Zwei Tabs in der TopBar — visuell wie zwei Buttons, einer aktiv:

```
[ VibeGrid ]  [ SceneFlow ]
```

Design: aktiver Tab in `--a1` (#a86bff), inaktiver Tab in
`--text-muted`. Kein eigenes Routing — der aktive Tab ist ein
Zustand im Store oder lokalem Component-State.

### App-Mode im Store

```ts
// Neuer Slice in useAppStore oder eigener useAppMode Store
type AppMode = 'vibegrid' | 'sceneflow';
```

Beim Wechsel auf SceneFlow: VibeGrid-Canvas/Timeline wird
ausgeblendet (nicht unmounted — kein State-Verlust), SceneFlow-Shell
wird eingeblendet. Umgekehrt beim Zurückwechseln.

CC #1 entscheidet nach Lesen des bestehenden Codes ob `appMode`
in `useAppStore` oder als eigener leichtgewichtiger Store sinnvoller
ist. Begründung im Plan angeben.

---

## Feature 2 — Datenmodell (SQL Migration)

### Neue Tabellen (alle mit VG_-Präfix)

```sql
-- VG_characters: Charaktere eines Users
CREATE TABLE IF NOT EXISTS public."VG_characters" (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL REFERENCES public."user"(id)
                    ON DELETE CASCADE,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('person', 'group')),
  reference_image_url TEXT,
  voice_provider    TEXT CHECK (voice_provider IN ('azure', 'elevenlabs')),
  voice_id          TEXT,
  image_prompt      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_idx_characters_user_id"
  ON public."VG_characters"(user_id);

-- VG_stories: Story-Drafts und fertige Stories
CREATE TABLE IF NOT EXISTS public."VG_stories" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES public."user"(id)
                ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Untitled Story',
  format        TEXT NOT NULL DEFAULT '16:9'
                CHECK (format IN ('16:9', '9:16', '4:3')),
  visual_style  TEXT,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'generating', 'done', 'error')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_idx_stories_user_id"
  ON public."VG_stories"(user_id, updated_at DESC);

-- VG_story_scenes: Szenen einer Story (geordnet)
CREATE TABLE IF NOT EXISTS public."VG_story_scenes" (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id             UUID NOT NULL
                       REFERENCES public."VG_stories"(id) ON DELETE CASCADE,
  scene_order          INTEGER NOT NULL,
  type                 TEXT NOT NULL
                       CHECK (type IN ('action', 'dialog', 'endcard')),
  image_prompt         TEXT,
  motion_prompt        TEXT,
  camera_control       JSONB,
  duration             INTEGER NOT NULL DEFAULT 5,  -- Sekunden
  audio_type           TEXT NOT NULL DEFAULT 'none'
                       CHECK (audio_type IN ('none', 'voiceover', 'lipsync')),
  tts_text             TEXT,
  speaking_character_id UUID REFERENCES public."VG_characters"(id)
                        ON DELETE SET NULL,
  transition           TEXT NOT NULL DEFAULT 'last-frame'
                       CHECK (transition IN ('last-frame', 'crossfade', 'cut')),
  start_frame_mode     TEXT NOT NULL DEFAULT 'auto'
                       CHECK (start_frame_mode IN
                              ('auto', 'from-previous', 'custom')),
  start_frame_url      TEXT,
  image_url            TEXT,
  video_url            TEXT,
  audio_url            TEXT,
  end_frame_url        TEXT,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN
                              ('pending', 'generating', 'done', 'error')),
  error_message        TEXT,
  fal_request_ids      JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "VG_idx_story_scenes_story_id"
  ON public."VG_story_scenes"(story_id, scene_order);
```

RLS + GRANT analog zu VG_projects (Plan 7):
- `REVOKE ALL FROM anon, authenticated`
- `GRANT ALL TO service_role`
- RLS `USING (false)` für anon/authenticated
- `updated_at` Trigger für alle drei Tabellen (nutzt bestehende
  `VG_fn_touch_updated_at` Function oder neue analog)

Migration: `db/migrations/002_VG_sceneflow.sql`
Apply-Script: bestehendes `scripts/apply-migration.mjs` verwenden.

---

## Feature 3 — Server-side CRUD (API Routes)

### Characters CRUD

```
POST   /api/sceneflow/characters        → create
GET    /api/sceneflow/characters        → list (user-scoped)
PATCH  /api/sceneflow/characters/[id]   → update
DELETE /api/sceneflow/characters/[id]   → delete
```

Jede Route: `auth.api.getSession({ headers })` → 401 wenn keine
Session. Alle Queries mit `WHERE user_id = session.user.id`.
`import 'server-only'` auf allen DB-Modulen.

### Stories CRUD (minimal für Plan 8a)

```
POST   /api/sceneflow/stories           → create (title, format, visualStyle)
GET    /api/sceneflow/stories           → list
DELETE /api/sceneflow/stories/[id]      → delete
```

Scenes werden in Plan 8b befüllt (Sonnet-Output). In Plan 8a
nur die leere Story anlegen können.

---

## Feature 4 — fal.ai Client-Stub

```ts
// lib/fal/client.ts
// 'server-only'
// Wrapper um @fal-ai/client — ein Entry Point für alle fal.ai Calls.
// In Plan 8a nur Stub mit Typen und leeren Funktionen.
// Echte Calls kommen in Plan 8c.

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
  zoom: number;        // -5 ... +5
  panX: number;        // -5 ... +5
  panY: number;        // -5 ... +5
  motionIntensity: number; // 1 ... 10
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

// Alle Funktionen in Plan 8a als NotImplementedError-Stubs:
export async function generateImage(_input: FalImageGenInput): Promise<string> {
  throw new Error('fal.ai generateImage: not implemented until Plan 8c');
}

export async function generateVideo(_input: FalVideoGenInput): Promise<string> {
  throw new Error('fal.ai generateVideo: not implemented until Plan 8c');
}
```

`.env.example` ergänzen: `FAL_KEY=`
`lib/fal/client.ts` liest `process.env.FAL_KEY` und wirft wenn nicht gesetzt.

---

## Feature 5 — Character Manager UI

### Route

`app/(studio)/sceneflow/characters/page.tsx` oder als Modal/Drawer
in der SceneFlow-Shell — CC #1 entscheidet nach Lesen der
Routing-Struktur. Begründung im Plan.

### UI-Elemente

**Character-Liste:**
- Karte je Charakter: Referenzbild (oder Platzhalter-Avatar),
  Name, Typ-Badge (Person/Gruppe), Stimme-Label
- `+ Neuer Charakter` Button öffnet Form

**Character-Form (Create/Edit):**
- Name (Text Input)
- Typ: `Person` / `Gruppe` (Toggle)
- Referenzbild: Upload-Button → R2 Presigned Upload
  (bestehender Upload-Flow aus Plan 5.9b wiederverwenden)
- Bild-Prompt: Textarea (optional) + `Generieren`-Button
  (disabled in Plan 8a — aktiv erst in Plan 8c)
- Stimme: Provider-Toggle (Azure / ElevenLabs) +
  Voice-Dropdown (Azure) oder Voice-ID-Input (ElevenLabs)
- Speichern / Abbrechen

Design: Dark Mode, bestehende Design Tokens
(`--surface-1`, `--a1`, `--border` etc.)

---

## Feature 6 — SceneFlow-Shell (leere Storyboard-Seite)

Wenn SceneFlow-Tab aktiv ist, zeigt VibeGrid:

```
┌─ SceneFlow Shell ──────────────────────────────────────────────┐
│ [👤 Charaktere]  [+ Neue Story]       Story-Liste (leer)       │
│                                                                  │
│ "Noch keine Stories. Klicke + Neue Story um zu beginnen."       │
└──────────────────────────────────────────────────────────────────┘
```

Story-Liste: Kacheln mit Titel, Format-Badge, Status-Dot, Datum.
Klick auf Story: öffnet das Storyboard (in Plan 8a noch leer —
nur Story-Metadaten und leere Szenen-Liste).

---

## File Map

| Datei | Aktion |
|---|---|
| `db/migrations/002_VG_sceneflow.sql` | CREATE — Tabellen + RLS + Trigger |
| `lib/fal/client.ts` | CREATE — Stub mit Typen |
| `lib/sceneflow/characters-db.ts` | CREATE — server-only CRUD |
| `lib/sceneflow/stories-db.ts` | CREATE — server-only CRUD (minimal) |
| `lib/sceneflow/types.ts` | CREATE — Character, Story, Scene TypeDefs |
| `app/api/sceneflow/characters/route.ts` | CREATE — POST/GET |
| `app/api/sceneflow/characters/[id]/route.ts` | CREATE — PATCH/DELETE |
| `app/api/sceneflow/stories/route.ts` | CREATE — POST/GET |
| `app/api/sceneflow/stories/[id]/route.ts` | CREATE — DELETE |
| `lib/hooks/useSceneFlowCharacters.ts` | CREATE — Client-Hook |
| `lib/hooks/useSceneFlowStories.ts` | CREATE — Client-Hook |
| `components/SceneFlow/CharacterManager.tsx` | CREATE |
| `components/SceneFlow/CharacterCard.tsx` | CREATE |
| `components/SceneFlow/CharacterForm.tsx` | CREATE |
| `components/SceneFlow/StoryList.tsx` | CREATE |
| `components/SceneFlow/SceneFlowShell.tsx` | CREATE — Shell-Layout |
| `components/TopBar/index.tsx` | MODIFY — Tab-Switcher hinzufügen |
| `lib/store/index.ts` (oder neuer Store) | MODIFY/CREATE — appMode |
| `.env.example` | MODIFY — FAL_KEY |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY — Plan 8a Eintrag |

CC #1 ergänzt nach Codebase-Analyse fehlende oder geänderte Dateien.

---

## Tests

**`tests/unit/sceneflow/characters-db.test.ts`** — ≥ 5:
- `createCharacter` legt Charakter an, gibt ID zurück
- `listCharacters` filtert korrekt nach `userId`
- `updateCharacter` — anderer User kann nicht updaten
- `deleteCharacter` — gibt false wenn nicht gefunden
- Type-Check: `type` muss `person` oder `group` sein

**`tests/unit/sceneflow/stories-db.test.ts`** — ≥ 3:
- `createStory` legt Story an
- `listStories` user-scoped
- `deleteStory` cascaded scenes löschen (via FK)

**`tests/unit/fal/client.test.ts`** — ≥ 2:
- Stub wirft `NotImplementedError` wenn aufgerufen
- `FAL_KEY` fehlt → Modul-Load wirft

**`tests/integration/api/sceneflow-characters.test.ts`** — ≥ 3:
- POST 401 ohne Session
- POST 201 mit Session + korrektem Body
- GET listet nur eigene Charaktere

Mindest: **≥ 13 neue Tests**

---

## Verification Gate

Baseline: **~698 Tests**, 0 failing.
Ziel: **≥ 711 Tests**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**
```
# VibeGrid-Tab → Studio wie gehabt
# SceneFlow-Tab → Shell erscheint, leere Story-Liste
# Charakter anlegen (Upload) → erscheint in Liste
# Charakter bearbeiten → Name + Stimme änderbar
# Charakter löschen → verschwindet
# Neue Story anlegen → erscheint in Liste mit Draft-Status
# Story löschen → verschwindet
# Tab wechseln → VibeGrid-State bleibt erhalten (kein Reset)
```

---

## Commit-Struktur

```
feat(db): VG_characters + VG_stories + VG_story_scenes migration
feat(fal): client stub — Typen + NotImplemented-Stubs
feat(sceneflow): server-side CRUD characters + stories
feat(sceneflow): API routes characters (POST/GET/PATCH/DELETE)
feat(sceneflow): API routes stories (POST/GET/DELETE)
feat(sceneflow): CharacterManager UI — list + form + R2 upload
feat(sceneflow): StoryList UI — kacheln + neue Story anlegen
feat(sceneflow): SceneFlowShell — leere Storyboard-Shell
feat(topbar): VibeGrid / SceneFlow Tab-Switcher
feat(store): appMode slice — vibegrid | sceneflow
docs(limitations): Plan 8a Eintrag
test: sceneflow characters-db + stories-db + api + fal-stub
```

---

## Out of Scope (kommt in 8b / 8c)

- Sonnet Story-Aufteilung → Plan 8b
- Story-Input UI (Textarea, Stil, Charaktere wählen) → Plan 8b
- Storyboard mit Szenen-Karten → Plan 8b
- fal.ai echte API-Calls → Plan 8c
- TTS + LipSync → Plan 8c
- "In VibeGrid öffnen" → Plan 8d

Abgabe: `2026-05-24-vibegrid-plan-8a-sceneflow-fundament.md`
