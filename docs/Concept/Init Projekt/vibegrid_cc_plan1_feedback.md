# CC Feedback — Plan 1: Timeline Module

✅ Freigegeben — exzellenter Plan, Test-First durchgehend sauber.
Vier Open Questions beantwortet + ein Bug gefunden.

## Antworten auf die 4 Open Questions

**1. resizeClip overlap check → BEHALTEN**
Konsistenz über alle mutierenden Operations ist wichtiger
als strenge Spec-Treue. Ein Resize der in einen anderen
Clip ragt soll genauso werfen wie addClip/moveClip.

**2. Mute filtering in selectors → BESTÄTIGT**
`activeClipsAt` und `activeFxClipsByKind` filtern NICHT nach mute.
Mute ist Render-Time-Concern (Renderer prüft `track.muted`).
Der Test in Task 5 ("does not filter by track mute") ist korrekt.

**3. setClipParams → SHALLOW MERGE bestätigt**
`{ ...existing, ...incoming }` — nicht replace.
Begründung: Inspector-Slider-Updates ändern nur einen Param,
nicht das gesamte Params-Objekt.

**4. Timecode Format → `m:ss` reicht für v0.1**
Aber: Implementierung muss konsistent sein —
entweder immer `m:ss` oder immer `mm:ss`.
`'4:00'` und `'0:30'` in den Tests zeigen `m:ss` (kein Padding
auf Minuten) — das ist fine, aber in `beatsToTimecode` explizit
kommentieren dass Minuten NICHT zero-padded sind.

---

## Bug: addClip Signatur-Konflikt zwischen Operation und Store-Test

In Task 11 Step 4 (Store-Test) wird `addClip` mit einem
vollständigen `Clip` inkl. `id` aufgerufen:

```ts
timelineActions.addClip({
  id: 'a',          // ← ID wird vom Caller bereitgestellt
  trackId: 't1',
  ...
})
```

Das setzt voraus dass `ops.addClip(state, clip: Clip)` eine
vollständige `Clip` erwartet. Aber der Spec-Kommentar in
`operations.ts` (aus Sektion 4) hatte `Omit<Clip, 'id'>` mit
ID-Generierung in der Operation.

**Entscheidung jetzt treffen — wähle eine der zwei Optionen:**

**Option A (empfohlen): Caller liefert ID**
```ts
// operations.ts:
export function addClip(state: TimelineState, clip: Clip): TimelineState

// Store-Test bleibt wie geschrieben — korrekt
// UI-Layer generiert ID via crypto.randomUUID() vor dem Aufruf
```

**Option B: Operation generiert ID**
```ts
// operations.ts:
export function addClip(
  state: TimelineState,
  clip: Omit<Clip, 'id'>
): TimelineState  // gibt state zurück, ID ist intern generiert

// Problem: pure function mit crypto.randomUUID() —
// nicht 100% deterministisch, schwerer testbar
// Store-Test muss angepasst werden
```

**Meine Empfehlung: Option A** — Caller liefert ID.
Einfacher testbar, keine Abhängigkeit von randomUUID in
der pure function. Store-Test bleibt wie geschrieben.

Bitte diesen Konflikt vor Task 7 (addClip Implementation)
auflösen und die Entscheidung in einem Kommentar in
`operations.ts` dokumentieren.

---

## Kleinigkeit: freezeState Helper und Arrays

`Object.freeze` auf einem Array friert das Array selbst ein
(kein push/pop), aber NICHT die Objekte darin.
Der Helper `freezeState` iteriert via `Object.keys` —
für Arrays liefert das die Indices als Strings, was funktioniert.
Sicherheitshalber explizit kommentieren:

```ts
/** Deep-freeze including array elements — Object.keys on arrays
 *  returns string indices ('0', '1', ...) which is intentional. */
export function freezeState<T extends object>(value: T): T {
```

---

## Bestätigung: Was explizit gut ist ✅

- Half-open interval Semantik `[start, start+length)` klar
  dokumentiert und in Tests abgedeckt (touch = kein overlap)
- `excludeClipId` in hasOverlap für move/resize — sauber
- `FxKind = Exclude<TrackKind, 'image'>` — typsicher
- `SNAP_TO_BEATS` als Record — kein switch/case, erweiterbar
- `Object.setPrototypeOf` in OperationError — ES-Target-safe
- `timelineActions` als gruppierter Key — partialize trivial
- Alle Tests inline gebaut, keine shared mutable fixtures
