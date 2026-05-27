import type { PresetPack } from './types';

/**
 * Plan 9a — seven curated built-in preset packs. The pack specs come
 * verbatim from the Plan-9a Rev. 3 doc; param values were tuned to
 * the Plan 8e FX defaults. fxKind stays PascalCase here — the apply
 * layer converts to kebab via `toClipKind()` before writing to clips.
 */
export const BUILT_IN_PACKS: PresetPack[] = [
  {
    id: 'hardstyle-drop',
    name: 'Hardstyle Drop',
    description:
      'Hard-hitting zoom + RGB split combo designed for drops at 128–145 BPM. ' +
      'Layers a contour flash with a screen shake punch and a sharp color sweep ' +
      'for the kick — auto-aligned to your transients.',
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
            { beat: 0.15, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'ENV',
        displayLabel: 'Camera-Shake · Beat-sync · 1/4',
        enabled: true
      },
      {
        fxKind: 'RGBSplit',
        params: { offset: 0.008, decay: 0.2, intensity: 0.7 },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.7 },
            { beat: 0.5, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/2',
        curveLabel: 'PULSE',
        displayLabel: 'Color-Sweep · Beat-sync · 1/2',
        enabled: true
      },
      {
        fxKind: 'ScreenShake',
        params: { intensity: 0.012, frequency: 3, decay: 0.08, axis: 'both' },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.88 },
            { beat: 0.08, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'PUNCH',
        displayLabel: 'Beat-Pulse · Beat-sync · 1/4',
        enabled: true
      },
      {
        fxKind: 'BeatFlash',
        params: {
          intensity: 0.4,
          color: '#ffffff',
          duration: 0.06,
          blendMode: 'screen'
        },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.4 },
            { beat: 0.06, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/6',
        curveLabel: 'PUNCH',
        displayLabel: 'Edge-Detect · Beat-sync · 1/6',
        enabled: false
      }
    ]
  },
  {
    id: 'cinematic-pulse',
    name: 'Cinematic Pulse',
    description:
      'Slow-burn vignette breathe with lens flare on the downbeat. ' +
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
      {
        fxKind: 'VignetteBreathe',
        params: {
          baseSize: 0.1,
          peakSize: 0.5,
          intensity: 0.8,
          decay: 0.6,
          color: '#000000'
        },
        automationCurves: {
          peakSize: [
            { beat: 0, value: 0.5 },
            { beat: 0.6, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/1',
        curveLabel: 'BREATHE',
        displayLabel: 'Vignette · Breathe · 1/1',
        enabled: true
      },
      {
        fxKind: 'LensFlareBurst',
        params: {
          intensity: 0.5,
          rayCount: 8,
          rayLength: 0.4,
          centerX: 0.5,
          centerY: 0.5,
          decay: 0.3,
          color: '#a86bff'
        },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.5 },
            { beat: 0.3, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/2',
        curveLabel: 'FLARE',
        displayLabel: 'Lens Flare · Beat-sync · 1/2',
        enabled: true
      },
      {
        fxKind: 'LetterboxSqueeze',
        params: {
          targetRatio: '2.35:1',
          attack: 0.05,
          decay: 0.8,
          intensity: 0.7,
          color: '#000000'
        },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.7 },
            { beat: 0.8, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/1',
        curveLabel: 'SQUEEZE',
        displayLabel: 'Letterbox · Cinematic · 1/1',
        enabled: true
      },
      {
        fxKind: 'ZoomPunch',
        params: { strength: 1.06, attack: 0.05, decay: 0.4, direction: 'in' },
        automationCurves: {
          strength: [
            { beat: 0, value: 0.3 },
            { beat: 0.4, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/2',
        curveLabel: 'ENV',
        displayLabel: 'Soft Push · Beat-sync · 1/2',
        enabled: true
      },
      {
        fxKind: 'FilmGrainBurst',
        params: { intensity: 0.25, decay: 0.3, grainSize: 2, colorMode: 'white' },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.25 },
            { beat: 0.3, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'GRAIN',
        displayLabel: 'Film Grain · Ambient · 1/4',
        enabled: false
      }
    ]
  },
  {
    id: 'lofi-breathe',
    name: 'Lo-Fi Breathe',
    description:
      'Warm vignette pulse with subtle grain. ' +
      'Perfect for lo-fi hip hop and chill beats at 70–90 BPM.',
    category: 'Verse',
    tags: ['LO-FI', 'CHILL', 'WARM', '70-90 BPM'],
    bpmReference: 80,
    bpmRange: [70, 90],
    recommendedBars: 8,
    isCurated: true,
    source: 'built-in',
    fx: [
      {
        fxKind: 'VignetteBreathe',
        params: {
          baseSize: 0.2,
          peakSize: 0.45,
          intensity: 0.6,
          decay: 0.8,
          color: '#1a0a00'
        },
        automationCurves: {
          peakSize: [
            { beat: 0, value: 0.45 },
            { beat: 0.8, value: 0.1 }
          ]
        },
        displayTriggerLabel: '1/1',
        curveLabel: 'BREATHE',
        displayLabel: 'Warm Vignette · 1/1',
        enabled: true
      },
      {
        fxKind: 'FilmGrainBurst',
        params: { intensity: 0.2, decay: 0.5, grainSize: 2, colorMode: 'colored' },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.2 },
            { beat: 0.5, value: 0.05 }
          ]
        },
        displayTriggerLabel: '1/2',
        curveLabel: 'GRAIN',
        displayLabel: 'Analog Grain · 1/2',
        enabled: true
      },
      {
        fxKind: 'LetterboxSqueeze',
        params: {
          targetRatio: '1.85:1',
          attack: 0.1,
          decay: 1.0,
          intensity: 0.5,
          color: '#000000'
        },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.5 },
            { beat: 1.0, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/1',
        curveLabel: 'BARS',
        displayLabel: 'Soft Letterbox · 1/1',
        enabled: true
      }
    ]
  },
  {
    id: 'pop-energy',
    name: 'Pop Energy',
    description:
      'High-energy flash combo for pop drops. ' +
      'RGB split on the snare, zoom on the kick, glitch on the bridge.',
    category: 'Drop',
    tags: ['POP', 'ENERGETIC', 'BRIGHT', '115-130 BPM'],
    bpmReference: 120,
    bpmRange: [115, 130],
    recommendedBars: 4,
    isCurated: true,
    source: 'built-in',
    fx: [
      {
        fxKind: 'BeatFlash',
        params: {
          intensity: 0.6,
          color: '#ffffff',
          duration: 0.08,
          blendMode: 'screen'
        },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.6 },
            { beat: 0.08, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'FLASH',
        displayLabel: 'Beat Flash · 1/4',
        enabled: true
      },
      {
        fxKind: 'ZoomPunch',
        params: { strength: 1.1, attack: 0.02, decay: 0.1, direction: 'in' },
        automationCurves: {
          strength: [
            { beat: 0, value: 0.8 },
            { beat: 0.1, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'PUNCH',
        displayLabel: 'Kick Zoom · 1/4',
        enabled: true
      },
      {
        fxKind: 'RGBSplit',
        params: { offset: 0.006, decay: 0.12, intensity: 0.5 },
        automationCurves: {
          intensity: [
            { beat: 0.5, value: 0.5 },
            { beat: 0.62, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/2',
        curveLabel: 'RGB',
        displayLabel: 'Snare Split · 1/2',
        enabled: true
      },
      {
        fxKind: 'ScreenShake',
        params: { intensity: 0.006, frequency: 4, decay: 0.06, axis: 'x' },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.5 },
            { beat: 0.06, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'SHAKE',
        displayLabel: 'Kick Shake · 1/4',
        enabled: true
      },
      {
        fxKind: 'LensFlareBurst',
        params: {
          intensity: 0.3,
          rayCount: 6,
          rayLength: 0.3,
          centerX: 0.5,
          centerY: 0.3,
          decay: 0.15,
          color: '#5a8fff'
        },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.3 },
            { beat: 0.15, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'FLARE',
        displayLabel: 'Hi-Hat Flare · 1/4',
        enabled: false
      },
      {
        fxKind: 'VignetteBreathe',
        params: {
          baseSize: 0.05,
          peakSize: 0.25,
          intensity: 0.5,
          decay: 0.2,
          color: '#000000'
        },
        automationCurves: {
          peakSize: [
            { beat: 0, value: 0.25 },
            { beat: 0.2, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'VIG',
        displayLabel: 'Vignette Pulse · 1/4',
        enabled: false
      }
    ]
  },
  {
    id: 'retro-vhs',
    name: 'Retro VHS',
    description:
      'Warm grain + RGB drift for that 80s/90s camcorder aesthetic. ' +
      'Works at any tempo — the grain breathes continuously.',
    category: 'Verse',
    tags: ['RETRO', 'VHS', 'ANALOG', 'ANY BPM'],
    bpmReference: 110,
    bpmRange: [80, 140],
    recommendedBars: 8,
    isCurated: true,
    source: 'built-in',
    fx: [
      {
        fxKind: 'FilmGrainBurst',
        params: { intensity: 0.35, decay: 0.5, grainSize: 2, colorMode: 'colored' },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.35 },
            { beat: 0.5, value: 0.1 }
          ]
        },
        displayTriggerLabel: '1/2',
        curveLabel: 'GRAIN',
        displayLabel: 'VHS Grain · 1/2',
        enabled: true
      },
      {
        fxKind: 'RGBSplit',
        params: { offset: 0.003, decay: 0.4, intensity: 0.3 },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.3 },
            { beat: 0.4, value: 0.05 }
          ]
        },
        displayTriggerLabel: '1/1',
        curveLabel: 'DRIFT',
        displayLabel: 'Color Drift · 1/1',
        enabled: true
      },
      {
        fxKind: 'VignetteBreathe',
        params: {
          baseSize: 0.3,
          peakSize: 0.5,
          intensity: 0.7,
          decay: 1.0,
          color: '#000000'
        },
        automationCurves: {
          peakSize: [
            { beat: 0, value: 0.5 },
            { beat: 1.0, value: 0.3 }
          ]
        },
        displayTriggerLabel: '1/1',
        curveLabel: 'VIG',
        displayLabel: 'CRT Vignette · 1/1',
        enabled: true
      },
      {
        fxKind: 'ScreenShake',
        params: { intensity: 0.002, frequency: 1, decay: 1.0, axis: 'both' },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.15 },
            { beat: 1.0, value: 0.05 }
          ]
        },
        displayTriggerLabel: '1/1',
        curveLabel: 'WOBBLE',
        displayLabel: 'Tape Wobble · 1/1',
        enabled: false
      }
    ]
  },
  {
    id: 'glitch-storm',
    name: 'Glitch Storm',
    description:
      'Maximum digital distortion for experimental edits. ' +
      'Slice + split + shake in rapid succession at 140+ BPM.',
    category: 'Drop',
    tags: ['GLITCH', 'EXPERIMENTAL', 'AGGRESSIVE', '135-160 BPM'],
    bpmReference: 140,
    bpmRange: [135, 160],
    recommendedBars: 2,
    isCurated: true,
    source: 'built-in',
    fx: [
      {
        fxKind: 'GlitchSlice',
        params: { sliceCount: 6, maxOffset: 0.025, decay: 0.06, seed: 42, axis: 'h' },
        automationCurves: {
          maxOffset: [
            { beat: 0, value: 1.0 },
            { beat: 0.06, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'SLICE',
        displayLabel: 'Glitch Slice · 1/4',
        enabled: true
      },
      {
        fxKind: 'RGBSplit',
        params: { offset: 0.015, decay: 0.08, intensity: 0.9 },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.9 },
            { beat: 0.08, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'SPLIT',
        displayLabel: 'RGB Split · 1/4',
        enabled: true
      },
      {
        fxKind: 'ScreenShake',
        params: { intensity: 0.02, frequency: 4, decay: 0.05, axis: 'both' },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.8 },
            { beat: 0.05, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'SHAKE',
        displayLabel: 'Digital Shake · 1/4',
        enabled: true
      },
      {
        fxKind: 'BeatFlash',
        params: {
          intensity: 0.5,
          color: '#2ee0d0',
          duration: 0.04,
          blendMode: 'screen'
        },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.5 },
            { beat: 0.04, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/8',
        curveLabel: 'FLASH',
        displayLabel: 'Cyber Flash · 1/8',
        enabled: true
      },
      {
        fxKind: 'ZoomPunch',
        params: { strength: 1.08, attack: 0.01, decay: 0.05, direction: 'in' },
        automationCurves: {
          strength: [
            { beat: 0, value: 0.6 },
            { beat: 0.05, value: 0.0 }
          ]
        },
        displayTriggerLabel: '1/4',
        curveLabel: 'ZOOM',
        displayLabel: 'Micro Punch · 1/4',
        enabled: false
      }
    ]
  },
  {
    id: 'outro-fade',
    name: 'Outro Fade',
    description:
      'Gentle vignette close with letterbox squeeze. ' +
      'Designed for endings — works at any BPM.',
    category: 'Outro',
    tags: ['OUTRO', 'FADE', 'CALM', 'ANY BPM'],
    bpmReference: 'any',
    recommendedBars: 16,
    isCurated: true,
    source: 'built-in',
    fx: [
      {
        fxKind: 'VignetteBreathe',
        params: {
          baseSize: 0.3,
          peakSize: 0.7,
          intensity: 0.9,
          decay: 2.0,
          color: '#000000'
        },
        automationCurves: {
          peakSize: [
            { beat: 0, value: 0.0 },
            { beat: 4, value: 0.7 }
          ]
        },
        displayTriggerLabel: '1/1',
        curveLabel: 'FADE',
        displayLabel: 'Dark Vignette · Fade-In',
        enabled: true
      },
      {
        fxKind: 'LetterboxSqueeze',
        params: {
          targetRatio: '2.35:1',
          attack: 0.5,
          decay: 4.0,
          intensity: 1.0,
          color: '#000000'
        },
        automationCurves: {
          intensity: [
            { beat: 0, value: 0.0 },
            { beat: 4, value: 1.0 }
          ]
        },
        displayTriggerLabel: '1/1',
        curveLabel: 'BARS',
        displayLabel: 'Cinematic Close',
        enabled: true
      }
    ]
  }
];
