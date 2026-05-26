# CC #1 Prompt — Schreibe Plan 5.10: Responsive Mobile Layout

## Kontext

Du arbeitest an **VibeGrid** (`C:\_Dev\VibeGrid`).

Plan 5.9c ist abgeschlossen. Baseline: aktueller HEAD nach 5.9c.

Schreibe nur den **Plan** — noch keinen Code.

---

## Was Plan 5.10 leistet

**Adaptives Layout:** Desktop bleibt exakt wie heute. Mobile (≤ 768px)
bekommt ein eigenes Layout das auf Touch optimiert ist. Keine
Kompromisse in beide Richtungen — zwei separate Layout-Pfade,
eine gemeinsame Logik-Schicht.

Ziel: VibeGrid ist auf einem modernen Smartphone vollständig bedienbar.
Kein Horizontal-Scrollen, keine 4px-Touch-Targets, kein versteckter Content.

---

## Breakpoint-Definition

```ts
// lib/utils/breakpoints.ts
export const MOBILE_BREAKPOINT = 768; // px

// Hook:
export function useIsMobile(): boolean {
  // window.matchMedia('(max-width: 768px)')
  // ResizeObserver auf document.body als Fallback
  // SSR-safe: default false
}
```

Tailwind-Klassen: `md:` Prefix = Desktop-only. Alles ohne Prefix = Mobile-first.

---

## Mobile Layout-Struktur

```
┌─────────────────────────────┐
│  TopBar (komprimiert)       │  ← 48px hoch
├─────────────────────────────┤
│                             │
│  Canvas Stage               │  ← 40vh, fixiert oben
│                             │
├─────────────────────────────┤
│  Tab-Bar                    │  ← 48px, fixiert
│  [Timeline] [Media] [FX]    │
├─────────────────────────────┤
│                             │
│  Aktiver Tab-Inhalt         │  ← Rest der Höhe, scrollbar
│  (Timeline / Media / FX)   │
│                             │
└─────────────────────────────┘
│  Inspector Bottom Sheet     │  ← Slide-up, 0→50vh
└─────────────────────────────┘
```

---

## Feature 1 — TopBar Mobile

Desktop-TopBar bleibt unverändert. Mobile:

```tsx
// components/TopBar/index.tsx — mobile variant:
// - Logo links (klein, 24px)
// - Play/Pause Button zentriert (44px Touch-Target)
// - Export-Button rechts (Icon only, kein Label)
// - BPM-Display als Tap-to-Edit (kein sichtbares Input bis Tap)
// - Flow-Mode-Toggle: Icon only
// - REC-Indicator: roter Dot ohne Timecode-Text (zu eng)
```

Touch-Target Minimum: **44×44px** für alle interaktiven Elemente
(Apple HIG + Android Material). Kein Element kleiner.

---

## Feature 2 — Tab-Bar (Mobile Navigation)

Neue Komponente `components/Mobile/TabBar.tsx`:

```tsx
type MobileTab = 'timeline' | 'media' | 'fx';

// Icons: Timeline = ≡, Media = ⊞, FX = ✦
// Aktiver Tab: --a1 Farbe, inaktiv: --text-muted
// Position: sticky bottom-0, über dem Inspector wenn offen
```

State: `useIsMobile() ? mobileTab : null` — kein Tab-State auf Desktop.

---

## Feature 3 — Canvas Stage Mobile

```tsx
// components/Workspace/Stage/index.tsx
// Mobile: height: 40vh, width: 100vw
// Desktop: unverändert (flex-grow)

// Kein Eingriff in Canvas-Rendering-Logik —
// Canvas-Größe via ResizeObserver wie heute
```

---

## Feature 4 — Timeline Mobile

Die Timeline ist das komplexeste Element. Auf Mobile:

**Horizontales Scrollen:** Timeline scrollt horizontal mit dem Finger.
`touch-action: pan-x` auf dem Timeline-Container.

**Track-Höhe:** 56px statt 32px (größere Touch-Targets für Clips).

**Clip-Drag:** Pointer Events sind bereits implementiert — funktioniert
auf Touch. Kein neuer Code für das Dragging selbst.

**Ruler:** Tap auf Ruler → Playhead setzen (bereits implementiert ✅).

**Track-Labels:** Nur Icon + erste 4 Zeichen des Namens. Kein Mute-Button
sichtbar (via Long-Press öffnen oder in separatem Menu).

**Zoom:** Pinch-to-Zoom auf der Timeline:
```ts
// Two-finger pinch → timeline.zoom anpassen
// Gleiche Zoom-Action wie Desktop-Scroll
// lib/hooks/useTimelinePinchZoom.ts
```

**AutomationLane:** Auf Mobile ausgeblendet (read-only Preview zu eng).
"Open editor" Button öffnet AutomationEditorModal — das Modal ist
bereits fullscreen und funktioniert auf Mobile ✅.

---

## Feature 5 — MediaLibrary Mobile

Auf Mobile: als **Drawer** (Slide-up Panel) statt Side-Panel.

```tsx
// components/Mobile/MediaDrawer.tsx
// Aktiv wenn Tab 'media' aktiv
// Höhe: 60vh, drag-to-dismiss via Pointer-Events
// Inhalt: identisch mit Desktop-MediaLibrary (keine neue Logik)
```

Drag aus MediaDrawer auf Timeline: Touch-Drag-and-Drop. Das bestehende
`@dnd-kit`-Setup unterstützt Touch über `TouchSensor` — prüfen ob
`TouchSensor` bereits konfiguriert ist, falls nicht: hinzufügen.

---

## Feature 6 — FX-Library Mobile

Auf Mobile: als Drawer (identisches Pattern wie MediaDrawer).

```tsx
// components/Mobile/FXDrawer.tsx
// Aktiv wenn Tab 'fx' aktiv
// FX-Cards: 2-Spalten-Grid statt Liste
// Tap auf FX: direkt auf aktiven FX-Track hinzufügen
//   (kein Drag nötig — "add to active track" Button)
```

"Add to active track" weil Drag-from-FX-Library-onto-Track auf Mobile
schwierig ist (kleines Ziel). Stattdessen: Tap öffnet
"Zu welchem FX-Track?" Dialog wenn mehrere vorhanden.

---

## Feature 7 — Inspector Bottom Sheet

Inspector öffnet auf Mobile als **Bottom Sheet** (Slide-up):

```tsx
// components/Mobile/InspectorSheet.tsx
// Trigger: Tap auf Clip in Timeline → öffnet Sheet
// Höhe: 0 → 50vh (CSS transition)
// Drag-Handle oben zum Schließen
// Inhalt: identisch mit Desktop-Inspector (keine neue Param-Logik)
// Schließen: Drag-down, Tap außerhalb, oder Escape
```

```ts
// lib/hooks/useInspectorSheet.ts
// isOpen: selectedClipId !== null && isMobile
// onClose: store.setSelectedClipId(null)
```

---

## Feature 8 — Touch Sensor für dnd-kit

```ts
// app/(studio)/layout.tsx oder DndContext-Wrapper:
import { TouchSensor, MouseSensor, useSensor, useSensors } from '@dnd-kit/core';

const sensors = useSensors(
  useSensor(MouseSensor),
  useSensor(TouchSensor, {
    activationConstraint: {
      delay: 150,      // ms — verhindert Scroll-Konflikt
      tolerance: 8,    // px — kleine Bewegung erlaubt vor Aktivierung
    },
  })
);
```

`delay: 150` ist wichtig — ohne Delay würde jeder Scroll-Versuch
einen Drag starten.

---

## Was NICHT geändert wird

- Desktop-Layout: **kein einziger Pixel** verändert
- Canvas-Rendering-Logik: unverändert
- Store: unverändert (kein mobiler State)
- FX-Plugins: unverändert
- Export-Pipeline: unverändert
- Automation-Kurven-Logik: unverändert (Modal bereits fullscreen ✅)

---

## CSS-Strategie

Mobile-first mit Tailwind:

```tsx
// Beispiel Track-Höhe:
<div className="h-14 md:h-8 ...">  // 56px mobile, 32px desktop

// Beispiel TopBar:
<div className="flex items-center px-3 md:px-6 h-12 md:h-10 ...">
```

Kein separates CSS-File. Keine Media-Query-Strings im TS-Code
(nur `useIsMobile()` Hook für Layout-Switching in TSX).

---

## File Map

| Datei | Aktion |
|---|---|
| `lib/utils/breakpoints.ts` | Create — `MOBILE_BREAKPOINT` + `useIsMobile` |
| `components/Mobile/TabBar.tsx` | Create |
| `components/Mobile/MediaDrawer.tsx` | Create |
| `components/Mobile/FXDrawer.tsx` | Create |
| `components/Mobile/InspectorSheet.tsx` | Create |
| `lib/hooks/useInspectorSheet.ts` | Create |
| `lib/hooks/useTimelinePinchZoom.ts` | Create |
| `components/TopBar/index.tsx` | Modify — mobile variant |
| `components/Workspace/Stage/index.tsx` | Modify — 40vh mobile |
| `components/Workspace/Timeline/index.tsx` | Modify — mobile scroll + track height |
| `components/Workspace/Timeline/Track.tsx` | Modify — 56px height + label truncation |
| `app/(studio)/layout.tsx` | Modify — TouchSensor + TabBar mount |
| `dnd-context` (wherever it lives) | Modify — TouchSensor hinzufügen |

---

## Tests

**`tests/unit/utils/breakpoints.test.ts`** — ≥ 3:
- `useIsMobile` gibt `false` bei 1024px
- `useIsMobile` gibt `true` bei 375px
- SSR-safe: kein `window`-Zugriff beim ersten Render

**`tests/unit/components/Mobile/TabBar.test.tsx`** — ≥ 3:
- Rendert nur auf Mobile (isMobile = true)
- Tab-Wechsel ändert aktiven Tab
- Aktiver Tab hat korrektes ARIA-Attribut

**`tests/unit/components/Mobile/InspectorSheet.test.tsx`** — ≥ 3:
- Sheet öffnet wenn selectedClipId gesetzt + isMobile
- Sheet schließt bei setSelectedClipId(null)
- Rendert Inspector-Inhalt korrekt

**`tests/unit/hooks/useTimelinePinchZoom.test.ts`** — ≥ 3:
- Pinch-in reduziert zoom
- Pinch-out erhöht zoom
- Zoom bleibt innerhalb Min/Max-Grenzen

Mindest: **≥ 12 neue Tests**

---

## Verification Gate

Baseline: aktueller HEAD nach 5.9c.
Ziel: **≥ Baseline + 12 Tests**.

```powershell
npm test -- --run    # 0 failing
npm run typecheck
npm run lint
npm run build        # Bundle ≤ Baseline + 8% (neue Mobile-Komponenten)
```

**Pflicht: Manuelle Smoke-Tests auf echtem Gerät oder DevTools Mobile:**

```
Chrome DevTools → iPhone 15 Pro (393×852px)
# TopBar: Play-Button 44px, Export-Icon sichtbar, kein Overflow
# Canvas: 40vh, scharf (DPR-Fix aktiv)
# Tab-Bar: Timeline/Media/FX umschaltbar
# Timeline-Tab: horizontal scrollbar, Clips mit Finger verschiebbar
# Clip antippen → Inspector Bottom Sheet öffnet
# Inspector: Slider mit Finger bedienbar (44px Touch-Target)
# Media-Tab: Upload-Button, bestehende Assets als Thumbnails
# FX-Tab: FX-Cards in 2-Spalten-Grid
# Pinch-to-Zoom auf Timeline: zoom ändert sich

Chrome DevTools → Desktop (1440px)
# Desktop-Layout EXAKT wie vor Plan 5.10 — kein einziger Pixel verändert
```

---

## Commit-Struktur

```
feat(mobile): useIsMobile hook + MOBILE_BREAKPOINT
feat(mobile): TabBar component + mobile navigation state
feat(mobile): TopBar mobile variant — compact, 44px touch targets
feat(mobile): Stage 40vh on mobile
feat(mobile): Timeline mobile — pan-x scroll + 56px tracks + pinch zoom
feat(mobile): MediaDrawer + FXDrawer slide-up panels
feat(mobile): InspectorSheet bottom sheet
feat(dnd): TouchSensor with 150ms delay activation
test: breakpoints + TabBar + InspectorSheet + pinch zoom
```

---

## Out of Scope

- Capacitor iOS/Android Build (v0.2)
- Swipe-Gestures für Tab-Navigation (v0.2)
- Mobile-spezifische Onboarding-Flows (v0.2)
- Portrait/Landscape-Lock (v0.2 — App Store Requirement)
- Keyboard-Handling auf Mobile (virtuelles Keyboard verschiebt Layout —
  separates Problem, in v0.2 mit Capacitor addressieren)

Abgabe: `2026-05-21-vibegrid-plan-5_10-responsive-mobile.md`
