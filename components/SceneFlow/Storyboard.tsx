'use client';
import type { SceneRecord, CharacterRecord } from '@/lib/sceneflow/types';
import type { UpdateScenePatch } from '@/lib/sceneflow/scenes-db';

/**
 * Stub for Plan 8b Task 13 — full Storyboard + SceneCard + EndcardEditor
 * land in Task 16.
 */
export function Storyboard(_props: {
  scenes: SceneRecord[];
  characters: CharacterRecord[];
  onPatchField(sceneId: string, field: keyof UpdateScenePatch, value: unknown): void;
  onPatchFieldImmediate(sceneId: string, field: keyof UpdateScenePatch, value: unknown): Promise<void>;
  onDelete(sceneId: string): Promise<void> | void;
  onReorder(aId: string, bId: string): Promise<void> | void;
}) {
  return (
    <div className="text-sm text-[var(--text-dim)] py-8 text-center bg-[var(--surface-1)] rounded-lg border border-[var(--border)]">
      Storyboard stub — Task 16
    </div>
  );
}
