import type { TriggerMode } from '@/lib/timeline/types';

export type { TriggerMode };

export type ParamType =
  | { kind: 'slider'; min: number; max: number; step: number; default: number; unit?: string }
  | { kind: 'color'; default: string; palette?: string[] }
  | { kind: 'select'; options: { value: string; label: string }[]; default: string }
  | { kind: 'toggle'; default: boolean }
  | { kind: 'text'; default: string; maxLength?: number };

/**
 * Plan 5.8b — optional per-param visibility predicate. When set, the
 * Inspector calls `visibleWhen(clip.params)` before rendering the param;
 * if it returns false, the param's row + its AutomateButton are both
 * omitted (no grey, no disabled — entirely absent). Store values and
 * AutomationCurves are preserved; toggling the gating param brings the
 * row back with prior state intact.
 *
 * Lives on the schema-level intersection alongside `label` (not on the
 * `ParamType` union itself) so the discriminated variants stay clean
 * and the field is only visible where schemas are consumed.
 */
export type ParamSchema = Record<string, ParamType & {
  label: string;
  visibleWhen?: (params: Record<string, unknown>) => boolean;
}>;

export type PreloadState = 'idle' | 'loading' | 'ready' | 'error';

export type FxKind =
  | 'Contour'
  | 'Pulse'
  | 'Sweep'
  | 'Particle'
  | 'ZoomPulse'
  // Plan 5.8a — three new FX kinds.
  | 'Text'
  | 'Dissolve'
  | 'Sunray'
  // Plan 8e — 9 new beat-sync FX kinds.
  | 'BeatFlash'
  | 'RGBSplit'
  | 'ZoomPunch'
  | 'ScreenShake'
  | 'VignetteBreathe'
  | 'LensFlareBurst'
  | 'FilmGrainBurst'
  | 'GlitchSlice'
  | 'LetterboxSqueeze'
  // Plan 8f.1 — WebGL2 FX (first of the foundation).
  | 'ColorGradeShift'
  // Plan 8f.2 — second WebGL2 FX.
  | 'RetroVHS'
  // Plan 8f.3 — third WebGL2 FX (post-composition Edge Glow).
  | 'EdgeGlow'
  // Plan 8f.4 — fourth WebGL2 FX (chain-composed Contour outline + sweep).
  | 'ContourGL';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  beatPhase: number;
  beatIndex: number;
  isOnBeat: boolean;
  trigger: TriggerMode;
  /** Identity of the clip currently being rendered. Plugins that hold
   *  per-clip mutable state (e.g. Particles' spawn pool) key off this. */
  clipId: string;
  /** Plan-5.8a: clip start time in seconds (absolute). `clip.startBeat`
   *  converted via BPM + `beatGrid.offsetMs`. Plugins use this together
   *  with `clipDurationSec` to compute clip-relative progress. */
  clipStartSec: number;
  /** Plan-5.8a: clip duration in seconds. `clip.lengthBeats` converted
   *  via BPM — **no** offsetMs term (it's a duration, not a timestamp). */
  clipDurationSec: number;
  /** Global Beat ↔ Flow toggle. When true, beat-triggered FX (Pulse flash,
   *  ZoomPulse scale, Particles burst) must skip their per-beat work — the
   *  curve interpolation alone carries the motion in Flow Mode. */
  flowMode: boolean;
  /**
   * Guaranteed non-undefined when render() is invoked, EXCEPT for plugins
   * whose `kind === 'Pulse'`. The render loop never invokes other plugins
   * without an active image clip.
   */
  imageBitmap?: ImageBitmap;
  /**
   * Plan 5.9b hotfix: stable identity for `imageBitmap`, so plugins that
   * extract + cache derived data (e.g. Contour's edge paths) can key by
   * a string instead of by per-frame bitmap identity.
   *
   * - Image clip: `mediaId`. Stable across the lifetime of the bitmap.
   * - Video clip: `${mediaId}|${500ms-bucket}`. Re-extraction happens
   *   when the video advances into a new bucket, every ~500 ms.
   */
  imageBitmapKey?: string;
}

export interface FxPlugin<Params = Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly kind: FxKind;
  readonly defaultTrigger: TriggerMode;
  readonly paramSchema: ParamSchema;
  preloadState: PreloadState;
  getDefaultParams(): Params;
  preload(imageBitmap: ImageBitmap, signal: AbortSignal): Promise<void>;
  render(rc: RenderContext, params: Params): void;
  dispose?(): void;
}
