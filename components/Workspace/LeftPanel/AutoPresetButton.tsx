'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { fetchAutoPreset } from '@/lib/storage/auto-preset-adapter';
import { getPlugin } from '@/lib/renderer/registry';
import type { MediaRef } from '@/lib/storage/types';

export function AutoPresetButton({ mediaRef }: { mediaRef: MediaRef }) {
  const selectedClipId = useAppStore((s) => s.ui.selectedClipId);
  const clip = useAppStore((s) =>
    selectedClipId ? s.timeline.clips.find((c) => c.id === selectedClipId) : undefined
  );
  const setClipParam = useAppStore((s) => s.timelineActions.setClipParam);
  const [loading, setLoading] = useState(false);

  const fxId = clip?.fxId;
  const plugin = fxId ? getPlugin(fxId) : undefined;
  const disabled = !plugin || loading;

  const onClick = async () => {
    if (!plugin || !clip) return;
    setLoading(true);
    const tId = toast.loading('Analysing image…');
    try {
      const params = await fetchAutoPreset({
        imageUrl: mediaRef.url,
        fxId: plugin.id,
        paramSchema: plugin.paramSchema
      });
      for (const [k, v] of Object.entries(params)) {
        setClipParam(clip.id, k, v);
      }
      toast.success('✨ Preset applied', { id: tId });
    } catch (err) {
      toast.error(`Auto-preset failed: ${err instanceof Error ? err.message : 'unknown'}`, { id: tId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        !plugin
          ? 'Select an FX clip in the timeline first'
          : `Auto-preset for ${plugin.name}`
      }
      className="h-6 px-1.5 rounded bg-[var(--a1)] text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {loading ? '…' : '✨'}
    </button>
  );
}
