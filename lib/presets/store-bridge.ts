/**
 * Plan 9a — bridge between the preset-pack system and the real Zustand
 * store API. Centralises every PascalCase ↔ kebab-case conversion and
 * every assumption about where state lives (`timeline.tracks`,
 * `timeline.clips`, `timelineActions.*`, `audio.grid.bpm`). Components
 * and the apply/save logic call into here instead of touching the store
 * directly — keeps the surface for future store refactors small.
 */
import {
  PLUGIN_KIND_TO_TRACK_KIND,
  type PluginFxKind
} from '@/lib/timeline/plugin-mapping';
import type { AutomationPoint, AutomationCurve } from '@/lib/automation/types';
import { isAutomationCurve } from '@/lib/automation/resolve';
import { useAppStore } from '@/lib/store';
import { DEFAULT_BEAT_GRID } from '@/lib/audio/types';

/** PascalCase plugin-kind → kebab-case clip-kind (`'ZoomPunch'` → `'zoom-punch'`).
 *  Single source-of-truth for the conversion in the preset path. */
export function toClipKind(fxKind: PluginFxKind): string {
  return PLUGIN_KIND_TO_TRACK_KIND[fxKind];
}

/** Finds the first `'fx'` track whose `name === fxKind`, or creates a new
 *  one. We use `track.name` as the identity carrier so users can SEE
 *  which FX-kind a track was created for ("ZoomPunch" in the track
 *  header). If a user renames the track, this lookup misses → a fresh
 *  track is created. Documented in KNOWN_LIMITATIONS. */
export function findOrCreateFxTrack(fxKind: PluginFxKind): string {
  const { timeline, timelineActions } = useAppStore.getState();
  const existing = timeline.tracks.find(
    (t) => t.kind === 'fx' && t.name === fxKind
  );
  if (existing) return existing.id;
  return timelineActions.addTrack('fx', fxKind);
}

/** Creates a clip on the given track. The id is generated here so the
 *  caller has it immediately for subsequent automation-curve writes. */
export function addPresetClip(args: {
  trackId: string;
  startBeat: number;
  lengthBeats: number;
  /** kebab-case clip-kind, e.g. `'zoom-punch'`. Use `toClipKind()`. */
  kind: string;
  params: Record<string, unknown>;
  label: string;
}): string {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  useAppStore.getState().timelineActions.addClip({
    id,
    trackId: args.trackId,
    startBeat: args.startBeat,
    lengthBeats: args.lengthBeats,
    // Clip.kind is `TrackKind | TrackFxKind` — preset packs only ever
    // produce FX-kinds, so the runtime cast is safe.
    kind: args.kind as never,
    params: args.params,
    label: args.label
  });
  return id;
}

/** Sets a complete automation curve on `clip.params[key]`. Uses
 *  `convertParamToAutomation` for the first point (which seeds the
 *  curve with `(beat, value)`), then `addParamPoint` for the rest —
 *  matches the store's authoring API without producing a duplicate
 *  initial point. */
export function setAutomationCurve(
  clipId: string,
  key: string,
  points: AutomationPoint<number>[]
): void {
  if (points.length === 0) return;
  const { timelineActions } = useAppStore.getState();
  timelineActions.convertParamToAutomation(
    clipId,
    key,
    points[0].beat,
    points[0].value
  );
  for (const p of points.slice(1)) {
    timelineActions.addParamPoint(clipId, key, p);
  }
}

/** Extracts every automation curve from a clip's params, keyed by the
 *  param-name. Static params are skipped. */
export function getAutomationCurves(
  clipId: string
): Record<string, AutomationPoint<number>[]> {
  const clip = useAppStore
    .getState()
    .timeline.clips.find((c) => c.id === clipId);
  if (!clip || !clip.params) return {};
  const result: Record<string, AutomationPoint<number>[]> = {};
  for (const [key, value] of Object.entries(clip.params)) {
    if (isAutomationCurve(value)) {
      result[key] = (value as AutomationCurve<number>).points;
    }
  }
  return result;
}

/** Last beat of the longest media (audio/video) clip on the timeline,
 *  fallback to 64 beats when empty. Used as the default upper bound
 *  for applying a pack that doesn't specify its own clip length. */
export function getTimelineEndBeat(): number {
  const mediaCl = useAppStore
    .getState()
    .timeline.clips.filter((c) => c.kind === 'audio' || c.kind === 'video');
  if (mediaCl.length === 0) return 64;
  return Math.max(...mediaCl.map((c) => c.startBeat + c.lengthBeats));
}

/** Current project BPM. Falls back to `DEFAULT_BEAT_GRID.bpm` (120)
 *  if the audio slice is not initialised yet (e.g. during SSR). */
export function getProjectBpm(): number {
  const audio = useAppStore.getState().audio;
  return audio?.grid?.bpm ?? DEFAULT_BEAT_GRID.bpm;
}

/** Beats-per-bar from the current grid, default 4. */
export function getBeatsPerBar(): number {
  const audio = useAppStore.getState().audio;
  return audio?.grid?.beatsPerBar ?? DEFAULT_BEAT_GRID.beatsPerBar;
}

/** Display helper for the BPM badge. `'any'` → 'Any BPM', number → 'N BPM'. */
export function formatBpmReference(ref: number | 'any'): string {
  return ref === 'any' ? 'Any BPM' : `${ref} BPM`;
}
