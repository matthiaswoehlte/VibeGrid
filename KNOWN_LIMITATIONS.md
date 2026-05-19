# Known Limitations — VibeGrid v0.1

This file is the canonical reference for v0.1 caveats. Each section is filled in by the plan that lands the corresponding feature.

## Export (Plan 6)

_To be filled in by Plan 6._

- WebM not natively playable in iOS Safari (relevant for v0.2 Capacitor build).
- Realtime export — user must not switch tabs (browsers throttle RAF in the background).
- Browser-specific codec support varies.

## Manual verification checklist (run before release)

_To be filled in incrementally. Source of truth: spec §11.7._

- [ ] Image upload → canvas shows image.
- [ ] Audio upload → waveform visible.
- [ ] "Detect BPM" → progress indicator, value applied.
- [ ] Play → all 4 FX fire visibly at least once.
- [ ] Inspector slider changes FX param live.
- [ ] Export starts, REC indicator visible.
- [ ] Exported WebM opens in VLC / Chrome.
- [ ] Retina display: canvas output sharp (DPR fix verified).
- [ ] Tab switch during recording: warning toast appears.
- [ ] Export filename has correct timestamp (no `undefined`).
- [ ] Memory not permanently elevated after export (object URL revoked).
