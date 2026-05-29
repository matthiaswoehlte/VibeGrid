# Architekt-Entscheidung — Plan 8.7b: Sound Library Admin
### Nach CC #1 Pre-Review

❌ Nicht freigegeben — Rev. 2 erforderlich.
CC #1 schreibt Rev. 2 direkt auf Basis dieser Entscheidungen.

---

## B1 — Auth-Pattern: requireAdminApi

Alle 4 API-Route-Snippets ersetzen:

```ts
import { requireAdminApi } from '@/lib/auth/admin-guard'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const guard = await requireAdminApi(req)
  if ('response' in guard) return guard.response  // 401/403
  // ... echter Handler
}
```

Admin-Page: `requireAdminPage()` (ohne args) — laut Plan-8.6-Pattern.

---

## B2 — R2-Helper: r2-client.ts MODIFY (kein neues r2-write.ts)

```
lib/storage/r2-client.ts MODIFY:
- putToR2: optionales cacheControl-Argument ergänzen
- deleteFromR2(key: string): Promise<void> ergänzen
- Body bleibt Uint8Array: new Uint8Array(await file.arrayBuffer())
- getR2Config() returnt bucket (nicht bucketName)
```

Kein neues `r2-write.ts`.

---

## B3 — Sequencing

Header korrigieren:
```
Abhängigkeit: Plan 8.7 vollständig implementiert (nicht nur freigegeben).
CC #1 startet 8.7b erst nach 8.7-Shipping.
```

8.7 + 8.7b können als Bundle geshipped werden wenn Admin-Tooling
für initiale Sound-Befüllung nötig ist — das entscheidet Matthias.

---

## B4 — Cache-Invalidation: revalidatePath (Pflicht)

Jede schreibende Route endet mit:

```ts
import { revalidatePath } from 'next/cache'
// nach R2-Write:
revalidatePath('/api/sounds/manifest')
```

Betrifft: POST upload, DELETE. GET/PUT manifest bekommt es auch.
Ein eigener Test für revalidatePath-Call ist Pflicht.

---

## B5 — Admin-Navigation

```
File Map: components/Admin/AdminShell.tsx MODIFY
          (nicht app/admin/layout.tsx)
```

---

## F — Upload-Flow: ein atomarer Endpoint

POST /api/admin/sounds/upload macht beides:
1. R2 PUT MP3
2. Manifest lesen + neuen Entry mergen + R2 PUT Manifest (version++)
3. revalidatePath
4. Returns SoundEntry + neue manifest.version

Separater PUT /api/admin/sounds/manifest bleibt für
Metadaten-Edits (Label/Tags/License/BPM) und Kategorie-Umbenennen.

---

## G — Metadaten-Edit in Scope (W13)

Edit-Button pro Sound → Upload-Modal in „Edit-Mode":
- File-Picker disabled
- Felder ausgefüllt
- Submit → PUT manifest mit geänderten Feldern

Eine Komponente, zwei Modi. In Scope für 8.7b.

---

## W6 — Delete-Order: Manifest-First

```
1. Manifest ohne Entry schreiben (version++)
2. R2 DeleteObject
Bei Schritt-2-Fail: Orphan-MP3 in R2 (Storage-Müll, kein UX-Schaden)
```

Nicht R2-first (würde Ghost-Entry im Manifest + User-404 erzeugen).

---

## W9 — Slug-Collision: UUID-Suffix

```ts
const id = `${slug}-${crypto.randomUUID().slice(0, 8)}`
```

---

## W10 — MIME-Check statt Extension

```ts
if (file.type !== 'audio/mpeg') return 400
```

Primärcheck auf Content-Type, nicht Extension.

---

## W11 — category.id ist immutable

`category.id` wird einmalig beim Anlegen gesetzt und nie geändert.
Nur `category.label` ist editierbar. Damit ist Umbenennung
ein einfacher Manifest-PUT ohne R2-File-Moves.

---

## W12 — AudioContext Singleton im Modal

```ts
let _audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext()
  }
  return _audioCtx
}
```

Kein neuer AudioContext pro Upload. isClient()-Guard nicht nötig
in 'use client'-Komponente, aber nur in User-Gesture-Path aufrufen.

---

## W8 — Race-Condition dokumentieren (kein Fix)

Concurrent Admin-Writes → last-writer-wins. Für v0.1 dokumentiert
als KNOWN_LIMITATIONS-Eintrag. Kein Optimistic-Lock in diesem Plan.

---

## D16 — Admin-UI ist Browser-only

Explizit im Plan: „Admin-UI ist Browser-only — kein Capacitor-Target."

---

## Test-Ergänzungen

Mindest von +11 auf **+16 neue Tests**:
- revalidatePath-Call nach jedem schreibenden Endpoint
- requireAdminApi-Guard: Nicht-Admin → 401 (alle Routes)
- Upload+Manifest atomic: MP3 in R2 + Manifest aktualisiert
- DELETE: Manifest-First-Order verifiziert
- Edit-Mode: PUT manifest mit geänderten Feldern

---

## Checkliste Rev. 2

- [ ] B1: requireAdminApi + 'response' in guard + runtime = 'nodejs' überall
- [ ] B2: r2-client.ts MODIFY, kein r2-write.ts
- [ ] B3: Sequencing-Header korrigiert
- [ ] B4: revalidatePath nach jedem schreibenden Endpoint
- [ ] B5: AdminShell.tsx in File Map
- [ ] F: Upload-Flow atomar (POST macht MP3 + Manifest)
- [ ] G: Edit-Mode im Upload-Modal
- [ ] W6: Delete-Order Manifest-First
- [ ] W9: UUID-Suffix statt Date.now()
- [ ] W10: MIME-Check statt Extension-Check
- [ ] W11: category.id immutable dokumentiert
- [ ] W12: AudioContext-Singleton
- [ ] W8: Race-Condition in KNOWN_LIMITATIONS
- [ ] D16: Browser-only explizit

---

Architekt-Entscheidung — 2026-05-28
