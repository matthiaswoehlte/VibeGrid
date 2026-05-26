# CC #1 Prompt — Schreibe Plan 5.9c: FX-Track Consolidation (v3)

## Kontext

Plan 5.9b abgeschlossen. Baseline: aktueller HEAD nach 5.9b, alle Gates grün.
Schreibe nur den **Plan** — noch keinen Code.

---

## Entscheidungen zu den Blocker-Punkten

### Entscheidung 5 — `__blend`-Lifecycle bei cross-kind Overlap ✅

In `lib/timeline/blend-lifecycle.ts`, `regenerateBlendsForTrack`:
Das Pattern `c.kind === prev?.kind` ist **nicht ausführbar** — `prev`
existiert nicht im Loop-Scope. Korrekte Reihenfolge:

```ts
// ERST incoming ermitteln, DANN Kind-Vergleich:
const incoming = findIncomingOverlap(state, c.id);

if (!incoming || incoming.kind !== c.kind) {
  // Kein Overlap ODER cross-kind Overlap:
  // Stale __blend aktiv löschen falls vorhanden
  if (!(BLEND_KEY in existingParams)) return c;
  const nextParams: Record<string, unknown> = { ...existingParams };
  delete nextParams[BLEND_KEY];
  return { ...c, params: nextParams };
}

// Same-kind Overlap: __blend regenerieren (bestehende Logik unverändert)
const range = overlapRange(incoming, c);
// ...
```

Cross-kind-Cleanup ist Pflicht — ohne ihn behält ein Clip nach einem
Move auf einen anderen Track stale `__blend`-Werte.

Zusätzlicher Test-Case in `tests/unit/store/blend-lifecycle.test.ts`:
*"Existierendes `__blend` wird bei Wechsel auf cross-kind Overlap entfernt"*

---

### B1 — Casing: durchgängig lowercase ✅

`clip.kind` für FX-Clips ist **lowercase**: `'contour' | 'sweep' | 'pulse' |
'zoom-pulse' | 'particles' | 'text' | 'dissolve' | 'sunray'`.
Das ist `TrackKind` (ex-FX-Kinds), nicht `FxPlugin.kind` (PascalCase).

Im Plan durchgängig lowercase. Kein PascalCase in `FX_KINDS`,
`FX_CLIP_COLORS`, `getActiveFxClips`.

### Entscheidung 7 — `RENDER_ORDER_TRACK_KIND` in `plugin-mapping.ts` ✅

Single source of truth für FX-Render-Reihenfolge:

```ts
// lib/timeline/plugin-mapping.ts — hier leben ALLE FX-Mapping-Konstanten:
export const RENDER_ORDER_TRACK_KIND = [
  'dissolve', 'contour', 'zoom-pulse', 'sweep',
  'particles', 'pulse', 'sunray', 'text'
] as const;

export function fxSortIndex(clipKind: string): number {
  const i = (RENDER_ORDER_TRACK_KIND as readonly string[]).indexOf(clipKind);
  return i === -1 ? RENDER_ORDER_TRACK_KIND.length : i; // unbekannte Kinds → ans Ende
}
```

`loop.ts` importiert `RENDER_ORDER_TRACK_KIND` von dort.
`getActiveFxClips.sort(...)` ruft `fxSortIndex(clip.kind)`.
`Tracks.tsx` importiert `canDropOnTrack` + `PLUGIN_KIND_TO_TRACK_KIND`
von dort statt vom Renderer — kein Cross-Layer-Import mehr.

Für die RENDER_ORDER-Sortierung nutzt `loop.ts` weiterhin die bestehende
PascalCase `RENDER_ORDER` für Plugin-Dispatch — `RENDER_ORDER_TRACK_KIND`
ist nur für die Clip-Sortierung in `getActiveFxClips`:

```ts
// lib/renderer/loop.ts — bestehende RENDER_ORDER bleibt unverändert
// Neu: Import von plugin-mapping.ts:
import { fxSortIndex } from '@/lib/timeline/plugin-mapping';
```

### B2 — `hasOverlap` Signatur unverändert ✅

`hasOverlap` bleibt wie heute. Der Track-Kind-Gate kommt in
`lib/timeline/operations.ts` **vor** dem hasOverlap-Check:

```ts
// In addClip:
const track = state.timeline.tracks.find(t => t.id === clip.trackId);
if (!track) return state;

// FX-Tracks: Overlap immer erlaubt
if (track.kind !== 'fx') {
  if (hasOverlap(state, clip.trackId, clip.startBeat, clip.lengthBeats)) {
    toast.error('Clip overlaps an existing clip');
    return state;
  }
}
```

`excludeClipId` in `moveClip` und `resizeClip` bleibt unverändert —
diese Operationen haben ihre eigene Logik die nicht angefasst wird.

### B3 — Renderer: minimaler Eingriff, bestehende Concerns erhalten ✅

Den bestehenden RENDER_ORDER-Loop **nicht** ersetzen sondern
**minimal anpassen**:

```ts
// VORHER (loop.ts ~225):
for (const kind of RENDER_ORDER) {
  const tracksOfKind = tracks.filter(t => t.kind === kindToTrack(kind) && !t.muted);
  for (const track of tracksOfKind) {
    const clip = activeClipOnTrack(track.id, clips, beats);
    if (!clip) continue;
    // ... bestehende Logik: lastFired, clipAlpha, bitmap-Skip, try/catch ...
  }
}

// NACHHER:
// Alle aktiven FX-Clips über alle FX-Tracks sammeln
const activeFxClips = getActiveFxClips(tracks, clips, beats);
// activeFxClips ist bereits nach RENDER_ORDER_TRACK_KIND sortiert

for (const { clip, track } of activeFxClips) {
  // ↓ AB HIER: IDENTISCH mit dem bestehenden Inner-Loop ↓
  const lastFired = lastFiredByClip.get(clip.id) ?? -1;
  // ... clipAlpha, bitmap-Skip, flowMode, resolveClipParams, try/catch ...
  // ↑ KEIN EINGRIFF ↑
}
```

`getActiveFxClips` gibt `Array<{ clip: Clip; track: Track }>` zurück.
Das bestehende Inner-Loop-Innere bleibt **byte-identisch**.

```ts
function getActiveFxClips(
  tracks: Track[],
  clips: Clip[],
  beat: number
): Array<{ clip: Clip; track: Track }> {
  const result: Array<{ clip: Clip; track: Track }> = [];
  for (const track of tracks) {
    if (track.kind !== 'fx' || track.muted) continue;
    // FX-Tracks: ALLE Clips im Beat-Fenster (Overlap erlaubt)
    const active = clips.filter(c =>
      c.trackId === track.id &&
      beat >= c.startBeat &&
      beat < c.startBeat + c.lengthBeats
    );
    for (const clip of active) result.push({ clip, track });
  }
  // Sortierung nach RENDER_ORDER_TRACK_KIND
  result.sort((a, b) =>
    RENDER_ORDER_TRACK_KIND.indexOf(a.clip.kind as TrackFxKind) -
    RENDER_ORDER_TRACK_KIND.indexOf(b.clip.kind as TrackFxKind)
  );
  return result;
}
```

---

## TrackKind vereinfachen

```ts
// lib/timeline/types.ts — NACHHER:
export type TrackKind = 'image' | 'video' | 'audio' | 'fx';

// TrackFxKind als temporärer Migrations-Typ (nur für RENDER_ORDER + Migration):
export type TrackFxKind =
  | 'contour' | 'sweep' | 'pulse' | 'zoom-pulse'
  | 'particles' | 'text' | 'dissolve' | 'sunray';
```

`TrackFxKind` wird nur benötigt für:
1. Migration v5→v6 (erkennen welche Tracks umzustellen sind)
2. `RENDER_ORDER_TRACK_KIND` Konstante
3. `FX_KINDS` Set in `canDropOnTrack`

---

## Migration v5→v6

```ts
if (version < 6) {
  const FX_TRACK_KINDS = new Set<string>([
    'contour', 'sweep', 'pulse', 'zoom-pulse',
    'particles', 'text', 'dissolve', 'sunray'
  ]);

  // Alle FX-spezifischen Tracks → kind: 'fx'
  state.timeline.tracks = state.timeline.tracks.map(t =>
    FX_TRACK_KINDS.has(t.kind)
      ? { ...t, kind: 'fx' as TrackKind }
      : t
  );
  // Clips bleiben mit ihren clip.kind-Werten (unveränderter lowercase)
}
```

**W1 — Append-Default-Tracks-Logik:** Die v4→v5-Migration appended
fehlende Tracks aus `initialTimelineState`. Da `initialTimelineState`
nach 5.9c nur noch 4 Tracks hat, würde die Append-Logik bei v5-Snapshots
fälschlich einen zweiten Image/Video/Audio/FX-Track ergänzen wollen.

Fix: Die Append-Logik bekommt ein `version >= 6`-Gate:
```ts
if (version < 5) {
  // Append-Logic nur für echte v4→v5-Migration (mit alten 8 FX-Tracks)
  appendMissingDefaultTracks(state, INITIAL_TRACKS_V5);
}
// v5→v6: kein append, nur FX-Kind-Rename
```

`INITIAL_TRACKS_V5` ist die alte 10-Track-Liste als frozen const.

---

## `canDropOnTrack` anpassen

```ts
// lib/timeline/track-validation.ts
import type { TrackKind, TrackFxKind } from '@/lib/timeline/types';

const FX_KINDS = new Set<string>([
  'contour', 'sweep', 'pulse', 'zoom-pulse',
  'particles', 'text', 'dissolve', 'sunray'
]);

export function canDropOnTrack(
  clipKind: string,  // lowercase TrackFxKind ODER 'image'|'video'|'audio'
  trackKind: TrackKind
): boolean {
  if (trackKind === 'fx')    return FX_KINDS.has(clipKind);
  if (trackKind === 'image') return clipKind === 'image';
  if (trackKind === 'video') return clipKind === 'video';
  if (trackKind === 'audio') return clipKind === 'audio';
  return false;
}
```

### W3 — `Tracks.tsx` Plugin-Drop-Routing

`components/Workspace/Timeline/Tracks.tsx` nutzt heute
`PLUGIN_TO_TRACK_KIND[plugin.kind]` zum Routing. Das muss auf
`canDropOnTrack` umgestellt werden:

```ts
// VORHER:
const targetTrackKind = PLUGIN_TO_TRACK_KIND[plugin.kind];
const targetTrack = tracks.find(t => t.kind === targetTrackKind);

// NACHHER:
const targetTrack = tracks.find(t =>
  canDropOnTrack(plugin.kind.toLowerCase(), t.kind) && !t.muted
);
// Falls mehrere FX-Tracks vorhanden: ersten nehmen, oder User wählt via Drop-Target
```

**Hinweis:** `plugin.kind` ist PascalCase (`'Contour'`) — `.toLowerCase()`
konvertiert zu `'contour'`. `'zoom-pulse'` bleibt durch
`ZoomPulse → zoom-pulse` via `KIND_TO_TRACK_KIND` — CC #1 soll
prüfen ob ein direkter `.toLowerCase()` ausreicht oder ob
`KIND_TO_TRACK_KIND` besser ist.

---

## W2 — `Track.name` statt `Track.label`

```ts
// lib/timeline/types.ts — korrektes Feld:
export interface Track {
  id: string;
  kind: TrackKind;
  name: string;   // ← nicht 'label'
  muted: boolean;
}

// initialTimelineState.tracks:
{ id: 'track-image', kind: 'image', name: 'Bild',  muted: false },
{ id: 'track-video', kind: 'video', name: 'Video', muted: false },
{ id: 'track-audio', kind: 'audio', name: 'Audio', muted: false },
{ id: 'track-fx-1',  kind: 'fx',    name: 'FX',    muted: false },
```

`defaultNameFor(kind: TrackKind)`: gibt `'FX'` für `'fx'` zurück.
Bei `addTrack('fx')` wenn bereits FX-Tracks vorhanden: `'FX 2'`, `'FX 3'`
etc. (Counter analog zu Multi-Image-Tracks falls vorhanden).

---

## W4 — Clip-Visualisierung: `KIND_COLOR` erweitern

```ts
// components/Workspace/Timeline/Clip.tsx — bestehende KIND_COLOR Map:
// NICHT ersetzen — erweitern:
const FX_CLIP_COLORS: Record<string, string> = {
  'contour':   'var(--a1)',    // purple
  'sweep':     '#e05a7a',      // pink
  'pulse':     '#7a6a3a',      // olive
  'zoom-pulse':'#3a6a7a',      // teal-dark
  'particles': 'var(--a3)',    // teal
  'text':      '#6a3a7a',      // purple-dark
  'dissolve':  '#3a5a3a',      // dark green
  'sunray':    '#7a6a1a',      // gold
};

// In der Clip-Komponente:
const color = FX_CLIP_COLORS[clip.kind] ?? KIND_COLOR[clip.kind] ?? 'var(--surface-3)';
```

---

## W5 — Inspector Header: `clip.kind` zeigen

Entscheidung: Inspector-Header zeigt `clip.kind` (den FX-Typ), nicht
`track.kind` (das wäre immer "FX"). Also: "Contour", "Pulse", etc. —
aber in menschenlesbarer Form:

```ts
const FX_DISPLAY_NAME: Record<string, string> = {
  'contour':   'Contour',
  'sweep':     'Color Sweep',
  'pulse':     'Pulse',
  'zoom-pulse':'Zoom Pulse',
  'particles': 'Particles',
  'text':      'Text',
  'dissolve':  'Dissolve',
  'sunray':    'Sunray',
};
```

---

## `initialTimelineState.tracks` + `addTrack`

```ts
// lib/store/timeline-slice.ts
addTrack: (kind) => set(state => {
  if (kind === 'audio') {
    toast.error('Multi-Audio-Tracks kommen in Plan 5.9d');
    return state;
  }
  const existing = state.timeline.tracks.filter(t => t.kind === kind);
  const name = existing.length === 0
    ? defaultNameFor(kind)
    : `${defaultNameFor(kind)} ${existing.length + 1}`;
  const newTrack: Track = {
    id: crypto.randomUUID(),
    kind,
    name,
    muted: false,
  };
  return { timeline: { ...state.timeline,
    tracks: [...state.timeline.tracks, newTrack] } };
})
```

---

## Offline-Renderer

**Kein Eingriff nötig.** `lib/export/offline-render.ts` nutzt denselben
Render-Loop — die Änderungen in `loop.ts` wirken automatisch auch
für den Offline-Export. Explizit als "no-op for offline path" in
KNOWN_LIMITATIONS vermerken.

---

## Auto-Preset

`/api/analyze-image` Sonnet-Prompt erwähnt TrackKinds — prüfen ob
er `'contour'`, `'pulse'` etc. als `trackKind` ausgibt. Falls ja:
in Plan 5.8b (Inspector Conditional + Auto-Preset-Update) adressieren,
da 5.8b sowieso den System-Prompt aktualisiert. **Kein Blocker für 5.9c.**

---

## Tests (konkrete Cases)

**`tests/unit/timeline/track-validation.test.ts`** (erweitern, ≥ 6):
- `canDropOnTrack('contour', 'fx')` → `true`
- `canDropOnTrack('zoom-pulse', 'fx')` → `true` (lowercase mit Bindestrich)
- `canDropOnTrack('image', 'fx')` → `false`
- `canDropOnTrack('contour', 'image')` → `false`
- `canDropOnTrack('video', 'video')` → `true`
- `canDropOnTrack('audio', 'audio')` → `true`

**`tests/unit/components/Timeline/TrackHeader.test.tsx`** (Verify —
existiert bereits): Mute/Rename/Delete-Tests sind track-kind-agnostisch,
sollten ohne Anpassung grün bleiben. Auf `TrackKind`-Literale prüfen.

**`tests/unit/components/Timeline/AddTrackButton.test.tsx`** (neu, ≥ 3):
`PICKER_OPTIONS` ändert sich von 10 auf 3 Einträge — ohne Test fliegt
das stillschweigend. Cases: 3 Optionen sichtbar, Audio-Option fehlt,
Klick auf FX-Option ruft `addTrack('fx')` auf.

**`tests/unit/timeline/blend.test.ts`** (Verify — existiert bereits):
`makeDefaultBlend` ist kind-neutral, sollte grün bleiben.

**`lib/renderer/loop.ts`** (Verify FxKind-Import-Migration):
`loop.ts:9` importiert heute `FxKind as TrackFxKind` aus
`@/lib/timeline/types`. Nach Löschung von `FxKind` aus `types.ts`
muss dieser Import auf `plugin-mapping.ts` umgepointet oder
entfernt werden. Als expliziten Schritt in der Commit-Reihenfolge aufnehmen.

**`tests/unit/timeline/overlap.test.ts`** (neu, ≥ 4):
- `addClip` auf `fx`-Track: zwei überlappende Clips → beide akzeptiert
- `addClip` auf `image`-Track: Overlap → abgelehnt (hasOverlap bleibt)
- `moveClip` mit `excludeClipId` korrekt (kein Selbst-Overlap)
- `addClip` ohne passenden Track → abgelehnt

**`tests/unit/renderer/fx-multi-clip.test.ts`** (neu, ≥ 5):
- `getActiveFxClips` gibt alle Clips über alle FX-Tracks zurück
- Sortierung: `'dissolve'`-Clip vor `'text'`-Clip
- Gemuteter FX-Track → Clips ausgelassen
- Clip außerhalb Beat-Fenster → ausgelassen
- Zwei `'particles'`-Clips gleichzeitig → beide in Ergebnis

**`tests/unit/store/migration-v5-v6.test.ts`** (neu, ≥ 4):
- v5-Snapshot mit 8 FX-Tracks → alle `kind: 'fx'`, Clips `clip.kind` unverändert
- v5-Snapshot ohne FX-Tracks → unverändert
- Append-Logik feuert NICHT für v5→v6
- v4-Snapshot (mit alter Struktur) → v4→v5→v6 korrekt durchmiriert

Mindest gesamt: **≥ 22 neue Tests** (inkl. AddTrackButton + blend-lifecycle cross-kind)

---

## Risk-Tabelle (mindest 4 Einträge)

| Risk | Mitigation |
|---|---|
| v5-Snapshots mit user-umbenannten FX-Tracks (z.B. "Eigene Sweep") werden zu "FX 1..N" — User-Name verloren | KNOWN_LIMITATIONS-Eintrag; Smoke Gate bestätigt dass Rename intentional ist |
| Multi-FX-Track Drop-Routing: `tracks.find(t => t.kind === 'fx')` nimmt nur ersten Track — bei 3 FX-Tracks landen alle Drops auf Track 1 wenn User nicht direkt auf Track-Slot droppt | Drop-Routing via `data-track-id` in `Tracks.tsx:103` ist bereits präzise; Plan bestätigt dass das erhalten bleibt |
| `__blend`-Cleanup bei Clip-Move auf anderen FX-Track mit cross-kind Overlap hinterlässt stale `__blend` | Entscheidung 5 + cross-kind-Cleanup-Snippet + dedizierter Test-Case in blend-lifecycle.test.ts |
| `migration-v5-v6.test.ts` braucht echten v5-Snapshot als Fixture — synthetische Fixtures können echte Migrations-Bugs verschleiern | `tests/fixtures/timeline-v5.json` aus laufendem Projekt exportieren und als Pre-condition anlegen |

---

## Verification Gate

Baseline: aktueller HEAD nach 5.9b.
Ziel: **≥ Baseline + 22 Tests**. Bundle ≤ Baseline + 2%.

```powershell
npm test -- --run    # 0 failing
npm run typecheck
npm run lint
npm run build
```

## Smoke Gate

```
npm run dev
# "Track hinzufügen" zeigt 4 Optionen (Bild/Video/Audio/FX)
# addTrack('audio') → Toast "Plan 5.9d"
# FX-Track hinzufügen → neue Zeile "FX 2" wenn bereits einer da
# Contour-Clip auf FX-Track → landet korrekt (lowercase 'contour')
# Particles-Clip auf denselben FX-Track → Overlap erlaubt
# Bild-Clip auf FX-Track → Toast
# Inspector für Contour-Clip → Header zeigt "Contour" nicht "FX"
# RENDER_ORDER: Dissolve rendert unter Text wenn beide aktiv
# Bestehende v5-Projekte → laden sauber, Clips erhalten
```

## Commit-Struktur

```
feat(timeline): TrackKind = 'image'|'video'|'audio'|'fx' + TrackFxKind
feat(store): migration v5→v6 + append-gate für v4→v5
feat(timeline): canDropOnTrack lowercase FX_KINDS
feat(timeline): hasOverlap gate in addClip — fx-tracks skip overlap
feat(renderer): getActiveFxClips + RENDER_ORDER_TRACK_KIND + minimal loop refactor
feat(timeline): Tracks.tsx plugin-drop via canDropOnTrack
feat(ui): FX_CLIP_COLORS + FX_DISPLAY_NAME für Inspector-Header
test: validation + overlap + renderer-multi + migration coverage
docs: KNOWN_LIMITATIONS offline-path note
```

## Out of Scope
- Auto-Preset System-Prompt Update (Plan 5.8b)
- Drag-Reorder von Tracks (v0.2)
- Clip-Farbe durch User wählbar (v0.2)

Abgabe: `2026-05-21-vibegrid-plan-5_9c-fx-consolidation.md`
