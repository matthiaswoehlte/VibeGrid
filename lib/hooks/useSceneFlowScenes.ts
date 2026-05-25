'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apiListScenes,
  apiPatchScene,
  apiDeleteScene,
  apiReorderScenes,
  apiGenerateScenes
} from '@/lib/sceneflow/api-client';
import type { SceneRecord } from '@/lib/sceneflow/types';
import type { UpdateScenePatch } from '@/lib/sceneflow/scenes-db';

const DEBOUNCE_MS = 500;

/**
 * Hook for scene CRUD on a given story.
 *
 * Provides debounced + AbortController-protected PATCH per (sceneId, field)
 * so a stale response can never overwrite a newer local edit (Last-Write-
 * Wins). Pass `storyId = null` to leave the hook idle (returns []).
 */
export function useSceneFlowScenes(storyId: string | null) {
  const [scenes, setScenes] = useState<SceneRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const aborts = useRef(new Map<string, AbortController>());
  const debounceTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const refresh = useCallback(async () => {
    if (!storyId) {
      setScenes([]);
      return;
    }
    setLoading(true);
    try {
      const { scenes } = await apiListScenes(storyId);
      setScenes(scenes);
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const patchField = useCallback(
    (sceneId: string, field: keyof UpdateScenePatch, value: unknown) => {
      const key = `${sceneId}:${String(field)}`;
      setScenes((cur) =>
        cur.map((s) => (s.id === sceneId ? { ...s, [field]: value } : s))
      );
      const existing = debounceTimers.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        aborts.current.get(key)?.abort();
        const ctl = new AbortController();
        aborts.current.set(key, ctl);
        apiPatchScene(
          sceneId,
          { [field]: value } as UpdateScenePatch,
          ctl.signal
        ).catch((e: unknown) => {
          if (e instanceof Error && e.name === 'AbortError') return;
          // eslint-disable-next-line no-console
          console.error('[sceneflow] patch failed', e);
        });
      }, DEBOUNCE_MS);
      debounceTimers.current.set(key, timer);
    },
    []
  );

  const patchFieldImmediate = useCallback(
    async (sceneId: string, field: keyof UpdateScenePatch, value: unknown) => {
      const key = `${sceneId}:${String(field)}`;
      aborts.current.get(key)?.abort();
      const ctl = new AbortController();
      aborts.current.set(key, ctl);
      setScenes((cur) =>
        cur.map((s) => (s.id === sceneId ? { ...s, [field]: value } : s))
      );
      try {
        await apiPatchScene(
          sceneId,
          { [field]: value } as UpdateScenePatch,
          ctl.signal
        );
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        throw e;
      }
    },
    []
  );

  const remove = useCallback(
    async (sceneId: string) => {
      await apiDeleteScene(sceneId);
      await refresh();
    },
    [refresh]
  );

  const reorder = useCallback(
    async (aId: string, bId: string) => {
      if (!storyId) return;
      await apiReorderScenes(storyId, aId, bId);
      await refresh();
    },
    [storyId, refresh]
  );

  const generate = useCallback(
    async (storyText: string) => {
      if (!storyId) return;
      setGenerating(true);
      try {
        const { scenes } = await apiGenerateScenes(storyId, storyText);
        setScenes(scenes);
      } finally {
        setGenerating(false);
      }
    },
    [storyId]
  );

  /**
   * Plan 8c — merge status-poll results into the local scene list.
   * Used by the Storyboard's polling effect (status-all batch endpoint).
   */
  const applyStatusUpdates = useCallback(
    (
      updates: Array<{
        sceneId: string;
        status: SceneRecord['status'];
        imageUrl: string | null;
        audioUrl: string | null;
        neutralVideoUrl: string | null;
        videoUrl: string | null;
      }>
    ) => {
      if (updates.length === 0) return;
      const byId = new Map(updates.map((u) => [u.sceneId, u]));
      setScenes((cur) =>
        cur.map((s) => {
          const u = byId.get(s.id);
          if (!u) return s;
          return {
            ...s,
            status: u.status,
            image_url: u.imageUrl,
            audio_url: u.audioUrl,
            neutral_video_url: u.neutralVideoUrl,
            video_url: u.videoUrl
          };
        })
      );
    },
    []
  );

  useEffect(() => {
    const abortMap = aborts.current;
    const timerMap = debounceTimers.current;
    return () => {
      abortMap.forEach((c) => c.abort());
      timerMap.forEach((t) => clearTimeout(t));
      abortMap.clear();
      timerMap.clear();
    };
  }, []);

  return {
    scenes,
    loading,
    generating,
    refresh,
    patchField,
    patchFieldImmediate,
    remove,
    reorder,
    generate,
    applyStatusUpdates
  };
}
