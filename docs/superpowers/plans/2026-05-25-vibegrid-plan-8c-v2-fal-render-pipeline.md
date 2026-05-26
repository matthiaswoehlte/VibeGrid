# CC #1 Prompt — Schreibe Plan 8c: fal.ai Render-Pipeline (Rev. 2)

> **Revision 2 — 2026-05-25**
> Alle 14 Punkte aus dem Architekt-Review (B1–B3, W1–W6, D1–D5) eingearbeitet.
> Markiert mit `[Fix Bx]` / `[Fix Wx]` / `[Fix Dx]`.

---

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Baseline: HEAD post-Plan-8b (**~800 Tests**, Store v6, Storyboard mit
editierbaren Szenen-Karten vorhanden, Voice-Picker geshipt `3d90ca5`).

Bereits vorhanden (vor Plan 8c implementiert):
- `lib/tts/edge.ts` — `synthesizeEdge()` funktioniert
- `lib/tts/elevenlabs.ts` — `synthesizeElevenLabs()` funktioniert
- `lib/fal/client.ts` — 64 Zeilen, Stub-Funktionen (NOT_IMPL), Typen
- `db/migrations/004_VG_characters_edge_provider_and_test_text.sql` — **existiert bereits**
- `@fal-ai/client@^1.10.1` in `package.json`

Schreibe nur den **Plan** — noch keinen Code.

---

## Was Plan 8c leistet

Die Szenen-Karten bekommen echte KI-Generierung:

**Phase 1 — "Image + Voice Generation":**
- Alle Szenen-Bilder via FLUX.1 Dev (fal.ai)
- Alle TTS-Audios via Edge TTS oder ElevenLabs
- Validierung + Warnungen vor dem Start
- Bild-Viewer mit Fullscreen + Einzelbild-Retry

**Phase 2 — "Create Full Movie":**
- Action-Szenen: Kling 2.5 Turbo Pro Image-to-Video
- Dialog-Szenen: Kling 2.5 Turbo neutral portrait → sync-lipsync/v3 (3-Schritt-Pipeline)
- Async Queue-Pattern mit Polling-basierter Fortschrittsanzeige je Szene
- Alle Ergebnisse landen in R2, URLs in DB

**Transfer to Timeline:**
- Button aktiv wenn alle Videos fertig
- Clips in VibeGrid Timeline (Beat-Snap kommt in 8d)

---

## Schritt 0 — Codebase lesen (vor Plan schreiben)

CC #1 liest und dokumentiert:

1. `lib/fal/client.ts` — bestehende Stubs, Typen exakt notieren
2. `lib/sceneflow/scenes-db.ts` — welche Spalten existieren?
   Gibt es `neutral_video_url`? `fal_request_ids`?
3. `lib/sceneflow/types.ts` — `SceneRecord`, `VoiceProvider`-Enum vollständig
4. `lib/tts/edge.ts` + `lib/tts/elevenlabs.ts` — Signaturen notieren
5. `lib/sceneflow/sonnet.ts` — SYSTEM_PROMPT-Sektion (Zeile 64+), @-Substitution
6. `lib/r2/` — bestehender Upload-Mechanismus aus Plan 5.9b
7. `components/SceneFlow/SceneCard.tsx` — existierende Buttons + Struktur
8. `components/SceneFlow/Storyboard.tsx` — Bottom Bar Struktur

---

## [Fix B1] Migration-Nummer

`004_VG_characters_edge_provider_and_test_text.sql` **existiert bereits**.
Diese Migration **nicht anfassen**.

Plan 8c-Migration heißt: **`005_VG_sceneflow_render.sql`**

---

## [Fix B2] Architektur-Entscheidung: `fal.subscribe` vs. `fal.queue`

### Hintergrund: Vercel Hobby = 60 s Function-Timeout

Generierungszeiten:
| Call | Dauer | passt in 60 s? |
|---|---|---|
| FLUX.1 Dev (Bild) | 5–15 s | ✅ |
| Azure/Edge TTS | <5 s | ✅ |
| ElevenLabs TTS | <10 s | ✅ |
| **Kling 2.5 Turbo** | **60 s – 4 min** | ❌ |
| **sync-lipsync/v3** | **30 s – 2 min** | ❌ |
| **MuseTalk** | **30 s – 3 min** | ❌ |

### Regel: wann welcher API-Stil

**`fal.subscribe()` / direkter Async-Call — nur für kurze Calls (<30 s):**
- FLUX.1 Dev Bild-Generierung
- TTS (Edge + ElevenLabs)

**`fal.queue.submit()` + Client-seitiges Polling — für alle Video-Calls:**
```typescript
// Enqueue
const { request_id } = await fal.queue.submit("fal-ai/kling-...", { input });
// Request-ID sofort in DB speichern
await updateScene(sceneId, {
  fal_request_ids: { ...existing, neutral_video: request_id }
});

// Status-Route (GET /api/sceneflow/scenes/[id]/status)
const status = await fal.queue.status("fal-ai/kling-...", { requestId });
if (status.status === "COMPLETED") {
  const result = await fal.queue.result("fal-ai/kling-...", { requestId });
  const r2Url = await falUrlToR2(result.data.video.url, r2Key);
  await updateScene(sceneId, { video_url: r2Url, status: 'done' });
}
```

### SSE vs. Polling — wo welches Pattern

**Phase 1 (Image + Voice):** SSE-Route OK. Alle Calls <30 s, parallelisierbar,
Lambda endet rechtzeitig.

**Phase 2 (Video):** Kein SSE. Queue-Submit-and-Poll-Pattern:
```
POST /api/sceneflow/stories/[id]/generate-videos
  → enqueued alle Kling/LipSync-Jobs, speichert request_ids in DB
  → Response: { enqueued: number } (schnell, <2 s)

GET /api/sceneflow/scenes/[id]/status
  → prüft fal.queue.status für alle fal_request_ids der Szene
  → wenn COMPLETED: result holen → R2-Upload → video_url setzen
  → Response: SceneStatusPayload

Client polled alle 5–10 s pro ausstehender Szene.
```

**Vorteil:** Browser-Tab kann geschlossen werden — Jobs laufen auf fal-Seite weiter.
Beim Wiederöffnen zeigt Polling sofort den aktuellen Stand.

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
           Queue: fal.queue.submit → fal_request_ids.neutral_video
           Output: neutral_video_url → R2 gespeichert

Schritt 3: sync-lipsync/v3 ODER MuseTalk (je nach Dropdown-Auswahl)
           Input: neutral_video_url + audio_url (TTS aus Phase 1)
           Queue: fal.queue.submit → fal_request_ids.lipsync
           Output: video_url → R2 gespeichert
```

Das `neutral_video_url` wird in der DB gespeichert damit Schritt 3
bei Fehler retried werden kann ohne Schritt 2 nochmals zu zahlen.

---

## [Fix W1] lib/fal/ Code-Layout: Option (c)

`client.ts` wird **ent-stubbed** — die echten fal-Calls landen direkt
in `client.ts`. Keine separaten `image-gen.ts` / `video-gen.ts` / `lipsync.ts`
in Plan 8c (vermeidet Import-Chaos + doppelte Typ-Deklarationen).

`client.ts` danach:
- Enthält Typen (`FalImageModel`, `FalVideoModel`, `FalLipSyncModel`)
- Enthält `generateImage()` — nutzt `fal.subscribe` (kurz)
- Enthält `submitVideoJob()` — nutzt `fal.queue.submit` (lang)
- Enthält `submitLipSyncJob()` — nutzt `fal.queue.submit` (lang)
- Enthält `submitMuseTalkJob()` — nutzt `fal.queue.submit` (lang)
- Enthält `getJobStatus()` / `getJobResult()` — thin wrapper um queue

Bestehende Tests gegen `client.ts` brechen nicht (Stubs werden ersetzt,
Signaturen bleiben kompatibel).

File Map ändert sich: `lib/fal/image-gen.ts`, `video-gen.ts`, `lipsync.ts`
→ **nicht erstellen**.

---

## fal.ai API-Schemas

### FLUX.1 Dev — Image Generation (fal.subscribe, kurz)

```typescript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/flux/dev", {
  input: {
    prompt: string,
    image_size:
      | "landscape_16_9"   // 16:9
      | "portrait_16_9"    // 9:16
      | "landscape_4_3",   // 4:3  [Fix W4: kein square_hd]
    num_inference_steps: 28,
    guidance_scale: 3.5,
    seed?: number
  },
  onQueueUpdate: (update) => { /* Fortschritt */ }
});
// Output: result.data.images[0].url
```

**[Fix W4] Image-Size-Mapping — finale Tabelle:**

| Story-Format | fal image_size |
|---|---|
| `16:9` | `landscape_16_9` |
| `9:16` | `portrait_16_9` |
| `4:3` | `landscape_4_3` |

`landscape_4_3` = 1024×768 = exakt 4:3. `square_hd` (1:1) wird **nicht** verwendet.

### Kling 2.5 Turbo Pro — Image to Video (fal.queue.submit, lang)

```typescript
const { request_id } = await fal.queue.submit(
  "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  {
    input: {
      prompt: string,
      image_url: string,
      duration: "5" | "10",
      end_image_url?: string,
      negative_prompt?: string,
      cfg_scale?: number
    }
  }
);
// Polling via fal.queue.status + fal.queue.result
// Output: result.data.video.url
```

### sync-lipsync/v3 (fal.queue.submit, lang)

```typescript
const { request_id } = await fal.queue.submit("fal-ai/sync-lipsync/v3", {
  input: {
    video_url: string,
    audio_url: string,
    sync_mode: "cut_off" | "loop" | "remap"
  }
});
// sync_mode "remap" als Default für Dialog-Szenen
```

### MuseTalk (fal.queue.submit, lang — anderer Param-Name!)

```typescript
const { request_id } = await fal.queue.submit("fal-ai/musetalk", {
  input: {
    source_video_url: string,   // NICHT video_url!
    audio_url: string
  }
});
// Output: result.data.video.url
```

---

## Feature 1 — Modell-Dropdowns

Story-Setup-Form bekommt zusammenklappbaren "Modelle"-Bereich:

```
▼ Modelle (eingeklappt by default)
  Bildgenerierung:  [Flux - Dev ▼]
  Videogenerierung: [Kling 2.5 Turbo ▼]
  LipSync:          [Sync LipSync v3 ▼]
```

```typescript
const IMAGE_MODELS = [
  { id: 'fal-ai/flux/dev', label: 'Flux - Dev' }
] as const;

const VIDEO_MODELS = [
  { id: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    label: 'Kling 2.5 Turbo' }
] as const;

const LIPSYNC_MODELS = [
  { id: 'fal-ai/sync-lipsync/v3', label: 'Sync LipSync v3' },
  { id: 'fal-ai/musetalk',        label: 'MuseTalk' }
] as const;
```

Gespeichert in `VG_stories` via Migration 005 (drei separate Spalten).
Dropdown muss tolerant gegen unbekannte model-IDs sein (falls Modell
ausgemustert wird — einfach Default-Wert anzeigen, kein Crash).

---

## Feature 2 — Validierung + Warnungen vor Generation

**[Fix W5]** Vollständige Check-Liste vor "Image + Voice Generation":

| Bedingung | Anzeige |
|---|---|
| Dialog-Szene ohne `speaking_character_id` | 🔴 "Kein Charakter zugewiesen" |
| `speaking_character_id` nicht in `story.characters[]` | 🔴 "Sprechender Charakter nicht mehr in Story — bitte ersetzen" |
| Dialog-Szene: Charakter ohne `voice_id` | 🔴 "Charakter hat keine Stimme — bitte im Character Manager ergänzen" |
| Dialog-Szene ohne `tts_text` | 🟡 "Kein Sprechtext vorhanden" |
| Szene ohne `image_prompt` | 🟡 "Kein Bild-Prompt — Sonnet-Generierung ausführen" |

🔴 = Button disabled. 🟡 = Confirm-Dialog, User kann trotzdem starten.

---

## [Fix D1] @-Substitution (Hinweis für Implementierung)

`image_prompt` enthält bereits **aufgelöste** Charakter-Beschreibungen —
Sonnet ersetzt `@Magdalena` in Phase 2 (Szenen-Aufteilung) durch die
vollständige Personenbeschreibung aus dem Character Manager. FLUX.1 Dev
bekommt den String 1:1, sieht keine @-Token. CC #1 muss hierfür
**nichts implementieren** — nur nicht kaputtmachen.

---

## Feature 3 — Phase 1: Image + Voice Generation

### Reihenfolge

1. TTS-Generierung aller Dialog/Voiceover-Szenen (parallel, max 3)
2. Bild-Generierung aller Szenen via Flux (parallel, max 3)
3. Alle Ergebnisse → R2-Upload → URL in DB (`audio_url`, `image_url`)

### [Fix B3] TTS-Generierung — Edge + ElevenLabs

**Kein neues Azure-Backend.** Re-use der gestern fertiggestellten Module.

```typescript
// lib/sceneflow/tts.ts (server-only, ~20 LOC Dispatcher)
import { synthesizeEdge } from '@/lib/tts/edge';
import { synthesizeElevenLabs } from '@/lib/tts/elevenlabs';

export async function synthesizeForCharacter(
  character: CharacterRecord,
  text: string
): Promise<Buffer> {
  switch (character.voice_provider) {
    case 'edge':
      return synthesizeEdge({ voiceId: character.voice_id, text });
    case 'elevenlabs':
      return synthesizeElevenLabs({ voiceId: character.voice_id, text });
    case 'azure':
      throw new Error(
        'Azure TTS nicht implementiert — bitte voice_provider auf edge oder elevenlabs setzen'
      );
    default:
      throw new Error(`Unbekannter voice_provider: ${character.voice_provider}`);
  }
}
```

### [Fix D2] Voice-Resolution-Chain für Dialog/Voiceover-Szenen

Für jede Szene mit `audio_type === 'lipsync'` oder `'voiceover'`:

1. `scene.speaking_character_id` → DB-Lookup → `CharacterRecord`
2. Validierung: `character.voice_provider` muss `'edge'` oder `'elevenlabs'` sein
3. Validierung: `character.voice_id` darf nicht `null` sein → sonst 🔴
4. `synthesizeForCharacter(character, scene.tts_text)` → `Buffer`
5. R2-Upload unter `sceneflow/{userId}/{storyId}/{sceneId}/audio.mp3`
6. `audio_url` in DB setzen

Edge-Cases:
- `voice_provider === 'azure'` → Fehler-State an Karte, sprechendes Log, kein Crash
- `voice_id === null` → wird durch Validierung (Feature 2) blockiert
- `tts_text === null || ''` → wird durch Validierung (🟡) abgefangen

### [Fix W6] fal_request_ids Schema

`SceneRecord.fal_request_ids` (existiert seit 8a als `Record<string,string>|null`).

Plan 8c legt folgendes Key-Schema fest:

```typescript
type FalRequestIds = {
  image?:         string;   // FLUX.1 Dev request_id (nicht queue, aber für Retry)
  audio?:         string;   // TTS hat kein request_id, Feld reserviert
  neutral_video?: string;   // Kling neutral portrait request_id
  lipsync?:       string;   // sync-lipsync oder MuseTalk request_id
};
```

Alle Routes lesen/schreiben dieses Schema. Merge statt Überschreiben:
```typescript
await updateScene(sceneId, {
  fal_request_ids: { ...scene.fal_request_ids, neutral_video: request_id }
});
```

### Bild-Generierung

```typescript
const result = await fal.subscribe("fal-ai/flux/dev", {
  input: {
    prompt: scene.image_prompt,
    image_size: storyFormatToImageSize(story.format),
    num_inference_steps: 28,
    guidance_scale: 3.5
  }
});
const r2Url = await falUrlToR2(result.data.images[0].url, imageKey);
await updateScene(scene.id, { image_url: r2Url, status: 'image_done' });
```

Optional: Seed-Lock — gleicher Seed bei Retry.

---

## Feature 4 — Bild-Viewer + Einzelbild-Retry

Klick auf generiertes Bild → Fullscreen-Overlay.
Retry-Button pro Karte: sendet `POST /api/sceneflow/scenes/[id]/retry-image`.

---

## [Fix W3] cameraControl in v0.1: motion_prompt-Mapping via Sonnet

`cameraControl`-Felder (`zoom`, `panX`, `panY`, `motionIntensity`) existieren in der DB
und werden im Szenen-Inspector als Slider angezeigt. **Kling 2.5 Turbo hat keine
entsprechenden API-Parameter** — die Werte gehen nicht direkt an fal.ai.

**v0.1-Semantik: Sonnet baut `motion_prompt` aus `cameraControl`-Werten.**

`lib/sceneflow/sonnet.ts` SYSTEM_PROMPT erhält folgenden Zusatz:

```
Wenn cameraControl-Werte vorhanden sind, leite daraus den motion_prompt ab:
  zoom > 0 → "dolly forward / push-in"
  zoom < 0 → "zoom out / pull-back"
  panX > 0 → "pan right"
  panX < 0 → "pan left"
  panY > 0 → "tilt up"
  panY < 0 → "tilt down"
  motionIntensity 1–3 → "slow, subtle movement"
  motionIntensity 7–10 → "fast, dynamic movement"
Kombiniere mehrere Werte in einem Satz. motion_prompt überschreibt
cameraControl-Semantik — bei Konflikt gewinnt motion_prompt.
```

Wenn User Slider ändert → `motion_prompt` wird im Textarea neu vorgeschlagen
(nicht auto-überschrieben, nur als Vorschlag — User bestätigt).

Direkter fal.ai Video-Call übergibt nur `prompt: scene.motion_prompt`.

---

## Feature 5 — Phase 2: Create Full Movie

### Button-Zustand

"Create Full Movie" disabled bis Phase 1 für ALLE Nicht-Endcard-Szenen
abgeschlossen ist (kein `null` bei `image_url`).

### Pipeline je Szenen-Typ

**ACTION-Szene:**
```
fal.queue.submit(Kling 2.5 Turbo)
  image_url:     R2-URL des generierten Bilds
  prompt:        motion_prompt der Szene
  duration:      scene.duration ("5" oder "10")
  end_image_url: end_frame_url der Szene (falls start_frame_mode === 'from-previous')
→ request_id → fal_request_ids.neutral_video (Kling-Step)
→ Client polled /api/sceneflow/scenes/[id]/status
→ Bei COMPLETED: R2-Upload → video_url setzen → status 'done'
```

**DIALOG-Szene:**
```
Schritt A: fal.queue.submit(Kling 2.5 Turbo — Neutral Portrait)
  image_url: R2-URL des generierten Bilds
  prompt: "person standing still, natural subtle head movement,
           looking at camera, portrait medium shot"
  duration: scene.duration
→ fal_request_ids.neutral_video
→ Bei COMPLETED: R2-Upload → neutral_video_url setzen

Schritt B (startet nach Schritt A): fal.queue.submit(sync-lipsync/v3 ODER MuseTalk)
  video_url / source_video_url: neutral_video_url
  audio_url: scene.audio_url
  sync_mode: "remap" (sync-lipsync) — kein Parameter bei MuseTalk
→ fal_request_ids.lipsync
→ Bei COMPLETED: R2-Upload → video_url setzen → status 'done'
```

**[Fix D3] ENDCARD-Szene:**
```
Kein fal.ai-Call.
image_url = null, video_url = null — beide bleiben null.
Status direkt → 'done'.
SceneCard rendert für Endcard-Szenen einen "CTA-Editor"-Placeholder-Slot
(voller Inhalt kommt in Plan 8d).
Wird in 8d beim Transfer als statischer Image-Clip mit Text-Overlay behandelt.
```

### API-Routen Phase 2

```
POST /api/sceneflow/stories/[id]/generate-videos
  → Alle Kling/LipSync-Jobs enqueued, request_ids in DB
  → Response: { enqueued: number }  (schnell, kein SSE)

GET /api/sceneflow/scenes/[id]/status
  → prüft fal.queue.status für fal_request_ids der Szene
  → wenn COMPLETED: result holen → R2-Upload → URL setzen
  → Response: { sceneId, status, videoUrl?, neutralVideoUrl?, step }
```

Client polled alle 5–10 s. Alle aktiven Szenen in einem setInterval.

### Fortschrittsanzeige je Karte

```
○ ausstehend  →  ⟳ generiert Bild...  →  ⟳ Video wird verarbeitet...
→  ⟳ lipsync läuft...  →  ✅ fertig  ODER  ✗ Fehler [Retry]
```

---

## Feature 6 — R2-Upload aller fal.ai-Outputs

```typescript
// lib/sceneflow/fal-to-r2.ts (server-only)
async function falUrlToR2(falUrl: string, key: string): Promise<string> {
  const response = await fetch(falUrl);
  const buffer = await response.arrayBuffer();
  // R2 PUT via bestehenden Upload-Mechanismus (Plan 5.9b Referenz)
  return r2PublicUrl(key);
}
```

R2-Key-Schema:
```
sceneflow/{userId}/{storyId}/{sceneId}/image.jpg
sceneflow/{userId}/{storyId}/{sceneId}/audio.mp3
sceneflow/{userId}/{storyId}/{sceneId}/neutral-video.mp4
sceneflow/{userId}/{storyId}/{sceneId}/video.mp4
```

fal.ai-URLs sind temporär (~1h Ablauf) — **jedes Asset sofort nach
Generierung in R2 sichern**. Niemals fal-URLs in DB speichern.

---

## [Fix D5] Retry-Semantik

### `POST /api/sceneflow/scenes/[sceneId]/retry-image`

1. Setzt `image_url = null`, `status = 'pending'`
2. Löscht `fal_request_ids.image` (falls gesetzt)
3. Startet FLUX-Call neu (fal.subscribe)
4. Überschreibt altes Bild mit neuem R2-Key (kein Append)
5. `neutral_video_url`, `video_url` **bleiben erhalten** — nur Image wird neu gemacht

### `POST /api/sceneflow/scenes/[sceneId]/retry-video`

Zwei Varianten je nach vorhandenem State:

**Wenn `neutral_video_url` vorhanden (Dialog):**
- Nur Schritt 3 (LipSync) wird neu gestartet
- `video_url = null`, `fal_request_ids.lipsync = null`
- `neutral_video_url` bleibt — kein zweiter Kling-Call, keine Kosten

**Wenn `neutral_video_url === null` (Action oder Dialog ohne neutral):**
- Ab Schritt 2 (Kling) neu starten
- `video_url = null`, `neutral_video_url = null`
- `fal_request_ids.neutral_video = null`, `fal_request_ids.lipsync = null`

**Bei jedem Retry:** `fal_request_ids` wird partiell gelöscht (nur
die betroffenen Steps), nicht komplett geleert.

---

## Feature 7 — "Transfer to Timeline" Button

Erscheint wenn alle Szenen `status === 'done'`.
Aktiv wenn mindestens eine Szene ein `video_url` hat.

In 8c: ruft `POST /api/sceneflow/stories/[id]/transfer` auf.
Diese Route gibt die geordnete Liste der fertigen Clips zurück.
Button wechselt zum VibeGrid-Tab — Timeline-Integration + Beat-Snap in Plan 8d.

---

## Migration 005 [Fix B1]

```sql
-- Filename: db/migrations/005_VG_sceneflow_render.sql
-- 004_VG_characters_edge_provider_and_test_text.sql existiert bereits — NICHT anfassen

-- Zu VG_story_scenes hinzufügen:
ALTER TABLE public."VG_story_scenes"
  ADD COLUMN IF NOT EXISTS neutral_video_url TEXT;
  -- generation_step-Spalte entfällt [Fix W2] — URL-derived state reicht

-- Zu VG_stories hinzufügen:
ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS image_model   TEXT
    DEFAULT 'fal-ai/flux/dev',
  ADD COLUMN IF NOT EXISTS video_model   TEXT
    DEFAULT 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  ADD COLUMN IF NOT EXISTS lipsync_model TEXT
    DEFAULT 'fal-ai/sync-lipsync/v3';
```

**[Fix W2] `generation_step` Spalte entfällt.** Stattdessen:

```typescript
// lib/sceneflow/scene-state.ts (CREATE)
type GenerationStep = 'image' | 'audio' | 'neutral_video' | 'lipsync' | 'done';

function computeNextGenerationStep(scene: SceneRecord): GenerationStep | 'done' {
  if (!scene.image_url) return 'image';
  if (!scene.audio_url && scene.audio_type !== 'none') return 'audio';
  if (!scene.neutral_video_url && scene.type === 'dialog') return 'neutral_video';
  if (!scene.video_url && scene.type !== 'endcard') return 'lipsync';
  return 'done';
}
```

---

## File Map

| Datei | Aktion |
|---|---|
| `db/migrations/005_VG_sceneflow_render.sql` | CREATE [Fix B1] |
| `lib/fal/client.ts` | MODIFY — Stubs ent-stubbed, queue-Methoden [Fix W1] |
| `lib/sceneflow/tts.ts` | CREATE — dünner Dispatcher Edge/ElevenLabs [Fix B3] |
| `lib/sceneflow/fal-to-r2.ts` | CREATE — fal.ai URL → R2 |
| `lib/sceneflow/scene-state.ts` | CREATE — `computeNextGenerationStep` [Fix W2] |
| `lib/sceneflow/render-pipeline.ts` | CREATE — orchestriert Phase 1 + 2 |
| `lib/sceneflow/scenes-db.ts` | MODIFY — neutral_video_url |
| `lib/sceneflow/sonnet.ts` | MODIFY — cameraControl→motion_prompt Mapping [Fix W3] |
| `app/api/sceneflow/stories/[id]/generate-images-and-voices/route.ts` | CREATE — SSE Phase 1 |
| `app/api/sceneflow/stories/[id]/generate-videos/route.ts` | CREATE — Queue-Enqueue [Fix B2] |
| `app/api/sceneflow/scenes/[id]/status/route.ts` | CREATE — Polling-Endpoint [Fix B2] |
| `app/api/sceneflow/stories/[id]/transfer/route.ts` | CREATE — Stub |
| `app/api/sceneflow/scenes/[sceneId]/retry-image/route.ts` | CREATE [Fix D5] |
| `app/api/sceneflow/scenes/[sceneId]/retry-video/route.ts` | CREATE [Fix D5] |
| `components/SceneFlow/SceneCard.tsx` | MODIFY — Progress + Video-Player |
| `components/SceneFlow/ImageViewer.tsx` | CREATE — Fullscreen |
| `components/SceneFlow/GenerationControls.tsx` | CREATE — Bottom Bar Buttons |
| `components/SceneFlow/ModelSelector.tsx` | CREATE — Dropdown-Gruppe |
| `components/SceneFlow/SceneWarning.tsx` | CREATE — Rot/Gelb Badges [Fix W5] |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY [Fix D4] |

**Nicht erstellen:** `lib/fal/image-gen.ts`, `lib/fal/video-gen.ts`,
`lib/fal/lipsync.ts` [Fix W1]

---

## Tests

**`tests/unit/fal/client.test.ts`** — ≥ 5:
- `generateImage()`: FLUX-Call mit korrekten Parametern (gemockt)
- `image_size`-Mapping: `16:9 → landscape_16_9`, `4:3 → landscape_4_3` [Fix W4]
- `submitVideoJob()`: nutzt `fal.queue.submit` (nicht `fal.subscribe`)
- `submitLipSyncJob()`: sync-lipsync vs. MuseTalk (unterschiedliche Param-Namen)
- Fehler → throws mit sprechendem Message

**`tests/unit/sceneflow/tts.test.ts`** — ≥ 3: [Fix B3]
- `voice_provider === 'edge'` → `synthesizeEdge` wird aufgerufen
- `voice_provider === 'elevenlabs'` → `synthesizeElevenLabs` wird aufgerufen
- `voice_provider === 'azure'` → throws mit Klartextfehler (kein Crash)

**`tests/unit/sceneflow/scene-state.test.ts`** — ≥ 4: [Fix W2]
- `image_url === null` → Step `'image'`
- `audio_url === null && audio_type !== 'none'` → Step `'audio'`
- `neutral_video_url === null && type === 'dialog'` → Step `'neutral_video'`
- alle URLs gesetzt → `'done'`

**`tests/unit/sceneflow/fal-to-r2.test.ts`** — ≥ 2:
- URL wird korrekt nach R2 übertragen
- R2-Key folgt Naming-Schema

**`tests/unit/sceneflow/render-pipeline.test.ts`** — ≥ 5:
- Action-Szene: Kling-Job enqueued, kein LipSync-Submit
- Dialog-Szene: Kling neutral + LipSync in Sequenz
- Endcard: kein fal-Call, Status direkt done [Fix D3]
- Retry-image: nur FLUX neu, neutral_video_url bleibt
- Retry-video mit vorhandener neutral_video_url: nur LipSync, kein Kling [Fix D5]

**`tests/unit/sceneflow/validation.test.ts`** — ≥ 3: [Fix W5]
- speaking_character_id nicht in story.characters → 🔴
- voice_id null → 🔴
- image_prompt null → 🟡

Mindest: **≥ 22 neue Tests**

---

## [Fix D4] KNOWN_LIMITATIONS.md — neue Einträge Plan 8c

```markdown
### Plan 8c — fal.ai Render-Pipeline

**fal.ai-Kosten:**
Pro Szene (Bild + Video) ca. $1.00–1.50. Bei 20 Szenen (max. "Mit KI aufteilen")
können $20–30 pro Render entstehen. Kein Hard-Cap — User trägt volle Kosten.

**Kling-Modell-Verfügbarkeit:**
Modell-IDs können von fal.ai ausgemustert werden. Modell-Dropdown ist tolerant
gegen unbekannte IDs (Default wird genutzt, kein Crash).

**Async Video-Generation (Vercel Hobby):**
Kling und LipSync laufen als Queue-Jobs auf fal-Seite. Browser-Tab kann während
der Generierung geschlossen werden. Status erscheint beim nächsten Öffnen über
den Polling-Endpoint. Vercel Function-Timeout trifft diese Calls nicht mehr.

**R2-Speicher:**
fal.ai MP4-Outputs sind 5–20 MB pro Clip. Bei vielen Stories summiert sich
der R2-Speicher spürbar. Cloudflare-Kosten steigen mit Datenmenge.

**Migration 005 Defaults:**
Bestehende `VG_stories`-Rows erhalten via DEFAULT-Werte die neuen Modell-Spalten.
Smoke-Test: alte Story laden, Plan-8c-UI bedienen, kein Crash.
```

---

## Verification Gate

Baseline: **~800 Tests**.
Ziel: **≥ 822 Tests**.

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
# speaking_character_id nicht in story.characters → Rote Warnung [Fix W5]
# Stimme im Character Manager hinzufügen → Warnung weg
# "Image + Voice Generation" klicken → SSE-Stream, Progress-Updates
# Bilder erscheinen in Karten
# Bild anklicken → Fullscreen-Viewer öffnet
# Einzelbild-Retry → neues Bild, neutral_video_url bleibt erhalten [Fix D5]
# "Create Full Movie" → Queue-Jobs submitted, Response schnell
# Client polled /api/sceneflow/scenes/[id]/status alle 5 s
# Action-Karte: Kling-Job in DevTools → queue.submit sichtbar
# Dialog-Karte: erst Kling neutral, dann sync-lipsync (sequenziell)
# Tab schließen und wieder öffnen → Status korrekt aufgegriffen (Polling)
# Videos erscheinen in Karten (kleiner Player)
# "Transfer to Timeline" Button wird aktiv
# Klick → VibeGrid-Tab öffnet (Timeline-Integration in 8d)
# Kein fal.ai-URL in DB — nur R2-URLs (DevTools → Network prüfen)
```

---

## Commit-Struktur

```
feat(db): migration 005 — neutral_video_url + model columns
feat(fal): client — ent-stubbed: generateImage + queue-Methoden
feat(sceneflow): tts — Edge/ElevenLabs dispatcher
feat(sceneflow): fal-to-r2 — fal URL → R2 pipeline
feat(sceneflow): scene-state — computeNextGenerationStep
feat(sceneflow): render-pipeline — Phase 1 + Phase 2 orchestration
feat(sceneflow): sonnet — cameraControl→motion_prompt mapping
feat(api): generate-images-and-voices — SSE route Phase 1
feat(api): generate-videos — queue-enqueue route Phase 2
feat(api): scenes-status — polling endpoint
feat(api): transfer stub + retry-image + retry-video routes
feat(sceneflow): ModelSelector dropdown
feat(sceneflow): SceneWarning — red/yellow validation badges
feat(sceneflow): GenerationControls — Phase 1 + Phase 2 buttons
feat(sceneflow): ImageViewer — fullscreen + per-scene retry
feat(sceneflow): SceneCard — progress states + video player
docs(limitations): Plan 8c Einträge
test: fal client + tts + scene-state + fal-to-r2 + render-pipeline + validation
```

---

## Out of Scope (kommt in 8d)

- Timeline-Integration: Clips auf Video-Track platzieren
- Beat-Snap (Taktgenaues Einrasten)
- Crossfade-Overlap auf Timeline
- Endcard als statischer Image-Clip (CTA-Editor)
- Inpainting (Hände/Objekte korrigieren) → Plan 8e

---

Abgabe: `2026-05-25-vibegrid-plan-8c-v2-fal-render-pipeline.md`
