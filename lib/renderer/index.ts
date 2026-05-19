import { createRenderer, type Renderer, type RendererDeps } from './loop';

export { createRenderer };
export type { Renderer, RendererDeps };

let singleton: Renderer | null = null;

export function getRenderer(deps: RendererDeps): Renderer {
  if (!singleton) singleton = createRenderer(deps);
  return singleton;
}

/** For tests only — drops the singleton. */
export function _resetRendererForTests(): void {
  singleton?.stop();
  singleton = null;
}
