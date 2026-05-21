'use client';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { useMediaUpload } from '@/lib/hooks/useMediaUpload';
import { AutoPresetButton } from './AutoPresetButton';

function formatDurationSec(s: number): string {
  const total = Math.max(0, Math.round(s));
  const m = Math.floor(total / 60);
  const r = total % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function MediaLibrary() {
  const refs = useAppStore((s) => s.media.mediaRefs);
  const { upload, uploadVideo } = useMediaUpload();
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  /** Plan-5.9b — active video uploads keyed by a temporary id. */
  const [videoUploads, setVideoUploads] = useState<Record<string, number>>({});

  const handle = async (file: File, kind: 'image' | 'audio') => {
    try {
      await upload(file, kind);
      toast.success(`Uploaded ${file.name}`);
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  };

  const handleVideo = async (file: File) => {
    const tempId = crypto.randomUUID();
    setVideoUploads((p) => ({ ...p, [tempId]: 0 }));
    try {
      await uploadVideo(file, (progress) => {
        setVideoUploads((p) => ({ ...p, [tempId]: progress.percent }));
      });
      toast.success(`Uploaded ${file.name}`);
    } catch (err) {
      toast.error(`Video upload failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setVideoUploads((p) => {
        const next = { ...p };
        delete next[tempId];
        return next;
      });
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
        <button
          type="button"
          onClick={() => videoInput.current?.click()}
          className="flex-1 h-8 rounded border border-dashed border-[var(--border)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
        >
          + Video
        </button>
        <input
          ref={videoInput}
          type="file"
          accept="video/mp4,video/webm"
          hidden
          onChange={(e) => e.target.files?.[0] && handleVideo(e.target.files[0])}
        />
      </div>

      {/* Plan-5.9b — active video upload progress bars. */}
      {Object.entries(videoUploads).length > 0 && (
        <ul className="space-y-1">
          {Object.entries(videoUploads).map(([id, pct]) => (
            <li
              key={id}
              className="p-2 rounded bg-[var(--surface-2)] text-xs space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-dim)]">Video upload…</span>
                <span className="font-mono text-[var(--text)]">
                  {Math.round(pct)}%
                </span>
              </div>
              <div className="h-1 rounded bg-[var(--surface-3)] overflow-hidden">
                <div
                  className="h-full bg-[var(--a1)] transition-all"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <ul className="space-y-1">
        {refs.map((r) => {
          const isImage = r.kind === 'image';
          const isVideo = r.kind === 'video';
          const audioRefs = refs.filter((m) => m.kind === 'audio');
          const isActiveAudio =
            r.kind === 'audio' && r.id === audioRefs[audioRefs.length - 1]?.id;

          const audioTitle = isActiveAudio
            ? 'Active soundtrack — loaded into the audio engine. Press Play in the toolbar.'
            : 'Earlier soundtrack — re-upload to re-activate.';

          const dragKey = isImage
            ? 'application/x-vibegrid-media-image'
            : isVideo
              ? 'application/x-vibegrid-media-video'
              : null;
          const draggable = dragKey !== null;
          const onDragStart = dragKey
            ? (e: React.DragEvent<HTMLLIElement>) => {
                e.dataTransfer.setData(dragKey, r.id);
              }
            : undefined;

          return (
            <li
              key={r.id}
              draggable={draggable}
              onDragStart={onDragStart}
              title={
                isImage
                  ? r.filename
                  : isVideo
                    ? `${r.filename} — drag onto a Video track`
                    : audioTitle
              }
              className={`flex items-center gap-2 p-2 rounded text-xs ${
                draggable
                  ? 'bg-[var(--surface-2)] cursor-grab active:cursor-grabbing'
                  : `cursor-default select-none ${
                      isActiveAudio
                        ? 'bg-[var(--surface-2)] border border-[var(--a1)]/40'
                        : 'bg-[var(--surface-1)] opacity-60'
                    }`
              }`}
            >
              {isVideo && r.thumbnailUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={r.thumbnailUrl}
                  alt=""
                  className="shrink-0 w-12 h-7 rounded object-cover bg-black"
                />
              )}
              {isVideo && !r.thumbnailUrl && (
                <span className="shrink-0 w-12 h-7 rounded bg-black flex items-center justify-center text-[10px] text-[var(--text-dim)]">
                  ▶
                </span>
              )}
              <span className="flex-1 truncate">
                {r.filename}
                <span className="block text-[var(--text-muted)]">
                  {isImage && r.width && r.height ? `${r.width}×${r.height}` : null}
                  {isVideo && r.duration ? `▶ ${formatDurationSec(r.duration)}` : null}
                  {r.kind === 'audio' && r.duration
                    ? `${r.duration.toFixed(1)}s — ${
                        isActiveAudio ? 'active soundtrack' : 'soundtrack'
                      }`
                    : null}
                  {r.kind === 'audio' && !r.duration
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
