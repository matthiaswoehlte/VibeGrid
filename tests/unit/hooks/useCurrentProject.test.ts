import { describe, it, expect, beforeEach } from 'vitest';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';

const STORAGE_KEY = 'vibegrid:current-project';

beforeEach(() => {
  localStorage.clear();
  useCurrentProject.setState({
    projectId: null,
    projectName: 'Untitled Project'
  });
});

describe('useCurrentProject — persisted across HMR / reload', () => {
  it('default state is null id + "Untitled Project"', () => {
    expect(useCurrentProject.getState().projectId).toBeNull();
    expect(useCurrentProject.getState().projectName).toBe('Untitled Project');
  });

  it('writes projectName changes to localStorage under the namespaced key', async () => {
    useCurrentProject.getState().setProjectName('My Cool Project');
    // zustand/persist writes synchronously on state change
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      state: { projectName: string; projectId: string | null };
    };
    expect(parsed.state.projectName).toBe('My Cool Project');
  });

  it('writes projectId changes too (so save → reload keeps the link)', () => {
    useCurrentProject.getState().setProject('proj-123', 'Saved Project');
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as {
      state: { projectName: string; projectId: string | null };
    };
    expect(parsed.state.projectId).toBe('proj-123');
    expect(parsed.state.projectName).toBe('Saved Project');
  });

  it('does NOT persist action functions in the snapshot', () => {
    useCurrentProject.getState().setProjectName('Anything');
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect('setProject' in parsed.state).toBe(false);
    expect('setProjectName' in parsed.state).toBe(false);
  });
});
