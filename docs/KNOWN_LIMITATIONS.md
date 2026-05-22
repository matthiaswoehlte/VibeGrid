# VibeGrid — Known Limitations

Living record of design constraints and intentional rough edges per
plan. Entries are scoped to a single plan and updated when behaviour
changes.

---

## Plan 5.9c — FX-Track Consolidation

- **Offline render path:** No separate eingriff. `lib/export/offline-render.ts`
  drives the same `tick()` machinery as the live preview via
  `makeOfflineRenderer` — whatever the renderer's `getActiveFxClips`
  iteration does for FX clips on `'fx'` tracks, the offline export
  does too. Confirmed by `tests/unit/renderer/fx-multi-clip.test.ts`
  exercising the selector that both code paths consume.
- **v5 → v6 store migration:** the `v4 → v5` append-default-tracks
  logic is now gated to `version < 5`. A v5 user upgrading to v6 will
  NOT get phantom duplicate lanes; the FX-per-kind tracks in their
  snapshot are rewritten in place to `kind: 'fx'`. User-renamed track
  labels (e.g. "Mein Custom Sweep") are preserved.
- **Multi-FX-Track drop precision:** drops via the plugin-badge palette
  fall back to the first non-muted `'fx'` track when the drop target
  has no `data-track-id`. Direct drops onto a specific FX lane (the
  user explicitly drops on lane "FX 2") keep using the explicit target,
  so users with 3 FX tracks who drop on track 2 land on track 2.
- **Transitional `Track.kind` widening:** `Track.kind` is typed as
  `TrackKind | TrackFxKind` for the duration of Plan 5.9c so existing
  test fixtures with legacy FX-kind literals (`{ kind: 'pulse', … }`)
  still typecheck. Runtime values are always in the narrow
  `TrackKind` after the v5→v6 migrate runs. Plan 5.9c's final
  follow-up task narrows the type back; the widening is dead code
  in production and only kept to ease incremental migration of
  test fixtures.
- **`__blend` and cross-kind FX overlaps:** when an `'fx'` lane carries
  two clips of DIFFERENT kinds that overlap in beats, neither clip
  gets a `params.__blend` curve. Plugin parameter sets are disjoint
  across plugins so a crossfade would interpolate the wrong values
  into the wrong plugin. Same-kind overlaps on the same lane keep
  their crossfade behaviour.
