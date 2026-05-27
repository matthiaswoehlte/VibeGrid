# CC #1 Prompt — Plan 8f.2: RetroVHS FX

**Voraussetzung: Plan 8f.1 grün (WebGL2-Infrastruktur live).**
RetroVHS ist der zweite WebGL2-FX. Keine neue Infrastruktur —
nur GLSL, Plugin, paramSchema, Tests.

Baseline: HEAD post-Plan-8f.1.

---

## Schritt 0

1. `lib/renderer/webgl/pipeline.ts` — `renderGlFx`-Signatur bestätigen
2. `lib/renderer/webgl/programs/color-grade.ts` — Template-Pattern studieren
3. `lib/utils/prng.ts` — mulberry32 (für seed-Param)
4. Aktuellen Test-Zahl notieren

---

## RetroVHS paramSchema [Doc 5]

```typescript
// lib/fx/retro-vhs.ts

interface RetroVhsParams {
  scanlineOpacity:  number;
  scanlineSpacing:  number;
  colorFringe:      number;
  dropoutIntensity: number;
  dropoutCount:     number;
  warpIntensity:    number;
  decay:            number;
  seed:             number;  // [Doc 5] fehlte in Rev. 2
}

export const retroVhsPlugin: FxPlugin<RetroVhsParams> = {
  id: 'retro-vhs', name: 'Retro VHS', kind: 'RetroVHS',
  defaultTrigger: 'beat',
  preloadState: 'loading',  // mutiert in preload()

  paramSchema: {
    scanlineOpacity:  { kind:'slider', label:'Scanlines',     min:0,   max:0.6,  step:0.01,  default:0.25 },
    scanlineSpacing:  { kind:'slider', label:'Line Spacing',  min:2,   max:4,    step:1,     default:2    },
    colorFringe:      { kind:'slider', label:'Color Fringe',  min:0,   max:0.02, step:0.001, default:0.003 },
    dropoutIntensity: { kind:'slider', label:'Dropout',       min:0,   max:1,    step:0.01,  default:0.4  },
    dropoutCount:     { kind:'slider', label:'Dropout Lines', min:0,   max:8,    step:1,     default:3    },
    warpIntensity:    { kind:'slider', label:'Tape Warp',     min:0,   max:0.015,step:0.001, default:0.004 },
    decay:            { kind:'slider', label:'Decay',         min:0.01,max:0.5,  step:0.01,  default:0.3  },
    seed:             { kind:'slider', label:'Seed',          min:0,   max:999,  step:1,     default:7    },
  },
  getDefaultParams: () => ({
    scanlineOpacity:0.25, scanlineSpacing:2, colorFringe:0.003,
    dropoutIntensity:0.4, dropoutCount:3, warpIntensity:0.004,
    decay:0.3, seed:7
  }),

  async preload() {
    const gl = new OffscreenCanvas(1,1).getContext('webgl2');
    this.preloadState = gl ? 'ready' : 'error';
  },

  render(rc, params) {
    if (!rc.imageBitmap) return;

    // [Flow Mode] Scanlines + Fringe dauerhaft — dropout/warp aus
    const isFlow = rc.flowMode;
    const env    = isFlow ? 1.0 : Math.max(0, 1 - rc.beatPhase / params.decay);
    if (!isFlow && env < 0.01) return;

    renderGlFx({
      rc,
      fragSrc: RETRO_VHS_FRAG_SRC,
      uniformNames: [
        'u_env','u_beat_phase','u_beat_index',
        'u_scanline_opacity','u_scanline_spacing',
        'u_color_fringe','u_dropout_intensity','u_dropout_count',
        'u_warp_intensity','u_seed',
      ],
      uniforms: {
        u_env:              env,
        u_beat_phase:       rc.beatPhase,
        u_beat_index:       rc.beatIndex,
        u_scanline_opacity: params.scanlineOpacity,
        u_scanline_spacing: params.scanlineSpacing,
        u_color_fringe:     params.colorFringe,
        u_dropout_intensity: isFlow ? 0 : params.dropoutIntensity,  // Flow: kein Dropout
        u_dropout_count:    params.dropoutCount,
        u_warp_intensity:   isFlow ? 0 : params.warpIntensity,      // Flow: kein Warp
        u_seed:             params.seed,
      },
    });
  },

  dispose() { /* disposeContext(clipId) — wie color-grade-shift */ },
};
```

---

## GLSL RetroVHS

RETRO_VHS_FRAG_SRC in `lib/renderer/webgl/programs/retro-vhs.ts`.
**[Fix W2] Quelle:** GLSL exakt aus `vibegrid-plan-8f-fx-color-vhs.md`
(liegt noch im Repo) — keine Änderungen nötig.

---

## Integration-Checkliste (8 Stellen) [Fix D2]

Identisch wie 8f.1, für `RetroVHS` / `retro-vhs`.
Stelle 8 = `lib/renderer/types.ts` (FxKind | 'RetroVHS') — separate Datei,
zählt aber als eigene Stelle.

---

## File Map

| Datei | Aktion |
|---|---|
| `lib/renderer/webgl/programs/retro-vhs.ts` | CREATE — GLSL |
| `lib/fx/retro-vhs.ts` | CREATE — Plugin + paramSchema + u_seed |
| `lib/fx/index.ts` | MODIFY — register(retroVhsPlugin) |
| `lib/renderer/types.ts` | MODIFY — FxKind \| 'RetroVHS' (Stelle 8) |
| `lib/timeline/plugin-mapping.ts` | MODIFY — 7 Stellen für RetroVHS |

---

## Tests

`tests/unit/fx/retro-vhs.test.ts` — ≥ 6:
- `env=0` + !flowMode → renderGlFx nicht aufgerufen
- `flowMode=true` → renderGlFx aufgerufen (Scanlines persistent)
- `flowMode=true` → `u_dropout_intensity=0` in Uniforms
- `flowMode=true` → `u_warp_intensity=0` in Uniforms
- `u_seed` in Uniforms = params.seed
- `u_beat_index` in Uniforms = rc.beatIndex

Mindest: **≥ 6 neue Tests**

---

## Verification Gate

Baseline: **post-8f.1**.
Ziel: **Baseline + ≥ 6**.

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Smoke-Tests:**
```
# RetroVHS in FX-Library
# Scanlines + Fringe dauerhaft auf Beat-Clip
# Flow Mode: Scanlines persistend, kein Dropout
# Dropout auf Beat: seed=7 → reproduzierbar
# Color Fringe: RGB-Saum sichtbar
# Tape Warp: subtile Sinus-Verzerrung
# Export: RetroVHS ohne Freeze
# Context-Loss: WEBGL_lose_context.loseContext() → recovered nächsten Frame
```

---

## Commits

```
feat(webgl): programs/retro-vhs — GLSL
feat(fx): retro-vhs — Plugin + paramSchema + u_seed
feat(fx): types + registry + plugin-mapping — RetroVHS, 8 Stellen
test: retro-vhs
```

Abgabe: `vibegrid-plan-8f2-retro-vhs.md`
