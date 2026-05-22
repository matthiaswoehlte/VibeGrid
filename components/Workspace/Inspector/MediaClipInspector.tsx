'use client';
import { useAppStore } from '@/lib/store';
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
 */
export function MediaClipInspector({ clip }: { clip: Clip }) {
  const mediaRef = useAppStore((s) =>
    clip.mediaId ? s.media.mediaRefs.find((m) => m.id === clip.mediaId) : undefined
  );
  const headerLabel =
    mediaRef?.filename
    ?? (clip.kind === 'audio' ? 'Audio Clip' : 'Video Clip');
  const kindLabel = clip.kind === 'audio' ? 'Audio clip' : 'Video clip';

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
        {clip.kind === 'audio' && <VolumeSection clip={clip} />}
        {clip.kind === 'video' && <VideoAudioToggle clip={clip} />}
      </div>
    </div>
  );
}
