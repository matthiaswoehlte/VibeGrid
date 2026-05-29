# CC #1 Prompt — Plan 8.7b: Sound Library Admin (Rev. 2)

**Admin-UI zum Verwalten der Sound Library — MP3-Upload zu R2,
atomarer Upload+Manifest-Write, Metadata-Edit, Sound-Delete.**

Baseline: HEAD post-Plan-8.7 (Test-Zahl in Schritt 0 bestätigen).

**Abhängigkeit:** Plan 8.7 (Sound Library Read-Only) **vollständig
implementiert** (nicht nur freigegeben). CC #1 startet 8.7b erst nach
8.7-Shipping. 8.7 + 8.7b können als Bundle geshipped werden wenn
Admin-Tooling für initiale Sound-Befüllung essenziell ist — Matthias
entscheidet.

**Abhängigkeit:** Plan 8.6 (Admin-UI Grundgerüst) ✅ live.

> Rev. 2 — alle 14 Architekt-Entscheidungen aus
> `2026-05-28-vibegrid-architekt-entscheidung-8-7b.md` eingearbeitet:
> B1 requireAdminApi, B2 r2-client.ts MODIFY, B3 Sequencing,
> B4 revalidatePath, B5 AdminShell.tsx, F atomic Upload, G Edit-Mode,
> W6 Delete-Order, W8 Race-Doku, W9 UUID-Suffix, W10 MIME-Check,
> W11 category.id immutable, W12 AudioContext-Singleton, D16 Browser-only.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `app/admin/users/page.tsx` + `app/api/admin/users/route.ts` — Plan-8.6-Patterns:
   - Page-Struktur mit `requireAdminPage()` (in layout.tsx schon, kein eigener Call nötig in der Page)
   - API-Route mit `requireAdminApi(req)` + Discriminated-Union-Return `if ('response' in guard) return guard.response`
   - `export const runtime = 'nodejs'` (Pflicht, weil R2/DB Node-API nutzen)

2. `components/Admin/AdminShell.tsx` — Navigation-Pattern:
   - Strict-typisiertes `links`-Array (`Array<{ href: '/admin' | '/admin/users'; label: string }>`)
   - **Plan 8.7b muss den Union-Type erweitern**: `'/admin' | '/admin/users' | '/admin/sounds'`
   - Active-State via `pathname.startsWith`

3. `lib/storage/r2-client.ts` — bestehender R2-Helper:
   - `putToR2(key: string, body: Uint8Array, contentType: string): Promise<void>` existiert
   - S3Client-Singleton mit Lazy-Init + Test-Reset-Hook
   - `getR2Config()` returnt `bucket` (NICHT `bucketName`)
   - Kein `deleteFromR2` — wird in 8.7b ergänzt
   - Kein `cacheControl`-Argument — wird in 8.7b ergänzt

4. `lib/storage/env.ts` — `server-only`-Modul, Felder bestätigen:
   `{ accountId, accessKeyId, secretAccessKey, bucket, endpoint, publicUrl }`.

5. `app/api/sounds/manifest/route.ts` (aus Plan 8.7) — User-BFF lesen:
   - Welcher `revalidate`-TTL ist gesetzt (vermutlich 3600s)?
   - `revalidatePath('/api/sounds/manifest')` aus 8.7b-Routes invalidiert genau diesen Cache

6. `lib/sounds/types.ts` (aus Plan 8.7) — `SoundEntry`, `SoundCategory`,
   `SoundManifest` vollständig lesen, inkl. optionalem `license`-Feld.

7. `components/SceneFlow/ConfirmReplaceAudioModal.tsx` (Plan 8d) —
   Vorlage für den Delete-Confirm-Dialog. Pattern übernehmen.

8. Aktuelle Test-Zahl notieren:
   `npm test -- --run 2>&1 | grep -E "Tests|passed" | tail -3`

---

## Architektur

```
Admin-Browser
    │
    ├── GET    /admin/sounds                       ← Admin-Seite
    │
    ├── GET    /api/admin/sounds/manifest          ← raw lesen (relative URLs)
    ├── PUT    /api/admin/sounds/manifest          ← Metadata-Edit (W13 G)
    ├── POST   /api/admin/sounds/upload            ← MP3 + Manifest atomar (F)
    └── DELETE /api/admin/sounds/[id]              ← Manifest-First + R2 (W6)
```

Alle 4 API-Routes:
- `export const runtime = 'nodejs'`
- Beginnen mit `requireAdminApi`-Guard + `'response' in guard`-Return
- Schreibende Routes (POST/PUT/DELETE) enden mit
  `revalidatePath('/api/sounds/manifest')` (B4)

**Admin-UI ist Browser-only.** Kein Capacitor-Target. (D16)

---

## Admin-Page: `/admin/sounds`

### Layout

```
┌─── Sound Library Admin ──────────────────────────────────┐
│                                          [+ Sound hochladen] │
│                                                              │
│  ▾ Braams                                                    │
│    🔊 Heavy Braam     2.4s  braam-heavy-01.mp3  ▶ [✏] [🗑] │
│    🔊 Cinematic Braam 3.1s  braam-cinema-02.mp3 ▶ [✏] [🗑] │
│                                                              │
│  ▾ Whoosh                                                    │
│    🔊 Fast Whoosh     0.8s  whoosh-fast-01.mp3  ▶ [✏] [🗑] │
│                                                              │
│  ▾ [Kategorie inline editierbar...]                          │
└──────────────────────────────────────────────────────────────┘
```

- **[+ Sound hochladen]**: öffnet Upload-Modal in `mode='create'`
- **[✏] Edit-Button**: öffnet Upload-Modal in `mode='edit'` (W13 G)
  - File-Picker disabled
  - Felder vorausgefüllt aus Manifest
  - Submit → PUT manifest mit geänderten Feldern
- **▶ Preview**: spielt Sound via Web Audio (Singleton-AudioContext, W12)
- **[🗑] Delete**: öffnet Confirm-Dialog → DELETE /api/admin/sounds/[id]
- **Kategorie-Label**: inline editierbar (Click-to-Edit) → PUT manifest
  mit geändertem `category.label`. **`category.id` ist immutable** (W11).

---

## Upload-Modal — zwei Modi (Create + Edit, W13 G)

```
┌─── Sound hochladen / bearbeiten ─────────┐
│                                           │
│  Kategorie:  [Braams         ▼] [+ Neu]  │
│  Datei:      [MP3 auswählen...   ]        │  ← disabled in edit-mode
│  Label:      [Heavy Braam        ]        │
│  Tags:       [dark, cinematic    ]        │
│  License:    [Freesound CC0      ]        │
│  BPM:        [   ] (optional)             │
│                                           │
│  ████████░░░░░░░░  Upload läuft...        │
│                              [Abbrechen]  │
└───────────────────────────────────────────┘
```

```ts
interface UploadModalProps {
  mode: 'create' | 'edit';
  existingEntry?: SoundEntry;       // Pflicht wenn mode='edit'
  existingCategoryId?: string;      // Pflicht wenn mode='edit'
  categories: SoundCategory[];       // für Dropdown
  onClose: () => void;
  onComplete: (manifest: SoundManifest) => void;
}
```

**Create-Mode:**
- File-Picker akzeptiert MP3 (Client-Check via `file.type === 'audio/mpeg'`, W10)
- Max 10 MB pro File
- Label wird aus Dateiname vorgeschlagen (ohne `.mp3`, kebab→Title)
- Duration via Singleton-AudioContext (W12, siehe unten)
- Submit → `POST /api/admin/sounds/upload` (atomar)

**Edit-Mode:**
- File-Picker disabled (kein Re-Upload in 8.7b — out of scope)
- Felder aus `existingEntry` vorausgefüllt
- Submit → `PUT /api/admin/sounds/manifest` mit kompletter Manifest-
  Kopie + geänderten Feldern auf dem Entry
- Kategorie-Wechsel ist erlaubt (Manifest verschiebt Entry zwischen
  Kategorien, R2-Pfad bleibt aber gleich — `url`-Feld unverändert)

---

## AudioContext-Singleton (W12)

In `app/admin/sounds/UploadModal.tsx` (oder geteilte Util):

```ts
let _audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext();
  }
  return _audioCtx;
}

async function getAudioDuration(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const decoded = await getAudioCtx().decodeAudioData(arrayBuffer);
  return decoded.duration;
  // KEIN audioCtx.close() — Singleton überlebt für nächste Upload-Iteration
}
```

In `'use client'`-Komponente — `isClient()`-Guard nicht nötig. Nur in
User-Gesture-Path aufrufen (File-Picker-Change-Handler ist Gesture-OK
auf Safari/iOS).

---

## API-Routes

### `GET /api/admin/sounds/manifest`

Liest `library/manifest.json` **raw** aus R2 (relative URLs — admin
braucht die unveränderten Pfade für UI-Anzeige + späteres Editing,
nicht die client-gepatchten absoluten URLs).

```ts
// app/api/admin/sounds/manifest/route.ts
import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth/admin-guard';
import { getR2Config } from '@/lib/storage/env';
import type { SoundManifest } from '@/lib/sounds/types';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  const { publicUrl } = getR2Config();
  const res = await fetch(`${publicUrl}/library/manifest.json`, {
    cache: 'no-store'  // Admin sieht immer den frischen Stand
  });
  if (!res.ok) {
    // Noch kein Manifest → leeres Skelett zurück
    return NextResponse.json({
      version: 0,
      updatedAt: new Date().toISOString(),
      categories: []
    } satisfies SoundManifest);
  }
  return NextResponse.json(await res.json());
}
```

### `PUT /api/admin/sounds/manifest`

Schreibt komplettes Manifest zurück zu R2. Inkrementiert `version`.
Triggert `revalidatePath` für User-BFF.

```ts
import { revalidatePath } from 'next/cache';
import { putToR2 } from '@/lib/storage/r2-client';

export async function PUT(req: Request): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  const body = await req.json() as SoundManifest;
  const updated: SoundManifest = {
    ...body,
    version: body.version + 1,
    updatedAt: new Date().toISOString()
  };
  const bytes = new TextEncoder().encode(JSON.stringify(updated));
  await putToR2('library/manifest.json', bytes, 'application/json', {
    cacheControl: 'public, max-age=3600'  // B2-Erweiterung
  });
  revalidatePath('/api/sounds/manifest');  // B4
  return NextResponse.json({ ok: true, version: updated.version });
}
```

### `POST /api/admin/sounds/upload` — atomar (F)

Macht **beides** in einem Call: MP3 + Manifest-Update. Damit kein
Mid-Step-Fail-Risk.

```ts
export async function POST(req: Request): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  const form = await req.formData();
  const file = form.get('file');
  const category = String(form.get('category') ?? '');
  const label = String(form.get('label') ?? '');
  const tags = JSON.parse(String(form.get('tags') ?? '[]')) as string[];
  const license = form.get('license') ? String(form.get('license')) : undefined;
  const bpmRaw = form.get('bpm');
  const bpm = bpmRaw ? Number(bpmRaw) : undefined;
  const duration = Number(form.get('duration'));  // Client misst via AudioContext

  // === Validierung ===
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no file' }, { status: 400 });
  }
  if (file.type !== 'audio/mpeg') {                        // W10: MIME nicht Extension
    return NextResponse.json({ error: 'MP3 only (audio/mpeg)' }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'Max 10 MB' }, { status: 400 });
  }
  if (!category || !label || !Number.isFinite(duration)) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  // === Schritt 1: MP3 nach R2 ===
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = `${slug}-${crypto.randomUUID().slice(0, 8)}`;   // W9: UUID-Suffix
  const r2Key = `library/sfx/${category}/${id}.mp3`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await putToR2(r2Key, bytes, 'audio/mpeg', {
    cacheControl: 'public, max-age=31536000, immutable'      // 1 Jahr, unveränderlich
  });

  // === Schritt 2: Manifest lesen + Entry mergen + Manifest schreiben ===
  const { publicUrl } = getR2Config();
  const manifestRes = await fetch(`${publicUrl}/library/manifest.json`, {
    cache: 'no-store'
  });
  const current: SoundManifest = manifestRes.ok
    ? await manifestRes.json()
    : { version: 0, updatedAt: new Date().toISOString(), categories: [] };

  const entry: SoundEntry = {
    id,
    label,
    url: `sfx/${category}/${id}.mp3`,        // relativ zu library/
    duration,
    ...(bpm ? { bpm } : {}),
    ...(tags.length ? { tags } : {}),
    ...(license ? { license } : {})
  };

  // Kategorie suchen oder anlegen (W11: id immutable, nur einmalig hier gesetzt)
  let catIdx = current.categories.findIndex((c) => c.id === category);
  if (catIdx === -1) {
    current.categories.push({
      id: category,
      label: category[0].toUpperCase() + category.slice(1),
      sounds: []
    });
    catIdx = current.categories.length - 1;
  }
  current.categories[catIdx].sounds.push(entry);

  const updated: SoundManifest = {
    ...current,
    version: current.version + 1,
    updatedAt: new Date().toISOString()
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(updated));
  await putToR2('library/manifest.json', manifestBytes, 'application/json', {
    cacheControl: 'public, max-age=3600'
  });

  // === Schritt 3: User-BFF-Cache invalidieren ===
  revalidatePath('/api/sounds/manifest');                    // B4

  return NextResponse.json({ entry, version: updated.version });
}
```

**Failure-Modes:**
- Schritt 1 (R2 PUT MP3) fail → Client bekommt 5xx, kein Müll, retry-safe
- Schritt 2 (Manifest read/write) fail → MP3 ist in R2 als Orphan,
  dokumentiert als Edge-Case in KNOWN_LIMITATIONS (W8). Nächster Upload
  für denselben slug bekommt anderen UUID-Suffix, kein Conflict.

### `DELETE /api/admin/sounds/[id]` — Manifest-First (W6)

```ts
// app/api/admin/sounds/[id]/route.ts
import { deleteFromR2 } from '@/lib/storage/r2-client';   // B2-Erweiterung

export const runtime = 'nodejs';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guard = await requireAdminApi(req);
  if ('response' in guard) return guard.response;

  const { id } = await params;

  // === Schritt 1: Manifest lesen ===
  const { publicUrl } = getR2Config();
  const res = await fetch(`${publicUrl}/library/manifest.json`, { cache: 'no-store' });
  if (!res.ok) return NextResponse.json({ error: 'no manifest' }, { status: 404 });
  const current: SoundManifest = await res.json();

  // Entry + R2-Pfad finden
  let r2Key: string | null = null;
  const nextCategories = current.categories.map((c) => {
    const before = c.sounds.length;
    const sounds = c.sounds.filter((s) => {
      if (s.id === id) {
        r2Key = `library/${s.url}`;
        return false;
      }
      return true;
    });
    return sounds.length === before ? c : { ...c, sounds };
  });

  if (!r2Key) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // === Schritt 2: Manifest-First — ohne Entry schreiben (W6) ===
  const updated: SoundManifest = {
    ...current,
    categories: nextCategories,
    version: current.version + 1,
    updatedAt: new Date().toISOString()
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(updated));
  await putToR2('library/manifest.json', manifestBytes, 'application/json', {
    cacheControl: 'public, max-age=3600'
  });

  // === Schritt 3: R2 DeleteObject ===
  // Bei Fail: Orphan-MP3 in R2 (Storage-Müll, kein UX-Schaden — User sehen Entry weg)
  try {
    await deleteFromR2(r2Key);
  } catch (e) {
    console.warn(`[admin/sounds] orphan MP3 ${r2Key}: ${e instanceof Error ? e.message : e}`);
  }

  // === Schritt 4: Cache invalidieren ===
  revalidatePath('/api/sounds/manifest');                    // B4

  return NextResponse.json({ ok: true, version: updated.version });
}
```

---

## R2-Helper-Erweiterung (B2)

`lib/storage/r2-client.ts` MODIFY:

```ts
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

export interface PutOptions {
  cacheControl?: string;
}

export async function putToR2(
  key: string,
  body: Uint8Array,
  contentType: string,
  opts?: PutOptions                                          // B2: optional erweitert
): Promise<void> {
  const cfg = getR2Config();
  const cmd = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(opts?.cacheControl ? { CacheControl: opts.cacheControl } : {})
  });
  await getS3Client().send(cmd);
}

export async function deleteFromR2(key: string): Promise<void> {  // B2: neu
  const cfg = getR2Config();
  const cmd = new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key });
  await getS3Client().send(cmd);
}
```

`_resetR2ClientForTests` bleibt unverändert.

---

## AdminShell-Navigation (B5)

`components/Admin/AdminShell.tsx` MODIFY — Nav um Sound-Library-Link
erweitern. Der `links`-Array-Union-Type muss `'/admin/sounds'` aufnehmen:

```ts
// Vorher:
const links: Array<{ href: '/admin' | '/admin/users'; label: string }> = [...];

// Nachher:
const links: Array<{
  href: '/admin' | '/admin/users' | '/admin/sounds';
  label: string;
}> = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/users', label: 'User' },
  { href: '/admin/sounds', label: 'Sound Library' }    // NEU
];
```

`active`-State-Logik braucht keine Änderung (`pathname.startsWith` deckt
`/admin/sounds` automatisch).

---

## Confirm-Dialog für Delete

Vorlage: `components/SceneFlow/ConfirmReplaceAudioModal.tsx`.

Eigene Komponente `app/admin/sounds/ConfirmDeleteModal.tsx` (oder
geteilte `components/Admin/ConfirmModal.tsx` falls bald wiederverwendet):

```tsx
interface ConfirmDeleteModalProps {
  open: boolean;
  soundLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}
```

Standard-Dark-Theme + zwei Buttons (Cancel = neutral, Delete = rot).

---

## Undo-Behaviour

| Action | Behandlung |
|---|---|
| MP3-Upload zu R2 | `skip` — R2-Mutation, nicht rückgängig (kein Store-Touch) |
| Manifest-Write (PUT/POST/DELETE) | `skip` — R2-Mutation |
| Sound-Delete | `skip` — Confirm-Dialog statt Undo |
| Admin-UI-State (Modal open/close, Form-Inputs) | transient, kein Store |

Admin-Actions sind alle `skip` — R2-Operationen sind extern und nicht
in-app rückgängig machbar. Confirm-Dialog vor Delete ersetzt Undo.

Plan-8.7b touchen den Zustand-Store **nicht** (Sounds-Slice gehört User-
Seite, Admin liest/schreibt direkt R2 via API). Damit gibt's keine
Plan-10-Konflikte.

---

## Sicherheit

- Alle 4 `/api/admin/sounds/...`-Routes: `requireAdminApi(req)` +
  `'response' in guard`-Return (B1)
- Alle 4 Routes: `export const runtime = 'nodejs'` (B1)
- Kein Client-Bundle-Leak von R2-Credentials — Routes sind effektiv
  server-only durch Import von `lib/storage/env.ts` (`'server-only'`)
- MIME-Check `audio/mpeg` auf Server (Defense in Depth zur Client-
  Validierung, W10)
- Size-Limit 10 MB serverseitig durchgesetzt
- Confirm-Dialog für Delete (kein Undo-Sicherheitsnetz)

---

## KNOWN_LIMITATIONS — zwei neue Einträge

### Eintrag 1: Concurrent Admin-Writes Race-Condition (W8)

```markdown
### Sound Library Admin — Concurrent Writes Last-Writer-Wins

Plan 8.7b kennt keine Optimistic-Concurrency auf der Manifest-PUT.
Wenn zwei Admin-Sessions zeitgleich schreiben (z.B. Edit + Upload
parallel), liest jede `version: N`, schreibt `version: N+1`, und
der zweite Write überschreibt den ersten — eine der beiden Änderungen
geht verloren. Akzeptable Restrisikenklasse für v0.1 mit einem aktiven
Admin. Saubere Lösung wäre `If-Match`-Header mit ETag-Check, Folge-
Plan bei Multi-Admin-Bedarf.
```

### Eintrag 2: Upload-Orphan bei Partial-Fail

```markdown
### Sound Library Admin — Upload-Orphan-MP3

Der atomare POST /api/admin/sounds/upload macht MP3-PUT und Manifest-
PUT sequentiell. Bei Manifest-PUT-Fail bleibt die MP3 in R2 als Orphan
(nicht im Manifest referenziert, kein UX-Schaden). Storage-Müll, kein
Sicherheits- oder Datenintegritätsproblem. Manueller R2-Cleanup oder
ein Sweeper-Job (Folge-Plan) räumt das.

Reverse-Fall — Delete: Manifest-First-Order (W6) sorgt dafür, dass
Manifest-Update gelingt aber R2-Delete fail → Orphan in R2,
identisch zu Upload-Fall. Kein Ghost-Entry im Manifest, der User
ein 404 produzieren würde.
```

---

## Tests (B4 + Architekt-Test-Ergänzungen)

```
tests/integration/api/admin-sounds-manifest.test.ts    (NEU)
tests/integration/api/admin-sounds-upload.test.ts      (NEU)
tests/integration/api/admin-sounds-delete.test.ts      (NEU)
tests/unit/admin/sound-library-admin-page.test.tsx     (NEU)
tests/unit/admin/upload-modal.test.tsx                 (NEU)
tests/unit/storage/r2-client.test.ts                   (MODIFY — deleteFromR2 + cacheControl)
```

**API-Route-Tests:**
1. GET manifest: liest R2, gibt JSON zurück
2. GET manifest: R2 404 → leeres Skelett-Manifest
3. GET/PUT/POST/DELETE: `requireAdminApi`-Guard schlägt fehl bei
   Nicht-Admin → 401 (eine Test-Case pro Route, B1)
4. PUT manifest: version++ + updatedAt + `revalidatePath` aufgerufen (B4)
5. POST upload: MP3 in R2 + Entry im Manifest + Manifest-version++
   (atomarer Flow F)
6. POST upload: Non-MIME (`audio/mpeg`-Check) → 400 (W10)
7. POST upload: >10 MB → 400
8. POST upload: slug-Collision durch UUID-Suffix unmöglich gemacht
   (zwei Uploads mit identischem Label → unterschiedliche IDs, W9)
9. POST upload: `revalidatePath('/api/sounds/manifest')` aufgerufen (B4)
10. POST upload: neue Kategorie wird angelegt wenn nicht existent (W11)
11. DELETE: Manifest-First-Order — Manifest-PUT vor R2-Delete
    aufgerufen (W6, Mock-Order-Assertion)
12. DELETE: R2-Delete-Fail → 200 zurück, console.warn geloggt
    (Orphan-Toleranz)
13. DELETE: `revalidatePath` aufgerufen (B4)

**UI-Tests:**
14. Admin-Page rendert Kategorien + Sounds aus geladenem Manifest
15. Upload-Modal Create-Mode: File-Picker aktiv, Submit triggert POST
16. Upload-Modal Edit-Mode (G): File-Picker disabled, Felder vorausgefüllt,
    Submit triggert PUT manifest (nicht POST upload)
17. Confirm-Dialog erscheint vor Delete, Cancel hält Action zurück
18. AudioContext-Singleton: zweiter Duration-Measure schließt vorigen
    nicht (W12)

**R2-Client-Tests (MODIFY):**
19. `putToR2` mit `cacheControl` setzt das Header-Feld
20. `deleteFromR2` ruft `DeleteObjectCommand` mit korrektem Bucket+Key

Mindest: **+16 neue Tests** (Architekt-Anforderung erfüllt durch
13 API + 5 UI + 2 R2 = 20 ≥ 16, mit Polster).

---

## Dateien

| Datei | Aktion |
|---|---|
| `app/admin/sounds/page.tsx` | CREATE — Admin-Seite, Manifest-Fetch via /api/admin/sounds/manifest |
| `app/admin/sounds/UploadModal.tsx` | CREATE — Upload-Modal mit Create + Edit-Modes (G) |
| `app/admin/sounds/ConfirmDeleteModal.tsx` | CREATE — Confirm-Dialog vor Delete |
| `app/api/admin/sounds/manifest/route.ts` | CREATE — GET + PUT |
| `app/api/admin/sounds/upload/route.ts` | CREATE — POST atomar (F) |
| `app/api/admin/sounds/[id]/route.ts` | CREATE — DELETE Manifest-First (W6) |
| `lib/storage/r2-client.ts` | MODIFY — `cacheControl`-Opt + `deleteFromR2` (B2) |
| `components/Admin/AdminShell.tsx` | MODIFY — Nav-Link + Union-Type erweitern (B5) |
| `docs/architecture/sound-library.md` | MODIFY — Admin-Section ergänzen |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY — zwei neue Einträge (W8 Race + Upload-Orphan) |

**Kein** `lib/storage/r2-write.ts` (B2 — bestehender Helper wird erweitert).

---

## Commits

```
feat(storage): r2-client — cacheControl option + deleteFromR2 helper
feat(api): /api/admin/sounds/manifest GET+PUT with requireAdminApi + revalidatePath
feat(api): /api/admin/sounds/upload POST atomic (MP3 + manifest + revalidate)
feat(api): /api/admin/sounds/[id] DELETE manifest-first + R2 + revalidate
feat(admin): /admin/sounds page with category accordion + edit/delete buttons
feat(admin): UploadModal create-mode + edit-mode + AudioContext singleton
feat(admin): ConfirmDeleteModal pattern
feat(admin): AdminShell nav — Sound Library link + route-type extension
docs(known-limitations): admin race + upload-orphan
docs(architecture): sound-library admin section
test(api): admin sounds manifest + upload + delete + revalidatePath
test(admin): sound-library page + upload-modal create/edit + confirm-dialog
test(storage): r2-client cacheControl + deleteFromR2
```

13 Commits.

---

## Nicht im Scope (8.7b)

- Bulk-Upload (mehrere MP3 gleichzeitig) → späterer Plan
- Sound-File-Replacement (gleiche ID, neue MP3-Datei) → späterer Plan
- Drag-Drop-Reordering innerhalb Kategorien → späterer Plan
- CDN-Invalidierung über Cloudflare-Cache-Purge → falls je nötig
  (R2-public-URL hat eigene Cache-Headers + Plan-8.7-BFF `revalidate`
  + 8.7b `revalidatePath` decken den Standardfall ab)
- Optimistic-Concurrency / ETag / `If-Match` → KNOWN_LIMITATIONS,
  Folge-Plan bei Multi-Admin-Bedarf (W8)
- Sweeper-Job für Orphan-MP3s → Folge-Plan
- Capacitor-Support für Admin-UI → **explizit out: Admin ist
  Browser-only** (D16)

---

## Architekt-Checkliste — Status

- [x] B1: `requireAdminApi` + `'response' in guard` + `runtime = 'nodejs'` auf allen 4 Routes
- [x] B2: `r2-client.ts` MODIFY (`cacheControl`-Opt + `deleteFromR2`), kein neuer Helper
- [x] B3: Sequencing-Header — 8.7 muss implementiert sein, nicht nur freigegeben
- [x] B4: `revalidatePath('/api/sounds/manifest')` nach jedem schreibenden Endpoint + Test
- [x] B5: `components/Admin/AdminShell.tsx` MODIFY mit Union-Type-Erweiterung
- [x] F: POST upload atomar (MP3 + Manifest in einem Call)
- [x] G: Edit-Mode im Upload-Modal (PUT manifest, kein File-Re-Upload)
- [x] W6: Delete-Order Manifest-First → R2 (Orphan-Toleranz statt Ghost-Entry)
- [x] W9: `${slug}-${crypto.randomUUID().slice(0,8)}` statt `Date.now()`
- [x] W10: `file.type !== 'audio/mpeg'` Check serverseitig
- [x] W11: `category.id` immutable dokumentiert, nur `label` editierbar
- [x] W12: `AudioContext`-Singleton mit State-Recreation bei `closed`
- [x] W8: Race-Condition in `KNOWN_LIMITATIONS` als bewusst-akzeptiertes Restrisiko
- [x] D16: „Admin-UI ist Browser-only" explizit im Architektur-Block

---

Rev. 2 — alle 14 Architekt-Entscheidungen eingearbeitet. Bereit für
CC #1 Implementation **nach Plan 8.7 Shipping** (oder als 8.7+8.7b-
Bundle wenn Matthias das so will).
