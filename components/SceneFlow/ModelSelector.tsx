'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiPatchStory } from '@/lib/sceneflow/api-client';
import type { StoryRecord } from '@/lib/sceneflow/types';

export const IMAGE_MODELS = [
  { id: 'fal-ai/flux/dev', label: 'Flux - Dev' }
] as const;

export const VIDEO_MODELS = [
  {
    id: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    label: 'Kling 2.5 Turbo'
  }
] as const;

export const LIPSYNC_MODELS = [
  { id: 'fal-ai/sync-lipsync/v3', label: 'Sync LipSync v3' },
  { id: 'fal-ai/musetalk', label: 'MuseTalk' }
] as const;

const DEFAULTS = {
  image: IMAGE_MODELS[0].id,
  video: VIDEO_MODELS[0].id,
  lipsync: LIPSYNC_MODELS[0].id
};

function resolveModelId(
  id: string | null | undefined,
  models: ReadonlyArray<{ id: string; label: string }>,
  fallback: string
): string {
  if (id === null || id === undefined) return fallback;
  // Tolerant of unknown model IDs — the dropdown still shows the default,
  // and a separate badge surfaces the actual stored value (so the user
  // sees what fal.ai will be called with even after a deprecation).
  return models.find((m) => m.id === id) ? id : fallback;
}

export function ModelSelector({
  story,
  onPatched
}: {
  story: StoryRecord;
  onPatched(patch: Partial<StoryRecord>): void;
}) {
  const [open, setOpen] = useState(false);

  const imageId = resolveModelId(story.image_model, IMAGE_MODELS, DEFAULTS.image);
  const videoId = resolveModelId(story.video_model, VIDEO_MODELS, DEFAULTS.video);
  const lipsyncId = resolveModelId(
    story.lipsync_model,
    LIPSYNC_MODELS,
    DEFAULTS.lipsync
  );
  const imageUnknown = imageId !== story.image_model;
  const videoUnknown = videoId !== story.video_model;
  const lipsyncUnknown = lipsyncId !== story.lipsync_model;

  async function patch(field: 'imageModel' | 'videoModel' | 'lipsyncModel', value: string) {
    try {
      await apiPatchStory(story.id, { [field]: value });
      const colMap: Record<typeof field, keyof StoryRecord> = {
        imageModel: 'image_model',
        videoModel: 'video_model',
        lipsyncModel: 'lipsync_model'
      };
      onPatched({ [colMap[field]]: value } as Partial<StoryRecord>);
    } catch {
      toast.error('Modell-Speichern fehlgeschlagen');
    }
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="border border-[var(--border)] rounded-lg bg-[var(--surface-1)]"
    >
      <summary className="cursor-pointer text-xs text-[var(--text-dim)] px-3 py-2 select-none">
        ▼ Modelle
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2">
        <ModelRow
          label="Bildgenerierung"
          value={imageId}
          unknown={imageUnknown}
          unknownValue={story.image_model}
          options={IMAGE_MODELS}
          onChange={(v) => patch('imageModel', v)}
        />
        <ModelRow
          label="Videogenerierung"
          value={videoId}
          unknown={videoUnknown}
          unknownValue={story.video_model}
          options={VIDEO_MODELS}
          onChange={(v) => patch('videoModel', v)}
        />
        <ModelRow
          label="LipSync"
          value={lipsyncId}
          unknown={lipsyncUnknown}
          unknownValue={story.lipsync_model}
          options={LIPSYNC_MODELS}
          onChange={(v) => patch('lipsyncModel', v)}
        />
      </div>
    </details>
  );
}

function ModelRow({
  label,
  value,
  unknown,
  unknownValue,
  options,
  onChange
}: {
  label: string;
  value: string;
  unknown: boolean;
  unknownValue: string | null;
  options: ReadonlyArray<{ id: string; label: string }>;
  onChange(v: string): void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {unknown && unknownValue !== null && (
        <span className="block text-[10px] text-amber-300 mt-1">
          Gespeichertes Modell „{unknownValue}" nicht mehr verfügbar — Default
          wird genutzt.
        </span>
      )}
    </label>
  );
}
