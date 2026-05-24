'use client';

/**
 * Stub for Plan 8b Task 12 — full implementation lands in Task 13.
 * Keeps SceneFlowShell type-clean while the rest of the file map is
 * scaffolded.
 */
export function StoryDetailView({
  onBack
}: {
  storyId: string;
  onBack(): void;
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-[var(--a2)] hover:text-[var(--a1)]"
      >
        ← Zurück zu Stories
      </button>
      <div className="text-sm text-[var(--text-dim)]">
        Storyboard wird in Plan 8b Task 13 implementiert.
      </div>
    </div>
  );
}
