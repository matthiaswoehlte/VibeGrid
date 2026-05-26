import { register, _resetRegistryForTests } from '@/lib/renderer/registry';
import { pulsePlugin } from './pulse';
import { sweepPlugin } from './sweep';
import { particlesPlugin } from './particles';
import { contourPlugin } from './contour';
import { zoomPulsePlugin } from './zoom-pulse';
import { textPlugin } from './text';
import { dissolvePlugin } from './dissolve';
import { sunrayPlugin } from './sunray';
// Plan 8e — 9 new beat-sync FX.
import { beatFlashPlugin } from './beat-flash';
import { rgbSplitPlugin } from './rgb-split';
import { zoomPunchPlugin } from './zoom-punch';
import { screenShakePlugin } from './screen-shake';
import { vignetteBreathePlugin } from './vignette-breathe';
import { lensFlareBurstPlugin } from './lens-flare-burst';
import { filmGrainBurstPlugin } from './film-grain-burst';
import { glitchSlicePlugin } from './glitch-slice';
import { letterboxSqueezePlugin } from './letterbox-squeeze';

let registered = false;

/**
 * Registers the v0.1 + Plan-5.8a + Plan 8e plugins. Called once by
 * createRenderer. Idempotent — safe to call multiple times across HMR
 * reloads.
 */
export function registerBuiltInPlugins(): void {
  if (registered) return;
  register(pulsePlugin);
  register(sweepPlugin);
  register(particlesPlugin);
  register(contourPlugin);
  register(zoomPulsePlugin);
  // Plan 5.8a — three new FX plugins.
  register(textPlugin);
  register(dissolvePlugin);
  register(sunrayPlugin);
  // Plan 8e — 9 new beat-sync FX plugins.
  register(beatFlashPlugin);
  register(rgbSplitPlugin);
  register(zoomPunchPlugin);
  register(screenShakePlugin);
  register(vignetteBreathePlugin);
  register(lensFlareBurstPlugin);
  register(filmGrainBurstPlugin);
  register(glitchSlicePlugin);
  register(letterboxSqueezePlugin);
  registered = true;
}

/** For tests only — resets both the registry and the local flag. */
export function _resetBuiltInPluginsForTests(): void {
  _resetRegistryForTests();
  registered = false;
}
