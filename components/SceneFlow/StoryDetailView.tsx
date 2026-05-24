'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { StorySetupForm } from './StorySetupForm';
import { StoryTextInput } from './StoryTextInput';
import { Storyboard } from './Storyboard';
import { useSceneFlowScenes } from '@/lib/hooks/useSceneFlowScenes';
import { useSceneFlowCharacters } from '@/lib/hooks/useSceneFlowCharacters';
import { apiListStories } from '@/lib/sceneflow/api-client';
import type { StoryRecord } from '@/lib/sceneflow/types';

export function StoryDetailView({
  storyId,
  onBack
}: {
  storyId: string;
  onBack(): void;
}) {
  const [story, setStory] = useState<StoryRecord | null>(null);
  const [storyLoading, setStoryLoading] = useState(false);
  const {
    scenes,
    generating,
    generate,
    patchField,
    patchFieldImmediate,
    remove,
    reorder
  } = useSceneFlowScenes(storyId);
  const { characters: allChars } = useSceneFlowCharacters();

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
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-[var(--a2)] hover:text-[var(--a1)]"
        >
          ← Zurück zu Stories
        </button>
        <h2 className="text-sm font-bold text-[var(--text)] truncate">
          {story.title}
        </h2>
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
    </div>
  );
}
