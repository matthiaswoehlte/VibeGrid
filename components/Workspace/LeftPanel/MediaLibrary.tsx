'use client';
import { useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { useMediaUpload } from '@/lib/hooks/useMediaUpload';
import { AutoPresetButton } from './AutoPresetButton';

export function MediaLibrary() {
  const refs = useAppStore((s) => s.media.mediaRefs);
  const { upload } = useMediaUpload();
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const handle = async (file: File, kind: 'image' | 'audio') => {
    try {
      await upload(file, kind);
      toast.success(`Uploaded ${file.name}`);
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => imageInput.current?.click()}
          className="flex-1 h-8 rounded border border-dashed border-[var(--border)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
        >
          + Image
        </button>
        <input
          ref={imageInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => e.target.files?.[0] && handle(e.target.files[0], 'image')}
        />
        <button
          type="button"
          onClick={() => audioInput.current?.click()}
          className="flex-1 h-8 rounded border border-dashed border-[var(--border)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
        >
          + Audio
        </button>
        <input
          ref={audioInput}
          type="file"
          accept="audio/mpeg,audio/wav,audio/mp4"
          hidden
          onChange={(e) => e.target.files?.[0] && handle(e.target.files[0], 'audio')}
        />
      </div>
      <ul className="space-y-1">
        {refs.map((r) => {
          // Only images go on the timeline (drag into image-track). Audio is
          // the project soundtrack — auto-loaded into the engine on upload, no
          // drag needed. We highlight the LAST-uploaded audio as the active
          // soundtrack since useAudioEngine auto-loads the most recent.
          const isImage = r.kind === 'image';
          const audioRefs = refs.filter((m) => m.kind === 'audio');
          const isActiveAudio = !isImage && r.id === audioRefs[audioRefs.length - 1]?.id;
          // Hint for non-image rows so the user understands what to do (or not).
          const audioTitle = isActiveAudio
            ? 'Active soundtrack — loaded into the audio engine. Press Play in the toolbar.'
            : 'Earlier soundtrack — re-upload to re-activate.';
          return (
            <li
              key={r.id}
              draggable={isImage}
              onDragStart={
                isImage
                  ? (e) => {
                      e.dataTransfer.setData('application/x-vibegrid-media-image', r.id);
                    }
                  : undefined
              }
              title={isImage ? r.filename : audioTitle}
              className={`flex items-center gap-2 p-2 rounded text-xs ${
                isImage
                  ? 'bg-[var(--surface-2)] cursor-grab active:cursor-grabbing'
                  : `cursor-default select-none ${
                      isActiveAudio
                        ? 'bg-[var(--surface-2)] border border-[var(--a1)]/40'
                        : 'bg-[var(--surface-1)] opacity-60'
                    }`
              }`}
            >
              <span className="flex-1 truncate">
                {r.filename}
                <span className="block text-[var(--text-muted)]">
                  {isImage && r.width && r.height ? `${r.width}×${r.height}` : null}
                  {!isImage && r.duration
                    ? `${r.duration.toFixed(1)}s — ${isActiveAudio ? 'active soundtrack' : 'soundtrack'}`
                    : null}
                  {!isImage && !r.duration
                    ? isActiveAudio
                      ? 'active soundtrack'
                      : 'soundtrack'
                    : null}
                </span>
              </span>
              {isImage && <AutoPresetButton mediaRef={r} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
