import type {
  CharacterRecord,
  StoryRecord,
  StoryFormat,
  SceneRecord
} from './types';
import type { UpdateCharacterPatch } from './characters-db';
import type { UpdateScenePatch } from './scenes-db';

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.assign('/login?expired=1');
    throw new Error('Session expired');
  }
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return res.json() as Promise<T>;
}

// Characters
export async function apiListCharacters(): Promise<{ characters: CharacterRecord[] }> {
  return json(await fetch('/api/sceneflow/characters'));
}
export async function apiCreateCharacter(input: {
  name: string;
  type: 'person' | 'group';
  referenceImageUrl: string | null;
  voiceProvider: 'azure' | 'elevenlabs' | null;
  voiceId: string | null;
  imagePrompt: string | null;
}): Promise<{ id: string }> {
  return json(
    await fetch('/api/sceneflow/characters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    })
  );
}
export async function apiPatchCharacter(
  id: string,
  patch: UpdateCharacterPatch
): Promise<{ ok: true }> {
  return json(
    await fetch('/api/sceneflow/characters/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch)
    })
  );
}
export async function apiDeleteCharacter(id: string): Promise<{ ok: true }> {
  return json(
    await fetch('/api/sceneflow/characters/' + encodeURIComponent(id), {
      method: 'DELETE'
    })
  );
}

// Stories
export async function apiListStories(): Promise<{ stories: StoryRecord[] }> {
  return json(await fetch('/api/sceneflow/stories'));
}
export async function apiCreateStory(input: {
  title: string;
  format: StoryFormat;
  visualStyle: string | null;
}): Promise<{ id: string }> {
  return json(
    await fetch('/api/sceneflow/stories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    })
  );
}
export async function apiDeleteStory(id: string): Promise<{ ok: true }> {
  return json(
    await fetch('/api/sceneflow/stories/' + encodeURIComponent(id), {
      method: 'DELETE'
    })
  );
}

export async function apiPatchStory(
  storyId: string,
  patch: {
    title?: string;
    format?: StoryFormat;
    visualStyle?: string | null;
    characters?: string[];
    storyText?: string | null;
  }
): Promise<{ ok: true }> {
  return json(
    await fetch('/api/sceneflow/stories/' + encodeURIComponent(storyId), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch)
    })
  );
}

// Scenes
export async function apiListScenes(
  storyId: string
): Promise<{ scenes: SceneRecord[] }> {
  return json(
    await fetch(
      `/api/sceneflow/stories/${encodeURIComponent(storyId)}/scenes`
    )
  );
}

export async function apiPatchScene(
  sceneId: string,
  patch: UpdateScenePatch,
  signal?: AbortSignal
): Promise<{ ok: true }> {
  return json(
    await fetch(`/api/sceneflow/scenes/${encodeURIComponent(sceneId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
      signal
    })
  );
}

export async function apiDeleteScene(sceneId: string): Promise<{ ok: true }> {
  return json(
    await fetch(`/api/sceneflow/scenes/${encodeURIComponent(sceneId)}`, {
      method: 'DELETE'
    })
  );
}

export async function apiReorderScenes(
  storyId: string,
  aId: string,
  bId: string
): Promise<{ ok: true }> {
  return json(
    await fetch(
      `/api/sceneflow/stories/${encodeURIComponent(storyId)}/scenes/reorder`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aId, bId })
      }
    )
  );
}

export async function apiGenerateScenes(
  storyId: string,
  storyText: string
): Promise<{ scenes: SceneRecord[] }> {
  return json(
    await fetch(
      `/api/sceneflow/stories/${encodeURIComponent(storyId)}/generate-scenes`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storyText })
      }
    )
  );
}
