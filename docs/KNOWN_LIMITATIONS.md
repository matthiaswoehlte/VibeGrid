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

---

## Plan 5.9d — Multi-Audio + Volume + Video-Audio

- **Video-audio volume is not automatable.** Per-clip toggle on/off
  via Inspector; `audioEnabled` is boolean only. In v0.2, route video
  audio through a `MediaElementAudioSourceNode` + GainNode for full
  automation parity with audio clips.
- **Offline mix sample rate hardcoded to 48 kHz** (`EXPORT_SAMPLE_RATE`
  in `lib/export/mix-audio-offline.ts`). Matches the WAV/MP4 standard
  and what the WebCodecs AudioEncoder expects downstream. Some older
  Android browsers only support 44.1 kHz in `OfflineAudioContext` and
  throw `NotSupportedError` — out-of-scope for v0.1 (Vercel/desktop
  target). Live `AudioContext` uses the browser default, so the
  live-preview rate may differ from the export rate; inaudible in
  practice.
- **Volume automation on a 0.1-beat raster in the offline export.**
  Fine for slow ramps (audibly smooth) but sub-0.1-beat volume stabs
  get quantised. Live preview is per-frame ramp (~16.7 ms at 60 fps)
  → no quantisation there; the divergence is offline-only.
- **Offline mixdown peak-normalises at 0.95 when the summed peak
  exceeds 1.0.** Prevents hard clipping but does not target a
  specific LUFS level. Loudness-compatibility with streaming
  platforms (Spotify −14 LUFS, YouTube −14 LUFS) is the user's job
  via external mastering.
- **No per-track master volume.** Each clip's `volume` param controls
  itself; there is no track-level gain layer between the clip's
  GainNode and `destination`. v0.2 adds track-level mute states +
  master gain.
- **No audio-clip trim / in-out points in v0.1.** Clips always play
  from the start of their underlying media file. v0.2 adds
  `clipStartInMediaSec` / `clipDurationInMediaSec` fields plus the
  Inspector controls.
- **Single-buffer soundtrack autoload coexists with per-clip
  playback.** `useAudioEngine` still autoloads the latest audio
  MediaRef as the global soundtrack (for BPM detection + the
  AnalyserNode-backed waveform). The new per-clip path in the
  reconciler runs in parallel. If a user drops the same audio file
  on an audio track AND it's also the autoloaded soundtrack, both
  paths play simultaneously → double volume. v0.2 unifies via a
  `MediaElementAudioSourceNode` master path.
