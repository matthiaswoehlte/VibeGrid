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
          // drag needed. The label "soundtrack" makes that explicit.
          const isImage = r.kind === 'image';
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
              className={`flex items-center gap-2 p-2 rounded bg-[var(--surface-2)] text-xs ${
                isImage ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
            >
              <span className="flex-1 truncate" title={r.filename}>
                {r.filename}
                <span className="block text-[var(--text-muted)]">
                  {isImage && r.width && r.height ? `${r.width}×${r.height}` : null}
                  {r.kind === 'audio' && r.duration ? `${r.duration.toFixed(1)}s — soundtrack` : null}
                  {r.kind === 'audio' && !r.duration ? 'soundtrack' : null}
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
