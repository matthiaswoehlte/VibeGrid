/**
 * Plan 5.9c — Single source of truth for everything that maps between
 * PascalCase plugin-kinds (the FxPlugin.kind values registered with
 * the renderer) and lowercase clip-kinds (the value stored on
 * clip.kind). Anything that needs this mapping imports from here —
 * renderer, drop-validation, Inspector display, Clip-band color,
 * AddTrackButton picker labels.
 *
 * Why this lives in lib/timeline/ and not lib/renderer/: UI components
 * (Tracks.tsx, Clip.tsx, Inspector) need the mappings for drop-routing
 * and labels. Importing them from the renderer was a cross-layer
 * dependency that duplicated PLUGIN_TO_TRACK_KIND inline in Tracks.tsx.
 * Timeline is a foundational layer that both renderer and UI consume.
 */

/** The 8 lowercase FX-clip kinds. Stored on `clip.kind` for FX clips.
 *  In a v6+ store, no TRACK has `kind` from this list — tracks are
 *  `'fx'` and CLIPS carry the specific kind. */
export const TRACK_FX_KINDS = [
  'contour',
  'sweep',
  'pulse',
  'particles',
  'zoom-pulse',
  'text',
  'dissolve',
  'sunray'
] as const;

export type TrackFxKind = (typeof TRACK_FX_KINDS)[number];

/** Render order for FX clips (back-to-front, painter's algorithm).
 *  Dissolve manipulates the image directly; Contour/ZoomPulse are
 *  image-modifying overlays; Sweep/Particle/Pulse are flashes;
 *  Sunray is directional light; Text always on top. Order matches
 *  the old PascalCase RENDER_ORDER in lib/renderer/loop.ts. */
export const RENDER_ORDER_TRACK_KIND = [
  'dissolve',
  'contour',
  'zoom-pulse',
  'sweep',
  'particles',
  'pulse',
  'sunray',
  'text'
] as const satisfies readonly TrackFxKind[];

/** Lookup index — unknown kinds sort to the end. */
export function fxSortIndex(clipKind: string): number {
  const i = (RENDER_ORDER_TRACK_KIND as readonly string[]).indexOf(clipKind);
  return i === -1 ? RENDER_ORDER_TRACK_KIND.length : i;
}

/** PluginFxKind values — keep in sync with `FxPlugin.kind` literals
 *  registered via lib/fx/. PascalCase by convention. Structurally
 *  identical to lib/renderer/types.ts's FxKind union; the duplication
 *  is intentional to keep the dependency direction
 *  renderer → timeline, never the reverse. */
export type PluginFxKind =
  | 'Contour'
  | 'Sweep'
  | 'Pulse'
  | 'Particle'
  | 'ZoomPulse'
  | 'Text'
  | 'Dissolve'
  | 'Sunray';

/** PascalCase → lowercase. The Particle ↔ particles name asymmetry
 *  is the only non-trivial entry — singular plugin name, plural
 *  clip-kind (because the track historically held many particle
 *  emissions on one lane). */
export const PLUGIN_KIND_TO_TRACK_KIND: Record<PluginFxKind, TrackFxKind> = {
  Contour: 'contour',
  Sweep: 'sweep',
  Pulse: 'pulse',
  Particle: 'particles',
  ZoomPulse: 'zoom-pulse',
  Text: 'text',
  Dissolve: 'dissolve',
  Sunray: 'sunray'
};

/** Inverse of PLUGIN_KIND_TO_TRACK_KIND — used by the renderer to
 *  resolve a plugin instance from a clip's lowercase kind. */
export const TRACK_KIND_TO_PLUGIN_KIND: Record<TrackFxKind, PluginFxKind> = {
  contour: 'Contour',
  sweep: 'Sweep',
  pulse: 'Pulse',
  particles: 'Particle',
  'zoom-pulse': 'ZoomPulse',
  text: 'Text',
  dissolve: 'Dissolve',
  sunray: 'Sunray'
};

/** Human-readable label shown in the Inspector header and clip-band. */
export const FX_DISPLAY_NAME: Record<TrackFxKind, string> = {
  contour: 'Contour',
  sweep: 'Color Sweep',
  pulse: 'Pulse',
  particles: 'Particles',
  'zoom-pulse': 'Zoom Pulse',
  text: 'Text',
  dissolve: 'Dissolve',
  sunray: 'Sunray'
};

/** Clip-band background color in the Timeline UI. Keep contrast vs
 *  the surface-3 hover background. Values are CSS color expressions
 *  (CSS custom property references or hex literals). */
export const FX_CLIP_COLORS: Record<TrackFxKind, string> = {
  contour: 'var(--a1)',
  sweep: '#e05a7a',
  pulse: '#7a6a3a',
  'zoom-pulse': '#3a6a7a',
  particles: 'var(--a3)',
  text: '#6a3a7a',
  dissolve: '#3a5a3a',
  sunray: '#7a6a1a'
};
