'use client';
import { useState } from 'react';
import { CharacterManager } from './CharacterManager';
import { NewStoryButton } from './NewStoryButton';
import { StoryList } from './StoryList';
import { StoryDetailView } from './StoryDetailView';

/**
 * Plan 8a — SceneFlow shell. Renders inside the studio page when
 * appMode === 'sceneflow'. Holds the characters/stories toolbar and
 * the story list, plus per-story detail view (8b).
 */
export function SceneFlowShell() {
  const [charactersOpen, setCharactersOpen] = useState(false);
  // StoryList holds its own data via useSceneFlowStories. NewStoryButton
  // triggers a refresh in StoryList via the shared hook — hoist refetch
  // here so the button can drive it. `key` forces a remount so the
  // hook's useEffect-driven initial fetch re-runs.
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeStoryId, setActiveStoryId] = useState<string | null>(null);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
      <div className="max-w-5xl mx-auto p-6">
        {activeStoryId === null ? (
          <>
            <div className="flex items-center gap-3 mb-2">
              <button
                type="button"
                onClick={() => setCharactersOpen(true)}
                className="text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] px-3 py-1 rounded border border-[var(--border)]"
              >
                👤 Charaktere
              </button>
              <NewStoryButton onCreated={() => setRefreshKey((k) => k + 1)} />
            </div>
            <StoryList key={refreshKey} onSelect={setActiveStoryId} />
          </>
        ) : (
          <StoryDetailView
            storyId={activeStoryId}
            onBack={() => setActiveStoryId(null)}
          />
        )}
      </div>
      <CharacterManager
        open={charactersOpen}
        onClose={() => setCharactersOpen(false)}
      />
    </div>
  );
}
