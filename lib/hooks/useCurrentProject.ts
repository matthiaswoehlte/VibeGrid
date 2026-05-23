import { create } from 'zustand';

interface CurrentProjectState {
  projectId: string | null;
  projectName: string;
  setProject(id: string | null, name?: string): void;
  setProjectName(name: string): void;
}

/**
 * Plan 7 — current project metadata in a separate Zustand store.
 * Intentionally NOT inside useAppStore: project-id is session-local
 * and must not appear in the serialized snapshot itself (a saved
 * project should not embed its own id — that's a DB column).
 */
export const useCurrentProject = create<CurrentProjectState>((set) => ({
  projectId: null,
  projectName: 'Untitled Project',
  setProject: (id, name) =>
    set({ projectId: id, projectName: name ?? 'Untitled Project' }),
  setProjectName: (name) => set({ projectName: name })
}));
