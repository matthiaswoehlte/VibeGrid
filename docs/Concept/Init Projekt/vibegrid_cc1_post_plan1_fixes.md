# CC #1 Feedback — nach Plan 1 QA

Plan 1 ist freigegeben. Zwei kleine Fixes vor Plan 2:

## Fix 1: partialize — playhead.playing auf false beim Persistieren

```ts
// lib/store/index.ts — partialize anpassen:
partialize: (state) => ({
  ui: state.ui,
  timeline: {
    ...state.timeline,
    playhead: {
      ...state.timeline.playhead,
      playing: false   // Nach Reload nie "playing" — Audio läuft nicht mehr
    }
  }
})
```

Commit: `fix(store): reset playhead.playing to false on persist`

## Fix 2: Kommentar in activeImageClip

```ts
// lib/timeline/selectors.ts — Kommentar ergänzen:
export function activeImageClip(state: TimelineState, beats: number): Clip | null {
  // Returns the FIRST matching image clip in array order.
  // v0.1: only one image track is expected, so order is deterministic.
  // v0.2: if multiple image tracks are allowed, sort by track.order first.
  for (const c of state.clips) {
```

Commit: `docs(timeline): clarify activeImageClip ordering behaviour`

---

Danach: Plan 2 (Audio Engine) schreiben und zur Review schicken.
