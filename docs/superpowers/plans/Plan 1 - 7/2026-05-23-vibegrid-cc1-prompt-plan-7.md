# CC #1 Prompt — Schreibe Plan 7: Supabase Auth + Project Save/Load

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Baseline: aktueller HEAD post-5.8b (**~684 Tests**, Store v6).

Schreibe nur den **Plan** — noch keinen Code.

---

## Was Plan 7 leistet

VibeGrid bekommt persistente Projektspeicherung via Supabase.
User können sich anmelden, Projekte speichern und wieder laden.

---

## Wichtige Rahmenbedingungen

### Bestehende Supabase-Instanz

Es wird **keine neue Supabase-Instanz** aufgemacht — VibeGrid hängt
sich an eine bereits laufende Instanz mit bestehender User- und
Tenancy-Verwaltung.

**Konsequenz:** CC #1 bekommt Zugriff auf die DB und liest die
bestehende Schema-Struktur aus (Users, Tenants, Auth-Tabellen) bevor
er irgendetwas plant. Das Rad wird nicht neu erfunden.

### Tabellen-Präfix: `VG_`

Alle neuen VibeGrid-Objekte in der DB bekommen das Präfix `VG_`:
- Tabellen: `VG_projects`, `VG_project_snapshots`, ...
- Indizes: `VG_idx_...`
- Stored Procedures / Functions: `VG_fn_...`
- RLS Policies: `VG_policy_...`

Zweck: saubere Trennung vom bestehenden Schema, spätere Migration
in eigene Instanz ohne Suche nach VibeGrid-Objekten.

### Bestehende User nutzen

Kein neues Auth-System. VibeGrid nutzt die bestehenden User aus der
Supabase-Instanz. Login mit bestehenden Credentials (Email + Password
oder was die Instanz unterstützt). CC #1 liest aus der DB welche
Auth-Provider aktiv sind.

---

## Schritt 0 — DB-Analyse (vor dem Plan schreiben)

CC #1 verbindet sich mit der Supabase-Instanz und dokumentiert:

1. **Auth-Schema:** Welche Tabellen (`auth.users`, custom user tables)?
   Welche Provider (email, OAuth, ...)?
2. **Tenancy-Struktur:** Wie sind User Tenants zugeordnet?
   Welche Spalten sind relevant für VibeGrid (user_id, tenant_id, ...)?
3. **Bestehende RLS-Patterns:** Wie sichert das Projekt heute Rows ab?
   VibeGrid kopiert dieses Pattern für `VG_projects`.

Erst nach dieser Analyse wird der Plan geschrieben.

---

## Feature 1 — Auth

### Login

VibeGrid zeigt einen Login-Screen wenn kein aktiver Supabase-Session
vorhanden ist. Nach Login: Studio öffnet sich.

```ts
// lib/auth/supabase-client.ts
// createBrowserClient aus @supabase/ssr
// Session-Management via Supabase Auth Helpers
```

Login-UI: minimaler Screen mit Email + Password (oder OAuth-Button
falls in der Instanz aktiv). Kein Signup-Flow in v0.1 —
nur bestehende User können sich einloggen.

### Session-Handling

- Session wird im Cookie gespeichert (Supabase Auth Helpers Standard)
- Next.js Middleware prüft Session auf der `/studio`-Route
- Kein Studio-Zugriff ohne gültige Session
- Logout-Button in der TopBar

### `.env.local` (Matthias bereitet vor)

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # nur server-side, nie im Client
```

`import 'server-only'` auf allen Modulen die `SERVICE_ROLE_KEY` lesen.

---

## Feature 2 — Project Save/Load

### Datenmodell

```sql
-- Präfix VG_ auf allem
CREATE TABLE VG_projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Untitled Project',
  state       JSONB NOT NULL,          -- kompletter Zustand-Store als JSON
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX VG_idx_projects_user_id ON VG_projects(user_id);

-- RLS: User sieht nur seine eigenen Projekte
ALTER TABLE VG_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY VG_policy_projects_select ON VG_projects
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY VG_policy_projects_insert ON VG_projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY VG_policy_projects_update ON VG_projects
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY VG_policy_projects_delete ON VG_projects
  FOR DELETE USING (auth.uid() = user_id);
```

### State-Serialisierung

Der komplette Zustand-Store (`useAppStore.getState()`) wird als JSONB
gespeichert. R2-Asset-URLs bleiben als Strings erhalten — keine Blobs
in der DB.

```ts
// lib/project/save.ts
async function saveProject(name: string): Promise<void> {
  const state = useAppStore.getState();
  const serialized = serializeState(state); // MediaRef-Blobs → URLs
  await supabase.from('VG_projects').upsert({ name, state: serialized });
}
```

### State-Deserialisierung

Beim Laden: JSONB aus DB → Store hydratisieren → Assets von R2 laden.

```ts
// lib/project/load.ts
async function loadProject(projectId: string): Promise<void> {
  const { data } = await supabase
    .from('VG_projects')
    .select('state')
    .eq('id', projectId)
    .single();
  useAppStore.setState(deserializeState(data.state));
}
```

### Projekt-Liste

Einfache Projekt-Liste im Studio (Modal oder Side-Panel):
- Alle Projekte des Users (`SELECT * FROM VG_projects ORDER BY updated_at DESC`)
- Klick → laden
- Rename inline
- Delete mit Bestätigung

### Auto-Save

Optional aber sinnvoll: Auto-Save alle 30 Sekunden wenn Projekt
bereits gespeichert ist (hat eine `id`). Neues Projekt: nur manuell.

```ts
// lib/hooks/useAutoSave.ts
// debounced, nur wenn projectId !== null
// kein Auto-Save für neue unsaved Projekte
```

---

## File Map (Entwurf — CC #1 ergänzt nach DB-Analyse)

| Datei | Aktion |
|---|---|
| `lib/auth/supabase-client.ts` | Create — Browser-Client |
| `lib/auth/supabase-server.ts` | Create — Server-Client (service role) |
| `middleware.ts` | Create/Modify — Session-Check auf /studio |
| `app/(auth)/login/page.tsx` | Create — Login-Screen |
| `lib/project/save.ts` | Create — serializeState + upsert |
| `lib/project/load.ts` | Create — fetch + deserializeState |
| `lib/project/types.ts` | Create — ProjectRecord Type |
| `lib/hooks/useAutoSave.ts` | Create — debounced Auto-Save |
| `components/Studio/ProjectList.tsx` | Create — Modal mit Projekt-Liste |
| `components/TopBar/index.tsx` | Modify — Logout + Save + ProjectName |
| `supabase/migrations/001_VG_projects.sql` | Create — Tabelle + RLS |
| `docs/KNOWN_LIMITATIONS.md` | Modify — Plan 7 Eintrag |

---

## Wichtige Architektur-Entscheidungen

**Blobs niemals in DB:** R2-URLs als Strings, nie ArrayBuffer oder
base64 in JSONB. Das gilt für Audio, Video und Bilder.

**Store-Version mitschreiben:** `state.version` (aktuell v6) wird im
JSONB mitgespeichert. Beim Laden: Migrations-Chain laufen lassen bevor
`setState`. Neue Projekte die mit einer älteren Store-Version gespeichert
wurden laufen damit durch die bestehenden Migrations.

**Service Role Key nur server-side:** Admin-Operationen (falls nötig)
nur in API-Routes mit `import 'server-only'`. Client nutzt nur den
Anon-Key mit RLS.

**Tenancy:** CC #1 klärt nach DB-Analyse ob VibeGrid-Projekte an
`user_id` oder `tenant_id` hängen sollen. Default: `user_id` —
ein User, seine Projekte. Tenant-Sharing ist v0.2.

---

## Tests

**`tests/unit/project/save-load.test.ts`** — ≥ 5:
- `serializeState` entfernt Blob-URLs, behält String-URLs
- `deserializeState` hydratisiert Store korrekt
- Store-Version wird mitgeschrieben
- Migration läuft beim Laden älterer Versionen
- Leerer State ergibt valides serialisiertes Objekt

**`tests/unit/hooks/useAutoSave.test.ts`** — ≥ 3:
- Kein Auto-Save wenn `projectId === null`
- Auto-Save nach Debounce wenn `projectId` gesetzt
- Kein doppelter Save bei schnellen Store-Änderungen

**`tests/unit/auth/session.test.ts`** — ≥ 2:
- Middleware redirectet auf `/login` ohne Session
- Middleware lässt `/studio` durch mit gültiger Session

Mindest: **≥ 10 neue Tests**

---

## Verification Gate

Baseline: **~684 Tests**, 0 failing.
Ziel: **≥ 694 Tests**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Pflicht: Manuelle Smoke-Tests:**
```
# Login-Screen erscheint ohne Session
# Bestehender User kann sich einloggen
# Projekt speichern → in Supabase DB sichtbar (Studio → Table Editor)
# Browser reload → Projekt laden → State identisch
# Auto-Save: Änderung machen → 30s warten → DB-Eintrag updated_at aktuell
# Logout → Login-Screen
# Anderer User sieht nicht die Projekte des ersten Users (RLS)
```

---

## Commit-Struktur

```
feat(auth): Supabase browser + server client setup
feat(auth): middleware session guard for /studio
feat(auth): login page — email/password
feat(project): VG_projects migration — table + RLS policies
feat(project): serializeState + deserializeState
feat(project): saveProject + loadProject
feat(project): ProjectList modal
feat(topbar): Logout + Save button + project name display
feat(hooks): useAutoSave — debounced 30s
docs: KNOWN_LIMITATIONS — Plan 7 auth + project persistence
test: save-load + auto-save + session guard
```

---

## Out of Scope

- Signup / Registrierung (nur bestehende User in v0.1)
- Tenant-Sharing / Kollaboration (v0.2)
- Projekt-Duplikation (v0.2)
- Asset-Transfer zwischen Projekten (v0.2)
- Offline-First / Konflikt-Resolution (v0.2)
- OAuth-Provider (v0.2, falls nicht bereits in Instanz aktiv)

Abgabe: `2026-05-23-vibegrid-plan-7-supabase-auth-project-save.md`
