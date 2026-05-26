# CC Feedback — Plan 7: Better-Auth Login + VG_projects Save/Load

❌ Nicht freigegeben — 1 kritischer Architektur-Bug muss gefixt werden

---

## Kritische Bugs (MUSS gefixt werden)

### Bug 1 — Middleware läuft in Edge Runtime, `pg.Pool` explodiert

**Wo:** `middleware.ts` Task 4, Step 3 + `export const runtime = 'nodejs'`

**Problem:**

Next.js 14 Middleware läuft **ausschließlich im Edge Runtime**. Das
`export const runtime = 'nodejs'` in `middleware.ts` ist in Next.js 14
**kein offiziell unterstütztes Feature** — es existiert nur als experimentelle
Option hinter `experimental.nodeMiddleware: true` in `next.config.js`.
Ohne diesen Flag wird der Export einfach ignoriert.

Was passiert ohne Fix auf Vercel:

```
Error: The edge runtime does not support Node.js 'net' module.
```

Weil `middleware.ts` → `better-auth-server.ts` → `lib/db/pg.ts` → `pg`
importiert, und `pg` Node.js `net`/`tls` braucht — Edge kann das nicht.

**Fix (zwei Optionen — CC #1 wählt eine):**

**Option A (empfohlen): Lightweight Cookie-Check in Middleware**

Middleware prüft nur ob die Session-Cookie *existiert und nicht abgelaufen ist*,
ohne DB-Roundtrip. Die vollständige Validierung passiert in den API-Routes.

```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const sessionCookie =
    req.cookies.get('vibegrid.session_token') ??
    req.cookies.get('vibegrid.session_token.0');   // Better-Auth chunked cookies

  if (!sessionCookie?.value) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('from', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/studio/:path*'] };
// KEIN runtime = 'nodejs' — Edge ist hier korrekt
```

Der API-Route-Handler validiert dann die echte Session (mit `pg`):
`auth.api.getSession({ headers })` → bei ungültiger Session → 401.
Der Studio-Client fängt ein 401 ab und redirectet auf `/login`.
Security-Konsequenz: Middleware blockt keine ungültigen aber noch nicht
abgelaufenen Tokens (Cookie-Expiry liegt bei 7 Tagen per Plan). Das ist
für v0.1 akzeptabel — echte Authz liegt in den API-Routes.

**Option B (falls Node-Middleware gewünscht): experimentelles Flag**

```js
// next.config.js
const nextConfig = {
  experimental: {
    nodeMiddleware: true   // Next.js 14.1+, Vercel unterstützt es
  }
};
```

Dann funktioniert `export const runtime = 'nodejs'` in `middleware.ts`
und der Plan läuft unverändert. Risiko: experimentelles Feature, könnte
sich in Next.js 15 ändern. CC #1 prüft die installierte Next.js-Version
und ob das Flag existiert.

**Empfehlung: Option A** — kein experimentelles Flag, klar trennbar,
zukunftssicher. Option B wenn CC #1 beim Testen merkt dass Better-Auth's
`getSession` tatsächlich Edge-kompatibel ist (z.B. wenn es intern kein `pg`
braucht sondern nur das Cookie-HMAC prüft — dann wäre es noch einfacher).

---

## Anmerkungen (kein Blocker, aber sollte verbessert werden)

### Anmerkung 1 — `updateProject` dynamisches SQL ist fehleranfällig

**Wo:** `lib/project/db.ts` Task 9, `updateProject`-Funktion

Das Template-Literal mit variablen `$N`-Positionen:

```ts
`UPDATE "VG_projects" SET state = $1, store_version = $2${name ? ', name = $3' : ''}
 WHERE id = $${name ? '4' : '3'} AND user_id = $${name ? '5' : '4'}`
```

Ist korrekt aber schwer zu lesen, schwer zu reviewen, und der kombinierte
Branch (name + serialized zusammen) ist in den Tests nicht abgedeckt.

**Fix — simplifizieren:**

```ts
export async function updateProject(args: { ... }): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;

  if (args.patch.serialized) {
    sets.push(`state = $${n++}`, `store_version = $${n++}`);
    vals.push(args.patch.serialized.state, args.patch.serialized.store_version);
  }
  if (args.patch.name !== undefined) {
    sets.push(`name = $${n++}`);
    vals.push(args.patch.name);
  }
  if (sets.length === 0) return false;

  vals.push(args.projectId, args.userId);
  const { rowCount } = await pool.query(
    `UPDATE "VG_projects" SET ${sets.join(', ')} WHERE id = $${n++} AND user_id = $${n}`,
    vals
  );
  return (rowCount ?? 0) > 0;
}
```

Und den kombinierten Branch (name + serialized) in `db.test.ts` testen.

### Anmerkung 2 — `del()` in `ProjectListDrawer` schluckt Fehler ohne Feedback

**Wo:** `ProjectListDrawer.tsx`, `del()`-Funktion

```ts
async function del(id: string) {
  if (!confirm('Projekt wirklich löschen?')) return;
  await apiDeleteProject(id);   // ← kein .catch(), kein Toast
  setList(...)
}
```

Wenn der API-Call fehlschlägt, wird die Liste trotzdem lokal aktualisiert.
User glaubt das Projekt sei gelöscht, lädt die Seite neu — Projekt ist noch
da. Kleiner Fix:

```ts
  await apiDeleteProject(id).catch((e) => { toast.error('Löschen fehlgeschlagen'); throw e; });
```

### Anmerkung 3 — `pg.test.ts` Cache-Busting via `?fresh=` funktioniert nicht

**Wo:** Task 1, Test für "throws if DATABASE_URL is missing":

```ts
await expect(import('@/lib/db/pg?fresh=' + Date.now())).rejects.toThrow(...)
```

Vitest cached Module auf Basis des Pfads ohne Query-String. Der `?fresh=`-
Trick funktioniert hier nicht zuverlässig — Vitest behandelt
`@/lib/db/pg?fresh=123` womöglich als anderen Modul-Pfad, oder als
denselben, je nach Resolver-Version.

**Fix:** Den Test vereinfachen — der Singleton-Test (a === b) ist der
wertvolle, das Error-Throwing kann via explizites Modul-Reset getestet oder
einfach als Integration-Concern akzeptiert werden. Den fragilen zweiten
Test-Case streichen oder mit `vi.resetModules()` / `vi.isolateModules()`
lösen:

```ts
it('throws if DATABASE_URL is missing', async () => {
  const orig = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  await expect(vi.isolateModules(() => import('@/lib/db/pg'))).rejects.toThrow(/DATABASE_URL/);
  process.env.DATABASE_URL = orig;
});
```

### Anmerkung 4 — `useAutoSave` wird nach Tab-Close nie geflusht (KNOWN_LIMITATIONS)

Plan dokumentiert das korrekt als v0.2-Item. Optional aber billig für v0.1:
einen `beforeunload`-Handler in `useAutoSave` hinzufügen der den pending
Timer synchron flusht:

```ts
useEffect(() => {
  function onUnload() {
    const projectId = useCurrentProject.getState().projectId;
    if (!projectId) return;
    // sync fire — navigator.sendBeacon wäre ideal aber braucht
    // einen Endpunkt der PATCH verarbeitet. Für jetzt: ignorieren.
  }
  window.addEventListener('beforeunload', onUnload);
  return () => window.removeEventListener('beforeunload', onUnload);
}, []);
```

`sendBeacon` für einen PATCH-Endpunkt ist komplex — Task für v0.2 bleibt
korrekt. Einfach in KNOWN_LIMITATIONS dokumentiert lassen.

---

## Was gut ist ✅

**DB-Analyse ist ausgezeichnet.** Better-Auth statt Supabase Auth zu erkennen,
die `TEXT user_id`, die Permission-Denied-Falle bei `"user"`-Tabellen über
PostgREST — all das ist echte investigative Arbeit und hat das Design
fundamental beeinflusst. Ohne diese Analyse wäre Plan 7 mit falschen UUIDs
und kaputten RLS-Policies implementiert worden.

**Defense-in-Depth ist richtig umgesetzt.** `REVOKE ALL FROM anon, authenticated`
+ RLS `USING (false)` als zweite Schicht ist Belt-and-Suspenders. Genau so.

**`cookiePrefix: 'vibegrid'`** — verhindert Cookie-Kollision mit bestehende Session
auf gleicher Domain. Kleine Zeile, große Wirkung.

**`toPersistedShape` + `migrate`-Reuse** — statt Copy-Paste der Persist-Logik
in den Save-Pfad. `STORE_VERSION` als exportierte Konstante macht future Bumps
sicher (TypeScript warnt wenn Import-Site nicht aktualisiert wird).

**`useCurrentProject` als separate Zustand-Instanz** (nicht in `useAppStore`) —
correct. Project-ID ist Session-Lokal und darf nicht in den serialisierten
Store-Content einlaufen.

**`store_version` als separate Spalte in DB** (nicht nur im JSONB) — smart.
Ermöglicht SQL-Queries wie `WHERE store_version < 6` ohne JSONB zu parsen.

**`globalThis.__vgPgPool`-Singleton** — HMR in Next.js Dev würde sonst
pro Hot-Reload einen neuen Pool spawnen. Häufiger Fehler, korrekt gelöst.

**15 granulare Commits** mit Single-Concern — genau wie Non-Negotiables verlangen.

**Alle `'server-only'`-Imports** auf `pg.ts`, `better-auth-server.ts`,
`project/db.ts` — konsequent.

---

## Fix-Zusammenfassung für CC #1

| # | Priorität | Datei | Änderung |
|---|---|---|---|
| 1 | 🔴 KRITISCH | `middleware.ts` | Edge-kompatibel machen — entweder Option A (Cookie-Check ohne pg) oder Option B (experimentelles Flag + Test) |
| 2 | 🟡 SOLLTE | `lib/project/db.ts` | `updateProject` SQL via SET-Builder vereinfachen + kombinierter Branch testen |
| 3 | 🟡 SOLLTE | `ProjectListDrawer.tsx` | `del()` Fehler-Toast hinzufügen |
| 4 | 🟢 KANN | `tests/unit/db/pg.test.ts` | Cache-Bust-Test mit `vi.isolateModules` oder streichen |

Nach Fix von #1 ist der Plan freigegeben.
