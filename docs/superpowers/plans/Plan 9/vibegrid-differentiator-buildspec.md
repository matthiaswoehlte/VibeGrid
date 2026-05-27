# VibeGrid — Differentiator Buildspec

Datum: 2026-05-25
Status-Basis: HEAD post-8d, Plan 8e in Review, 8.5/8.6 bereit zur Implementation

---

## Übersicht: 7 strategische Stärken → Baustatus

| # | Stärke | Status | Plan |
|---|---|---|---|
| 1 | Beat-Sync auf Parameter-Ebene (Automation Curves) | ✅ Gebaut | Plan 5.5/5.7 |
| 2 | SceneFlow → Timeline in einem Workflow | 🔄 ~80% | Plan 8c/8d |
| 3 | Deterministischer Offline-Export | ✅ Gebaut | Plan 6-R/5.11 |
| 4 | Preset-Packs mit Automation-Kurven | ❌ Nicht gebaut | **Plan 9a** |
| 5 | BPM-relatives Timing überall | 🔄 ~60% | Plan 8d + **Plan 9b** |
| 6 | Style-Konsistenz über alle Szenen | 🔄 ~70% | SceneFlow + **Plan 9c** |
| 7 | Format-Varianten aus einem Projekt | ❌ Nicht gebaut | **Plan 9d** |

---

## Roadmap nach 8e

```
8e  → FX-Pack (9 FX)                    [in Review]
8f  → ColorGradeShift + WebGL-Renderer  [geplant]
8.5 → Credit-System                     [bereit]
8.6 → Admin-UI                          [bereit]
──────────────────────────────────────────────
9a  → Preset-Pack System                [neu]
9b  → BPM-Timing-Vertiefung            [neu]
9c  → Style-Consistency Engine         [neu]
9d  → Format-Varianten / Multi-Export  [neu]
```

---

## Plan 9a — Preset-Pack System

**Was:** FX-Presets mit vorgezeichneten Automation-Kurven, gebündelt als "Packs".
User klickt "Hardstyle Pack" → ZoomPunch + RGBSplit + ScreenShake landen als
Tracks auf der Timeline mit perfekt abgestimmten Kurven für 128 BPM.

**Warum es CapCut nicht kann:** Deren Effekte haben keine Kurven-Ebene.
Ein Preset bei CapCut = ein Effekt mit fixen Werten. Bei VibeGrid =
ein komplettes Automation-Setup das sich mit dem BPM skaliert.

**Scope:**
- Preset-Schema: `{ fxKind, params, automationCurves, bpmReference }`
- BPM-Scaling: Kurven werden beim Anwenden auf aktuelles Projekt-BPM normiert
- Library-UI: Browsable Pack-Liste (lokal, später Cloud)
- Save-as-Preset: User kann seinen eigenen Setup als Preset speichern
- Built-in Packs: Hardstyle, Cinematic, Lo-Fi, Pop (jeweils 3–4 FX kombiniert)

**Visual:** DrawIO-Prompt → siehe Abschnitt "Prototypen-Prompts"

---

## Plan 9b — BPM-Timing-Vertiefung

**Was:** Heute: Beat-Snap beim Transfer (8d). Offen:
- Tap-BPM im Timeline-Header (Finger/Space-Bar → BPM)
- Bars & Beats Ruler (Takt-Anzeige statt nur Sekunden)
- "Snap to Bar" zusätzlich zu "Snap to Beat"
- BPM-Automation (Song-Abschnitte mit verschiedenem Tempo)

**Scope 9b (v0.1):**
- Tap-BPM Button im Header
- Bars-Ruler (4/4 Takt, abgeleitet von BPM)
- Snap-Mode: Off / Beat / Bar (8d hat Off+Beat, Bar kommt hier)

**Scope 9b-later:**
- BPM-Map (mehrere Tempi im Song) → v0.3

---

## Plan 9c — Style-Consistency Engine

**Was:** SceneFlow hält Charakter-Beschreibungen. Was fehlt:
- Farb-Palette pro Story (alle Bilder haben gleiche Lichtstimmung)
- Automatische Stil-Vererbung (FX-Setup von Szene 1 als Default für alle)
- "Style Lock" — verhindert dass Einzelszenen visuell ausbrechen

**Scope 9c:**
- Story-Level Color-Palette (3–5 Farben, fließt als Suffix in image_prompt)
- FX-Preset als Story-Default (in Story-Setup auswählen, wird auf alle Szenen angewendet)
- Inspector-Badge "Story Default" wenn FX vom Story-Preset kommt

---

## Plan 9d — Format-Varianten / Multi-Export

**Was:** Ein Projekt, drei Exports: 9:16 / 16:9 / 1:1.
Beat-Sync und FX identisch, nur Canvas-Crop ändert sich.

**Technisch:**
- `exportFormat: '16:9' | '9:16' | '1:1'` als Export-Parameter
- Clip-Renderer: `drawImageContain` bereits vorhanden → passt sich an
- Text-FX: Position relativ (% statt px) → bereits in ParamSchema möglich
- Export-UI: drei Buttons statt einem

**Scope 9d:**
- Export-Format-Wahl im Export-Dialog
- Canvas-Größe wird beim Render aus Format abgeleitet
- Clip-Layout: FX-Positionen skalieren mit Format (centerX/Y in fraction = safe)

**Visual:** DrawIO-Prompt → siehe Abschnitt "Prototypen-Prompts"

---

## Nicht im aktuellen Ablauf — brauchen Prototyp zuerst

### A — Preset-Pack Browser UI (für Plan 9a)

Unklare UX-Fragen:
- Wo lebt die Pack-Library? Sidebar? Modal? Eigener Tab?
- Wie zeigt man eine Vorschau einer Automation-Kurve im Pack-Browser?
- Wie verhält sich "Pack anwenden" wenn schon FX auf der Timeline sind?

→ DrawIO-Prompt geschrieben (siehe unten)

### B — Format-Varianten-Workflow (für Plan 9d)

Unklare UX-Fragen:
- Wählt der User das Format einmalig bei Projektstart oder flexibel?
- Sieht er alle drei Formate gleichzeitig (Split-View) oder switcht er?
- Wie kommuniziert die UI dass ein FX auf 9:16 anders aussieht als auf 16:9?

→ DrawIO-Prompt geschrieben (siehe unten)

