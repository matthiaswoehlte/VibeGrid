'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiListStories } from '@/lib/sceneflow/api-client';
import type { StoryRecord } from '@/lib/sceneflow/types';

export function useSceneFlowStories() {
  const [stories, setStories] = useState<StoryRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { stories } = await apiListStories();
      setStories(stories);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  return { stories, loading, refresh };
}
