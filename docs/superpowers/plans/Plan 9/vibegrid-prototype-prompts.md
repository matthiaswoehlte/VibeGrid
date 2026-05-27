# VibeGrid — Design-Prototypen-Prompts

Für Claude / Design-Tool (Artifact, v0, Figma-Prompt o.ä.)
Ziel: Look & Feel visualisieren bevor Implementierung startet.
Design-Token: Dark Mode, --bg #0c0d12, --a1 #a86bff, --a2 #5a8fff, --a3 #2ee0d0

---

## Prompt A — Preset-Pack Browser

```
Design a dark-mode UI component for "VibeGrid", a beat-sync video editor.
The component is the "FX Preset Pack Browser" — a panel that slides in
from the right side of the screen when the user clicks "Preset Packs" in
the toolbar.

Design tokens (strict):
  background: #0c0d12
  surface-1:  #14161f
  surface-2:  #1a1d2a
  surface-3:  #232739
  border:     rgba(255,255,255,0.06)
  text:        #e8eaf0
  text-dim:    #aab0c4
  accent-1:    #a86bff  (purple)
  accent-2:    #5a8fff  (blue)
  accent-3:    #2ee0d0  (teal)

The panel has three sections:

1. HEADER
   - Title "Preset Packs" left-aligned
   - Small BPM badge top-right showing "128 BPM" (the current project BPM)
   - X-close button

2. PACK LIST (scrollable, left column ~40% width)
   Each pack is a card with:
   - Pack name in bold (e.g. "Hardstyle Drop", "Cinematic Pulse",
     "Lo-Fi Breathe", "Pop Energy", "Retro VHS")
   - Subtitle: how many FX it contains ("4 FX · 128 BPM reference")
   - A row of colored dots representing each FX color in the pack
   - A small play-icon button for preview
   - Selected state: left accent border in --a1

3. PACK DETAIL (right column ~60% width, shown when pack selected)
   - Pack name as heading
   - Description text (1–2 lines, e.g. "Hard-hitting zoom + RGB split
     combo designed for drops at 128–145 BPM")
   - List of contained FX, each row showing:
     - FX name ("ZoomPunch", "RGBSplit", "ScreenShake")
     - A tiny miniature automation curve (simple SVG line showing the
       envelope shape — fast attack, slow decay)
     - Toggle to include/exclude this FX from the apply
   - A small note: "Curves will be scaled to your project BPM (128 BPM)"
   - Primary CTA button "Apply Pack to Timeline" in --a1 purple
   - Secondary link "Save current setup as preset..."

Show the component in a realistic context: the VibeGrid timeline is
partially visible behind the panel (dark, with colored clip bands visible).
The panel has a subtle backdrop blur effect.

Style: professional, minimal, no gradients on cards, flat dark surfaces.
Inspired by Ableton Live's plugin browser meets a modern SaaS dark UI.
```

---

## Prompt B — Format-Varianten Workflow

```
Design a dark-mode modal dialog for "VibeGrid", a beat-sync video editor.
The modal is the "Export Format" dialog — it appears when the user clicks
the Export button.

Design tokens (strict):
  background: #0c0d12
  surface-1:  #14161f
  surface-2:  #1a1d2a
  border:     rgba(255,255,255,0.06)
  text:        #e8eaf0
  text-dim:    #aab0c4
  accent-1:    #a86bff
  accent-2:    #5a8fff
  accent-3:    #2ee0d0

The modal has two parts:

1. FORMAT SELECTOR (top section)
   Three large format cards side by side:
   - "16:9 — YouTube / Desktop" (landscape icon)
   - "9:16 — TikTok / Reels" (portrait icon)  [highlighted as selected]
   - "1:1 — Instagram Post" (square icon)
   Each card shows:
   - An aspect-ratio preview rectangle (filled with a placeholder thumbnail)
   - Format label
   - Recommended platform icons (small, below label)
   - A checkmark when selected (can multi-select)
   Multi-select is allowed: user can check multiple formats to export all at once.

2. EXPORT SETTINGS (bottom section)
   - Quality: toggle row "Draft (fast)" / "HD 1080p" / "4K"
   - File format: "WebM" badge (fixed, not selectable, with tooltip
     "VibeGrid exports WebM for maximum browser compatibility")
   - Estimated file size per format (small text, e.g. "~45 MB per format")
   - Note in small text: "All effects and beat-sync settings are
     identical across formats. Only the canvas crop changes."

3. FOOTER
   - Cancel (text button left)
   - "Export 2 Formats" (primary button, updates count based on selection)

The modal sits on a darkened overlay. Behind the overlay, the VibeGrid
timeline and canvas preview are faintly visible.

Style: clean, functional, no unnecessary decoration.
The format preview rectangles should feel like real video frames,
with subtle colored clip-band colors visible inside them (purple, teal, blue).
```

---

## Prompt C — Style-Consistency Inspector Badge

```
Design a small UI detail for "VibeGrid": the "Style Lock" indicator
in the FX Inspector panel.

Context: When an FX on a scene clip is inherited from the Story's
default FX preset (not manually set by the user), the Inspector shows
a small badge and a subtle visual treatment.

Design tokens (strict):
  surface-2:   #1a1d2a
  border:      rgba(255,255,255,0.06)
  text-dim:    #aab0c4
  text-muted:  #6b7088
  accent-1:    #a86bff
  accent-3:    #2ee0d0

Show the FX Inspector panel for a "ZoomPunch" effect on a clip.
The panel has:

1. HEADER ROW
   - FX name "ZoomPunch" bold left
   - A small badge on the right: a lock icon + text "Story Default"
     in teal (--a3), pill-shaped, small font
   - The badge has a tooltip visible: "This FX setup is inherited from
     your Story preset. Edit here to override for this scene only."

2. PARAM SLIDERS (normal Inspector layout)
   - Strength, Attack, Decay, Direction
   - Each slider has the normal purple automation button

3. OVERRIDE STRIP (shown below params when inherited)
   - Thin bar below all params in surface-2
   - Text in text-muted: "Overriding story default for this scene"
   - Small link "Reset to story default" in accent-1
   This strip only appears after the user has made a change.

Show two states side by side:
- Left: "Inherited" state (lock badge visible, no override strip)
- Right: "Overridden" state (lock badge replaced by "Overridden" in
  orange/amber, override strip visible below)

Minimal, dark, professional. No decorative elements.
```

---

## DrawIO-Beschreibung: Preset-Pack Systemarchitektur

Für Draw.io: Erstelle ein Architektur-Diagramm mit folgenden Nodes
und Verbindungen (Dark Theme, lila Akzente):

```
[Story Setup]
    ↓ wählt
[Story FX Preset]
    ↓ vererbt an
[Alle Szenen-Clips] ← override möglich → [Szene-spezifischer FX]

[Preset-Pack Browser]
    ↓ liefert
[Pack: {fxKind, params, curves, bpmRef}]
    ↓ skaliert mit
[Projekt-BPM]
    ↓ landet auf
[Timeline-Track]
    ↓ enthält
[Automation-Kurven]
    ↓ beeinflusst
[Render-Output pro Frame]

[User: Save as Preset]
    ↓
[Lokale Preset-Library]
    ↓ (später)
[Cloud Preset Marketplace]
```

Kanten-Beschriftungen wichtig für Verständnis.
Farbschema: Nodes in #1a1d2a, Kanten in #a86bff, Text in #e8eaf0.

