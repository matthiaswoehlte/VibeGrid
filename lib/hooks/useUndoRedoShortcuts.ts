import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

/**
 * Plan 10 — global Ctrl/Cmd+Z (undo), Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z
 * (redo). No-op when the focus is in an input / textarea /
 * contenteditable so the native text-editing undo stack isn't shadowed.
 *
 * Mounted once at the Workspace level — duplicating it elsewhere would
 * fire undo twice per keypress.
 */
export function useUndoRedoShortcuts(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = key === 'y' || (key === 'z' && e.shiftKey);
      if (!isUndo && !isRedo) return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      e.preventDefault();
      const store = useAppStore.getState();
      if (isUndo) store.undo();
      else store.redo();
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
