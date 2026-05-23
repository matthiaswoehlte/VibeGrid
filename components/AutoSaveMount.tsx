'use client';
import { useAutoSave } from '@/lib/hooks/useAutoSave';

/**
 * Plan 7 — mount-only side-effect component. Lives inside the Studio
 * layout so the auto-save subscription is active for the entire
 * studio session, but renders nothing.
 */
export function AutoSaveMount(): null {
  useAutoSave();
  return null;
}
