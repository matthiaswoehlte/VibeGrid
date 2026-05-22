'use client';
import { useAppStore } from '@/lib/store';

/**
 * Plan 5.10 — Mobile replacement for the inline AutomationLane preview
 * (hidden on Mobile via `hidden md:block` because the lane is too small
 * for finger interaction at 56 px row height). Renders one tap-friendly
 * row below each track that contains at least one automation curve;
 * tap opens the full-screen AutomationEditorModal which is the actual
 * edit surface.
 *
 * `md:hidden` so it disappears on Desktop where the inline AutomationLane
 * preview takes over. `clipId` is the first clip on the track that has
 * automation — the editor modal targets that clip's curves.
 */
export function MobileAutomationButton({ clipId }: { clipId: string }) {
  const openEditor = useAppStore((s) => s.setAutomationEditorClipId);
  return (
    <button
      type="button"
      onClick={() => openEditor(clipId)}
      className="md:hidden w-full h-8 text-[10px] uppercase tracking-wider text-[var(--a2)] hover:text-[var(--a1)] bg-[var(--surface-2)] border-t border-b border-[var(--border)] flex items-center justify-center gap-1"
      aria-label="Open automation editor"
    >
      <span aria-hidden>⚡</span>
      <span>Open editor</span>
    </button>
  );
}
