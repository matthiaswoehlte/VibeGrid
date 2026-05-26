# IGNITION — SceneFlow Demo Story
## Anthropic API Payload (manueller Test-Call)

---

## 1. Story-Input (was in die SceneFlow-Textarea kommt)

```
Eine Motorradfahrerin (@Rider) steht in einer riesigen dunklen 
Halle mit Neon-Streifen und Nebel. Sie greift die Lenker, 
startet die Rampe mit Feuer links und rechts. Das Motorrad 
springt in Slow-Motion in die Luft, Räder spinnen frei, 
Neon-Reflexionen auf Chrome. POV-Shot direkt hinter der Fahrerin 
in der Luft, die Halle unter ihr, Stroboskop-Licht. 
@Rider zieht den Helm hoch, dreht sich zur Kamera und sagt: 
"Das war erst der Anfang." 
Landung: Das Motorrad knallt auf die Rampe, Funken fliegen, 
das Publikum jubelt. @Rider reckt die Faust in die Luft, 
Feuerwerk explodiert in der Halle. Schwarzer Abschluss mit 
dem Titel IGNITION in Neon-Leuchtschrift.
```

---

## 2. Story-Setup (Kontext-Felder in SceneFlow)

```json
{
  "title": "IGNITION",
  "format": "16:9",
  "visualStyle": "cinematic dark industrial, neon lights, slow-motion moments, high contrast, photorealistic, Blade Runner aesthetic, night scene",
  "characters": [
    {
      "name": "Rider",
      "type": "person",
      "referenceImageUrl": "https://r2.../rider-ref.jpg",
      "voiceProvider": "elevenlabs",
      "voiceId": "YOUR_VOICE_ID"
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
    model: "claude-sonnet-4-20250514",
    max_tokens: 16000,
    tools: [
      {
        name: "create_storyboard",
        description: "Erstellt ein strukturiertes Storyboard aus einer Story-Beschreibung",
        input_schema: {
          type: "object",
          properties: {
            scenes: {
              type: "array",
              items: {
                type: "object",
                required: ["scene_order","type","image_prompt","motion_prompt",
                           "camera_control","duration","audio_type","transition",
                           "start_frame_mode"],
                properties: {
                  scene_order:          { type: "integer" },
                  type:                 { type: "string",
                                          enum: ["action","dialog","endcard"] },
                  image_prompt:         { type: "string" },
                  motion_prompt:        { type: "string" },
                  camera_control: {
                    type: "object",
                    properties: {
                      zoom:             { type: "number", minimum: -5, maximum: 5 },
                      panX:             { type: "number", minimum: -5, maximum: 5 },
                      panY:             { type: "number", minimum: -5, maximum: 5 },
                      motionIntensity:  { type: "integer", minimum: 1, maximum: 10 }
                    },
                    required: ["zoom","panX","panY","motionIntensity"]
                  },
                  duration:             { type: "integer", minimum: 3, maximum: 10 },
                  audio_type:           { type: "string",
                                          enum: ["none","voiceover","lipsync"] },
                  tts_text:             { type: ["string","null"] },
                  speaking_character:   { type: ["string","null"] },
                  transition:           { type: "string",
                                          enum: ["last-frame","crossfade","cut"] },
                  start_frame_mode:     { type: "string",
                                          enum: ["auto","from-previous","custom"] }
                }
              }
            }
          },
          required: ["scenes"]
        }
      }
    ],
    tool_choice: { type: "tool", name: "create_storyboard" },
    system: [
      {
        type: "text",
        text: `Du bist ein professioneller Video-Storyboard-Autor für KI-generierte Videos.

DEINE AUFGABE:
Eine Story-Beschreibung in eine präzise Szenen-Liste für KI-Video-Generierung aufteilen.

REGELN FÜR SZENEN:
- Jede Szene ist 3–10 Sekunden. Standard: 4s für Action, 6s für Dialog, 4s für Endcard
- image_prompt: Vollständig auf ENGLISCH. Stil bereits eingearbeitet. Fotorealistisch.
  Format: "[Stil], [Kameraeinstellung]: [Was im Bild zu sehen ist], [Licht], [Atmosphäre]"
- motion_prompt: Kamerabewegung auf ENGLISCH. Was bewegt sich wie?
- camera_control: Präzise Zahlenwerte. zoom +2 = Dolly-In, panX +4 = schneller Schwenk rechts
- Charaktere werden als @Name im image_prompt referenziert — ersetze sie durch die
  Charakter-Beschreibung aus dem Kontext
- Erste Szene: start_frame_mode = "auto"
- Alle Folge-Szenen: start_frame_mode = "from-previous" für visuelle Kontinuität
- Dialog/LipSync-Szenen: transition = "last-frame" (Gesicht bleibt konsistent)
- tts_text: Natürliche Sprache, genau der gesprochene Text
- Immer mit Endcard abschließen`,
        cache_control: { type: "ephemeral" }
      },
      {
        type: "text",
        text: `STORY-KONTEXT:

Format: 16:9
Visueller Stil: cinematic dark industrial, neon lights, slow-motion moments, 
high contrast, photorealistic, Blade Runner aesthetic, night scene

CHARAKTERE:
- Rider (Typ: person) — eine Motorradfahrerin, athletisch, schwarzer Racing-Suit 
  mit Neon-Akzenten, Helm mit verspiegeltem Visier, entschlossener Blick`,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: `Erstelle das Storyboard für diese Story:

Eine Motorradfahrerin (@Rider) steht in einer riesigen dunklen Halle mit 
Neon-Streifen und Nebel. Sie greift die Lenker, startet die Rampe mit 
Feuer links und rechts. Das Motorrad springt in Slow-Motion in die Luft, 
Räder spinnen frei, Neon-Reflexionen auf Chrome. POV-Shot direkt hinter 
der Fahrerin in der Luft, die Halle unter ihr, Stroboskop-Licht. @Rider 
zieht den Helm hoch, dreht sich zur Kamera und sagt: "Das war erst der 
Anfang." Landung: Das Motorrad knallt auf die Rampe, Funken fliegen, das 
Publikum jubelt. @Rider reckt die Faust in die Luft, Feuerwerk explodiert 
in der Halle. Schwarzer Abschluss mit dem Titel IGNITION in Neon-Leuchtschrift.`
      }
    ]
  })
});
```

---

## 4. Erwarteter Sonnet-Output (Referenz)

```json
{
  "scenes": [
    {
      "scene_order": 1,
      "type": "action",
      "image_prompt": "cinematic dark industrial, neon lights, high contrast, photorealistic — extreme close-up: a motorcycle helmet visor reflecting a burning ramp, neon-lit gloved hands gripping handlebars, dark industrial hall background, volumetric fog, cyan and magenta neon light strips",
      "motion_prompt": "Camera pushes in slowly toward the visor reflection, rack focus from hands to visor",
      "camera_control": { "zoom": 2.0, "panX": 0, "panY": 0, "motionIntensity": 4 },
      "duration": 4,
      "audio_type": "none",
      "tts_text": null,
      "speaking_character": null,
      "transition": "last-frame",
      "start_frame_mode": "auto"
    },
    {
      "scene_order": 2,
      "type": "action",
      "image_prompt": "cinematic dark industrial, neon lights, high contrast, photorealistic — wide establishing shot: massive dark arena hall, low fog, neon light strips along walls in cyan and magenta, a motorcycle at the base of a steep ramp, two columns of fire flanking the ramp, crowd silhouettes in background, dramatic night atmosphere",
      "motion_prompt": "Camera dollies backward from motorcycle revealing the full arena, slow and cinematic",
      "camera_control": { "zoom": -1.5, "panX": 0, "panY": 0, "motionIntensity": 4 },
      "duration": 4,
      "audio_type": "none",
      "tts_text": null,
      "speaking_character": null,
      "transition": "last-frame",
      "start_frame_mode": "from-previous"
    },
    {
      "scene_order": 3,
      "type": "action",
      "image_prompt": "cinematic dark industrial, neon lights, high contrast, photorealistic — slow motion: motorcycle airborne at the peak of a jump, free-spinning wheels, chrome parts reflecting neon cyan and magenta light, dark arena below, motion blur on wheels, dramatic underlit from arena neon strips",
      "motion_prompt": "Low-angle tracking shot, camera rotates slightly upward following the motorcycle at the apex, slow motion feel",
      "camera_control": { "zoom": 1.0, "panX": 0, "panY": 1.5, "motionIntensity": 7 },
      "duration": 4,
      "audio_type": "none",
      "tts_text": null,
      "speaking_character": null,
      "transition": "last-frame",
      "start_frame_mode": "from-previous"
    },
    {
      "scene_order": 4,
      "type": "action",
      "image_prompt": "cinematic dark industrial, neon lights, high contrast, photorealistic — POV shot directly behind motorcycle rider in mid-air, entire arena visible below, strobe lights firing, crowd tiny in distance, helmet and shoulders of rider in foreground, neon trails from strobes",
      "motion_prompt": "Slight handheld shake, subtle roll, camera holds behind rider as arena floor rushes below",
      "camera_control": { "zoom": 0.5, "panX": 0.5, "panY": 0, "motionIntensity": 8 },
      "duration": 4,
      "audio_type": "none",
      "tts_text": null,
      "speaking_character": null,
      "transition": "last-frame",
      "start_frame_mode": "from-previous"
    },
    {
      "scene_order": 5,
      "type": "dialog",
      "image_prompt": "cinematic dark industrial, neon lights, high contrast, photorealistic — medium portrait shot: athletic woman in black neon-accented racing suit lifting her helmet visor, slight confident grin, looking directly into camera, blue-cyan neon light behind her, shallow depth of field, arena in soft bokeh background",
      "motion_prompt": "Camera slowly pushes in toward face, slight handheld, subject lifts visor and turns to camera",
      "camera_control": { "zoom": 1.5, "panX": 0, "panY": 0, "motionIntensity": 3 },
      "duration": 6,
      "audio_type": "lipsync",
      "tts_text": "Das war erst der Anfang.",
      "speaking_character": "Rider",
      "transition": "last-frame",
      "start_frame_mode": "from-previous"
    },
    {
      "scene_order": 6,
      "type": "action",
      "image_prompt": "cinematic dark industrial, neon lights, high contrast, photorealistic — wide shot: motorcycle landing hard on ramp, sparks spraying outward in all directions, crowd erupting in celebration, arms raised, neon lights strobing, smoke and spark trails in air",
      "motion_prompt": "Camera pulls back explosively as motorcycle lands, rapid zoom-out revealing cheering crowd",
      "camera_control": { "zoom": -3.0, "panX": 0, "panY": 0, "motionIntensity": 9 },
      "duration": 4,
      "audio_type": "none",
      "tts_text": null,
      "speaking_character": null,
      "transition": "crossfade",
      "start_frame_mode": "from-previous"
    },
    {
      "scene_order": 7,
      "type": "action",
      "image_prompt": "cinematic dark industrial, neon lights, high contrast, photorealistic — crane wide shot from above: rider raising fist triumphantly, fireworks exploding inside the arena hall, neon and fire light from multiple directions, crowd going wild, confetti in air, epic scale",
      "motion_prompt": "Crane shot pulls up and back revealing full arena scope, fireworks burst in foreground",
      "camera_control": { "zoom": -2.0, "panX": 0, "panY": -1.0, "motionIntensity": 7 },
      "duration": 4,
      "audio_type": "none",
      "tts_text": null,
      "speaking_character": null,
      "transition": "crossfade",
      "start_frame_mode": "from-previous"
    },
    {
      "scene_order": 8,
      "type": "endcard",
      "image_prompt": null,
      "motion_prompt": null,
      "camera_control": { "zoom": 0, "panX": 0, "panY": 0, "motionIntensity": 1 },
      "duration": 4,
      "audio_type": "none",
      "tts_text": null,
      "speaking_character": null,
      "transition": "cut",
      "start_frame_mode": "from-previous"
    }
  ]
}
```

---

## 5. VibeGrid FX-Mapping (nach Transfer to Timeline)

| Szene | Beat-Position | Empfohlener FX |
|---|---|---|
| 1 — Helm Close-Up | Beat 1 | Contour — pulst auf Bass-Hit |
| 2 — Arena Reveal | Beat 9 | Glow auf Neon-Linien |
| 3 — Jump DROP | Beat 17 | **ZoomPulse** — auf jeden Beat |
| 4 — POV | Beat 25 | Particles — Funken auf Snare |
| 5 — Dialog | Beat 33 | Sunray subtil + Chromatic Aberration |
| 6 — Landung | Beat 45 | Flash/Strobe auf Beat 1 |
| 7 — Triumph | Beat 53 | Text-FX "IGNITION" auf letztem Beat |
| 8 — Endcard | Beat 61 | Static Glow auf Logo |

Gesamt: **34 Sekunden @ 120 BPM = 68 Beats**
Szenen 1–4: je 4s · Szene 5 (Dialog): 6s · Szenen 6–7: je 4s · Szene 8 (Endcard): 4s

---

*IGNITION Demo · VibeGrid SceneFlow Test · Mai 2026*
