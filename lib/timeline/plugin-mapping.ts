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
  'sunray',
  // Plan 8e — 9 new beat-sync FX kinds.
  'beat-flash',
  'rgb-split',
  'zoom-punch',
  'screen-shake',
  'vignette-breathe',
  'lens-flare-burst',
  'film-grain-burst',
  'glitch-slice',
  'letterbox-squeeze'
] as const;

export type TrackFxKind = (typeof TRACK_FX_KINDS)[number];

/** Render order for FX clips (back-to-front, painter's algorithm).
 *  Dissolve manipulates the image directly; Contour/ZoomPulse are
 *  image-modifying overlays; Sweep/Particle/Pulse are flashes;
 *  Sunray is directional light; Text always on top. Order matches
 *  the old PascalCase RENDER_ORDER in lib/renderer/loop.ts. */
export const RENDER_ORDER_TRACK_KIND = [
  // Image-modifying FX (re-draw the frame on a transformed context).
  'dissolve',
  'contour',
  'zoom-pulse',
  // Plan 8e — new image-modifying FX, layered after the existing ones.
  'rgb-split',
  'zoom-punch',
  'screen-shake',
  'glitch-slice',
  // Overlay FX (paint on top of whatever was drawn underneath).
  'sweep',
  'particles',
  'pulse',
  'sunray',
  // Plan 8e — new overlay FX.
  'beat-flash',
  'vignette-breathe',
  'lens-flare-burst',
  'film-grain-burst',
  // Text always above the rest of the overlay stack.
  'text',
  // Letterbox is the geometric mask — must paint over EVERYTHING.
  'letterbox-squeeze'
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
  | 'LetterboxSqueeze';

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
  Sunray: 'sunray',
  // Plan 8e — 9 new beat-sync FX kinds.
  BeatFlash: 'beat-flash',
  RGBSplit: 'rgb-split',
  ZoomPunch: 'zoom-punch',
  ScreenShake: 'screen-shake',
  VignetteBreathe: 'vignette-breathe',
  LensFlareBurst: 'lens-flare-burst',
  FilmGrainBurst: 'film-grain-burst',
  GlitchSlice: 'glitch-slice',
  LetterboxSqueeze: 'letterbox-squeeze'
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
  sunray: 'Sunray',
  // Plan 8e — 9 new beat-sync FX kinds.
  'beat-flash': 'BeatFlash',
  'rgb-split': 'RGBSplit',
  'zoom-punch': 'ZoomPunch',
  'screen-shake': 'ScreenShake',
  'vignette-breathe': 'VignetteBreathe',
  'lens-flare-burst': 'LensFlareBurst',
  'film-grain-burst': 'FilmGrainBurst',
  'glitch-slice': 'GlitchSlice',
  'letterbox-squeeze': 'LetterboxSqueeze'
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
  sunray: 'Sunray',
  // Plan 8e — 9 new beat-sync FX.
  'beat-flash': 'Beat Flash',
  'rgb-split': 'RGB Split',
  'zoom-punch': 'Zoom Punch',
  'screen-shake': 'Screen Shake',
  'vignette-breathe': 'Vignette Breathe',
  'lens-flare-burst': 'Lens Flare',
  'film-grain-burst': 'Film Grain',
  'glitch-slice': 'Glitch Slice',
  'letterbox-squeeze': 'Letterbox'
};

/** Clip-band background color in the Timeline UI. Keep contrast vs
 *  the surface-3 hover background.
 *
 *  **MUST be 6-digit hex literals** — Clip.tsx concatenates a 2-digit
 *  alpha suffix (`'33'` / `'66'`) onto the color string to produce a
 *  translucent body fill. `var(--a1)33` is invalid CSS; the body
 *  silently goes transparent. If you really want a CSS custom
 *  property here, refactor Clip.tsx to use `rgba()` or
 *  `color-mix()` instead of the suffix trick. */
export const FX_CLIP_COLORS: Record<TrackFxKind, string> = {
  contour: '#a86bff',      // purple — matches --a1 (electric default)
  sweep: '#e05a7a',
  pulse: '#7a6a3a',
  'zoom-pulse': '#3a6a7a',
  particles: '#2ee0d0',    // teal — matches --a3 (electric default)
  text: '#6a3a7a',
  dissolve: '#3a5a3a',
  sunray: '#7a6a1a',
  // Plan 8e — 9 new beat-sync FX. Distinct hues, all 6-digit hex
  // (Clip.tsx appends a 2-digit alpha suffix — see comment on this map).
  'beat-flash': '#f5d76e',          // warm yellow flash
  'rgb-split': '#ff5a8a',           // hot pink — channel-shift vibe
  'zoom-punch': '#5a7aff',          // bold blue
  'screen-shake': '#ff9a3a',        // orange — high-energy
  'vignette-breathe': '#2a3a5a',    // deep navy — vignette/dark theme
  'lens-flare-burst': '#ffe89a',    // pale gold — light flare
  'film-grain-burst': '#8a8a8a',    // neutral grey — film noise
  'glitch-slice': '#7aff7a',        // acid green — glitch palette
  'letterbox-squeeze': '#1a1a1a'    // near-black — cinema bars
};
