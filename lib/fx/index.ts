import { register, _resetRegistryForTests } from '@/lib/renderer/registry';
import { pulsePlugin } from './pulse';
import { sweepPlugin } from './sweep';
import { particlesPlugin } from './particles';
import { contourPlugin } from './contour';
import { zoomPulsePlugin } from './zoom-pulse';
import { textPlugin } from './text';
import { dissolvePlugin } from './dissolve';
import { sunrayPlugin } from './sunray';

let registered = false;

/**
 * Registers the v0.1 + Plan-5.8a plugins. Called once by createRenderer.
 * Idempotent — safe to call multiple times across HMR reloads.
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
  registered = true;
}

/** For tests only — resets both the registry and the local flag. */
export function _resetBuiltInPluginsForTests(): void {
  _resetRegistryForTests();
  registered = false;
}
