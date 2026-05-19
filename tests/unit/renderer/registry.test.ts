import { describe, it, expect, beforeEach } from 'vitest';
import {
  register,
  getPlugin,
  listPlugins,
  listPluginsByKind,
  _resetRegistryForTests
} from '@/lib/renderer/registry';
import type { FxPlugin } from '@/lib/renderer/types';

function makeStubPlugin(id: string, kind: FxPlugin['kind']): FxPlugin {
  return {
    id,
    name: id,
    kind,
    defaultTrigger: 'beat',
    paramSchema: {},
    preloadState: 'ready',
    getDefaultParams: () => ({}),
    preload: async () => {},
    render: () => {}
  };
}

describe('plugin registry', () => {
  beforeEach(() => _resetRegistryForTests());

  it('registers a plugin and retrieves it by id', () => {
    const p = makeStubPlugin('pulse', 'Pulse');
    register(p);
    expect(getPlugin('pulse')).toBe(p);
  });

  it('returns undefined for unknown id', () => {
    expect(getPlugin('missing')).toBeUndefined();
  });

  it('lists all registered plugins in registration order', () => {
    register(makeStubPlugin('a', 'Pulse'));
    register(makeStubPlugin('b', 'Sweep'));
    expect(listPlugins().map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('listPluginsByKind filters by kind', () => {
    register(makeStubPlugin('p1', 'Pulse'));
    register(makeStubPlugin('p2', 'Pulse'));
    register(makeStubPlugin('s1', 'Sweep'));
    expect(listPluginsByKind('Pulse').map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(listPluginsByKind('Sweep').map((p) => p.id)).toEqual(['s1']);
    expect(listPluginsByKind('Contour')).toEqual([]);
  });

  it('throws when registering a duplicate id', () => {
    register(makeStubPlugin('dup', 'Pulse'));
    expect(() => register(makeStubPlugin('dup', 'Sweep'))).toThrow(/already registered/);
  });
});
