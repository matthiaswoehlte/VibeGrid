# Architekt-Entscheidung — Plan 9c: Trigger-Subdivision + Inspector UX
### Nach CC #1 Pre-Review

❌ Nicht freigegeben — Rev. 2 erforderlich.
CC #1 schreibt Rev. 2 direkt auf Basis dieser Entscheidungen.

---

## A — Naming (Blocker 3): Option (b)

**Entscheidung: `'1×' | '2×' | '4×' | '8×' | '16×' | '32×'`**

Begründung: Unzweideutig, keine Musik-Theorie-Falle, intern
konsistent mit VibeGrid's eigenem TriggerMode-Vokabular.

```ts
export type TriggerSubdivision =
  '1×' | '2×' | '4×' | '8×' | '16×' | '32×'

export const TRIGGER_SUBDIVISIONS: TriggerSubdivision[] = [
  '1×', '2×', '4×', '8×', '16×', '32×'
]

export const SUBDIVISION_MULTIPLIERS: Record<TriggerSubdivision, number> = {
  '1×': 1, '2×': 2, '4×': 4, '8×': 8, '16×': 16, '32×': 32
}
```

Object-Map statt Array — lesbarer, kein Index-Lookup nötig,
V8-Performance ist identisch für diesen Non-Hot-Path.

---

## B — kind: 'toggle' (Blocker 2): Option (i) — saubere Migration

**Entscheidung: beatSync auf `kind: 'toggle', default: true` migrieren.**

```ts
// ParamSchema — beatSync neu:
beatSync: { kind: 'toggle', default: true }

// Store-Wert: number → boolean
// Alle 8 FX-Renderer: params.beatSync >= 0.5 → params.beatSync (truthy)
```

**Store-Migration v6 → v7:**

```ts
// migrations.ts — neuer Schritt:
function migrateV6toV7(state: StoreV6): StoreV7 {
  return {
    ...state,
    version: 7,
    tracks: state.tracks.map(track => ({
      ...track,
      clips: track.clips.map(clip =>
        clip.type === 'fx'
          ? {
              ...clip,
              params: {
                ...clip.params,
                // beatSync: number → boolean
                ...(clip.params.beatSync !== undefined
                  ? { beatSync: Number(clip.params.beatSync) >= 0.5 }
                  : {}),
                // triggerSubdivision: default '1×' nicht nötig (optional-Feld)
              }
            }
          : clip
      ),
    })),
  }
}
```

**Inspector:** Generisches `ToggleParam.tsx` statt
FX-spezifisches `BeatSyncToggle.tsx`. Rendert für alle
`kind: 'toggle'` Params — Off links, On rechts, kein magic-string.

---

## C — TriggerMode × triggerSubdivision (Blocker 4): Option (a)

**Entscheidung: Subdivision ist orthogonal zu trigger.**

- `trigger` armiert den FX (bestimmt wann er gerendert wird)
- `triggerSubdivision` bestimmt wie schnell `beatPhase` innerhalb
  eines Beats läuft

**Wirkungstabelle:**

| trigger | subdivision | Verhalten |
|---|---|---|
| 'beat' | '1×' | 1× pro Beat — Standard |
| 'beat' | '4×' | 4× pro Beat |
| 'bar' | '4×' | FX armed nur auf Bar-Downbeat, dort 4× subdividiert |
| 'half-bar' | '2×' | 2× pro Beat, nur in der ersten Half-Bar |

`subdividedBeatPhase` basiert immer auf `rc.beatPhase` (0–1 pro Beat).
`trigger` steuert via Loop ob render() überhaupt aufgerufen wird.
Beide Dimensionen sind unabhängig — kein Konflikt.

**flowMode:** subdivision ist beat-mode-only.
FX mit flowMode-skip (`if (rc.flowMode) return`) skippen weiterhin —
`subdividedBeatPhase` ist für sie irrelevant.

---

## Pflicht-Korrekturen (ohne Architekt-Input)

- **B1:** `lib/timeline/types.ts` statt `lib/types.ts`
- **W5:** `unit?: string` existiert bereits in `lib/renderer/types.ts:6`
  → kein Schritt-0-Fund nötig
- **W6:** Performance-Claim streichen — Object-Map ist lesbarer,
  V8-Performance identisch
- **W7:** `% 1` statt Bitwise-Floor (`rawPhase | 0`) — klarer Intent,
  gleiche Perf in V8
- **W8:** Explizite Aussage: „Subdivision ist beat-mode-only,
  flowMode-FX skippen unverändert"
- **W9:** Inspector-Platzierung als kleine Skizze klären
- **W10:** Slider-Wert bei Automation-Kurve: Option (c) — „auto"
  anzeigen wenn AutomationCurve aktiv, statischen Wert wenn static
- **W11:** durch Option (i) gelöst — `kind: 'toggle'` ist generisch,
  kein magic-string
- **W13:** Auswahl-Kriterium explizit: „FX die beatPhase direkt für
  envelope-shape nutzen (env-Decay)". Pulse + ContourGL in Schritt 0
  prüfen ob sie das Kriterium erfüllen
- **D14:** `Inspector/index.tsx` statt `Inspector/Inspector.tsx`
- **D15:** Store-Migration v6→v7 erforderlich (durch B oben)
- **D16:** Subdivision-Picker-Click: sofort via `setClipParam`,
  kein coalesce nötig (Button-Click, kein Drag)

---

## Tests-Erhöhung

Mindest von +14 auf **+20 neue Tests**:
- Migration v6→v7: beatSync number→boolean korrekt
- Subdivision-Berechnungen: explizite Tabelle (siehe W12)
- Regression pro modifiziertem FX (1 Test je)
- ToggleParam generisch: Off/On korrekt für beliebigen toggle-Param

---

## Checkliste Rev. 2

- [ ] A: Naming '1×'–'32×' + Object-Map
- [ ] B: kind: 'toggle' + Store-Migration v6→v7 + ToggleParam.tsx
- [ ] C: TriggerMode-Orthogonalität + Wirkungstabelle + flowMode-Note
- [ ] Pfad: lib/timeline/types.ts
- [ ] W5: unit existiert bereits — definitiv
- [ ] W6: Performance-Claim gestrichen
- [ ] W7: % 1 statt Bitwise-Floor
- [ ] W8: flowMode-Aussage explizit
- [ ] W9: Inspector-Platzierungs-Skizze
- [ ] W10: "auto" bei Automation-Kurve
- [ ] W13: Auswahl-Kriterien + Pulse + ContourGL in Schritt 0
- [ ] D14: Inspector/index.tsx
- [ ] D15: Migration in Plan-Body
- [ ] D16: sofortiger setClipParam-Call

---

Architekt-Entscheidung — 2026-05-29
