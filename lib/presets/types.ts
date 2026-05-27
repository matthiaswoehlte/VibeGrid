/**
 * Plan 9a — Preset-Pack types.
 *
 * A pack bundles N FX clips with their default params and embedded
 * automation curves. Applying a pack adds those clips (plus dedicated
 * `'fx'` tracks named after the FX kind) to the timeline at a chosen
 * `startBeat`, with curve points offset into the timeline-absolute
 * beat coordinate system used by Beat Mode.
 *
 * `fxKind` is stored as `PluginFxKind` (PascalCase, e.g. `'ZoomPunch'`)
 * — the apply layer converts to the kebab-case `clip.kind` the
 * renderer expects via `PLUGIN_KIND_TO_TRACK_KIND`.
 */
import type { AutomationPoint } from '@/lib/automation/types';
import type { PluginFxKind } from '@/lib/timeline/plugin-mapping';

export interface FxPresetEntry {
  fxKind: PluginFxKind;
  params: Record<string, unknown>;
  automationCurves: Record<string, AutomationPoint<number>[]>;
  /** Display-only label like '1/4' or '1/8'. v0.1 does not implement
   *  sub-beat triggering — the FX still fires per beat. The label
   *  exists for design fidelity with the prototype. Sub-beat trigger
   *  arrives in Plan 10+. */
  displayTriggerLabel: string;
  /** Short uppercase label rendered above the MiniCurve, e.g. 'ENV',
   *  'PULSE', 'PUNCH', 'BREATHE'. Pure visual sugar. */
  curveLabel: string;
  /** Full label shown in the FX-row, e.g. 'Camera-Shake · Beat-sync · 1/4'. */
  displayLabel: string;
  /** Default toggle state in the pack-detail view. Disabled entries
   *  are NOT applied to the timeline. */
  enabled: boolean;
}

export type PresetPackCategory = 'Drop' | 'Build-Up' | 'Verse' | 'Outro' | 'Any';

export interface PresetPack {
  id: string;
  name: string;
  description: string;
  category: PresetPackCategory;
  tags: string[];
  /** `'any'` for tempo-independent packs (e.g. outro). UI renders
   *  `formatBpmReference(ref)` for the badge. */
  bpmReference: number | 'any';
  /** Optional [min, max] BPM range. Pack-Card shows an orange BPM
   *  badge when project BPM is outside the range. */
  bpmRange?: [number, number];
  /** Length of the applied clip in bars (× beatsPerBar = lengthBeats). */
  recommendedBars: number;
  fx: FxPresetEntry[];
  isNew?: boolean;
  isCurated?: boolean;
  source: 'built-in' | 'user';
}
