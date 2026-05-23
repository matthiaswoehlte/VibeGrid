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
});
