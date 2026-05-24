'use client';
import { useEffect, useRef, useState } from 'react';
import type { SceneRecord, Transition } from '@/lib/sceneflow/types';
import type { UpdateScenePatch } from '@/lib/sceneflow/scenes-db';

const DEBOUNCE_MS = 500;

export function EndcardEditor({
  scene,
  onPatchField,
  onPatchFieldImmediate
}: {
  scene: SceneRecord;
  onPatchField(sceneId: string, field: keyof UpdateScenePatch, value: unknown): void;
  onPatchFieldImmediate(
    sceneId: string,
    field: keyof UpdateScenePatch,
    value: unknown
  ): Promise<void>;
}) {
  const [cta, setCta] = useState(scene.tts_text ?? '');
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setCta(scene.tts_text ?? '');
  }, [scene.id, scene.tts_text]);

  function onCtaChange(v: string) {
    setCta(v);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(
      () => onPatchField(scene.id, 'tts_text', v || null),
      DEBOUNCE_MS
    );
  }

  return (
    <div className="space-y-2 p-3 bg-[var(--surface-3)] rounded">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        Endcard
      </div>
      <label className="block">
        <span className="text-xs text-[var(--text-dim)]">CTA-Text</span>
        <textarea
          value={cta}
          onChange={(e) => onCtaChange(e.target.value)}
          rows={2}
          placeholder="Folge mir für mehr Geschichten ..."
          className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-[var(--text-muted)]">Dauer</span>
          <input
            type="number"
            min={1}
            max={8}
            value={scene.duration}
            onChange={(e) =>
              onPatchFieldImmediate(
                scene.id,
                'duration',
                Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 5))
              )
            }
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-[var(--text-muted)]">Transition</span>
          <select
            value={scene.transition}
            onChange={(e) =>
              onPatchFieldImmediate(scene.id, 'transition', e.target.value as Transition)
            }
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          >
            <option value="last-frame">Last frame</option>
            <option value="crossfade">Crossfade</option>
            <option value="cut">Cut</option>
          </select>
        </label>
      </div>
    </div>
  );
}
