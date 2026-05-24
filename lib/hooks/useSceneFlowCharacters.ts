'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiListCharacters } from '@/lib/sceneflow/api-client';
import type { CharacterRecord } from '@/lib/sceneflow/types';

export function useSceneFlowCharacters() {
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { characters } = await apiListCharacters();
      setCharacters(characters);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      /* errors surfaced by api-client toasts */
    });
  }, [refresh]);

  return { characters, loading, refresh };
}
