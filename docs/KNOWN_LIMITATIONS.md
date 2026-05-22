# Known Limitations — VibeGrid v0.1

This file is the canonical reference for v0.1 caveats. Each section is filled in by the plan that lands the corresponding feature.

## Export (Plan 6 + Plan 6-R)

VibeGrid exports via two paths, auto-selected by browser capability.

### Offline render (preferred, Plan 6-R, WebCodecs)

- **Frame-by-frame at 1920×1080 / 30 fps / 8 Mbit/s video / 128 kbit/s
  audio.** Decoupled from preview FPS — a 24 fps preview still produces
  a buttery-smooth 30 fps output. Render time depends on project
  complexity, typically 1–3× realtime on a modern desktop.
- **Codec preference:** H.264 + AAC MP4 (`avc1.42E01E`) → VP9 + Opus
  WebM (`vp09.00.10.08`). Codec is picked once at start via
  `VideoEncoder.isConfigSupported`; the UI toasts the selection.
- **Video bitrate bump from 6 → 8 Mbit/s** compared to the realtime
  path. The realtime constraint is gone in offline mode, so we spend
  a bit more on quality.
- **Browser support:** Chrome 94+, Edge 94+, Safari 17.4+ (older Safari
  has VideoEncoder but missing AudioEncoder), Firefox 130+. Anything
  older falls back to the realtime path automatically.
- **Progress UI:** `Rendering X / Y (Z%) · ETA M:SS` + teal progress
  bar + ✕ Cancel. Cancel aborts the encoder synchronously; no partial
  file is written.
- **Memory:** `mp4-muxer` keeps the entire output in RAM (`fastStart:
  'in-memory'`) until finalize. ~300 MB peak for a 5-minute 1080p clip.
  Acceptable for v0.1; switch to `StreamTarget` if longer projects
  become routine.
- **Particles spawn non-deterministic across runs** — two consecutive
  offline exports of the same project produce slightly different
  particle layouts. Intentional v0.1 scope decision; visually
  imperceptible. Future plugins with stochasticity should follow the
  same convention or revisit with seed-per-frame PRNG.

### Realtime record (fallback, Plan 6, MediaRecorder)

- **Realtime constraint.** Plays the entire audio through and records
  in real time — a 3-minute song takes 3 minutes to export. Bound to
  preview FPS: a 24 fps preview produces a 24 fps video. Used when
  WebCodecs is unavailable (Firefox < 130, very old Safari).
- **Tab focus required.** When the browser tab is in the background,
  RAF is throttled to ~1 Hz. We surface a persistent warning toast,
  but the export keeps running and will likely drop frames. Keep the
  tab active for clean output. (Offline rendering has the same RAF
  throttle but the encoder owns pacing — render just takes longer.)
- **Codec preference:** MP4 (H.264 + AAC) → WebM (VP9 + Opus) →
  WebM (VP8 + Opus) → WebM (default), 6 Mbit/s video + 128 kbit/s audio.
- **WebM duration patched via `fix-webm-duration`, MP4 unpatched.**
  MediaRecorder writes the EBML Duration element before it knows how
  long the recording will run; we rewrite that field after Blob
  assembly. MP4 from modern Chromium / Safari has a correctly-
  finalised moov atom out of the box.

### Both paths

- **Single visual-clip-at-beat-0 requirement.** The Export button is
  disabled when no image OR video clip starts at beat 0 — the export
  would otherwise produce a black opening frame. (Updated in Plan 5.9c
  to accept video clips after the FX-Track Consolidation.)
- **No quality / bitrate UI.** Fixed-quality presets for v0.1.
- **Filename:** `vibegrid_export_<ISO without colons>.<mp4|webm>`.
  Auto-downloads via an anchor element; the object URL is revoked
  after 10 s.

## Dev Dependencies — accepted vulnerabilities (Plan 0)

After `npm install`, `npm audit` initially reported **15 vulnerabilities (5 mod / 8 high / 2 critical)**. Plan 0 applied `npm audit fix --force` selectively:

**Applied (no breaking changes):**

- `next` `14.2.5` → `^14.2.35` (patch, in-range)
- `@playwright/test` `1.45.0` → `^1.60.0` (minor, dev-only)
- `@vitejs/plugin-react` `4.3.1` → `^4.7.0` (minor, dev-only)
- `vitest` `1.6.0` → `^1.6.1` (patch, dev-only)
- `eslint-config-next` was bumped to `^16.2.6` by `--force` but **rolled back** to `^14.2.35` because ESLint config could no longer load (circular structure error).

**Remaining 9 vulnerabilities (5 mod / 4 high — no critical):**

| Package | Severity | Range | Patched in | Why we don't bump |
|---|---|---|---|---|
| `next` | high × 3, mod × 4 | `>=14.2.0 <15.5.16` | `15.5.16+` / `16.x` | Spec §2 pins **Next.js 14**. Bumping to 15/16 is a breaking-change scope decision deferred to a future minor release. |
| `postcss` (via `next`) | mod | `<8.5.10` | with Next 15/16 | Same — transitive, fixed by Next bump. |
| `esbuild` (via `vitest`) | mod | `<=0.24.2` | `vitest@4` | Bumping vitest 1 → 4 is a major dev-tooling change; not justified for v0.1 since vitest is dev-only and esbuild is not exposed at runtime. |

**Risk assessment for v0.1:**

- All remaining `next` advisories are in attack vectors VibeGrid does not use in v0.1: no Middleware, no Pages Router, no i18n, no WebSocket upgrades, no Image Optimization API (Spec §3.1, §7 — only `/api/upload` POST with magic-byte MIME validation). The realistic exposure is **none** for the v0.1 scope.
- `postcss` XSS via `</style>` requires user-controlled CSS — VibeGrid emits no user CSS.
- `esbuild` advisory only affects local dev servers — never reachable in production.

**Revisit:** During v0.2 planning, re-run `npm audit` and decide whether the Next 15/16 upgrade is in scope. If not, re-confirm the risk assessment.

## Storage & AI (Plans 4 + 5)

### R2 public URL requirement (Plan 4 + Plan 5 Auto-Preset)

`/api/upload` returns `MediaRef.url` built from `${R2_PUBLIC_URL}/{key}`.
`/api/analyze-image` (Plan 5) re-fetches that URL server-side to send the
image to Claude. **Both require the R2 bucket to be reachable over HTTPS
without signed URLs.** R2 itself does not serve over public HTTPS without
a Cloudflare-attached custom domain — set `R2_PUBLIC_URL` to that custom
domain. v0.2 will introduce signed-URL fallbacks when buckets go private.

### Vercel hobby tier payload limit (Plan 4)

Vercel Hobby caps API-route payloads at 4.5 MB. Audio uploads can be up to
50 MB (Spec §7.1). Upgrade to Vercel Pro for full audio support, or run
the dev server locally for files > 4.5 MB.

### Auto-Preset cost & rate-limiting (Plan 5)

`POST /api/analyze-image` calls Claude Sonnet 4.6 once per click — no
client-side debounce, no server-side rate-limit. Each call costs a few
cents at current pricing. v0.2 will add a 2-second debounce on the ✨
button and an optional per-session ceiling.

## Video clips (Plan 5.9b)

- **Max. 5 Minuten pro Video-Clip** — client-side pre-check rejects
  longer files before upload starts (`getVideoDuration` reads
  metadata, no bandwidth wasted).
- **Unterstützte Formate**: MP4 (H.264) and WebM (VP9). MOV is
  rejected — its codec landscape (ProRes, HEVC variants, …) breaks
  browser decoding too often to support in v0.1.
- **Max. 500 MB upload size** — server-side check in `/api/presign`.
- **Video-Audio is opt-in per clip** via the Inspector's
  `audioEnabled` toggle (Plan 5.9d). Default is muted to preserve the
  pre-5.9d "no second audio clock" guarantee. The toggle takes
  effect live in the preview (sets `videoEl.muted`) and in the
  offline export (extracts the embedded audio via `decodeAudioData`
  and mixes it into the final track). Video-clip volume itself is
  not automatable in v0.1 — see the Plan 5.9d section below.
- **Contour and ZoomPulse FX over video** work via a per-tick
  ImageBitmap snapshot (`OffscreenCanvas.transferToImageBitmap`) for
  ZoomPulse and a 500 ms bucket-cached extraction for Contour edges
  (Plan 5.9b hotfix). Live preview hitches ~50-200 ms per Contour
  bucket transition (`extractContours` is synchronous and CPU-bound
  — Web Worker offload is a v0.2 follow-up). Offline export hides
  the hitch because the encoder owns pacing.
- **Offline export with video is 5-15× slower than realtime**. Each
  frame must `await videoEngine.seekAllTo(timeSec)` so the video
  element settles on the exact frame before the canvas snapshot.
  `requestVideoFrameCallback` on Chrome / Edge / Firefox 130+ keeps
  it at the lower end of the range; older Safari / Firefox use the
  `seeked` event and are noticeably slower.
- **R2 CORS must allow PUT** for the browser origin (Presigned
  upload). The existing image-CORS only includes GET. Add the
  origin to the Cloudflare R2 bucket's CORS settings under
  AllowedMethods.
- **Auto-Preset (✨) ignores video clips**. The Claude system prompt
  has no awareness of video; it only suggests FX for image clips.
  Plan 5.8b will update the analyzer.
- **Video trimming / in-out points** is a v0.2 feature. The clip
  uses the full source from t=0; lengthening is via the
  `lengthBeats` resize handle like any other clip.
- **4K video** is not tested in v0.1 — the pipeline is resolution-
  agnostic but the smoke gate is 1080p only.
- **Reorder-UI for tracks** is a v0.2 feature. The `reorderTracks`
  store action exists but no drag-rearrange in the lane header.

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

---

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
