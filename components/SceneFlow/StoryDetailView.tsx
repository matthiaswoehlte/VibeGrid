'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { StorySetupForm } from './StorySetupForm';
import { StoryTextInput } from './StoryTextInput';
import { Storyboard } from './Storyboard';
import { GenerationControls } from './GenerationControls';
import { CreditDisplay } from './CreditDisplay';
import { useSceneFlowScenes } from '@/lib/hooks/useSceneFlowScenes';
import { useSceneFlowCharacters } from '@/lib/hooks/useSceneFlowCharacters';
import { apiListStories, apiStatusAll } from '@/lib/sceneflow/api-client';
import type { StoryRecord } from '@/lib/sceneflow/types';

const POLL_INTERVAL_MS = 4000;

export function StoryDetailView({
  storyId,
  onBack
}: {
  storyId: string;
  onBack(): void;
}) {
  const [story, setStory] = useState<StoryRecord | null>(null);
  const [storyLoading, setStoryLoading] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const {
    scenes,
    generating,
    generate,
    patchField,
    patchFieldImmediate,
    remove,
    reorder,
    applyStatusUpdates
  } = useSceneFlowScenes(storyId);
  const { characters: allChars } = useSceneFlowCharacters();
  const inFlightRef = useRef(false);

  // [Fix N2] Initial fetch on mount, then setInterval. The initial fetch
  // is important so a tab re-open shows the current state immediately
  // (no 4-s blindness while the first interval tick is pending).
  useEffect(() => {
    if (!storyId) return;
    let cancelled = false;

    async function tick() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const { scenes: updates, balance: bal } = await apiStatusAll(storyId);
        if (cancelled) return;
        if (updates.length > 0) applyStatusUpdates(updates);
        setBalance(bal);
      } catch {
        // swallow — next tick will retry
      } finally {
        inFlightRef.current = false;
      }
    }

    void tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [storyId, applyStatusUpdates]);

  useEffect(() => {
    setStoryLoading(true);
    apiListStories()
      .then((data) => {
        const found = data.stories.find((s) => s.id === storyId) ?? null;
        setStory(found);
      })
      .catch(() => toast.error('Story-Laden fehlgeschlagen'))
      .finally(() => setStoryLoading(false));
  }, [storyId]);

  if (storyLoading) {
    return <div className="text-xs text-[var(--text-dim)]">Story wird geladen ...</div>;
  }
  if (!story) {
    return (
      <div>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-[var(--a2)] hover:text-[var(--a1)] mb-3"
        >
          ← Zurück
        </button>
        <div className="text-sm text-[var(--text-dim)]">Story nicht gefunden.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-[var(--a2)] hover:text-[var(--a1)]"
        >
          ← Zurück zu Stories
        </button>
        <h2 className="text-sm font-bold text-[var(--text)] truncate flex-1 text-center">
          {story.title}
        </h2>
        <CreditDisplay balance={balance} />
      </div>
      <StorySetupForm
        story={story}
        onPatched={(patch) => setStory((s) => (s ? { ...s, ...patch } : s))}
      />
      <StoryTextInput
        story={story}
        characters={allChars.filter((c) => story.characters.includes(c.id))}
        scenesExist={scenes.length > 0}
        generating={generating}
        onGenerate={(text) => generate(text)}
        onStoryTextPatched={(text) =>
          setStory((s) => (s ? { ...s, story_text: text } : s))
        }
      />
      <Storyboard
        scenes={scenes}
        characters={allChars}
        onPatchField={patchField}
        onPatchFieldImmediate={patchFieldImmediate}
        onDelete={remove}
        onReorder={reorder}
      />
      {scenes.length > 0 && (
        <GenerationControls
          story={story}
          scenes={scenes}
          characters={allChars.filter((c) => story.characters.includes(c.id))}
        />
      )}
    </div>
  );
}
