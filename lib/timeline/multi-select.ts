import type { Clip, Track } from './types';

/**
 * Plan 9b — pure functions for Timeline Multi-Select.
 *
 * No React, no DOM, no store. Tests cover these in isolation; the
 * timeline UI and store actions consume them.
 */

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Normalise so x1 ≤ x2 and y1 ≤ y2 — accepts a drag-direction-agnostic rect. */
export function normalizeRect(r: Rect): Rect {
  return {
    x1: Math.min(r.x1, r.x2),
    y1: Math.min(r.y1, r.y2),
    x2: Math.max(r.x1, r.x2),
    y2: Math.max(r.y1, r.y2)
  };
}

export interface TrackBand {
  trackId: string;
  /** Top edge in container-relative pixels. */
  top: number;
  /** Track-band height in pixels. */
  height: number;
}

/**
 * AABB-Hit-Test: returns the ids of every clip whose pixel-rect intersects
 * `rect`. Rect coordinates are container-relative (post-scroll-offset
 * application). `trackBands` describes each visible track's vertical
 * extent — the caller computes these from the DOM (no hard-coded
 * TRACK_HEIGHT constant per Architect D3).
 *
 * Architect-Decision L3: every clip-kind is hit-test eligible. Drop /
 * group-move callers filter via `canDropOnTrack` per-clip.
 */
export function clipsInRubberband(
  rect: Rect,
  clips: readonly Clip[],
  trackBands: readonly TrackBand[],
  pixelsPerBeat: number,
  scrollLeft: number
): string[] {
  const r = normalizeRect(rect);
  const bandById = new Map(trackBands.map((b) => [b.trackId, b]));
  const hits: string[] = [];
  for (const c of clips) {
    const band = bandById.get(c.trackId);
    if (!band) continue;
    const clipX1 = c.startBeat * pixelsPerBeat - scrollLeft;
    const clipX2 = (c.startBeat + c.lengthBeats) * pixelsPerBeat - scrollLeft;
    const trackY1 = band.top;
    const trackY2 = band.top + band.height;
    const xOverlap = clipX1 < r.x2 && clipX2 > r.x1;
    const yOverlap = trackY1 < r.y2 && trackY2 > r.y1;
    if (xOverlap && yOverlap) hits.push(c.id);
  }
  return hits;
}

/**
 * Ctrl+D Duplicate-Offset: "rightmost-edge minus leftmost-edge" of the
 * selected clips. So Duplicates begin exactly where the originals end —
 * no overlap with the source group. Architect-Decision D2.
 *
 * Returns 0 (no-op) for an empty selection.
 */
export function computeCtrlDOffset(
  selectedIds: readonly string[],
  clips: readonly Clip[]
): number {
  if (selectedIds.length === 0) return 0;
  const sel = new Set(selectedIds);
  let leftmost = Infinity;
  let rightmost = -Infinity;
  for (const c of clips) {
    if (!sel.has(c.id)) continue;
    leftmost = Math.min(leftmost, c.startBeat);
    rightmost = Math.max(rightmost, c.startBeat + c.lengthBeats);
  }
  if (!Number.isFinite(leftmost) || !Number.isFinite(rightmost)) return 0;
  return rightmost - leftmost;
}

/**
 * Filter selected clip ids to those whose new startBeat is still on a
 * compatible track for their kind (architect-decision L3). The current
 * model permits same-track overlaps (Plan 5.6 __blend) — this filter
 * only rejects when a clip would end up at startBeat < 0. Reused by
 * group-move preview and commit.
 */
export function filterMovableSelection(
  selectedIds: readonly string[],
  clips: readonly Clip[],
  deltaBeats: number
): { movable: string[]; blocked: string[] } {
  const sel = new Set(selectedIds);
  const movable: string[] = [];
  const blocked: string[] = [];
  for (const c of clips) {
    if (!sel.has(c.id)) continue;
    if (c.startBeat + deltaBeats < 0) {
      blocked.push(c.id);
    } else {
      movable.push(c.id);
    }
  }
  return { movable, blocked };
}

/** Indexes tracks by id for callers that need O(1) lookup during a drag tick. */
export function indexTracksById(tracks: readonly Track[]): Map<string, Track> {
  return new Map(tracks.map((t) => [t.id, t]));
}
