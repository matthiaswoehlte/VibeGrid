import { toast } from 'sonner';
import type { PresetPack } from './types';
import {
  addPresetClip,
  findOrCreateFxTrack,
  getBeatsPerBar,
  setAutomationCurve,
  toClipKind
} from './store-bridge';

/**
 * Plan 9a — apply a preset pack to the timeline.
 *
 * Append semantics: a second apply does NOT replace earlier clips — it
 * layers new ones. The find-or-create track logic keeps the lane count
 * stable across repeats: applying Hardstyle twice yields two clips per
 * FX-kind on the same set of tracks. The user can remove duplicates
 * manually; full Undo-History stays intact.
 *
 * Curve semantics: each pack defines automation points in **clip-relative**
 * beats (0 = clip onset). The renderer's Beat-Mode resolver reads
 * automation in **absolute** timeline beats, so we offset every point by
 * `clip.startBeat` here. Flow Mode is NOT auto-enabled; if the user
 * toggles it on later, the resolver re-stretches the curves over the
 * clip length — packs were not designed for that mode but won't crash.
 */
export function applyPackToTimeline(
  pack: PresetPack,
  startBeat = 0
): void {
  const beatsPerBar = getBeatsPerBar();
  const lengthBeats = pack.recommendedBars * beatsPerBar;
  const activeFx = pack.fx.filter((f) => f.enabled);

  for (const fxEntry of activeFx) {
    const trackId = findOrCreateFxTrack(fxEntry.fxKind);
    const clipKind = toClipKind(fxEntry.fxKind);

    const clipId = addPresetClip({
      trackId,
      startBeat,
      lengthBeats,
      kind: clipKind,
      // Defensive copy — without it, in-Inspector param edits would
      // mutate the BUILT_IN_PACKS source-of-truth via shared reference.
      params: { ...fxEntry.params },
      label: fxEntry.displayLabel
    });

    for (const [paramName, points] of Object.entries(fxEntry.automationCurves)) {
      const offsetPoints = points.map((p) => ({
        ...p,
        beat: p.beat + startBeat
      }));
      setAutomationCurve(clipId, paramName, offsetPoints);
    }
  }

  const disabledCount = pack.fx.length - activeFx.length;
  toast.success(
    `${activeFx.length} FX from "${pack.name}" added to timeline`,
    {
      description:
        disabledCount > 0
          ? `${disabledCount} FX disabled — toggle to include`
          : undefined
    }
  );
}
