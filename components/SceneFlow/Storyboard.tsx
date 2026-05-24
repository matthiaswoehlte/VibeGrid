'use client';
import { SceneCard } from './SceneCard';
import type { SceneRecord, CharacterRecord } from '@/lib/sceneflow/types';
import type { UpdateScenePatch } from '@/lib/sceneflow/scenes-db';

export function Storyboard({
  scenes,
  characters,
  onPatchField,
  onPatchFieldImmediate,
  onDelete,
  onReorder
}: {
  scenes: SceneRecord[];
  characters: CharacterRecord[];
  onPatchField(sceneId: string, field: keyof UpdateScenePatch, value: unknown): void;
  onPatchFieldImmediate(
    sceneId: string,
    field: keyof UpdateScenePatch,
    value: unknown
  ): Promise<void>;
  onDelete(sceneId: string): Promise<void> | void;
  onReorder(aId: string, bId: string): Promise<void> | void;
}) {
  if (scenes.length === 0) {
    return (
      <div className="text-sm text-[var(--text-dim)] py-8 text-center bg-[var(--surface-1)] rounded-lg border border-[var(--border)]">
        Noch keine Szenen. Klicke <strong>Mit KI aufteilen</strong> sobald
        Story-Text + Charaktere stehen.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {scenes.map((s, i) => (
        <li key={s.id}>
          <SceneCard
            scene={s}
            characters={characters}
            canMoveUp={i > 0}
            canMoveDown={i < scenes.length - 1}
            onPatchField={onPatchField}
            onPatchFieldImmediate={onPatchFieldImmediate}
            onDelete={(id) => {
              Promise.resolve(onDelete(id)).catch(() => {});
            }}
            onMoveUp={() => {
              Promise.resolve(onReorder(s.id, scenes[i - 1]!.id)).catch(() => {});
            }}
            onMoveDown={() => {
              Promise.resolve(onReorder(s.id, scenes[i + 1]!.id)).catch(() => {});
            }}
          />
        </li>
      ))}
    </ul>
  );
}
