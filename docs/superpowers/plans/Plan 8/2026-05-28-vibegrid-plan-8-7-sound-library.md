# VibeGrid — Plan 8.7: Sound Library (Rev. 2 — Final)

**Kuratierte Soundeffekte (Braams, Whoosh, Kick, Boom etc.) als
eigene Section in der LeftPanel-Sidebar, Manifest via BFF-Route geladen,
Audio-Files direkt aus Cloudflare R2, per Drag-to-Timeline auf
Audio-Tracks nutzbar.**

✅ **Architekt-freigegeben** (2026-05-28). Bereit für CC #1 Implementation.

Baseline: HEAD post-Plan-10 (Test-Zahl in Schritt 0 bestätigen).
Abhängigkeit für 8.7b: Plan 8.6 (Admin-UI) — ✅ bereits live.

> Rev. 2-Final — alle 11 Architekt-Entscheidungen aus
> `2026-05-28-vibegrid-architekt-entscheidung-8-7.md` eingearbeitet.
> Plus: server-only-Konflikt bei B5 via BFF-Route gelöst.
> Architekt-Freigabe-Edits: `MediaRef.license` im Snippet ergänzt,
> Caveat zu Option (a) bestätigt, Performance-Hinweis (ETag/304) als
> spätere Iteration dokumentiert.

---

## Naming (Architekt B12)

Eine Begriffswelt: **Sound Library**.

| Kontext | Begriff |
|---|---|
| R2-Verzeichnis | `library/` |
| MediaRef.source-Value | `'library'` |
| UI-Section-Label | **Sound Library** |
| React-Komponente | `SoundLibrary.tsx` |
| Architektur-Dok | `sound-library.md` |
| Inspector-Label | `"Sound Library: {sound.label}"` |
| BFF-Route | `/api/sounds/manifest` |

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `components/Workspace/LeftPanel/index.tsx` + Geschwister:
   `FxLibrary.tsx`, `MediaLibrary.tsx`, `LayersList.tsx`, `AutoPresetButton.tsx`.
   `SoundLibrary.tsx` wird ein weiterer Geschwister analog zu diesen — **kein**
   neuer Tab-Mechanismus. CC #1 schaut wie die existierenden Geschwister
   in `index.tsx` arrangiert sind (Stacked? Tabs? Accordion?) und reiht
   sich konsistent ein.

2. `components/Workspace/Timeline/SyncAudioDropZone.tsx` — die exakte
   Vorlage für `addMediaRef` + `addClip`-Pattern. Wichtig:
   - `addMediaRef({ id, kind: 'audio', url, filename, uploadedAt })`
   - Clip-Shape: `{ id, trackId, kind: 'audio', mediaId, startBeat, lengthBeats }`
   - Plan 8.7 wiederholt **nicht** den Upload-Pfad — Library-Sounds sind
     bereits in R2, nur addMediaRef + addClip nötig.

3. `lib/storage/types.ts` — `MediaRef`-Shape. Plan 8.7 ergänzt **ein
   optionales Feld** `source?: 'upload' | 'library'`. Default = `'upload'`
   (back-compat, bestehende Refs bleiben gültig).

4. `lib/storage/env.ts` — **Achtung: `import 'server-only';`** in Zeile 1.
   `R2_PUBLIC_URL` ist nur in API-Routes / Server-Components verfügbar,
   **NICHT** im Client-Bundle. Das ist der Grund warum Plan 8.7 eine
   BFF-Route `/api/sounds/manifest` baut (siehe Architektur-Section).

5. `lib/store/media-slice.ts` — Plan-10-Regel bestätigen: **alle
   media-actions** sind `recordingSet(..., { skip: true })`. `addMediaRef`
   für Library-Sound folgt diesem Pattern. Nur das nachgelagerte `addClip`
   ist Undo-bar.

6. `components/Workspace/LeftPanel/MediaLibrary.tsx` — Drag-Source-Pattern.
   Wie wird ein Item draggable gemacht? `onPointerDown` (CLAUDE.md Regel 3)
   oder dnd-kit `useDraggable`? Pattern übernehmen.

7. `components/Workspace/Timeline/Tracks.tsx` — Drop-Target-Pattern für
   Audio-Tracks (`kind === 'audio'`). Wie wird ein Drag-Drop in einen
   `addClip`-Call aufgelöst?

8. Audio-Decode-Pfad identifizieren: Grep nach `decodeAudioData` und
   `useAudioEngine`/`apply-sync-audio.ts`. Welcher Helper macht
   URL → `AudioBuffer`? Plan 8.7 nutzt **denselben** Pfad wie User-Uploads
   — keine eigene Decode-Pipeline.

9. `components/Workspace/Inspector/MediaClipInspector.tsx` — wo wird der
   Source-Label gerendert? Stelle für `"Sound Library: {label}"`-Anzeige
   identifizieren.

10. CORS-Smoke (vor jeglichem Code):
    ```bash
    curl -I -H "Origin: $APP_ORIGIN" \
      "$R2_PUBLIC_URL/library/manifest.json"
    # Erwartet: Access-Control-Allow-Origin: $APP_ORIGIN (oder *)
    ```
    Falls fehlt: CORS-Konfiguration auf `library/`-Prefix erweitern, **vor**
    irgendwelchem Coding. Memory-Pattern aus `r2_setup_gotchas.md`.

11. Aktuelle Test-Zahl notieren:
    `npm test -- --run 2>&1 | grep -E "Tests|passed" | tail -3`

---

## Architektur

### R2-Struktur

```
r2://vibegrid-eu/
  library/
    manifest.json                 ← einmalig beim App-Start geladen via BFF
    sfx/
      braams/
        braam-heavy-01.mp3
        braam-cinematic-02.mp3
        braam-rise-03.mp3
      whoosh/
        whoosh-fast-01.mp3
        whoosh-soft-02.mp3
      kick/
        kick-punch-01.mp3
        kick-sub-02.mp3
      boom/
        boom-deep-01.mp3
        boom-reverb-02.mp3
      riser/
        riser-tension-01.mp3
      impact/
        impact-hit-01.mp3
```

Architekt-B13: Manifest-Kategorien spiegeln 1:1 die R2-Verzeichnisse.
Keine kombinierten Mockup-Kategorien.

### BFF-Route — warum nicht direkt R2 vom Client

`lib/storage/env.ts:1` ist `'server-only'`. `R2_PUBLIC_URL` darf nicht
in das Client-Bundle leaken (Vercel würde es nicht ausliefern, plus
generelle Architektur-Sauberkeit). Lösung: **BFF-Route**, die im
Server-Kontext liest und die kompletten absoluten URLs in den Manifest-
Eintrag patcht.

```
Client (SoundLibrary.tsx)
       │ GET
       ▼
/api/sounds/manifest (Next.js Route)
       │ liest R2_PUBLIC_URL aus lib/storage/env.ts
       │ fetch ${R2_PUBLIC_URL}/library/manifest.json
       │ patcht jeden sound.url zu absoluter URL
       ▼
Client erhält Manifest mit absoluten URLs
       │
       ▼
SoundLibrary rendert Liste
       │
       ▼
addMediaRef({ url: <absolut> }) + addClip
       │
       ▼
AudioEngine fetcht die absolute URL direkt von R2
```

Audio-Files (MP3-Streams) gehen vom Client direkt zu R2 — Browser-CORS
muss für GET auf `library/`-Prefix offen sein. Schritt-0-Item 10 prüft das.

---

## Manifest-Format

```ts
// lib/sounds/types.ts (NEU)

export interface SoundEntry {
  id: string;              // 'braam-heavy-01'
  label: string;           // 'Heavy Braam'
  /** Relativer Pfad innerhalb library/. BFF patcht zu absoluter URL
   *  bevor Manifest an Client geht. Im Client gesehen: absolute URL. */
  url: string;             // server-side: 'sfx/braams/braam-heavy-01.mp3'
                           // client-side: 'https://.../library/sfx/braams/braam-heavy-01.mp3'
  duration: number;        // Sekunden — für Clip lengthBeats
  bpm?: number;            // optional
  tags?: string[];         // ['dark', 'cinematic']
  license?: string;        // Architekt-W14: optional, im Inspector angezeigt
}

export interface SoundCategory {
  id: string;              // 'braams'  (1:1 R2-Verzeichnis)
  label: string;           // 'Braams'
  icon?: string;           // Emoji
  sounds: SoundEntry[];
}

export interface SoundManifest {
  version: number;         // Cache-Invalidierungs-Key (Architekt-B6)
  updatedAt: string;       // ISO-Timestamp
  categories: SoundCategory[];
}
```

---

## BFF-Route: `app/api/sounds/manifest/route.ts` (NEU)

```ts
import { NextResponse } from 'next/server';
import { getR2Config } from '@/lib/storage/env';
import type { SoundManifest } from '@/lib/sounds/types';

export const runtime = 'nodejs';
// Edge runtime kann lib/storage/env.ts nicht laden (server-only + Node-API).

export async function GET() {
  try {
    const { publicUrl } = getR2Config();
    const raw = await fetch(`${publicUrl}/library/manifest.json`, {
      // Server-side cache: 1h. Client-side cache via localStorage + version.
      next: { revalidate: 3600 }
    });
    if (!raw.ok) {
      return NextResponse.json(
        { error: `manifest fetch failed: ${raw.status}` },
        { status: 502 }
      );
    }
    const manifest = (await raw.json()) as SoundManifest;

    // Pfade zu absoluten URLs patchen
    const base = `${publicUrl}/library/`;
    const patched: SoundManifest = {
      ...manifest,
      categories: manifest.categories.map((cat) => ({
        ...cat,
        sounds: cat.sounds.map((s) => ({ ...s, url: `${base}${s.url}` }))
      }))
    };
    return NextResponse.json(patched);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
}
```

Server-side `revalidate: 3600` cached die R2-manifest.json für 1h
zwischen Request-Bursts. Client cached weiter via localStorage +
`manifest.version`.

---

## Manifest-Loader: `lib/sounds/manifest-loader.ts` (NEU)

Architekt-B6 — `isClient()`-Guard + `localStorage` + version-Invalidierung.

```ts
import { isClient } from '@/lib/utils/is-client';
import type { SoundManifest } from './types';

const CACHE_KEY = 'vg-sound-manifest-v1';

interface CachedShape {
  version: number;
  data: SoundManifest;
}

export async function loadSoundManifest(): Promise<SoundManifest | null> {
  if (!isClient()) return null;

  // Cache lesen (best-effort, broken-JSON → ignore)
  let cached: CachedShape | null = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) cached = JSON.parse(raw) as CachedShape;
  } catch {
    /* corrupted entry → behandeln wie Cache-Miss */
  }

  // BFF fetch — immer, Version-Invalidierung erst beim Vergleich
  let fresh: SoundManifest;
  try {
    const res = await fetch('/api/sounds/manifest');
    if (!res.ok) {
      // Bei Fetch-Fehler: cached zurückgeben falls vorhanden, sonst null
      return cached?.data ?? null;
    }
    fresh = (await res.json()) as SoundManifest;
  } catch {
    return cached?.data ?? null;
  }

  // Wenn Version unverändert: cached ist gültig — fresh war ein Round-Trip
  // mit demselben Inhalt. Wir nutzen fresh (frische URLs falls R2 rotiert
  // hat) aber überschreiben nur wenn Version sich änderte oder kein Cache.
  if (!cached || cached.version !== fresh.version) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ version: fresh.version, data: fresh } satisfies CachedShape)
      );
    } catch {
      /* QuotaExceeded → still serve, just don't cache */
    }
  }

  return fresh;
}
```

**Was sich gegenüber Rev. 1 ändert:**
- `sessionStorage` → `localStorage` (Cross-Session-Cache)
- TTL gestrichen — `manifest.version` ist die Invalidierung
- `isClient()`-Guard für SSR/Capacitor-Safety
- BFF-Route statt direktem R2-Fetch
- Graceful degradation bei Fetch-Fail: cached zurückgeben

---

## Komponente: `components/Workspace/LeftPanel/SoundLibrary.tsx` (NEU)

Geschwister zu `FxLibrary.tsx` und `MediaLibrary.tsx`. CC #1 schaut deren
Markup und folgt der visuellen Konvention (Header, Section-Body, etc.).

### Skizze

```
┌─── Sound Library ────────────────────────┐
│  🔍 Suche...                              │
│                                           │
│  ▾ Braams                                │
│    🔊 Heavy Braam        2.4s  ▶  [+]   │
│    🔊 Cinematic Braam    3.1s  ▶  [+]   │
│                                           │
│  ▾ Whoosh                                │
│    🔊 Fast Whoosh        0.8s  ▶  [+]   │
│                                           │
│  ▾ Kick                                  │
│    ...                                    │
│  ▾ Boom                                  │
│    ...                                    │
└───────────────────────────────────────────┘
```

### Verhalten

- **▶ Preview-Button:** spielt den Sound via Web Audio API ab, ohne ihn
  zur Timeline hinzuzufügen. Dauer ≤ Sound-Länge, stoppt automatisch.
- **[+] Button:** ruft `onAddToTimeline(sound)` auf → erzeugt
  `addMediaRef` + `addClip` auf dem nächsten freien Audio-Track (oder
  legt einen an wenn keiner da ist).
- **Drag:** Item ist draggable via `onPointerDown` (CLAUDE.md Regel 3) +
  dnd-kit oder Pattern aus `MediaLibrary.tsx`. Drop-Target ist jeder
  `audio`-Track. Drop-Handler triggert denselben `addMediaRef + addClip`
  Pfad wie [+].
- **Suche:** clientseitig, filtert über `label` + `tags`.

### State

Component liest Manifest aus dem Store (siehe nächste Section). Keine
eigenen Fetches — Loading geschieht einmalig im App-Start.

---

## Store: `lib/store/sounds-slice.ts` (NEU)

```ts
import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { SoundManifest } from '@/lib/sounds/types';

export interface SoundsState {
  manifest: SoundManifest | null;
  isLoading: boolean;
  error: string | null;
}

export const initialSoundsState: SoundsState = {
  manifest: null,
  isLoading: false,
  error: null
};

export const createSoundsSlice: StateCreator<
  AppState,
  [],
  [],
  Pick<AppState, 'sounds' | 'soundsActions'>
> = (_set, get) => ({
  sounds: initialSoundsState,
  soundsActions: {
    setManifest: (manifest) => {
      // Plan 10: transient (one-shot at app-start, not user-action)
      get().recordingSet(
        'SoundsManifest',
        (s) => { s.sounds = { ...s.sounds, manifest, isLoading: false }; },
        { skip: true }
      );
    },
    setLoading: (isLoading) => {
      get().recordingSet(
        'SoundsLoading',
        (s) => { s.sounds = { ...s.sounds, isLoading }; },
        { skip: true }
      );
    },
    setError: (error) => {
      get().recordingSet(
        'SoundsError',
        (s) => { s.sounds = { ...s.sounds, error, isLoading: false }; },
        { skip: true }
      );
    }
  }
});
```

Alle Sounds-Actions sind `{ skip: true }` — Manifest-Load ist transient,
nicht User-Action.

---

## MediaRef-Erweiterung: `lib/storage/types.ts` (MODIFY)

**Zwei** optionale Felder. Bestehende Refs bleiben gültig
(`source` undefined = 'upload'; `license` undefined = keine Anzeige).

```ts
export interface MediaRef {
  // ... bestehend ...
  source?: 'upload' | 'library';  // NEU, Default-Lesart: 'upload'
  license?: string;               // NEU, Architekt-W14 — Anzeige im Inspector wenn gesetzt
}
```

`addMediaRef`-Typisierung in `lib/store/media-slice.ts` muss
ebenfalls beide neuen Felder akzeptieren — die Slice nimmt das
Argument schon strukturell entgegen, der Typ folgt durch.

Kein Store-Migrations-Hop. Persist-Shape (`lib/store/persist-shape.ts`)
bleibt unverändert — optionale Felder sind by-design vorwärts/rückwärts
kompatibel.

---

## Timeline-Integration

Sound aus Library landet als normaler Audio-Clip:

```ts
function addSoundToTimeline(sound: SoundEntry, targetTrackId: string, dropBeat: number) {
  const mediaId = `library-${sound.id}`;
  const existing = useAppStore.getState().mediaActions.getMediaRef(mediaId);

  // 1. MediaRef registrieren (idempotent — getMediaRef-Guard im Slice)
  if (!existing) {
    useAppStore.getState().mediaActions.addMediaRef({
      id: mediaId,
      kind: 'audio',
      url: sound.url,                                       // schon absolute URL aus BFF
      filename: sound.label,
      uploadedAt: new Date().toISOString(),
      source: 'library',                                    // NEU (W14: source)
      license: sound.license                                // NEU (W14: license aus Manifest)
    });
    // ↑ recordingSet({ skip: true }) — R2-bound, Plan-10-Pattern
  }

  // 2. Clip auf Timeline (DAS ist die undo-bare User-Action)
  const bpm = useAppStore.getState().audio.grid.bpm;
  const lengthBeats = (sound.duration * bpm) / 60;
  useAppStore.getState().timelineActions.addClip({
    id: crypto.randomUUID(),
    trackId: targetTrackId,
    kind: 'audio',
    mediaId,
    startBeat: dropBeat,
    lengthBeats
  });
  // ↑ addClip recordingSet (default = record) — Plan-10-konform
}
```

**Architekt-B2-konform:** Clip-Shape ist `{ id, trackId, kind: 'audio',
mediaId, startBeat, lengthBeats }`. Kein `type:`, kein embedded
`mediaRef:`.

### Drop-Target

Bestehender Audio-Track akzeptiert Drops via `Tracks.tsx`-Pattern.
SoundLibrary-Item liefert beim Drag-Start eine Payload mit
`{ kind: 'library-sound', soundId }`, Tracks.tsx übersetzt das via
`addSoundToTimeline(...)`. Wenn kein freier Audio-Track existiert:
neuen anlegen (analog `AddTrackButton`-Pfad).

---

## Audio-Decode-Pfad (Architekt-W8)

Library-Sounds gehen **denselben** Decode-Pfad wie User-Uploads:
URL → `fetch` → `arrayBuffer()` → `AudioContext.decodeAudioData` →
`AudioBuffer` → Cache im AudioEngine.

CC #1 identifiziert in Schritt 0 den konkreten Helper (vermutlich in
`lib/audio/...` oder über `useAudioEngine`-Hook) und stellt sicher dass
er die absolute Library-URL akzeptiert. Falls der bestehende Pfad
storageAdapter-basiert ist (presigned URLs): Library-URLs sind bereits
final-public und überspringen den presign-Schritt.

---

## Inspector-Anzeige (Architekt-W10)

`components/Workspace/Inspector/MediaClipInspector.tsx` als MODIFY in
File Map. Ergänzung:

```tsx
{mediaRef.source === 'library' && (
  <div className="text-xs text-[var(--text-dim)]">
    Sound Library: {mediaRef.filename}
    {mediaRef.license && (
      <div className="text-xs text-[var(--text-muted)] mt-0.5">
        © {mediaRef.license}
      </div>
    )}
  </div>
)}
```

Architekt-W14: `license` aus dem Manifest, falls vorhanden, einzeilig im
Inspector. Nicht out-of-scope wie Rev. 1 deklariert, sondern direkt
v0.1-fähig.

**Architekt-Entscheidung:** Option (a) — `license` als optionales Feld
auf `MediaRef` (siehe MediaRef-Erweiterung-Section). Beim
`addSoundToTimeline`-Call wird `sound.license` direkt in den
`addMediaRef`-Payload durchgereicht. Kein Cross-Slice-Lookup vom
Inspector.

---

## Manifest-Initialisierung beim App-Start

Plazierung im obersten Client-Layer (z.B. `app/(studio)/layout.tsx`
oder `components/StudioBootstrap`):

```tsx
'use client';
import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { loadSoundManifest } from '@/lib/sounds/manifest-loader';

export function SoundManifestLoader() {
  const setManifest = useAppStore((s) => s.soundsActions.setManifest);
  const setLoading = useAppStore((s) => s.soundsActions.setLoading);
  const setError = useAppStore((s) => s.soundsActions.setError);
  useEffect(() => {
    setLoading(true);
    loadSoundManifest()
      .then((manifest) => {
        if (manifest) setManifest(manifest);
        else setError('Sound Library unavailable');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'unknown'));
  }, [setManifest, setLoading, setError]);
  return null;
}
```

`SoundLibrary.tsx` rendert je nach Store-State:
- `isLoading` → Spinner
- `error` → "Sound Library nicht verfügbar"
- `manifest` → Liste

Sound Library ist **optional** — Manifest-Fail crasht nicht die App.

---

## Undo-Behaviour (Architekt-B3)

| Action | Behandlung |
|---|---|
| `addMediaRef` für Library-Sound | `{ skip: true }` — R2-bound, Plan-10-Pattern (bestehend in media-slice) |
| `addClip` auf Timeline | `record` (default in `timelineActions.addClip`) |
| Drag-Drop Sound → Track | Identisch zu [+]: `addMediaRef skip` + `addClip record` |
| Preview-Playback | `skip` — transient (Web-Audio-Start ohne Store-Mutation) |
| Manifest-Load | `skip` — transient (alle 3 Actions im Sounds-Slice sind `{ skip: true }`) |

**Konsequenz:** Undo nach Drag-Drop zieht den Clip von der Timeline,
der MediaRef bleibt im Store (R2-bound, kein Rollback). Beim
Re-Drag desselben Sounds wird `getMediaRef`-Guard im Slice greifen,
kein doppelter Eintrag. Wie bei User-Uploads.

---

## CORS (Architekt-W7)

Schritt-0-Pflicht-Verifikation, vor jeglichem Code:

```bash
curl -I -H "Origin: $APP_ORIGIN" \
  "$R2_PUBLIC_URL/library/manifest.json"
```

Erwartet: `Access-Control-Allow-Origin: $APP_ORIGIN` (oder `*`).

Falls nicht: R2-CORS-Konfiguration auf den `library/`-Prefix erweitern.
Memory-Pattern aus `r2_setup_gotchas.md` — die Hürde haben wir schon
zweimal getroffen.

---

## Admin-Upload (Plan 8.7b — out of 8.7-Scope)

Nach Plan 8.6 (Admin-UI, ✅ live) wird dort eine "Sound Library"-Sektion
ergänzt:
- MP3-Upload direkt zu R2 `library/sfx/{category}/`
- `manifest.json` automatisch neu generiert nach Upload — `version`
  inkrementiert, Client-Caches invalidieren beim nächsten Reload
- Kategorien verwalten
- Preview im Admin-Bereich
- License-Feld erfasst beim Upload

Bewusst ausgelagert. 8.7 liefert die Read-Only-User-Erfahrung,
8.7b die Admin-Verwaltung.

---

## Tests

```
tests/unit/sounds/manifest-loader.test.ts                 (NEU)
tests/unit/sounds/sound-library.test.ts                   (NEU)
tests/unit/store/sounds-slice.test.ts                     (NEU)
tests/integration/sounds/add-to-timeline.test.ts          (NEU)
tests/integration/api/sounds-manifest.test.ts             (NEU — BFF-Route)
```

**Unit:**
- Manifest-Loader: erfolgreicher BFF-Fetch + localStorage-Cache
- Manifest-Loader: Cache-Hit + Version unverändert → kein Re-Cache
- Manifest-Loader: Version-Bump → Cache überschrieben
- Manifest-Loader: BFF-Fail + Cache vorhanden → graceful cached zurück
- Manifest-Loader: BFF-Fail + kein Cache → null
- Manifest-Loader: `isClient()` false → null (SSR-Safety)
- Manifest-Loader: corrupted localStorage-JSON → Cache-Miss-Pfad
- SoundLibrary: rendert Kategorien aus Store-Manifest
- SoundLibrary: Suche filtert über label+tags
- SoundLibrary: [+] ruft `onAddToTimeline` mit korrektem SoundEntry
- SoundLibrary: Loading-State + Error-State werden korrekt gerendert
- sounds-slice: `setManifest` setzt Store + `isLoading=false`
- sounds-slice: alle 3 Actions sind `{ skip: true }` (undo-test)

**Integration:**
- `addSoundToTimeline` → `addMediaRef` mit `source='library'` + `addClip`
  mit korrekter `kind: 'audio'`, `mediaId`, `lengthBeats`
- Drag-Drop Sound auf Audio-Track → identischer Pfad zu [+]
- Doppel-Drop desselben Sounds → nur ein MediaRef im Store
  (idempotent durch existing-Guard)
- BFF-Route `/api/sounds/manifest`: patcht relative URLs zu absolute
- BFF-Route: fetcht R2, Server-Cache-Header gesetzt

Mindest: **+13 neue Tests**

---

## Dateien

| Datei | Aktion |
|---|---|
| `lib/sounds/types.ts` | CREATE — `SoundEntry`/`SoundCategory`/`SoundManifest` |
| `lib/sounds/manifest-loader.ts` | CREATE — `loadSoundManifest()` mit `isClient()` + `localStorage` + version |
| `lib/store/sounds-slice.ts` | CREATE — `manifest`/`isLoading`/`error` + 3 Actions (alle `skip`) |
| `lib/store/index.ts` | MODIFY — `createSoundsSlice` einbinden |
| `lib/store/types.ts` | MODIFY — `sounds`/`soundsActions` zu `AppState` ergänzen |
| `lib/storage/types.ts` | MODIFY — `MediaRef.source?: 'upload' \| 'library'` + optional `license?: string` |
| `app/api/sounds/manifest/route.ts` | CREATE — BFF, patcht URLs zu absolut |
| `components/Workspace/LeftPanel/SoundLibrary.tsx` | CREATE — Geschwister zu `FxLibrary.tsx` |
| `components/Workspace/LeftPanel/SoundLibraryItem.tsx` | CREATE — Einzel-Sound-Zeile mit ▶ + [+] |
| `components/Workspace/LeftPanel/index.tsx` | MODIFY — `<SoundLibrary />` einreihen |
| `components/Workspace/Timeline/Tracks.tsx` | MODIFY — Drop-Handler erkennt `library-sound`-Payload |
| `components/Workspace/Inspector/MediaClipInspector.tsx` | MODIFY — `"Sound Library: ..."`-Anzeige + optional license |
| `components/Studio/SoundManifestLoader.tsx` (Pfad nach Schritt-0-Fund) | CREATE — useEffect-Loader |
| `app/(studio)/layout.tsx` o.ä. | MODIFY — `<SoundManifestLoader />` einhängen |
| `docs/architecture/sound-library.md` | CREATE |

---

## Commits

```
feat(sounds): SoundManifest types
feat(api): /api/sounds/manifest BFF route with URL-patching
feat(sounds): manifest-loader with isClient + localStorage + version
feat(store): sounds-slice + MediaRef.source + MediaRef.license fields
feat(ui): SoundLibrary + SoundLibraryItem components in LeftPanel
feat(timeline): drag-drop + add-button → addMediaRef(skip) + addClip(record)
feat(inspector): Sound Library label + optional license line
test(sounds): manifest-loader + components + slice + BFF route + timeline integration
docs: sound-library architecture
```

9 Commits.

---

## Performance-Hinweis (für spätere Iteration)

Der Manifest-Loader macht bei jedem App-Start einen BFF-Call, auch
bei lokalem Cache-Hit — der Round-Trip ist zur Versions-Prüfung
nötig (Client weiß nicht ob `manifest.version` gestiegen ist ohne
fetch). Solange das Manifest klein ist (< 100 Sounds, < 50 KB JSON),
ist das tolerabel.

**Verbesserung wenn Manifest wächst:** ETag/If-None-Match im BFF
implementieren. Server cached die R2-manifest.json + hash, sendet bei
matching `If-None-Match`-Header ein `304 Not Modified` ohne Body —
der Client-Round-Trip kostet dann nur noch ~200 Bytes statt das volle
Manifest. Optional auch im BFF-Cache-Layer (`next: { revalidate }`)
nutzen falls Next.js das ETag-pass-through unterstützt.

Für 8.7 v0.1 **bewusst ausgelassen** — vorzeitige Optimierung. Wird
relevant ab ~20 KB Manifest-Größe (~50+ Sounds in der Library).

---

## Nicht im Scope (8.7)

- Admin-Upload-UI → Plan 8.7b (nach Plan 8.6 ✅)
- BPM-synchrone Sounds (Sound-Duration automatisch an BPM snappen) → späterer Plan
- User-eigene Kategorien
- Pagination wenn Manifest >100 Sounds wird
- ETag/If-None-Match-Optimierung (siehe Performance-Hinweis oben)
- Capacitor-Optimierung (Audio-Streaming vom Server statt direkter R2-Zugriff
  könnte für iOS-WebView nötig sein — out of v0.1)

---

## Architekt-Checkliste — Status

- [x] B1: Component-Location nach Schritt-0-Fund (Option A: Geschwister zu FxLibrary.tsx)
- [x] B2: Clip-Shape `kind: 'audio'` + `mediaId`, SyncAudioDropZone als Vorlage
- [x] B3: Undo-Tabelle mit `skip`/`record` getrennt
- [x] B4: URL-Konvention vereinheitlicht auf `library/`
- [x] B5: `R2_PUBLIC_URL` aus `lib/storage/env.ts` via BFF-Route (server-only-Konflikt gelöst)
- [x] B6: `isClient()` + `localStorage` + version-Invalidierung
- [x] W7: CORS-Smoke als Schritt-0-Pflicht
- [x] W8: Audio-Decode-Pfad via Schritt-0-Helper-Identifikation
- [x] W10: `MediaClipInspector.tsx` in File Map + Label
- [x] W13: Kategorien = R2-Verzeichnisse
- [x] W14: `license`-Feld im Manifest + Inspector

---

Rev. 2-Final — alle 11 Architekt-Entscheidungen eingearbeitet,
plus BFF-Route für den `server-only`-Konflikt bei `R2_PUBLIC_URL`,
plus Architekt-Freigabe-Edits (license-Snippet, Option-(a)-Bestätigung,
Performance-Hinweis).

✅ Architekt-freigegeben 2026-05-28 — bereit für CC #1 Implementation.
