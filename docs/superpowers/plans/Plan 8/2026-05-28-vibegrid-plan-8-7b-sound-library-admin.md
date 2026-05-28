# CC #1 Prompt — Plan 8.7b: Sound Library Admin

**Admin-UI zum Verwalten der Sound Library — MP3-Upload zu R2,
Manifest automatisch neu generieren, Kategorien verwalten.**

Baseline: HEAD post-8.7 (Test-Zahl in Schritt 0 bestätigen).
Abhängigkeit: Plan 8.6 (Admin-UI Grundgerüst) ✅ live.
Abhängigkeit: Plan 8.7 (Sound Library Read-Only) ✅ live.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `app/admin/` — Struktur des Admin-Bereichs:
   - Welche Seiten existieren bereits? (`/admin/credits`? `/admin/users`?)
   - Wie ist Navigation / Layout aufgebaut?
   - Wie wird Admin-Auth geprüft (Middleware? Route-Guard?)

2. `app/api/presign/route.ts` — bestehender Upload-Pfad:
   - Wie wird ein R2-Presigned-URL generiert?
   - Welche Parameter nimmt der Endpoint entgegen?
   - Kann er für `library/`-Uploads genutzt werden oder braucht es
     einen eigenen Endpoint?

3. `lib/storage/env.ts` — R2-Config:
   - Welche Felder liefert `getR2Config()`?
   - Ist ein direkter Server-Side-Upload (ohne Presign) möglich?

4. `app/api/sounds/manifest/route.ts` (Plan 8.7):
   - Wie wird das Manifest heute gelesen?
   - Wie kann die Route erweitert werden um auch zu schreiben?

5. `lib/sounds/types.ts` (Plan 8.7):
   - `SoundEntry`, `SoundCategory`, `SoundManifest` — vollständig lesen.

6. Aktuelle Test-Zahl notieren.

---

## Architektur

```
Admin-Browser
    │
    ├── GET  /admin/sounds           ← Admin-Seite (Sound Library)
    │
    ├── GET  /api/admin/sounds/manifest   ← Manifest lesen
    ├── PUT  /api/admin/sounds/manifest   ← Manifest schreiben
    ├── POST /api/admin/sounds/upload     ← MP3-Upload → R2
    └── DELETE /api/admin/sounds/:id     ← Sound + Manifest-Eintrag löschen
```

Alle `/api/admin/`-Routes sind server-only + Admin-Auth-Guard.

---

## Admin-Seite: `/admin/sounds`

### Layout

```
┌─── Sound Library Admin ──────────────────────────────────┐
│                                          [+ Sound hochladen] │
│                                                              │
│  ▾ Braams                                    [+ Kategorie]  │
│    🔊 Heavy Braam     2.4s  braam-heavy-01.mp3  ▶  [🗑]   │
│    🔊 Cinematic Braam 3.1s  braam-cinematic-02.mp3 ▶ [🗑]  │
│                                                              │
│  ▾ Whoosh                                                    │
│    🔊 Fast Whoosh     0.8s  whoosh-fast-01.mp3  ▶  [🗑]    │
│                                                              │
│  ▾ [Neue Kategorie...]                                       │
└──────────────────────────────────────────────────────────────┘
```

- **[+ Sound hochladen]:** öffnet Upload-Modal
- **[+ Kategorie]:** legt neue leere Kategorie an
- **▶ Preview:** spielt Sound via Web Audio ab
- **[🗑]:** löscht Sound aus R2 + Manifest (mit Confirm-Dialog)
- **Kategorie-Label:** inline editierbar (Click-to-Edit)

---

## Upload-Modal

```
┌─── Sound hochladen ──────────────────────┐
│                                           │
│  Kategorie:  [Braams         ▼] [+ Neu]  │
│  Datei:      [MP3 auswählen...   ]        │
│  Label:      [Heavy Braam        ]        │
│  Tags:       [dark, cinematic    ]        │
│  License:    [Freesound CC0      ]        │
│  BPM:        [   ] (optional)             │
│                                           │
│  ████████░░░░░░░░  Upload läuft...        │
│                              [Abbrechen]  │
└───────────────────────────────────────────┘
```

- Nur MP3 akzeptiert (client-side Validierung + server-side Check)
- Max 10 MB pro File
- Label wird aus Dateiname vorgeschlagen (ohne Extension, kebab→Title)
- Duration wird nach Upload via `AudioContext.decodeAudioData` ermittelt
  (Client-Side, vor dem Upload oder nach dem Download zur Verifikation)
- Nach erfolgreichem Upload: Manifest automatisch neu generiert

---

## API-Routes

### `GET /api/admin/sounds/manifest`

Liest `library/manifest.json` direkt aus R2 (raw, mit relativen URLs —
nicht die gepatchte BFF-Version für User).

```ts
// app/api/admin/sounds/manifest/route.ts
import 'server-only'
import { requireAdmin } from '@/lib/auth/admin'
import { getR2Config } from '@/lib/storage/env'

export async function GET(req: Request) {
  await requireAdmin(req)
  const { publicUrl } = getR2Config()
  const res = await fetch(`${publicUrl}/library/manifest.json`)
  if (!res.ok) {
    // Noch kein Manifest → leeres zurückgeben
    return Response.json({
      version: 0,
      updatedAt: new Date().toISOString(),
      categories: []
    })
  }
  return Response.json(await res.json())
}
```

### `PUT /api/admin/sounds/manifest`

Schreibt `library/manifest.json` zurück zu R2. Inkrementiert `version`.

```ts
export async function PUT(req: Request) {
  await requireAdmin(req)
  const manifest = await req.json() as SoundManifest
  const updated = {
    ...manifest,
    version: manifest.version + 1,
    updatedAt: new Date().toISOString()
  }
  // R2 PutObject via AWS SDK / Cloudflare R2 SDK
  await putR2Object('library/manifest.json', JSON.stringify(updated), {
    contentType: 'application/json',
    cacheControl: 'public, max-age=3600'
  })
  return Response.json({ ok: true, version: updated.version })
}
```

### `POST /api/admin/sounds/upload`

Nimmt MP3 entgegen, lädt zu R2 hoch, gibt neue SoundEntry zurück.

```ts
export async function POST(req: Request) {
  await requireAdmin(req)
  const form = await req.formData()
  const file = form.get('file') as File
  const category = form.get('category') as string
  const label = form.get('label') as string
  const tags = JSON.parse(form.get('tags') as string ?? '[]') as string[]
  const license = form.get('license') as string | null
  const bpm = form.get('bpm') ? Number(form.get('bpm')) : undefined
  const duration = Number(form.get('duration'))  // vom Client gemessen

  // Validierung
  if (!file.name.endsWith('.mp3')) {
    return Response.json({ error: 'MP3 only' }, { status: 400 })
  }
  if (file.size > 10 * 1024 * 1024) {
    return Response.json({ error: 'Max 10 MB' }, { status: 400 })
  }

  // R2-Pfad
  const slug = label.toLowerCase().replace(/\s+/g, '-')
  const id = `${slug}-${Date.now()}`
  const r2Path = `library/sfx/${category}/${id}.mp3`

  await putR2Object(r2Path, await file.arrayBuffer(), {
    contentType: 'audio/mpeg',
    cacheControl: 'public, max-age=31536000'  // 1 Jahr — unveränderlich
  })

  const entry: SoundEntry = {
    id,
    label,
    url: `sfx/${category}/${id}.mp3`,  // relativ zu library/
    duration,
    ...(bpm ? { bpm } : {}),
    ...(tags.length ? { tags } : {}),
    ...(license ? { license } : {})
  }

  return Response.json(entry)
}
```

### `DELETE /api/admin/sounds/:id`

Löscht MP3 aus R2 + entfernt Eintrag aus Manifest.

```ts
// app/api/admin/sounds/[id]/route.ts
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  await requireAdmin(req)
  // 1. Manifest laden
  // 2. Entry mit params.id finden → R2-Pfad ableiten
  // 3. R2 DeleteObject
  // 4. Manifest ohne diesen Entry schreiben (version++)
  return Response.json({ ok: true })
}
```

---

## putR2Object Helper

Falls noch nicht vorhanden (Schritt-0-Fund entscheidet):

```ts
// lib/storage/r2-write.ts (NEU oder MODIFY bestehend)
import 'server-only'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getR2Config } from './env'

export async function putR2Object(
  key: string,
  body: string | ArrayBuffer,
  opts: { contentType: string; cacheControl?: string }
) {
  const { accountId, accessKeyId, secretAccessKey, bucketName } = getR2Config()
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  })
  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: typeof body === 'string' ? body : Buffer.from(body),
    ContentType: opts.contentType,
    CacheControl: opts.cacheControl
  }))
}
```

CC #1 prüft in Schritt 0 ob ein solcher Helper bereits existiert —
falls ja, nutzen statt neu bauen.

---

## Duration-Ermittlung (Client-Side)

```ts
// Im Upload-Modal, nach File-Auswahl:
async function getAudioDuration(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer()
  const audioCtx = new AudioContext()
  const decoded = await audioCtx.decodeAudioData(arrayBuffer)
  await audioCtx.close()
  return decoded.duration
}
```

Duration wird vor dem Upload gemessen und als `duration`-Field
mitgeschickt. Kein Server-Side-Decode nötig.

---

## Undo-Behaviour

| Action | Behandlung |
|---|---|
| MP3-Upload zu R2 | `skip` — R2-Mutation, nicht rückgängig machbar |
| Manifest-Write | `skip` — R2-Mutation |
| Sound-Delete | `skip` — R2-Mutation (Confirm-Dialog statt Undo) |
| Admin-UI-State (Modal open/close) | transient, kein Store |

Admin-Actions sind alle skip — R2-Operationen sind extern und
nicht rückgängig machbar. Confirm-Dialog vor Delete ersetzt Undo.

---

## Sicherheit

- Alle `/api/admin/`-Routes beginnen mit `await requireAdmin(req)`
- `requireAdmin` wirft 401 wenn kein Admin-Token (Pattern aus Plan 8.6)
- Kein Client-Bundle-Leak von R2-Credentials — alle Routes sind
  `server-only` via `import 'server-only'`
- File-Typ-Validierung auf Client + Server (Defense in Depth)

---

## Tests

```
tests/unit/api/admin-sounds-manifest.test.ts    (NEU)
tests/unit/api/admin-sounds-upload.test.ts      (NEU)
tests/unit/api/admin-sounds-delete.test.ts      (NEU)
tests/unit/admin/sound-library-admin.test.ts    (NEU)
```

- GET manifest: liest R2, gibt JSON zurück
- GET manifest: R2 nicht vorhanden → leeres Manifest
- PUT manifest: version++ + updatedAt aktualisiert
- PUT manifest: Admin-Auth-Guard feuert bei Nicht-Admin
- POST upload: MP3 landet in R2, SoundEntry zurück
- POST upload: Non-MP3 → 400
- POST upload: >10MB → 400
- DELETE: Entry aus Manifest entfernt, R2 DeleteObject aufgerufen
- Admin-Page: rendert Kategorien + Sounds
- Admin-Page: Upload-Modal öffnet/schließt
- Admin-Page: Delete-Confirm-Dialog erscheint

Mindest: **+11 neue Tests**

---

## Dateien

| Datei | Aktion |
|---|---|
| `app/admin/sounds/page.tsx` | CREATE — Admin-Seite |
| `app/admin/sounds/UploadModal.tsx` | CREATE — Upload-Modal |
| `app/api/admin/sounds/manifest/route.ts` | CREATE — GET + PUT |
| `app/api/admin/sounds/upload/route.ts` | CREATE — POST |
| `app/api/admin/sounds/[id]/route.ts` | CREATE — DELETE |
| `lib/storage/r2-write.ts` | CREATE oder MODIFY |
| `app/admin/layout.tsx` o.ä. | MODIFY — Navigation: "Sound Library" ergänzen |
| `docs/architecture/sound-library.md` | MODIFY — Admin-Section ergänzen |

---

## Commits

```
feat(admin): /admin/sounds page + category/sound list
feat(admin): upload modal with duration measurement + progress
feat(api): GET+PUT /api/admin/sounds/manifest
feat(api): POST /api/admin/sounds/upload → R2
feat(api): DELETE /api/admin/sounds/:id
feat(storage): putR2Object + deleteR2Object helpers
test(admin): manifest + upload + delete API routes + UI
docs: sound-library admin section
```

8 Commits.

---

## Nicht im Scope (8.7b)

- Bulk-Upload (mehrere MP3 gleichzeitig) → späterer Plan
- Sound-Replacement (bestehenden Sound überschreiben) → späterer Plan
- Sortierung innerhalb Kategorien per Drag-Drop → späterer Plan
- CDN-Invalidierung nach Upload (Cloudflare-Cache-Purge) → falls nötig

---

Rev. 1 — bereit für Architekt-Review
