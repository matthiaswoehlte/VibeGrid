# Architekt-Review — Plan 5.9c: FX-Track Consolidation

✅ **Freigegeben zur Implementierung**

Baseline: 586 Tests, Commit `819b873`. Keine Blocker.

---

## Anmerkungen für CC #1 (kein Blocker, aber beachten)

### A1 — Task 4: Verwirrende Test-Beschreibung

```ts
it('initialTimelineState exposes exactly 4 lanes (image, video, audio? — no, audio is a stub, see Step 2 — image, video, fx, and one fx track)', () => {
```

Der Kommentar im Testnamen widerspricht der Assertion darunter — `audio`
ist eine Lane. Beim Implementieren einfach umbenennen:

```ts
it('initialTimelineState has exactly 4 lanes: image, video, audio, fx', () => {
```

---

### A2 — Task 10: Dritter Test hat leeren Body

```ts
it('clicking FX option calls addTrack("fx")', () => {
  // (Concrete addTrack-spy assertion …)
});
```

Leere Tests zählen als "passing" in Vitest — aber sie testen nichts.
CC #1 muss diesen Test vollständig implementieren, nicht überspringen.
Muster liegt in den bestehenden TopBar-Tests.

---

### A3 — Task 7: `listPluginsByKind` Funktionsname verifizieren

```ts
const plugin = (clip.fxId ? getPlugin(clip.fxId) : undefined)
  ?? listPluginsByKind(pluginKind)[0];
```

Vor Task 7 in `lib/renderer/` prüfen wie die Plugin-Registry-Lookups
tatsächlich heißen. Falls `listPluginsByKind` nicht existiert:
TypeScript zeigt es spätestens beim typecheck-Step. Den korrekten
Funktionsnamen aus dem bestehenden `loop.ts`-Code nehmen.

---

### A4 — Task 3: `tests/fixtures/README.md` fehlt im Step-Plan

KNOWN_LIMITATIONS erwähnt "Document in `tests/fixtures/README.md`
(CREATE if absent) as part of Task 3" — aber kein Step in Task 3
listet das als Aktion. CC #1 soll nach dem Anlegen von
`tests/fixtures/timeline-v5.json` eine mini `tests/fixtures/README.md`
erstellen (3-5 Zeilen: "Diese Fixtures sind frozen snapshots.
Wer das Store-Schema ändert, muss Fixture + Migrations-Tests
aktualisieren.") und in den Task-3-Commit einschließen.

---

## Was besonders gut ist ✅

- **Context-Block** ist mustergültig — Zeilennummern, exakter
  Commit-Hash, der "silent landmine" v4-Append-Hinweis. Verhindert
  genau die Klasse von Fehlern die vorherige Reviews aufgedeckt haben.
- **`plugin-mapping.ts` als Single Source of Truth** — kein
  Cross-Layer-Import mehr von Renderer-Types in UI-Komponenten.
- **Task-2-Stub-Pattern** (FX-Rendering bewusst zwischen Task 2 und 7
  deaktiviert) ist mutig und richtig — erzwingt saubere
  Implementations-Reihenfolge ohne Typecheck-Fehler.
- **`migrate` als exportierte Funktion** — macht die Migrations-Tests
  direkt testbar ohne Store-Initialisierung.
- **Risk-Table** mit 6 Einträgen deckt alle vom Review identifizierten
  Risiken ab, inklusive dem v5-Fixture-Contract.
- **Execution Notes am Ende** — Commit-Disziplin, Smoke-Test-Timing,
  Stop-on-Failure explizit. Das ist anti-drift-Verhalten auf Plan-Ebene.

---

## Verification Gate (Erinnerung)

```powershell
npm run typecheck   # clean
npm run lint        # clean
npm test -- --run   # ≥ 608 Tests (586 + 22), 0 failing
npm run build       # Bundle ≤ Baseline + 2%
```
