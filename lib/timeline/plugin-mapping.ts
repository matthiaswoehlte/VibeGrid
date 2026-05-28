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
  'letterbox-squeeze',
  // Plan 8f.1 — first WebGL2 FX kind.
  'color-grade-shift',
  // Plan 8f.2 — second WebGL2 FX kind.
  'retro-vhs',
  // Plan 8f.3 — third WebGL2 FX kind (chain-composed Edge Glow).
  'edge-glow'
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
  // Plan 8f.1 — WebGL2 image-modifying FX (renders OffscreenCanvas →
  // drawImage onto main 2D canvas; sits with the other image-modifying
  // layers before the overlay group).
  'color-grade-shift',
  // Plan 8f.2 — RetroVHS sits next to ColorGradeShift in the
  // image-modifying group. Both re-sample the bitmap in GLSL; ordering
  // between them is cosmetic (last-rendered wins on opaque output).
  'retro-vhs',
  // Plan 8f.3 — Edge Glow sampelt den bereits composed Frame
  // (source='canvas' in renderGlFx). Muss daher NACH allen anderen
  // image-modifying FX in der Render-Reihenfolge stehen.
  'edge-glow',
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
  | 'LetterboxSqueeze'
  // Plan 8f.1 — WebGL2 FX.
  | 'ColorGradeShift'
  // Plan 8f.2 — second WebGL2 FX.
  | 'RetroVHS'
  // Plan 8f.3 — third WebGL2 FX.
  | 'EdgeGlow';

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
  LetterboxSqueeze: 'letterbox-squeeze',
  // Plan 8f.1 — WebGL2 FX.
  ColorGradeShift: 'color-grade-shift',
  // Plan 8f.2 — second WebGL2 FX.
  RetroVHS: 'retro-vhs',
  // Plan 8f.3 — third WebGL2 FX.
  EdgeGlow: 'edge-glow'
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
  'letterbox-squeeze': 'LetterboxSqueeze',
  // Plan 8f.1 — WebGL2 FX.
  'color-grade-shift': 'ColorGradeShift',
  // Plan 8f.2 — second WebGL2 FX.
  'retro-vhs': 'RetroVHS',
  // Plan 8f.3 — third WebGL2 FX.
  'edge-glow': 'EdgeGlow'
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
  'letterbox-squeeze': 'Letterbox',
  // Plan 8f.1 — WebGL2 FX.
  'color-grade-shift': 'Color Grade',
  // Plan 8f.2 — second WebGL2 FX.
  'retro-vhs': 'Retro VHS',
  // Plan 8f.3 — Edge Glow (CapCut-style outline + glow).
  'edge-glow': 'Edge Glow'
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
  'letterbox-squeeze': '#1a1a1a',   // near-black — cinema bars
  // Plan 8f.1 — WebGL2 FX. Warm magenta/violet (color-grading vibe).
  'color-grade-shift': '#c47aff',
  // Plan 8f.2 — RetroVHS. Faded teal/cyan (analog tape colour-shift vibe).
  'retro-vhs': '#3aaab3',
  // Plan 8f.3 — Edge Glow. Helles Cyan (Neon-Outline-Vibe).
  'edge-glow': '#00e5ff'
};
