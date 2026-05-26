# CC #1 Prompt — Schreibe Plan 8c: fal.ai Render-Pipeline

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Baseline: HEAD post-Plan-8b (**~800 Tests**, Store v6, Storyboard mit
editierbaren Szenen-Karten vorhanden, Sonnet-Aufteilung läuft).

Schreibe nur den **Plan** — noch keinen Code.

---

## Was Plan 8c leistet

Die Szenen-Karten bekommen echte KI-Generierung:

**Phase 1 — "Image + Voice Generation":**
- Alle Szenen-Bilder via FLUX.1 Dev (fal.ai)
- Alle TTS-Audios via Azure Neural TTS oder ElevenLabs
- Validierung + Warnungen vor dem Start
- Bild-Viewer mit Fullscreen + Einzelbild-Retry

**Phase 2 — "Create Full Movie":**
- Action-Szenen: Kling 2.5 Turbo Pro Image-to-Video
- Dialog-Szenen: Kling neutral portrait → sync-lipsync/v3 (3-Schritt-Pipeline)
- Async-Polling mit Fortschrittsanzeige je Szene
- Alle Ergebnisse landen in R2, URLs in DB

**Transfer to Timeline:**
- Button aktiv wenn alle Videos fertig
- Clips in VibeGrid Timeline (Beat-Snap kommt in 8d)

---

## Schritt 0 — Codebase lesen (vor Plan schreiben)

CC #1 liest und dokumentiert:

1. `lib/fal/client.ts` — bestehende Stubs, Typen, FAL_KEY-Handling
2. `lib/sceneflow/scenes-db.ts` — welche Spalten existieren?
   Gibt es `neutral_video_url`? Wenn nicht → Migration nötig
3. `lib/sceneflow/types.ts` — SceneRecord-Typ komplett lesen
4. Ob `@fal-ai/client` bereits in `package.json` steht (ja, aus 8a)
5. Bestehende TTS-Implementierung suchen — gibt es `lib/ai/tts.ts`
   oder ähnliches? Was ist bereits aus früheren Plänen vorhanden?
6. `lib/r2/` oder ähnlich — wie werden Assets heute in R2 hochgeladen?
   Presigned-Upload-Flow aus Plan 5.9b als Referenz lesen
7. `components/SceneFlow/SceneCard.tsx` — welche Buttons gibt es bereits?
   Wo sind die disabled Retry-Buttons aus Plan 8b?
8. `components/SceneFlow/Storyboard.tsx` — Bottom Bar Struktur

---

## Wichtige Architektur-Entscheidung: Dialog-Pipeline

Dialog-Szenen brauchen 3 Schritte (kein direktes Image-to-LipSync):

```
Schritt 1: Flux Dev → Charakterbild (bereits in Phase 1 erledigt)

Schritt 2: Kling 2.5 Turbo → "Neutral Portrait Video"
           Input: image_url (aus Schritt 1)
           Prompt: "person standing still, natural subtle head movement,
                    looking at camera, portrait medium shot"
           Dauer: 5s (oder Szenen-Dauer)
           Output: neutral_video_url → R2 gespeichert

Schritt 3: sync-lipsync/v3 ODER MuseTalk (je nach Dropdown-Auswahl)
           Input: neutral_video_url + audio_url (TTS aus Phase 1)
           Output: video_url → R2 gespeichert
```

Das `neutral_video_url` muss in der DB gespeichert werden damit Schritt 3
bei Fehler retried werden kann ohne Schritt 2 nochmals zu zahlen.

→ **Migration 004** fügt `neutral_video_url TEXT` zu `VG_story_scenes` hinzu.

---

## fal.ai API-Schemas (recherchiert, korrekt)

### FLUX.1 Dev — Image Generation

```typescript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/flux/dev", {
  input: {
    prompt: string,              // required
    image_size:                  // default "landscape_4_3"
      | "landscape_16_9"         // für 16:9 Stories
      | "portrait_16_9"          // für 9:16 Stories
      | "square_hd",             // für 4:3 (nächster Wert)
    num_inference_steps: 28,     // default, kann reduziert werden für Speed
    guidance_scale: 3.5,         // default
    seed?: number                // für Retry mit gleichem Seed
  },
  onQueueUpdate: (update) => { /* Fortschritt */ }
});
// Output: result.data.images[0].url → String-URL
// Kosten: $0.025 / Megapixel
```

Image-Size-Mapping (Story-Format → fal-ai image_size):

| Story-Format | fal image_size |
|---|---|
| `16:9` | `landscape_16_9` |
| `9:16` | `portrait_16_9` |
| `4:3` | `landscape_4_3` |

### Kling 2.5 Turbo Pro — Image to Video

```typescript
const result = await fal.subscribe(
  "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  {
    input: {
      prompt: string,            // required — motion_prompt aus Szene
      image_url: string,         // required — R2-URL des generierten Bilds
      duration: "5" | "10",     // default "5"
      end_image_url?: string,    // optional — letzter Frame aus vorheriger Szene
      negative_prompt?: string,
      cfg_scale?: number         // default 0.5
    }
  }
);
// Output: result.data.video.url → String-URL
```

**`end_image_url`:** Wenn Szene `start_frame_mode === 'from-previous'` hat,
wird der `end_frame_url` der Vorgänger-Szene hier übergeben.

### sync-lipsync/v3 — LipSync (Audio + Video → LipSync-Video)

```typescript
const result = await fal.subscribe("fal-ai/sync-lipsync/v3", {
  input: {
    video_url: string,           // required — neutral_video_url (Kling-Output)
    audio_url: string,           // required — TTS-MP3 aus R2
    sync_mode:                   // default "cut_off"
      | "cut_off"                // Video wird auf Audio-Länge gekürzt
      | "loop"                   // Video wird geloopt bis Audio endet
      | "remap"                  // Timing wird angepasst
  }
});
// Output: result.data.video.url → String-URL
```

**sync_mode-Empfehlung:** `"remap"` für Dialog-Szenen (natürlicheres Timing),
`"cut_off"` als Default.

### MuseTalk — Alternative LipSync

```typescript
// Queue-Pattern (nicht Realtime — Realtime ist für Browser-Live-Preview)
const { request_id } = await fal.queue.submit("fal-ai/musetalk", {
  input: {
    source_video_url: string,    // neutral_video_url
    audio_url: string            // TTS-MP3
  }
});
// Polling via fal.queue.status + fal.queue.result
// Output: result.data.video.url
```

**Wichtig:** MuseTalk hat eine Realtime-API (`fal.realtime.connect`) —
diese NICHT verwenden. Wir nutzen `fal.queue.submit` + Polling.

---

## Feature 1 — Modell-Dropdowns

### Wo

Story-Setup-Form (oben in StoryDetailView) bekommt einen
zusammenklappbaren "Modelle"-Bereich:

```
▼ Modelle (eingeklappt by default)
  Bildgenerierung:  [Flux - Dev ▼]
  Videogenerierung: [Kling 2.5 Turbo ▼]
  LipSync:          [Sync LipSync v3 ▼]
```

### Dropdown-Werte

**Image Models:**
```typescript
const IMAGE_MODELS = [
  { id: 'fal-ai/flux/dev', label: 'Flux - Dev' }
  // weitere in späteren Plänen
] as const;
```

**Video Models:**
```typescript
const VIDEO_MODELS = [
  { id: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    label: 'Kling 2.5 Turbo' }
] as const;
```

**LipSync Models:**
```typescript
const LIPSYNC_MODELS = [
  { id: 'fal-ai/sync-lipsync/v3', label: 'Sync LipSync v3' },
  { id: 'fal-ai/musetalk',        label: 'MuseTalk' }
] as const;
```

Ausgewählte Modelle werden in `VG_stories` gespeichert
(JSONB-Feld `model_config` oder drei separate Spalten —
CC #1 entscheidet nach Codebase-Analyse). Migration 004 ergänzt das.

---

## Feature 2 — Validierung + Warnungen vor Generation

Vor dem "Image + Voice Generation"-Button prüft das Frontend:

| Bedingung | Anzeige |
|---|---|
| Dialog-Szene ohne Charakter | 🔴 Rote Warnung an der Karte: "Kein Charakter zugewiesen" |
| Dialog-Szene: Charakter ohne Stimme | 🔴 "Charakter hat keine Stimme — bitte im Character Manager ergänzen" |
| Dialog-Szene ohne TTS-Text | 🟡 Gelbe Warnung: "Kein Sprechtext vorhanden" |
| Kein image_prompt vorhanden | 🟡 "Kein Bild-Prompt — Sonnet-Generierung ausführen" |

"Image + Voice Generation"-Button ist disabled wenn mindestens eine
🔴-Warnung existiert. 🟡-Warnungen blockieren nicht — User kann trotzdem
starten, bekommt aber einen Confirm-Dialog.

---

## Feature 3 — Phase 1: Image + Voice Generation

### Reihenfolge

1. TTS-Generierung aller Dialog/Voiceover-Szenen (parallel, max 3)
2. Bild-Generierung aller Szenen via Flux (parallel, max 3)
3. Alle Ergebnisse → R2-Upload → URL in DB (`audio_url`, `image_url`)

### TTS-Generierung

```typescript
// lib/sceneflow/tts.ts (server-only)
// Azure Neural TTS oder ElevenLabs je nach voice_provider des Charakters

// Azure: bestehenden Client aus lib/ai/ wiederverwenden oder neu anlegen
// ElevenLabs: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
//   Body: { text, model_id: "eleven_multilingual_v2", voice_settings: {...} }
//   Response: audio/mpeg → ArrayBuffer → R2-Upload
```

### Endframe-Extraktion nach Image-Generation

Nach erfolgreicher Bild-Generierung für Szene N:
- Das generierte Bild wird als `start_frame_url` für Szene N+1 gesetzt
  wenn Szene N+1 `start_frame_mode === 'from-previous'` hat
- Das ist ein PATCH auf `VG_story_scenes` für die Folge-Szene

### API-Route

```
POST /api/sceneflow/stories/[id]/generate-images-and-voices
Response: Server-Sent Events (SSE) mit Progress-Updates
  { type: 'scene_image_done', sceneId, imageUrl }
  { type: 'scene_audio_done', sceneId, audioUrl }
  { type: 'scene_error', sceneId, error }
  { type: 'all_done' }
```

SSE statt Polling damit der Client Live-Updates bekommt ohne
eigenen Polling-Loop implementieren zu müssen.

---

## Feature 4 — Bild-Viewer (Fullscreen / Expand)

Nach Phase 1 zeigen die Szenen-Karten das generierte Bild.
Klick auf das Bild → Fullscreen-Overlay:

```
┌─ Bild-Viewer ───────────────────────────────────────────────────┐
│                           [×]                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                           │   │
│  │          [Generiertes Bild — groß]                       │   │
│  │                                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│  Prompt: [editierbar, Textarea]                                  │
│  Seed: [1234567]  [🔒 Seed merken]                              │
│  [Neu generieren ♦15]   [Übernehmen]  [Abbrechen]              │
└──────────────────────────────────────────────────────────────────┘
```

"Neu generieren" im Viewer: sendet neuen Flux-Call nur für diese Szene.
Optional: Seed-Lock — gleicher Seed → ähnliches Bild bei anderen Prompts.

---

## Feature 5 — Phase 2: Create Full Movie

### Button-Zustand

"Create Full Movie" ist disabled bis Phase 1 für ALLE Szenen
abgeschlossen ist (kein `null` bei `image_url` für nicht-Endcard-Szenen).

### Pipeline je Szenen-Typ

**ACTION-Szene:**
```
Kling 2.5 Turbo
  image_url:     R2-URL des generierten Bilds
  prompt:        motion_prompt der Szene
  duration:      scene.duration (5 oder 10)
  end_image_url: end_frame_url der Szene (falls vorhanden)
→ video_url in DB, Status → 'done'
```

**DIALOG-Szene:**
```
Schritt A: Kling 2.5 Turbo (Neutral Portrait)
  image_url: R2-URL des generierten Bilds
  prompt: "person standing still, natural subtle movement,
           looking at camera, portrait medium shot"
  duration: scene.duration
→ neutral_video_url in DB

Schritt B: sync-lipsync/v3 ODER MuseTalk (je nach Dropdown)
  video_url: neutral_video_url
  audio_url: scene.audio_url (TTS aus Phase 1)
  sync_mode: "remap"
→ video_url in DB, Status → 'done'
```

**ENDCARD-Szene:**
```
Kein fal.ai-Call.
Status direkt → 'done', video_url bleibt null.
Wird in 8d beim Transfer als statischer Image-Clip behandelt.
```

### API-Route

```
POST /api/sceneflow/stories/[id]/generate-videos
Response: SSE
  { type: 'scene_neutral_video_done', sceneId, neutralVideoUrl }
  { type: 'scene_video_done', sceneId, videoUrl }
  { type: 'scene_error', sceneId, step, error }
  { type: 'all_done' }
```

### Fortschrittsanzeige je Karte

```
○ ausstehend  →  ⟳ generiert Bild...  →  ⟳ generiert Video...
→  ⟳ lipsync läuft...  →  ✅ fertig  ODER  ✗ Fehler [Retry]
```

---

## Feature 6 — R2-Upload aller fal.ai-Outputs

Alle URLs die fal.ai zurückgibt sind temporär (läuft nach ~1h ab).
Jedes Asset muss sofort nach Generierung in R2 gespeichert werden:

```typescript
// lib/sceneflow/fal-to-r2.ts (server-only)
async function falUrlToR2(falUrl: string, key: string): Promise<string> {
  const response = await fetch(falUrl);
  const buffer = await response.arrayBuffer();
  // R2 PUT via bestehenden Upload-Mechanismus
  return r2PublicUrl(key);
}
```

Naming-Schema für R2-Keys:
```
sceneflow/{userId}/{storyId}/{sceneId}/image.jpg
sceneflow/{userId}/{storyId}/{sceneId}/audio.mp3
sceneflow/{userId}/{storyId}/{sceneId}/neutral-video.mp4
sceneflow/{userId}/{storyId}/{sceneId}/video.mp4
```

---

## Feature 7 — "Transfer to Timeline" Button

Verfügbar wenn alle Szenen `status === 'done'`.
Aktiv wird er erst wenn mindestens eine Szene ein `video_url` hat.

In 8c: der Button ruft `POST /api/sceneflow/stories/[id]/transfer` auf.
Diese Route gibt die geordnete Liste der fertigen Clips zurück.
Die eigentliche Timeline-Integration + Beat-Snap kommt in Plan 8d.

In 8c reicht: Button erscheint, zeigt "Transfer to Timeline",
ist klickbar, wechselt zum VibeGrid-Tab — Timeline-Logik ist Stub.

---

## Migration 004

```sql
-- Zu VG_story_scenes hinzufügen:
ALTER TABLE public."VG_story_scenes"
  ADD COLUMN IF NOT EXISTS neutral_video_url TEXT,
  ADD COLUMN IF NOT EXISTS generation_step   TEXT;
  -- generation_step: 'image' | 'audio' | 'neutral_video' | 'lipsync' | 'video'
  -- für Retry-Granularität

-- Zu VG_stories hinzufügen:
ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS image_model   TEXT DEFAULT 'fal-ai/flux/dev',
  ADD COLUMN IF NOT EXISTS video_model   TEXT
    DEFAULT 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  ADD COLUMN IF NOT EXISTS lipsync_model TEXT DEFAULT 'fal-ai/sync-lipsync/v3';
```

---

## File Map

| Datei | Aktion |
|---|---|
| `db/migrations/004_VG_sceneflow_render.sql` | CREATE |
| `lib/fal/client.ts` | MODIFY — Stubs durch echte Implementierungen ersetzen |
| `lib/fal/image-gen.ts` | CREATE — Flux-Wrapper |
| `lib/fal/video-gen.ts` | CREATE — Kling-Wrapper |
| `lib/fal/lipsync.ts` | CREATE — sync-lipsync + musetalk |
| `lib/sceneflow/tts.ts` | CREATE — Azure + ElevenLabs |
| `lib/sceneflow/fal-to-r2.ts` | CREATE — fal.ai URL → R2 |
| `lib/sceneflow/scenes-db.ts` | MODIFY — neutral_video_url + generation_step |
| `lib/sceneflow/render-pipeline.ts` | CREATE — orchestriert Phase 1 + 2 |
| `app/api/sceneflow/stories/[id]/generate-images-and-voices/route.ts` | CREATE — SSE |
| `app/api/sceneflow/stories/[id]/generate-videos/route.ts` | CREATE — SSE |
| `app/api/sceneflow/stories/[id]/transfer/route.ts` | CREATE — Stub |
| `app/api/sceneflow/scenes/[sceneId]/retry-image/route.ts` | CREATE |
| `app/api/sceneflow/scenes/[sceneId]/retry-video/route.ts` | CREATE |
| `components/SceneFlow/SceneCard.tsx` | MODIFY — Retry aktiv, Progress |
| `components/SceneFlow/ImageViewer.tsx` | CREATE — Fullscreen |
| `components/SceneFlow/GenerationControls.tsx` | CREATE — Bottom Bar Buttons |
| `components/SceneFlow/ModelSelector.tsx` | CREATE — Dropdown-Gruppe |
| `components/SceneFlow/SceneWarning.tsx` | CREATE — Rot/Gelb Badges |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY |

---

## Tests

**`tests/unit/fal/image-gen.test.ts`** — ≥ 3:
- Flux-Call mit korrekten Parametern (gemockt)
- image_size-Mapping (16:9 → landscape_16_9)
- Fehler → throws mit sprechendem Message

**`tests/unit/fal/video-gen.test.ts`** — ≥ 3:
- Kling-Call mit image_url + motion_prompt
- end_image_url wird übergeben wenn from-previous
- Dialog-Szene: neutraler Prompt wird verwendet (nicht motion_prompt)

**`tests/unit/fal/lipsync.test.ts`** — ≥ 3:
- sync-lipsync: video_url + audio_url korrekt
- musetalk: source_video_url + audio_url (anderer Param-Name!)
- sync_mode "remap" als Default für Dialog

**`tests/unit/sceneflow/fal-to-r2.test.ts`** — ≥ 2:
- URL wird korrekt nach R2 übertragen
- R2-Key folgt Naming-Schema

**`tests/unit/sceneflow/render-pipeline.test.ts`** — ≥ 4:
- Action-Szene: nur Kling, kein LipSync
- Dialog-Szene: Kling neutral → lipsync
- Endcard: kein fal-Call, Status direkt done
- generation_step wird korrekt gesetzt/gelesen

Mindest: **≥ 15 neue Tests**

---

## Verification Gate

Baseline: **~800 Tests** (geschätzt nach 8b).
Ziel: **≥ 815 Tests**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**
```
# Story mit 1 Action + 1 Dialog-Szene vorbereiten
# Charakter ohne Stimme → Rote Warnung sichtbar
# Stimme im Character Manager hinzufügen → Warnung weg
# "Image + Voice Generation" klicken → Spinner, Progress-Updates
# Bilder erscheinen in Karten
# Bild anklicken → Fullscreen-Viewer öffnet
# Einzelbild retry → neues Bild ohne andere zu ändern
# "Create Full Movie" klickt → beide Szenen rendern durch
# Action: Kling-Call sichtbar in DevTools
# Dialog: erst Kling neutral, dann sync-lipsync
# Videos erscheinen in Karten (kleiner Player)
# "Transfer to Timeline" Button wird aktiv
# Klick → VibeGrid-Tab öffnet (Timeline-Integration in 8d)
# fal.ai-URLs nirgendwo in DB — nur R2-URLs
```

---

## Commit-Struktur

```
feat(db): migration 004 — neutral_video_url + model columns
feat(fal): image-gen — FLUX.1 Dev wrapper
feat(fal): video-gen — Kling 2.5 Turbo wrapper
feat(fal): lipsync — sync-lipsync/v3 + musetalk
feat(sceneflow): tts — Azure + ElevenLabs TTS generation
feat(sceneflow): fal-to-r2 — fal URL → R2 pipeline
feat(sceneflow): render-pipeline — Phase 1 + Phase 2 orchestration
feat(api): generate-images-and-voices — SSE route
feat(api): generate-videos — SSE route
feat(api): transfer stub + retry-image + retry-video routes
feat(sceneflow): ModelSelector dropdown — image/video/lipsync
feat(sceneflow): SceneWarning — red/yellow validation badges
feat(sceneflow): GenerationControls — Phase 1 + Phase 2 buttons
feat(sceneflow): ImageViewer — fullscreen + per-scene retry
feat(sceneflow): SceneCard — progress states + video player
docs(limitations): Plan 8c Eintrag
test: fal image/video/lipsync + fal-to-r2 + render-pipeline
```

---

## Out of Scope (kommt in 8d)

- Timeline-Integration: Clips auf Video-Track platzieren → Plan 8d
- Beat-Snap (Taktgenaues Einrasten) → Plan 8d
- Crossfade-Overlap auf Timeline → Plan 8d
- Endcard als statischer Image-Clip → Plan 8d
- Inpainting (Hände/Objekte korrigieren) → Plan 8e oder später

Abgabe: `2026-05-25-vibegrid-plan-8c-fal-render-pipeline.md`
