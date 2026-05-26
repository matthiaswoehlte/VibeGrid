# CC Feedback — Plan 5.10: Responsive Mobile Layout

❌ **Nicht freigegeben** — 3 kritische Bugs müssen vor Implementierungsstart behoben werden.

---

## Kritische Bugs (MUSS gefixt werden)

### Bug 1 — MobileTab-State ist nirgendwo definiert

**Problem:**  
Der Plan nennt `useIsMobile() ? mobileTab : null` als Konzept, aber
`mobileTab` hat keinen Home. Die File-Map listet keinen Store-Change auf —
und unter "Was NICHT geändert wird" steht explizit: **"Store: unverändert"**.

`TabBar`, `MediaDrawer`, `FXDrawer` und `Timeline` müssen alle auf den
aktiven Tab reagieren. Wenn der State lokal in `layout.tsx` sitzt, brauchen
alle Kinder Prop-Drilling durch 3–4 Schichten. Wenn er in einem neuen
React-Context sitzt, fehlt der Context in der File-Map.

**Fix:**  
Entscheidung treffen und dokumentieren — empfohlen: minimaler
`useMobileUIStore` (Zustand-Slice) mit `mobileTab: MobileTab` +
`setMobileTab`. Oder alternativ: `MobileLayoutContext` mit klarer Location
(`components/Mobile/MobileLayoutProvider.tsx`). Beides ist OK — aber eines
muss in die File-Map.

---

### Bug 2 — "Active FX Track" ist kein existierendes Konzept

**Problem:**  
`FXDrawer.tsx` soll einen Button "Zu welchem FX-Track?" anzeigen wenn
mehrere FX-Tracks vorhanden sind. Aber: Der Store kennt kein
`activeTrackId` / `selectedTrackId`. Der Plan beschreibt ein neues
State-Konzept, ohne es zu definieren.

Das ist **nicht implementierbar** wie beschrieben — CC #1 muss entweder
ein `selectedTrackId` im Store erfinden (= Store-Change, der nicht im Plan
steht) oder eine Ad-hoc-Lösung bauen, die spätere Pläne bricht.

**Fix:**  
Explizit festlegen: Was ist "active FX Track"?  
Option A: `selectedClipId`-Track wird der Target-Track (wenn ein FX-Clip
selektiert ist).  
Option B: Neues `selectedTrackId: string | null` im Store (kleiner Bump).  
Option C: FXDrawer öffnet immer einen Dialog der alle FX-Tracks listed.

Option C ist am einfachsten und braucht keinen neuen Store-State. Empfehlung:
Option C. Im Plan so dokumentieren.

---

### Bug 3 — `touch-action: pan-x` killt vertikales Track-Scrollen

**Problem:**  
Der Plan schreibt `touch-action: pan-x` auf den "Timeline-Container".
Bei vielen Tracks (z.B. 6–8 Audio + FX) muss der User auch **vertikal**
scrollen. `touch-action: pan-x` auf dem äußersten Container sperrt das
komplett — kein `overflow-y: auto` mehr touchbar.

Außerdem: dnd-kit mit `TouchSensor` benötigt `touch-action: none` auf
draggable Elementen, nicht `pan-x` auf dem Container. Das führt zu
Konflikt: Scroll vs. Drag entscheidet der Browser falsch.

**Fix:**  
`touch-action: pan-x` nur auf dem **inneren horizontalen Scroll-Viewport**
(die Clip-Area, nicht die Track-Label-Spalte).  
Äußerer Timeline-Container: `overflow-y: auto`, kein `touch-action`-Override.  
Draggable Clips: dnd-kit setzt `touch-action: none` intern — kein
manuelles Override nötig.

---

## Anmerkungen (sollte gefixt werden, aber kein Blocker)

### 4 — SSR Hydration Flash auf Mobile

`useIsMobile()` mit `default: false` beim Server-Render bedeutet: der
erste Paint zeigt immer Desktop-Layout, dann springt JS auf Mobile.
Auf einem iPhone gibt es einen Layout-Shift (Tab-Bar erscheint, Canvas
springt auf 40vh).

**Empfehlung:** Initial-Layout via CSS `@media (max-width: 768px)` —
mindestens für Tab-Bar (`hidden md:flex` / `flex md:hidden`). Der
`useIsMobile()`-Hook nur für Logic-Branching in TSX (Drawer open/close etc),
nicht für CSS-Klassen-Toggling.

---

### 5 — `ResizeObserver` auf `document.body` ist ein Anti-Pattern

`ResizeObserver` auf `document.body` misst Body-Dimension, nicht Viewport.
Das ist nicht dasselbe (z.B. bei einem offenen Keyboard auf iOS).

**Fix:** Fallback unnötig — `window.matchMedia(...).addEventListener('change', cb)`
ist seit 2018 universell stabil. Einfach:

```ts
const mq = window.matchMedia('(max-width: 768px)');
mq.addEventListener('change', handler);
return () => mq.removeEventListener('change', handler);
```

---

### 6 — Z-Index-Schichtung für Drawers/Sheets fehlt komplett

Kein einziges `z-index` erwähnt. Tab-Bar, InspectorSheet (50vh),
MediaDrawer (60vh) und FXDrawer (60vh) können sich überlappen. Vorschlag:

```
z-10  Canvas Stage
z-20  Timeline
z-30  Tab-Bar
z-40  Drawer Backdrop (semi-transparent)
z-50  Drawer / InspectorSheet Panel
z-60  Modals (AutomationEditorModal, bereits vorhanden)
```

Im Plan dokumentieren, damit CC #1 nicht adhoc z-indices vergibt.

---

### 7 — Tap-vs-Drag-Ambiguity auf Clips ist nicht aufgelöst

TouchSensor aktiviert nach 150ms. Aber: Wann öffnet der Inspector?
Wenn `onPointerDown` sofort `selectedClipId` setzt → öffnet
InspectorSheet bei JEDEM Touch-Start, auch bei Drag-Gesten. Das ist falsch.

**Fix:** Inspector öffnet bei `pointerUp` ohne vorherige Bewegung (< 8px
tolerance). In `useInspectorSheet` dokumentieren:  
`isOpen = selectedClipId !== null && isMobile && !isDragging`.
`isDragging` aus dnd-kit's `useDndMonitor`.

---

### 8 — `useTimelinePinchZoom` — Implementation-Tiefe unklar

"Two-finger pinch → timeline.zoom anpassen" ist eine 3-Zeilen-Beschreibung
für ein ~80-Zeilen-Hook. Pinch aus raw Pointer Events:
- `pointerId` tracking für genau 2 aktive Pointer
- Distanz-Delta zwischen Pointer-Positionen
- Zoom-Zentrum (Midpoint) als Pivot für `scrollLeft`-Adjustment
- `touch-action: none` auf dem Pinch-Target nötig (Konflikt mit Bug 3!)

Ohne diese Details schreibt CC #1 wahrscheinlich einen halb-funktionalen
Hook. **Empfehlung:** Entweder die Implementation-Steps ausschreiben ODER
`useGesture` aus `@use-gesture/react` (0-dep, tree-shakable) einsetzen und
als neue Dep nennen.

---

### 9 — "AutomationLane ausgeblendet" — kein Button-Placement definiert

Der Plan sagt: AutomationLane auf Mobile verstecken + "Open editor" Button
zeigen. Aber in `Track.tsx` — wo genau? Im Track-Header? Als Overlay
über den Clips? Als eigene Zeile unter den Clips?

Ohne Placement-Definition baut CC #1 etwas Beliebiges. Da `Track.tsx` in
der File-Map steht, gehört hier eine Zeile dazu:
z.B. `{isMobile && clip.hasAutomation && <OpenEditorButton />}` in der
Track-Footer-Area.

---

### 10 — Test-Lücke: Desktop-Invariante nicht getestet

Die Tests prüfen: TabBar rendert auf Mobile (`isMobile=true`).  
Aber kein Test: TabBar rendert **nicht** auf Desktop (`isMobile=false`).

Das ist der kritische Gate für "Desktop-Layout unverändert". Muss als
verpflichtender Test rein:

```ts
it('renders nothing on desktop', () => {
  mockUseIsMobile.mockReturnValue(false);
  const { container } = render(<TabBar ... />);
  expect(container).toBeEmptyDOMElement();
});
```

---

## Was gut ist ✅

- **Zwei klare Layout-Pfade** — "kein Kompromiss in beide Richtungen"
  ist die richtige Architektur-Entscheidung. Tailwind `md:`-Prefix-Strategie
  ist sauber und wartbar.

- **Pointer Events statt Touch Events** — Plan erwähnt das implizit durch
  die bestehende Implementierung. Gut.

- **TouchSensor mit 150ms Delay** — korrekt. `tolerance: 8px` ist auch
  ein guter Wert. Direkt aus dem Plan übernehmbar.

- **AutomationLane auf Mobile ausblenden** — richtige Entscheidung.
  Das Modal ist bereits fullscreen ✅, das ist sauber.

- **"Add to active track" statt Drag** auf Mobile FX-Cards — UX-sinnvoll,
  weil das Drag-Target auf Mobile wirklich zu klein ist.

- **CSS-first, kein separates Media-Query-File** — Tailwind Mobile-first
  ist der richtige Ansatz für dieses Projekt.

- **Commit-Struktur** — 9 granulare Commits, ein Concern pro Commit,
  genau wie Non-Negotiables verlangen.

- **Out-of-Scope-Liste** — klar, kein Feature-Creep.

---

## Summary

3 kritische Bugs (State-Location, Active-Track-Konzept, touch-action)
müssen in den Plan eingearbeitet werden. Dann: ✅ Freigabe.

Die Anmerkungen 4–10 können als Task-Notes in den Plan, müssen aber
nicht alle als separate Tasks erscheinen — mehrere davon sind 1-Zeiler
beim Implementieren (z-index, ResizeObserver-Fix).

**Nächste Aktion:** CC #1 überarbeitet den Plan mit den 3 Fixes,
dann nochmal kurz hier vorlegen (kein Full-Review nötig, nur Diff).
