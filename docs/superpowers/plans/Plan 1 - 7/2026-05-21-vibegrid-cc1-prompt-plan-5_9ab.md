# Architekt-Antwort — Plan 5.9 Pre-Review + Plan-Split 5.9a / 5.9b

---

## Blocker-Entscheidungen

### B1 — Flat Clips bleiben ✅

Nested `clips: Clip[]` im Track-Interface war mein Fehler im Prompt.
**Flat bleibt.** `TimelineState.clips: Clip[]` wird nicht angefasst.

Korrektes Track-Interface:
```ts
export interface Track {
  id: string;
  kind: TrackKind;
  label: string;
  muted: boolean;
  // KEIN clips-Feld — Clips bleiben in TimelineState.clips (flat)
}
```

`Track.order: number` (N5) wird durch **Array-Index ersetzt** — die
Reihenfolge der `tracks[]`-Array ist die Render-Reihenfolge. Kein
separates `order`-Feld nötig.

---

### B2 — Migration v4→v5 bleibt einfach ✅

Da Clips flat bleiben, ist die Migration:
```ts
if (version < 5) {
  // tracks-Array war fix — wird dynamisch, aber gleiche Struktur
  // Fehlende neue Track-Einträge ergänzen (wie bisherige Migrationen)
  // KEINE Datenstruktur-Konversion
}
```

Migrations-Test mit einem echten v4-State-Snapshot.

---

### B3 — `getVideoElement` in RendererDeps, nicht RC ✅

CC #1 hat recht. Plugins bekommen keinen Zugriff auf Video-Elemente.
`getVideoElement` kommt in `RendererDeps` (loop.ts), **nicht** in
`RenderContext`. Bestehende Plugin-Tests sind unberührt.

---

### B4 — Neuer Selector `activeClipOnTrack` ✅

```ts
// lib/timeline/selectors.ts — neue pure Funktion:
export function activeClipOnTrack(
  trackId: string,
  clips: Clip[],
  beat: number
): Clip | undefined {
  return clips.find(c =>
    c.trackId === trackId &&
    beat >= c.startBeat &&
    beat < c.startBeat + c.lengthBeats
  );
}
```

Tests: ≥ 3 (trifft aktiven Clip, gibt undefined außerhalb, ignoriert
anderen Track). In Plan 5.9a als Task.

---

### B5 — Mehrere Tracks pro Kind + RENDER_ORDER ✅

`RENDER_ORDER: FxKind[]` bestimmt **Art-Reihenfolge** (z.B. alle
Dissolve-Tracks vor allen Sunray-Tracks). Innerhalb einer Kind-Gruppe
gilt **Track-Array-Reihenfolge**:

```ts
// loop.ts — Render-Logik:
for (const kind of RENDER_ORDER) {
  const tracksOfKind = tracks.filter(t => t.kind === kind && !t.muted);
  for (const track of tracksOfKind) {
    // render active clip on track
  }
}
```

Deterministisch, klar, kein Sonderfall.

---

## Mittlere Punkte

### M1 — Multi-Audio: Stub, nicht aktiv ✅

`'audio'` bleibt als `TrackKind` im Type-System (für spätere
Erweiterung), aber **funktionell nicht angeschlossen** in 5.9.

Explicit in Plan 5.9a: *"AudioTrack-Kind existiert im Typ, aber
`addTrack('audio')` zeigt Toast 'Multi-Audio-Tracks kommen in v0.2'
und erzeugt keinen Track."* Keine Erwartungslücke.

---

### M2 — Live-Preview-Sync explizit definiert ✅

Das Sync-Modell für `useVideoEngine`:

```ts
// useVideoEngine.ts subscribes:
useAppStore.subscribe((state, prev) => {
  const engine = videoEngineRef.current;
  if (!engine) return;

  // Play/Pause
  if (state.ui.isPlaying !== prev.ui.isPlaying) {
    state.ui.isPlaying ? engine.play() : engine.pause();
  }

  // Seek (Playhead bewegt sich ohne Playback)
  if (!state.ui.isPlaying &&
      state.timeline.playheadBeat !== prev.timeline.playheadBeat) {
    const timeSec = beatToSec(state.timeline.playheadBeat, state.timeline.bpm);
    engine.seekAllTo(timeSec);
  }
});
```

RAF-Loop zeichnet dann was auch immer das Video-Element gerade zeigt.
CC #1 muss das in Task "VideoEngine Sync" explizit implementieren.

---

### M3 — Lazy Video Loading ✅

**Nur aktive Videos laden** — nicht alle beim Mount.

```ts
// useVideoEngine: watched mediaRefs die in aktiven Clips referenziert sind
const activeVideoMediaIds = useAppStore(s =>
  s.timeline.clips
    .filter(c => c.mediaKind === 'video')
    .map(c => c.mediaId)
    .filter((id, i, arr) => arr.indexOf(id) === i) // dedup
);
// Für jede neue ID: engine.load(id, url)
// Für entfernte IDs: engine.unload(id)
```

Spart 50-300 MB RAM pro nicht-genutztem Video.

---

### M4 — MOV gestrichen ✅

Nur `video/mp4` und `video/webm`. MOV wird mit
`toast.error('Nur MP4 und WebM werden unterstützt')` abgelehnt.

---

### M5 — Video-Overlap ✅

Gleiche Regel wie Image-Clips: kein Overlap. `addClip`-Operation hat
den Overlap-Check bereits. Kein neuer Code nötig.

---

### M6 — Bundle ✅

`@aws-sdk/s3-request-presigner` ist nur in der API-Route (server-side,
dynamic import). Landet nicht im Client-Bundle. Build-Check verifiziert.

---

## Doku-Punkte

### N1 — R2_ENDPOINT in .env.example ✅
```
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```
In `.env.example` ergänzen. Plan erwähnt es explizit.

### N2 — MockVideoElement in vitest.setup.ts ✅
```ts
class MockVideoElement {
  currentTime = 0;
  duration = 0;
  muted = true;
  playsInline = true;
  src = '';
  preload = '';
  onloadeddata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play() { return Promise.resolve(); }
  pause() {}
  load() { setTimeout(() => this.onloadeddata?.(), 0); }
  addEventListener(event: string, cb: () => void, opts?: unknown) {
    if (event === 'seeked') setTimeout(cb, 0);
  }
  removeEventListener() {}
}
// document.createElement('video') mocken:
vi.spyOn(document, 'createElement').mockImplementation((tag) => {
  if (tag === 'video') return new MockVideoElement() as unknown as HTMLVideoElement;
  return originalCreateElement(tag);
});
```

### N3 — Auto-Preset ignoriert Video-Tracks ✅
Explicit in KNOWN_LIMITATIONS: *"Auto-Preset schlägt keine Video-Clips
vor. Funktioniert nur für FX-Plugins auf bestehenden Clips."*

### N4 — Reorder-UI: Out of Scope für 5.9 ✅
Store-Action `reorderTracks` ist drin (für spätere Nutzung), aber
kein Drag-Drop-UI in 5.9. Explicit im Out-of-Scope.

### N5 — Track.order ersetzt durch Array-Index ✅
Bereits in B1 adressiert.

---

## Plan-Split: 5.9a + 5.9b

CC #1's Empfehlung ist richtig.

---

# CC #1 Prompt — Schreibe Plan 5.9a: Dynamic Multi-Track

## Kontext

Plan 5.8a abgeschlossen. Baseline: aktueller HEAD, alle Gates grün.

Schreibe nur den Plan — noch keinen Code.

---

## Was 5.9a leistet

Rein strukturell: `timeline.tracks[]` wird dynamisch. Keine neuen
Medientypen. Keine VideoEngine. Nur Track-Management.

---

## Task 0 — Baseline

```powershell
npm test -- --run && npm run typecheck && npm run build
```
Zahlen notieren.

---

## Task 1 — Track-Interface + TrackKind

```ts
// lib/timeline/types.ts

export type TrackKind =
  | 'image' | 'audio'               // Medien (audio = Stub, nicht aktiv)
  | 'contour' | 'sweep' | 'pulse'
  | 'zoom-pulse' | 'particles'
  | 'text' | 'dissolve' | 'sunray'  // aus 5.8a
  | 'video';                         // neu, für 5.9b vorbereitet

export interface Track {
  id: string;
  kind: TrackKind;
  label: string;
  muted: boolean;
  // KEIN clips-Feld — clips bleiben in TimelineState.clips (flat)
}
```

`Track.order: number` entfällt — Array-Index ist die Reihenfolge.

---

## Task 2 — Store-Migration v4→v5

Im bestehenden migrate-Hook:
```ts
if (version < 5) {
  // tracks-Array war fix — jeder Track bekommt eine stabile string-id
  // falls noch keine vorhanden. Struktur (kind, label, muted) bleibt.
  // Neue 'video'-Track-Zeile ergänzen.
  // KEINE Datenstruktur-Konversion (clips bleiben flat).
}
```

Migrations-Test mit echtem v4-State-Snapshot (Snapshot in der
Testdatei als JSON-Literal).

---

## Task 3 — Neue Store-Actions

```ts
addTrack(kind: TrackKind): void
// Exception: addTrack('audio') → toast.error('Multi-Audio-Tracks kommen in v0.2')

removeTrack(trackId: string): void
// Guard: wenn clips.filter(c => c.trackId === trackId).length > 0
//   → toast.error('Track enthält Clips — erst leeren')

reorderTracks(orderedIds: string[]): void
// Sortiert tracks[] nach der gegebenen ID-Reihenfolge
```

---

## Task 4 — Neuer Selector + RENDER_ORDER

```ts
// lib/timeline/selectors.ts — neue pure Funktion:
export function activeClipOnTrack(
  trackId: string,
  clips: Clip[],
  beat: number
): Clip | undefined

// lib/renderer/loop.ts — RENDER_ORDER-Logik:
// Kind-Reihenfolge aus RENDER_ORDER, innerhalb: Track-Array-Reihenfolge
for (const kind of RENDER_ORDER) {
  const tracksOfKind = tracks.filter(t => t.kind === kind && !t.muted);
  for (const track of tracksOfKind) {
    const clip = activeClipOnTrack(track.id, clips, currentBeat);
    if (!clip) continue;
    renderClip(clip, track, rc, ctx);
  }
}
```

Tests: ≥ 3 für `activeClipOnTrack`

---

## Task 5 — Timeline UI: Dynamische Track-Zeilen

- Track-Liste rendert `store.timeline.tracks`
- "Track hinzufügen"-Button mit Dropdown (alle TrackKinds außer 'audio')
- Track-Label doppelklick → inline edit
- Delete-Button pro Track (disabled wenn Clips vorhanden)
- Mute-Button pro Track (bereits vorhanden, nur verkabeln)

---

## Task 6 — Drag & Drop Validierung

```ts
// lib/timeline/track-validation.ts
export function canDropOnTrack(
  mediaKind: 'image' | 'audio' | 'video',
  trackKind: TrackKind
): boolean {
  if (mediaKind === 'image') return trackKind === 'image';
  if (mediaKind === 'video') return trackKind === 'video';
  if (mediaKind === 'audio') return trackKind === 'audio';
  return false;
}
```

In `handleDrop`: wenn `!canDropOnTrack(...)` → `toast.error(...)`.

Tests: ≥ 5 (alle Kombinationen)

---

## Verification Gate

Baseline + ≥ 20 neue Tests.

```powershell
npm test -- --run    # 0 failing
npm run typecheck
npm run lint
npm run build        # Bundle ≤ Baseline + 3%
```

## Smoke Gate
```
npm run dev
# Track hinzufügen (Contour) → erscheint in Timeline
# Track löschen mit Clip → Toast Fehler
# Track löschen leer → weg
# addTrack('audio') → Toast v0.2
# Bestehende v4-Projekte laden sauber
```

## Commit-Struktur
```
feat(timeline): Track interface + TrackKind video — flat clips preserved
feat(store): addTrack/removeTrack/reorderTracks + migration v4→v5
feat(timeline): activeClipOnTrack selector + RENDER_ORDER multi-track
feat(timeline): dynamic track rows UI + add-track menu
feat(timeline): canDropOnTrack validation
test: multi-track store + selectors + validation coverage
```

Abgabe: `2026-05-21-vibegrid-plan-5_9a-multitrack.md`

---

# CC #1 Prompt — Schreibe Plan 5.9b: Video-Clips

## Kontext

Plan 5.9a abgeschlossen. Video-Track-Kind und dynamische Tracks
existieren. Baseline: aktueller HEAD nach 5.9a.

---

## Was 5.9b leistet

Video-Dateien hochladen, auf Video-Tracks platzieren, im Canvas rendern,
im Offline-Export frame-genau encoden.

---

## Task 0 — Baseline

```powershell
npm test -- --run && npm run typecheck && npm run build
```

---

## Task 1 — R2 Presigned Upload

**`app/api/presign/route.ts`**:
- Akzeptiert: `video/mp4`, `video/webm`
- Limit: 500 MB (hard), 5 Minuten (client-seitig geprüft)
- Gibt zurück: `{ presignedUrl, publicUrl, key }`
- Neue Env-Variable: `R2_ENDPOINT` in `.env.example`

**`lib/storage/video-upload.ts`**:
- `uploadVideoToR2(file, onProgress)` via XHR (für Progress-Events)
- `getVideoDuration(file): Promise<number>` via `HTMLVideoElement`

CORS-Reminder: R2-Bucket braucht `"AllowedMethods": ["PUT", "GET"]`
für die Browser-Origin (gleiche Stelle wie image-cache CORS).

Tests: ≥ 4

---

## Task 2 — MediaRef + MockVideoElement

```ts
// lib/storage/types.ts — MediaRef erweitern:
kind: 'image' | 'audio' | 'video';
thumbnailUrl?: string;
// duration, width, height bereits vorhanden oder ergänzen
```

`MockVideoElement` in `tests/vitest.setup.ts`:
```ts
// currentTime, play, pause, load, addEventListener('seeked', ...)
// document.createElement('video') → MockVideoElement
```

Tests: ≥ 2

---

## Task 3 — VideoEngine

**`lib/video/engine.ts`**:

```ts
export function createVideoEngine(): VideoEngine | null // SSR → null

interface VideoEngine {
  load(mediaId: string, url: string): Promise<void>;
  unload(mediaId: string): void;
  seekTo(mediaId: string, timeSec: number): Promise<void>;
  seekAllTo(timeSec: number): Promise<void>;
  play(): void;
  pause(): void;
  getElement(mediaId: string): HTMLVideoElement | null;
  destroy(): void;
}
```

Seek-Implementierung:
```ts
// requestVideoFrameCallback wenn verfügbar (Chrome/Edge)
// Fallback: addEventListener('seeked', ..., {once: true})
// Early return wenn |currentTime - timeSec| < 0.01
```

Video-Elemente: `muted: true`, `playsInline: true`, `preload: 'auto'`

**`lib/hooks/useVideoEngine.ts`**:
- Lazy loading: nur Videos laden die in `timeline.clips` referenziert
  sind (dedup by mediaId)
- Sync-Subscription:
  ```ts
  // isPlaying ändert sich → engine.play() / engine.pause()
  // playheadBeat ändert sich (ohne Playback) → engine.seekAllTo(timeSec)
  ```

Tests: ≥ 5

---

## Task 4 — Renderer: Video-Frame-Rendering

`RendererDeps` (loop.ts) bekommt:
```ts
getVideoElement: (mediaId: string) => HTMLVideoElement | null;
```

**NICHT** in `RenderContext` — Plugins brauchen keinen Video-Zugriff.

Im Loop nach Image-Rendering, vor FX-Plugins:
```ts
for (const track of videoTracks) {
  const clip = activeClipOnTrack(track.id, clips, currentBeat);
  if (!clip || track.muted) continue;
  const el = deps.getVideoElement(clip.mediaId);
  if (!el) continue;
  ctx.drawImage(el, 0, 0, rc.width, rc.height);
}
```

Tests: ≥ 3

---

## Task 5 — Offline Render: Async Seeking

`OfflineRenderDeps` bekommt:
```ts
videoEngine?: VideoEngine | null;
```

Im Frame-Loop vor `renderAt`:
```ts
if (deps.videoEngine) {
  await deps.videoEngine.seekAllTo(timeSec);
}
```

Projekte ohne Video: `videoEngine = null` → keine Änderung im Loop.

Tests: ≥ 3

---

## Task 6 — Mediathek: Video-Upload UI

- Drag & Drop + Click akzeptiert `video/mp4`, `video/webm`
- Vor Upload: `getVideoDuration` → Fehler wenn > 300s
- Während Upload: Fortschrittsbalken (aus `onProgress`)
- Nach Upload: Thumbnail generieren (seek zu 1s, canvas.toDataURL)
- Video-Badge: `▶` + Dauer (`1:47`)
- MIME-Fehler: `toast.error('Nur MP4 und WebM werden unterstützt')`

Tests: ≥ 4

---

## KNOWN_LIMITATIONS.md

```markdown
## Video-Clips (Plan 5.9)
- Max. 5 Minuten pro Video-Clip.
- Unterstützte Formate: MP4 (H.264), WebM (VP9).
- Video-Audio wird ignoriert — Ton über Audio-Tracks.
- Offline-Export mit Video: 5–15× länger als Clip-Dauer.
- requestVideoFrameCallback nur in Chrome/Edge (Firefox: seeked-Fallback).
- R2 CORS muss PUT erlauben für Presigned-Upload.
- Auto-Preset ignoriert Video-Tracks.
- Multi-Audio-Tracks: v0.2.
- Reorder-UI für Tracks: v0.2.
```

---

## Verification Gate

Baseline (nach 5.9a) + ≥ 25 neue Tests.

```powershell
npm test -- --run    # 0 failing
npm run typecheck
npm run lint
npm run build        # ≤ Baseline + 10% (VideoEngine + Upload)
```

## Smoke Gate
```
npm run dev
# Video MP4 hochladen → Fortschrittsbalken → Thumbnail
# Video auf Video-Track → Clip erscheint
# Video auf Image-Track → Toast Fehler
# Play → Video läuft im Canvas synchron
# FX auf Video-Track → FX sichtbar über Video
# Export → Video-Frames im MP4
# Altes Projekt (ohne Video) → Export unverändert
```

## Commit-Struktur
```
feat(api): R2 presigned PUT for video + R2_ENDPOINT env
feat(storage): uploadVideoToR2 + getVideoDuration + MockVideoElement
feat(video): VideoEngine + useVideoEngine hook + lazy loading
feat(renderer): video track rendering in loop
feat(export): async seekAllTo in offline render frame loop
feat(media): video upload UI — progress + thumbnail
docs(limitations): video constraints
test: VideoEngine + presign + renderer + offline-seek coverage
```

## Out of Scope
- Video-Audio auf separatem Track
- Video-Trimming / In-Out-Points
- MOV-Format
- Reorder-UI für Tracks
- Auto-Preset für Video
- 4K Video

Abgaben:
- `2026-05-21-vibegrid-plan-5_9a-multitrack.md`
- `2026-05-21-vibegrid-plan-5_9b-video-clips.md`
