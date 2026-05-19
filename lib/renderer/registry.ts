import type { FxKind, FxPlugin } from './types';

const plugins = new Map<string, FxPlugin>();

export function register(plugin: FxPlugin): void {
  if (plugins.has(plugin.id)) {
    throw new Error(`Plugin "${plugin.id}" is already registered`);
  }
  plugins.set(plugin.id, plugin);
}

export function getPlugin(id: string): FxPlugin | undefined {
  return plugins.get(id);
}

export function listPlugins(): FxPlugin[] {
  return Array.from(plugins.values());
}

export function listPluginsByKind(kind: FxKind): FxPlugin[] {
  return listPlugins().filter((p) => p.kind === kind);
}

/** For tests only — clears the module-level registry between cases. */
export function _resetRegistryForTests(): void {
  plugins.clear();
}
