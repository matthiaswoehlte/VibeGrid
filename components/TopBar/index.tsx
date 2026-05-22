'use client';
import { Transport } from './Transport';
import { BPMBadge } from './BPMBadge';
import { ExportButton } from './ExportButton';
import { RecIndicator } from './RecIndicator';
import { ClearProjectButton } from './ClearProjectButton';
import { FlowModeToggle } from './FlowModeToggle';
import { useVideoExporter } from '@/lib/hooks/useVideoExporter';
import type { AudioEngine } from '@/lib/audio/engine';
import type { VideoEngine } from '@/lib/video/engine';

export function TopBar({
  engine,
  canvasRef,
  getImageBitmap,
  videoEngine
}: {
  engine: AudioEngine | null;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  getImageBitmap?: (mediaId: string) => ImageBitmap | undefined;
  /** Plan-5.9b — threaded through to renderOffline so each frame's
   *  video element settles on the right time before encoding. */
  videoEngine?: VideoEngine | null;
}) {
  const exporter = useVideoExporter({
    canvas: canvasRef.current,
    audioEngine: engine,
    getImageBitmap,
    videoEngine
  });
  return (
    <header className="h-12 px-2 md:px-3 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-1)]">
      <div className="flex items-center gap-2 md:gap-3">
        <Transport engine={engine} />
        <BPMBadge />
      </div>
      <div className="flex items-center gap-1 md:gap-2">
        {/* RecIndicator hides itself when status === 'idle'; on Mobile the
            timecode + progress bar may overflow the right cluster — left
            unchanged because export happens once per session, edge-case. */}
        <RecIndicator onCancel={() => exporter.cancel()} />
        <FlowModeToggle />
        {/* ClearProjectButton + Dev: Clear are dangerous actions. Keep
            them visible on Mobile too — the native window.confirm()
            dialog already protects against misclicks at any size. */}
        <ClearProjectButton />
        {process.env.NODE_ENV === 'development' && (
          <button
            type="button"
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            title="Dev only: clear localStorage and reload"
            className="hidden md:inline-flex h-7 px-2 items-center rounded text-[10px] uppercase tracking-wider bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] transition-colors border border-[var(--border)]"
          >
            Dev: Clear
          </button>
        )}
        <ExportButton onStart={() => exporter.start()} />
      </div>
    </header>
  );
}
