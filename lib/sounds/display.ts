/**
 * Strip the noisy `VG_<CATEGORY> - ` prefixes from a SoundEntry's label
 * for display in the user-facing Sound Library list. The Evenant-source
 * filenames carry redundant category prefixes (the category is already
 * the accordion header above the row), and at the LeftPanel's width
 * the user can't tell two entries apart once everything starts with
 * "VG_DRUM LOOP - ".
 *
 * The FULL label survives in:
 *   - The drag-onto-timeline clip `label`.
 *   - The MediaRef `filename`.
 *   - The list-item `title` (tooltip on hover).
 *
 * Order matters in the prefix table: longer/more-specific entries
 * come first so e.g. `VG_WHOOSH - BACK STREET` strips via
 * `'VG_WHOOSH - '` rather than the broader `'VG_WHOOSH '` (which
 * would leave a leading dash).
 */
const VISUAL_PREFIXES: readonly string[] = [
  'VG_DRUM LOOP - ',
  'VG_MID PERC - ',
  'VG_MID PERC -',
  'VG_WHOOSH - ',
  'VG_WHOOSH ',
  'VG_CYMBAL - ',
  'VG_DOWNER - ',
  'VG_RISER - ',
  'VG_ATMOS - ',
  'VG_BOOM - ',
  'VG_AMB - ',
  'VG_HIT - ',
  'VG_SIG - '
];

export function soundDisplayLabel(label: string): string {
  for (const prefix of VISUAL_PREFIXES) {
    if (label.startsWith(prefix)) {
      const stripped = label.slice(prefix.length).trimStart();
      // Guard against producing an empty string (would render an
      // invisible row in the list). Fall through to the original.
      if (stripped.length > 0) return stripped;
    }
  }
  return label;
}

/** Test-only — exposes the prefix table so the regression test pins
 *  every entry the user explicitly requested. */
export const _VISUAL_PREFIXES_FOR_TESTS = VISUAL_PREFIXES;
