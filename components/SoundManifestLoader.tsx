'use client';
import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { loadSoundManifest } from '@/lib/sounds/manifest-loader';

/**
 * Plan 8.7 — kicks off a one-time Sound Library manifest fetch when the
 * studio root mounts. Sister of `AutoSaveMount` — invisible component,
 * side-effect only.
 *
 * StrictMode would normally fire `useEffect` twice in development; the
 * loader's localStorage layer is idempotent and the BFF route is
 * cacheable, so the duplicate call is harmless. Production renders the
 * effect once.
 */
export function SoundManifestLoader(): null {
  const setManifest = useAppStore((s) => s.soundsActions.setManifest);
  const setLoading = useAppStore((s) => s.soundsActions.setLoading);
  const setError = useAppStore((s) => s.soundsActions.setError);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSoundManifest()
      .then((manifest) => {
        if (cancelled) return;
        if (manifest) setManifest(manifest);
        else setError('Sound Library unavailable');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [setManifest, setLoading, setError]);

  return null;
}
