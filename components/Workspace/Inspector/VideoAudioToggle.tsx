'use client';
import { useAppStore } from '@/lib/store';
import type { Clip } from '@/lib/timeline/types';

/**
 * Plan 5.9d — Toggle for the opt-in `audioEnabled` param on video
 * clips. Default OFF (matches the pre-5.9d hardcoded `muted: true`
 * in lib/video/engine.ts). Live preview reads this per tick in the
 * renderer's video-draw branch; offline export consumes it via the
 * mixAudioOffline videoAudioClips list.
 *
 * v0.1: boolean only — no per-beat automation, no per-clip volume.
 * (Documented in KNOWN_LIMITATIONS.)
 */
export function VideoAudioToggle({ clip }: { clip: Clip }) {
  const setClipParam = useAppStore((s) => s.timelineActions.setClipParam);
  const audioEnabled = (clip.params as { audioEnabled?: unknown } | undefined)?.audioEnabled === true;

  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-xs text-[var(--text-dim)]">Video-Audio</span>
      <input
        type="checkbox"
        checked={audioEnabled}
        onChange={(e) => setClipParam(clip.id, 'audioEnabled', e.target.checked)}
        aria-label="Toggle video audio"
        className="h-4 w-4 accent-[var(--a1)] cursor-pointer"
      />
    </label>
  );
}
