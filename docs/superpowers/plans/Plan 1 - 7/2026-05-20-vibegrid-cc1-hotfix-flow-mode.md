# CC #1 Prompt — Hotfix: Flow Mode Toggle

## Kontext

Baseline: aktueller HEAD nach Plan-6-Fixes. Alle Gates grün.

Kein separater Plan — das ist ein gezielter Hotfix mit 1 Store-Feld,
1 Renderer-Änderung, 1 TopBar-Button. Direkt committen.

---

## Was zu bauen ist

Ein globaler Toggle in der TopBar: **Beat Mode ↔ Flow Mode**

- **Beat Mode (default):** FX feuern beat-synchron — harter Rhythmus, heute's Verhalten
- **Flow Mode:** `resolveParam` ignoriert Beat-Positionen, interpoliert
  kontinuierlich über die Clip-Länge — alles soft und übergangslos

---

## Schritt 1 — Store

In `lib/store/types.ts`, `UIState` ergänzen:
```ts
flowMode: boolean;  // default: false — transient, nie persisted
```

In `lib/store/index.ts`:
```ts
// UI-Literal:
flowMode: false,

// Action neben setAutomationSnap:
setFlowMode: (v: boolean) => set((s) => ({ ui: { ...s.ui, flowMode: v } })),
```

In `AppState` (types.ts):
```ts
setFlowMode(value: boolean): void;
```

`flowMode` darf **nie** in `partialize` landen.

Alle `ui: { ... }` Literale in Tests + `ClearProjectButton` um
`flowMode: false` erweitern — TypeScript strict zeigt jeden Miss.

---

## Schritt 2 — `resolveParam` anpassen

**Datei:** `lib/renderer/` (wo `resolveParam` / `interpolate` aufgerufen wird)

Heute:
```ts
return interpolate(points, beat, interpolation);
```

Neu — `flowMode` als Parameter übergeben:
```ts
export function resolveParam<T>(
  param: StaticOrAuto<T>,
  beat: number,
  clipLengthBeats: number,
  flowMode: boolean
): T {
  if (param.mode === 'static') return param.value;
  const t = flowMode
    ? (beat / clipLengthBeats) * (points[points.length - 1].beat)
    : beat;
  return interpolate(param.points, t, param.interpolation);
}
```

Der Renderer liest `flowMode` aus dem Store und gibt ihn durch:
```ts
const flowMode = useAppStore.getState().ui.flowMode;
// ... pro FX-Draw-Call:
resolveParam(param, currentBeat, clip.lengthBeats, flowMode);
```

**Wichtig:** `interpolation: 'step'` bleibt in Flow Mode erhalten —
wer Step gewählt hat, bekommt weiterhin harte Sprünge, nur nicht
mehr beat-getriggert sondern zeitbasiert. Das ist korrekt.

---

## Schritt 3 — FX Plugins (Pulse, ZoomPulse, Particles)

Diese drei FX haben zusätzlich einen **Beat-Trigger** der unabhängig
von `resolveParam` läuft (das `isOnBeat()`-Check im Renderer):

```ts
if (isOnBeat(currentBeat, trigger)) { /* flash / burst */ }
```

Im Flow Mode muss dieser Check deaktiviert werden:

```ts
if (!flowMode && isOnBeat(currentBeat, trigger)) { /* flash / burst */ }
```

Betrifft:
- `lib/fx/pulse.ts` — Beat-Flash
- `lib/fx/zoom-pulse.ts` — Beat-Scale
- `lib/fx/particles.ts` — Beat-Burst-Spawn

Contour und Sweep haben keinen separaten Beat-Trigger — kein Eingriff nötig.

---

## Schritt 4 — TopBar Toggle Button

**Datei:** `components/TopBar/index.tsx`

Neben Export-Button, links davon:

```tsx
'use client';
import { useAppStore } from '@/lib/store';

function FlowModeToggle() {
  const flowMode = useAppStore((s) => s.ui.flowMode);
  const setFlowMode = useAppStore((s) => s.setFlowMode);
  return (
    <button
      type="button"
      onClick={() => setFlowMode(!flowMode)}
      title={flowMode ? 'Flow Mode — klick für Beat Mode' : 'Beat Mode — klick für Flow Mode'}
      className={`
        px-3 h-7 rounded text-xs font-medium transition-colors
        ${flowMode
          ? 'bg-[var(--a3)] text-[var(--bg)]'
          : 'bg-[var(--surface-3)] text-[var(--text-dim)] hover:text-[var(--text)]'
        }
      `}
    >
      {flowMode ? '〜 Flow' : '♩ Beat'}
    </button>
  );
}
```

Farbe: `--a3` (#2ee0d0) für Flow Mode — bewusst anders als `--a1` (Accent
für Selections) und `--a2` (Automation Points). Teal signalisiert "anderer
Modus aktiv".

---

## Tests

Mindest 3 neue Tests in `tests/unit/store/flow-mode.test.ts`:
- `flowMode` default ist `false`
- `setFlowMode(true)` setzt es korrekt
- `flowMode` ist nicht in localStorage nach persist

Plus in `tests/unit/renderer/resolve-param.test.ts` (extend):
- `resolveParam` mit `flowMode: true` + Clip-Länge 8 Beats, Beat 4
  → gibt Wert bei 50% der Kurve zurück (nicht Beat-4-Wert)

---

## Commit-Struktur

```
feat(store): flowMode UI toggle — transient, not persisted
feat(renderer): resolveParam respects flowMode for continuous interpolation  
feat(fx): disable beat-trigger in flow mode (pulse, zoom-pulse, particles)
feat(topbar): Flow/Beat mode toggle button
test: flowMode store + resolveParam flow-mode coverage
```

---

## Verification Gate

```powershell
npm test -- --run      # alle bisherigen Tests grün + neue
npm run typecheck
npm run lint
npm run build
```

Smoke:
```
npm run dev
# Beat Mode (default): Pulse blitzt auf dem Beat wie gewohnt
# Toggle auf Flow: Pulse pulst sanft durch, kein harter Beat-Flash
# Toggle zurück auf Beat: sofort wieder beat-synchron
# Reload: Toggle ist zurück auf Beat (nicht persisted)
```
