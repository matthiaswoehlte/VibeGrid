# CC #1 Prompt — Plan 9a: Preset-Pack System

**Das ist der Plan der VibeGrid von CapCut trennt.**
Preset-Packs mit eingebetteten Automation-Kurven — kein anderes
Browser-Tool kann das, weil kein anderes Browser-Tool Kurven hat.

> Rev. 3 — store-bridge.ts komplett gegen echte API neu geschrieben.
> B1: state.timeline.tracks/clips, timelineActions.addTrack/addClip positional + ID-Return.
> B2: Duplikat-Return in save-as-preset entfernt.
> B3: convertParamToAutomation mit beat+value, kein Doppelpunkt.
> B4: isAutomationCurve importiert. W6: beatsPerBar aus Store.
> W7: defensive params-copy. W8: DEFAULT_BEAT_GRID. D12: Layout-Wrapper-Patch.
> D13: Test-Ziel auf 22 vereinheitlicht. D14: Smoke-Tests erweitert.

Baseline: HEAD post-Plan-8e (alle 9 FX live).

Schreibe nur den **Plan** — noch keinen Code.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. `lib/store/timeline-slice.ts` — wie werden FX-Clips + Automation-Curves
   heute im Store angelegt? Welche Actions existieren?
   (`addClip`, `setParam`, `setAutomationCurve` o.ä. — exakte Namen notieren)
2. `lib/renderer/types.ts` — `AutomationPoint`-Shape, `AutomationCurve`-Shape
3. `lib/timeline/plugin-mapping.ts` — `FX_CLIP_COLORS` (für Pack-Dot-Farben)
4. `lib/fx/index.ts` — alle registrierten FX-Kinds + ihre defaultParams
5. `components/Workspace/` — wo wird die Toolbar/Header gerendert?
   (Preset-Pack-Button kommt dort rein)
6. Bestehender Toast/Notification-Stack — Pfad notieren
7. Aktuelle Test-Zahl

---

## Design-Referenz (exakt umsetzen)

Die Design-Screens vom Prototyp sind verbindlich.
Wichtigste UI-Entscheidungen die implementiert werden müssen:

**Linke Spalte (Pack-Liste):**
- Header "Preset Packs" + "BEAT-SYNC · FX BUNDLES"
- BPM-Badge oben rechts (grüner Dot + aktuelle Projekt-BPM)
- Suchfeld "Search 24 packs..."
- Filter-Tabs: All · N | Drop | Build-Up | Verse | Outro
- Pack-Card: Name, "N FX · X BPM reference", farbige Dots, Play-Button
- Aktiv-State: linker lila Akzent-Border

**Rechte Spalte (Pack-Detail):**
- Breadcrumb "DROP · CURATED PACK · N FX"
- Pack-Name groß
- Beschreibungstext
- Meta-Badges: Trigger | FX-Count | Ref. BPM | Recommended Bars
- Tags (HARDSTYLE, DROP, etc.)
- "FX IN THIS PACK" Sektion: "N INCLUDED · N ACTIVE"
- Pro FX-Zeile: Icon + Name + Label + MiniCurve + Play + Toggle
- Footer: "Curves will be scaled to your project (X BPM)" · "N of N FX active"
- CTA "Apply Pack to Timeline" (lila, volle Breite)
- Secondary "Save current setup as preset..."

---

## Datenmodell

```typescript
// lib/presets/types.ts

// [Fix W7] AutomationPoint aus lib/automation/types.ts importieren — kein Duplikat
// import type { AutomationPoint } from '@/lib/automation/types';
// import type { PluginFxKind } from '@/lib/timeline/plugin-mapping';

export interface FxPresetEntry {
  fxKind:              PluginFxKind;   // [Fix B1] typsicher, PascalCase
  params:              Record<string, unknown>;
  automationCurves:    Record<string, AutomationPoint<number>[]>;
  displayTriggerLabel: string;   // [Fix W5] nur Display, kein Verhalten — '1/4', '1/2', etc.
  // Sub-Beat-Trigger (echtes Timing < 1 Beat) kommt in Plan 10+
  curveLabel:          string;   // z.B. 'ENV', 'PULSE', 'PUNCH'
  displayLabel:        string;   // z.B. 'Camera-Shake · Beat-sync · 1/4'
  enabled:             boolean;
}

export interface PresetPack {
  id:             string;
  name:           string;
  description:    string;
  category:       'Drop' | 'Build-Up' | 'Verse' | 'Outro' | 'Any';
  tags:           string[];
  bpmReference:   number | 'any';   // [Fix W6] 'any' für Outro + tempo-unabhängige Packs
  bpmRange?:      [number, number];
  recommendedBars: number;
  fx:             FxPresetEntry[];
  isNew?:         boolean;
  isCurated?:     boolean;
  source:         'built-in' | 'user';
}
```

### BPM-Scaling (v0.1: informativ, nicht transformativ)

Die Kurven sind in **Beat-relativen Positionen** (0 = Beat-Onset,
1 = nächster Beat). Das VibeGrid-Renderer-System ist bereits BPM-relativ.

→ Keine Kurven-Transformation nötig. Der Footer-Hinweis
"Curves will be scaled to your project BPM" ist v0.1 eine
**informative Aussage** — die Kurven funktionieren korrekt bei
jedem BPM weil sie beat-relativ sind. Der Hinweis erklärt nur
dass 128-BPM-Packs bei 90 BPM länger atmen (mehr Sekunden pro Beat).

v0.2-Plan: optionale "feel scaling" die decay-Parameter anpasst.

---

## Built-in Packs (7 Packs, exakt aus Design-Referenz)

```typescript
// lib/presets/built-in-packs.ts

export const BUILT_IN_PACKS: PresetPack[] = [
  {
    id: 'hardstyle-drop',
    name: 'Hardstyle Drop',
    description: 'Hard-hitting zoom + RGB split combo designed for drops at ' +
      '128–145 BPM. Layers a contour flash with a screen shake punch ' +
      'and a sharp color sweep for the kick — auto-aligned to your transients.',
    category: 'Drop',
    tags: ['HARDSTYLE', 'DROP', 'AGGRESSIVE', '128-145 BPM'],
    bpmReference: 128,
    bpmRange: [128, 145],
    recommendedBars: 4,
    isCurated: true,
    source: 'built-in',
    fx: [
      {
        fxKind: 'ZoomPunch',
        params: { strength: 1.15, attack: 0.02, decay: 0.12, direction: 'in' },
        automationCurves: {
          strength: [
            { beat: 0, value: 1.0 },
            { beat: 0.02, value: 0.94 },
            { beat: 0.15, value: 0.0 },
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'ENV',
        displayLabel: 'Camera-Shake · Beat-sync · 1/4',
        enabled: true,
      },
      {
        fxKind: 'RGBSplit',
        params: { offset: 0.008, decay: 0.2, intensity: 0.7 },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.7 },
            { beat: 0.5, value: 0.0 },
          ]
        },
        displayTriggerLabel: '1/2',
        curveLabel: 'PULSE',
        displayLabel: 'Color-Sweep · Beat-sync · 1/2',
        enabled: true,
      },
      {
        fxKind: 'ScreenShake',
        params: { intensity: 0.012, frequency: 3, decay: 0.08, axis: 'both' },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.88 },
            { beat: 0.08, value: 0.0 },
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'PUNCH',
        displayLabel: 'Beat-Pulse · Beat-sync · 1/4',
        enabled: true,
      },
      {
        fxKind: 'BeatFlash',
        params: { intensity: 0.4, color: '#ffffff', duration: 0.06, blendMode: 'screen' },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.4 },
            { beat: 0.06, value: 0.0 },
          ]
        },
        displayTriggerLabel: '1/6',
        curveLabel: 'PUNCH',
        displayLabel: 'Edge-Detect · Beat-sync · 1/6',
        enabled: false,  // Toggle OFF by default
      },
    ],
  },
  {
    id: 'cinematic-pulse',
    name: 'Cinematic Pulse',
    description: 'Slow-burn vignette breathe with lens flare on the downbeat. ' +
      'Designed for 90 BPM cinematic scenes and emotional transitions.',
    category: 'Drop',
    tags: ['CINEMATIC', 'EMOTIONAL', '80-100 BPM'],
    bpmReference: 90,
    bpmRange: [80, 100],
    recommendedBars: 8,
    isNew: true,
    isCurated: true,
    source: 'built-in',
    fx: [
      { fxKind: 'VignetteBreathe', params: { baseSize: 0.1, peakSize: 0.5, intensity: 0.8, decay: 0.6, color: '#000000' },
        automationCurves: { peakSize: [{ beat: 0, value: 0.5 }, { beat: 0.6, value: 0.0 }] },
        displayTriggerLabel: '1/1', curveLabel: 'BREATHE', displayLabel: 'Vignette · Breathe · 1/1', enabled: true },
      { fxKind: 'LensFlareBurst', params: { intensity: 0.5, rayCount: 8, rayLength: 0.4, centerX: 0.5, centerY: 0.5, decay: 0.3, color: '#a86bff' },
        automationCurves: { intensity: [{ beat: 0, value: 0.5 }, { beat: 0.3, value: 0.0 }] },
        displayTriggerLabel: '1/2', curveLabel: 'FLARE', displayLabel: 'Lens Flare · Beat-sync · 1/2', enabled: true },
      { fxKind: 'LetterboxSqueeze', params: { targetRatio: '2.35:1', attack: 0.05, decay: 0.8, intensity: 0.7, color: '#000000' },
        automationCurves: { intensity: [{ beat: 0, value: 0.7 }, { beat: 0.8, value: 0.0 }] },
        displayTriggerLabel: '1/1', curveLabel: 'SQUEEZE', displayLabel: 'Letterbox · Cinematic · 1/1', enabled: true },
      { fxKind: 'ZoomPunch', params: { strength: 1.06, attack: 0.05, decay: 0.4, direction: 'in' },
        automationCurves: { strength: [{ beat: 0, value: 0.3 }, { beat: 0.4, value: 0.0 }] },
        displayTriggerLabel: '1/2', curveLabel: 'ENV', displayLabel: 'Soft Push · Beat-sync · 1/2', enabled: true },
      { fxKind: 'FilmGrainBurst', params: { intensity: 0.25, decay: 0.3, grainSize: 2, colorMode: 'white' },
        automationCurves: { intensity: [{ beat: 0, value: 0.25 }, { beat: 0.3, value: 0.0 }] },
        displayTriggerLabel: '1/4', curveLabel: 'GRAIN', displayLabel: 'Film Grain · Ambient · 1/4', enabled: false },
    ],
  },
  {
    id: 'lofi-breathe',
    name: 'Lo-Fi Breathe',
    description: 'Warm vignette pulse with subtle grain. ' +
      'Perfect for lo-fi hip hop and chill beats at 70–90 BPM.',
    category: 'Verse',
    tags: ['LO-FI', 'CHILL', 'WARM', '70-90 BPM'],
    bpmReference: 80, bpmRange: [70, 90], recommendedBars: 8,
    isCurated: true, source: 'built-in',
    fx: [
      { fxKind: 'VignetteBreathe', params: { baseSize: 0.2, peakSize: 0.45, intensity: 0.6, decay: 0.8, color: '#1a0a00' },
        automationCurves: { peakSize: [{ beat: 0, value: 0.45 }, { beat: 0.8, value: 0.1 }] },
        displayTriggerLabel: '1/1', curveLabel: 'BREATHE', displayLabel: 'Warm Vignette · 1/1', enabled: true },
      { fxKind: 'FilmGrainBurst', params: { intensity: 0.2, decay: 0.5, grainSize: 2, colorMode: 'colored' },
        automationCurves: { intensity: [{ beat: 0, value: 0.2 }, { beat: 0.5, value: 0.05 }] },
        displayTriggerLabel: '1/2', curveLabel: 'GRAIN', displayLabel: 'Analog Grain · 1/2', enabled: true },
      { fxKind: 'LetterboxSqueeze', params: { targetRatio: '1.85:1', attack: 0.1, decay: 1.0, intensity: 0.5, color: '#000000' },
        automationCurves: { intensity: [{ beat: 0, value: 0.5 }, { beat: 1.0, value: 0.0 }] },
        displayTriggerLabel: '1/1', curveLabel: 'BARS', displayLabel: 'Soft Letterbox · 1/1', enabled: true },
    ],
  },
  {
    id: 'pop-energy',
    name: 'Pop Energy',
    description: 'High-energy flash combo for pop drops. ' +
      'RGB split on the snare, zoom on the kick, glitch on the bridge.',
    category: 'Drop',
    tags: ['POP', 'ENERGETIC', 'BRIGHT', '115-130 BPM'],
    bpmReference: 120, bpmRange: [115, 130], recommendedBars: 4,
    isCurated: true, source: 'built-in',
    fx: [
      { fxKind: 'BeatFlash', params: { intensity: 0.6, color: '#ffffff', duration: 0.08, blendMode: 'screen' },
        automationCurves: { intensity: [{ beat: 0, value: 0.6 }, { beat: 0.08, value: 0.0 }] },
        displayTriggerLabel: '1/4', curveLabel: 'FLASH', displayLabel: 'Beat Flash · 1/4', enabled: true },
      { fxKind: 'ZoomPunch', params: { strength: 1.1, attack: 0.02, decay: 0.1, direction: 'in' },
        automationCurves: { strength: [{ beat: 0, value: 0.8 }, { beat: 0.1, value: 0.0 }] },
        displayTriggerLabel: '1/4', curveLabel: 'PUNCH', displayLabel: 'Kick Zoom · 1/4', enabled: true },
      { fxKind: 'RGBSplit', params: { offset: 0.006, decay: 0.12, intensity: 0.5 },
        automationCurves: { intensity: [{ beat: 0.5, value: 0.5 }, { beat: 0.62, value: 0.0 }] },
        displayTriggerLabel: '1/2', curveLabel: 'RGB', displayLabel: 'Snare Split · 1/2', enabled: true },
      { fxKind: 'ScreenShake', params: { intensity: 0.006, frequency: 4, decay: 0.06, axis: 'x' },
        automationCurves: { intensity: [{ beat: 0, value: 0.5 }, { beat: 0.06, value: 0.0 }] },
        displayTriggerLabel: '1/4', curveLabel: 'SHAKE', displayLabel: 'Kick Shake · 1/4', enabled: true },
      { fxKind: 'LensFlareBurst', params: { intensity: 0.3, rayCount: 6, rayLength: 0.3, centerX: 0.5, centerY: 0.3, decay: 0.15, color: '#5a8fff' },
        automationCurves: { intensity: [{ beat: 0, value: 0.3 }, { beat: 0.15, value: 0.0 }] },
        displayTriggerLabel: '1/4', curveLabel: 'FLARE', displayLabel: 'Hi-Hat Flare · 1/4', enabled: false },
      { fxKind: 'VignetteBreathe', params: { baseSize: 0.05, peakSize: 0.25, intensity: 0.5, decay: 0.2, color: '#000000' },
        automationCurves: { peakSize: [{ beat: 0, value: 0.25 }, { beat: 0.2, value: 0.0 }] },
        displayTriggerLabel: '1/4', curveLabel: 'VIG', displayLabel: 'Vignette Pulse · 1/4', enabled: false },
    ],
  },
  {
    id: 'retro-vhs',
    name: 'Retro VHS',
    description: 'Warm grain + RGB drift for that 80s/90s camcorder aesthetic. ' +
      'Works at any tempo — the grain breathes continuously.',
    category: 'Verse',
    tags: ['RETRO', 'VHS', 'ANALOG', 'ANY BPM'],
    bpmReference: 110, bpmRange: [80, 140], recommendedBars: 8,
    isCurated: true, source: 'built-in',
    fx: [
      { fxKind: 'FilmGrainBurst', params: { intensity: 0.35, decay: 0.5, grainSize: 2, colorMode: 'colored' },
        automationCurves: { intensity: [{ beat: 0, value: 0.35 }, { beat: 0.5, value: 0.1 }] },
        displayTriggerLabel: '1/2', curveLabel: 'GRAIN', displayLabel: 'VHS Grain · 1/2', enabled: true },
      { fxKind: 'RGBSplit', params: { offset: 0.003, decay: 0.4, intensity: 0.3 },
        automationCurves: { intensity: [{ beat: 0, value: 0.3 }, { beat: 0.4, value: 0.05 }] },
        displayTriggerLabel: '1/1', curveLabel: 'DRIFT', displayLabel: 'Color Drift · 1/1', enabled: true },
      { fxKind: 'VignetteBreathe', params: { baseSize: 0.3, peakSize: 0.5, intensity: 0.7, decay: 1.0, color: '#000000' },
        automationCurves: { peakSize: [{ beat: 0, value: 0.5 }, { beat: 1.0, value: 0.3 }] },
        displayTriggerLabel: '1/1', curveLabel: 'VIG', displayLabel: 'CRT Vignette · 1/1', enabled: true },
      { fxKind: 'ScreenShake', params: { intensity: 0.002, frequency: 1, decay: 1.0, axis: 'both' },
        automationCurves: { intensity: [{ beat: 0, value: 0.15 }, { beat: 1.0, value: 0.05 }] },
        displayTriggerLabel: '1/1', curveLabel: 'WOBBLE', displayLabel: 'Tape Wobble · 1/1', enabled: false },
    ],
  },
  {
    id: 'glitch-storm',
    name: 'Glitch Storm',
    description: 'Maximum digital distortion for experimental edits. ' +
      'Slice + split + shake in rapid succession at 140+ BPM.',
    category: 'Drop',
    tags: ['GLITCH', 'EXPERIMENTAL', 'AGGRESSIVE', '135-160 BPM'],
    bpmReference: 140, bpmRange: [135, 160], recommendedBars: 2,
    isCurated: true, source: 'built-in',
    fx: [
      { fxKind: 'GlitchSlice', params: { sliceCount: 6, maxOffset: 0.025, decay: 0.06, seed: 42, axis: 'h' },
        automationCurves: { maxOffset: [{ beat: 0, value: 1.0 }, { beat: 0.06, value: 0.0 }] },
        displayTriggerLabel: '1/4', curveLabel: 'SLICE', displayLabel: 'Glitch Slice · 1/4', enabled: true },
      { fxKind: 'RGBSplit', params: { offset: 0.015, decay: 0.08, intensity: 0.9 },
        automationCurves: { intensity: [{ beat: 0, value: 0.9 }, { beat: 0.08, value: 0.0 }] },
        displayTriggerLabel: '1/4', curveLabel: 'SPLIT', displayLabel: 'RGB Split · 1/4', enabled: true },
      { fxKind: 'ScreenShake', params: { intensity: 0.02, frequency: 4, decay: 0.05, axis: 'both' },
        automationCurves: { intensity: [{ beat: 0, value: 0.8 }, { beat: 0.05, value: 0.0 }] },
        displayTriggerLabel: '1/4', curveLabel: 'SHAKE', displayLabel: 'Digital Shake · 1/4', enabled: true },
      { fxKind: 'BeatFlash', params: { intensity: 0.5, color: '#2ee0d0', duration: 0.04, blendMode: 'screen' },
        automationCurves: { intensity: [{ beat: 0, value: 0.5 }, { beat: 0.04, value: 0.0 }] },
        displayTriggerLabel: '1/8', curveLabel: 'FLASH', displayLabel: 'Cyber Flash · 1/8', enabled: true },
      { fxKind: 'ZoomPunch', params: { strength: 1.08, attack: 0.01, decay: 0.05, direction: 'in' },
        automationCurves: { strength: [{ beat: 0, value: 0.6 }, { beat: 0.05, value: 0.0 }] },
        displayTriggerLabel: '1/4', curveLabel: 'ZOOM', displayLabel: 'Micro Punch · 1/4', enabled: false },
    ],
  },
  {
    id: 'outro-fade',
    name: 'Outro Fade',
    description: 'Gentle vignette close with letterbox squeeze. ' +
      'Designed for endings — works at any BPM.',
    category: 'Outro',
    tags: ['OUTRO', 'FADE', 'CALM', 'ANY BPM'],
    bpmReference: 'any',   // [Fix W6]
    recommendedBars: 16,
    isCurated: true, source: 'built-in',
    fx: [
      { fxKind: 'VignetteBreathe', params: { baseSize: 0.3, peakSize: 0.7, intensity: 0.9, decay: 2.0, color: '#000000' },
        automationCurves: { peakSize: [{ beat: 0, value: 0.0 }, { beat: 4, value: 0.7 }] },
        displayTriggerLabel: '1/1', curveLabel: 'FADE', displayLabel: 'Dark Vignette · Fade-In', enabled: true },
      { fxKind: 'LetterboxSqueeze', params: { targetRatio: '2.35:1', attack: 0.5, decay: 4.0, intensity: 1.0, color: '#000000' },
        automationCurves: { intensity: [{ beat: 0, value: 0.0 }, { beat: 4, value: 1.0 }] },
        displayTriggerLabel: '1/1', curveLabel: 'BARS', displayLabel: 'Cinematic Close', enabled: true },
    ],
  },
];
```

---

## [Fix B1+B3+B4] Feature 1a — store-bridge.ts (gegen echte Store-API)

> CC #1 bestätigt in Schritt 0 die exakten Pfade: `state.timeline.tracks`,
> `state.timelineActions.addTrack(kind, label?)`, `state.timelineActions.addClip(clip)`.
> Store-Erweiterung: `addTrack` und `addClip` sollen nach Fix die generierte ID zurückgeben
> (kleine Änderung in timeline-slice.ts, File-Map-Eintrag schon vorhanden).

```typescript
// lib/presets/store-bridge.ts
import { PLUGIN_KIND_TO_TRACK_KIND, TRACK_KIND_TO_PLUGIN_KIND }
  from '@/lib/timeline/plugin-mapping';
import type { PluginFxKind } from '@/lib/timeline/plugin-mapping';
import type { AutomationPoint } from '@/lib/automation/types';
import { isAutomationCurve } from '@/lib/automation/resolve';  // [Fix B4]
import { useAppStore } from '@/lib/store';
import { DEFAULT_BEAT_GRID } from '@/lib/audio/types';  // [Fix W8]

// [Fix B1] PascalCase → kebab — einzige Konvertierungsstelle
export function toClipKind(fxKind: PluginFxKind): string {
  return PLUGIN_KIND_TO_TRACK_KIND[fxKind];
}

// [Fix B1] Findet bestehenden 'fx'-Track (per track.name) oder legt einen an.
// Hinweis: User-Rename eines Tracks (name !== fxKind) verhindert Re-use
// → neuer Track wird angelegt. KNOWN_LIMITATIONS dokumentiert das.
export function findOrCreateFxTrack(fxKind: PluginFxKind): string {
  const { timeline, timelineActions } = useAppStore.getState();
  const existing = timeline.tracks.find(   // [Fix B1] state.timeline.tracks
    t => t.kind === 'fx' && t.name === fxKind  // [Fix B1] .name nicht .label
  );
  if (existing) return existing.id;
  // addTrack erweitert (timeline-slice.ts MODIFY): gibt ID zurück
  return timelineActions.addTrack('fx', fxKind);  // [Fix B1] positional, nicht Objekt
}

// [Fix B1+B3] Legt einen Clip an und gibt die ID zurück.
// addClip in timeline-slice erweitert (MODIFY): gibt ID zurück.
export function addPresetClip(args: {
  trackId: string;
  startBeat: number;
  lengthBeats: number;
  kind: string;
  params: Record<string, unknown>;
}): string {
  const id = crypto.randomUUID();
  useAppStore.getState().timelineActions.addClip({  // [Fix B1] timelineActions
    id,
    trackId:     args.trackId,
    startBeat:   args.startBeat,
    lengthBeats: args.lengthBeats,
    kind:        args.kind,
    params:      args.params,
  });
  return id;
}

// [Fix B3] convertParamToAutomation braucht beat + initialValue als 3./4. Arg.
// Erster Punkt kommt von points[0], Rest via addParamPoint.
export function setAutomationCurve(
  clipId: string,
  key: string,
  points: AutomationPoint<number>[]
): void {
  if (points.length === 0) return;
  const { timelineActions } = useAppStore.getState();  // [Fix B1]
  // Erster Punkt initialisiert die Kurve
  timelineActions.convertParamToAutomation(
    clipId, key, points[0].beat, points[0].value
  );
  // Restliche Punkte anhängen
  for (const p of points.slice(1)) {
    timelineActions.addParamPoint(clipId, key, p);
  }
}

// [Fix B4] isAutomationCurve importiert
export function getAutomationCurves(
  clipId: string
): Record<string, AutomationPoint<number>[]> {
  const clip = useAppStore.getState().timeline.clips  // [Fix B1] timeline.clips
    .find(c => c.id === clipId);
  if (!clip) return {};
  const result: Record<string, AutomationPoint<number>[]> = {};
  for (const [key, value] of Object.entries(clip.params)) {
    if (isAutomationCurve(value)) {  // [Fix B4] jetzt importiert
      result[key] = value.points;
    }
  }
  return result;
}

// [Fix B1] clip.kind für Media-Filtering (kein .trackKind)
export function getTimelineEndBeat(): number {
  const clips = useAppStore.getState().timeline.clips;  // [Fix B1]
  const mediaCl = clips.filter(c =>
    c.kind === 'audio' || c.kind === 'video'  // [Fix B1] c.kind, nicht c.trackKind
  );
  if (mediaCl.length === 0) return 64;
  return Math.max(...mediaCl.map(c => c.startBeat + c.lengthBeats));
}

// [Fix W8] DEFAULT_BEAT_GRID statt hardcoded 120
export function getProjectBpm(): number {
  return useAppStore.getState().audio?.grid?.bpm ?? DEFAULT_BEAT_GRID.bpm;
}

// [Fix W5] BPM-Display-Helper
export function formatBpmReference(ref: number | 'any'): string {
  return ref === 'any' ? 'Any BPM' : `${ref} BPM`;
}
```

**Store-Erweiterung (timeline-slice.ts MODIFY):**
`addTrack(kind, label?)` und `addClip(clip)` geben die generierte ID zurück.
Das ist eine 2-Zeilen-Änderung pro Action (`return id` am Ende) und macht
das gesamte System robuster — auch über 9a hinaus.

---

## [Fix B2] Feature 1b — Apply Pack (Kurven-Semantik: clip-relativ → Timeline-absolut)

**Kurven-Entscheidung:** Option (a) — Punkte werden um `clip.startBeat` offsettet,
damit sie im absoluten Timeline-Beat-Raum korrekt feuern. Alle Packs laufen in
**Beat Mode** (Standard). Flow Mode wird **nicht** erzwungen.

Outro-Pack Ausnahme: beat-Werte (0→4) sind nach Offset absolut korrekt,
solange der Clip bei Beat 0 platziert wird (Default). Dokumentiert in KNOWN_LIMITATIONS.

```typescript
// lib/presets/apply-pack.ts
import { PLUGIN_KIND_TO_TRACK_KIND } from '@/lib/timeline/plugin-mapping';
import type { PluginFxKind } from '@/lib/timeline/plugin-mapping';
import { toast } from 'sonner';  // [Fix D15] — bereits in Codebase
import {
  findOrCreateFxTrack, setAutomationCurve, getTimelineEndBeat, toClipKind
} from './store-bridge';
import type { PresetPack } from './types';
import { useAppStore } from '@/lib/store';

// [Fix D17] Append-Semantik: zweites Apply legt weitere Clips an.
// Kein Replace, kein Confirm-Dialog — Toast informiert.
// User kann Clips manuell löschen. Volle Undo-History bleibt erhalten.

export function applyPackToTimeline(
  pack: PresetPack,
  startBeat = 0,
): void {
  // [Fix W6] beatsPerBar aus Store, nicht hardcoded 4
  const beatsPerBar = useAppStore.getState().audio?.grid?.beatsPerBar ?? 4;
  const lengthBeats = pack.recommendedBars * beatsPerBar;
  const activeFx = pack.fx.filter(f => f.enabled);

  for (const fxEntry of activeFx) {
    const trackId  = findOrCreateFxTrack(fxEntry.fxKind as PluginFxKind);
    const clipKind = toClipKind(fxEntry.fxKind as PluginFxKind);

    const clipId = addPresetClip({  // [Fix B1] addPresetClip gibt ID zurück
      trackId,
      startBeat,
      lengthBeats,
      kind:   clipKind,
      params: { ...fxEntry.params },  // [Fix W7] defensive copy
    });

    for (const [paramName, points] of Object.entries(fxEntry.automationCurves)) {
      const offsetPoints = points.map(p => ({
        ...p,
        beat: p.beat + startBeat,  // clip-relativ → Timeline-absolut
      }));
      setAutomationCurve(clipId, paramName, offsetPoints);
    }
  }

  toast.success(
    `${activeFx.length} FX from "${pack.name}" added to timeline`,
    { description: activeFx.length < pack.fx.length
        ? `${pack.fx.length - activeFx.length} FX were disabled — toggle to include`
        : undefined }
  );
}
```

---

## Feature 2 — Save Current Setup as Preset

```typescript
// lib/presets/save-as-preset.ts
import { TRACK_FX_KINDS } from '@/lib/timeline/plugin-mapping';      // [Fix W9]
import { TRACK_KIND_TO_PLUGIN_KIND } from '@/lib/timeline/plugin-mapping';
import type { AutomationPoint } from '@/lib/automation/types';        // [Fix W7]
import { getAutomationCurves } from './store-bridge';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';

const FX_KIND_SET = new Set<string>(TRACK_FX_KINDS);  // [Fix W9]

export function captureTimelineAsPreset(
  projectBpm: number,
  name: string,
  category: PresetPack['category']
): PresetPack {
  const clips = useAppStore.getState().timeline.clips;  // [Fix B1] .timeline.clips
  const fxClips = clips.filter(c => FX_KIND_SET.has(c.kind));

  const fx: FxPresetEntry[] = fxClips.map(clip => ({
    fxKind:   TRACK_KIND_TO_PLUGIN_KIND[clip.kind] ?? clip.kind,
    params:   { ...clip.params },  // [Fix W7] defensive copy
    automationCurves: getAutomationCurves(clip.id),
    displayTriggerLabel: '1/4',
    curveLabel:    'ENV',
    displayLabel:  TRACK_KIND_TO_PLUGIN_KIND[clip.kind] ?? clip.kind,
    enabled:       true,
  }));

  return {
    id:          `user-${Date.now()}`,
    name,
    description: '',
    category,
    tags:        [],
    bpmReference: projectBpm,
    recommendedBars: 4,
    fx,
    source:      'user',
  };
}  // [Fix B2] Duplikat-Return entfernt

// User-Presets in localStorage (v0.1) / später Supabase (v0.2)
export function saveUserPreset(pack: PresetPack): void {
  const existing = getUserPresets();
  localStorage.setItem(
    'vg_user_presets',
    JSON.stringify([...existing, pack])
  );
}

export function getUserPresets(): PresetPack[] {
  try {
    return JSON.parse(localStorage.getItem('vg_user_presets') ?? '[]');
  } catch {
    return [];
  }
}
```

---

## Feature 3 — MiniCurve SVG Component

```typescript
// components/PresetPacks/MiniCurve.tsx
// [Fix W8] Farbe: Caller konvertiert PascalCase→kebab bevor Übergabe:
// color={FX_CLIP_COLORS[PLUGIN_KIND_TO_TRACK_KIND[fxEntry.fxKind]] ?? '#a86bff'}

interface MiniCurveProps {
  points: AutomationPoint<number>[];  // [Fix W7] aus lib/automation/types
  color:  string;   // Hex — bereits korrekt aufgelöst vom Caller
  label:  string;
  width?: number;   // Default 88px (aus Design)
  height?: number;  // Default 28px
}
```

**[Fix W10] Suchfeld-Placeholder dynamisch:**
```typescript
placeholder={`Search ${allPacks.length} packs...`}
// allPacks = [...BUILT_IN_PACKS, ...getUserPresets()]
```

Render-Logik:
- X-Achse = Beat-Position (normiert 0–1)
- Y-Achse = Value (invertiert: 0 = unten, 1 = oben)
- SVG `<polyline>` mit `stroke={color}`, `fill="none"`, `strokeWidth="1.5"`
- Label als `<text>` oben rechts in text-dim Farbe, 9px
- Hintergrund: surface-2 (#1a1d2a), rounded-sm

---

## Feature 4 — PresetPackBrowser Component

```
components/PresetPacks/
  PresetPackBrowser.tsx    — Haupt-Panel (Slide-in, 640px breit)
  PackList.tsx             — Linke Spalte (Pack-Karten, scrollbar)
  PackCard.tsx             — Einzelne Pack-Karte
  PackDetail.tsx           — Rechte Spalte (Detail + FX-Liste)
  FxRow.tsx                — FX-Zeile mit MiniCurve + Toggle + Play
  MiniCurve.tsx            — SVG Mini-Automation-Kurve
  PackSearchAndFilter.tsx  — Suchfeld + Kategorie-Tabs
```

**Panel-Verhalten:**
- Slide-in von rechts, über Canvas (kein Modal, kein Seiten-Layout-Shift)
- Backdrop-Blur (wie im Design)
- Schließt per X-Button oder Escape
- Zustand (selectedPackId, toggles) ist lokal (nicht im Zustand-Store)

**[Fix B4] WorkspaceHeader — neue globale Header-Komponente:**
`components/Workspace/Toolbar.tsx` existiert nicht als globale Header.
Plan legt `components/Workspace/WorkspaceHeader.tsx` als **neue Komponente** an.

**[Fix D12] Layout-Patch in `components/Workspace/index.tsx`:**
```tsx
// Vorher: <div className="flex flex-1 min-h-0"> ... </div>
// Nachher: Wrapper der die Höhe korrekt verteilt
<div className="flex flex-col h-full">
  <WorkspaceHeader />                    {/* neu, fixe Höhe ~40px */}
  <div className="flex flex-1 min-h-0"> {/* bestehender Flex unverändert */}
    <LeftPanel />
    <Stage />
    <Inspector />
  </div>
</div>
```
Stage-Höhe aus Plan 5.10 (`h-[40vh]`) ist innerhalb des inneren Flex — bleibt unberührt.

WorkspaceHeader enthält: Projekt-Name links · BPM-Anzeige Mitte ·
Preset-Packs-Button + Export-Button rechts.

---

## Feature 5 — Preview-Play Button

**[Fix W12] v0.1: deaktiviert mit Tooltip.** Implementierung eines echten
2-sekunden-Previews würde Render-Loop-Hijack + State-Cleanup erfordern → Plan 9a-v2.

Play-Buttons (Pack-Karte + FX-Zeile) rendern als deaktiviertes Icon mit
`title="Preview coming soon"`. Kein visuell irreführendes Play-Symbol ohne Funktion.

---

## [Fix D16] BPM-Mismatch-Indikator

Wenn `pack.bpmRange` gesetzt und `projectBpm` außerhalb des Bereichs liegt,
zeigt das BPM-Badge im Pack-Card eine Warnung:

```typescript
const bpmMatch = !pack.bpmRange ||
  (projectBpm >= pack.bpmRange[0] && projectBpm <= pack.bpmRange[1]);
// bpmMatch === false → Badge wird orange + Tooltip:
// "This pack is designed for 128–145 BPM. Your project is 90 BPM.
//  The pack will still work — beats will feel slower."
```

Kein Blockieren des Apply-Buttons — nur informative Warnung.

---

## File Map

| Datei | Aktion |
|---|---|
| `lib/presets/types.ts` | CREATE — PluginFxKind + AutomationPoint<number> imports [Fix B1+W7] |
| `lib/presets/store-bridge.ts` | CREATE — 4 Store-APIs + kebab/Pascal-Konvertierung [Fix B3] |
| `lib/presets/built-in-packs.ts` | CREATE — 7 Packs vollständig |
| `lib/presets/apply-pack.ts` | CREATE — mit Kurven-Offset [Fix B2] |
| `lib/presets/save-as-preset.ts` | CREATE — TRACK_FX_KINDS-Set [Fix W9] |
| `lib/store/timeline-slice.ts` | MODIFY — `addTrack(kind, label?)` + `addClip(clip)` geben generierte ID zurück [Fix B1] |
| `components/Workspace/WorkspaceHeader.tsx` | CREATE — Projekt-Name + BPM + Preset-Packs-Button [Fix B4] |
| `components/Workspace/index.tsx` | MODIFY — flex-col-Wrapper + WorkspaceHeader [Fix D12] |
| `components/PresetPacks/PresetPackBrowser.tsx` | CREATE |
| `components/PresetPacks/PackList.tsx` | CREATE |
| `components/PresetPacks/PackCard.tsx` | CREATE — BPM-Mismatch-Badge + formatBpmReference [Fix D16] |
| `components/PresetPacks/PackDetail.tsx` | CREATE |
| `components/PresetPacks/FxRow.tsx` | CREATE — deaktivierter Preview-Button [Fix W12] |
| `components/PresetPacks/MiniCurve.tsx` | CREATE — FX_CLIP_COLORS Lookup [Fix W8] |
| `components/PresetPacks/PackSearchAndFilter.tsx` | CREATE — dynamischer Placeholder [Fix W10] |
| `docs/KNOWN_LIMITATIONS.md` | MODIFY — Preview disabled, displayTriggerLabel, Track-Rename-Caveat |

---

## Tests

**`tests/unit/presets/store-bridge.test.ts`** — ≥ 5: [Fix B1+B3+B4]
- `toClipKind('ZoomPunch')` → `'zoom-punch'`
- `findOrCreateFxTrack`: bestehender Track (t.name === fxKind) → kein neuer
- `setAutomationCurve`: erster Punkt via `convertParamToAutomation`, kein Doppelpunkt [Fix B3]
- `setAutomationCurve`: N Punkte → exakt N Punkte in Kurve (kein extra Initial-Punkt)
- `getTimelineEndBeat`: leerer Store → 64
- `formatBpmReference('any')` → 'Any BPM', `formatBpmReference(128)` → '128 BPM'

**`tests/unit/presets/apply-pack.test.ts`** — ≥ 5:
- 4 aktive FX → 4 Clips mit kebab-kind, je eigener Track [Fix B1]
- Disabled FX → kein Clip, kein Track
- Kurven-Punkte sind um `startBeat` offsettet [Fix B2]
- `params` ist defensive copy — Mutation des Clips ändert nicht Pack-Source [Fix W7]
- Zweites Apply legt weitere Clips an (Append, kein Replace) [Fix D17]

**`tests/unit/presets/save-as-preset.test.ts`** — ≥ 3:
- Kein unreachable Code (Duplikat-Return entfernt) [Fix B2]
- `timeline.clips` korrekt gelesen (nicht `clips` direkt) [Fix B1]
- localStorage round-trip

**`tests/unit/presets/built-in-packs.test.ts`** — ≥ 4:
- Alle `fxKind`-Werte sind in `PluginFxKind`-Union
- Alle AutomationPoints: beat ≥ 0, value 0–1
- `bpmReference: 0` existiert nicht ('any' für Outro) [Fix W6]
- Kein Pack hat 0 enabled FX

**`tests/unit/components/MiniCurve.test.tsx`** — ≥ 2:
- Rendert SVG-Polyline, stroke-Farbe korrekt gesetzt [Fix W8]
- Label wird gerendert

**`tests/unit/components/PackCard.test.tsx`** — ≥ 2:
- BPM außerhalb `bpmRange` → orange Badge sichtbar [Fix D16]
- BPM innerhalb → kein Badge

Mindest: **≥ 22 neue Tests**

---

## Verification Gate

Baseline: **post-8e** (CC #1 bestätigt).
Ziel: **Baseline + ≥ 22**.  <!-- [Fix D13] konsistent mit Test-Mindest -->

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**
```
# WorkspaceHeader oben sichtbar, Layout nicht gebrochen (Mobile + Desktop)
# Preset-Packs Button → Panel slide-in von rechts
# 7 Packs in Liste, Suchfeld zeigt "Search 7 packs..." (dynamisch)
# Hardstyle Drop → Detail rechts: 4 FX-Zeilen, MiniCurven sichtbar
# ContourFlash Toggle ist OFF by default
# BPM-Badge: Projekt 90 BPM, Hardstyle (128-145) → oranges Badge mit Tooltip
# "Apply Pack to Timeline" → 3 Clips (ohne ContourFlash)
# Clips haben kebab-kind (zoom-punch, nicht ZoomPunch) — DevTools prüfen
# Automation-Kurven auf Clips gesetzt (Inspector → Automate-Button aktiv)
# Zweites Apply → 3 weitere Clips (Append, kein Replace)
# Preview-Button ist deaktiviert mit Tooltip "Preview coming soon"
# Suche "lo-fi" → "Lo-Fi Breathe" sichtbar
# Filter "Outro" → nur "Outro Fade"
# "Save current setup as preset..." → User-Pack in Liste
# Pack-Placeholder nach Save: "Search 8 packs..." (dynamisch aktualisiert)
# Page-Reload: User-Pack noch sichtbar (localStorage)
```

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

**Manuelle Smoke-Tests:**
```
# Preset-Packs Button in Toolbar → Panel slide-in von rechts
# 7 Packs sichtbar in Liste
# Hardstyle Drop anklicken → Detail rechts erscheint
# 4 FX-Zeilen mit MiniCurven sichtbar (ENV/PULSE/PUNCH-Labels)
# ContourFlash Toggle ist OFF — Toggle-State korrekt
# "Apply Pack to Timeline" → 3 FX-Tracks erscheinen auf Timeline
# Toast "3 FX from Hardstyle Drop applied to timeline"
# FX-Clips haben korrekte Farben (aus FX_CLIP_COLORS)
# Automation-Kurven sind gesetzt (Inspector → Automate-Button → Kurve sichtbar)
# Filter-Tab "Outro" → nur "Outro Fade" sichtbar
# Suche "lo-fi" → "Lo-Fi Breathe" sichtbar
# "Save current setup as preset..." → Eingabe-Dialog → User-Pack erscheint in Liste
# User-Pack überlebt Page-Reload (localStorage)
# BPM-Badge zeigt aktuelles Projekt-BPM
# "Curves will be scaled to your project (X BPM)" — BPM stimmt
```

---

## Commit-Struktur

```
feat(presets): types — PluginFxKind + AutomationPoint<number>
feat(presets): store-bridge — 4 Store-APIs + kebab/Pascal-Konvertierung
feat(presets): built-in-packs — 7 kuratierte Packs
feat(presets): apply-pack — Kurven-Offset + Append-Semantik
feat(presets): save-as-preset — TRACK_FX_KINDS-Set + localStorage
feat(ui): WorkspaceHeader — Projekt-Name + BPM + Preset-Packs-Button
feat(ui): MiniCurve — SVG automation preview + FX_CLIP_COLORS lookup
feat(ui): PackCard + PackList + PackSearchAndFilter (dynamischer Placeholder)
feat(ui): PackDetail + FxRow (deaktivierter Preview-Button)
feat(ui): PresetPackBrowser — Slide-in Panel
test: store-bridge + apply + save + built-in-validation + MiniCurve + PackCard
```

---

## Out of Scope → Plan 9a-v2

- Audio-Preview im Play-Button
- Cloud Preset Marketplace (Supabase)
- Pack-Rating / Community Picks
- BPM-Feel-Scaling (tatsächliche Kurven-Transformation)
- Pack-Import via URL

---

Abgabe: `2026-05-25-vibegrid-plan-9a-preset-packs.md`
