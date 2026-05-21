'use client';
import { Transport } from './Transport';
import { BPMBadge } from './BPMBadge';
import { ExportButton } from './ExportButton';
import { RecIndicator } from './RecIndicator';
import { ClearProjectButton } from './ClearProjectButton';
import { FlowModeToggle } from './FlowModeToggle';
import { useVideoExporter } from '@/lib/hooks/useVideoExporter';
import type { AudioEngine } from '@/lib/audio/engine';

export function TopBar({
  engine,
  canvasRef,
  getImageBitmap
}: {
  engine: AudioEngine | null;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  getImageBitmap?: (mediaId: string) => ImageBitmap | undefined;
}) {
  const exporter = useVideoExporter({
    canvas: canvasRef.current,
    audioEngine: engine,
    getImageBitmap
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
