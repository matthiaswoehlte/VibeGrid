'use client';
import { Button } from '@/components/ui/Button';
import { useAppStore } from '@/lib/store';
import { initialTimelineState } from '@/lib/store/timeline-slice';
import { initialMediaState } from '@/lib/store/media-slice';

export function ClearProjectButton() {
  const onClick = () => {
    if (!window.confirm('Clear the project? This removes all clips and media references.')) {
      return;
    }
    useAppStore.setState({
      timeline: { ...initialTimelineState },
      media: { ...initialMediaState },
      ui: { zoom: 1, selectedClipId: null }
    });
  };
  return (
    <Button variant="ghost" size="sm" onClick={onClick} title="Clear all clips + media">
      Clear
    </Button>
  );
}
