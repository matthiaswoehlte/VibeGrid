# CC #1 Prompt — Plan 8d: Timeline-Integration + Beat-Snap (Rev. 2)

**Priorität: Direkt nach 8.6.**
Plan 8c–8.6 sind live. Story M1 ist gerendert. Transfer-to-Timeline-Button
ist aktuell ein Stub — klickt + macht nichts Sichtbares. Plan 8d schließt
diese Lücke.

> Revision 2 — 2026-05-25
> Rev. 1: erste Niederschrift
> Rev. 2: B1 (BPM persistieren), B2 (window.confirm → Modal), W1 (Endcard
>          Default-Dauer), W2 (Crossfade-Min-Guard), W3 (Smoke-Text),
>          W4 (MediaRef-Cleanup verorten), W5 (replaceMainVideoClips-ID-
>          Semantik), D1 (AddTrackPicker-File-Map), D2 (BPM-Detect-
>          File-Size-Guard) aus Architekt-Review eingearbeitet.

---

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Baseline: HEAD post-Plan-8.6 (**954 Tests**, Admin-UI + JSON I/O + Credits +
fal.ai-Pipeline live, Migration 006 + Backfill in Supabase appliziert).

Schreibe nur den **Plan** — noch keinen Code.

---

## Schritt 0 — Codebase lesen (vor Plan schreiben)

CC #1 liest und dokumentiert:

1. `lib/timeline/types.ts` — `TrackKind`, `Clip`, `SNAP_TO_BEATS`. **Hier
   wird `TrackKind` erweitert** — aktuelle 4 Werte notieren.
2. `lib/timeline/selectors.ts` — `snapBeats`, `activeClipsAt`,
   `hasOverlap` Signaturen.
3. `lib/audio/types.ts` + `lib/audio/grid.ts` — `BeatGrid`-Shape
   (`bpm + offsetMs + source`), `timeToBeats`, `beatPhase`.
4. `lib/audio/beat-detector.ts` — Signatur, ob async, was sie braucht
   (ArrayBuffer? AudioBuffer?). Wichtig für B1-Flow.
5. `lib/store/types.ts` + `lib/store/timeline-slice.ts` — wo Tracks/Clips
   leben + wie sie über `partialize` persistiert werden.
   **Pflicht-Check: existiert `clearAllTracks`?** Falls nein → in
   Plan-File-Map als NEUE Funktion markieren.
6. `lib/store/audio-slice.ts` — wo BPM gesetzt wird (`setBPM`).
7. `lib/storage/types.ts` — `MediaRef`-Shape (id/url/kind/duration).
8. `app/api/sceneflow/stories/[id]/transfer/route.ts` — aktueller
   Stub, wird komplett ersetzt.
9. `components/SceneFlow/GenerationControls.tsx` — heutiger
   Transfer-Click-Handler (`onTransfer?(clips)`).
10. `components/Workspace/Tracks/` — wo Track-Reihenfolge gerendert wird
    (für Main-Video + Sync-Audio Top-Pinning).
11. `components/Workspace/AddTrackPicker.tsx` (oder gleichwertig) —
    welche TrackKinds aktuell als Optionen angeboten werden (für D1-Fix).
12. `db/migrations/001_VG_projects.sql` — VG_projects-Schema (wird
    gewipet, nicht migriert).

---

## Was Plan 8d leistet

1. **Neue TrackKinds**: `main-video` + `sync-audio` (statt Migration: wipe
   `VG_projects`-Tabelle — bewusste Entscheidung, kein Bestandsschutz)
2. **DB-Wipe** der bestehenden Project-Snapshots (kein Daten-Erhalt nötig)
3. **VG_stories um `sync_audio_url` + `sync_audio_bpm` + `snap_mode` erweitern**
4. **Story-Setup**: optionales Music-Upload-Feld + Snap-Modus-Wahl
5. **Transfer-Button-Flow**: Warn-Modal → DB-wipe für aktuelles Projekt
   → Tracks neu bauen → Clips platzieren → VibeGrid-Tab öffnen
6. **Snap-Logik**: Beat / Bar / Off, mit "Trim auf letzten ganzen Beat/Bar"
   wenn Song vorhanden
7. **Sync-Audio Drop-Handler** in VibeGrid: Confirm-**Modal** bei Replace,
   Re-Detect BPM, Re-Snap aller Main-Video-Clips
8. **Top-Track-Pinning**: Main-Video + Sync-Audio bleiben immer ganz
   oben im Gantt, egal wie der User andere Tracks umsortiert
9. **Add-Track-Picker**: blendet `main-video` + `sync-audio` aus den
   Optionen aus wenn schon vorhanden (Singleton-Enforcement)

---

## Datenmodell

### [Fix B1] Migration 008 — `sync_audio_url` + `sync_audio_bpm` + `snap_mode` + VG_projects-Wipe

```sql
-- db/migrations/008_VG_sceneflow_timeline_integration.sql
-- Plan 8d — Timeline-Integration.
--
-- BEWUSSTE ENTSCHEIDUNG (User-confirmed, 2026-05-25): die bestehenden
-- VG_projects-Snapshots werden gewipet statt migriert. Wir führen zwei
-- neue TrackKind-Werte ein ('main-video', 'sync-audio'), und die alten
-- JSONB-Snapshots in VG_projects.state haben die alten Werte. Eine
-- Migrate-Hook im Zustand-Store würde das auf-runtime fangen, aber wir
-- haben aktuell <5 Test-Projekte und keine Production-User — Wipe ist
-- schneller und vermeidet Migrate-Bug-Surface.

DELETE FROM public."VG_projects";

ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS sync_audio_url TEXT;
-- [Fix B1] BPM wird im Story-Setup client-side detected und persistiert.
-- Transfer-Route liest direkt, kein nachträgliches Detect zur Submit-Zeit.
ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS sync_audio_bpm INTEGER
    CHECK (sync_audio_bpm IS NULL OR (sync_audio_bpm BETWEEN 40 AND 300));
ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS snap_mode TEXT
    NOT NULL DEFAULT 'beat'
    CHECK (snap_mode IN ('beat', 'bar', 'off'));
```

`sync_audio_url` = URL eines optionalen Music-Tracks (R2-gehostet).
`sync_audio_bpm` = client-side detected BPM, persistiert beim Upload.
NULL = kein Song / noch nicht detected.
`snap_mode` = pro-Story-Setting (`beat` | `bar` | `off`).

---

## Feature 1 — Neue TrackKinds

`lib/timeline/types.ts` Erweiterung:

```typescript
export type TrackKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'fx'
  | 'main-video'   // [Plan 8d] Top-pinned Video-Spur, dedicated für
                   // SceneFlow-Transfer-Output
  | 'sync-audio';  // [Plan 8d] Top-pinned Audio-Spur, primäre BPM-Quelle.
                   // Genau eine pro Projekt.

export type MediaTrackKind = 'image' | 'audio' | 'video' | 'main-video' | 'sync-audio';
```

### Eigenschaften

- **Main-Video**: rendert wie `video`, aber Selektoren behandeln sie
  als dedicated SceneFlow-Output. Kann mehrere Clips haben (eine pro
  Szene). Wird beim Transfer immer neu erzeugt.
- **Sync-Audio**: rendert wie `audio`, aber:
  - genau EINE Datei (zweite Drop → Confirm-Replace-Modal, siehe Feature 5)
  - BPM-Detect läuft automatisch beim Drop
  - bei BPM-Änderung: alle `main-video`-Clips werden neu eingerastet

### Top-Pinning

`Tracks.tsx` rendert Tracks in einer fixen Reihenfolge:
1. `sync-audio` (genau 1 oder 0)
2. `main-video` (genau 1 oder 0)
3. alle anderen Tracks in ihrer Array-Reihenfolge

Drag-to-reorder funktioniert NICHT auf den beiden Top-Tracks (UI sperrt
die Drag-Handles für `kind in ['main-video', 'sync-audio']`).

### [Fix D1] Add-Track-Picker-Singleton-Enforcement

`AddTrackPicker.tsx` (oder gleichwertige Komponente, Schritt 0 Punkt 11)
filtert die zwei neuen Kinds aus den Optionen sobald bereits eine
Spur des entsprechenden Kinds existiert. Dropdown-Optionen werden zur
Laufzeit aus `state.tracks` berechnet:

```typescript
const hasMain = tracks.some(t => t.kind === 'main-video');
const hasSync = tracks.some(t => t.kind === 'sync-audio');
const availableKinds = [
  ...(hasMain ? [] : ['main-video']),
  ...(hasSync ? [] : ['sync-audio']),
  'image', 'video', 'audio', 'fx'
];
```

---

## Feature 2 — Story-Setup: optional Music-Upload + Snap-Modus

`StorySetupForm.tsx` bekommt ein Feld zwischen Credit-Budget und Modelle:

```
┌─ Sync-Audio (optional) ──────────────────────────────┐
│ ◯ Kein Song   ◉ Datei wählen                         │
│ [Datei: drum_loop_120bpm.mp3] [BPM: 120 detected]   │
│ [✕ entfernen]                                        │
└──────────────────────────────────────────────────────┘

Snap-Modus:  ◉ Beat   ◯ Takt (4 Beats)   ◯ Aus
```

### [Fix B1] BPM-Detect-Flow im Story-Setup

```typescript
1. User klickt "Datei wählen", wählt MP3
2. [Fix D2] Vor Upload: file-size-Guard
   if (file.size > 3 * 1024 * 1024) {
     toast.info('Große Datei — BPM-Analyse dauert kurz (kein Web-Worker)');
   }
3. Upload via /api/upload → { url, mediaId }
4. Audio-Decoding + BPM-Detect im Browser:
   const arrayBuffer = await file.arrayBuffer();
   const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
   const { bpm } = await detectBpm(audioBuffer);
5. PATCH /api/sceneflow/stories/[id] mit { syncAudioUrl: url, syncAudioBpm: bpm }
6. UI: "BPM: 128 detected" neben dem Dateinamen
```

PATCH /api/sceneflow/stories/[id] akzeptiert `syncAudioUrl + syncAudioBpm + snapMode`.

Falls `sync_audio_url === null` beim Transfer: kein Sync-Track in der
Timeline (leere Drop-Zone bleibt). User kann später in VibeGrid einen
Song auf die leere Sync-Spur droppen (Feature 5).

---

## Feature 3 — Transfer-Flow

### UI: Warn-Modal vor dem Transfer

`GenerationControls.onTransfer` öffnet ein Modal:

```
┌─ Achtung ──────────────────────────────────────────┐
│                                                    │
│  Transfer to Timeline überschreibt die aktuelle    │
│  VibeGrid-Timeline komplett:                       │
│                                                    │
│  • 3 Tracks und 12 Clips werden gelöscht           │
│  • Main-Video + Sync-Audio werden neu erstellt     │
│  • FX, Automation, alle anderen Spuren weg         │
│                                                    │
│  Story enthält 8 fertige Szenen.                   │
│  ☐ Verstanden, weiter                              │
│                                                    │
│              [Abbrechen]  [Transferieren]          │
└────────────────────────────────────────────────────┘
```

User muss Checkbox aktivieren bevor "Transferieren" klickbar wird.

### Backend: `POST /api/sceneflow/stories/[id]/transfer`

Ersetzt den heutigen Stub. Returnt **keinen** Clip-Array mehr (das
hat die Frontend-Logik gemacht). Stattdessen:

```typescript
// Response shape — [Fix B1] bpm ist required wenn syncAudio set
{
  storyId: string;
  syncAudio: { url: string; bpm: number } | null;
  clips: Array<{
    mediaId: string;        // neu erzeugt, in mediaRefs eingetragen
    videoUrl: string | null;  // null für endcard ohne Video
    imageUrl: string | null;  // für endcard-Szenen als Fallback
    durationSec: number;
    transition: 'last-frame' | 'crossfade' | 'cut';
    sceneType: 'action' | 'dialog' | 'endcard';
    sceneOrder: number;
  }>;
  snapMode: 'beat' | 'bar' | 'off';
}
```

Der Frontend-Handler (`onTransfer`) wendet diese Payload auf den Zustand-Store an:
1. [Fix W4] `purgeSceneflowMediaRefs(storyId)` — räumt alte MediaRefs
   dieser Story aus `mediaRefs[]` raus (Match auf URL-Prefix
   `/sceneflow/<userId>/<storyId>/`)
2. `clearAllTracks()` — alle bestehenden Tracks + Clips raus
3. Track-Aufbau:
   - 1 `sync-audio`-Track (auch wenn `syncAudio === null` — leere Spur als Drop-Zone)
   - 1 `main-video`-Track
   - BPM aus `syncAudio.bpm ?? 120` (Default 120 wenn kein Song)
4. Clip-Platzierung via `layoutClips()` (Feature 4)
5. Sync-Audio-Clip einfügen, falls `syncAudio !== null`
6. `router.push('/')` — VibeGrid-Tab aktivieren

### MediaRefs

Für jeden Video-URL aus der Story wird ein `MediaRef`-Eintrag in
`mediaRefs[]` angelegt (Plan 5.9b-MediaRef-Shape):

```typescript
{
  id: <neue UUID>,
  kind: 'video',  // oder 'image' für endcard ohne Video
  url: scene.video_url ?? scene.image_url,
  filename: `scene-${scene.scene_order}.mp4`,
  duration: scene.duration,   // sec
  uploadedAt: now()
}
```

Sync-Audio bekommt analog einen `kind: 'audio'`-MediaRef.

### [Fix W4] MediaRef-Cleanup-Verortung

Neue Store-Action in `lib/store/timeline-slice.ts`:

```typescript
purgeSceneflowMediaRefs(storyId: string): void
// Filtert alle mediaRefs, deren URL '/sceneflow/{userId}/{storyId}/' enthält.
// userId kommt aus dem aktuell-angemeldeten Better-Auth-Session
// (Store kennt das via existing-pattern, sonst aus Helper).
```

Wird im `onTransfer`-Handler VOR `clearAllTracks` aufgerufen. Verhindert
verwaiste MediaRefs nach Re-Transfer (User klickt Transfer ein zweites
Mal nach Edit).

---

## Feature 4 — Clip-Platzierungs-Logik

### Helper: `lib/sceneflow/clip-layout.ts` (CREATE)

```typescript
// [Fix W1] Endcards haben keine echte Video-Dauer — sie kommen als
// statisches Bild rein und werden hier mit einer Konstante geplant.
export const ENDCARD_DEFAULT_DURATION_SEC = 5;

// [Fix W2] Crossfade nimmt maximal HALBE Clip-Länge — verhindert dass
// ein sehr kurzer Clip vor seinem Vorgänger startet.
export const CROSSFADE_BEATS_DEFAULT = 2;

export interface LayoutInput {
  clips: Array<{
    mediaId: string;
    durationSec: number;
    transition: 'last-frame' | 'crossfade' | 'cut';
    sceneOrder: number;
    sceneType: 'action' | 'dialog' | 'endcard';
  }>;
  bpm: number;
  snapMode: 'beat' | 'bar' | 'off';
  crossfadeBeats?: number;  // Default CROSSFADE_BEATS_DEFAULT
}

export interface LayoutResult {
  clips: Array<{
    mediaId: string;
    startBeat: number;
    lengthBeats: number;
    /** True wenn das Original länger war als die geschnipste Länge. */
    trimmed: boolean;
    trimmedSec: number;  // wieviel weggekürzt wurde
  }>;
  warnings: Array<{ sceneOrder: number; message: string }>;
}

export function layoutClips(input: LayoutInput): LayoutResult;
```

### Algorithmus

```
cursor = 0   // current beat position
warnings = []
crossfadeBeats = input.crossfadeBeats ?? CROSSFADE_BEATS_DEFAULT

for (clip of clips):
  // [Fix W1] Endcards: Default-Dauer ersetzt undefined durationSec
  effectiveDurationSec = clip.sceneType === 'endcard'
    ? (clip.durationSec || ENDCARD_DEFAULT_DURATION_SEC)
    : clip.durationSec

  rawLengthBeats = (effectiveDurationSec * bpm) / 60

  switch (snapMode):
    case 'off':
      lengthBeats = rawLengthBeats
      trimmed = false
    case 'beat':
      lengthBeats = Math.floor(rawLengthBeats)   // trim auf letzten Beat
      trimmed = rawLengthBeats - lengthBeats > 0
    case 'bar':
      lengthBeats = Math.floor(rawLengthBeats / 4) * 4
      trimmed = rawLengthBeats - lengthBeats > 0

  if (lengthBeats < 1):
    warnings.push({ sceneOrder, message: 'sehr kurze Szene nach Snap (< 1 Beat)' })
    lengthBeats = 1   // Mindestens 1 Beat (verhindert lengthBeats === 0)

  // [Fix W2] Crossfade-Min-Guard: maximal halbe Clip-Länge, kein
  // negativer Startoffset
  effectiveCrossfade = previousClip
    ? Math.min(crossfadeBeats, Math.floor(lengthBeats / 2))
    : 0

  if (clip.transition === 'crossfade' && previousClip):
    startBeat = previousClip.startBeat + previousClip.lengthBeats - effectiveCrossfade
  else:
    startBeat = cursor

  cursor = startBeat + lengthBeats

return { clips, warnings }
```

### Edge Cases

- Erster Clip mit `transition: 'crossfade'` → startBeat = 0 (kein
  Vorgänger zum Überlappen)
- `snapMode === 'off'` + crossfade → Float-Längen erlaubt
- Endcard ohne Video → `videoUrl === null`, `mediaKind: 'image'`,
  Layout-Helper kriegt `effectiveDurationSec = ENDCARD_DEFAULT_DURATION_SEC`
- Sehr kurzer Clip (`lengthBeats === 2`) + `crossfadeBeats === 2` → 
  `effectiveCrossfade = min(2, floor(2/2)) = 1` → Clip startet 1 Beat
  vor dem Ende des Vorgängers, kein negativer Offset

---

## Feature 5 — Sync-Audio Drop-Handler in VibeGrid

Wenn der User in VibeGrid eine Datei auf die `sync-audio`-Spur droppt:

```
1. Drop-Event triggert in der Sync-Audio-Track-Komponente
2. Prüfen ob Spur schon einen Clip hat:
   a. Ja → [Fix B2] ConfirmReplaceAudioModal öffnet sich
           User klickt "Ersetzen" → weiter, "Abbrechen" → Drop abbrechen
   b. Nein → direkt weiter
3. [Fix D2] file-size-Guard: file.size > 3 MB → Info-Toast
4. File-Upload via /api/upload → R2-URL
5. addMediaRef({ kind: 'audio', url, duration })
6. BPM-Detect laufen lassen (bestehender beat-detector)
7. setBPM(detectedBpm)
8. Wenn Main-Video Clips existieren:
   - Story-Setting snapMode aus story.snap_mode lesen (über story-Context)
   - layoutClips() neu aufrufen mit neuer BPM
   - [Fix W5] replaceMainVideoClips({ newLayout }) — siehe unten
9. Toast: "Song hinzugefügt. X Video-Clips wurden auf BPM Y restrukturiert."
```

### [Fix W5] `replaceMainVideoClips` ID-Semantik

```typescript
// lib/store/timeline-slice.ts
replaceMainVideoClips(args: {
  layoutByMediaId: Map<string, { startBeat: number; lengthBeats: number }>;
}): void

// Implementierung:
clips: state.clips.map(c => {
  if (c.trackId !== mainVideoTrackId) return c;
  const layout = args.layoutByMediaId.get(c.mediaId!);
  if (!layout) return c;
  // [Fix W5] bestehende c.id beibehalten — nur startBeat + lengthBeats mutieren
  return { ...c, startBeat: layout.startBeat, lengthBeats: layout.lengthBeats };
})
```

Begründung: Undo/Redo, Selektoren (`activeClipsAt` nutzt clip.id als Key)
und JSONB-Persistierung in VG_projects bleiben stabil über das Re-Snap
hinweg. Nur die räumliche Lage ändert sich, der Clip ist semantisch
derselbe (selbe mediaId, selbe Szene).

### [Fix B2] ConfirmReplaceAudioModal

Neuer File-Map-Eintrag analog zu `TransferConfirmModal`:

```
components/SceneFlow/ConfirmReplaceAudioModal.tsx (CREATE)
```

Aufbau:

```
┌─ Sync-Audio ersetzen ───────────────────────────────┐
│                                                     │
│  Auf der Sync-Audio-Spur liegt bereits ein Song:    │
│  drum_loop_120bpm.mp3 (BPM 120)                     │
│                                                     │
│  Beim Ersetzen:                                     │
│  • Alter Song wird aus der Spur entfernt            │
│  • BPM-Re-Detect läuft (kann 2–5 s dauern)          │
│  • Main-Video-Clips werden auf neue BPM restrukt.   │
│  • Manuelle BPM-Anpassungen gehen verloren          │
│                                                     │
│            [Abbrechen]  [Ersetzen]                  │
└─────────────────────────────────────────────────────┘
```

Modal ist headless (kein Tailwind-Plugin nötig), folgt der Patterns
von `TransferConfirmModal`. Promise-basiert (`await openModal()` returnt
`true|false`) — kein store-State nötig.

---

## Feature 6 — Top-Pinning-Logik

`lib/timeline/selectors.ts` — neuer Selektor:

```typescript
export function sortedTracks(tracks: Track[]): Track[] {
  const sync = tracks.filter((t) => t.kind === 'sync-audio');
  const main = tracks.filter((t) => t.kind === 'main-video');
  const rest = tracks.filter(
    (t) => t.kind !== 'sync-audio' && t.kind !== 'main-video'
  );
  return [...sync, ...main, ...rest];
}
```

Tracks.tsx nutzt diesen Selektor statt direkt `tracks.map(...)`. Drag-
to-reorder ist nur für Tracks aus `rest` aktiv (siehe useDndContext-
Sensor + Activation-Guard auf `kind`).

---

## File Map

| Datei | Aktion |
|---|---|
| `db/migrations/008_VG_sceneflow_timeline_integration.sql` | CREATE |
| `lib/timeline/types.ts` | MODIFY — `TrackKind`-Erweiterung |
| `lib/timeline/selectors.ts` | MODIFY — `sortedTracks` |
| `lib/sceneflow/clip-layout.ts` | CREATE — Layout-Algorithmus mit Endcard-Default + Crossfade-Guard [Fix W1, W2] |
| `lib/sceneflow/types.ts` | MODIFY — `sync_audio_url + sync_audio_bpm + snap_mode` auf StoryRecord [Fix B1] |
| `lib/sceneflow/stories-db.ts` | MODIFY — SELECT/UPDATE neue Spalten [Fix B1] |
| `lib/sceneflow/api-client.ts` | MODIFY — `apiPatchStory` um `syncAudioUrl + syncAudioBpm + snapMode` erweitern [Fix B1] |
| `lib/store/timeline-slice.ts` | MODIFY — `clearAllTracks`, `replaceMainVideoClips` (ID-stabil) [Fix W5], `purgeSceneflowMediaRefs(storyId)` [Fix W4] |
| `app/api/sceneflow/stories/[id]/transfer/route.ts` | REPLACE — vollständige Implementierung statt Stub |
| `app/api/sceneflow/stories/[id]/route.ts` | MODIFY — PATCH akzeptiert `syncAudioUrl + syncAudioBpm + snapMode` [Fix B1] |
| `components/SceneFlow/StorySetupForm.tsx` | MODIFY — Music-Upload mit BPM-Detect + PATCH [Fix B1] + Snap-Modus-Wahl + file-size-Guard [Fix D2] |
| `components/SceneFlow/GenerationControls.tsx` | MODIFY — Warn-Modal vor Transfer |
| `components/SceneFlow/TransferConfirmModal.tsx` | CREATE — Modal mit Wipe-Preview |
| `components/SceneFlow/ConfirmReplaceAudioModal.tsx` | CREATE — Sync-Replace-Modal [Fix B2] |
| `components/Workspace/Tracks/Tracks.tsx` | MODIFY — `sortedTracks` + Drag-Lock für Top-Tracks |
| `components/Workspace/Tracks/SyncAudioTrack.tsx` | CREATE — Drop-Handler + Modal + BPM-Detect-Trigger |
| `components/Workspace/AddTrackPicker.tsx` | MODIFY — `main-video + sync-audio` aus Optionen ausblenden wenn vorhanden [Fix D1] |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY — Plan 8d Einträge |

---

## Tests

**`tests/unit/sceneflow/clip-layout.test.ts`** — ≥ 10:
- snapMode='off': Float-Längen, kein Trim
- snapMode='beat' + 5.3 Beats: trim auf 5 → trimmed=true
- snapMode='bar' + 10.6 Beats: trim auf 8 → trimmed=true
- snapMode='beat' + 4.0 Beats: kein Trim (schon exakt)
- crossfade-transition: zweiter Clip startet (prev.start + prev.length - crossfadeBeats)
- erster Clip crossfade: startBeat=0 (kein Vorgänger)
- Sehr kurze Szene → warning + lengthBeats=1
- Sequenz von 3 Clips ohne crossfade: startBeats lückenlos
- [Fix W1] Endcard ohne durationSec → ENDCARD_DEFAULT_DURATION_SEC angewendet
- [Fix W2] Crossfade-Guard: lengthBeats=2 + crossfadeBeats=2 → effectiveCrossfade=1, kein negativer startBeat
- [Fix W2] Crossfade-Guard: lengthBeats=1 + crossfadeBeats=2 → effectiveCrossfade=0

**`tests/unit/timeline/sorted-tracks.test.ts`** — ≥ 3:
- sync-audio kommt vor main-video kommt vor allem anderen
- Mehrere "rest"-Tracks behalten ihre Array-Reihenfolge
- Kein sync-audio + main-video → Array unverändert

**`tests/unit/api/transfer.test.ts`** — ≥ 5:
- Response enthält syncAudio: null wenn story.sync_audio_url === null
- [Fix B1] Response enthält syncAudio.bpm aus story.sync_audio_bpm
- Response enthält clips in scene_order
- Response.snapMode kommt aus story.snap_mode
- 404 wenn Story nicht existiert / nicht owner

**`tests/unit/api/stories-patch-sync-audio.test.ts`** — ≥ 3:
- PATCH mit syncAudioUrl → DB-Spalte gesetzt
- PATCH mit snapMode: 'bar' → DB-Spalte gesetzt
- [Fix B1] PATCH mit syncAudioBpm: 128 → DB-Spalte gesetzt
- [Fix B1] PATCH mit syncAudioBpm: 999 → 400 (außerhalb 40–300-CHECK)

**`tests/unit/store/timeline-replace-main-video.test.ts`** — ≥ 2: [Fix W5]
- replaceMainVideoClips: bestehende clip.id bleibt unverändert
- replaceMainVideoClips: nur startBeat + lengthBeats werden mutiert,
  andere Felder (kind, mediaId, label, …) bleiben

**`tests/unit/components/AddTrackPicker.test.tsx`** — ≥ 2: [Fix D1]
- Wenn keine main-video/sync-audio Tracks existieren: beide Optionen sichtbar
- Wenn beide existieren: beide Optionen aus Dropdown ausgeblendet

**`tests/unit/components/ConfirmReplaceAudioModal.test.tsx`** — ≥ 2: [Fix B2]
- Cancel-Klick: Promise resolved zu false
- Ersetzen-Klick: Promise resolved zu true

Mindest: **≥ 27 neue Tests**

---

## Verification Gate

Baseline: **954 Tests**.
Ziel: **≥ 981 Tests**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**
```
# Transfer ohne Song
1. Open story M1, kein sync_audio_url gesetzt, snap_mode='beat' (Default)
2. Klick Transfer to Timeline
3. Warn-Modal erscheint mit "X Tracks und Y Clips werden gelöscht"
4. Checkbox aktivieren + Transferieren
5. VibeGrid-Tab öffnet sich
6. Top: leere Sync-Audio-Spur + Main-Video-Spur mit 8 Clips
7. [Fix W3] Clips sind in Story-Reihenfolge, auf Beat-Boundaries getrimmt
   (snap_mode='beat', Default 120 BPM aus syncAudio.bpm ?? 120)

# Song später im VibeGrid droppen
8. MP3 (z.B. 130 BPM) auf die Sync-Audio-Spur ziehen
9. [Fix D2] Wenn > 3 MB: Info-Toast "BPM-Analyse dauert kurz"
10. BPM-Detect läuft → setBPM(130)
11. 8 Main-Video-Clips snappen auf Beat-Boundaries, IDs bleiben gleich [Fix W5]
12. Toast: "Song hinzugefügt. 8 Video-Clips wurden auf BPM 130 restrukturiert."

# Replace-Confirm (statt window.confirm — Modal) [Fix B2]
13. Zweite MP3 auf Sync-Audio droppen
14. ConfirmReplaceAudioModal öffnet sich mit altem Song-Namen
15. Abbrechen → alter Song bleibt, kein Re-Detect
16. Zweiter Drop + Ersetzen → BPM-Re-Detect, Re-Snap

# Transfer mit Song
17. Story-Setup: Music hochladen (BPM auto-detected + persistiert) [Fix B1]
18. Snap-Modus 'Takt' wählen, PATCH läuft
19. Transfer
20. Modal zeigt zusätzlich "Song: drum_loop.mp3 (BPM 120, Snap auf Takt)"
21. Nach Transfer: Sync-Audio-Spur hat den Song, Main-Video Clips sind
    auf 4-Beat-Boundaries getrimmt

# Wipe-Bestätigung
22. VibeGrid: 1 FX-Track + 1 Audio-Track manuell anlegen
23. SceneFlow Transfer klicken
24. Modal zeigt korrekt "X Tracks und Y Clips werden gelöscht"
25. Nach Transfer: nur Sync-Audio + Main-Video, alles andere weg

# Add-Track-Picker [Fix D1]
26. Nach Transfer: Add-Track-Picker öffnen
27. Optionen zeigen NICHT main-video und sync-audio (schon vorhanden)
28. Nur image / video / audio / fx als Optionen

# Endcard-Behandlung [Fix W1]
29. Story mit 1 Endcard-Szene (kein Video), Transfer
30. Endcard-Clip ist 5 Sekunden lang (ENDCARD_DEFAULT_DURATION_SEC)
31. Renderer zeigt das Endcard-Bild statisch für die Clip-Länge
```

---

## Commit-Struktur

```
feat(db): migration 008 — sync_audio_url + sync_audio_bpm + snap_mode + VG_projects-Wipe
feat(timeline): TrackKind erweitert + sortedTracks-Selector
feat(sceneflow): clip-layout — Beat/Bar-Snap + Crossfade-Overlap-Guard + Endcard-Default
feat(sceneflow): stories-db + types — sync_audio_url + sync_audio_bpm + snap_mode
feat(api): stories PATCH — syncAudioUrl + syncAudioBpm + snapMode
feat(api): transfer — vollständige Implementierung statt Stub
feat(sceneflow): StorySetupForm — Music-Upload mit BPM-Detect + Snap-Modus + file-size-Guard
feat(sceneflow): TransferConfirmModal — Wipe-Preview mit Checkbox
feat(sceneflow): ConfirmReplaceAudioModal — Sync-Audio-Replace-Modal
feat(workspace): Tracks — Top-Pinning + Drag-Lock
feat(workspace): SyncAudioTrack — Drop-Handler + Modal + BPM-Detect + Re-Snap (ID-stabil)
feat(workspace): AddTrackPicker — main-video + sync-audio Singleton-Enforcement
feat(store): timeline-slice — clearAllTracks + replaceMainVideoClips + purgeSceneflowMediaRefs
docs(limitations): Plan 8d Einträge
test: clip-layout + sorted-tracks + transfer + stories-patch-sync + replace-main-video + add-track-picker + confirm-modal
```

---

## Out of Scope (kommt später)

- Manuelles Verschieben einzelner Main-Video-Clips auf Beat-Boundaries
  (Drag mit Snap) — Plan 8e
- Beat-Pulsing-FX automatisch über Main-Video-Track legen — Plan 8e
- Sync-Audio mit BPM-Override (User korrigiert detected BPM manuell) —
  könnte rein, aber lassen für später
- Multi-Story-Transfer (mehrere Stories in eine Timeline) — Plan 8f
- Web-Worker für BPM-Detect — bleibt Main-Thread, file-size-Guard
  überbrückt

---

## KNOWN_LIMITATIONS.md — Plan 8d Einträge

```markdown
## Plan 8d — Timeline-Integration

### VG_projects-Tabelle wurde für Plan 8d gewipet

Migration 008 löscht alle bestehenden Project-Snapshots, weil die neuen
TrackKind-Werte ('main-video', 'sync-audio') nicht in den alten JSONB-
Zustand passen würden. v0.1 hat keine Production-User. Bei
hypothetischem v0.2-Restart mit Bestandsuser müsste eine Migrate-Hook im
Zustand-Store (`lib/store/index.ts: migrate`) die alten Snapshots
transformieren.

### Main-Video / Sync-Audio sind Singleton-Tracks

Genau eine Main-Video- und genau eine Sync-Audio-Spur pro Projekt.
Versuch eine zweite anzulegen ist nicht über die UI möglich —
`AddTrackPicker` filtert die beiden Kinds aus den Optionen wenn schon
vorhanden. Existieren sie schon (post-Transfer), werden sie geschützt:
Delete-Button auf der Spur fragt nicht nur „Spur löschen?" sondern
„Spur und alle Inhalte löschen?" mit zusätzlicher Warnung.

### Sync-Audio BPM-Detect ist client-side, blockt Main-Thread

Beim Drop läuft `lib/audio/beat-detector.ts` im Browser. Bei 3+ MB
MP3-Dateien dauert das 2–5 s und blockiert den Main-Thread (kein
Web-Worker). File-Size-Guard zeigt Info-Toast „BPM-Analyse dauert kurz"
sobald Datei > 3 MB. Web-Worker-Variante ist Plan 8e+ Aufgabe.

### Re-Snap bei BPM-Änderung verändert nur Main-Video-Clips

Wenn der User in VibeGrid die BPM **manuell** ändert (via BPMBadge im
TopBar), passiert kein automatisches Re-Snap. Nur ein neuer
Sync-Audio-Drop triggert den Re-Layout. Manuelle BPM-Edits sind eine
Power-User-Aktion — der User soll selbst entscheiden ob er Clips
nachjustiert.

Beim Re-Snap bleiben die `clip.id`s stabil — nur `startBeat` +
`lengthBeats` werden mutiert. Undo/Redo-Historie und FX-Bindungen die
auf clip-IDs verweisen bleiben damit funktional.

### Endcards landen als statisches Bild mit 5-Sek Default-Dauer

Endcard-Szenen haben kein Video. Im Transfer werden sie als Clip mit
`mediaKind: 'image'` und `mediaId` des Endcard-Bilds eingefügt, mit
`ENDCARD_DEFAULT_DURATION_SEC = 5`. Der Renderer behandelt sie als
statisches Bild für die Clip-Länge — Crossfade-Übergang vom letzten
Video-Clip funktioniert wie gewohnt.

### Crossfade-Min-Guard verhindert negative Offsets

Wenn ein Clip nach Snap sehr kurz wird (z.B. 1 Beat lang) und
crossfade-Transition hat, würde `prev.length - crossfadeBeats` negativ
werden. Layout-Helper limitiert Crossfade automatisch auf
`Math.floor(lengthBeats / 2)`. Ein 1-Beat-Clip kann maximal 0 Beats
crossfaden (kein Overlap), ein 2-Beat-Clip maximal 1 Beat.
```

---

Abgabe: `2026-05-25-vibegrid-plan-8d-timeline-integration.md`
