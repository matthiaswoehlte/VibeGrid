'use client';
import type { StoryRecord, CharacterRecord } from '@/lib/sceneflow/types';

/**
 * Stub for Plan 8b Task 13 — full @-validation + "Mit KI aufteilen"
 * pipeline lands in Task 14.
 */
export function StoryTextInput(_props: {
  story: StoryRecord;
  characters: CharacterRecord[];
  scenesExist: boolean;
  generating: boolean;
  onGenerate(text: string): void | Promise<void>;
  onStoryTextPatched(text: string | null): void;
}) {
  return (
    <section className="bg-[var(--surface-1)] rounded-lg p-4 border border-[var(--border)] text-xs text-[var(--text-dim)]">
      StoryTextInput stub — Task 14
    </section>
  );
}
