import type { FxKind, FxPlugin } from './types';

/**
 * Stored plugins are typed `FxPlugin<unknown>` so the registry accepts plugins
 * with concrete Params interfaces (e.g. `FxPlugin<PulseParams>`). The render
 * loop calls `plugin.render(rc, clip.params ?? plugin.getDefaultParams())`,
 * which is type-checked at the call site against the plugin's own Params.
 */
type StoredPlugin = FxPlugin<unknown>;

const plugins = new Map<string, StoredPlugin>();

export function register<P>(plugin: FxPlugin<P>): void {
  if (plugins.has(plugin.id)) {
    throw new Error(`Plugin "${plugin.id}" is already registered`);
  }
  plugins.set(plugin.id, plugin as StoredPlugin);
}

export function getPlugin(id: string): StoredPlugin | undefined {
  return plugins.get(id);
}

export function listPlugins(): StoredPlugin[] {
  return Array.from(plugins.values());
}

export function listPluginsByKind(kind: FxKind): StoredPlugin[] {
  return listPlugins().filter((p) => p.kind === kind);
}

/** For tests only — clears the module-level registry between cases. */
export function _resetRegistryForTests(): void {
  plugins.clear();
}
