'use client';
import { Button } from '@/components/ui/Button';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';
import { initialMediaState } from '@/lib/store/media-slice';
import { EXPORT_INITIAL_STATE } from '@/lib/export/state-machine';
import { useCurrentProject } from '@/lib/hooks/useCurrentProject';

export function NewProjectButton() {
  const onClick = () => {
    if (
      !window.confirm(
        'Neues Projekt? Aktuelle Clips und Medien werden verworfen. Ungespeicherte Änderungen gehen verloren.'
      )
    ) {
      return;
    }
    // Plan 7 — full reset that also detaches the current-project pointer,
    // so the next Save creates a brand-new VG_projects row instead of
    // overwriting the previous project. AutoSave is also gated on
    // projectId, so it stays quiet until the user explicitly saves.
    //
    // Plan 10 — skip:true because a destructive "New Project" wipe MUST
    // NOT be undoable (architect L3: project-boundary operations clear
    // the stack). clearHistory() then nukes any pre-reset history that
    // would otherwise dangle and let Ctrl+Z resurrect a wiped project.
    useAppStore.getState().recordingSet(
      'New Project',
      (s) => {
        s.timeline = { ...initialTimelineState };
        s.media = { ...initialMediaState };
        s.ui = {
          zoom: 1,
          selectedClipIds: [],
          selectedClipId: null,
          automationEditorClipId: null,
          automationSnap: 'off',
          clipSnap: '1',
          exportState: EXPORT_INITIAL_STATE,
          flowMode: false
        };
      },
      { skip: true }
    );
    useAppStore.getState().clearHistory();
    useCurrentProject.getState().setProject(null);
  };
  return (
    <Button variant="ghost" size="sm" onClick={onClick} title="Neues leeres Projekt anlegen">
      New
    </Button>
  );
}
