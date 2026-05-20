import type { TriggerMode } from '@/lib/timeline/types';

export type { TriggerMode };

export type ParamType =
  | { kind: 'slider'; min: number; max: number; step: number; default: number; unit?: string }
  | { kind: 'color'; default: string; palette?: string[] }
  | { kind: 'select'; options: { value: string; label: string }[]; default: string }
  | { kind: 'toggle'; default: boolean };

export type ParamSchema = Record<string, ParamType & { label: string }>;

export type PreloadState = 'idle' | 'loading' | 'ready' | 'error';

export type FxKind = 'Contour' | 'Pulse' | 'Sweep' | 'Particle' | 'ZoomPulse';

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
