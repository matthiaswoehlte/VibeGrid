# VibeGrid Plan 5.9d — Multi-Audio + Volume-Automation + Video-Audio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project execution policy (overrides skill defaults):** direct-on-main, sequential, one commit per task. NO superpowers-subagent-ceremony — CC #1 implements straight.

---

## Context for the external reviewer

The post-Plan-5.9c baseline is the current `main` HEAD (commits up to and including the UI-polish hotfixes `d06b51c` / `b3c9ef0` / `a3f978d`). All gates green: typecheck, lint, **617 tests**, build clean.

Notable state from 5.9a/5.9b/5.9c that affects this plan:

1. **`AudioEngine` is single-buffer**. `lib/audio/engine.ts` exposes `load(file)`, `play()`, `pause()`, `seek(sec)`, `getDecodedBuffer()`. It loads ONE audio file (the global soundtrack), exposes the cached `AudioBuffer` for the offline-render path. There is no per-clip API today.
2. **Audio is a stub TrackKind**. `initialTimelineState` mounts one `kind: 'audio'` lane (Plan 5.9c). `addTrack('audio')` soft-rejects via `toast.error('Multi-Audio-Tracks: kommt mit Plan 5.9d')` — this plan flips that switch.
3. **Video elements are `muted: true`** in `lib/video/engine.ts:97`. The mute is hardcoded — the comment cites "audio comes exclusively from the AudioEngine (no two-source sync problem)". This plan adds an opt-IN escape hatch per clip.
4. **Offline render** (`lib/export/offline-render.ts`) takes a single `audioBuffer: AudioBuffer` and chunks it into the WebCodecs `AudioEncoder` in the audio loop. The signature must extend to accept a mixed buffer from the new `mixAudioOffline` step.
5. **Automation system** (`lib/automation/resolve.ts`) already supports per-param StaticOrAuto curves with `resolveParam<T>(curve, beat, lengthBeats?, flowMode?)`. The volume param plugs in here unchanged.
6. **Plan 5.9b's `useVideoEngine`** solved the Strict-Mode lifecycle bug via the "ONE master useEffect that owns engine creation + subscription + cleanup" pattern (commit `6265582`). `useAudioEngine` extends with the exact same pattern.
7. **`Clip.kind` is widened to `TrackKind | TrackFxKind`** (Plan 5.9c Task 2). Audio clips carry `kind: 'audio'`, which is already in the narrow `TrackKind` — no type widening needed for this plan.

---

**Goal:** Three orthogonal features that together turn VibeGrid into a real multi-track audio workstation:

1. **Multi-Audio-Tracks** — users add arbitrarily many `kind: 'audio'` lanes, drop audio clips on them with the same drag-and-arrange model as image clips.
2. **Volume-Automation** — every audio clip carries a `volume: number` (0..1, `StaticOrAuto<number>`) parameter; the Inspector shows a slider + ⚡ automation button.
3. **Video-Audio Toggle** — video clips gain an `audioEnabled: boolean` param. Inspector toggle flips `videoEl.muted` live; the offline render extracts the video's embedded audio track and mixes it into the output.

**Architecture:** Six surfaces.

1. **`AudioEngine` per-clip API** (`lib/audio/engine.ts`). New methods: `loadClip / unloadClip / playClip / stopClip / stopAllClips / setClipVolume / rampClipVolume / getLoadedClipIds / getContextTime`. Each loaded clip has its own `AudioBuffer`, `GainNode`, and current `AudioBufferSourceNode`. Sync via shared `audioCtx.currentTime` + lookahead. The old single-buffer methods (`load`, `play`, `pause`) stay — the global soundtrack continues to use them for back-compat with the existing audio-engine state surface.

2. **`useAudioEngine` reconciler** (`lib/hooks/useAudioEngine.ts`). Modeled byte-for-byte on `useVideoEngine` (Plan 5.9b commit `6265582`): ONE master `useEffect` that creates the engine, subscribes to timeline + media-refs + playhead, and tears down on unmount. Diffs `clip.id × mediaId` (sourced via `engine.getLoadedClipIds()`) to drive `loadClip` / `unloadClip`. Subscribes to `playhead.playing` for global play/pause-sync. On seek (both paused and playing) it calls `stopAllClips()`; while playing it then immediately re-calls `startAllActiveClips()` so audio re-syncs to the new playhead.

3. **Renderer per-frame volume** (`lib/renderer/loop.ts`). The existing tick iterates `getActiveFxClips`; a new sibling iteration walks active audio clips and calls `deps.rampClipVolume(clip.id, resolvedVolume, audioCtx.currentTime + FRAME_DURATION)`. The ramp lets Web Audio interpolate sample-accurately between frames — no zipper noise. Video-Audio toggle is applied in the same loop branch that draws video frames: `videoEl.muted = !resolvedParams.audioEnabled`.

4. **Inspector extensions** (`components/Workspace/Inspector/`). Three new code paths:
   - Audio clips render a Volume slider (0..1, displayed as 0–100%) with the standard ⚡ automation button. Header label is `mediaRef.filename` (e.g. `"Sanfte Flüsse.mp3"`).
   - Video clips render a `audioEnabled` toggle. Header label is `mediaRef.filename`.
   - Both fall back to "Audio Clip" / "Video Clip" if `mediaId` is null (newly-created slot before media is assigned).

5. **Offline render mixdown** (`lib/export/offline-render.ts` + new helper). The single-buffer `audioBuffer` parameter is replaced by a new `mixAudioOffline(clips, mediaRefs, bpm, durationSec, videoAudioClips?)` function. It runs ONE `OfflineAudioContext` as a mix-bus, routes every audio clip + every audio-enabled video clip through their own `BufferSource → GainNode → destination`, scheduling volume automation via `setValueAtTime` on a 0.1-beat grid. After `startRendering()`, peak-normalize to 0.95 if the mix clipped. Result is one `AudioBuffer` handed to the existing `AudioEncoder` chunker.

6. **Store action unlock** (`lib/store/timeline-slice.ts`). `addTrack('audio')` loses the soft-reject. The default `'Audio'` lane stays; subsequent calls produce `'Audio 2'`, `'Audio 3'`, … via the existing `defaultLabelFor` counter.

**Tech Stack:** No new dependencies. Web Audio API (`OfflineAudioContext`, `GainNode.linearRampToValueAtTime`, `AudioBufferSourceNode.start(when, offset)`) is all built-in. No store migration — the `volume` and `audioEnabled` params are new entries in `clip.params` and the resolver defaults handle absent-field cases (`volume → 1.0`, `audioEnabled → false`).

---

## Architecture insights

### 1. Why audio gets a per-clip API, not a one-track-per-buffer extension

The existing `AudioEngine` was built around a single global soundtrack (the BPM-detection workflow needed one canonical buffer to analyse). Treating each clip as the unit of audio scheduling — rather than "the audio track" — matches how the timeline model works for image / video clips, and avoids inventing a separate "track" abstraction in the engine. The engine doesn't know about tracks at all; it knows about clip ids.

Side benefit: video-audio routes through the same code path. A video clip's embedded audio (extracted via `decodeAudioData`) becomes just another `BufferSource → GainNode → destination` in the mix bus.

### 2. Live vs. offline volume scheduling

Two different APIs serve two different needs:

- **Live preview** uses `rampClipVolume(clipId, vol, ctx.currentTime + 1/60)`. Called per RAF tick (60 Hz), each call schedules a tiny linear ramp from the previous scheduled value to the new one over ~16.7 ms. The Web Audio scheduler interpolates sample-accurately between schedule points; no zipper, no clicks. `setClipVolume` (instant set) is kept for Seek and Stop where instant jumps are wanted.
- **Offline export** uses `gain.setValueAtTime(vol, timeSec)` on a 0.1-beat grid (≈ 50 ms at 120 BPM). The 0.1-beat raster is a deliberate compromise — finer rasters cost more setValueAtTime calls but the perceptual difference vs 0.01-beat is nil. Hard step-jumps within the 0.1-beat window are documented as a Known-Limitation; users authoring sub-beat volume stabs should expect quantisation.

### 3. Multi-clip sync via shared lookahead

`AudioBufferSourceNode.start(when, offset)` accepts an absolute `when` time on the AudioContext clock. To start N clips in sync, all N calls must use the same `when` reference. Pattern:

```ts
const now = audioCtx.currentTime;
const whenBase = now + LOOKAHEAD; // 50 ms — enough for scheduler
for (const clip of activeAudioClips) {
  const clipStartSec = (clip.startBeat * 60) / bpm;
  const currentSec   = (currentBeat   * 60) / bpm;
  if (currentBeat >= clip.startBeat) {
    // already playing → offset into the clip
    engine.playClip(clip.id, currentSec - clipStartSec, whenBase);
  } else {
    // future start → no offset, delay the `when`
    engine.playClip(clip.id, 0, whenBase + (clipStartSec - currentSec));
  }
}
```

The 50 ms lookahead is the standard Web Audio scheduling slack. Smaller windows risk underrun on slow machines; larger windows produce audible latency at play-button click.

### 4. Why video-audio is opt-in (not on by default)

`videoEl.muted = true` was hardcoded in 5.9b to dodge the "two audio clocks drifting" problem — the HTML media element has its own playback clock independent of the `AudioContext`. For live preview, opt-in is OK: if the user enables video-audio for a single clip and the drift is audible, they hear it themselves and disable it. For offline export, the video's audio is extracted via `decodeAudioData` into the `OfflineAudioContext` mix-bus, so there's no clock-drift at all in the exported file. The toggle has identical user semantics in both paths but different mechanisms.

### 5. Why no store migration

Existing v6 snapshots have audio clips (well, image clips for now — there are no audio clips yet because `addTrack('audio')` was blocked). The new params (`volume`, `audioEnabled`) live in `clip.params` which is `Record<string, unknown>`. `resolveParam<T>` returns its first argument when the value is a static (non-curve) primitive, so absent-field reads from old snapshots return `undefined`; the per-call default (`?? 1.0` for volume, `?? false` for audioEnabled) handles that case. **Store stays at version 6**; no migrate step needed.

### 6. Inspector header convention

Pre-5.9d, the Inspector header showed `plugin.name` for FX clips (`"Color Sweep"`, etc.). Audio and video clips never had an Inspector view because the FX-only gate at line 18 short-circuited (`if (!clip || !clip.fxId) return …`). This plan extends the gate to also accept media clips with `kind ∈ {'audio', 'video'}`. The header label becomes:

| Clip kind | Header label |
|---|---|
| FX (has `fxId`) | `plugin.name` (unchanged) |
| `audio` with `mediaId` | `mediaRef.filename` (e.g. `"track.mp3"`) |
| `video` with `mediaId` | `mediaRef.filename` (e.g. `"intro.mp4"`) |
| `audio` / `video` without `mediaId` | Literal `"Audio Clip"` / `"Video Clip"` |
| `image` | Header section not rendered (no per-clip params for image) |

### 7. Offline-render signature break

`renderOffline(deps)` currently takes `deps.audioBuffer: AudioBuffer`. After 5.9d it takes nothing at the AudioBuffer level — instead, `deps.audioClips`, `deps.videoAudioClips`, `deps.mediaRefs`, `deps.bpm` so `mixAudioOffline` can construct the mixed buffer internally. Callers (`useVideoExporter`) need to pass the timeline-derived lists. This is a hard break of the existing test fixtures (`tests/unit/export/offline-render.test.ts` constructs a fake `audioBuffer`); those tests are updated in Task 7.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `lib/audio/types.ts` | modify | Add `AudioClipState` interface. |
| `lib/audio/engine.ts` | modify | New methods: `loadClip`, `unloadClip`, `playClip`, `stopClip`, `stopAllClips`, `setClipVolume`, `rampClipVolume`, `getLoadedClipIds`, `getContextTime`. Internal `Map<clipId, AudioClipState>`. |
| `lib/hooks/useAudioEngine.ts` | modify | Multi-clip reconciler (lazy-load on clip diff, play/pause/seek sync). Pattern mirrors `useVideoEngine`. |
| `lib/renderer/loop.ts` | modify | Per-frame `rampClipVolume` for active audio clips. `videoEl.muted = !resolvedParams.audioEnabled` in the video-draw block. |
| `lib/export/offline-render.ts` | modify | Replace single `audioBuffer` param with multi-clip ingestion. Call `mixAudioOffline` before the audio loop. |
| `lib/export/mix-audio-offline.ts` | **CREATE** | The `mixAudioOffline(clips, mediaRefs, bpm, durationSec, videoAudioClips?)` helper. Single `OfflineAudioContext` mix-bus, per-clip `BufferSource → GainNode → destination`, volume-automation via `setValueAtTime` on 0.1-beat grid, post-render peak-normalise. |
| `lib/store/timeline-slice.ts` | modify | Remove the `'audio'` soft-reject in `addTrack`. |
| `components/Workspace/Inspector/index.tsx` | modify | Extend the gate to accept `audio` + `video` clip kinds. Routes media clips to `MediaClipInspector`. |
| `components/Workspace/Inspector/MediaClipInspector.tsx` | **CREATE** | Header + body for audio / video clips. Resolves header from `mediaRef.filename`; renders `VolumeSection` for audio, `VideoAudioToggle` for video. |
| `components/Workspace/Inspector/VolumeSection.tsx` | **CREATE** | The volume slider + automation button component. |
| `components/Workspace/Inspector/VideoAudioToggle.tsx` | **CREATE** | The audioEnabled toggle. |
| `lib/hooks/useVideoExporter.ts` | modify | Pass `audioClips`, `videoAudioClips`, `mediaRefs`, `bpm` to `renderOffline` instead of the global `audioBuffer`. |
| `tests/unit/audio/engine-multi-clip.test.ts` | **CREATE** | ≥ 8 cases (loadClip, unloadClip, setClipVolume sets GainNode instantly, rampClipVolume anchors before ramping, stopAllClips, playClip with offsetSec, getLoadedClipIds, playClip no-op on missing buffer). |
| `tests/unit/audio/engine-sync.test.ts` | **CREATE** | ≥ 2 cases (when-Berechnung past-clip-start + future-clip-start). |
| `tests/unit/export/offline-audio-mix.test.ts` | **CREATE** | ≥ 7 cases (single clip + volume curve, multi-clip mix, video-audio inclusion, video without audio track is silent-OK, peak-normalisation triggered, peak-normalisation NOT triggered when summed peak ≤ 1.0, clip starting after totalDurationSec renders silence without throw). |
| `tests/unit/renderer/audio-volume-ramp.test.ts` | **CREATE** | ≥ 3 cases (`rampClipVolume` called with resolved volume per frame, `videoEl.muted` mirrors `audioEnabled` param, no ramp when no audio clip active). |
| `tests/unit/components/Inspector/video-audio-toggle.test.tsx` | **CREATE** | ≥ 2 cases (toggle updates `audioEnabled` param, header shows filename). |
| `tests/unit/components/Inspector/volume-section.test.tsx` | **CREATE** | ≥ 3 cases (slider defaults to 100% when `volume` is undefined, drag to 50% sets `clip.params.volume = 0.5`, ⚡-button opens AutomationEditor for the `volume` param). |
| `tests/unit/store/timeline-slice-audio.test.ts` | **CREATE** | ≥ 2 cases (addTrack audio creates a new lane, audio-counter labels `Audio 2`/`Audio 3`). |
| `tests/unit/store/track-actions.test.ts` | modify | Flip the existing "addTrack('audio') soft-rejects via toast" case to assert successful creation. |
| `docs/KNOWN_LIMITATIONS.md` | modify | Append the Audio section (3 entries). |

---

## Tasks

### Task 0 — Baseline check

**No file changes.** Verifies the starting point.

- [ ] **Step 1 — Confirm baseline**

```powershell
git status                        # working tree clean (or only untracked .png/docs)
git log --oneline -1              # confirm starting HEAD
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected: typecheck/lint/build clean; record test count (expected baseline: **617**). Target after 5.9d: ≥ baseline + **20** (i.e. ≥ 637).

---

### Task 1 — `AudioEngine` multi-clip API + `AudioClipState`

**Files:**
- Modify: `lib/audio/types.ts`
- Modify: `lib/audio/engine.ts`
- Create (tests): `tests/unit/audio/engine-multi-clip.test.ts`
- Create (tests): `tests/unit/audio/engine-sync.test.ts`

- [ ] **Step 1 — Write the failing tests**

Two new test files. Mock the `AudioContext` constructor (mirror the existing pattern in `lib/audio/engine.test.ts`).

```ts
// tests/unit/audio/engine-multi-clip.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAudioEngine } from '@/lib/audio/engine';
// ... mock AudioContext / decodeAudioData / GainNode / BufferSource ...

describe('AudioEngine — multi-clip API (Plan 5.9d)', () => {
  it('loadClip decodes and caches the buffer per clipId', async () => { /* … */ });
  it('unloadClip removes the cached buffer and gain node', () => { /* … */ });
  it('setClipVolume sets gain.value instantly', () => { /* … */ });
  it('rampClipVolume schedules a linearRampToValueAtTime', () => { /* … */ });
  it('stopAllClips stops every currently-playing source', () => { /* … */ });
  it('rampClipVolume anchors via setValueAtTime before the linear ramp (no fade-from-silence on first call)', () => { /* … */ });
  it('getLoadedClipIds returns the set of currently-loaded clip ids', () => { /* … */ });
  it('playClip is a no-op when buffer is not loaded', () => { /* … */ });
});
```

```ts
// tests/unit/audio/engine-sync.test.ts
describe('AudioEngine — multi-clip sync (Plan 5.9d)', () => {
  it('playClip with offsetSec=0 + whenSec > now schedules a future start', () => { /* … */ });
  it('playClip with offsetSec>0 (clip already playing) starts mid-buffer', () => { /* … */ });
});
```

Run: `npm test -- --run tests/unit/audio/engine-multi-clip.test.ts tests/unit/audio/engine-sync.test.ts`
Expected: FAIL on every case (the methods don't exist yet).

- [ ] **Step 2 — Add `AudioClipState` to `lib/audio/types.ts`**

```ts
export interface AudioClipState {
  clipId: string;
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode;
  isPlaying: boolean;
}
```

- [ ] **Step 3 — Extend `AudioEngine` interface + implementation**

```ts
// lib/audio/engine.ts — add to the AudioEngine interface:
export interface AudioEngine {
  // ... existing methods unchanged ...

  /** Plan 5.9d — per-clip audio routing. */
  loadClip(clipId: string, url: string): Promise<void>;
  unloadClip(clipId: string): void;
  /** Start playback. `offsetSec` is the position inside the clip's
   *  own buffer (0 = clip start). `whenSec` is the absolute
   *  AudioContext time when playback begins; pass
   *  `audioCtx.currentTime + LOOKAHEAD` for "play now" with scheduler
   *  slack, or `whenBase + delaySec` for clips that start in the
   *  timeline future. */
  playClip(clipId: string, offsetSec: number, whenSec: number): void;
  stopClip(clipId: string): void;
  /** Instant volume set. Use for Seek/Stop where instant jumps are wanted. */
  setClipVolume(clipId: string, volume: number): void;
  /** Per-frame volume ramp. Schedules a linear ramp from the
   *  currently-scheduled value to `volume` over the window
   *  [now, targetTime]. Sample-accurate, no zipper noise. */
  rampClipVolume(clipId: string, volume: number, targetTime: number): void;
  /** Stop every currently-playing source. Used by the reconciler
   *  on seek (both while paused and while playing) — the reconciler
   *  then calls `playClip(…)` for every active clip to restart at
   *  the new playhead position. */
  stopAllClips(): void;
  /** Returns `audioCtx.currentTime` (or 0 if the context isn't
   *  initialised yet). Used by the renderer to compute
   *  `rampClipVolume` target times without accessing the
   *  AudioContext directly. */
  getContextTime(): number;
  /** Returns the list of clip IDs currently loaded in the engine.
   *  The reconciler in `useAudioEngine` diffs this against the set
   *  of clips it WANTS loaded — without this method, the diff
   *  collapses to "reload everything" which causes audible
   *  silence-glitches mid-playback. */
  getLoadedClipIds(): string[];
}
```

Implementation sketch (full code in CC1's commit; this is the public-facing shape):

```ts
// Inside createAudioEngine:
const buffers = new Map<string, AudioBuffer>();
const gainNodes = new Map<string, GainNode>();
const sources = new Map<string, AudioBufferSourceNode>();

async function loadClip(clipId: string, url: string): Promise<void> {
  if (buffers.has(clipId)) return;
  const ctx = ensureContext(); // existing helper that creates the AudioContext lazily
  const arrayBuffer = await fetch(url).then((r) => r.arrayBuffer());
  const buf = await ctx.decodeAudioData(arrayBuffer);
  buffers.set(clipId, buf);
  const gain = ctx.createGain();
  gain.gain.value = 1.0;
  gain.connect(ctx.destination);
  gainNodes.set(clipId, gain);
}

function unloadClip(clipId: string): void {
  stopClip(clipId);
  buffers.delete(clipId);
  const gain = gainNodes.get(clipId);
  if (gain) { gain.disconnect(); gainNodes.delete(clipId); }
}

function playClip(clipId: string, offsetSec: number, whenSec: number): void {
  stopClip(clipId);
  const ctx = ensureContext();
  const buf = buffers.get(clipId);
  const gain = gainNodes.get(clipId);
  if (!buf || !gain) return;
  const source = ctx.createBufferSource();
  source.buffer = buf;
  source.connect(gain);
  source.start(Math.max(ctx.currentTime, whenSec), offsetSec);
  sources.set(clipId, source);
}

function stopClip(clipId: string): void {
  const source = sources.get(clipId);
  if (!source) return;
  try { source.stop(); } catch { /* already stopped */ }
  source.disconnect();
  sources.delete(clipId);
}

function setClipVolume(clipId: string, volume: number): void {
  const gain = gainNodes.get(clipId);
  if (!gain) return;
  gain.gain.value = Math.max(0, Math.min(1, volume));
}

function rampClipVolume(clipId: string, volume: number, targetTime: number): void {
  const gain = gainNodes.get(clipId);
  if (!gain) return;
  const ctx = ensureContext();
  // ANCHOR — `linearRampToValueAtTime` ramps from the previous
  // scheduled value. Without an explicit setValueAtTime first, the
  // Web Audio spec ramps from time-zero (effectively from value 0,
  // i.e. silence), so the FIRST ramp call after each load fades the
  // clip in from silence. Anchoring to the current value at the
  // current time is idempotent (no jump) and gives the ramp a
  // stable start. Footgun documented in MDN's linearRampToValueAtTime
  // notes.
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(
    Math.max(0, Math.min(1, volume)),
    targetTime
  );
}

function stopAllClips(): void {
  // The reconciler restarts clips at the new position via
  // playClip(). No per-clip math needed here.
  for (const id of [...sources.keys()]) stopClip(id);
}

function getContextTime(): number {
  return audioContext?.currentTime ?? 0;
}

function getLoadedClipIds(): string[] {
  return [...buffers.keys()];
}
```

- [ ] **Step 4 — Run tests, confirm green, full suite + typecheck**

```powershell
npm test -- --run tests/unit/audio/engine-multi-clip.test.ts tests/unit/audio/engine-sync.test.ts
npm run typecheck
npm test -- --run    # baseline + 8
```

- [ ] **Step 5 — Commit**

```powershell
git add lib/audio/types.ts lib/audio/engine.ts tests/unit/audio/engine-multi-clip.test.ts tests/unit/audio/engine-sync.test.ts
git commit -m "feat(audio): AudioEngine multi-clip API — load/play/stop/setVolume/rampVolume"
```

---

### Task 2 — `useAudioEngine` multi-clip reconciler

**Files:**
- Modify: `lib/hooks/useAudioEngine.ts`
- Modify (tests): `tests/unit/hooks/useAudioEngine.test.tsx`

- [ ] **Step 1 — Read the prior art**

Before writing, open `lib/hooks/useVideoEngine.ts` (commit `6265582`, Plan 5.9b). The Strict-Mode-safe pattern there:
- ONE master `useEffect`
- Engine created INSIDE the effect (not in component body)
- Subscription, reconciler, and cleanup all live in the same closure
- Cleanup destroys the engine via the closed-over reference

Copy the structure; only the diff-key and method names change.

- [ ] **Step 2 — Write failing tests**

```ts
// tests/unit/hooks/useAudioEngine.test.tsx — extend existing file:
describe('useAudioEngine — multi-clip reconciler (Plan 5.9d)', () => {
  it('calls loadClip for every audio clip on mount', () => { /* … */ });
  it('calls unloadClip when a clip is removed', () => { /* … */ });
  it('on play, calls playClip for every active audio clip with synced when', () => { /* … */ });
  it('on seek-while-paused, calls stopAllClips (next play restarts at new pos)', () => { /* … */ });
  it('on seek-while-PLAYING, calls stopAllClips THEN startAllActiveClips so audio re-syncs', () => { /* … */ });
});
```

- [ ] **Step 3 — Implement the reconciler**

```ts
// lib/hooks/useAudioEngine.ts (sketch — full code in commit):
export function useAudioEngine(): UseAudioEngineReturn {
  const engineRef = useRef<AudioEngine | null>(null);
  const [engine, setEngine] = useState<AudioEngine | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const newEngine = createAudioEngine();
    engineRef.current = newEngine;
    setEngine(newEngine);

    function reconcile(timeline: TimelineState, mediaRefs: MediaRef[]): void {
      const wanted = new Set(
        timeline.clips
          .filter((c) => c.kind === 'audio' && typeof c.mediaId === 'string')
          .map((c) => c.id)
      );
      const loaded = new Set(newEngine.getLoadedClipIds());

      // Load new
      for (const clipId of wanted) {
        if (loaded.has(clipId)) continue;
        const clip = timeline.clips.find((c) => c.id === clipId)!;
        const ref = mediaRefs.find((m) => m.id === clip.mediaId);
        if (!ref) continue;
        void newEngine.loadClip(clipId, ref.url).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(`[useAudioEngine] load failed: ${clipId}`, err);
        });
      }
      // Unload gone
      for (const clipId of loaded) {
        if (!wanted.has(clipId)) newEngine.unloadClip(clipId);
      }
    }

    const initial = useAppStore.getState();
    reconcile(initial.timeline, initial.media.mediaRefs);

    const LOOKAHEAD = 0.05; // 50 ms — Web Audio scheduler slack

    const unsub = useAppStore.subscribe((state, prev) => {
      // Reconcile when clips or mediaRefs change.
      if (
        state.timeline.clips !== prev.timeline.clips ||
        state.media.mediaRefs !== prev.media.mediaRefs
      ) {
        reconcile(state.timeline, state.media.mediaRefs);
      }

      // Play / pause sync.
      const wasPlaying = prev.timeline.playhead.playing;
      const isPlaying = state.timeline.playhead.playing;
      const bpm = state.audio.grid.bpm;

      if (isPlaying && !wasPlaying) {
        startAllActiveClips(state.timeline, newEngine, bpm, LOOKAHEAD);
      }
      if (!isPlaying && wasPlaying) {
        for (const clip of state.timeline.clips.filter(isAudioClip)) {
          newEngine.stopClip(clip.id);
        }
      }

      // Seek-while-paused: user is scrubbing. Stop only — the next
      // play-press triggers startAllActiveClips with the new offset.
      if (
        !isPlaying &&
        state.timeline.playhead.beats !== prev.timeline.playhead.beats
      ) {
        newEngine.stopAllClips();
      }

      // Seek-while-PLAYING: user drags the playhead during playback.
      // Must stop all sources AND restart them at the new position,
      // otherwise every clip keeps playing from its old offset and
      // the audio desyncs from the visual playhead. Placed AFTER the
      // isPlaying-&&-!wasPlaying branch so the regular Play button
      // doesn't double-fire startAllActiveClips.
      if (
        isPlaying &&
        wasPlaying &&
        state.timeline.playhead.beats !== prev.timeline.playhead.beats
      ) {
        newEngine.stopAllClips();
        startAllActiveClips(state.timeline, newEngine, bpm, LOOKAHEAD);
      }
    });

    return () => {
      unsub();
      // Tear down via the closed-over reference (Strict-Mode-safe).
      for (const clipId of newEngine.getLoadedClipIds()) newEngine.unloadClip(clipId);
      engineRef.current = null;
      setEngine(null);
    };
  }, []);

  return useMemo(() => ({ engine }), [engine]);
}

function startAllActiveClips(
  timeline: TimelineState,
  engine: AudioEngine,
  bpm: number,
  lookahead: number
): void {
  const currentBeat = timeline.playhead.beats;
  const whenBase = engine.getContextTime() + lookahead;

  for (const clip of timeline.clips.filter(isAudioClip)) {
    if (currentBeat >= clip.startBeat + clip.lengthBeats) continue;
    const clipStartSec = (clip.startBeat * 60) / bpm;
    const currentSec = (currentBeat * 60) / bpm;
    if (currentBeat >= clip.startBeat) {
      engine.playClip(clip.id, currentSec - clipStartSec, whenBase);
    } else {
      engine.playClip(clip.id, 0, whenBase + (clipStartSec - currentSec));
    }
  }
}
```

Implementation note: the reconciler reads `audioCtx.currentTime` via the new `engine.getContextTime()` method (declared in Task 1 Step 3). Direct AudioContext access from the hook is intentionally avoided — keeps the time-base concern inside the engine.

- [ ] **Step 4 — Run tests + commit**

```powershell
npm test -- --run tests/unit/hooks/useAudioEngine.test.tsx
npm run typecheck
git add lib/hooks/useAudioEngine.ts tests/unit/hooks/useAudioEngine.test.tsx
git commit -m "feat(audio): useAudioEngine multi-clip reconciler (Strict-Mode-safe via useVideoEngine pattern)"
```

---

### Task 3 — Unlock `addTrack('audio')` + flip the existing test

**Files:**
- Modify: `lib/store/timeline-slice.ts`
- Modify (tests): `tests/unit/store/track-actions.test.ts`
- Create (tests): `tests/unit/store/timeline-slice-audio.test.ts`

- [ ] **Step 1 — Edit the action**

```ts
// lib/store/timeline-slice.ts — addTrack:
//
// REMOVE the 'audio' soft-reject branch entirely. The path through
// defaultLabelFor + the FX-counter handles 'audio' the same way as
// 'fx' / 'image' / 'video'.

addTrack: (kind, label) => {
  // Plan 5.9d — 'audio' was soft-rejected via toast in 5.9c; now fully
  // enabled. Multi-Audio is the headline feature of 5.9d.
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const finalLabel = label ?? defaultLabelFor(kind, get().timeline.tracks);
  set((s) => ({
    timeline: {
      ...s.timeline,
      tracks: [...s.timeline.tracks, { id, kind, name: finalLabel, muted: false }]
    }
  }));
}
```

- [ ] **Step 2 — Flip the existing test**

```ts
// tests/unit/store/track-actions.test.ts —
// REMOVE: it('addTrack("audio") soft-rejects via toast — Multi-Audio is v0.2', …)
// ADD instead:

it('addTrack("audio") creates a new audio lane', () => {
  const before = useAppStore.getState().timeline.tracks
    .filter((t) => t.kind === 'audio').length;
  useAppStore.getState().timelineActions.addTrack('audio');
  const after = useAppStore.getState().timeline.tracks
    .filter((t) => t.kind === 'audio').length;
  expect(after).toBe(before + 1);
});
```

- [ ] **Step 3 — Add the counter tests**

```ts
// tests/unit/store/timeline-slice-audio.test.ts — NEW
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';

beforeEach(() => {
  useAppStore.setState((s) => ({
    timeline: { ...s.timeline, tracks: [...initialTimelineState.tracks], clips: [] }
  }));
});

describe('Multi-Audio-Tracks (Plan 5.9d)', () => {
  it('addTrack("audio") with one existing audio lane labels the new one "Audio 2"', () => {
    useAppStore.getState().timelineActions.addTrack('audio');
    const audio = useAppStore.getState().timeline.tracks.filter((t) => t.kind === 'audio');
    expect(audio.map((t) => t.name)).toEqual(['Audio', 'Audio 2']);
  });

  it('repeated addTrack("audio") yields Audio 2 / Audio 3 / Audio 4', () => {
    const { addTrack } = useAppStore.getState().timelineActions;
    addTrack('audio');
    addTrack('audio');
    addTrack('audio');
    const names = useAppStore.getState().timeline.tracks
      .filter((t) => t.kind === 'audio')
      .map((t) => t.name);
    expect(names).toEqual(['Audio', 'Audio 2', 'Audio 3', 'Audio 4']);
  });
});
```

- [ ] **Step 4 — Run tests + commit**

```powershell
npm test -- --run
git add lib/store/timeline-slice.ts tests/unit/store/track-actions.test.ts tests/unit/store/timeline-slice-audio.test.ts
git commit -m "feat(store): addTrack('audio') fully enabled — remove v0.2 stub"
```

---

### Task 4 — Renderer per-frame `rampClipVolume` for active audio clips

**Files:**
- Modify: `lib/renderer/loop.ts`
- Create (tests): `tests/unit/renderer/audio-volume-ramp.test.ts`

- [ ] **Step 1 — Write the failing tests**

```ts
// tests/unit/renderer/audio-volume-ramp.test.ts — NEW
describe('renderer — audio clip volume ramp (Plan 5.9d)', () => {
  it('rampClipVolume called per tick with resolved volume for active audio clips', () => { /* … */ });
  it('static volume param: rampClipVolume called with the static value', () => { /* … */ });
  it('automation curve on volume: rampClipVolume value matches resolveParam(curve, beat)', () => { /* … */ });
});
```

- [ ] **Step 2 — Extend `RendererDeps`**

```ts
// lib/renderer/loop.ts — RendererDeps:
export interface RendererDeps {
  // ... existing fields ...

  /** Plan 5.9d — per-frame audio-volume ramp. Called for every active
   *  audio clip in the timeline. No-op when the engine has no clip
   *  with this id. */
  rampClipVolume?: (clipId: string, volume: number, targetTime: number) => void;
  /** Plan 5.9d — current AudioContext clock time, needed to compute
   *  the ramp's target. */
  getAudioContextTime?: () => number;
}
```

- [ ] **Step 3 — Add the per-frame iteration**

```ts
// lib/renderer/loop.ts — inside tick(), AFTER the FX render loop but
// BEFORE the ownsFirstImageBitmap close():

const FRAME_DURATION = 1 / 60;
if (deps.rampClipVolume && deps.getAudioContextTime) {
  const now = deps.getAudioContextTime();
  const target = now + FRAME_DURATION;
  for (const clip of timeline.clips) {
    if (clip.kind !== 'audio') continue;
    if (beats < clip.startBeat) continue;
    if (beats >= clip.startBeat + clip.lengthBeats) continue;
    const rawParams = {
      volume: 1.0,
      ...(clip.params ?? {})
    };
    const resolved = resolveParam(
      (rawParams as { volume: StaticOrAuto<number> }).volume,
      flowMode ? beats - clip.startBeat : beats,
      clip.lengthBeats,
      flowMode
    );
    deps.rampClipVolume(clip.id, resolved, target);
  }
}
```

- [ ] **Step 4 — Wire the renderer hook**

In `lib/hooks/useRenderer.ts` (or wherever the renderer is instantiated): pass `rampClipVolume: engine.rampClipVolume` and `getAudioContextTime: engine.getContextTime`.

- [ ] **Step 5 — Run tests + commit**

```powershell
npm test -- --run tests/unit/renderer/audio-volume-ramp.test.ts
npm run typecheck
git add lib/renderer/loop.ts tests/unit/renderer/audio-volume-ramp.test.ts lib/hooks/useRenderer.ts
git commit -m "feat(renderer): per-frame rampClipVolume for active audio clips"
```

---

### Task 5 — Video-Audio toggle

**Files:**
- Modify: `lib/renderer/loop.ts`
- Modify: `lib/video/engine.ts` (small — only the default-muted line if affected)
- (Tests are part of Task 6 — Inspector covers the wiring; renderer-side gets covered by an extension to Task 4's test file)

- [ ] **Step 1 — Extend the test file**

```ts
// tests/unit/renderer/audio-volume-ramp.test.ts — ADD:
it('videoEl.muted is set from clip.params.audioEnabled', () => {
  // Stub a videoEl with `muted` settable; verify the renderer sets
  // muted = !audioEnabled on the per-frame draw.
});

it('default audioEnabled (absent) → videoEl.muted = true', () => {
  // Backwards-compatible: existing v5/v6 video clips have no
  // audioEnabled param and remain silent.
});
```

- [ ] **Step 2 — Patch the video-draw branch**

```ts
// lib/renderer/loop.ts — inside the image+video draw block, in the
// video branch (currently lines ~204-225 post-5.9c). After
// `source = el;`:

const audioEnabledRaw =
  (ic.params as { audioEnabled?: StaticOrAuto<boolean> } | undefined)?.audioEnabled;
const audioEnabled = audioEnabledRaw === true
  || (typeof audioEnabledRaw === 'object' && audioEnabledRaw !== null
        ? Boolean(resolveParam(audioEnabledRaw, beats - ic.startBeat, ic.lengthBeats, flowMode))
        : false);
el.muted = !audioEnabled;
```

Note: `audioEnabled` is technically `StaticOrAuto<boolean>` but the Inspector only authors static values in v0.1 (no curves on booleans). The branch above handles both shapes defensively.

- [ ] **Step 3 — Run tests + commit**

```powershell
npm test -- --run tests/unit/renderer/audio-volume-ramp.test.ts
git add lib/renderer/loop.ts tests/unit/renderer/audio-volume-ramp.test.ts
git commit -m "feat(video): per-clip audioEnabled toggle drives videoEl.muted"
```

---

### Task 6 — Inspector: volume slider + audio-toggle + media-clip header

**Files:**
- Create: `components/Workspace/Inspector/VolumeSection.tsx`
- Create: `components/Workspace/Inspector/VideoAudioToggle.tsx`
- Modify: `components/Workspace/Inspector/index.tsx`
- Create (tests): `tests/unit/components/Inspector/video-audio-toggle.test.tsx`

- [ ] **Step 1 — Write the failing tests**

```tsx
// tests/unit/components/Inspector/video-audio-toggle.test.tsx — NEW
describe('Inspector — Video-Audio toggle (Plan 5.9d)', () => {
  it('clicking the toggle sets clip.params.audioEnabled', () => { /* … */ });
  it('header shows mediaRef.filename for video clips', () => { /* … */ });
});
```

- [ ] **Step 2 — Extend the Inspector gate**

```tsx
// components/Workspace/Inspector/index.tsx — REPLACE the early-return
// gate at line 18:

if (!clip) {
  return <div className="p-3 text-xs text-[var(--text-dim)]">Wähle einen Clip oder Effekt aus.</div>;
}

// Audio + Video clips: route to the media-clip section.
if (clip.kind === 'audio' || clip.kind === 'video') {
  return <MediaClipInspector clip={clip} />;
}

// FX clips: existing path.
if (!clip.fxId) {
  return <div className="p-3 text-xs text-[var(--text-dim)]">Wähle einen Clip oder Effekt aus.</div>;
}
const plugin = getPlugin(clip.fxId);
// ... existing FX path unchanged ...
```

- [ ] **Step 3 — `MediaClipInspector` component**

```tsx
// components/Workspace/Inspector/MediaClipInspector.tsx — NEW
import { useAppStore } from '@/lib/store';
import { VolumeSection } from './VolumeSection';
import { VideoAudioToggle } from './VideoAudioToggle';
import type { Clip } from '@/lib/timeline/types';

export function MediaClipInspector({ clip }: { clip: Clip }) {
  const mediaRef = useAppStore((s) =>
    clip.mediaId ? s.media.mediaRefs.find((m) => m.id === clip.mediaId) : undefined
  );
  const headerLabel =
    mediaRef?.filename
    ?? (clip.kind === 'audio' ? 'Audio Clip' : 'Video Clip');

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between px-3 py-2 bg-[var(--surface-2)] border-b-2 border-[var(--a1)]">
        <div>
          <div className="text-base font-bold text-[var(--text)]">{headerLabel}</div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            {clip.kind === 'audio' ? 'Audio clip' : 'Video clip'}
          </div>
        </div>
      </header>
      <div className="px-3 space-y-2">
        {clip.kind === 'audio' && <VolumeSection clip={clip} />}
        {clip.kind === 'video' && <VideoAudioToggle clip={clip} />}
      </div>
    </div>
  );
}
```

`VolumeSection` and `VideoAudioToggle` are small focused components (volume slider + ⚡ button; checkbox). Reuse the existing `ParamControl` + `AutomateButton` where it fits.

- [ ] **Step 4 — Run tests + commit**

```powershell
npm test -- --run
npm run typecheck
git add components/Workspace/Inspector/ `
        tests/unit/components/Inspector/video-audio-toggle.test.tsx `
        tests/unit/components/Inspector/volume-section.test.tsx
git commit -m "feat(inspector): volume slider for audio clips + video-audio toggle + media-clip header"
```

---

### Task 7 — Offline render: `mixAudioOffline` + signature break

**Files:**
- Create: `lib/export/mix-audio-offline.ts`
- Modify: `lib/export/offline-render.ts`
- Modify: `lib/hooks/useVideoExporter.ts`
- Create (tests): `tests/unit/export/offline-audio-mix.test.ts`
- Modify (tests): `tests/unit/export/offline-render.test.ts`, `tests/unit/export/offline-video.test.ts`

- [ ] **Step 1 — Write the failing tests**

```ts
// tests/unit/export/offline-audio-mix.test.ts — NEW
describe('mixAudioOffline (Plan 5.9d)', () => {
  it('single clip + static volume 0.5: output samples are 0.5× input', async () => { /* … */ });
  it('volume automation 0→1 over 4 beats: setValueAtTime called per 0.1-beat step', async () => { /* … */ });
  it('two overlapping clips: sample-wise sum present in output', async () => { /* … */ });
  it('video with audio track: video-audio source added to mix when audioEnabled', async () => { /* … */ });
  it('video without an audio track: decodeAudioData reject is swallowed, mix renders without it', async () => { /* … */ });
  it('peak normalisation triggered when summed peak > 1.0', async () => { /* … */ });
  it('peak normalisation NOT triggered when peak ≤ 1.0 (no surprise gain change)', async () => { /* … */ });
  it('clip starting after totalDurationSec renders silence without throw', async () => { /* … */ });
});
```

- [ ] **Step 2 — Implement `mixAudioOffline`**

```ts
// lib/export/mix-audio-offline.ts — NEW
import { resolveParam } from '@/lib/automation/resolve';
import type { Clip } from '@/lib/timeline/types';
import type { MediaRef } from '@/lib/storage/types';
import type { StaticOrAuto } from '@/lib/automation/types';

export interface VideoAudioClip {
  url: string;
  startBeat: number;
  audioEnabled: boolean;
}

/** Sample rate for the offline mix. 48 kHz is the WAV/MP4 standard
 *  and matches what the WebCodecs AudioEncoder expects downstream.
 *  Some older Android browsers only support 44.1 kHz in
 *  OfflineAudioContext and throw NotSupportedError here; that's
 *  out-of-scope for the Vercel/desktop v0.1 target and noted in
 *  KNOWN_LIMITATIONS. */
const EXPORT_SAMPLE_RATE = 48_000;

export async function mixAudioOffline(
  audioClips: Clip[],
  mediaRefs: MediaRef[],
  bpm: number,
  totalDurationSec: number,
  videoAudioClips: VideoAudioClip[] = []
): Promise<AudioBuffer> {
  const totalSamples = Math.ceil(totalDurationSec * EXPORT_SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(2, totalSamples, EXPORT_SAMPLE_RATE);

  // Audio clips first.
  for (const clip of audioClips) {
    const ref = mediaRefs.find((m) => m.id === clip.mediaId);
    if (!ref) continue;
    const arrayBuffer = await fetch(ref.url).then((r) => r.arrayBuffer());
    let buffer: AudioBuffer;
    try {
      buffer = await offlineCtx.decodeAudioData(arrayBuffer);
    } catch {
      continue;
    }
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    const gain = offlineCtx.createGain();
    applyVolumeAutomation(gain, clip, bpm);
    source.connect(gain);
    gain.connect(offlineCtx.destination);
    const startSec = (clip.startBeat * 60) / bpm;
    source.start(startSec, 0);
  }

  // Video-audio (audioEnabled clips). No GainNode — v0.1 has no
  // volume automation on video audio.
  for (const vc of videoAudioClips) {
    if (!vc.audioEnabled) continue;
    const arrayBuffer = await fetch(vc.url).then((r) => r.arrayBuffer());
    let buffer: AudioBuffer;
    try {
      buffer = await offlineCtx.decodeAudioData(arrayBuffer);
    } catch {
      // Video has no embedded audio track — skip silently.
      continue;
    }
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    const startSec = (vc.startBeat * 60) / bpm;
    source.start(startSec, 0);
  }

  const mixed = await offlineCtx.startRendering();

  // Peak normalisation. OfflineAudioContext clips hard at ±1.0; if
  // the sum exceeded that, scale back to 0.95 peak.
  const peak = findPeak(mixed);
  if (peak > 0.95) normalizePCM(mixed, 0.95 / peak);

  return mixed;
}

function applyVolumeAutomation(gain: GainNode, clip: Clip, bpm: number): void {
  const STEP = 0.1; // 0.1-beat raster
  const vol = (clip.params as { volume?: StaticOrAuto<number> } | undefined)?.volume ?? 1.0;
  // IEEE-754 accumulation: `beat += 0.1` 40× lands at 4.00000…001
  // (skip last point) or 3.99999…9 (overshoot). Iterate by integer
  // step count instead, clamp the last beat to lengthBeats.
  const steps = Math.ceil(clip.lengthBeats / STEP);
  for (let i = 0; i <= steps; i++) {
    const beat = Math.min(i * STEP, clip.lengthBeats);
    const v = resolveParam(vol, beat, clip.lengthBeats);
    const timeSec = ((clip.startBeat + beat) * 60) / bpm;
    gain.gain.setValueAtTime(v, timeSec);
  }
}

function findPeak(buf: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

function normalizePCM(buf: AudioBuffer, factor: number): void {
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] *= factor;
  }
}
```

- [ ] **Step 3 — Wire into `renderOffline`**

```ts
// lib/export/offline-render.ts — replace `deps.audioBuffer` with:
export interface OfflineRenderDeps {
  timeline: TimelineState;
  beatGrid: BeatGrid;
  // REMOVED: audioBuffer: AudioBuffer;
  // ADDED:
  audioClips: Clip[];          // timeline.clips.filter((c) => c.kind === 'audio')
  videoAudioClips: VideoAudioClip[]; // built from active video clips with audioEnabled
  mediaRefs: MediaRef[];
  bpm: number;
  // ... existing fields ...
}

// At the top of renderOffline, before the encoder setup:
const mixedBuffer = await mixAudioOffline(
  deps.audioClips,
  deps.mediaRefs,
  deps.bpm,
  durationSec,
  deps.videoAudioClips
);

// Then in the audio loop, replace `chunkAudioBuffer(deps.audioBuffer)` with
// `chunkAudioBuffer(mixedBuffer)`. Everything else stays.
```

- [ ] **Step 4 — Update `useVideoExporter` caller**

```ts
// lib/hooks/useVideoExporter.ts — build the new deps:
const timeline = useAppStore.getState().timeline;
const mediaRefs = useAppStore.getState().media.mediaRefs;
const bpm = useAppStore.getState().audio.grid.bpm;
const audioClips = timeline.clips.filter((c) => c.kind === 'audio');
const videoAudioClips: VideoAudioClip[] = timeline.clips
  .filter((c) => c.kind === 'video')
  .map((c) => ({
    url: mediaRefs.find((m) => m.id === c.mediaId)?.url ?? '',
    startBeat: c.startBeat,
    audioEnabled: Boolean((c.params as { audioEnabled?: boolean } | undefined)?.audioEnabled)
  }))
  .filter((vc) => vc.url !== '');

const result = await renderOffline({
  timeline,
  beatGrid,
  audioClips,
  videoAudioClips,
  mediaRefs,
  bpm,
  // ... existing fields ...
});
```

- [ ] **Step 5 — Update existing offline-render tests**

`tests/unit/export/offline-render.test.ts` and `tests/unit/export/offline-video.test.ts` construct fake `audioBuffer` deps today. Update to construct fake `audioClips: []`, `videoAudioClips: []`, `mediaRefs: []`, `bpm: 120`. The internal `mixAudioOffline` becomes a no-op when the lists are empty (returns silence buffer); existing assertions about frame-loop behaviour stay valid.

- [ ] **Step 6 — Run tests + commit**

```powershell
npm test -- --run
npm run typecheck
git add lib/export/mix-audio-offline.ts lib/export/offline-render.ts lib/hooks/useVideoExporter.ts tests/unit/export/offline-audio-mix.test.ts tests/unit/export/offline-render.test.ts tests/unit/export/offline-video.test.ts
git commit -m "feat(export): mixAudioOffline + multi-clip audio + video-audio in offline render"
```

---

### Task 8 — KNOWN_LIMITATIONS update

**Files:**
- Modify: `docs/KNOWN_LIMITATIONS.md`

- [ ] **Step 1 — Append the Audio section**

```markdown
## Plan 5.9d — Multi-Audio + Volume + Video-Audio

- **Video-Audio volume is not automatable.** Toggle on/off per clip
  via Inspector; the `audioEnabled` param is boolean only. In v0.2,
  route video audio through a `MediaElementAudioSourceNode` + GainNode
  for full automation parity with audio clips.
- **Offline mix sample rate hardcoded to 48 kHz** (`EXPORT_SAMPLE_RATE`
  in `lib/export/mix-audio-offline.ts`). Matches the WAV/MP4 standard
  and what the WebCodecs AudioEncoder expects downstream. Some older
  Android browsers only support 44.1 kHz in `OfflineAudioContext` and
  throw `NotSupportedError` — out-of-scope for v0.1 (Vercel/desktop
  target). Live `AudioContext` uses the browser default, so the
  live-preview rate may differ from the export rate; this is
  inaudible in practice.
- **Volume automation on a 0.1-beat raster in the offline export.**
  Fine for slow ramps (audibly smooth) but sub-0.1-beat volume stabs
  get quantised. Live preview is per-frame ramp → no quantisation
  there; the divergence is offline-only.
- **Offline mixdown peak-normalises at 0.95 when the summed peak
  exceeds 1.0.** Prevents hard clipping but does not target a
  specific LUFS level. Loudness-compatibility with streaming
  platforms (Spotify −14 LUFS, YouTube −14 LUFS) is the user's job
  via external mastering.
- **No per-track master volume.** Each clip's `volume` param controls
  itself; there is no "track gain" layer between the clip's
  GainNode and `destination`. v0.2 adds Track-level mute states +
  master gain.
- **No audio-clip trim / in-out points in v0.1.** Clips always play
  from the start of their underlying media file. v0.2 adds
  `clipStartInMediaSec` / `clipDurationInMediaSec` fields plus the
  Inspector controls.
```

- [ ] **Step 2 — Commit**

```powershell
git add docs/KNOWN_LIMITATIONS.md
git commit -m "docs: KNOWN_LIMITATIONS — Plan 5.9d audio + video-audio + volume notes"
```

---

## Verification Gate

Baseline: post-5.9c HEAD (617 tests).
Target: ≥ Baseline + **20** (i.e. ≥ 637). Plan adds 8 + 2 + 8 + 3 + 2 + 3 + 2 = **28** new cases across seven new files, leaving comfortable headroom for inevitable drift during implementation. Bundle ≤ Baseline + 5 %.

```powershell
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

All four must be clean. Build-size budget: the only new dep is `OfflineAudioContext` which ships in the browser — nothing added to the bundle. Bundle should stay essentially flat; the 5 % budget is just slack for added code.

---

## Smoke Gate

After all tasks land:

```powershell
npm run dev
# 1. Open a fresh project. Click "+ Track hinzufügen" → Audio option
#    is now visible (was missing in 5.9c) → click → new "Audio 2" lane.
# 2. Drag a second audio file onto Audio 2 → clip appears as a band.
#    Drag a third file onto Audio (lane 1) → both lanes have clips.
# 3. Press Play → both audio files play synchronised. Pause works,
#    Stop returns to beat 0 with the scrollbar-reset working.
# 4. Select an audio clip → Inspector shows the filename as header
#    + a Volume slider at 100 %.
# 5. Drag the slider down to ~30 % → playback volume of that clip
#    drops live, the other clip is unaffected.
# 6. Click ⚡ on Volume → AutomationEditor opens → author a 0→1
#    ramp over the first 4 beats. Press Play from beat 0:
#    - The first 4 beats are perceptibly quieter than the rest.
#    - The amplitude curve is smooth (no zipper / clicks).
# 7. Select a video clip → Inspector shows the filename header
#    + an audioEnabled toggle, OFF by default → toggle ON →
#    Press Play → video audio is now audible alongside the audio
#    clips.
# 8. Click Export → wait for completion → open the MP4 in VLC:
#    - Both audio tracks audible
#    - Volume automation 0→1 over the first 4 beats is preserved
#    - Video-audio mixed in (if the toggle was ON during export)
#    - Open the same MP4 in Audacity → wave-shape over first 4 beats
#      shows a monotone amplitude increase; ab beat 4 stays constant.
# 9. Load an existing v6 project (pre-5.9d) → loads cleanly, no
#    migration prompts. Existing image / FX clips render unchanged.
#    Any pre-existing audio clip plays with default volume 1.0.
```

Any failure → STOP, investigate before merge.

---

## Risk Table

| Risk | Mitigation |
|---|---|
| Multi-clip sync drift on slow machines (start times skew because the lookahead window is too tight) | `LOOKAHEAD = 50 ms` is the Web Audio textbook value; if smoke testing reveals audible skew on weak hardware, bump to 100 ms in a follow-up. Documented in `useAudioEngine` comments. |
| `decodeAudioData` on a video file fails for codecs the browser refuses to fully decode (e.g. uncommon AAC variants) | `try/catch` swallows the failure; the video plays without audio in the export, matching its silent live-preview state. Documented in KNOWN_LIMITATIONS. |
| Peak normalisation lowers perceived loudness vs. naive sum-clip | Acceptable — `0.95` cap is a transparent ceiling. Users who want louder masters can apply post-export gain or use external mastering. Documented in KNOWN_LIMITATIONS. |
| `useAudioEngine` Strict-Mode lifecycle bug recurrence | Copy the exact `useVideoEngine` pattern (commit `6265582`). The "ONE master `useEffect`" structure is the load-bearing piece; reviewer MUST verify the engine ref is captured INSIDE the effect, not in the hook body. |
| Existing offline-render tests construct fake `audioBuffer` directly — signature change in Task 7 breaks them | Tests are updated in the same commit. Tests that exercise the encoder path with NO audio activity get `audioClips: [], videoAudioClips: []` which produces a silent buffer — every assertion about frame loop / video encoding stays valid. |
| Volume-automation 0.1-beat raster in export sounds "stair-steppy" for fast stabs | Documented in KNOWN_LIMITATIONS. Fix is a finer raster (0.01 beat) at the cost of more `setValueAtTime` calls per clip; acceptable bump in a follow-up plan. |

---

## Out of Scope

- **Video-audio volume automation** (v0.2 — `MediaElementAudioSourceNode` routing).
- **Audio-clip trim / in-out points** (v0.2 — `clipStartInMediaSec` field + Inspector controls).
- **Per-track master volume / mute group** (v0.2 — adds a track-level GainNode layer).
- **Per-clip waveform thumbnail in the timeline** (orthogonal — the global-track Waveform from 5.5 stays, per-clip is a separate feature).
- **Auto-Preset prompt awareness of audio clips** (Plan 5.8b will update the analyzer's output schema).
- **LUFS-targeted normalisation** (out of scope for v0.1; users do their own mastering).

---

## Commit log (target)

```
feat(audio): AudioEngine multi-clip API — load/play/stop/setVolume/rampVolume
feat(audio): useAudioEngine multi-clip reconciler (Strict-Mode-safe via useVideoEngine pattern)
feat(store): addTrack('audio') fully enabled — remove v0.2 stub
feat(renderer): per-frame rampClipVolume for active audio clips
feat(video): per-clip audioEnabled toggle drives videoEl.muted
feat(inspector): volume slider for audio clips + video-audio toggle + media-clip header
feat(export): mixAudioOffline + multi-clip audio + video-audio in offline render
docs: KNOWN_LIMITATIONS — Plan 5.9d audio + video-audio + volume notes
```

8 commits. Baseline + 8 + buffer for fixup-during-execution.

---

## Execution Notes (CC #1 hand-off)

- Each task is a single commit. Don't batch.
- Task 1 is the foundation — every subsequent task assumes the engine API exists. Get the test mocks right (especially for `OfflineAudioContext` vs `AudioContext`); they bite the most.
- The `useAudioEngine` reconciler in Task 2 MUST follow the `useVideoEngine` pattern exactly. The Strict-Mode bug from 5.9b (engine ref stranded on cleanup → subscription on stale null) is the failure mode to avoid; reviewer should re-read `lib/hooks/useVideoEngine.ts` before implementing.
- Task 7 has the highest typecheck surface (signature break of `renderOffline`). Run `npm run typecheck` after EACH `useVideoExporter` / `offline-render` edit to catch fanout fast.
- If any task fails verification (typecheck / lint / tests / build), STOP. Don't pile on fixes. Investigate root cause via `superpowers:systematic-debugging`.
- Smoke Gate step 6 (volume-automation ramp audible) is the visual + auditory gate for the headline feature; do it personally before claiming the plan is done.
