import {
  TRACK_FX_KINDS,
  TRACK_KIND_TO_PLUGIN_KIND,
  type TrackFxKind,
  type PluginFxKind
} from '@/lib/timeline/plugin-mapping';
import { useAppStore } from '@/lib/store';
import { getAutomationCurves } from './store-bridge';
import type { FxPresetEntry, PresetPack, PresetPackCategory } from './types';

const FX_KIND_SET = new Set<string>(TRACK_FX_KINDS);

const USER_PRESETS_KEY = 'vg_user_presets';

/** Snapshot the current timeline FX clips into a user-pack shape.
 *  Only clips on FX tracks (kind in `TRACK_FX_KINDS`) are captured.
 *  Each clip's params are defensively copied; automation curves are
 *  extracted via the store-bridge. Saved packs are tagged
 *  `source: 'user'` to distinguish them from BUILT_IN_PACKS. */
export function captureTimelineAsPreset(
  projectBpm: number,
  name: string,
  category: PresetPackCategory
): PresetPack {
  const clips = useAppStore.getState().timeline.clips;
  const fxClips = clips.filter((c) => FX_KIND_SET.has(c.kind));

  const fx: FxPresetEntry[] = fxClips.map((clip) => {
    const fxKind =
      (TRACK_KIND_TO_PLUGIN_KIND[clip.kind as TrackFxKind] as PluginFxKind) ??
      (clip.kind as PluginFxKind);
    return {
      fxKind,
      params: { ...(clip.params ?? {}) },
      automationCurves: getAutomationCurves(clip.id),
      displayTriggerLabel: '1/4',
      curveLabel: 'ENV',
      displayLabel: fxKind,
      enabled: true
    };
  });

  const idSuffix =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `user-${idSuffix}`,
    name,
    description: '',
    category,
    tags: [],
    bpmReference: projectBpm,
    recommendedBars: 4,
    fx,
    source: 'user'
  };
}

/** Persist a user-pack into localStorage. Survives page reload until
 *  the v0.2 Supabase migration moves it server-side. */
export function saveUserPreset(pack: PresetPack): void {
  if (typeof localStorage === 'undefined') return;
  const existing = getUserPresets();
  localStorage.setItem(
    USER_PRESETS_KEY,
    JSON.stringify([...existing, pack])
  );
}

/** Read user-packs from localStorage. Returns `[]` on missing key or
 *  parse failure — never throws. */
export function getUserPresets(): PresetPack[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(USER_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PresetPack[]) : [];
  } catch {
    return [];
  }
}

/** Remove a user-pack by id. No-op if id not found. */
export function removeUserPreset(id: string): void {
  if (typeof localStorage === 'undefined') return;
  const remaining = getUserPresets().filter((p) => p.id !== id);
  localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(remaining));
}
