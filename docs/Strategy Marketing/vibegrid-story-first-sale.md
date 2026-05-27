# FIRST SALE — VibeGrid SceneFlow Story
## Hustle / Ambition Demo · 47 Sekunden · 105 BPM

---

## Clip-Eckdaten

| | |
|---|---|
| **Titel** | FIRST SALE |
| **Dauer** | 47 Sekunden |
| **BPM** | 105 |
| **Format** | 9:16 (TikTok / Reels) oder 16:9 |
| **Visueller Stil** | warm documentary editorial, natural lighting, shallow depth of field, subtle film grain, golden hour tones, authentic texture, Sony A7 IV aesthetic, muted earth tones with warm highlights |
| **Szenen** | 11 (inkl. Endcard) |
| **Beat-Drop** | Beat 51 (0:29) |

---

## 1. Story-Input (SceneFlow Textarea)

```
Eine junge Frau (@Founder) sitzt allein an einem kleinen Holztisch.
Sie zeichnet Produktskizzen auf Papier, Bleistiftlinien, Radierspuren.
Kamera nah an den Händen.

Nacht. Schreibtisch übersät mit Post-its, leeren Kaffeetassen, einem
halbgeöffneten Laptop. @Founder arbeitet, Bildschirmlicht auf ihrem
Gesicht. Draußen ist es dunkel.

Tiefpunkt: 3 Uhr morgens. @Founder legt den Kopf auf die Arme,
schließt die Augen. Stapel unbezahlte Rechnungen neben dem Laptop.

Sie öffnet die Augen. Trinkt kalten Kaffee. Öffnet den Laptop.
Entschlossener Blick in den Bildschirm. Sie tippt weiter.

Sie verpackt ihr erstes Produkt mit den Händen. Seidenpapier,
Klebeband, handgeschriebene Karte.

@Founder geht zur Haustür, übergibt das Paket an den Boten.
Sie schaut dem Paket nach.

@Founder sitzt auf dem Sofa, Handy in der Hand. Sie wartet.
Tippt auf Refresh. Wartet.

BEAT-DROP: Das Handy vibriert. Eine Zahlungsbenachrichtigung leuchtet auf.
"Payment received: €47.00". @Founder starrt auf den Screen.

Sie scrollt durch erste Kommentare und Nachrichten auf dem Bildschirm.
Herzchen. Sternebewertungen. "Arrived today, absolutely love it."
Tränen in den Augen, aber sie lacht.

@Founder steht auf, dreht sich zur Kamera. Sie lacht offen,
hebt beide Arme kurz nach oben. Nicht performt — echt.
Goldenes Nachmittagslicht durch das Fenster.

Schwarzer Abschluss. Text: FIRST SALE
```

---

## 2. Story-Setup (Kontext-Felder)

```json
{
  "title": "FIRST SALE",
  "format": "16:9",
  "visualStyle": "warm documentary editorial, natural lighting, shallow depth of field, subtle film grain, golden hour tones, authentic texture, Sony A7 IV aesthetic, muted earth tones, warm highlights, cinematic color grading",
  "characters": [
    {
      "name": "Founder",
      "type": "person",
      "description": "junge Frau, Mitte/Ende 20, natürliches Aussehen, keine Perfektion, legere Kleidung (oversized Hoodie, später einfaches T-Shirt), müde aber entschlossen wirkend, authentisch"
    }
  ]
}
```

---

## 3. Vollständiger Anthropic API Call

```javascript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "prompt-caching-2024-07-31"
  },
  body: JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8000,
    tools: [ /* create_storyboard tool — identisch zu IGNITION */ ],
    tool_choice: { type: "tool", name: "create_storyboard" },
    system: [
      {
        type: "text",
        text: "/* System Prompt 1 — Storyboard-Regeln (gecacht) */",
        cache_control: { type: "ephemeral" }
      },
      {
        type: "text",
        text: `STORY-KONTEXT:
Format: 16:9
Visueller Stil: warm documentary editorial, natural lighting, shallow depth
of field, subtle film grain, golden hour tones, authentic texture,
Sony A7 IV aesthetic, muted earth tones, warm highlights

CHARAKTERE:
- Founder (Typ: person) — junge Frau Mitte/Ende 20, natürliches
  Aussehen, oversized Hoodie, müde aber entschlossen, authentisch`,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: "/* Story-Text aus Abschnitt 1 */"
      }
    ]
  })
});
```

---

## 4. Storyboard / Timeline

**105 BPM · 1 Beat = 0.571 s · 4-Beat-Takt = 2.286 s**

---

### Szene 1 — COLD OPEN · 0:00–0:04 · Beat 1
**Type:** action · **Dauer:** 4s · **Transition:** last-frame · **start_frame_mode:** auto

**Image Prompt:**
```
warm documentary editorial, film grain, Sony A7 IV — extreme close-up:
young woman's hands sketching product drawings on white paper, pencil marks
and eraser smudges visible, wooden desk surface, warm late-afternoon window
light casting soft shadows, shallow depth of field, muted earth tones
```
**Motion:** Slow rack focus from pencil tip to hand, subtle push-in
**Camera:** zoom +1.5 · panX 0 · panY 0 · intensity 3
**FX:** — · **Audio:** none

---

### Szene 2 — NACHT AM SCHREIBTISCH · 0:04–0:08 · Beat 8
**Type:** action · **Dauer:** 4s · **Transition:** last-frame · **start_frame_mode:** from-previous

**Image Prompt:**
```
warm documentary editorial, film grain, Sony A7 IV — medium establishing shot:
cluttered wooden desk at night, laptop screen glowing warm blue-white,
sticky notes everywhere, two empty coffee mugs, sketches scattered,
young woman in oversized hoodie visible from behind, face lit only by
screen light, dark window behind her showing city night lights, intimate
```
**Motion:** Slow dolly back from close to medium, reveals full desk chaos
**Camera:** zoom -1.0 · panX 0 · panY 0 · intensity 3
**FX:** — · **Audio:** none

---

### Szene 3 — TIEFPUNKT · 0:08–0:13 · Beat 15 ← GlitchSlice
**Type:** action · **Dauer:** 5s · **Transition:** last-frame · **start_frame_mode:** from-previous

**Image Prompt:**
```
warm documentary editorial, film grain, Sony A7 IV — medium close-up:
young woman resting head on folded arms on desk, eyes closed, exhausted,
stack of papers and receipts beside laptop showing 3:03 AM on clock,
cold blue-white screen light, empty coffee mug tipped sideways,
single lamp illuminating tired face, emotional low point
```
**Motion:** Camera holds still, slight push-in over 5 seconds, clock visible
**Camera:** zoom +0.5 · panX 0 · panY 0 · intensity 2

**⚡ FX: GlitchSlice**
- Beat: 15 (0:08)
- sliceCount: 4 · maxOffset: 0.012 · decay: 0.12 · axis: 'h'
- Signalisiert: Erschöpfung, Versagen, Chaos im Kopf

**Audio:** none

---

### Szene 4 — ENTSCHLUSS · 0:13–0:17 · Beat 23
**Type:** action · **Dauer:** 4s · **Transition:** last-frame · **start_frame_mode:** from-previous

**Image Prompt:**
```
warm documentary editorial, film grain, Sony A7 IV — medium close-up:
young woman lifting head from arms, eyes opening, determined expression
replacing exhaustion, reaching for cold coffee mug, taking a sip,
then turning back to laptop keyboard with resolve, screen reflected
in eyes, turning point moment, single lamp warm light
```
**Motion:** Slow push-in as she raises head, rack focus to eyes
**Camera:** zoom +1.5 · panX 0 · panY 0 · intensity 4
**FX:** — · **Audio:** none

---

### Szene 5 — PRODUKT VERPACKEN · 0:17–0:21 · Beat 30
**Type:** action · **Dauer:** 4s · **Transition:** last-frame · **start_frame_mode:** from-previous

**Image Prompt:**
```
warm documentary editorial, film grain, Sony A7 IV — close-up overhead shot:
young woman's hands carefully wrapping a small product in white tissue paper,
folding edges neatly, placing it in a kraft cardboard box, handwritten
thank-you card beside it, warm natural morning light now (time has passed),
wooden table, genuine care in the movements
```
**Motion:** Overhead hold, slight push-in, hands working deliberately
**Camera:** zoom +1.0 · panX 0 · panY 0.5 · intensity 3
**FX:** — · **Audio:** none

---

### Szene 6 — ÜBERGABE AN BOTEN · 0:21–0:25 · Beat 37
**Type:** action · **Dauer:** 4s · **Transition:** last-frame · **start_frame_mode:** from-previous

**Image Prompt:**
```
warm documentary editorial, film grain, Sony A7 IV — medium shot:
young woman in doorway of apartment, handing brown kraft box to delivery
person, soft overcast daylight from outside, she watches the courier
walk away with the package, slight smile, a mix of relief and hope,
warm interior light behind her contrasting cool exterior
```
**Motion:** Camera holds at door level, slight pan following her gaze outward
**Camera:** zoom 0 · panX +0.8 · panY 0 · intensity 3
**FX:** — · **Audio:** none

---

### Szene 7 — WARTEN / SPANNUNG · 0:25–0:29 · Beat 44
**Type:** action · **Dauer:** 4s · **Transition:** last-frame · **start_frame_mode:** from-previous

**Image Prompt:**
```
warm documentary editorial, film grain, Sony A7 IV — medium close-up:
young woman sitting on couch, phone held in both hands, refreshing
an app with her thumb repeatedly, tense body language, biting lower lip,
soft natural window light, quiet apartment, waiting silence visible
in the stillness, phone screen glow on face
```
**Motion:** Very slow push-in, almost imperceptible, building tension
**Camera:** zoom +0.5 · panX 0 · panY 0 · intensity 2
**FX:** — · **Audio:** none

---

### Szene 8 — BEAT-DROP · ERSTE ZAHLUNG · 0:29–0:33 · Beat 51 ⚡
**Type:** action · **Dauer:** 4s · **Transition:** crossfade · **start_frame_mode:** from-previous

**Image Prompt:**
```
warm documentary editorial, film grain, Sony A7 IV — extreme close-up:
smartphone screen showing payment notification banner "Payment received €47.00"
with green checkmark icon, hands visible trembling slightly holding phone,
warm golden backlight, screen brightness high, face reflected in screen glass
showing pure shock transitioning to disbelief to joy
```
**Motion:** Quick snap to close-up phone screen, hold, then pull back slightly
**Camera:** zoom +2.0 · panX 0 · panY 0 · intensity 8

**⚡ FX: RGBSplit — BEAT-DROP**
- Beat: 51 (0:29)
- offsetX: 8 · offsetY: 0 · decay: 0.15 · blendMode: 'screen'
- Maximale Intensität — dieser Beat ist der emotionale Climax

**Audio:** none

---

### Szene 9 — KOMMENTARE / REAKTIONEN · 0:33–0:37 · Beat 58
**Type:** action · **Dauer:** 4s · **Transition:** crossfade · **start_frame_mode:** from-previous

**Image Prompt:**
```
warm documentary editorial, film grain, Sony A7 IV — medium close-up:
young woman scrolling through phone messages and reviews, screen visible
showing star ratings and short review text "Arrived today, absolutely love it",
heart emoji responses visible, tears forming in eyes while she laughs softly,
golden afternoon light filling the room now, relief and joy mixed
```
**Motion:** Gentle push-in toward face and phone, slow and tender
**Camera:** zoom +1.0 · panX 0 · panY 0 · intensity 3
**FX:** — · **Audio:** none

---

### Szene 10 — TRIUMPH · 0:37–0:43 · Beat 65
**Type:** action · **Dauer:** 6s · **Transition:** crossfade · **start_frame_mode:** from-previous

**Image Prompt:**
```
warm documentary editorial, film grain, Sony A7 IV — medium portrait:
young woman standing, turning to face camera directly, genuine laugh,
not performed — real joy, both hands raised briefly in spontaneous
celebration, golden afternoon sunlight streaming through window behind her
creating warm rim light, apartment visible in background, authentic human
triumph, this is the real moment
```
**Motion:** Slow pull back from medium to medium-wide as she turns to camera
**Camera:** zoom -1.0 · panX 0 · panY 0 · intensity 5
**FX:** — · **Audio:** none

---

### Szene 11 — ENDCARD · 0:43–0:47 · Beat 75
**Type:** endcard · **Dauer:** 4s · **Transition:** cut · **start_frame_mode:** from-previous

**Image Prompt:**
```
pure warm black background — clean minimal text: "FIRST SALE" in warm
cream-white serif typography, thin weight, elegant spacing, small subtitle
below: "Made with VibeGrid", subtle warm vignette on edges, no additional
elements, quiet confidence
```
**Motion:** Fade in from black, hold static
**Camera:** zoom 0 · panX 0 · panY 0 · intensity 1
**FX:** static Glow subtil · **Audio:** none

---

## 5. FX-Mapping Übersicht

| Szene | Beat | Timecode | FX | Auslöser |
|---|---|---|---|---|
| 3 — Tiefpunkt | Beat 15 | 0:08 | **GlitchSlice** | Erschöpfung, Versagen |
| 8 — Erste Zahlung | Beat 51 | 0:29 | **RGBSplit** | Beat-Drop, Climax |
| 11 — Endcard | Beat 75 | 0:43 | Glow subtil | Fade-Out |

**Beat-Struktur 105 BPM:**
```
Beat  1 (0:00) — Cold Open: Hände
Beat  8 (0:04) — Nacht: Establishing
Beat 15 (0:08) — Tiefpunkt + GlitchSlice ← emotional low
Beat 23 (0:13) — Entschluss
Beat 30 (0:17) — Verpacken
Beat 37 (0:21) — Übergabe
Beat 44 (0:25) — Warten / Tension
Beat 51 (0:29) — BEAT-DROP + RGBSplit ← emotional peak
Beat 58 (0:33) — Kommentare
Beat 65 (0:37) — Triumph
Beat 75 (0:43) — Endcard
```

---

## 6. Suno Musik-Prompt

### Prompt (in Suno einfügen):

```
[Instrumental, no lyrics]
[BPM: 105]
[Key: C minor → C major at drop]

[Style]
cinematic indie electronic, emotional documentary score,
warm lo-fi undertones, building tension, triumphant drop.
fingerpicked acoustic guitar intro, sparse piano melody,
subtle vinyl crackle and film grain texture in sound.
builds with layered synth pads and soft kick drum.
hard drop at 0:29 with full synth bass, driving kick,
bright piano chords shift to major key, euphoric but intimate.
outro fades warm with solo piano. authentic, not commercial.

[Mood arc]
0:00-0:08 introspective, lonely, quiet determination
0:08-0:13 tension, doubt, fragile (this is the low point)
0:13-0:29 rebuilding, rising, urgency growing
0:29-0:37 euphoric drop, release, joy, tears-and-laughter feeling
0:37-0:43 triumphant but intimate, real human moment
0:43-0:47 quiet piano resolution, warmth

[Influences]
Hans Zimmer intimate, Novo Amor, Son Lux, Nils Frahm,
James Blake without vocals, early Sigur Ros warmth
```

### Alternativ-Prompt (kürzer, für Suno v4):

```
Cinematic documentary score, 105 BPM, C minor to C major.
Fingerpicked guitar and sparse piano, lo-fi film grain texture.
Builds from lonely and introspective to urgent and determined.
Hard emotional drop at midpoint: full synth bass, major key piano chords,
euphoric yet intimate, tears-of-joy feeling.
Triumphant outro with solo piano fade. No lyrics. Authentic, warm.
Hans Zimmer meets Novo Amor meets Nils Frahm.
```

---

## 7. Produktions-Notizen

**Zielgruppe dieser Demo:**
Creator, Side-Project-Gründer, Etsy/Shopify-Seller, alle mit einer
persönlichen Business-Journey — das ist die größte selbstidentifizierende
Content-Creator-Gruppe auf TikTok und LinkedIn gleichzeitig.

**Warum diese Story Beat-Sync rechtfertigt:**
Der emotionale Bogen hat einen natürlichen Tief- und Höhepunkt.
GlitchSlice auf dem Tiefpunkt fühlt sich nicht als Effekt an —
es fühlt sich als Chaos im Kopf an. RGBSplit auf der ersten Zahlung
fühlt sich nicht als Effekt an — es fühlt sich als Adrenalin an.
Das ist Beat-Sync der dient, nicht dekoriert.

**Caption-Vorschlag für TikTok/Reels:**
"Vom ersten Sketch bis zur ersten Zahlung. Niemand hat dir gesagt
wie sich €47 anfühlen können. 🤍 #firstsale #smallbusiness #buildinginsunlight"

---

*FIRST SALE Demo · VibeGrid SceneFlow · Mai 2026*
