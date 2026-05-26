import type { Clip } from './types';
import type { ParamSchema } from '@/lib/renderer/types';
import { getPlugin } from '@/lib/renderer/registry';

/**
 * Plan 8d — schema resolver for clips. FX clips delegate to their
 * registered plugin's paramSchema (existing behavior). Audio clips
 * have a built-in synthetic schema covering just the volume slider
 * (the only automatable audio param today). Without this, the
 * AutomationLane preview + AutomationEditorModal both bailed early
 * for audio clips, leaving the user with no way to see or edit a
 * volume curve they could otherwise see in the Inspector as
 * "automated".
 *
 * Returns null when the clip kind has no schema (image clips, FX
 * clips without a registered plugin, etc.).
 */
export const AUDIO_PARAM_SCHEMA: ParamSchema = {
  volume: {
    kind: 'slider',
    label: 'Volume',
    min: 0,
    max: 1,
    step: 0.01,
    default: 1
  }
};

export const AUDIO_DEFAULT_PARAMS: Record<string, unknown> = { volume: 1 };

export function getClipParamSchema(clip: Clip): ParamSchema | null {
  if (clip.kind === 'audio') return AUDIO_PARAM_SCHEMA;
  if (clip.fxId) {
    const plugin = getPlugin(clip.fxId);
    return plugin ? plugin.paramSchema : null;
  }
  return null;
}

export function getClipDefaultParams(clip: Clip): Record<string, unknown> {
  if (clip.kind === 'audio') return AUDIO_DEFAULT_PARAMS;
  if (clip.fxId) {
    const plugin = getPlugin(clip.fxId);
    return plugin
      ? (plugin.getDefaultParams() as Record<string, unknown>)
      : {};
  }
  return {};
}
