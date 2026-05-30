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

## Plan 5.10+ — Offline-Export Video Pipeline (VideoDecoderPool)

The offline MP4 export now uses **WebCodecs `VideoDecoder` + mp4box.js**
to source video frames, replacing the previous HTMLVideoElement
seek-and-draw pipeline. Background and gotchas:

- **Why the switch:** the HTMLVideoElement path relied on the browser
  compositor painting a near-invisible (`<video>` 1px / opacity:0.001)
  element so `requestVideoFrameCallback` would fire and the frame
  buffer would refresh. Modern Chromium aggressively optimises away
  paints of effectively-invisible elements → no rVFC → seekElement's
  fallback (`seeked` + rAF) resolved with `readyState=1` (metadata
  only, no decoded frame) → `drawImage(videoEl)` read stale frame 0
  on every output frame → exported MP4 = first-frame still image.
  Smoke-confirmed via per-frame diagnostic logs in the export path.
- **New path:** `lib/video/decoder-pool.ts` fetches the MP4 binary,
  demuxes via mp4box, feeds `EncodedVideoChunk`s to a `VideoDecoder`,
  and serves decoded `VideoFrame`s out of an 8-frame sliding cache.
  No DOM, no compositor, no `<video>` element. Frame-accurate by
  construction.
- **Live preview is unaffected:** `lib/video/engine.ts` (HTMLVideoElement
  pool) still powers the studio's real-time playback. The two systems
  coexist — different consumers, different access patterns.
- **Browser support:** WebCodecs `VideoDecoder` is Chrome 94+,
  Edge 94+, Firefox 130+, Safari 16.5+. Plan 6-R already requires
  WebCodecs for the encoder, so the compatibility matrix is unchanged.
- **Decoder pre-load failure handling:** if a video can't be decoded
  (network, codec unsupported by user's browser, malformed MP4),
  `useVideoExporter` toasts a warning and continues. Affected clips
  render black in the output; the user can re-encode the source and
  re-import.
- **Per-clip start-time offset is NOT yet handled:** the renderer
  fetches `getFrameAt(mediaId, globalTimeSec)` — same semantic as the
  old `seekAllTo(globalTimeSec)`. A video clip with `startBeat > 0`
  will show frame N (= globalTimeSec) of its source rather than frame
  0 at the clip's start. v0.1 export gate requires a visual clip at
  beat 0 (`hasVisualClipAt(timeline, 0)`) which keeps the common case
  correct; per-clip-relative time is a v0.2 follow-up.
- **Backward seek cost:** when `getFrameAt` is called with a target
  before the decoder's current position, the source flushes and
  re-feeds from the nearest preceding keyframe. Offline export
  iterates frames forward sequentially so this almost never fires;
  manual scrubbing on a clip-trim would hit it.

---

## Plan 5.8b — Inspector Conditional Visibility

`visibleWhen` is purely a render-time filter in the Inspector. Three
semantics to be aware of:

- **Store values survive hide/show toggles.** A param hidden because
  its gating predicate returned false keeps its current value (and
  any AutomationCurve) in the Zustand store. Flipping the gating
  param back so the row reappears restores everything as it was.
- **AutomationCurves of hidden params remain active in the renderer.**
  `resolveParam` (`lib/automation/resolve.ts`) does not consult
  `visibleWhen` — by design. If the gating param itself is automated
  and flips on/off across beats, the gated param's curve continues
  to influence rendering on every frame the gate is open. Hiding the
  curve mid-clip would introduce a visible snap; surfacing the
  rendered value is the safer default.
- **Auto-Preset proposes values for hidden params too.** The Claude
  vision endpoint suggests values for every key in the schema,
  regardless of which row is currently visible in the Inspector.
  After a preset, values for currently-hidden params may be
  pre-populated; they become user-visible the moment the gating
  param is toggled back on. This is feature, not bug — users see
  sensible defaults already in place when they enable a sub-feature.

---

## Mobile (Plan 5.10) — Responsive Layout

Plan 5.10 ships a Mobile-first layout (≤ 768 px viewport) that runs
alongside the locked Desktop tree. Six known limitations that don't
block the v0.1 Mobile experience but matter for the v0.2 / Capacitor
roadmap:

- **iOS Safari MediaLibrary drag-to-timeline is broken.** The
  `MediaLibrary` component (and its Mobile wrapper `MediaDrawer`)
  uses native HTML5 `draggable=` + `dataTransfer` for drag-to-
  timeline. Native HTML5 drag is not implemented on iOS Safari and
  inconsistent on Chrome Mobile. **Workaround on iOS**: use the
  file-picker buttons (`+ Image`, `+ Audio`, `+ Video`) to add media
  refs — once the MediaRef exists, you can drag from the drawer to
  the timeline only on Android Chrome. **Follow-up**: migrate
  MediaLibrary items to `@dnd-kit` (Option A in CC1's addendum) OR
  add a tap-to-add-at-playhead button per Mobile media item analogous
  to the FXDrawer's tap-to-add (Option B). FXDrawer already uses
  tap-to-add — only Media is affected.

- **Virtual keyboard layout-shift not handled.** Opening the iOS /
  Android virtual keyboard (e.g. tapping the BPM input) shrinks the
  viewport without notifying matchMedia, so `useIsMobile()` doesn't
  re-evaluate and the fixed-position drawers / sheets may overlap the
  keyboard. v0.2 with Capacitor adds the platform-level
  `visualViewport` API listener.

- **Landscape orientation untested.** The smoke gate targets iPhone
  15 Pro portrait (393 × 852 px). Landscape puts the Stage at 40 vw
  which is too narrow for the 16:9 canvas. Orientation-lock or a
  separate landscape layout is v0.2 + App Store work.

- **Pinch-zoom does not pivot on the touch center.** The
  `useTimelinePinchZoom` hook updates `timeline.zoom` correctly but
  does NOT re-anchor `scrollLeft` so the pixel under the user's
  fingers stays under their fingers across the zoom. Current
  behavior anchors zoom to the left edge of the visible area —
  pinch FEELS like a slider, not a true map-style pinch. v0.2
  computes the pinch-center pixel coordinate and adjusts `scrollLeft`
  per zoom delta to compensate.

- **Capacitor iOS / Android build deferred to v0.2.** The Mobile
  layout is a web-only responsive layer. App Store / Play Store
  packaging via Capacitor (with the native bridge to filesystem,
  audio session, background mode) is its own plan.

- **No Mobile-specific onboarding.** A first-time Mobile user sees
  the same empty Timeline + media-upload buttons a Desktop user
  does. A guided "tap +Image, tap +Audio, tap an FX, tap Play"
  onboarding flow is UX-polish for v0.2.

---

## Plan 7 — Better-Auth Login + VG_projects

### Auth-Stack: Better-Auth, NOT Supabase Auth

VibeGrid teilt eine bestehende Supabase-Postgres-Instanz mit anderen Apps der gleichen Org. Die Instanz nutzt **Better-Auth** für User-Management (Tabellen: `"user"`, `account`, `session`, `passkey`, `twoFactor`, `verification`). Konsequenzen:

- VibeGrid läuft Better-Auth in einer eigenen Instanz (`lib/auth/better-auth-server.ts`) mit `cookiePrefix: 'vibegrid'`. Die Cookie ist getrennt von anderen Apps.
- v0.1 aktiviert NUR `emailAndPassword`. Keine OAuth-Provider, kein Signup, keine 2FA/Passkey-Flows in VibeGrid (auch wenn die DB-Tabellen für andere Apps existieren).
- User mit aktivem 2FA bei der Schwester-App: Login in VibeGrid schlägt fehl. Workaround v0.1: 2FA-User loggt sich bei der Schwester-App ein, dort 2FA deaktivieren, in VibeGrid neu einloggen, später wieder aktivieren. v0.2: 2FA-Plugin in VibeGrid Better-Auth aktivieren.
- Domain-Strategie v0.1: VibeGrid läuft auf eigener Domain → separater Login-Schritt. SSO-Cookie-Share via Parent-Domain ist v0.2 wenn Subdomain-Setup steht.

### Service-Role-only DB-Zugriff für VG_projects

Better-Auth gibt keine Supabase-Auth-JWTs aus → klassische Supabase-RLS-Policies via `auth.uid() = user_id` funktionieren nicht. Authz läuft server-side:

- VG_projects ist `REVOKE ALL FROM anon, authenticated` + RLS-Policy `USING (false)` für Defense-in-Depth.
- Schreib-/Lesezugriff ausschließlich via Next.js API-Routes mit Service-Role-Connection (`lib/db/pg.ts`), gefiltert nach `session.user.id`.
- Falls jemals der Anon-Key in einem Client-Bundle leaked: VG_projects bleibt unerreichbar.

### Two-tier session enforcement (cookie-check + API-side validation)

Next.js 14 Middleware läuft im Edge Runtime — `pg` ist dort nicht ladbar. Die Middleware (`middleware.ts`) prüft daher NUR die Anwesenheit der `vibegrid.session_token`-Cookie, ohne DB-Roundtrip. Die echte Session-Validierung passiert in jeder API-Route via `auth.api.getSession({ headers })` (Node-Runtime).

Konsequenzen:

- **Tampered oder DB-seitig abgelaufene Cookie** kann durch die Middleware durch → `/studio`-Shell rendert. Beim ersten API-Call (Project-Liste laden) kommt 401 zurück. Der `api-client.ts`-`json<T>`-Helper fängt 401 ab und redirected via `window.location.assign('/login?expired=1')`.
- **Window flash für expired sessions**: Wenige Millisekunden zwischen Shell-Render und Redirect zeigen den leeren Studio-Skelett-State. In v0.1 akzeptiert; v0.2 fügt einen Server-Component-Session-Check im `/studio`-Layout hinzu, der diesen Flash eliminiert.
- **Logout-Race**: Falls ein User in Tab A Logout klickt und Tab B parallel ein API-Action triggert, kann Tab B den Server-401 erst nach dem Logout-Roundtrip sehen. Akzeptabel.

### Store-Migration beim Projekt-Laden

Beim `Load Project` läuft die existierende `migrate(persistedState, version)`-Kette (`lib/store/index.ts:14`) auch für DB-gespeicherte Snapshots. Ein Projekt das mit Store-v4 gespeichert wurde wird beim Laden zu v6 migriert. Der DB-Eintrag selbst bleibt unverändert (no in-place upgrade) — erst beim nächsten Save wird der upgraded State zurückgeschrieben.

### Auto-Save-Semantik

- Nur aktiv wenn `useCurrentProject.projectId !== null` (Projekt wurde mindestens einmal explizit gespeichert).
- 30 Sekunden debounced — schnelle Sequenz von Store-Updates ergibt EIN Netzwerk-Roundtrip.
- Fehler werden silently swallow'd — der nächste explizite Save zeigt den Toast. v0.2: Sticky Toast mit Retry für persistente Save-Failures.
- **Tab-Close verliert pending Auto-Save** — `setTimeout` läuft nach Unmount nicht mehr. v0.2: `beforeunload`-Handler + `navigator.sendBeacon`-Endpunkt der PATCH verarbeitet.

### R2-Key-Format

`{userId}/{projectId}/{kind}/{uuid}.{ext}` (Spec §7) bleibt in v0.1 weiterhin `anonymous/default/…` — der Upload-Pfad wurde von Plan 7 NICHT angefasst, weil Bestandsuploads vorher unter dem Anonymous-Key liegen und ein Live-Rename komplex wäre. Konsequenz: in v0.1 sehen alle eingeloggten User dieselben R2-Buckets-Inhalte, sind aber per VG_projects.state.media.mediaRefs-Sichtbarkeit nur an ihre eigenen Projekt-Snapshots gebunden. v0.2 migriert Upload-Pfade auf echte userId/projectId und stellt einen Backfill-Script bereit.

### Hidden params bei Auto-Preset (carry-over aus Plan 5.8b)

Unverändert — siehe Plan 5.8b-Section.

---

## Plan 8a — SceneFlow Fundament

### Reine Fundament-Schicht — kein KI-Funktionsumfang

Plan 8a liefert nur die Infrastruktur: zweiter Tab "SceneFlow", drei neue
DB-Tabellen (`VG_characters`, `VG_stories`, `VG_story_scenes`), CRUD-API,
Character Manager UI, leere Storyboard-Shell. Echte fal.ai-Calls, Sonnet-
Aufteilung, TTS und der "In-VibeGrid-öffnen"-Transfer kommen in 8b/8c/8d.

Konsequenzen für Tester:
- `+ Neue Story` legt einen Story-Record an, der bis 8b leer bleibt (keine
  Szenen-Befüllung möglich, kein Storyboard-View).
- `Bild-Prompt → Generieren`-Button in der Character-Form ist disabled
  und mit Tooltip "Aktiv ab Plan 8c" versehen.
- `lib/fal/client.ts` ist ein Stub — jeder Call wirft `Error('… not
  implemented until Plan 8c')`. Tests pinnen das.

### Mode-Switch erhält State, kostet aber Render-Cost

Beim Tab-Wechsel werden Workspace und SceneFlowShell NICHT unmounted —
sie bekommen `display: none`. Begründung: ein Unmount würde den AudioEngine
und den VideoDecoderPool zerstören, alle Pre-Loads wären weg. State-
Persistenz übersteigt die paar Frames Render-Cost.

SceneFlow-Shell ist `lazy-mounted`: der erste Klick auf "SceneFlow" mountet
sie, danach bleibt sie im Tree. Ein User, der ausschließlich VibeGrid nutzt,
zahlt keinen Initial-Render für SceneFlow.

### Character-Reference-Image-Upload re-uses `/api/upload`

Character-Bilder laufen durch denselben R2-Upload-Pfad wie VibeGrid-
Medien (`createR2StorageAdapter().uploadImage()`). Sie landen unter
`anonymous/default/image/{uuid}.png` — der R2-Key-Migration-Punkt aus
Plan 7 KNOWN_LIMITATIONS gilt unverändert. Wir extrahieren nur die `.url`
und schreiben sie in `VG_characters.reference_image_url`; der MediaRef
wird NICHT in die VibeGrid-Mediathek eingehängt.

### fal.ai-Setup vor Plan 8c

`FAL_KEY` muss in `.env.local` gesetzt sein bevor 8c implementiert wird.
In Plan 8a reicht ein beliebiger nicht-leerer Wert (das Modul wirft beim
Import wenn die Variable fehlt). Echte Keys aus
[fal.ai dashboard/keys](https://fal.ai/dashboard/keys) — kein Public-Key,
nur server-side genutzt.

---

## Plan 8b — Story-Input + Sonnet-Aufteilung + Storyboard

### Sonnet-Aufteilung ist destruktiv bei Re-Generate

"Mit KI aufteilen" löscht alle bestehenden Szenen und ersetzt sie
durch frische Sonnet-Ausgabe. Manuelle Bearbeitungen gehen verloren.
Der Confirm-Dialog warnt explizit. Merge-Logik (User-Edits zu
generierten Szenen mergen) ist out of scope für 8b — wird wenn
nötig in spätem Plan ergänzt.

### Sonnet-Fehler → alte Szenen bleiben (Transaction-Rollback)

Der Sonnet-Call passiert AUSSERHALB der DB-Transaction. Erst wenn
Sonnet erfolgreich geantwortet hat, beginnt die DELETE+INSERT-
Transaktion. Bei Sonnet-Timeout oder API-Fehler bleibt das Storyboard
unverändert. Verifiziert in `tests/integration/api/sceneflow-generate-scenes.test.ts`
und im manuellen DevTools-Network-Block-Smoke-Check.

### `tts_text` als CTA-Slot für Endcard ist pragmatisch

Die Endcard-Karte nutzt `VG_story_scenes.tts_text` für den CTA-Text
("Folge mir für mehr ..."). Eine eigene `cta_text`-Spalte wäre
semantisch sauberer — wird in einem späteren Plan als eigene Spalte
nachgezogen. Bis dahin: der Endcard-Renderer (8c) liest `tts_text`
als CTA, der TTS-Pfad ignoriert Endcards.

### `speaking_character_id` Hallucination-Schutz

Sonnet bekommt die Character-UUIDs als Kontext. Wenn das Modell
trotzdem eine erfundene UUID liefert (passiert bei langen Listen),
würde der FK-Constraint den INSERT brechen. Server-side Coerce-Logik
in `lib/sceneflow/sonnet.ts:coerceSonnetScenes()` validiert jede UUID
gegen die Story-Character-Liste und null-t bei Miss. Plus
`console.warn` für Cost-Audit (häufige Hallucination → System-Prompt
ergänzen).

### Anthropic prompt cache (5-Min-TTL)

System-Prompt + Charakter-Kontext sind mit `cache_control: ephemeral`
markiert. Mehrfaches "Mit KI aufteilen" innerhalb von 5 Minuten
spart ~80% Input-Tokens. Token-Usage wird über `console.log` aus der
generate-scenes-Route in den Server-Log geschrieben — für
Production-Cost-Audit auswerten.

### `@anthropic-ai/sdk@^0.30.1` — Tool-Use mit `system: [...]`-Array

Plan 8b nutzt System-Prompt als Array (zwei Blöcke mit eigenem
Cache-Control), nicht als String. Das SDK akzeptiert beides;
`@anthropic-ai/sdk@^0.30.1` unterstützt die Array-Form. Die TS-Typen
des SDK kennen `cache_control` auf Text-Blocks noch nicht — daher
ein gezielter `as unknown as MessageCreateParamsNonStreaming`-Cast
in `lib/sceneflow/sonnet.ts`. Bei SDK-Update prüfen ob der Cast
entfallen kann.

### Drag-and-Drop für Szenen-Reihenfolge fehlt

Plan 8b liefert nur [↑][↓]-Buttons. DnD kommt wenn die
Storyboard-Nutzung in der Praxis zeigt dass es gebraucht wird.

---

## Voice picker (Edge TTS + ElevenLabs) — post-Plan-8b

### `msedge-tts` uses an unofficial Microsoft endpoint

The `msedge-tts` npm package talks to `speech.platform.bing.com` over a
WebSocket using a trusted client token shipped inside the library. This
is the same wire protocol the Microsoft Edge browser uses for "Read
aloud" — it's free and needs no key, but Microsoft makes no SLA
guarantees. If Microsoft rotates the token or changes the protocol, the
Edge provider stops working until `msedge-tts` releases a fix. For
production-grade TTS use paid Azure Speech Services (the `azure`
provider enum value is reserved for that future path).

### ElevenLabs voice list and TTS hit api.elevenlabs.io directly

The voice list (`/v1/voices`) is fetched server-side and cached in
process memory for 1 hour. The cache is per-Node-process — Vercel
serverless invocations don't share it, so each cold start re-fetches.
ElevenLabs has generous per-minute limits, so this is fine in practice.

### No rate / pitch / volume controls yet

The picker captures only voice ID + test text. The DB schema does not
have rate/pitch/volume columns. Adding them is a separate migration
when the need arises (SSML for Edge, voice_settings for ElevenLabs).

### `voice_test_text` semantic

Per-character free-text used solely as the sample sentence in the
picker's Play button. It is NOT used by the actual scene-rendering
pipeline (Plan 8c) — that pipeline reads `VG_story_scenes.tts_text`.
The `voice_test_text` column is only an authoring affordance.

### Cookie-domain reminder

The TTS routes are session-checked via Better-Auth (`/api/tts/preview`
and `/api/tts/voices/[provider]` both return 401 without a session).
This means the picker only works after login.

### ElevenLabs key opt-in

`ELEVENLABS_API_KEY` is optional. When absent:
- `GET /api/tts/voices/elevenlabs` → 503 with `ELEVENLABS_API_KEY not set`
- `POST /api/tts/preview` for provider=elevenlabs → 503 with same message
- VoicePicker UI shows the hint inline (no toast)

Edge TTS works without any key.

---

## Plan 8c — fal.ai Render-Pipeline

### fal.ai cost per render

Pro Szene (Bild + Video) ca. **$1.00–1.50**. Bei 20 Szenen (das Maximum
für "Mit KI aufteilen") sind das **$20–30 pro Render**. Kein Hard-Cap im
Code — der User trägt die volle Rechnung. UI-Hinweis: Toast vor Phase 2
("Create Full Movie") wäre ein offensichtlicher v0.2-Hook.

### Kling-Modell-Verfügbarkeit

Modell-IDs können von fal.ai jederzeit ausgemustert werden. Der
ModelSelector-Dropdown ist tolerant gegen unbekannte IDs — fällt auf
den Default zurück und blendet einen Amber-Hinweis mit dem gespeicherten
(jetzt unbekannten) Wert ein. Kein Crash, aber der User muss die
Auswahl bewusst aktualisieren.

### Async Video-Generation auf Vercel Hobby

Kling-Video- und LipSync-Calls dauern 30 s – 4 min und übersteigen den
60-s-Vercel-Hobby-Function-Timeout. Plan 8c löst das mit dem
queue-submit-Pattern: `POST /generate-videos` enqueued nur (returnt
schnell), und der Status-Polling-Endpoint (`GET /status-all`) checkt
fal-seitig den Fortschritt + lädt fertige Assets in R2.

Konsequenz: Browser-Tab kann während der Generierung geschlossen
werden. Beim nächsten Öffnen zeigt der Initial-Fetch (status-all) den
aktuellen Stand. Vercel-Function-Timeout ist hier irrelevant — kein
Call hält länger als ein paar Sekunden.

### R2-Speicher pro Story

fal.ai MP4-Outputs sind 5–20 MB pro Clip. Eine 20-Szenen-Story mit
Dialog-Clips kann 200–500 MB R2-Speicher belegen (image + audio +
neutral-video + final video). Bei vielen Stories pro User summiert sich
der R2-Footprint spürbar — Cloudflare-Kosten steigen mit Datenmenge.
Cleanup-Job (z. B. delete on story-delete) ist eine v0.2-Aufgabe.

### Migration 005 — DEFAULTs für Bestands-Stories

Bestehende `VG_stories`-Rows erhalten via DEFAULT-Werte die neuen
Modell-Spalten (`image_model`, `video_model`, `lipsync_model`). Alte
Stories laden ohne Crash, der ModelSelector zeigt automatisch die
Defaults. Smoke-Test: alte Story aus Pre-8c-Datenbank laden, Plan-8c-UI
bedienen — kein Crash, keine NULL-Felder im Frontend.

### Postgres-JSONB-Abhängigkeit für Status-Idempotenz

Der Status-Endpoint nutzt den Postgres-JSONB-`->>`-Operator als
Race-Guard, damit zwei parallele Polls nicht beide Schritt B
(LipSync) enqueuen:

```sql
UPDATE "VG_story_scenes"
SET neutral_video_url = $1, updated_at = now()
WHERE id = $2
  AND neutral_video_url IS NULL
  AND (fal_request_ids->>'lipsync' IS NULL);
```

Funktioniert auf Supabase (Postgres). Bei einer hypothetischen v0.2-
Migration auf D1/SQLite müsste das Schema auf separate Spalten
umgestellt werden (`fal_image_request_id`, `fal_neutral_video_request_id`,
…). Der Guard wäre dann mit `IS NULL` auf jeder Spalte abbildbar.

### Azure TTS bleibt Stub

`voice_provider === 'azure'` ist in der DB-CHECK erlaubt (Migration 004
+ 002), aber der Render-Pipeline-Dispatcher (`lib/sceneflow/tts.ts`)
wirft einen Klartextfehler. UI-Validation markiert solche Charaktere
mit einer roten Warnung vor Phase 1 — der User muss in den
Character-Manager wechseln und auf Edge oder ElevenLabs umschalten.

### `cameraControl` ist Sonnet-Hint, kein direkter API-Param

Kling 2.5 Turbo hat keine zoom/pan/tilt-Parameter. Die
CameraControl-Slider in der SceneCard befüllen `camera_control` in
der DB; Sonnet leitet daraus den `motion_prompt`-Text ab (siehe
SYSTEM_PROMPT-Erweiterung). Der direkte fal-Call übergibt nur
`motion_prompt`. Konsequenz: Slider-Änderungen wirken erst nach
einem neuen Sonnet-Run, nicht beim direkten Video-Submit.

---

## Plan 8.6 — Admin-Seite + Banning

### Banned sessions: keine sofortige Server-side-Invalidation

Wenn ein Admin einen User via `/admin/users/[id]` → "User sperren" sperrt,
fährt der Code zwei Dinge: `UPDATE "user" SET banned = true` und
`DELETE FROM "session" WHERE "userId" = $1`. Letzteres invalidiert
alle aktiven Better-Auth-Sessions des Users sofort serverseitig.

Aber: der Browser des banned Users hält das Session-Cookie noch im Speicher
bis zur natürlichen Cookie-Expiry (~7 Tage). Auf jeden neuen Request
schlägt jedoch Better-Auth's Lookup fehl (Session-Row in DB weg) → 401,
und `requireUserSession` in den fal-Routes prüft zusätzlich
`user.banned = true` (DB-Lookup pro Request) → 403 "Your account has been
suspended". Der User kann den Studio-Shell weiter sehen, aber **keine
neuen fal.ai-Calls auslösen** und keine Credits mehr verbrauchen.

Konsequenz: kein Echtzeit-Logout, aber alle Geld-fließenden Endpoints
sind dicht. v0.2 könnte ein WebSocket-Push-Logout ergänzen.

### Better-Auth `user`-Tabelle nutzt camelCase, VG_-Tabellen snake_case

Die `user`-Tabelle (Better-Auth) und die `session`-Tabelle haben
camelCase-Spalten in Quotes:
- `"createdAt"`, `"updatedAt"`, `"emailVerified"`, `"banReason"`,
  `"banExpires"`, `"userId"`, `"expiresAt"`

Unsere eigenen `VG_`-Tabellen nutzen snake_case ohne Quotes:
- `user_id`, `story_id`, `scene_id`, `created_at`, `updated_at`

Beim JOIN zwischen beiden auf die Quoting-Regel achten:
```sql
SELECT u.id, u."banReason", c.balance, c.user_id
FROM public."user" u
LEFT JOIN public."VG_user_credits" c ON c.user_id = u.id
```

### Self-Ban-Guard nur im Admin-API, nicht im UI

`POST /api/admin/users/[id]/ban` lehnt einen Self-Ban mit 400 ab. Der
`BanButton`-Component zeigt zusätzlich einen disabled-Button + Hinweis,
aber das ist nur UX — die echte Sicherung ist die Server-Antwort. Wenn
ein Admin sich trotzdem aus der DB-Konsole heraus sperrt (`UPDATE "user"
SET banned = true WHERE email = '…'`), bleibt der Recovery-Weg via SQL:
```sql
UPDATE public."user" SET banned = false WHERE email = '…';
DELETE FROM public."session" WHERE "userId" = '…';  -- bestehende
                                                     -- gesperrte
                                                     -- Sessions raus
```

### Admin-Plugin nicht installiert — eigener Ban-SQL-Pfad

`@better-auth/admin` ist nicht in `package.json`. Die `user`-Spalten
(`role`, `banned`, `banReason`, `banExpires`) wurden separat von einer
früheren Schema-Run-Phase angelegt. Der Ban-Code in
`/api/admin/users/[id]/ban` macht entsprechend SQL-direkt (UPDATE +
DELETE FROM session). Bei späterer Plugin-Installation müsste der Code
auf `auth.api.banUser` umgestellt werden — der vorhandene `if (typeof
auth.api.banUser === 'function')`-Pattern fehlt aktuell, ist als
Plan-8.7-Aufgabe vermerkt.

### `/admin` nicht durch Edge-Middleware geschützt

`middleware.ts` prüft nur Cookie-Presence, kein Role. Die echte
Admin-Authorisierung läuft im `app/admin/layout.tsx` Server-Component
via `requireAdminPage()` (Better-Auth + DB-Role-Lookup). Bei jeder
`/admin/**`-Page passiert ein DB-Roundtrip auf `public."user"` —
akzeptabel für eine Admin-Page mit ein paar Besuchen/Tag, nicht für
hot-paths.

---

## SceneFlow Timeline Integration (Plan 8d)

Plan 8d shipped 2026-05-25: "Transfer to Timeline" rebuilds the
VibeGrid timeline from a SceneFlow story — optional sync-audio,
optional beat-snap, deterministic per-scene mediaIds.

### Wipe-on-Transfer (kein Merge)

Jeder Transfer **löscht alle Timeline-Tracks und Clips** sowie alle
SceneFlow-eigenen MediaRefs des aktuellen Users für genau diese
Story (URL-Match auf `/sceneflow/{userId}/{storyId}/`) und baut die
Timeline neu auf. Andere User-Daten (Image, Audio, FX, manuell
hochgeladene Songs) bleiben unberührt **wenn sie nicht in der
gewipten Timeline lagen** — aber: jede Timeline-Arbeit, die seit
dem letzten Transfer hinzugefügt wurde, ist nach dem Transfer weg.
Confirm-Modal mit Pflicht-Checkbox erzwingt explizite Bestätigung.

**Begründung:** Merge-Logik (welches Clip ist neu? was hat sich am
Snap geändert? wo verschiebe ich existierende FX-Clips?) wäre
komplex und fehleranfällig. Wipe ist deterministisch.

### Singleton-Tracks: main-video, sync-audio

Beide TrackKinds sind 1-pro-Story. Im "+ Track hinzufügen"-Picker
erscheinen sie nur, wenn nicht bereits vorhanden. Es gibt
**keine Drag-Reorder**-Implementierung für Tracks im aktuellen
Stand — die Render-Reihenfolge wird ausschließlich vom
`sortedTracks(tracks)`-Selector erzwungen (sync-audio first,
dann main-video, dann der Rest in Original-Reihenfolge).

### Beat-Snap (off | beat | bar)

Layout-Algorithmus ist **rein deterministisch**: Szenen-Dauer in
Sekunden → Beats via BPM → optional auf nächste Beat-Grenze oder
Bar-Grenze (4 Beats) gesnapped. Crossfade-Guard: `effectiveCrossfade
= min(crossfadeBeats, floor(lengthBeats / 2))` — eine 1-Beat-Szene
kann nicht 2 Beats crossfaden. Kein perceptual onset-matching, kein
DTW. "Beat" heißt hier "BPM-Grid", nicht "echte Schlag-Position im
Audio".

### Sync-Audio: BPM-Detect läuft im Browser

Beim Upload eines Songs (StorySetupForm oder SyncAudioDropZone)
läuft `detectBeats(channelData, sampleRate)` direkt im Browser
über die erste Kanal-Spur. Großdateien (>3 MB) zeigen einen
Toast-Hinweis vorab, weil `decodeAudioData` + Analyse synchron
einige Sekunden blocken können. Kein Worker. Kein Server-side
detect-Fallback.

### BPM-Detect: Algorithmus + Tempo-Octave-Ambiguität

Der Detector arbeitet mit:
1. Half-wave-rectified **energy flux** (max(0, Δenergy)) — hebt
   percussive Transients hervor, ignoriert sustained Energie.
2. Peak-picking mit ±40 ms Local-Max-Fenster + 50 ms Refractory.
3. **Tempogram** via Inter-Onset-Interval-Paar-Histogramm:
   für jedes Onset-Paar innerhalb 1.5 s wird der Gap gebinned (5 ms
   Auflösung). Jeder BPM-Kandidat in [60, 200] wird mit der Summe
   der Histogramm-Gewichte an seiner Grund- und 2/3/4-fachen
   Periode bewertet (mit Faktor 1/m).
4. Parabolische Interpolation um den Peak für Sub-Bin-Präzision.

Plan-8d-Bugfix: User hat 122-BPM-Hardrock gemeldet, der als 188 BPM
erkannt wurde (3:2-Harmonik durch Median-basiertes Verfahren).
Mit dem neuen Algorithmus → 122 ± 0 (verifiziert mit echter
VibeGridDemo-Rock.mp3, 139.7 s, 296 Onsets, Confidence 1.000).

**Verbleibende Limitation:** bei langsamen Stücken (≤110 BPM) mit
gleichmäßigem 8tel-Hi-Hat-Pattern kann der Detector die doppelte
BPM melden (200 statt 100), weil die Hi-Hats auf dem doppelten
Tempo-Grid mehr harmonische Multiples akkumulieren als die
Kick/Snare auf dem Original-Grid. **Workaround:** die BPM ist
in der Topbar manuell editierbar — User können nach Auto-Detect
den Wert halbieren/verdoppeln und dann re-snappen.

Spezifische Test-Aussagen (verifiziert):
- Echte VibeGridDemo-Rock.mp3 (122 BPM laut Quelle) → 122 ✓
- 122 BPM synthetic (Kick+Snare+Hi-Hat) → 122 ✓
- 130-150 BPM (gemixt) → ±2 ✓
- 220 BPM Click-Track → 110 (geoktavt down) ✓
- 100 BPM gemixt Hi-Hat-Pattern → ~200 (bekannte 2×-Limitation)

### Re-Snap bei Song-Wechsel: Transition-Verlust

`SyncAudioDropZone` ruft nach BPM-Detect `replaceMainVideoClips(...)`
mit `transition: 'cut'` für jeden Main-Video-Clip auf. **Crossfades,
die beim ursprünglichen Transfer aus den Szenen-`transition`-Feldern
übernommen wurden, gehen verloren** — die Clips landen sequentiell
ohne Überlappung. Workaround: vor Song-Wechsel manuell merken
welche Szenen Crossfades hatten und nach dem Re-Snap per
Erneut-Transfer aus SceneFlow regenerieren.

### `existingClip.label` ist `file.name`, nicht der Original-Songtitel

Sync-Audio-Clip-Label wird beim Upload aus dem File-Namen
abgeleitet. Wer ein Re-Encode mit anderem Filename hochlädt,
sieht im Timeline-Label den neuen Filename — die Story-Tabelle
selbst speichert keine Music-Metadata (Title/Artist/Album).

### `videoLoadProgress` bleibt für gewipte mediaRefs liegen — nicht mehr

`purgeSceneflowMediaRefs(storyId, userId)` und `removeMediaRef(id)`
löschen den zugehörigen `videoLoadProgress`-Eintrag mit, damit
keine toten Progress-Balken in der UI verbleiben. Diese Aufräum-
Logik gilt **nur** für SceneFlow-Wipes — andere mediaRef-Lebenszyklen
(Image, Standalone-Audio, FX) sind davon nicht betroffen.

### Endcard-Dauer hart 5 Sekunden (server-side resolution)

`/api/sceneflow/stories/[id]/transfer` setzt für Endcard-Szenen
**immer** `durationSec = ENDCARD_DEFAULT_DURATION_SEC = 5`,
unabhängig von dem Wert in `scene.duration`. Begründung: Endcards
haben kein Video, nur ein Bild — eine Story-Editor-Eingabe für
"3 Sekunden" wäre für Renderer-Kompatibilität konfliktanfällig.
Wer eine andere Endcard-Dauer braucht, muss `ENDCARD_DEFAULT_DURATION_SEC`
in `lib/sceneflow/clip-layout.ts` ändern (zentral) und das auch
Backend-seitig spiegeln.

### Migration 008: `VG_projects` wurde gewiped

Die TrackKind-Erweiterung um `main-video` + `sync-audio` war
nicht persist-schema-kompatibel mit gespeicherten v6-Projekten,
die nur `image|video|audio|fx` kannten. Migration 008 hat
**alle Zeilen in `public.VG_projects` gelöscht**, statt einen
Schema-Migrator zu pflegen. User-Daten in anderen Tabellen
(VG_stories, VG_scenes, VG_characters, VG_credit_*) sind nicht
betroffen. Bei späteren TrackKind-Änderungen sollte ein
Zustand-`migrate()`-Hook gegenüber Wipe der bevorzugte Weg sein.

---

## Plan 8e — FX-Pack caveats

### RGBSplit channel isolation is a composite-tint approximation
RGBSplit uses `multiply` with `rgba(255,0,0,1)` / `rgba(0,0,255,1)` on
two per-clip offscreens to isolate the red and blue channels of the
shifted bitmap copies. Because Canvas2D `multiply` operates on
premultiplied alpha, bright pixels may leak a tinge into the suppressed
channels — perceptually a "red shadow" can show faint green/blue at the
brightest highlights. Acceptable trade-off vs. an ImageData pixel-loop,
which would cost ~2M ops/frame per channel at 1080p. If pixel-accurate
isolation is needed in a future revision, route through an ImageData
path with a documented perf budget.

### FilmGrainBurst performance scaling
At `grainSize=1` the FX writes a fresh ImageData of `canvas.width ×
canvas.height × 4` bytes per frame within the decay window — ~8 MB
allocation + 2M `Math.random()` calls at 1080p. `grainSize=2` cuts that
by 75%, `grainSize=4` by 94%. The decay window is short (default 0.15
beats ≈ 75 ms at 120 BPM), so cost is bounded per beat. Long sessions
with many overlapping FilmGrain clips on a low-end CPU may stutter; the
recommended mitigation is to bump `grainSize` rather than lower the
beat rate.

### Per-clip offscreens leak across clip removal
RGBSplit, FilmGrainBurst, and GlitchSlice each maintain a
`Map<clipId, OffscreenCanvas>` keyed by `RenderContext.clipId`.
`FxPlugin.dispose()` clears these maps, but `dispose()` only fires on
plugin re-registration (HMR + page reload). In a long edit session
where the user adds and removes many clips, the maps grow unbounded;
at 1080p each entry is ~8 MB (FilmGrain) or 2 × 8 MB (RGBSplit).
Export pipeline is unaffected (export renders rebuild the renderer).
HMR / page reload restores baseline. A future revision could subscribe
to clip-remove events from the store and prune by clipId.

### Preset Pack preview button is disabled in v0.1
The Play button on pack cards and FX rows in the Preset-Pack browser
renders as a disabled icon with a "Preview coming soon" tooltip.
Implementing a real 2-second preview would require hijacking the
render loop, allocating a temporary FX stack, and restoring state on
button release — a meaningful chunk of work. Deferred to Plan 9a-v2
alongside the cloud preset marketplace.

### Preset Pack `displayTriggerLabel` is display-only
Pack entries with `displayTriggerLabel: '1/6'` or `'1/8'` still fire
at the per-beat cadence the renderer enforces. The label preserves
design fidelity with the prototype that promised sub-beat trigger
divisions. Genuine sub-beat triggering arrives in Plan 10+ together
with a renderer-level trigger granularity setting.

### Preset Pack track-rename breaks `findOrCreateFxTrack` re-use
`findOrCreateFxTrack` matches existing FX tracks by `track.name ===
fxKind` (PascalCase, e.g. `'ZoomPunch'`). If a user renames the track
in the timeline panel ("Kick FX"), a second Apply of the same pack
will create a NEW track instead of layering onto the renamed one.
Acceptable for v0.1; a per-track `meta.fxKind` tag could solve it
later, but that's overkill until users hit the case in practice.

### Preset Pack curves authored clip-relative; flow-mode mismatch
Built-in packs author automation curves in clip-relative beats (0 =
clip onset). `apply-pack.ts` offsets points by `startBeat` so they
read correctly in Beat Mode (the default). If the user toggles Flow
Mode after applying a pack, the resolver stretches each curve over
the full clip length — packs were not designed for that. Acceptable
for v0.1; documented here so the surprise is searchable.

### ColorGradeShift (Plan 8f.1 — shipped via WebGL2)
The originally-planned ColorGradeShift FX (saturate/contrast/hue
rotation per beat) relied on `ctx.filter`, which is not reliably
supported on `OffscreenCanvas` in Safari/iOS WebKit. Plan 8f.1 ships
the FX via a WebGL2-backed renderer slot — GLSL fragment shader,
per-clip OffscreenCanvas, composited back onto the main 2D canvas. See
"WebGL2 requirement" below.

### WebGL2 requirement (Plan 8f.1 onward)
WebGL2-backed FX (`ColorGradeShift`, plus future Plan-8g effects) require
Safari 17+ (Sept 2023), Chrome 69+, or Firefox 105+. On older browsers
the effect is skipped silently in the render and the Inspector shows a
"WebGL2 not available" banner over the param controls. Live-preview and
exports both honour the same skip — no half-rendered output.

### WebGL composite bandwidth
Each WebGL2 FX blits its OffscreenCanvas result onto the main 2D canvas
via `drawImage` per frame. At 1080p that's ~8 MB/frame, at 4K ~32 MB/
frame, multiplied by the count of active WebGL FX. Thermal-limited
mobile devices may drop FPS under sustained 4K WebGL load — the
auto-scaler progressively halves the WebGL OffscreenCanvas dimensions
(scale 1.0 → 0.75 → 0.5) when avg FPS sinks under 45.

### Quality auto-scaling warm-up
For the first 30 frames after the renderer mounts (~0.5 s at 60 FPS),
the rolling FPS window has not stabilised and the auto-scaler is
inactive. Persistent low-FPS conditions only begin to trigger
scale-downs after that baseline window. The QualityIndicator badge in
the WorkspaceHeader reflects the live scale.

### Multi-Select: selectedClipId is a synced compat-field (Plan 9b)
`ui.selectedClipIds: string[]` is the source-of-truth for clip
selection. `ui.selectedClipId: string | null` (singular) is kept
in sync as a compat-field: it mirrors `selectedClipIds[0]` when the
selection has exactly one clip, otherwise `null`. Every action that
mutates `selectedClipIds` (`selectClips`, `addToSelection`,
`clearSelection`, `duplicateSelectedClips`, `deleteSelectedClips`,
`removeClip`) must update the singular field in the same `set()`
call. Architect chose this over a derived selector to keep the 43+
existing consumers (Inspector, AutomationEditor, Mobile
InspectorSheet, etc.) untouched.

### Resize-Min-Clamp: per-clip, not group-coordinated (Plan 9b)
`resizeSelectedClips` clamps each clip independently at `lengthBeats
= 0.5`. When the group is dragged enough to push the shortest clip
to the minimum, relative length-ratios within the group drift —
shorter clips clamp first while longer ones keep shrinking.
Architect-Decision L4: the alternative (block the resize for the
whole group once any one clip is at min) would make resizing a mixed
selection feel "stuck", which is worse UX in DAW conventions. The
ratio-drift is acceptable.

### Ctrl+D Duplicate-Offset: rightmost-edge minus leftmost-edge (Plan 9b)
Ctrl+D duplicates the selection at an offset equal to the span of
the current selection (`max(startBeat + lengthBeats) -
min(startBeat)`). So duplicates begin exactly where the originals
end, with no overlap. This is the Logic Pro / Ableton convention.

### Duplicate-Overlap: silent skip (Plan 9b)
`duplicateSelectedClips` skips any duplicate that would land at the
exact same `(trackId, startBeat)` as a clip that already exists.
Architect-Decision L2: consistent with Plan 9a (preset-pack apply).
The toast shows "X of Y clips duplicated (Z overlap)" when at least
one was skipped.

### Group-Move: same-track overlaps are allowed (Plan 9b)
`moveSelectedClips` only clamps so no clip lands below `startBeat 0`.
Same-track overlaps with NON-selected clips are NOT prevented — they
are renderable via Plan 5.6's `__blend` cross-fade mechanism. If a
group-move would create an unwanted overlap, the user undoes (Ctrl+Z
when available) or moves the colliding clip out of the way first.

### Group-Resize: edge-handle UI not yet wired (Plan 9b, deferred)
The store action `resizeSelectedClips(delta, edge)` is implemented
and tested, but the per-clip resize handle in `Clip.tsx` still
operates on single clips only. Wiring the handle to dispatch a
group-resize when the active clip is part of a multi-selection is
follow-up work (small scope, no new architecture).

### Contour edge-extraction spike (Plan 9b follow-up)
Contour edge detection (Sobel + flood-fill) is synchronous on the
main thread. Per-extract cost is bounded by `EDGE_SCALE = 0.5`
(half-resolution Sobel — 4× less pixel work) and the spike sits in
the 50–125 ms range on 1080p sources. On dense / high-detail frames
it can still reach 200 ms+ — that's a single-frame stall visible as
a brief stutter.

**What we did to mitigate:**
- Half-resolution Sobel + nearest-neighbor downscale + in-place
  coordinate upscale (perf commit 974b427).
- Beat-triggered re-extraction (perf commit 51ca920): the spike is
  pinned to musical beat boundaries instead of 500 ms video-bucket
  transitions, so the visual edge-refresh reads as intentional rather
  than as a glitch. Max 1 extract per beat per clip → at 120 BPM
  that's 2 extracts/s/clip instead of the previous 2/s decoupled
  from the music.

**Trade-offs accepted:**
- Edges on a moving video clip update once per beat, not on every
  frame. Within a beat window, the previous beat's edges are reused
  even if the video advanced through a 500 ms bucket. Visually
  subtle — edges visually "stick" between beats.
- On extremely dense edge frames (forest, dense crowd, text-heavy)
  the per-extract cost can still exceed 100 ms. Future option: move
  extraction to a Web Worker (would eliminate main-thread blocking
  entirely; deferred — not in this plan's scope).

**Why we did NOT lower `EDGE_SCALE` below 0.5:**
Tested empirically at 0.25. Quarter-resolution Sobel produces MORE
paths via aliasing on detailed sources, which raises per-frame
polyline-render cost enough to net-negate the extract savings. Also
introduced pathological max-spike on certain frames (a single
extract on a connected-component-heavy frame went from 191 ms to
363 ms). 0.5 is the sweet spot for this codebase.

**Why the mark-on-push flood-fill rewrite was reverted:**
V8 inlines the variadic `stack.push(a, b, c, ..., h)` call better
than 8 separate `tryPush()` function calls in a closure. The
allocation savings from pre-checking neighbors do NOT outweigh the
closure call overhead at the edge densities our 540p Sobel produces.

---

## Undo / Redo (Plan 10)

### Stack overlebt keinen Page-Reload

Der `history`-Slice ist nicht in `partialize` — beim Reload ist Undo
leer. Bewusste Entscheidung (Architekt): persistente Stacks blasen
localStorage auf (mehrere MB) und schaffen Edge-Cases bei
Schema-Migrations + Cross-Tab-Sync. Wenn das Feedback wird, kann ein
zukünftiger Plan einen separaten `vibegrid-history`-Key einführen mit
eigener Capping-Strategie.

### R2-gebundene Operationen sind nicht undobar

Alle `mediaActions` (`addMediaRef`, `removeMediaRef`,
`addMediaRefMeta`, `purgeSceneflowMediaRefs`) sind `skip:true` —
Undo würde R2-Blobs verwaisen oder Refs auf gelöschte URLs zeigen.
Ebenso `replaceMainVideoClips` (SceneFlow Transfer) und der gesamte
NewProject / LoadProject Flow. UI warnt vor SceneFlow-Transfer mit
"kann nicht rückgängig gemacht werden (Ctrl+Z)".

### Playhead wird NICHT mit reverted

Architekt-D3 / L4 — DAW-Standard (Ableton, Logic, Pro Tools): Undo
restored Clip-Struktur, nicht die Scrub-Position. Wenn du auf Sekunde
60 bist und Ctrl+Z einen Clip an Sekunde 5 löscht, bleibt der
Playhead auf 60. Begründung: andernfalls würde Ctrl+Z während des
Playbacks den User zurück werfen, was extrem irritierend wäre.

### RAM-Footprint bis ~100 MB worst-case

`MAX_HISTORY = 100`. Bei einem ausgereizten Projekt (100 Clips, alle
mit Automation-Kurven) kann ein Snapshot ~1 MB sein, also gesamt
~100 MB im RAM. Akzeptierter Trade-off — der gleiche Worst-Case ist
sehr selten, typische Projekte bleiben unter 10 MB.

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

## WebGL2 FX Composition (Plan 8f.3)

VibeGrid hat drei WebGL2-FX-Kategorien (Plan 8f.1 / 8f.2 / 8f.3):
**ColorGradeShift**, **RetroVHS**, **Edge Glow**.

**Edge Glow chained korrekt** auf vorherige image-modifying FX, weil
es `source='canvas'` in `renderGlFx` nutzt — sampelt also den bereits
composed Frame. Render-Order positioniert Edge Glow am ENDE der
image-modifying group.

**Stacken von ColorGradeShift + RetroVHS auf demselben Clip ist
"last writer wins"**: beide nutzen `source='bitmap'`, also sampeln
beide das Original-Bitmap und schreiben separat auf die Main-Canvas.
Der zweite überschreibt den ersten. Folge-Plan 8f.4 kann beide auf
`source='canvas'` opten und so die Composition chainen — Edge Glow
hat den Pfad bereits implementiert und kann als Referenz dienen.

Workaround heute: nur einen der beiden (CGS oder VHS) pro Clip
einsetzen, Edge Glow kann zusätzlich oben drauf laufen.

---

## Beat Sync per Clip (Plan 8g + 8g-hotfix)

VibeGrid hat zwei Controls für "FX läuft konstant statt beat-synchron":

| Control | Scope | Wirkung |
|---|---|---|
| `rc.flowMode` (global toggle) | Ganze Timeline | Schaltet Beat-Sync für ALLE FX gleichzeitig aus |
| `beatSync` (per Clip, Plan 8g) | Einzelner Clip | Schaltet Sync nur für diesen einen Clip aus |

**beatSync hat zwei gleichzeitig wirksame Effekte** (Hotfix nach Live-Smoke 2026-05-28):

1. **env-Behandlung im Shader**: beatSync=1 → env decayt pro Beat (Pulse), beatSync=0 → env=1.0 konstant
2. **Automation-Resolver-Modus**: beatSync<0.5 triggert per-Clip Flow Mode → Kurven werden über `clip.lengthBeats` gestretcht und clip-relativ evaluiert (genau wie der globale Flow Mode, aber nur für diesen Clip)

Konkret bedeutet das: User legt im Automation Editor eine Multi-Point-Kurve über die Clip-Länge an. Bei beatSync=1 evaluiert der Resolver an absoluten Beats — Punkte clip-relativ 0..11 fallen "hinter" den Lookup-Beat eines spät startenden Clips → konstanter Letztwert (Kurve wirkt nicht). Bei beatSync=0 stretcht der Resolver die Kurve über die Clip-Länge → Kurve wirkt wie im Editor sichtbar.

**Bekannte Limitation (8g):** flowMode-Verhältnis ist je nach FX-Pattern unterschiedlich:

- **skip-FX** (BeatFlash, ZoomPunch, ScreenShake, GlitchSlice, RGBSplit, FilmGrainBurst, LensFlareBurst, ColorGradeShift): beatSync wirkt nur in Beat Mode. In Flow Mode trumpft `rc.flowMode` — der FX skippt weiterhin via early-return. Wer beatSync=0 in Flow Mode nutzen will, müsste Flow Mode ausschalten.
- **pin-FX** (Edge Glow, RetroVHS): beatSync=0 und Flow Mode konvergieren beide zu env=1.0 → kein Konflikt, beide Wege geben denselben persistenten Look.

Folge-Plan 8g.5 (separates Vorhaben) wird die 8 skip-FX auf das pin-Pattern umstellen, so dass für alle FX gleiches Verhalten gilt.

**Bekannte Limitation (Tempo):** Beide Mechanismen (globaler Flow Mode + per-Clip Flow via beatSync<0.5) gehen von konstantem BPM aus. Bei variablem BPM (ritardando/accelerando) wäre eine echte Lösung Time-basierte Automation + Tempo Map. Eigener Folge-Plan, nicht blockierend für aktuelle Use-Cases.

## WebGL `source='canvas'` darf rc.imageBitmap nicht voraussetzen (Plan 8g-hotfix)

Hotfix nach Live-Smoke 2026-05-28: `renderGlFx` bailte auf `!rc.imageBitmap` unabhängig vom `source`-Parameter. Für `source='canvas'` (Edge Glow) ist das falsch — der Shader sampelt `rc.ctx.canvas`, das auch dann gültige Pixel hat wenn `captureVideoFrame` für einen Video-Clip undefined zurückliefert (was häufig passieren kann: displayWidth=0, OffscreenCanvas unavailable, Timing-Race). Sichtbarer Effekt: Edge Glow auf Video-Clips unsichtbar trotz korrektem render(). Fix: Guard nur für `source='bitmap'`.

Plan-8f.3 Code-Quality-Reviewerin hatte diesen Punkt geflagged ("acceptable as layered-fix"). Optional/später wurde zu "irgendwann verfällt das Verfallsdatum" — beim ersten Video-Test geknallt.

## RGBSplit WebGL2 — leicht anderer Look als Canvas-2D-Vorgänger (Plan 11a)

Plan 11a (2026-05-28) migrierte RGBSplit von Canvas-2D auf WebGL2. Der Canvas-2D-Vorgänger zeichnete das Original + zwei tinted Channel-Layer mit `screen`-Composite und `globalAlpha = intensity * env` — Resultat: hellere, additive Aberration mit "gepumpter" Anmutung bei hohen `intensity`-Werten. Der WebGL-Shader macht stattdessen channel-replace per Pixel (`r=sample(+s).r, g=sample(0).g, b=sample(-s).b`), gemixt mit `u_intensity` gegen das Original-Sample. Semantisch sauberere Aberration mit erhaltener Bildhelligkeit, aber **nicht bit-equivalent**.

Bestandsprojekte mit RGBSplit zeigen nach der Migration einen leicht anderen Look — kein UX-Eingriff nötig, dokumentiert. Migration-Trade-off: deterministischer Look + keine per-Clip OffscreenCanvas-Caches + WebGL-Performance (avg < 0.5 ms statt ~3 ms) gegen den additiven "Hellpump"-Charakter des Canvas-2D-Vorgängers.

## GlitchSlice WebGL2 — anderes Look-Profil als Canvas-2D-Vorgänger (Plan 11b)

Plan 11b (2026-05-29) migrierte GlitchSlice von Canvas-2D auf WebGL2. Drei bewusst akzeptierte Verhaltens-Drifts (Architekt-Entscheidung Variante b):

1. **Hash-Verteilung:** Canvas-2D nutzte mulberry32 (deterministic integer PRNG, `lib/utils/prng.ts`). Shader nutzt GLSL-Standard `fract(sin(n) * 43758.5453123)`. Bei gleichem `seed`-Param und gleichem `rc.beatIndex` produzieren beide deterministisch denselben Output je Render — aber die **Slice-Versatz-Verteilung** ist anders. Bestandsprojekte mit fixiertem `seed=42` sehen nach Migration eine andere Glitch-Choreographie. Reproduzierbarkeit zwischen alten und neuen Renders ist gebrochen, neue Renders untereinander aber stabil.

2. **Wrap-Around statt Clipping:** Canvas-2D-`drawImage` mit X-/Y-Versatz clippte Pixel die über die Canvas-Kante rutschten (sichtbare schwarze/transparente Bänder am Rand). Shader nutzt `fract()` für UV-Wrapping in der bitmap-sized Texture — Pixel kommen am anderen Rand der Bitmap wieder rein. Optischer Charakter ändert sich von „Black-Band-Glitch" zum „Wrap-Glitch". Texture ist bitmap-sized im `source='bitmap'`-Mode (siehe `lib/renderer/webgl/texture.ts:43-46` + `lib/renderer/webgl/pipeline.ts:111-113`), `fract()` wrappt deshalb immer auf echtes Bitmap-Content, keine theoretischen Letterbox-Sampling-Bugs.

3. **Cosmetic — sin-Entropie bei sehr großen `u_seed`:** Über lange Sessions wächst `rc.beatIndex` unbeschränkt. Ab `u_seed ≈ 10000` verliert `sin()` in float32 etwas Entropie — benachbarte `sliceIdx`-Werte können visuell-korrelierte Outputs liefern (subtile Pattern-Bildung statt klean random). Ist Teil des Glitch-Charmes, für viele User vermutlich unsichtbar. Falls je problematisch: integer-arithmetic PCG-Hash im Shader portieren — separater Plan.

User die bit-identische Reproduktion alter GlitchSlice-Renders brauchen: Re-Render unter pre-11b-Stand. Für Vorwärts-Workflow (neue Story-Boards, Preset-Authoring nach Migration) ist der neue Look die referenzwertige Variante. Keine Schema-Migration nötig — `params.seed` und alle anderen Params sind weiterhin kompatibel.

## Stack-Composition Bitmap-Source-FX — last-writer-wins (Plan 11a)

Fünf Image-Modifying-FX nutzen aktuell `source: 'bitmap'` in `renderGlFx`: ColorGradeShift (Plan 8f.1), RetroVHS (Plan 8f.2), Contour GL (Plan 8f.4), RGBSplit (Plan 11a) und GlitchSlice (Plan 11b). Wenn 2+ davon auf demselben Clip aktiv sind, sampeln alle das Original-Bitmap und composen mit `drawImage` auf den Main-Canvas — der letzte Render-Pass überschreibt den vorigen. User sieht NUR den letzten FX in `RENDER_ORDER_TRACK_KIND`.

**Workaround heute:**
- Nur einen Bitmap-Source-FX pro Clip aktiv lassen
- ODER explizit Edge Glow (`source: 'canvas'`) als finale Komposition oben auf chained FX setzen

**Saubere Lösung** (eigener Folge-Plan): alle Bitmap-Source-FX schrittweise auf `source: 'canvas'`-Chaining migrieren, analog zu Edge Glow (Plan 8f.3). Render-Order wird dann signifikant: jeder FX sampelt was der Vorgänger hinterlassen hat. Siehe Edge-Glow-Kommentar in `lib/fx/edge-glow.ts` (Variante B-Section) für das ursprüngliche Symptom-Pair (CGS + VHS).

## Sound Library Admin — Concurrent Writes sind Last-Writer-Wins (Plan 8.7b)

Plan 8.7b kennt keine Optimistic-Concurrency auf der Manifest-PUT-Route. Wenn zwei Admin-Sessions gleichzeitig schreiben (z. B. ein Edit und ein Upload parallel), liest jede `version: N` aus R2, schreibt `version: N+1` zurück, und der zweite Write überschreibt den ersten still — eine der beiden Änderungen geht verloren. Bewusst akzeptierte Restrisikenklasse für v0.1 mit einem aktiven Admin. Saubere Lösung wäre ein `If-Match`-Header mit ETag-Vergleich; eigener Folge-Plan sobald Multi-Admin-Bedarf entsteht.

## Sound Library Admin — Orphan-MP3 bei Partial-Fail (Plan 8.7b)

Der atomare `POST /api/admin/sounds/upload` macht MP3-PUT und Manifest-PUT sequentiell. Bei Manifest-PUT-Fail nach erfolgreichem MP3-PUT bleibt die MP3 in R2 als Orphan (nicht im Manifest referenziert, kein UX-Schaden) — Storage-Müll, kein Sicherheits- oder Datenintegritätsproblem. Manueller R2-Cleanup oder ein Sweeper-Job (eigener Folge-Plan) räumt das auf. Die Response enthält im Fehlerfall den `orphanKey` im Body, damit der Admin ihn händisch nachräumen kann.

Reverse-Fall — `DELETE /api/admin/sounds/[id]`: Manifest-First-Order (Plan 8.7b W6) sorgt dafür, dass der Manifest-Update gelingt, der R2-Delete aber fehlschlagen kann → Orphan-MP3 in R2, identisch zum Upload-Fall. Kein Ghost-Entry im Manifest, der User ein 404 produzieren würde — das ist die explizite Trade-off-Wahl.

## Plan 9d — Export Range Selection

Plan 9d landete in zwei Phasen. **Phase 1 (geshippt): Export Range** — Ctrl/Cmd+Drag auf dem Timeline-Header zieht eine Range auf (snappt auf Beat/Bar), der Offline-Export rendert nur das Fenster `[rangeStart, rangeEnd]`. Sampling-Zeit bleibt absolut (Beat-Phase, Automation, FX identisch zum Voll-Export), der Output-Frame-Index ist range-relativ (Video startet bei Frame 0). **Phase 2 (Loop-Preview) ist ein Follow-on**, gekoppelt an einen separaten RAF+BPM-Clock-Fallback-Plan — siehe Hinweis am Ende.

### Architektur-Entscheidung: kein Pre-Roll, Seek-Modell

Der Render-Loop rekonstruiert jeden Frame rein aus der absoluten Zeit und akkumuliert keinen Frame-übergreifenden Zustand (`loop.ts`: `beats`, `subdivisionIndex`, Automation alle aus absoluter `t`; die einzigen Frame-übergreifenden Maps werden beim Seek über den `seekCounter` geleert). Darum braucht der Range-Export **kein Pre-Roll von t=0** — er sampelt direkt bei absoluter `t`. Einzige Ausnahme: **Particles** (siehe unten).

### Particles-Ramp-up am Range-Start (B1 = akzeptierte Limitierung)

Particles ist der **einzige** FX, der Frame-Zustand akkumuliert (`lib/fx/particles.ts` integriert Positionen `p.x += p.vx*dt` in einem modul-globalen Pool, nur bei `dispose()`/`onSeek()` geleert). Ein **mittendrin** startender Range-Export (`rangeStart > 0`) beginnt daher mit **leerem Partikel-Pool** → die ersten ~1–2 s zeigen Partikel, die aus dem Nichts hochrampen, statt des eingeschwungenen Zustands eines Voll-Exports.

Bewusste Entscheidung: **akzeptiert und dokumentiert** (Option a). Die Alternative — Render-ab-t=0 nur um den Pool aufzuwärmen — würde genau die Video-Decoder-Kosten (5–15× realtime pro Seek) zurückholen, deretwegen das Seek-Modell überhaupt gewählt wurde. **Nordstern (eigener Scope):** Particles zustandslos umschreiben (Position aus absoluter Zeit ableiten statt integrieren); dann ist auch dieser Sonderfall ohne Workaround korrekt, und der `onSeek`-Scaffold-Hook (`FxPlugin.onSeek`, aktuell nur von Particles implementiert) wird mitsamt der Akkumulation gelöscht.

### Particles `dt = 1/60` ist hartcodiert (W3, vorbestehend)

`particles.ts` integriert mit fixem `dt = 1/60`, ignoriert die echte Frame-Dauer. Folge: im 30-fps-Export bewegen sich Partikel mit **halber Geschwindigkeit** gegenüber der 60-fps-Live-Preview. **Nicht von 9d verursacht** — hier nur vermerkt, weil es mit dem B1-Ramp-up interagiert (beide betreffen Particles im Range-Export). Fix gehört zum stateless-Particles-Rewrite (Nordstern).

### Audio-Windowing (W1)

Der Offline-Audio-Mix (`mix-audio-offline.ts`) fenstert Clips auf `[rangeStart, rangeEnd]`. Web-Audio erlaubt kein negatives `source.start(when, …)`, daher die Fallunterscheidung `rel = clipStart − rangeStart`: `rel ≥ 0 → start(rel, 0)`, sonst `start(0, −rel)` (Clip ragt ins Fenster hinein → Buffer-Offset statt negativem `when`). Volume-Automation-Zeitachse wird fenster-relativ rebased. Window-Overlap-Guards laufen **vor** Fetch/Decode, sodass Clips außerhalb des Fensters nicht unnötig geladen werden.

### Loop-Preview (Phase 2) ist noch offen

Die Live-Loop-Preview (Playhead wrappt `rangeEnd → rangeStart`) ist als Follow-on geplant. Sie hängt an einem separaten **RAF+BPM-Clock-Fallback-Plan**: aktuell treibt nur der globale Soundtrack-`audioEl.timeupdate` die `currentTime` — ohne Soundtrack steht der Playhead (vorbestehend). Der Clock-Fallback macht den soundtrack-losen Fall zum Normalfall (BPM-Feld der Top-Bar als Tempo-Quelle, RAF treibt die Zeit). Danach ist der Loop-Wrap trivial und clock-agnostisch. Der dann relevante **Audio-Wrap-Glitch** (Web-Audio ersetzt one-shot BufferSources beim Wrap → kurzer Übergang, identisch zum heutigen Scrub-Verhalten) wird mit Phase 2 dokumentiert.
