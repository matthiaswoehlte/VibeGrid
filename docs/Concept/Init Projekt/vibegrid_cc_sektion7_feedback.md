# CC Feedback — Design Sektion 7: UI-Komponenten & Layout

✅ Freigegeben mit folgenden Ergänzungen und einem Bug:

## Bug: CanvasView — Canvas-Dimensionen vs. CSS-Dimensionen

ResizeObserver setzt CSS-Größe, aber Canvas-Pixel-Dimensionen
sind davon getrennt. Klassischer Fehler der zu Blur führt:

```typescript
// CanvasView.tsx — ResizeObserver Callback:
const observer = new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect;
  const dpr = window.devicePixelRatio ?? 1;

  // BEIDE müssen gesetzt werden:
  canvas.width = Math.round(width * dpr);   // Pixel-Dimensionen
  canvas.height = Math.round(height * dpr);

  // CSS-Dimensionen bleiben wie vom Layout definiert
  // ctx.scale(dpr, dpr) im Renderer-Init aufrufen
});
```

Renderer-Init muss `ctx.scale(dpr, dpr)` einmalig nach Resize aufrufen.
Sonst wird alles auf Retina-Displays unscharf gerendert.

## Bug: Waveform.tsx — Decoding blockiert Main Thread

"SVG waveform from decoded audio" klingt nach synchronem Processing.
AudioBuffer-Decoding für Waveform-Visualisierung muss im Web Worker
laufen — nicht im Main Thread:

```typescript
// Waveform.tsx darf NICHT selbst decodeAudioData aufrufen.
// AudioEngine liefert bereits den dekodedten AudioBuffer.
// Waveform-Downsampling (z.B. auf 1000 Datenpunkte) im Worker:

// lib/audio/waveform-worker.ts
// Input: Float32Array (channel data)
// Output: Float32Array (downsampled peaks min/max)
// Waveform.tsx empfängt nur die fertigen SVG-Pfad-Daten
```

## Ergänzung: Drag & Drop für ClipView — Library festlegen

`ClipView.tsx` — draggable + resizable Handles. Das ist nicht trivial
mit Pointer-Events selbst implementiert. Entscheidung jetzt treffen:

```
Empfehlung: @dnd-kit/core für Clip-Drag (Timeline-Horizontal)
+ custom Pointer-Event-Handler nur für Resize-Handles (rechte Kante)

Begründung:
- dnd-kit ist touch-kompatibel (Pointer-Events intern) → kein v0.2-Refactor
- Keyboard-Accessibility gratis
- Kein Konflikt mit Playhead-Click auf TrackBody

NICHT: react-beautiful-dnd (veraltet, kein Touch)
NICHT: HTML5 drag-and-drop API (kein Touch-Support)
```

## Ergänzung: Toast-Provider fehlt im Komponenten-Baum

Toast wird in Export, Upload, Overlap-Validation, Performance-Warning
genutzt — aber kein Toast-Provider im Layout definiert.

```typescript
// app/(studio)/layout.tsx muss enthalten:
import { Toaster } from '@/components/ui/Toast';

export default function StudioLayout({ children }) {
  return (
    <>
      {children}
      <Toaster position="bottom-right" />  {/* global, einmalig */}
    </>
  );
}

// Empfohlene Library: sonner (von Emile Caron)
// - minimal, schön, Tailwind-kompatibel
// - kein Context/Provider-Overhead
```

## Ergänzung: Error Boundaries fehlen

Canvas-Renderer und Audio-Engine können werfen. Ohne Error Boundary
crasht die gesamte App auf einen unbehandelten Fehler.

```typescript
// Mindestens zwei Error Boundaries:

// 1. Um <CanvasView> + <Stage>:
//    Fallback: "Renderer error — reload to continue" + Error-Details

// 2. Um <Timeline>:
//    Fallback: "Timeline error — project state may be corrupted"

// components/ErrorBoundary.tsx als generische Klassen-Komponente
// (Error Boundaries müssen Class Components sein in React)
```

## Ergänzung: Inspector — Collapsible auf Tablet

Responsive Strategy definiert 640-1024px als 2-column mit
"Inspector hidden behind toggle" — aber kein Toggle-Button definiert.

```typescript
// Workspace.tsx Ergänzung:
// Bei 640-1024px: Inspector-Panel als Slide-Over von rechts
// Toggle-Button: kleines Tab-Icon am rechten Rand der Stage
// Zustand: inspectorOpen boolean im lokalen UI-State (nicht im Store)
```

## Kleinigkeit: Space Grotesk + JetBrains Mono — Variable Fonts prüfen

```typescript
// next/font/google — Variable Font Subset für Performance:
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

// Beide als variable auf <html> setzen — Tailwind font-sans / font-mono
// referenzieren dann die CSS-Variablen automatisch
```

## Bestätigung: Was explizit gut ist ✅

- Pointer-Events statt Mouse-Events für Canvas + Timeline — richtig
- Mobile als minimaler Fallback jetzt, voll in v0.2 — konsistent mit
  unserer Entscheidung
- Permanent Dark Mode ohne dark:-Prefixe — sauber
- data-accent-Attribut für Theme-Switching — elegant
- TweaksPanel für v0.1 weglassen — richtige Priorität
