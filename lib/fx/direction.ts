/**
 * Plan 5.8a — shared direction primitives for Text / Dissolve / Sunray.
 *
 * Nine compass-ish directions. `'center'` is special — it has no edge
 * origin, returns the canvas centre point, and an angle of 0 (callers
 * either fan rays radially or skip the direction-dependent math).
 */

export type FXDirection =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

/**
 * Anchor point for the given direction on a w×h canvas.
 *
 * - Edges return the midpoint of the edge (`'top'` → `(w/2, 0)`).
 * - Corners return the corner exactly (`'top-left'` → `(0, 0)`).
 * - `'center'` returns the canvas centre.
 */
export function directionToOrigin(
  dir: FXDirection,
  w: number,
  h: number
): { x: number; y: number } {
  switch (dir) {
    case 'top':
      return { x: w / 2, y: 0 };
    case 'bottom':
      return { x: w / 2, y: h };
    case 'left':
      return { x: 0, y: h / 2 };
    case 'right':
      return { x: w, y: h / 2 };
    case 'top-left':
      return { x: 0, y: 0 };
    case 'top-right':
      return { x: w, y: 0 };
    case 'bottom-left':
      return { x: 0, y: h };
    case 'bottom-right':
      return { x: w, y: h };
    case 'center':
      return { x: w / 2, y: h / 2 };
  }
}

/**
 * Outward angle from the origin (radians, canvas convention where +y is down).
 *
 * - `'top'` faces down into the canvas → +π/2? No — we treat the
 *   direction as the source side, so a ray "from top" travels DOWN.
 *   In canvas coords +y = down → angle for 'top' is +π/2.
 * - `'right'` → ray travels LEFT → angle = π.
 * - `'center'` → no preferred direction, returns 0 (callers handle).
 */
export function directionToAngle(dir: FXDirection): number {
  switch (dir) {
    case 'top':
      return Math.PI / 2; // downward
    case 'bottom':
      return -Math.PI / 2; // upward
    case 'left':
      return 0; // rightward
    case 'right':
      return Math.PI; // leftward
    case 'top-left':
      return Math.PI / 4; // down-right
    case 'top-right':
      return (3 * Math.PI) / 4; // down-left
    case 'bottom-left':
      return -Math.PI / 4; // up-right
    case 'bottom-right':
      return (-3 * Math.PI) / 4; // up-left
    case 'center':
      return 0;
  }
}

/**
 * Inspector-ready option list. Stable order: edges → corners → center.
 * Plan 5.8a Task 7 wires this into the FXDirection-select control.
 */
export const FX_DIRECTION_OPTIONS: ReadonlyArray<{
  value: FXDirection;
  label: string;
}> = [
  { value: 'top', label: '↓ Oben' },
  { value: 'bottom', label: '↑ Unten' },
  { value: 'left', label: '→ Links' },
  { value: 'right', label: '← Rechts' },
  { value: 'top-left', label: '↘ Oben-Links' },
  { value: 'top-right', label: '↙ Oben-Rechts' },
  { value: 'bottom-left', label: '↗ Unten-Links' },
  { value: 'bottom-right', label: '↖ Unten-Rechts' },
  { value: 'center', label: '⊙ Mitte' }
];
