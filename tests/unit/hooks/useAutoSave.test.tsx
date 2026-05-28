import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

const { patchMock } = vi.hoisted(() => ({
  patchMock: vi.fn().mockResolvedValue({ ok: true })
}));
vi.mock('@/lib/project/api-client', () => ({
  apiPatchProject: patchMock
}));

import { useAppStore } from '@/lib/store';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';
import { useAutoSave } from '@/lib/hooks/useAutoSave';

function Harness({ debounceMs }: { debounceMs?: number }) {
  useAutoSave({ debounceMs });
  return null;
}

beforeEach(() => {
  patchMock.mockReset().mockResolvedValue({ ok: true });
  useCurrentProject.setState({ projectId: null, projectName: 'X' });
});

describe('useAutoSave', () => {
  it('does not fire when projectId is null', async () => {
    render(<Harness debounceMs={20} />);
    act(() => {
      useAppStore.setState((s) => ({ ui: { ...s.ui, zoom: 2 } }));
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('fires once after debounce when projectId is set', async () => {
    useCurrentProject.setState({ projectId: 'p-1', projectName: 'X' });
    render(<Harness debounceMs={20} />);
    act(() => {
      useAppStore.setState((s) => ({ ui: { ...s.ui, zoom: 2 } }));
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock.mock.calls[0]![0]).toBe('p-1');
  });

  it('coalesces rapid changes into a single save', async () => {
    useCurrentProject.setState({ projectId: 'p-1', projectName: 'X' });
    render(<Harness debounceMs={20} />);
    act(() => {
      useAppStore.setState((s) => ({ ui: { ...s.ui, zoom: 2 } }));
      useAppStore.setState((s) => ({ ui: { ...s.ui, zoom: 3 } }));
      useAppStore.setState((s) => ({ ui: { ...s.ui, zoom: 4 } }));
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(patchMock).toHaveBeenCalledTimes(1);
  });

  // --- Regression: project-switch race (Mai 2026 bug — leere Projekte in DB) ---
  // The callsites that load / reset state (ProjectListDrawer.load,
  // NewProjectButton.onClick) historically called `applySerializedProject` /
  // `recordingSet` BEFORE `useCurrentProject.setProject(...)`. That made the
  // `useAppStore.subscribe` callback see the OLD projectId paired with the
  // NEW state. The autosave then fired against the OLD project — silently
  // wiping or corrupting it.
  //
  // The fix is to re-read both projectId AND state at fire-time, so the PATCH
  // always reflects the user's *current* selection, not the snapshot at the
  // moment the state change happened.

  it('after a project switch (state change THEN setProject), PATCH targets the NEW project, not the old one', async () => {
    useCurrentProject.setState({ projectId: 'A', projectName: 'A' });
    render(<Harness debounceMs={20} />);
    act(() => {
      // ProjectListDrawer.load order: state first, project switch after.
      useAppStore.setState((s) => ({
        timeline: { ...s.timeline, zoom: 1.5 } // surrogate for "loaded B's state"
      }));
      useCurrentProject.setState({ projectId: 'B', projectName: 'B' });
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock.mock.calls[0]![0]).toBe('B');
  });

  it('after "New Project" (state reset THEN setProject(null)), no PATCH leaks to the old project', async () => {
    useCurrentProject.setState({ projectId: 'A', projectName: 'A' });
    render(<Harness debounceMs={20} />);
    act(() => {
      // NewProjectButton order: state reset first, setProject(null) after.
      useAppStore.setState((s) => ({
        timeline: { ...s.timeline, zoom: 1 } // surrogate for "initialTimelineState"
      }));
      useCurrentProject.setState({ projectId: null, projectName: 'Untitled' });
    });
    await new Promise((r) => setTimeout(r, 60));
    // Without the fix: the timer captured projectId='A' at fire time and
    // would PATCH 'A' with the empty initial state. With the fix: re-read
    // at fire-time sees projectId=null and skips.
    expect(patchMock).not.toHaveBeenCalled();
  });
});
