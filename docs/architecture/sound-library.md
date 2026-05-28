# Sound Library Architecture

> Plan 8.7 — kuratierte SFX (Braams / Whoosh / Kick / Boom etc.) als
> eigene LeftPanel-Section. Manifest via BFF, Audio direkt von R2,
> Drag-to-Timeline auf reguläre `audio`-Tracks.

## Components

```
┌──────────────────┐    GET   ┌─────────────────────────────┐    fetch    ┌──────────┐
│ SoundLibrary.tsx │◄────────│ /api/sounds/manifest (BFF)  │◄───────────│ R2:      │
│ (4th LeftPanel   │          │ • reads R2_PUBLIC_URL       │             │ library/ │
│  tab)            │          │ • patches sound.url to abs  │             │ manifest │
└────────┬─────────┘          │ • returns SoundManifest     │             │ .json    │
         │                    └─────────────────────────────┘             └──────────┘
         │ reads
         ▼
┌──────────────────┐
│ sounds slice     │  ← SoundManifestLoader.tsx (studio bootstrap)
│ (Zustand)        │       loadSoundManifest() at mount,
│ • manifest       │       localStorage cache + version-invalidate
│ • isLoading      │
│ • error          │
└────────┬─────────┘
         │ [+] / drag-drop
         ▼
┌──────────────────────────────────┐
│ mediaActions.addMediaRef         │  ← recordingSet skip:true
│   { id: 'library-<soundId>',     │     (R2-bound, can't be undone)
│     source: 'library', ... }     │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ timelineActions.addClip          │  ← recordingSet (default record)
│   { kind: 'audio',               │     (this IS undoable)
│     trackId: <first audio lane>, │
│     mediaId: 'library-<id>' }    │
└──────────────────────────────────┘
```

## File map

| File | Role |
|---|---|
| `lib/sounds/types.ts` | `SoundEntry`, `SoundCategory`, `SoundManifest` types — shared client + server |
| `lib/sounds/manifest-loader.ts` | Client fetcher: `isClient()` guard + localStorage cache + version invalidation + graceful fallback |
| `lib/store/sounds-slice.ts` | Zustand slice (`manifest` / `isLoading` / `error` + 3 `{skip:true}` actions) |
| `app/api/sounds/manifest/route.ts` | BFF route (Node runtime, server-only env access) |
| `components/Workspace/LeftPanel/SoundLibrary.tsx` | Panel: search + accordion + add/drag |
| `components/Workspace/LeftPanel/SoundLibraryItem.tsx` | Single entry: preview (▶/■), [+] add, native HTML5 drag |
| `components/SoundManifestLoader.tsx` | Studio-mount side-effect that triggers the loader once |
| `components/Workspace/Inspector/MediaClipInspector.tsx` | Renders "Sound Library: …" + optional license line |
| `components/Workspace/Timeline/Tracks.tsx` | Drop handler for `application/x-vibegrid-sound` |
| `lib/storage/types.ts` | `MediaRef.source?: 'upload' \| 'library'` + `license?: string` |

## R2 layout

```
r2://<bucket>/
  library/
    manifest.json
    sfx/
      braams/braam-heavy-01.mp3
      whoosh/whoosh-fast-01.mp3
      kick/kick-punch-01.mp3
      boom/boom-deep-01.mp3
      ...
```

Categories in the manifest are 1:1 with R2 sub-directories — no virtual
groupings. Admin upload (Plan 8.7b) creates the directory + entry in
`manifest.json` + increments `manifest.version` so client caches
invalidate on next reload.

## Why a BFF instead of a direct R2 fetch from the client

`lib/storage/env.ts` is `'server-only'` (Plan 7 R2 hardening). The
`R2_PUBLIC_URL` is therefore NOT in the client bundle. The BFF reads
the env in the Node runtime, fetches the source manifest from R2,
rewrites every `sound.url` from a relative path (`sfx/braams/heavy.mp3`)
to an absolute URL the browser can consume, and returns the patched
manifest. Sound playback itself is direct client → R2 (no BFF in the
audio path).

## Caching

- **Server side**: `fetch(manifestUrl, { next: { revalidate: 3600 } })`
  — Next.js caches the upstream R2 response for 1 hour per build/edge
  cache entry.
- **Client side**: `localStorage['vg-sound-manifest-v1']` keyed by
  `manifest.version`. The loader always round-trips the BFF to detect
  version bumps, but skips the localStorage write when the cached
  version matches.
- **Cache invalidation**: bumping `manifest.version` server-side
  (admin flow, Plan 8.7b) forces clients to overwrite their local
  cache on the next reload.

## Performance note (deferred)

The version-check round-trip is mandatory — the client can't know
whether the manifest has changed without asking. For small manifests
(<100 sounds, <50 KB JSON) the cost is negligible. When the library
grows past ~20 KB, swap the BFF to ETag/`If-None-Match` semantics so
matching requests return `304 Not Modified` with no body. Intentionally
out of v0.1 scope.

## Undo / Redo

| Action | History entry |
|---|---|
| Sound Library manifest load | none — slice actions are `{ skip: true }` |
| Preview playback (▶) | none — no store mutation |
| `addMediaRef` for library sound | none — `{ skip: true }` (R2-bound) |
| `addClip` to timeline | one — default `record` via `recordingSet` |
| Drag-drop = `[+]` button | identical pair: skip + record |

Result: undoing right after a drop pops the clip off the timeline but
leaves the MediaRef in the store. Re-drop of the same sound is
idempotent (`getMediaRef` guard in the slice).

## CORS

`library/manifest.json` is fetched server-side (no CORS needed). The
actual audio files (`library/sfx/.../*.mp3`) are streamed direct from
R2 to the browser audio element — that path needs `Access-Control-
Allow-Origin: $APP_ORIGIN` (or `*`) for the `library/` prefix. R2's
existing CORS rule from Plan 5.9b (audio uploads) already covers the
bucket; if a future bucket split moves the library to a separate
prefix, re-verify with:

```bash
curl -I -H "Origin: $APP_ORIGIN" $R2_PUBLIC_URL/library/manifest.json
```

## Out of scope

- **Admin upload UI**: Plan 8.7b — adds a Sound Library section to
  `/admin` (Plan 8.6) for MP3 upload, manifest regeneration, category
  CRUD, license capture.
- **BPM-aware length snap**: a follow-up plan can compute clip
  `lengthBeats` so the sound ends on a beat boundary.
- **User-uploaded categories**: out of v0.1; the library is curator-
  driven only.
- **Pagination**: only relevant when the manifest grows past ~100
  sounds.
- **ETag / 304**: see performance note above.
