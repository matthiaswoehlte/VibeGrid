# Test fixtures

These JSON files are **frozen snapshots** of persisted state shapes.
Any change to the store schema (adding/removing fields, changing the
`version` field, renaming kinds) MUST update both the fixture AND the
matching migration tests in the same commit. Don't regenerate a
fixture just because a migration broke — the fixture is the
authoritative record of what real v_N data looked like, and using
the post-migration shape to "fix" the fixture defeats the test.

## Files

- **`timeline-v5.json`** — v5 store shape (per Plan 5.9c Task 3). Used
  by `tests/unit/store/migration-v5-v6.test.ts`. Contains a mix of
  default and user-renamed FX tracks, a muted track, and three clips
  (image / contour / sweep) so the migration can be exercised end-
  to-end.
