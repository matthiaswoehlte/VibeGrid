'use client';
import { useAppStore } from '@/lib/store';
import { activeImageClips } from '@/lib/timeline/selectors';
import { Button } from '@/components/ui/Button';

export function ExportButton({ onStart }: { onStart: () => void }) {
  const status = useAppStore((s) => s.ui.exportState.status);
  const mediaRefs = useAppStore((s) => s.media.mediaRefs);
  const timeline = useAppStore((s) => s.timeline);

  const hasAudio = mediaRefs.some((m) => m.kind === 'audio' && m.url);
  const hasImageAtZero = activeImageClips(timeline, 0).length > 0;
  const busy = status !== 'idle';
  const disabled = busy || !hasAudio || !hasImageAtZero;

  let title = 'Export the project as WebM';
  if (!hasAudio) title = 'Upload an audio file first';
  else if (!hasImageAtZero) title = 'Place an image clip starting at beat 0';
  else if (busy) title = 'Export in progress';

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={disabled}
      onClick={onStart}
      title={title}
    >
      Export
    </Button>
  );
}
