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

- **Single-image-clip-at-beat-0 requirement.** The Export button is
  disabled when no image clip starts at beat 0 — the export would
  otherwise produce a black opening frame.
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
