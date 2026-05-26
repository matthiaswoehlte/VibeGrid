# CC Feedback — Design Sektion 5: Storage & API Layer

✅ Freigegeben mit folgenden Korrekturen und Ergänzungen:

## Kritische Entscheidung: Deployment-Target jetzt festlegen

Cloudflare Pages + `@cloudflare/next-on-pages` und Vercel sind **nicht austauschbar** —
die Wahl bestimmt wie API Routes und R2-Zugriff implementiert werden.

**Entscheidung: Vercel + R2 als externer S3-kompatibler Store.**

Begründung:
- `@cloudflare/next-on-pages` erzwingt Edge Runtime — `@aws-sdk/client-s3`
  nutzt Node.js APIs die auf Edge Runtime nicht verfügbar sind → Konflikte
- Vercel hat besseres Next.js 14 App Router Debugging (wichtig für v0.1)
- R2 ist S3-kompatibel und funktioniert problemlos als externer Store von Vercel aus
- D1 in v0.1 sowieso nur Schema/Stub → kein Verlust
- Migration zu Cloudflare Pages bleibt jederzeit möglich wenn D1 aktiv wird

API Routes laufen damit auf Node.js Runtime (nicht Edge) — explizit setzen:

```typescript
// app/api/upload/route.ts
export const runtime = 'nodejs';
```

## Bug: @aws-sdk/client-s3 auf Edge Runtime

Falls doch Edge Runtime gewählt wird (z.B. spätere Migration):
`@aws-sdk/client-s3` benötigt dann den Checksum-Fix:

```typescript
const s3 = new S3Client({
  requestChecksumCalculation: 'WHEN_REQUIRED', // pflicht für R2 + Edge
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
});
```

Für Vercel/Node.js Runtime ist das nicht nötig — aber trotzdem einfügen
als Kommentar für spätere Cloudflare-Migration.

## Ergänzung: R2 EU Jurisdiction im Endpoint

Wir haben festgelegt: R2 Bucket mit EU Jurisdiction anlegen.
Das ändert den Endpoint:

```bash
# .env.example — korrigieren:
R2_ENDPOINT=https://${R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com
# nicht: https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
```

Bucket muss in Cloudflare Dashboard mit Jurisdiction: EU angelegt werden.

## Ergänzung: MIME-Typ Validierung server-side

Client-seitige MIME-Validierung reicht nicht. In `/api/upload/route.ts`:

```typescript
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/mp4'];

// Validierung gegen tatsächlichen Magic-Bytes, nicht nur Content-Type Header:
// npm install file-type
import { fileTypeFromBuffer } from 'file-type';
```

## Ergänzung: R2 Key-Struktur

Für spätere Multi-User-Erweiterbarkeit von Anfang an strukturiert:

```
r2_key Format: {userId}/{projectId}/{kind}/{uuid}.{ext}
v0.1 (kein Auth): anonymous/{projectId}/{kind}/{uuid}.{ext}
```

Erleichtert spätere IAM-Policies und Bucket-Cleanup erheblich.

## D1 Schema: params_json Kommentar

```sql
params_json TEXT  -- serialized Record<string, unknown> matching FxPlugin.paramSchema
```

Kommentar hinzufügen damit spätere Migration zu typisiertem JSON-Column klar ist.

## Kleinigkeit: MediaRef.uploadedAt als ISO-String

```typescript
// AKTUELL:
uploadedAt: number;  // Unix timestamp

// BESSER:
uploadedAt: string;  // ISO 8601 — konsistenter mit D1 TEXT-Storage
                     // und leichter debuggbar
```
