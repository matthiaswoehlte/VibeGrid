import { describe, it, expect, beforeEach } from 'vitest';
import { textPlugin } from '@/lib/fx/text';
import { contourPlugin } from '@/lib/fx/contour';
import { pulsePlugin } from '@/lib/fx/pulse';
import { sweepPlugin } from '@/lib/fx/sweep';

// Plan 5.8b — verifies the `visibleWhen` schema field as deployed on
// the Text and Contour plugins. Other plugins (Pulse, Sweep, etc.)
// are exercised here as the "no visibleWhen — always visible" baseline.

describe('conditional-visibility — Plan 5.8b', () => {
  describe('schema-level — Text FX', () => {
    it('extrusionDepth hidden when enable3d=false', () => {
      const schema = textPlugin.paramSchema.extrusionDepth;
      expect(schema.visibleWhen).toBeTypeOf('function');
      expect(schema.visibleWhen?.({ enable3d: false })).toBe(false);
    });

    it('extrusionDepth visible when enable3d=true', () => {
      const schema = textPlugin.paramSchema.extrusionDepth;
      expect(schema.visibleWhen?.({ enable3d: true })).toBe(true);
    });

    it('blinkDecay hidden when blink=false; visible when blink=true', () => {
      const schema = textPlugin.paramSchema.blinkDecay;
      expect(schema.visibleWhen?.({ blink: false })).toBe(false);
      expect(schema.visibleWhen?.({ blink: true })).toBe(true);
    });

    it('all three extrusion* params share the same enable3d gate', () => {
      const direction = textPlugin.paramSchema.extrusionDirection;
      const depth = textPlugin.paramSchema.extrusionDepth;
      const style = textPlugin.paramSchema.extrusionStyle;
      // Reading visibleWhen from each — three callbacks, same predicate.
      const off = { enable3d: false };
      const on = { enable3d: true };
      expect(direction.visibleWhen?.(off)).toBe(false);
      expect(depth.visibleWhen?.(off)).toBe(false);
      expect(style.visibleWhen?.(off)).toBe(false);
      expect(direction.visibleWhen?.(on)).toBe(true);
      expect(depth.visibleWhen?.(on)).toBe(true);
      expect(style.visibleWhen?.(on)).toBe(true);
    });
  });

  describe('schema-level — Contour FX', () => {
    it('sweepSpeed hidden when sweepDirection="all"', () => {
      const schema = contourPlugin.paramSchema.sweepSpeed;
      expect(schema.visibleWhen).toBeTypeOf('function');
      expect(schema.visibleWhen?.({ sweepDirection: 'all' })).toBe(false);
    });

    it('sweepSpeed visible for any animated sweepDirection', () => {
      const schema = contourPlugin.paramSchema.sweepSpeed;
      expect(schema.visibleWhen?.({ sweepDirection: 'lr' })).toBe(true);
      expect(schema.visibleWhen?.({ sweepDirection: 'rl' })).toBe(true);
      expect(schema.visibleWhen?.({ sweepDirection: 'bl-tr' })).toBe(true);
    });
  });

  describe('schema-level — plugins without visibleWhen', () => {
    // Sweep and Pulse have NO conditional params — all sliders always
    // relevant. Confirming the absence prevents accidental future
    // additions from sneaking in unreviewed.
    let entries: Array<[string, unknown]>;

    beforeEach(() => {
      entries = [];
    });

    it('Sweep params expose no visibleWhen', () => {
      for (const [key, schema] of Object.entries(sweepPlugin.paramSchema)) {
        if ('visibleWhen' in schema && schema.visibleWhen !== undefined) {
          entries.push([key, schema.visibleWhen]);
        }
      }
      expect(entries).toEqual([]);
    });

    it('Pulse params expose no visibleWhen', () => {
      for (const [key, schema] of Object.entries(pulsePlugin.paramSchema)) {
        if ('visibleWhen' in schema && schema.visibleWhen !== undefined) {
          entries.push([key, schema.visibleWhen]);
        }
      }
      expect(entries).toEqual([]);
    });
  });
});
