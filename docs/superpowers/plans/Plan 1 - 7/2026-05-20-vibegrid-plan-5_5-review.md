# CC Feedback — Plan 5.5: Automation UI, Waveform Worker, Interpolation Modes

❌ **Nicht freigegeben** — 1 fehlender Scope-Punkt, 1 potenzieller TS-Fehler

---

## Kritische Punkte (MUSS gefixt werden)

### Bug 1 — Zoom Pulse FX Plugin fehlt komplett

**Problem:** In unserem gemeinsamen Review haben wir explizit entschieden:

> "Zoom Pulse als fünften FX-Plugin in Plan 5.5" und
> "Zoom Pulse FX (5. Plugin) nicht vergessen — hatten wir heute als festen
> Bestandteil von 5.5 entschieden."

Der Plan enthält kein Zoom Pulse. Weder im File Map, noch in den Tests,
noch in der Verification Gate.

**Was Zoom Pulse bedeutet:**
- Neues FX-Plugin in `lib/fx/zoom-pulse.ts`
- `kind: 'ZoomPulse'`, `id: 'zoom-pulse'`
- Auf dem Beat: `ctx.save()`, `ctx.translate(cx, cy)`, `ctx.scale(1 + intensity * scaleFactor, ...)`,
  `drawImageCover(...)`, `ctx.restore()` — ein Scale-Transform vor dem Draw
- Parameter: `intensity` (Slider 0–1), `decay` (Slider 0–1, Abklinggeschwindigkeit)
- Registriert in `lib/fx/index.ts` neben Contour/Sweep/Pulse/Particles
- ≥ 4 Unit-Tests in `tests/unit/fx/zoom-pulse.test.ts`

Das ist ein Nachmittag Arbeit, passt genau in diesen Plan, und ist konzeptuell
bereits vollständig spezifiziert. In Plan 5.5 rein oder die Entscheidung
explizit revidieren.

---

### Bug 2 — `patchClipParam` Typ-Annotation potenziell fehlerhaft

**Datei:** `lib/store/timeline-slice.ts`

**Problem:** Der Helper ist so annotiert:

```ts
const patchClipParam = (
  set: Parameters<typeof createTimelineSlice>[0],
  get: Parameters<typeof createTimelineSlice>[1],
  ...
```

`createTimelineSlice` muss dafür eine benannte, exportierte Funktion sein deren
Parametersignatur TypeScript zur Compile-Zeit auflösen kann. Falls der Slice
inline im `create(...)` Factory-Call gebaut ist (was Plan 5.5 selbst auf Seite 3
beschreibt: "The current store keeps UI state inline at the top level of the
`create(...)` factory"), gibt es kein `createTimelineSlice` als benannte Funktion
und `Parameters<typeof createTimelineSlice>` löst einen TS-Fehler aus.

**Fix:** Da `patchClipParam` innerhalb des Slice definiert wird, sind `set` und
`get` bereits via Closure verfügbar. Die Typen direkt aus Zustand's generischem
Parameter holen:

```ts
import type { StateCreator } from 'zustand';
import type { AppState } from './types';

// Im Slice-Body, ohne Parameterübergabe:
const patchClipParam = (
  clipId: string,
  key: string,
  transform: (current: unknown) => unknown
): void => {
  // set und get kommen aus dem umschließenden createTimelineSlice-Scope
  set((state) => ({
    timeline: {
      ...state.timeline,
      clips: state.timeline.clips.map((c) => {
        if (c.id !== clipId) return c;
        const params = c.params ?? {};
        if (!(key in params)) return c;
        const next = transform(params[key]);
        if (next === params[key]) return c;
        return { ...c, params: { ...params, [key]: next } };
      })
    }
  }));
};
```

Der typecheck-Step in Task 3 Step 10 würde das aufdecken — kein harter Blocker
wenn CC #1 darauf vorbereitet ist. Aber es ist sauberer das jetzt zu fixieren.

---

## Anmerkungen (kein Blocker)

### A1 — `useWaveformPeaks` hat dasselbe R2-CORS-Problem wie `image-cache`

`useWaveformPeaks` fetcht die Audio-URL direkt vom Browser:
```ts
const resp = await fetch(audioUrl, { signal: controller.signal });
```

Die Audio-URL zeigt auf `pub-xxx.r2.dev`. Das ist derselbe CORS-Block den wir
beim Bild-Cache gesehen haben. Der Fix ist identisch: R2 CORS-Policy im
Cloudflare Dashboard um `localhost:3001` und später die Vercel-Domain erweitern.

Das ist kein Code-Bug — aber CC #1 soll das im Plan als bekanntes
Infrastruktur-Problem dokumentieren (z.B. als Kommentar im Hook oder in
`KNOWN_LIMITATIONS.md`), damit beim Smoke-Test keine Überraschung entsteht.

---

### A2 — `AutomationPoint` Test-Count Diskrepanz

Verification Gate sagt `≥ 5 Tests` für AutomationPoint. Task 7 Step 4 sagt
"Expected: 4 tests green." Das stimmt nicht überein. Vermutlich ist ein
fünfter Test geplant aber nicht geschrieben — File Map sagt ebenfalls ≥ 5.

Entweder einen 5. Test schreiben (z.B. "Renders with correct cx/cy position
derived from beat and value") oder die Verification Gate auf ≥ 4 korrigieren.

---

### A3 — `Waveform.tsx` Breaking Change ist korrekt, aber explizit bestätigen

Plan 5's `Waveform.tsx` erwartet `{ min: Float32Array; max: Float32Array }`.
Plan 5.5 rewrites auf das Worker-Tuple-Format `[number, number][]`. Das ist
ein Breaking Change der Komponenten-API.

Da die Waveform-Komponente in Plan 5 ein reiner Stub ohne echte Caller war
(kein Hook hat ihr Peaks geliefert), ist der Rewrite sauber. Nur bestätigen
dass in `Timeline/index.tsx` keine Plan-5-Überreste die alte Interface erwarten.

---

## Was gut ist ✅

- **Interpolation-Extension** ist eine mustergültige Pure-Datenschicht-Erweiterung
  — kein Store-Migration, keine Breaking Changes, existierende Clips arbeiten
  bit-identisch.
- **`patchClipParam`-Abstraktion** ist elegant — alle 6 Slice-Actions
  in einer DRY-Pattern, jede Action ist ein Einzeiler. Gute Idee.
- **Evict-last-point-Guard** in `AutomationPoint.onContextMenu` ist präzise —
  `convertParamToStatic` statt `removeParamPoint` wenn `totalPoints <= 1`
  verhindert exakt den leeren-Kurven-Throw aus `resolveParam`.
- **jsdom-Delta-Pattern** für Pointer-Tests ist die richtige Wahl — robuster
  als absolute Koordinaten via `getBoundingClientRect()`.
- **Module-scoped Cache** in `useWaveformPeaks` ist StrictMode-safe — zweiter
  Mount findet den Cache-Eintrag und überspringt den Fetch.
- **`_resetPeaksCacheForTests()`** — saubere Test-Isolation analog zu den
  anderen Reset-Helpers im Projekt.
- **Risk-Table am Ende** des Plans ist sehr gut — alle relevanten Risiken
  (dnd-kit Pointer-Hijacking, jsdom SVG-Rects, OfflineAudioContext in jsdom)
  sind identifiziert und mitigiert.
- **Waveform Worker Chunk-Verifikation** (Task 14 Step 2) ist ein seltener
  aber wichtiger Check — wird oft vergessen.

---

## Fix-Summary für CC #1

| # | Was | Aufwand |
|---|---|---|
| Bug 1 | Zoom Pulse FX Plugin hinzufügen | 1 Task, ~4 Stunden |
| Bug 2 | `patchClipParam` Closure-Pattern statt Parameterübergabe | ~5 Minuten |
| A2 | 5. AutomationPoint-Test schreiben ODER Gate auf ≥4 korrigieren | 10 Minuten |

Nach diesen Fixes direkt freigegeben.
