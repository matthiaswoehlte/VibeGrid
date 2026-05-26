# CC #1 Prompt — Schreibe Plan 8b: Story-Input + Sonnet-Aufteilung + Storyboard

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Baseline: HEAD post-Plan-8a (**754 Tests**, Store v6, SceneFlow-Tab mit
Character Manager + leerer StoryList vorhanden, drei `VG_*`-Tabellen
RLS-gelockdownt).

Schreibe nur den **Plan** — noch keinen Code.

> **Wichtig — Anthropic-Stack steht schon:**
> `@anthropic-ai/sdk@^0.30.1` ist installiert, `ANTHROPIC_API_KEY` steht
> in `.env.example` (Zeile 27) und in `.env.local` des Users, und
> `lib/ai/anthropic.ts` + `lib/ai/env.ts` liefern bereits einen
> Singleton-Client mit `getAnthropicConfig()` (wirft auf fehlendem Key,
> pinnt das Modell als `claude-sonnet-4-6`). Plan 8b **wiederverwendet
> dieses Modul** statt einen Parallel-Client aufzubauen.

---

## Was Plan 8b leistet

Plan 8b füllt die leere SceneFlow-Shell mit Leben:
- Story-Detail-View (Klick auf Story-Kachel → Storyboard)
- Story-Setup-Form (Titel, Format, Visueller Stil, Charaktere auswählen)
- Freitext-Eingabe der Story + "Mit KI aufteilen"-Button
- Anthropic API Call: Story-Text → strukturiertes Szenen-JSON via Claude Sonnet
- Szenen-CRUD (server-side + API-Routes)
- Storyboard-Ansicht: editierbare Szenen-Karten (vertikale Liste)
- Szenen manuell nachbearbeiten (Prompts, Dauer, Transition, Kamera-Slider)

Keine fal.ai-Calls in Plan 8b. Bilder/Videos folgen in 8c.
"In VibeGrid öffnen" folgt in 8d.

---

## Schritt 0 — Codebase lesen (vor Plan schreiben)

CC #1 liest und dokumentiert:

**SceneFlow-Schicht (aus 8a):**
1. `components/SceneFlow/SceneFlowShell.tsx` — aktueller Aufbau,
   Navigation, State. Wie wird aktuell von StoryList auf eine Story
   navigiert (gibt es das schon oder nur die Kacheln)?
2. `components/SceneFlow/StoryList.tsx` — was passiert bei Klick auf
   eine Story-Kachel? Gibt es bereits einen `onSelect`-Handler?
3. `lib/sceneflow/types.ts` — alle Typen aus 8a, damit 8b darauf aufbaut
4. `lib/sceneflow/stories-db.ts` — welche Operationen existieren?
   Gibt es bereits `updateStory`? (Antwort: **nein**, kommt mit 8b)
5. `app/api/sceneflow/stories/[id]/route.ts` — gibt es bereits PATCH?
   (Antwort: **nein**, kommt mit 8b)

**Anthropic-Stack (steht schon, MUSS wiederverwendet werden):**
6. `lib/ai/anthropic.ts` — Singleton-Client, lazy-init, Test-Reset-Hook
   (`_resetAnthropicClientForTests`). Sonnet-Call-Pattern dort copy-paste-bar.
7. `lib/ai/env.ts` — `getAnthropicConfig()` wirft auf fehlendem
   `ANTHROPIC_API_KEY`, pinnt Modell als `claude-sonnet-4-6`. Plan 8b
   **kein neues Env-Handling**, nicht in `.env.example` schreiben (steht
   schon Zeile 27).
8. `app/api/analyze-image/route.ts` — wie Anthropic aktuell aus einer
   API-Route gerufen wird. Patterns kopieren: `runtime = 'nodejs'`,
   Session-Check, Error-Mapping.

**Bestehende Tabellen, die 8b ändert:**
9. `db/migrations/002_VG_sceneflow.sql` — Spalten von `VG_stories`
   (kein `characters`, kein `story_text`). 8b braucht **Migration 003**
   die beide Spalten hinzufügt (siehe Feature 2).
10. `VG_story_scenes`-Schema — der vollständige `SceneRecord` hat 25
    Felder. Sonnet liefert nur ~10 davon (kreative Felder); die Rest-Felder
    füllt der Server mit Defaults (`status='pending'`, alle URLs `null`,
    `fal_request_ids=null`).

Erst nach dieser Analyse wird der Plan geschrieben.

---

## Feature 1 — Story-Detail-Navigation

### Navigation-Pattern

SceneFlowShell bekommt einen `activeStoryId: string | null` State
(lokalem Component-State oder eigenem Slice — CC #1 entscheidet nach
Codebase-Analyse). Kein Next.js-Routing — kein Subrouting, kein
URL-Wechsel, alles Conditional Rendering wie der Tab-Switch in 8a.

```
SceneFlowShell:
  activeStoryId === null → StoryList (wie bisher)
  activeStoryId !== null → StoryDetailView (neu)
```

StoryDetailView hat oben einen `← Zurück`-Button der
`activeStoryId = null` setzt.

---

## Feature 2 — Story-Setup-Form (innerhalb StoryDetailView)

Oben in der StoryDetailView, immer sichtbar:

```
Story-Setup-Bereich:
  [Titel: __________]   [Format: 16:9 ▼]
  [Visueller Stil: "cinematisch, warmes Licht..."           ]
  [Charaktere: @Magdalena ×  @Johannes ×  + Charakter wählen]
```

`+ Charakter wählen` öffnet ein kleines Dropdown mit allen Charakteren
des Users (aus `VG_characters`). Ausgewählte Charaktere werden als
**JSONB-Array von Character-UUIDs** in `VG_stories.characters`
gespeichert (Architekt-Entscheidung, gelockt) — keine separate
`VG_story_characters`-Tabelle. Die Szenen-Ebene macht die eigentliche
Bindung über `speaking_character_id`.

**Schema-Change in Plan 8b — Migration 003:**
```sql
-- db/migrations/003_VG_stories_text_and_characters.sql
ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS characters JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS story_text TEXT;
```

`story_text` wird **persistiert** (nicht transient): der User soll bei
einem erneuten Besuch der Story den Freitext wiederfinden, statt ihn
neu eintippen zu müssen. PATCH-Updates dieser Spalten gehen über
`updateStory` + die neue PATCH-Route.

Story-Setup-Änderungen: PATCH `/api/sceneflow/stories/[id]` —
in 8a existiert die Route nur als DELETE-Endpoint, PATCH wird in 8b
neu hinzugefügt (Story-Update war explizit für 8b vorgesehen).

---

## Feature 3 — Story-Text-Eingabe + Sonnet-Aufteilung

Unterhalb des Story-Setups, vor dem Storyboard:

```
[Beschreibe deine Story:                               ]
[Eine Frau (@Magdalena) geht durch einen Wald...       ]
[                                                       ]
                              [ Mit KI aufteilen → ]
```

`@Name`-Validierung **client- UND server-side** (Defense in Depth):
alle `@`-Referenzen im Text müssen bekannte Charaktere sein. Unbekannte
→ Inline-Fehler ("@Unbekannt ist kein definierter Charakter") + Server
gibt 400 zurück, falls Client-Check umgangen wurde. Sonst halluziniert
Sonnet zu erfundenen Namen.

"Mit KI aufteilen" ist disabled wenn:
- Keine Charaktere in der Story ausgewählt sind
- Story-Text leer ist
- Ein Call bereits läuft (Spinner statt Button)

---

## Feature 4 — Anthropic API Call (Sonnet)

### Server-Side Route

```
POST /api/sceneflow/stories/[id]/generate-scenes
Body: { storyText: string }
```

Pipeline (server-side):
1. Session-Check → 401 sonst
2. Story laden (`title`, `format`, `visual_style`, `characters`-UUIDs,
   `story_text`) per `loadStory(userId, storyId)` — 404 wenn nicht
   Owner
3. Charakter-Details der Story-Charaktere via `listCharactersByIds(userId,
   ids)` — Server-side `@Name`-Validierung gegen diese Liste
4. **Wenn die Story bereits Szenen hat:** Client-Confirm war Voraussetzung
   (siehe W6 unten). Server löscht alte Szenen NICHT atomar mit dem
   Insert — falls Sonnet hängt, sind alte Szenen weg. Reihenfolge:
   Sonnet-Call → Validate → DELETE+INSERT in einer Transaction.
5. `generateScenesViaSonnet(...)` (siehe unten)
6. **Coerce + Validate** der Sonnet-Response (siehe "Hallucination-Guardrails")
7. `deleteScenesByStory` + `createScenes` in **einer Transaction** —
   pool.connect(), BEGIN, beide Queries, COMMIT/ROLLBACK
8. Token-Usage loggen: `console.log('[generate-scenes]', storyId,
   { input: usage.input_tokens, output: usage.output_tokens })`
9. Response: `{ scenes: SceneRecord[] }` (mit echten DB-IDs nach Insert)

### Sonnet via `lib/ai/anthropic.ts`-Client

`lib/sceneflow/sonnet.ts` **importiert** den existierenden Client aus
`lib/ai/anthropic.ts` (siehe Schritt 0 #6/#7) und ergänzt eine
Sceneflow-spezifische Funktion `generateScenesViaSonnet()`. Kein
neuer SDK-Init, kein neues `process.env.ANTHROPIC_API_KEY`-Lesen,
kein neuer Test-Reset-Hook.

```ts
// lib/sceneflow/sonnet.ts (Skizze)
import 'server-only';
import { getAnthropicClient, getAnthropicConfig } from '@/lib/ai/anthropic';
// (getAnthropicClient muss in lib/ai/anthropic.ts als Export ergänzt
// werden — die existierende getClient() ist file-private; CC1 macht
// daraus einen Export plus passenden Test-Hook.)
```

### Strukturierter Output via Tool-Use (NICHT "JSON-Mode hoffen")

Anthropic-SDK liefert garantiert-schema-konformen Output über
`tools: [...]` + `tool_choice: { type: 'tool', name: 'submit_scenes' }`.
Plan 8b nutzt das anstelle von "antwort NUR mit JSON" — letzteres
bricht bei langen Outputs zuverlässig (Markdown-Fences, Erklärungen
vor/nach dem JSON, etc.).

```ts
const tool = {
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
              type: 'object',
              properties: {
                zoom: { type: 'number', minimum: -5, maximum: 5 },
                panX: { type: 'number', minimum: -5, maximum: 5 },
                panY: { type: 'number', minimum: -5, maximum: 5 },
                motionIntensity: { type: 'integer', minimum: 1, maximum: 10 }
              },
              required: ['zoom', 'panX', 'panY', 'motionIntensity']
            },
            duration: { type: 'integer', minimum: 1, maximum: 8 },
            audio_type: { type: 'string', enum: ['none', 'voiceover', 'lipsync'] },
            tts_text: { type: ['string', 'null'] },
            speaking_character_id: { type: ['string', 'null'] },
            transition: { type: 'string', enum: ['last-frame', 'crossfade', 'cut'] },
            start_frame_mode: { type: 'string', enum: ['auto', 'from-previous', 'custom'] }
          },
          required: [
            'scene_order','type','image_prompt','motion_prompt',
            'camera_control','duration','audio_type','transition','start_frame_mode'
          ]
        }
      }
    },
    required: ['scenes']
  }
} as const;
```

Response-Parsing:
```ts
const block = res.content.find((b) => b.type === 'tool_use' && b.name === 'submit_scenes');
if (!block || block.type !== 'tool_use') throw new Error('Sonnet did not call submit_scenes');
const raw = block.input as { scenes: Array<...> };
```

### Prompt-Caching

Der System-Prompt + Charakter-Kontext bleiben über mehrere Generate-Calls
hinweg gleich (oder ändern sich nur selten). Anthropic 5-Min-Cache
spart Token + Latenz:

```ts
system: [
  { type: 'text', text: SYSTEM_PROMPT,
    cache_control: { type: 'ephemeral' } }
]
```

Charakter-Kontext (Namen, Reference-URLs, Typ) gehört dann als
separater System-Block ebenfalls mit `cache_control`. Story-Freitext
ist der einzige User-Message-Block, ohne Cache.

### Model + max_tokens

- Model: `claude-sonnet-4-6` (kommt aus `getAnthropicConfig()`,
  nicht hardcoden in Plan 8b)
- `max_tokens: 16000` — eine 30-Szenen-Story mit langen Prompts
  passt drin
- Timeout im fetch via AbortSignal: **60 Sekunden** (nicht 30 — Sonnet
  ist bei Tool-Use mit großen Schemas durchaus 20-30s)

### System-Prompt (Sonnet-Briefing — angepasst für Tool-Use)

```
Du bist ein professioneller Video-Storyboard-Autor.
Deine Aufgabe: Eine Story-Beschreibung in eine strukturierte
Szenen-Liste für KI-Video-Generierung aufteilen, und sie über
das submit_scenes-Tool abzugeben.

Regeln:
- Jede Szene 1–8 Sekunden (Standard: 5s)
- @Name-Referenzen im Story-Text werden durch Charakter-Details ersetzt
  (Namen + visuelle Beschreibung); die Charaktere sind im Kontext gegeben
- image_prompt: vollständig ausformuliert auf Englisch, visuellen
  Stil bereits eingearbeitet, fotorealistisch
- motion_prompt: Kamera-Beschreibung auf Englisch
- camera_control: zoom -5..+5, panX -5..+5, panY -5..+5, motionIntensity 1..10
- tts_text: ausformuliert, natürliche Sprache (Deutsch wenn Story auf
  Deutsch, sonst Englisch); null für action/endcard-Szenen ohne Audio
- speaking_character_id: GENAU eine der UUIDs aus der Charakter-Liste
  oder null — keine erfundenen IDs
- scene_order: 1, 2, 3, ... fortlaufend ohne Lücken
- Erste Szene: start_frame_mode = "auto"
- Folge-Szenen: start_frame_mode = "from-previous"
- Dialog/LipSync-Szenen: transition = "last-frame"
- Crossfade für emotionale Übergänge
- Immer mit einer endcard-Szene abschließen (type = "endcard")
```

### Hallucination-Guardrails (server-side, NACH dem Sonnet-Call)

Jede zurückgegebene Szene durchläuft Coerce-Logik bevor sie in die DB
geschrieben wird:

1. **`speaking_character_id`-Validierung:** ist die UUID in der Story
   eingebundenen Character-Liste? Wenn nein → auf `null` setzen,
   `console.warn` loggen. **Niemals** rohe Sonnet-Werte direkt
   gegen die FK halten lassen — der INSERT würde sonst explodieren.
2. **`duration`-Clamp:** auf `[1, 8]` clampen.
3. **`camera_control`-Clamp:** zoom/panX/panY auf `[-5, 5]`,
   motionIntensity auf `[1, 10]`.
4. **`scene_order`-Renumbering:** server-side neu durchnumerieren
   (1, 2, 3, ...) — egal was Sonnet geliefert hat. Lücken oder
   Duplikate ignorieren.
5. **`audio_type` vs. `tts_text`-Konsistenz:** wenn `audio_type === 'none'`
   → `tts_text = null` + `speaking_character_id = null` erzwingen.

### Sonnet-Output ≠ DB-Schema

Sonnet liefert ~10 kreative Felder pro Szene. Der vollständige
`SceneRecord` hat 25 Felder. Server-Mapping füllt die Rest-Defaults:

| DB-Feld | Quelle |
|---|---|
| `id` | DB `gen_random_uuid()` |
| `story_id` | URL-Param |
| `scene_order` | Server-Renumbering |
| `type`, `image_prompt`, `motion_prompt`, `camera_control`, `duration`, `audio_type`, `tts_text`, `speaking_character_id`, `transition`, `start_frame_mode` | Sonnet (gecoercd) |
| `start_frame_url`, `image_url`, `video_url`, `audio_url`, `end_frame_url` | `null` (kommt in 8c) |
| `status` | `'pending'` |
| `error_message`, `fal_request_ids` | `null` |
| `created_at`, `updated_at` | DB `now()` |

CC1 dokumentiert diese Mapping-Tabelle 1:1 im Plan.

### Fehlerbehandlung

- Sonnet ruft `submit_scenes` nicht (z.B. wirft nur Text aus) →
  `throw new Error('Sonnet did not call submit_scenes')` → API
  gibt 502, UI zeigt Retry-Hinweis. Kein Auto-Retry (Cost-Schutz).
- AbortSignal-Timeout → 504 + Retry-Hinweis.
- Bei Re-Generate: **alte Szenen werden erst NACH erfolgreichem
  Sonnet-Call gelöscht** (Transaction, siehe Pipeline Schritt 7).
  So bleibt der User bei Sonnet-Fehler nicht mit leerem Storyboard
  zurück.

---

## Feature 5 — Szenen-CRUD

### `lib/sceneflow/scenes-db.ts` (neu, server-only)

```ts
createScenes(storyId, scenes[])               // Bulk-Insert (siehe unten)
listScenes(userId, storyId)                   // JOIN auf VG_stories
updateScene(userId, sceneId, patch)           // SET-builder, JOIN-Ownership
deleteScene(userId, sceneId)                  // JOIN-Ownership
deleteScenesByStory(storyId, txClient?)       // optional Tx-Client für Re-Gen
swapSceneOrder(userId, aId, bId)              // atomic [↑][↓]-Tausch
```

### Ownership-Pattern: JOIN auf `VG_stories`

`VG_story_scenes` hat keine `user_id`-Spalte (Story besitzt die Szene,
User besitzt die Story). Jede mutierende Operation **muss** den
User-Check über JOIN machen — niemals zwei separate Queries
(Race-Condition).

Beispiel `updateScene`:
```sql
UPDATE "VG_story_scenes" s
SET ${setClause}, updated_at = now()
FROM "VG_stories" st
WHERE s.id = $${sceneIdParam}
  AND s.story_id = st.id
  AND st.user_id = $${userIdParam}
```

`rowCount === 0` heißt: Szene existiert nicht ODER gehört einem anderen
User → API gibt 404 (nicht 403 — wir verraten nicht die Existenz).

### Bulk-Insert-Pattern

Für 5-30 Szenen pro Story: Multi-VALUES-INSERT mit dynamischer
Parameter-Liste. pg hat 65535-Parameter-Limit — bei 14 Spalten ×
30 Szenen = 420 Parameter, weit unter dem Limit.

```ts
const cols = ['story_id','scene_order','type','image_prompt',
  'motion_prompt','camera_control','duration','audio_type','tts_text',
  'speaking_character_id','transition','start_frame_mode','status',
  'fal_request_ids'];
const placeholders = scenes.map((_, i) => {
  const base = i * cols.length;
  return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
}).join(', ');
const values = scenes.flatMap((s) => [
  storyId, s.scene_order, s.type, s.image_prompt, ...
]);
await client.query(
  `INSERT INTO "VG_story_scenes" (${cols.join(', ')})
   VALUES ${placeholders} RETURNING *`,
  values
);
```

### Transaction für Re-Generate

`/api/sceneflow/stories/[id]/generate-scenes` muss `deleteScenesByStory`
+ `createScenes` atomar machen, damit ein Crash zwischen den beiden
Operationen nicht zu Daten-Inkonsistenz führt:

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await deleteScenesByStory(storyId, client);
  const scenes = await createScenes(storyId, mapped, client);
  await client.query('COMMIT');
  return scenes;
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

### API-Routes

```
GET    /api/sceneflow/stories/[id]/scenes            → listScenes
POST   /api/sceneflow/stories/[id]/scenes            → createScenes (bulk, manuell)
PATCH  /api/sceneflow/scenes/[sceneId]               → updateScene
DELETE /api/sceneflow/scenes/[sceneId]               → deleteScene
POST   /api/sceneflow/stories/[id]/scenes/reorder    → swapSceneOrder ([↑][↓])
POST   /api/sceneflow/stories/[id]/generate-scenes   → Sonnet-Call
```

Alle Routes: Session-Check, JOIN-basiertes Ownership wie oben.

---

## Feature 6 — Storyboard-Ansicht (editierbare Karten)

Vertikale scrollbare Liste unterhalb der Story-Setup-Form und des
Story-Text-Eingabefelds. Erscheint sobald Szenen vorhanden sind.

### Szenen-Karte (Anatomy)

```
┌─ Szene 1 · ACTION · [↑][↓][×] ────────────────────────────────┐
│ LINKS — BILD                    RECHTS — VIDEO                  │
│ [Image Prompt Textarea]         [Motion Prompt Textarea]        │
│ [Bild-Platzhalter 16:9]         [Video-Platzhalter 16:9]       │
│ [Retry disabled in 8b]          [Retry disabled in 8b]         │
│                                                                  │
│ Startbild: ○ Auto  ○ Letzter Frame [↺]  ○ Upload               │
│                                                                  │
│ KAMERA ────────────────────────────────────────────────────     │
│ Zoom:    [←──●──→]  Pan L/R: [←──●──→]  Pan U/D: [←──●──→]   │
│ Bewegungsintensität: [●────────────]  1 ... 10                  │
│                                                                  │
│ AUDIO ─────────────────────────────────────────────────────     │
│ ○ Kein Audio  ○ Voiceover  ● Dialog/LipSync                     │
│ Charakter: [Magdalena ▼]                                        │
│ TTS-Text: [Gott hat das alles für dich erschaffen.   ]          │
│                                                                  │
│ Dauer: [5s ▼]   Transition: [last-frame ▼]                     │
└─────────────────────────────────────────────────────────────────┘
```

### Interaktionen

- **Textarea-Änderung** → debounced PATCH (500ms) an
  `/api/sceneflow/scenes/[sceneId]` — kein expliziter Save-Button.
  **AbortController pro (sceneId, field)** — vor jedem neuen PATCH den
  vorherigen abbrechen, damit Last-Write-Wins gilt und keine
  überholte Antwort einen späteren Wert überschreibt.
- **Kamera-Slider** → debounced PATCH (gleiches Abort-Pattern)
- **Dauer / Transition / AudioType / Charakter** → sofortiger PATCH
- **[↑][↓]** — Reihenfolge tauschen: ein einziger POST an
  `/api/sceneflow/stories/[id]/scenes/reorder` mit beiden Scene-IDs.
  Server macht `swapSceneOrder` als Transaction — kein zweimaliger
  Client-PATCH der eine inkonsistente Zwischenstufe sichtbar machen
  könnte.
- **[×]** — Szene löschen mit `confirm()` — `DELETE
  /api/sceneflow/scenes/[sceneId]`
- **[↺] Letzter Frame** — setzt `start_frame_mode = 'from-previous'`
  und `start_frame_url = null` (wird in 8c nach Render gesetzt)
- **"Mit KI aufteilen" bei bestehenden Szenen** — `confirm()` mit
  Warnung "Alle bestehenden Szenen werden ersetzt — manuelle
  Bearbeitungen gehen verloren." vor Sonnet-Call. Plan 8b geht dann
  destruktiv vor; Merge-Logik (User-Edits behalten) ist explizit
  out of scope.

### Endcard-Karte — eigener Editor

`SceneCard` rendert für `scene.type === 'endcard'` einen **anderen**
Editor:
- Kein Image-Prompt, kein Motion-Prompt, kein Bild-/Video-Platzhalter
- Kein Kamera-Slider-Block, kein Audio-Block
- Stattdessen ein einzelnes Textarea-Feld "CTA-Text" — der CTA-Text
  wird in `tts_text` persistiert (semantisch passt der Slot:
  ist-statisch-Text-für-Endbild)
- `transition` + `duration` bleiben editierbar

Sonnet liefert `type === 'endcard'` für die Schluss-Szene und befüllt
`tts_text` mit der CTA-Initial-Idee. Image-/Motion-Prompts kann
Sonnet auch füllen — werden in 8b aber von der Endcard-UI ignoriert
(stehen in der DB für eventuell spätere Endcard-Rendering-Variante).

**Architekt-Note für KNOWN_LIMITATIONS:** `tts_text` als CTA-Text-Slot
für Endcard ist pragmatisch — eine eigene `cta_text`-Spalte wäre
semantisch sauberer und wird in einem späteren Plan nachgezogen.

### Story-Setup-Änderung bei vorhandenen Szenen

Wenn der User Titel/Format/visualStyle ändert NACHDEM Szenen
generiert wurden: nur Story-Metadata-PATCH, **kein Auto-Re-Generate**.
Hint-Text unter dem Setup: "Änderungen wirken sich erst beim nächsten
'Mit KI aufteilen' auf die Szenen aus." Verhindert versehentliche
destruktive Re-Generates.

### Drag-and-Drop für Reihenfolge

In Plan 8b: nur [↑][↓]-Buttons (kein DnD). DnD kommt wenn
die Storyboard-Nutzung in der Praxis zeigt dass es gebraucht wird.

---

## File Map

| Datei | Aktion |
|---|---|
| `db/migrations/003_VG_stories_text_and_characters.sql` | **CREATE** — `characters` JSONB + `story_text` |
| `lib/ai/anthropic.ts` | modify — `getClient` als Export `getAnthropicClient` + Test-Hook |
| `lib/sceneflow/sonnet.ts` | **CREATE** — `generateScenesViaSonnet` (Tool-Use + Prompt-Cache + Coerce) |
| `lib/sceneflow/scenes-db.ts` | **CREATE** — Bulk-Insert + JOIN-Ownership |
| `lib/sceneflow/stories-db.ts` | modify — `updateStory` + `loadStory` |
| `lib/sceneflow/characters-db.ts` | modify — `listCharactersByIds(userId, ids[])` (Architekt: gehört semantisch hierher, nicht zu stories-db) |
| `lib/sceneflow/api-client.ts` | modify — Szenen-Fetch-Wrapper + generate + reorder |
| `lib/sceneflow/types.ts` | modify — `StoryRecord` um `characters`/`story_text` ergänzen |
| `lib/hooks/useSceneFlowScenes.ts` | **CREATE** — Client-Hook mit AbortController-Map |
| `app/api/sceneflow/stories/[id]/route.ts` | modify — PATCH hinzufügen |
| `app/api/sceneflow/stories/[id]/scenes/route.ts` | **CREATE** — GET/POST |
| `app/api/sceneflow/stories/[id]/scenes/reorder/route.ts` | **CREATE** — POST swap |
| `app/api/sceneflow/stories/[id]/generate-scenes/route.ts` | **CREATE** |
| `app/api/sceneflow/scenes/[sceneId]/route.ts` | **CREATE** — PATCH/DELETE |
| `components/SceneFlow/SceneFlowShell.tsx` | modify — activeStoryId State |
| `components/SceneFlow/StoryList.tsx` | modify — onSelect Handler |
| `components/SceneFlow/StoryDetailView.tsx` | **CREATE** — Shell für Detail |
| `components/SceneFlow/StorySetupForm.tsx` | **CREATE** — Titel/Format/Stil/Chars |
| `components/SceneFlow/StoryTextInput.tsx` | **CREATE** — Textarea + `@`-Validate + Button |
| `components/SceneFlow/Storyboard.tsx` | **CREATE** — Szenen-Liste |
| `components/SceneFlow/SceneCard.tsx` | **CREATE** — eine Karte (Variante für `endcard`) |
| `components/SceneFlow/EndcardEditor.tsx` | **CREATE** — vereinfachter Endcard-Editor |
| `components/SceneFlow/CameraControlSliders.tsx` | **CREATE** |
| `docs/KNOWN_LIMITATIONS.md` | modify — Plan 8b Eintrag |
| `tests/unit/sceneflow/scenes-db.test.ts` | **CREATE** (≥ 6) |
| `tests/unit/sceneflow/sonnet.test.ts` | **CREATE** (≥ 5) |
| `tests/integration/api/sceneflow-scenes.test.ts` | **CREATE** (≥ 4) |
| `tests/integration/api/generate-scenes.test.ts` | **CREATE** (≥ 3) |

**Streichungen ggü. ursprünglichem Plan-Entwurf:**
- `package.json` modify → `@anthropic-ai/sdk@^0.30.1` bereits installiert
- `.env.example` modify → `ANTHROPIC_API_KEY` steht bereits Zeile 27

CC #1 ergänzt nach Codebase-Analyse.

---

## Tests

**`tests/unit/sceneflow/scenes-db.test.ts`** — ≥ 6:
- `createScenes` bulk-insert: Parameter-Reihenfolge stimmt, gibt vollständige Records zurück
- `listScenes` sortiert nach `scene_order`, JOIN auf VG_stories scoped per user_id
- `updateScene` SET-builder, JOIN-basiertes Ownership im SQL
- `updateScene` fremd-User → `rowCount === 0` → API-Route mappt zu 404
- `deleteScenesByStory` löscht alle Szenen einer Story (Tx-Client-Variante)
- `updateScene` empty-patch → false, kein SQL

**`tests/unit/sceneflow/sonnet.test.ts`** — ≥ 5:
- Tool-Use-Response wird korrekt aus `content.find(b => b.type === 'tool_use')` extrahiert
- Sonnet ruft Tool nicht (nur Text-Response) → throws mit sprechendem Error
- `speaking_character_id`-Coerce: nicht-bekannte UUID → null + warn
- `duration` außerhalb [1,8] wird geclampt
- `camera_control` außerhalb der Ranges wird geclampt
- `scene_order` wird server-side neu durchnumeriert (Sonnet liefert Lücken)

**`tests/integration/api/sceneflow-scenes.test.ts`** — ≥ 4:
- GET 401 ohne Session
- PATCH scene — nur Owner kann patchen (JOIN-Ownership-Test)
- DELETE scene — 404 wenn fremd
- POST reorder swap-pair — Transaction macht beide Updates atomar

**`tests/integration/api/generate-scenes.test.ts`** — ≥ 3:
- POST 401 ohne Session
- POST mit Session → Sonnet gemockt → Szenen in DB + Response, Tx-Reihenfolge stimmt
- Sonnet-Mock wirft → alte Szenen bleiben (Rollback verifizieren)

Mindest: **≥ 18 neue Tests**.

---

## Verification Gate

Baseline: **754 Tests** (post-Plan-8a + Workspace-Layout-Fix).
Ziel: **≥ 772 Tests** (754 + 18).

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**

> **Architekt-Highlight für CC #2:** Der kritischste Test ist
> "Sonnet-Fehler → alte Szenen bleiben". Explizit mit DevTools Network-
> Block auf `/api/sceneflow/stories/[id]/generate-scenes` verifizieren:
> Request blocken, "Mit KI aufteilen" klicken, beobachten dass die
> bestehenden Szenen erhalten bleiben (Rollback funktioniert).

```
# Story-Kachel klicken → StoryDetailView öffnet sich
# ← Zurück → StoryList
# Titel/Format/Stil ändern → PATCH läuft (DevTools Network)
# Charakter + hinzufügen → erscheint als @-Badge
# Story-Text eingeben → "Mit KI aufteilen" wird aktiv
# Button klicken → Spinner → Storyboard erscheint mit Karten
# Karte: Image Prompt editieren → debounced PATCH (DevTools)
# Kamera-Slider bewegen → PATCH (DevTools)
# [↑][↓] → Reihenfolge ändert sich
# [×] → Szene löscht sich (nach Confirm)
# Nochmal "Mit KI aufteilen" → alte Szenen weg, neue Karten
# Endcard-Karte erscheint immer als letzte
```

---

## Commit-Struktur

```
feat(db): VG_stories.characters JSONB + story_text TEXT (migration 003)
feat(ai): export getAnthropicClient + test reset hook
feat(sceneflow): types.ts — StoryRecord.characters / story_text
feat(sceneflow): stories-db — updateStory + loadStory + listCharactersByIds
feat(sceneflow): stories PATCH API-Route
feat(sceneflow): scenes-db — bulk-insert + JOIN-Ownership + reorder swap
feat(sceneflow): scenes API routes — GET/POST/PATCH/DELETE/reorder
feat(sceneflow): sonnet client — tool-use + prompt-cache + coerce
feat(sceneflow): generate-scenes API route — Tx-rollback semantics
feat(sceneflow): client api + useSceneFlowScenes hook
feat(sceneflow): SceneFlowShell + StoryList navigation (activeStoryId)
feat(sceneflow): StoryDetailView + StorySetupForm
feat(sceneflow): StoryTextInput + Mit-KI-aufteilen flow + confirm
feat(sceneflow): CameraControlSliders
feat(sceneflow): Storyboard + SceneCard + EndcardEditor (debounced PATCH + AbortController)
docs(limitations): Plan 8b Eintrag
```

~16 Commits, eine Sache je Commit, granular und reviewbar.

---

## Out of Scope (kommt in 8c / 8d)

- fal.ai Image-Gen, Video-Gen, LipSync → Plan 8c
- TTS (Azure / ElevenLabs) → Plan 8c
- Retry-Buttons auf Szenen-Karten (disabled in 8b, aktiv in 8c)
- Endframe-Extraktion → Plan 8c
- "In VibeGrid öffnen" → Plan 8d
- Drag-and-Drop Szenen-Reihenfolge → nach Praxistest

Abgabe: `2026-05-24-vibegrid-plan-8b-story-input-sonnet-storyboard.md`
