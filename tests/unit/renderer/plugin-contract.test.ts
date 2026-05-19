import { describe, it, expect } from 'vitest';
import { listPlugins } from '@/lib/renderer/registry';
import { registerBuiltInPlugins, _resetBuiltInPluginsForTests } from '@/lib/fx';
import { makeRenderContext } from './_helpers';

// Register at module load — it.each() below evaluates before beforeAll() would run.
_resetBuiltInPluginsForTests();
registerBuiltInPlugins();

describe('FxPlugin contract', () => {
  it.each(listPlugins().map((p) => [p.id, p] as const))(
    'plugin %s conforms to the FxPlugin contract',
    (_id, plugin) => {
      expect(typeof plugin.id).toBe('string');
      expect(plugin.id.length).toBeGreaterThan(0);
      expect(typeof plugin.name).toBe('string');
      expect(['Contour', 'Pulse', 'Sweep', 'Particle']).toContain(plugin.kind);
      expect(['half-bar', 'beat', 'bar', 'two-bar']).toContain(plugin.defaultTrigger);
      expect(typeof plugin.paramSchema).toBe('object');
      expect(typeof plugin.getDefaultParams).toBe('function');
      expect(typeof plugin.preload).toBe('function');
      expect(typeof plugin.render).toBe('function');
      const defaults = plugin.getDefaultParams() as Record<string, unknown>;
      const schemaKeys = Object.keys(plugin.paramSchema).sort();
      const defaultKeys = Object.keys(defaults).sort();
      expect(defaultKeys).toEqual(schemaKeys);
    }
  );

  it('all plugins can be rendered without throwing on a fresh context', () => {
    for (const plugin of listPlugins()) {
      const rc = makeRenderContext({
        isOnBeat: true,
        beatIndex: 1,
        beatPhase: 0
      });
      expect(() => plugin.render(rc, plugin.getDefaultParams())).not.toThrow();
    }
  });

  it('registers exactly 4 v0.1 plugins', () => {
    expect(listPlugins().length).toBe(4);
    expect(
      listPlugins()
        .map((p) => p.id)
        .sort()
    ).toEqual(['contour', 'particles', 'pulse', 'sweep'].sort());
  });
});
