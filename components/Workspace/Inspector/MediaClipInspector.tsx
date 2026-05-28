'use client';
import { useAppStore } from '@/lib/store';
import { isAutomationCurve } from '@/lib/automation/resolve';
import { VolumeSection } from './VolumeSection';
import { VideoAudioToggle } from './VideoAudioToggle';
import type { Clip } from '@/lib/timeline/types';

/**
 * Plan 5.9d — Inspector view for media-bearing clips (audio + video).
 * FX clips continue to use the plugin-driven view in `index.tsx`.
 *
 * Header shows `mediaRef.filename` when a media binding exists,
 * falls back to a kind-specific label ("Audio Clip" / "Video Clip")
 * for slots that haven't been bound yet.
 *
 * Plan 8d — when any of the clip's params has been converted to an
 * AutomationCurve (e.g. the auto-duck volume curve laid down on the
 * sync-audio clip by the Transfer flow), the "Open editor" link
 * appears just like in the FX clip view. Without this, an automated
 * audio clip showed the "automated" badge but had no way to open
 * the full-screen AutomationEditorModal.
 */
export function MediaClipInspector({ clip }: { clip: Clip }) {
  const mediaRef = useAppStore((s) =>
    clip.mediaId ? s.media.mediaRefs.find((m) => m.id === clip.mediaId) : undefined
  );
  const openEditor = useAppStore((s) => s.setAutomationEditorClipId);
  const headerLabel =
    mediaRef?.filename
    ?? (clip.kind === 'audio' ? 'Audio Clip' : 'Video Clip');
  const kindLabel = clip.kind === 'audio' ? 'Audio clip' : 'Video clip';
  const hasAutomation = Object.values(clip.params ?? {}).some((v) =>
    isAutomationCurve(v)
  );

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between px-3 py-2 bg-[var(--surface-2)] border-b-2 border-[var(--a1)]">
        <div>
          <div className="text-base font-bold text-[var(--text)] truncate" title={headerLabel}>
            {headerLabel}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            {kindLabel}
          </div>
        </div>
      </header>
      <div className="px-3 space-y-2">
        {mediaRef?.source === 'library' && (
          <div className="text-xs text-[var(--text-dim)]">
            Sound Library: {mediaRef.filename}
            {mediaRef.license && (
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                © {mediaRef.license}
              </div>
            )}
          </div>
        )}
        {clip.kind === 'audio' && <VolumeSection clip={clip} />}
        {clip.kind === 'video' && <VideoAudioToggle clip={clip} />}
        {hasAutomation && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => openEditor(clip.id)}
              className="text-xs text-[var(--a2)] underline hover:text-[var(--a1)]"
            >
              Open editor
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
