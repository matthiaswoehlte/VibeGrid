# CC Feedback — Plan 4: Storage & API Layer

❌ **Nicht freigegeben** — 3 kritische Bugs müssen gefixt werden, dann direkt freigegeben.

---

## Kritische Bugs (MUSS gefixt werden)

### Bug 1 — `vi.hoisted()` fehlt im Integration-Test → TDZ-Crash

**Datei:** `tests/integration/upload.api.test.ts`

**Problem:** Vitest hoist `vi.mock()`-Aufrufe statisch an den Dateianfang. `sendMock`
ist mit `const` deklariert und befindet sich zum Zeitpunkt der Factory-Ausführung im
Temporal Dead Zone. Das ergibt einen `ReferenceError: Cannot access 'sendMock' before
initialization`.

**Fehlerhafter Code:**
```ts
const sendMock = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })), // ← TDZ!
  ...
}));
```

**Fix:**
```ts
const sendMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: vi.fn().mockImplementation((args: unknown) => ({ __cmd: 'put', args }))
}));
```

`vi.hoisted()` ist die offizielle Vitest-API genau für dieses Problem — Variablen die
sowohl außerhalb als auch innerhalb einer `vi.mock()`-Factory benötigt werden.

---

### Bug 2 — `server-only` Package fehlt auf `r2-client.ts` + `env.ts` → Credentials können in den Client-Bundle gelangen

**Dateien:** `lib/storage/r2-client.ts`, `lib/storage/env.ts`

**Problem:** Beide Module lesen oder verwenden R2-Credentials. Sie liegen in `lib/`
(nicht in `app/api/`), wo Next.js keine automatische Server-Grenze setzt. Wenn ein
Entwickler in Plan 5 versehentlich `import { getR2Config } from '@/lib/storage/env'`
in eine Client-Komponente tippt, bundlet Next.js `@aws-sdk/client-s3` (~600 KB) in
den Browser-Bundle. Die Env-Vars selbst bleiben leer (kein `NEXT_PUBLIC_`-Prefix),
aber das AWS SDK landet im Client.

Der Plan dokumentiert die Grenze als "Convention" — das ist schwache Durchsetzung.
Next.js bietet ein hardcoded Build-Error-Tool dafür.

**Fix:** Je eine Zeile oben in beide Dateien:
```ts
import 'server-only';
```

Wenn ein Client-Bundle-Import versucht wird, bricht `next build` sofort ab.
`server-only` ist ein offizielles Next.js-Paket, keine externe Dependency:
```bash
npm install server-only
```

---

### Bug 3 — WAV MIME-Typ Mismatch: `file-type` gibt nicht `audio/wav` zurück

**Dateien:** `lib/storage/types.ts` (MIME_WHITELIST), `tests/unit/storage/mime-validator.test.ts`

**Problem:** `file-type` v19 erkennt WAV-Dateien anhand des RIFF/WAVE-Headers und
gibt als MIME-Typ `audio/vnd.wave` zurück — nicht `audio/wav`. Die MIME_WHITELIST hat
`'audio/wav'` und der Test erwartet `r.mime === 'audio/wav'`. Resultat: jeder WAV-Upload
schlägt mit `UNSUPPORTED_MIME` fehl und der Test schlägt mit einer Assertion fehl.

**Fix A — Whitelist erweitern (empfohlen, WAV hat historisch viele MIME-Aliase):**
```ts
audio: ['audio/mpeg', 'audio/wav', 'audio/vnd.wave', 'audio/x-wav', 'audio/mp4'] as const
```

**Fix B — Normalisierung nach Detection:**
```ts
const MIME_NORMALIZE: Record<string, string> = {
  'audio/vnd.wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
};
const normalizedMime = MIME_NORMALIZE[detected.mime] ?? detected.mime;
```

**Fix für den Test:** WAV-Assertion gegen die tatsächliche file-type-Ausgabe prüfen.
Die sicherste Variante ist Fix A + den Test so schreiben:
```ts
it('accepts WAV', async () => {
  const r = await validateUpload(wavBytes(), 'audio');
  expect(['audio/wav', 'audio/vnd.wave', 'audio/x-wav']).toContain(r.mime);
});
```

**Empfehlung:** Nach dem `npm install` kurz verifizieren was `file-type@19.5.0` für
den `wavBytes()`-Fixture tatsächlich zurückgibt — das ist die definitive Quelle, nicht
die Spec-Whitelist.

---

## Anmerkungen

### A1 — `require` Funktionsname in `env.ts` → umbenennen

`function require(name: string)` shadowed zwar in ESM kein Node-Global, aber
`@types/node` deklariert `require` als globalen Typ — TypeScript-Tools und ESLint
könnten warnen. Klarer und konventionskonform: `requireEnv` oder `getRequired`.

---

### A2 — `inspectorOpen` wird persistiert — Watchlist-Item für Plan 5

Watchlist und Spec §9.5 sagen explizit: `inspectorOpen` als lokaler UI-State (nicht
Store). Plan 4 modifiziert `index.ts` und übernimmt `ui: state.ui` in `partialize` —
damit landet `inspectorOpen` in localStorage. Das ist kein Plan-4-Bug (es war
vermutlich schon so von Plan 0), aber Plan 5 muss das korrigieren:
`inspectorOpen` aus `UIState`/`AppState` entfernen und als `useState` in der
`Workspace`-Komponente halten.

---

### A3 — `file-type` ESM-only: Vitest-Config möglicherweise unvollständig

Der Plan erwähnt das ESM-Problem für `next build` (korrekt), aber nicht für Vitest.
Wenn `vitest.config.ts` aus Plan 0 kein `ssr: { noExternal: ['file-type'] }` oder
äquivalentes Setting hat, kann der jsdom-Testlauf mit einem "ERR_REQUIRE_ESM" crashen.

CC #1 soll das nach dem Install prüfen:
```bash
npm test -- mime-validator
```
Falls ERR_REQUIRE_ESM: in `vitest.config.ts` ergänzen:
```ts
ssr: {
  noExternal: ['file-type']
}
```

---

### A4 — Route Handler gibt keine `width`/`height`/`duration` zurück

`MediaRef` hat optionale `width`, `height` (Image), `duration` (Audio). Der Handler
gibt diese nie. Das ist für v0.1 akzeptabel (Felder sind optional, der Renderer nutzt
Canvas-Dimensionen), aber Plan 5 braucht für Thumbnails in der MediaLibrary
möglicherweise `width`/`height`. Falls ja, muss das in Plan 5 entweder:
(a) server-seitig via `sharp` in der Route extrahiert werden, oder
(b) client-seitig nach dem Upload via `Image`-Element gemessen und per
    `mediaActions.addMediaRef(...)` nachgepflegt werden.

Explizit entscheiden und in Plan 5 aufnehmen.

---

### A5 — r2-adapter UUID-Test prüft nur Uniqueness, nicht UUID v4 Format

```ts
expect(id1.get('id')).not.toBe(id2.get('id'));
```

Testname sagt "generates a UUID v4 id per call" — der Test prüft aber nur, dass zwei
IDs verschieden sind. Robuster wäre:
```ts
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
expect(UUID_V4_RE.test(id1.get('id') as string)).toBe(true);
```
Kein Blocker — aber der Test-Name und der Test-Inhalt stimmen nicht überein.

---

## Antworten auf die Open Questions

**OQ1 — AWS SDK Bundle-Größe (~600 KB):**
Akzeptabel. Server-only Route, nie im Client-Bundle. Bleibt SDK.

**OQ2 — Upload-Progress via XHR:**
Defer auf v0.2 bestätigt. "uploading… / done" in Plan 5 ist ausreichend für v0.1.

**OQ3 — Client-generierte UUID:**
Akzeptabel für v0.1 (kein Auth, kein Multi-User). Das Risiko eines Key-Overwrites ist
dokumentiert — kein Blocker. In v0.2 mit Auth den `userId`-Scope als natürlichen Guard
verwenden.

**OQ4 — Vercel Hobby-Tier 4,5 MB Limit:**
In `KNOWN_LIMITATIONS.md` dokumentieren, nicht blocken. Formulierungsvorschlag:
> Audio-Uploads bis 50 MB erfordern Vercel Pro (Hobby-Tier: max 4,5 MB Payload).
> Für Entwicklung lokalen Upload-Proxy verwenden oder direkt auf Pro deployen.

**OQ5 — `requestChecksumCalculation: 'WHEN_REQUIRED'`:**
Spec §7.1 schreibt es vor. SDK v3.658 kennt die Option — in der TypeScript-Signatur
von `S3ClientConfig` nachsehen. Falls TS-Fehler: Option entfernen und Kommentar setzen:
```ts
// requestChecksumCalculation: 'WHEN_REQUIRED'
// Spec §7.1 — forward-compat für Cloudflare Pages Migration.
// SDK v3.658: Option nicht verfügbar, wird in v0.2 erneut geprüft.
```

**OQ6 — R2 Public URL:**
Annahme korrekt: `R2_PUBLIC_URL` muss auf eine eigene Custom Domain oder Cloudflare
CDN-Domain zeigen — R2 selbst serviert nicht über HTTPS ohne Custom Domain. Das ist
eine Betreiber-Anforderung, kein Code-Bug. In `README.md` oder `KNOWN_LIMITATIONS.md`
dokumentieren:
> R2_PUBLIC_URL muss eine Custom Domain mit aktivem Cloudflare-Proxy sein.

Signed-URL-Flow ist kein Plan-4-Scope — wird erst relevant wenn Buckets private werden.

**OQ7 — `/api/projects` GET Filter-Parameter:**
Stub-Shape ist ausreichend. `{ projects: [] }` lässt Raum für `?userId=...` Query-Params
in v0.2, ohne den Contract zu brechen.

---

## Was gut ist ✅

- **Architektur sauber:** Drei Schichten (Pure Helpers / Server Runtime / Client Adapter)
  sind klar getrennt. Kein Client-Import von Server-Modulen in der aktuellen Implementierung.
- **Magic-Byte Only:** Kein Vertrauen in den `Content-Type`-Header — richtig.
- **Size-Check vor Detection:** Billiger als `file-type` auf einem 50-MB-Buffer — gut.
- **`_resetR2ConfigForTests()` + `_resetR2ClientForTests()`:** Test-Isolation sauber
  gelöst ohne Modul-Reload-Tricks.
- **Key-Builder mit `assertSafeSegment`:** Path-Traversal-Schutz vorhanden,
  saubere Fehler-Messages.
- **Lazy `getR2Config()`:** Env-Fehler erst bei Request-Time, nicht Build-Time.
- **`partialize` schließt korrekt Blobs aus:** `media: state.media` persistiert nur
  `MediaRef[]` mit URL-Strings — kein `AudioBuffer`, kein `Blob`. Non-Negotiable Rule #2 ✅.
- **D1-Schema und `.env.example`:** Spec §7.2/7.3 verbatim, sauber vorbereitet.
- **Test-Count realistisch:** ≥165 nach Plan 4 bei korrektem Fix von Bug 1+3 erreichbar.
- **Commit-Granularität:** Jeder Task = ein Commit, Typen stimmen. ✅

---

## Fix-Summary für CC #1

| Bug | Datei(en) | Aufwand |
|---|---|---|
| Bug 1: `vi.hoisted()` | `tests/integration/upload.api.test.ts` | 2 Zeilen |
| Bug 2: `server-only` | `lib/storage/r2-client.ts`, `lib/storage/env.ts` | 1 Zeile + `npm install server-only` |
| Bug 3: WAV MIME | `lib/storage/types.ts` MIME_WHITELIST + `mime-validator.test.ts` | 3-5 Zeilen |

Nach den 3 Fixes + grüner Verification Gate: Plan 5 kann starten.
