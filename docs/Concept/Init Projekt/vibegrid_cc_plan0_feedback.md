# CC Feedback — Plan 0: Scaffold

✅ Freigegeben. Zwei Anmerkungen vor dem Start:

## Anmerkung 1: `data-accent` fehlt im `<html>` Tag

Spec §9 definiert Accent-Themes via `data-accent`-Attribut auf `<html>`.
In Task 4 wird `<html>` mit `dark` + Font-Variablen aufgebaut —
der Accent-Default muss dort mit rein, sonst fehlt er in jedem Plan danach:

```tsx
// app/layout.tsx — Task 4 Step 2 ergänzen:
<html
  lang="en"
  className={`dark ${fontSans.variable} ${fontMono.variable}`}
  data-accent="electric"   // Default-Accent aus Spec §9
>
```

Außerdem in `globals.css` — Task 3 Step 3 — den Accent-Block ergänzen:

```css
/* Default accent (electric) — overridden by data-accent attribute */
:root,
[data-accent="electric"] { --a1: #a86bff; --a2: #5a8fff; --a3: #2ee0d0; }
[data-accent="sunset"]   { --a1: #ff6b6b; --a2: #ff9f5a; --a3: #ffd06b; }
[data-accent="acid"]     { --a1: #b8ff5a; --a2: #5affb8; --a3: #5ab8ff; }
[data-accent="neon"]     { --a1: #ff5af0; --a2: #5af0ff; --a3: #f0ff5a; }
```

Ohne das greift kein Accent-Switching in späteren Plänen ohne Refactor.

## Anmerkung 2: `partialize` in Store-Skeleton zu offen

```ts
// AKTUELL — alles wird persistiert:
partialize: (state) => state

// BESSER — bereits jetzt Actions ausschließen:
partialize: (state) => ({
  ui: state.ui
  // Timeline, mediaRefs etc. werden in ihren Plänen hier ergänzt
  // Actions (set*) NIEMALS persistieren — Zustand-Konvention
})
```

Zustand serialisiert sonst auch die Action-Functions — das produziert
Warnings in der Console und kann bei Rehydration zu unerwartetem
Verhalten führen.

## Bestätigung: Was explizit gut ist ✅

- Test-First bei isClient() — fail first, dann Implementation
- Task 2 Step 4 zeigt bewusst den erwarteten Fehler — sauber
- Granulare Commits pro Task
- Plan 0 auf main, Feature-Branches ab Plan 1 — richtig begründet
- `singleThread: true` bereits gesetzt — Worker-Deadlock verhindert
