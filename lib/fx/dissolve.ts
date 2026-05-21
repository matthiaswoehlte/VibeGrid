import type { FxPlugin, RenderContext } from '@/lib/renderer/types';
import {
  FX_DIRECTION_OPTIONS,
  directionToOrigin,
  type FXDirection
} from './direction';

type DissolveMode = 'beat-wipe' | 'directional-blur' | 'reveal-wipe';

interface DissolveParams {
  dissolveMode: DissolveMode;
  direction: FXDirection;
  intensity: number;
  softness: number;
  decay: number;
}

// Pure black veil — visibly darker than the renderer's #0c0d12 background
// so the effect is recognisable even without an image clip underneath. The
// architect-suggested --bg colour was indistinguishable from the canvas
// clear when there was nothing to veil.
const VEIL_RGB = '0, 0, 0';
const BLUR_LAYERS = 5;

// Diagnostic — logs ONCE per (clipId × mode) pair to prove Dissolve.render
// is reached at all and what params it sees. If you toggle to a clip and
// see nothing here, the renderer never invokes the plugin (clip kind /
// fxId / track mute / something upstream). If you see the log but the
// stage stays unchanged, the bug is inside this plugin.
const loggedDissolve = new Set<string>();

/**
 * Plan 5.8a Task 5 — directional dissolve overlay. Source-over, NEVER
 * destination-out (the Plan-6 opaque background would expose `#0c0d12`
 * rather than transparency).
 *
 * Three modes:
 * - 'beat-wipe' — veil flashes on the beat from the chosen direction,
 *   decays with beatPhase (analog Pulse / ZoomPulse / Sunray).
 * - 'directional-blur' — permanent multi-layer veil, no beat trigger.
 *   Creates a directional-vignette feel.
 * - 'reveal-wipe' — one-shot reveal over the clip length. t=0 fully
 *   veiled, t=1 fully revealed. Uses RC.clipStartSec / clipDurationSec.
 *
 * Veil colour is the page background (--bg = #0c0d12) so the dissolve
 * blends seamlessly with the renderer's opaque clear. softness clamped
 * to [0.01, 0.99] to avoid degenerate gradients.
 */
export const dissolvePlugin: FxPlugin<DissolveParams> = {
  id: 'dissolve',
  name: 'Dissolve',
  kind: 'Dissolve',
  defaultTrigger: 'beat',
  preloadState: 'ready',
  paramSchema: {
    dissolveMode: {
      kind: 'select',
      options: [
        { value: 'reveal-wipe', label: 'Reveal Wipe (one-shot)' },
        { value: 'beat-wipe', label: 'Beat Wipe' },
        { value: 'directional-blur', label: 'Directional Blur' }
      ],
      // reveal-wipe is the most obviously-visible default — runs once
      // across the entire clip length so users see SOMETHING happen
      // the moment they drop the clip onto the timeline.
      default: 'reveal-wipe',
      label: 'Mode'
    },
    direction: {
      kind: 'select',
      options: [...FX_DIRECTION_OPTIONS],
      default: 'left',
      label: 'Direction'
    },
    intensity: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 1,
      label: 'Intensity'
    },
    softness: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      label: 'Softness'
    },
    decay: {
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.6,
      label: 'Decay'
    }
  },
  getDefaultParams: (): DissolveParams => ({
    dissolveMode: 'reveal-wipe',
    direction: 'left',
    intensity: 1,
    softness: 0.5,
    decay: 0.6
  }),
  async preload() {},
  render(rc: RenderContext, params: DissolveParams): void {
    const traceKey = `${rc.clipId}:${params.dissolveMode}`;
    if (!loggedDissolve.has(traceKey)) {
      loggedDissolve.add(traceKey);
      const t =
        rc.clipDurationSec > 0
          ? Math.max(0, Math.min(1, (rc.time - rc.clipStartSec) / rc.clipDurationSec))
          : 1;
      // eslint-disable-next-line no-console
      console.log(
        `[dissolve] render clipId=${rc.clipId} mode=${params.dissolveMode} ` +
          `intensity=${params.intensity} direction=${params.direction} ` +
          `time=${rc.time.toFixed(2)}s clipStart=${rc.clipStartSec.toFixed(2)}s ` +
          `clipDur=${rc.clipDurationSec.toFixed(2)}s t=${t.toFixed(2)}`
      );
    }

    const origin = directionToOrigin(params.direction, rc.width, rc.height);
    const end = { x: rc.width - origin.x, y: rc.height - origin.y };
    // If origin == end (center direction), bail — there's nothing to wipe.
    if (origin.x === end.x && origin.y === end.y) return;

    const clampedSoftness = Math.max(0.01, Math.min(0.99, params.softness));

    const overlayGradient = (alpha: number): void => {
      if (alpha <= 0) return;
      rc.ctx.save();
      const grad = rc.ctx.createLinearGradient(origin.x, origin.y, end.x, end.y);
      grad.addColorStop(0, `rgba(${VEIL_RGB}, ${alpha})`);
      grad.addColorStop(clampedSoftness, `rgba(${VEIL_RGB}, 0)`);
      rc.ctx.fillStyle = grad;
      rc.ctx.fillRect(0, 0, rc.width, rc.height);
      rc.ctx.restore();
    };

    switch (params.dissolveMode) {
      case 'beat-wipe': {
        // Beat-triggered fade. Flow mode skips entirely (no beat pulse).
        if (rc.flowMode) return;
        const sweepAlpha =
          Math.max(0, 1 - rc.beatPhase * (1 + params.decay * 3)) *
          params.intensity;
        overlayGradient(sweepAlpha);
        return;
      }
      case 'directional-blur': {
        // Continuous, no beat trigger. Five gradient layers stacked at
        // diminishing alpha — fakes a directional vignette / blur falloff.
        for (let i = 0; i < BLUR_LAYERS; i++) {
          const alpha = params.intensity * ((BLUR_LAYERS - i) / BLUR_LAYERS) * 0.18;
          overlayGradient(alpha);
        }
        return;
      }
      case 'reveal-wipe': {
        // One-shot reveal: t=0 fully veiled → t=1 nothing left.
        const t =
          rc.clipDurationSec > 0
            ? Math.max(0, Math.min(1, (rc.time - rc.clipStartSec) / rc.clipDurationSec))
            : 1;
        const coverAlpha = params.intensity * (1 - t);
        overlayGradient(coverAlpha);
        return;
      }
    }
  }
};
