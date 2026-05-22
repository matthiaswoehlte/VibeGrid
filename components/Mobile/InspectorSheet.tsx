'use client';
import { useInspectorSheet } from '@/lib/hooks/useInspectorSheet';
import { Inspector } from '@/components/Workspace/Inspector';

/**
 * Plan 5.10 — Mobile bottom-sheet wrapper around the existing Inspector
 * component. Opens when the user taps a clip on Mobile; closes on
 * backdrop tap or when selectedClipId is cleared elsewhere. While a
 * drag is in progress the sheet stays closed (Anm 7 — tap-vs-drag
 * gate via useDndMonitor in useInspectorSheet).
 *
 * Reuses the existing Desktop Inspector — no parameter-form duplication.
 */
export function InspectorSheet() {
  const { isOpen, close } = useInspectorSheet();
  if (!isOpen) return null;
  return (
    <>
      {/* Backdrop — tap to close. */}
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={close}
        aria-label="Close inspector"
      />
      {/* Panel — h-[50vh], bottom-12 keeps the TabBar visible.
          A drag-handle ▔ at the top is visual affordance only;
          drag-to-dismiss is out of scope for v0.1. */}
      <div
        className="fixed left-0 right-0 bottom-12 z-50 h-[50vh] bg-[var(--surface-1)] border-t border-[var(--border)] overflow-y-auto md:hidden"
        role="region"
        aria-label="Clip inspector"
      >
        <div
          className="w-12 h-1 mx-auto my-2 rounded-full bg-[var(--text-muted)] opacity-50"
          aria-hidden
        />
        <Inspector />
      </div>
    </>
  );
}
