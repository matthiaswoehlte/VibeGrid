'use client';
import { toast } from 'sonner';
import { useSceneFlowStories } from '@/lib/hooks/useSceneFlowStories';
import { apiDeleteStory } from '@/lib/sceneflow/api-client';
import type { StoryRecord, StoryStatus } from '@/lib/sceneflow/types';

const STATUS_DOT: Record<StoryStatus, string> = {
  draft: 'bg-[var(--text-muted)]',
  generating: 'bg-orange-400',
  done: 'bg-green-400',
  error: 'bg-red-400'
};

export function StoryList({ onSelect }: { onSelect(storyId: string): void }) {
  const { stories, loading, refresh } = useSceneFlowStories();

  async function del(s: StoryRecord) {
    if (!confirm(`Story "${s.title}" wirklich löschen?`)) return;
    try {
      await apiDeleteStory(s.id);
    } catch (e) {
      toast.error('Löschen fehlgeschlagen: ' + (e as Error).message);
      return;
    }
    refresh().catch(() => {});
  }

  if (loading) return <div className="text-xs text-[var(--text-dim)]">Lädt...</div>;
  if (stories.length === 0) {
    return (
      <div className="text-sm text-[var(--text-dim)] mt-12 text-center">
        Noch keine Stories. Klicke <strong>+ Neue Story</strong> um zu beginnen.
      </div>
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mt-4">
      {stories.map((s) => (
        <li
          key={s.id}
          onClick={() => onSelect(s.id)}
          className="bg-[var(--surface-2)] rounded-lg p-3 flex flex-col gap-2 cursor-pointer hover:bg-[var(--surface-3)]"
        >
          <div className="flex items-center gap-2">
            <span className={'w-2 h-2 rounded-full ' + STATUS_DOT[s.status]} />
            <span className="text-sm text-[var(--text)] truncate flex-1">{s.title}</span>
            <span className="text-[10px] uppercase text-[var(--text-muted)]">
              {s.format}
            </span>
          </div>
          <div className="text-[10px] text-[var(--text-muted)] truncate">
            {s.visual_style ?? 'Kein Stil gesetzt'}
          </div>
          <div className="flex justify-between items-center pt-1">
            <span className="text-[10px] text-[var(--text-muted)]">
              {new Date(s.updated_at).toLocaleDateString()}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                del(s);
              }}
              title="Löschen"
              className="text-xs text-[var(--text-muted)] hover:text-red-400"
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
