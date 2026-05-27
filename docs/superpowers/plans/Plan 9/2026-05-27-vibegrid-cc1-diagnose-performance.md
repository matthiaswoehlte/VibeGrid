# CC #1 Diagnose-Task — Render-Loop Performance

**Kein Feature-Code. Nur Messungen und Bericht.**

Baseline: HEAD post-8f.2 (1248 Tests).

---

## Ziel

Wir sehen 20 FPS + Quality-Downscale bei einer Timeline mit
~5 FX-Clips + 2 WebGL2-FX + 3 Video-Szenen. Bevor wir
optimieren, brauchen wir Zahlen.

---

## Was du messen sollst

### 1. Per-FX Render-Zeit

In `lib/renderer/loop.ts`, um jeden FX-Render-Call:

```ts
performance.mark(`fx-start-${clip.kind}-${clip.id}`)
plugin.render(rc, params)
performance.mark(`fx-end-${clip.kind}-${clip.id}`)
performance.measure(
  `fx-${clip.kind}`,
  `fx-start-${clip.kind}-${clip.id}`,
  `fx-end-${clip.kind}-${clip.id}`
)
```

Interessiert: ColorGradeShift, RetroVHS, Contour, ZoomPunch einzeln.

### 2. Gesamt-Frame-Zeit

```ts
performance.mark('frame-start')
// ... gesamter renderFrame()-Body ...
performance.mark('frame-end')
performance.measure('frame-total', 'frame-start', 'frame-end')
```

### 3. WebGL2 Context-Switch-Overhead

Messe die Zeit **zwischen** zwei `renderGlFx()`-Calls:

```ts
performance.mark('gl-switch-start')
// erster renderGlFx-Call endet hier
// zweiter renderGlFx-Call beginnt hier
performance.mark('gl-switch-end')
performance.measure('gl-context-switch', 'gl-switch-start', 'gl-switch-end')
```

### 4. Video-Decode / drawImage

In `loop.ts` oder wo `drawImage(videoElement, ...)` aufgerufen wird:

```ts
performance.mark('video-draw-start')
ctx.drawImage(videoElement, ...)
performance.mark('video-draw-end')
performance.measure('video-draw', 'video-draw-start', 'video-draw-end')
```

### 5. Anzahl aktiver FX pro Frame

```ts
console.log('[frame] active FX:', activeClips.map(c => c.kind).join(', '))
```

Einmal loggen, dann deaktivieren.

---

## Wie messen

1. Marks einbauen (temporär — kein Commit nötig)
2. Browser öffnen, Timeline mit dem Screenshot-Stand laden:
   - 3 Video-Szenen auf MAIN
   - Contour × 3, ZoomPunch × 1 auf FX-Tracks
   - ColorGradeShift + RetroVHS auf FX 3
3. 10 Sekunden Playback laufen lassen
4. Chrome DevTools → Performance-Tab → `performance.getEntriesByType('measure')`
   im Console-Tab auswerten:

```js
performance.getEntriesByType('measure')
  .reduce((acc, e) => {
    if (!acc[e.name]) acc[e.name] = []
    acc[e.name].push(e.duration)
    return acc
  }, {})
```

Für jeden Measure: **min / max / avg** ausgeben.

---

## Was du zurückschickst

Ein kurzes Markdown-Dokument mit:

```
## Messungen (avg / max über ~600 Frames)

| Measure            | avg ms | max ms |
|--------------------|--------|--------|
| frame-total        |        |        |
| fx-ColorGradeShift |        |        |
| fx-RetroVHS        |        |        |
| fx-Contour         |        |        |
| fx-ZoomPunch       |        |        |
| gl-context-switch  |        |        |
| video-draw         |        |        |

## Aktive FX pro Frame (typischer Frame)
[Liste]

## Auffälligkeiten
[Was ist unerwartet teuer? Was dominiert?]

## Deine Einschätzung
[Wo ist der Engpass — WebGL2 Context-Switch, Video-Decode, FX-Stacking, oder
 etwas anderes das du im Code siehst?]
```

---

Marks danach wieder entfernen (oder hinter ein `DEBUG_PERF`-Flag stellen).
Kein Commit der Mess-Instrumentation.
