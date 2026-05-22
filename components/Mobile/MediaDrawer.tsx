'use client';
import { useIsMobile } from '@/lib/utils/breakpoints';
import { useAppStore } from '@/lib/store';
import { MediaLibrary } from '@/components/Workspace/LeftPanel/MediaLibrary';

/**
 * Plan 5.10 — Mobile slide-up drawer that wraps the existing
 * MediaLibrary content when the mobileTab is 'media'.
 *
 * KNOWN LIMITATION: MediaLibrary uses native HTML5 `draggable=` +
 * `dataTransfer` for drag-to-timeline, which is broken on iOS Safari
 * and inconsistent on Chrome Mobile. Drag-add will work on Desktop
 * (where this drawer doesn't render anyway — `md:hidden`) and on
 * Android Chrome, but iOS users must use the file-picker buttons to
 * add media. Tap-to-add-at-playhead for Mobile media is a follow-up.
 * See docs/KNOWN_LIMITATIONS.md.
 */
export function MediaDrawer() {
  const isMobile = useIsMobile();
  const active = useAppStore((s) => s.mobileUI.mobileTab);
  const setTab = useAppStore((s) => s.mobileUIActions.setMobileTab);

  if (!isMobile || active !== 'media') return null;

  return (
    <>
      {/* Backdrop — tap to close (switch back to Timeline tab). */}
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={() => setTab('timeline')}
        aria-label="Close media drawer"
      />
      {/* Panel — bottom-12 leaves room for the Tab-Bar. z-50 = Z_DRAWER_PANEL. */}
      <div
        className="fixed left-0 right-0 bottom-12 z-50 h-[60vh] bg-[var(--surface-1)] border-t border-[var(--border)] overflow-y-auto p-3 md:hidden"
        role="region"
        aria-label="Media library"
      >
        <MediaLibrary />
      </div>
    </>
  );
}
