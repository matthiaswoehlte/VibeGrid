import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface CurrentProjectState {
  projectId: string | null;
  projectName: string;
  setProject(id: string | null, name?: string): void;
  setProjectName(name: string): void;
}

/**
 * Plan 7 — current project metadata in a separate Zustand store.
 * Intentionally NOT inside useAppStore: project-id is session-local
 * and must not appear in the serialized project SNAPSHOT itself
 * (a saved project should not embed its own id — that's a DB column).
 *
 * Persisted to localStorage so the title the user typed in the TopBar
 * survives HMR (Next.js dev re-evaluates modules and the bare
 * `create()` call resets state to "Untitled Project") and full page
 * reloads. The persist key is namespaced so other zustand stores in
 * the project don't collide.
 */
export const useCurrentProject = create<CurrentProjectState>()(
  persist(
    (set) => ({
      projectId: null,
      projectName: 'Untitled Project',
      setProject: (id, name) =>
        set({ projectId: id, projectName: name ?? 'Untitled Project' }),
      setProjectName: (name) => set({ projectName: name })
    }),
    {
      name: 'vibegrid:current-project',
      storage: createJSONStorage(() => localStorage),
      // Only persist the two data fields — actions are recreated on
      // every store init and shouldn't be serialized.
      partialize: (s) => ({
        projectId: s.projectId,
        projectName: s.projectName
      })
    }
  )
);
