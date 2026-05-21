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
    <header className="h-12 px-3 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-1)]">
      <div className="flex items-center gap-3">
        <Transport engine={engine} />
        <BPMBadge />
      </div>
      <div className="flex items-center gap-2">
        <RecIndicator onCancel={() => exporter.cancel()} />
        <FlowModeToggle />
        <ClearProjectButton />
        <ExportButton onStart={() => exporter.start()} />
      </div>
    </header>
  );
}
