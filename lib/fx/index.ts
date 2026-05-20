import { register, _resetRegistryForTests } from '@/lib/renderer/registry';
import { pulsePlugin } from './pulse';
import { sweepPlugin } from './sweep';
import { particlesPlugin } from './particles';
import { contourPlugin } from './contour';
import { zoomPulsePlugin } from './zoom-pulse';

let registered = false;

/**
 * Registers the five v0.1 plugins. Called once by createRenderer.
 * Idempotent — safe to call multiple times across HMR reloads.
 */
export function registerBuiltInPlugins(): void {
  if (registered) return;
  register(pulsePlugin);
  register(sweepPlugin);
  register(particlesPlugin);
  register(contourPlugin);
  register(zoomPulsePlugin);
  registered = true;
}

/** For tests only — resets both the registry and the local flag. */
export function _resetBuiltInPluginsForTests(): void {
  _resetRegistryForTests();
  registered = false;
}
