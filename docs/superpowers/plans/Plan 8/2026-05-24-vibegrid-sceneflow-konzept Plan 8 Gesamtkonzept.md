# SceneFlow — Produkt-Konzept
## KI-gestützter Story-Builder als zweiter Tab in VibeGrid

**Version 1.1 · Mai 2026 · Matthias Wöhlte**
**Status: Konzept — Basis für Implementierungsplan**

---

## Was ist SceneFlow?

SceneFlow ist ein zweiter Workspace innerhalb von VibeGrid — erreichbar
über einen Tab in der TopBar. Der User beschreibt eine Story in natürlicher
Sprache, Claude Sonnet teilt sie in Szenen auf, KI generiert Bilder und
Videos je Szene via fal.ai, und das Ergebnis wird mit einem Klick als
fertige Video-Clips in die VibeGrid-Timeline übertragen.

Kein separates Projekt. Kein ffmpeg. Gleicher Stack, gleicher R2 Bucket,
gleiche Auth.

---

## Einordnung in VibeGrid

```
TopBar:  [ VibeGrid ]  [ SceneFlow ]

VibeGrid-Tab:  Timeline, Beat-Sync, FX, Automation, Export (wie heute)
SceneFlow-Tab: Story-Input → KI-Aufteilung → Storyboard → fal.ai Render
                                                              ↓
                                              Video-Clips in R2
                                                              ↓
                                        "In VibeGrid öffnen" → Timeline
```

Der Datenfluss ist unidirektional: SceneFlow **produziert** Clips,
VibeGrid **komponiert** sie. Die Media Library ist die gemeinsame Schicht.

---

## Tech Stack

Alles bestehend — keine neuen Frameworks:

| Schicht | Technologie | Anmerkung |
|---|---|---|
| Frontend | Next.js 14, React, Tailwind | Wie VibeGrid heute |
| KI-Orchestrierung | Claude Sonnet 4.6 (Anthropic API) | Story → Szenen-Struktur |
| Bild-Generierung | fal.ai (flux-dev, seedream, ideogram) | Unified API |
| Video-Generierung | fal.ai (kling-v2, seedance, veo) | Unified API |
| LipSync | fal.ai (sync-lipsync-3, omnihuman) | Benötigt Referenzbild + Audio |
| TTS | Azure Neural TTS + ElevenLabs | Wie in SceneFlow-Konzept v1 |
| Storage | Cloudflare R2 (bestehend) | Intermediate + finale Clips |
| Auth | Better Auth (nach Plan 7) | Gleiche Instanz |
| DB | Supabase (bestehend) | Neue VG_-Tabellen |

**ffmpeg: nicht benötigt.** Clip-Konkatenation und Crossfades übernimmt
die bestehende VibeGrid-Timeline + Export-Pipeline (WebCodecs + mp4box.js).

---

## Phase 0 — Vor dem Storyboard: Character Manager

**Charaktere müssen definiert sein bevor die Story eingegeben wird.**

Der Character Manager ist über ein Icon in der SceneFlow-TopBar erreichbar.
Ein Charakter hat folgende Felder:

| Feld | Beschreibung |
|---|---|
| `name` | Anzeigename, wird via `@Name` in Story-Text referenziert |
| `type` | `person` oder `group` |
| `referenceImage` | URL in R2 — hochgeladen oder via fal.ai generiert |
| `voiceProvider` | `azure` oder `elevenlabs` |
| `voiceId` | Azure-Voice-Name oder ElevenLabs Voice-ID |
| `imagePrompt` | Optional: Prompt zur Neu-Generierung des Referenzbilds |

### Charakter-Typen

**`person`** — ein einzelner Mensch.
In Image-Prompts wird `@Magdalena` zu einer präzisen Personenbeschreibung
erweitert. LipSync ist möglich.

**`group`** — mehrere Menschen (Publikum, Zuschauer, Familie).
Kein `@@@`-Syntax — der Typ ist im Character Manager gespeichert.
`@Zuschauer` (Typ: group) erzeugt im Prompt automatisch "eine Gruppe von
Menschen, Publikum" o.ä. LipSync nicht möglich für Gruppen.

### Charakter erstellen — drei Wege

1. **Bild hochladen** — direkter Upload in R2, sofort als Referenzbild nutzbar
2. **Prompt → generieren** — Textarea mit Beschreibung, fal.ai (flux-dev)
   generiert ein Referenzbild, User wählt das beste aus, wird in R2 gespeichert
3. **Stimme zuweisen** — Azure: Dropdown mit verfügbaren Neural-Voices.
   ElevenLabs: Voice-ID Eingabefeld (Voice aus deren Bibliothek)

---

## Phase 1 — Story-Input

### Story-Setup (oben im SceneFlow-Tab)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Story-Titel: [________________]                                      │
│ Format:      [ 16:9 ▼ ]                                             │
│ Visueller Stil: [cinematisch, warmes Licht, Natur, goldene Stunde ] │
│ Charaktere:  [@Magdalena ×]  [@Johannes ×]  [+ Charakter wählen]   │
├─────────────────────────────────────────────────────────────────────┤
│ Beschreibe deine Story:                                              │
│ ┌───────────────────────────────────────────────────────────────┐  │
│ │ Eine Frau (@Magdalena) geht durch einen Wald und entdeckt     │  │
│ │ ein Reh. Sie bleibt stehen und sagt "Gott hat das alles für   │  │
│ │ dich erschaffen." Dann erscheint @Johannes mit einem Buch     │  │
│ │ in der Hand. Beide schauen in die Kamera.                     │  │
│ └───────────────────────────────────────────────────────────────┘  │
│                                          [ Mit KI aufteilen → ]     │
└─────────────────────────────────────────────────────────────────────┘
```

`@Name` referenziert immer einen im Character Manager definierten Charakter.
Unbekannte @-Referenzen werden vor dem Absenden markiert ("Charakter nicht
gefunden — bitte zuerst anlegen").

---

## Phase 2 — Sonnet-Aufteilung

### Was Sonnet bekommt

```json
{
  "storyText": "...",
  "visualStyle": "cinematisch, warmes Licht, Natur",
  "format": "16:9",
  "characters": [
    {
      "name": "Magdalena",
      "type": "person",
      "referenceImageUrl": "https://r2.../magdalena-ref.jpg",
      "voiceProvider": "elevenlabs",
      "voiceId": "xyz123"
    },
    {
      "name": "Johannes",
      "type": "person",
      "referenceImageUrl": "https://r2.../johannes-ref.jpg",
      "voiceProvider": "azure",
      "voiceId": "de-DE-KillianNeural"
    }
  ]
}
```

### Was Sonnet zurückgibt (JSON)

```json
{
  "scenes": [
    {
      "id": "scene-1",
      "type": "action",
      "order": 1,
      "imagePrompt": "cinematisch, warmes Licht, Natur — Weitwinkel-Aufnahme eines herbstlichen Waldes, goldenes Gegenlicht durch Baumkronen, @Magdalena betritt von links das Bild und geht auf einem Waldweg, photorealistisch",
      "motionPrompt": "Kamera folgt der Figur sanft von hinten, leichter Dolly-Forward",
      "duration": 5,
      "audioType": "none",
      "ttsText": null,
      "speakingCharacter": null,
      "transition": "last-frame",
      "startFrame": "auto",
      "endFrame": "auto"
    },
    {
      "id": "scene-2",
      "type": "action",
      "order": 2,
      "imagePrompt": "cinematisch, warmes Licht, Natur — @Magdalena bleibt stehen, ein Reh steht 5 Meter entfernt auf dem Waldweg, Gegenlicht, Stille",
      "motionPrompt": "Kamera hält still, leichte Rack-Focus von Reh zu @Magdalena",
      "duration": 4,
      "audioType": "none",
      "ttsText": null,
      "speakingCharacter": null,
      "transition": "last-frame",
      "startFrame": "from-previous",
      "endFrame": "auto"
    },
    {
      "id": "scene-3",
      "type": "dialog",
      "order": 3,
      "imagePrompt": "cinematisch, warmes Licht — @Magdalena schaut direkt in die Kamera, leichtes Lächeln, Wald-Bokeh im Hintergrund",
      "motionPrompt": "Kamera hält still, leichte Push-In",
      "duration": 6,
      "audioType": "lipsync",
      "ttsText": "Gott hat das alles für dich erschaffen.",
      "speakingCharacter": "Magdalena",
      "transition": "crossfade",
      "startFrame": "from-previous",
      "endFrame": "auto"
    },
    {
      "id": "scene-4",
      "type": "action",
      "order": 4,
      "imagePrompt": "cinematisch, warmes Licht — @Magdalena und @Johannes stehen nebeneinander, @Johannes hält ein Buch in die Kamera, beide lächeln",
      "motionPrompt": "Leichter Zoom-Out, beide Personen im Bild",
      "duration": 5,
      "audioType": "voiceover",
      "ttsText": "Entdecke mehr — der Link ist in der Bio.",
      "speakingCharacter": null,
      "transition": "crossfade",
      "startFrame": "from-previous",
      "endFrame": "auto"
    },
    {
      "id": "scene-5",
      "type": "endcard",
      "order": 5,
      "imagePrompt": null,
      "motionPrompt": null,
      "duration": 3,
      "audioType": "none",
      "ttsText": null,
      "speakingCharacter": null,
      "transition": "cut",
      "startFrame": "from-previous",
      "endFrame": null
    }
  ]
}
```

### Besondere Felder

**`startFrame`:**
- `"auto"` — fal.ai entscheidet selbst (gut für Eröffnungsszenen)
- `"from-previous"` — letzter Frame der Vorgänger-Szene wird als
  Startbild gesetzt (automatisch nach deren Render)
- `"custom"` — User hat manuell ein Bild hochgeladen

**`transition`:**
- `"last-frame"` — LipSync-Szenen: Endbild der vorherigen Szene wird
  als `background_image` an die LipSync-API übergeben
- `"crossfade"` — Clips überlappen in der VibeGrid-Timeline
  (bestehende Morph-Logik)
- `"cut"` — harter Schnitt, kein Overlap

---

## Phase 3 — Das Storyboard

### Layout

Vertikale scrollbare Liste — eine Karte pro Szene.
Reihenfolge per Drag-and-Drop änderbar.
Neue Szene einfügen: `+`-Button zwischen zwei Karten.

### Szenen-Karte (vollständig)

```
┌─ Szene 3 · DIALOG ·  [↑] [↓] [×] ─────────────────────────────────┐
│                                                                       │
│  LINKS — BILD                    RECHTS — VIDEO                      │
│  ┌────────────────────────┐      ┌───────────────────────────────┐  │
│  │ Image Prompt:           │      │ Motion Prompt:                 │  │
│  │ [Textarea, editierbar]  │      │ [Textarea, editierbar]        │  │
│  ├────────────────────────┤      ├───────────────────────────────┤  │
│  │ [Generiertes Bild]      │      │ [Generiertes Video / Player]  │  │
│  │ oder [Platzhalter]      │      │ oder [Platzhalter]            │  │
│  ├────────────────────────┤      ├───────────────────────────────┤  │
│  │ [Retry ♦15] [Modell▼]  │      │ [Retry ♦] [Modell▼]          │  │
│  ├────────────────────────┤      ├───────────────────────────────┤  │
│  │ Startbild:              │      │ Endframe nach Render:         │  │
│  │ ○ Auto  ○ Upload        │      │ [Vorschau wenn fertig]        │  │
│  │ ○ Letzter Frame [↺]    │      │ Wird Startbild von Szene 4    │  │
│  └────────────────────────┘      └───────────────────────────────┘  │
│                                                                       │
│  AUDIO ──────────────────────────────────────────────────────────   │
│  ○ Kein Audio                                                        │
│  ○ Voiceover (Erzähler)                                              │
│  ● Dialog / LipSync                                                   │
│                                                                       │
│  Sprechender Charakter: [ Magdalena ▼ ]                              │
│  TTS-Text:                                                            │
│  [Gott hat das alles für dich erschaffen.               ]            │
│  [ Azure ▼ / ElevenLabs ▼ ]  [ Vorschau ▶ ]  [ MP3 hochladen ]     │
│                                                                       │
│  Dauer: [ 6s ▼ ]    Transition zu nächster Szene: [ last-frame ▼ ] │
└───────────────────────────────────────────────────────────────────────┘
```

### Der `[↺]`-Button (Letzter Frame wiederherstellen)

Wenn der User das Startbild manuell überschrieben hat und sich das
anders überlegt — ein Klick setzt es zurück auf den letzten Frame
der Vorgänger-Szene (falls bereits gerendert).

### Endcard-Karte (vereinfacht)

Keine Bild/Video-Generierung. Nur: CTA-Text, Template-Auswahl
(erweiterbar), Dauer. Wird beim VibeGrid-Transfer als statisches
Image-Clip mit Text-Overlay umgesetzt.

---

## Phase 4 — Render-Pipeline

### Render-Reihenfolge

**Empfehlung: Erst alle Bilder, dann alle Videos** — wie in den
Screenshots des Referenz-Tools. Begründung: User kann nach der
Bild-Phase reviewen und schlechte Bilder korrigieren bevor teure
Video-Calls gemacht werden.

**Bottom Bar (fixiert, immer sichtbar):**
```
[Bild-Modell: Seedream 4.0 ▼]  [Alle Bilder generieren ♦90]
[Video-Modell: Kling 2.6 ▼]    [Ganze Story rendern ♦600]
[→ In VibeGrid öffnen]
```

### Pipeline je Szene

```
1. Image Gen (fal.ai flux/seedream)
   Input:  imagePrompt + startFrame (falls gesetzt)
   Output: URL → R2, Vorschau in Karte

2. Nach User-Review (oder automatisch bei "Ganze Story rendern"):

3a. ACTION-Szene:
    Image-to-Video (fal.ai kling/seedance/veo)
    Input:  generiertes Bild + motionPrompt + duration
    Output: MP4 URL → R2

3b. DIALOG-Szene:
    TTS-Generierung (Azure / ElevenLabs)
    Input:  ttsText + voiceId
    Output: MP3 URL → R2

    LipSync (fal.ai sync-lipsync / omnihuman)
    Input:  referenceImage des Charakters + MP3 + background_image
            (= letzter Frame der Vorgänger-Szene bei last-frame Transition)
    Output: MP4 URL → R2

3c. ENDCARD-Szene:
    Kein fal.ai Call. Statischer Frame wird beim VibeGrid-Export
    als Image-Clip mit Text-Overlay gerendert.

4. Nach allen Szenen:
   Endframe-Extraktion: letzter Frame jedes Clips wird als
   Startbild-Vorschlag der nächsten Karte gesetzt.
```

### Async-Verhalten

Alle fal.ai Calls laufen async. Fortschrittsanzeige je Szene:
- Grauer Kreis = ausstehend
- Oranger Spinner = läuft
- Grüner Haken = fertig
- Rotes X = Fehler + Retry-Button

"App kann geschlossen werden — wir arbeiten im Hintergrund."
Browser-Notification wenn alle Szenen fertig.

---

## Phase 5 — Transfer in VibeGrid

### "In VibeGrid öffnen" Button

Verfügbar sobald mindestens eine Szene gerendert ist.
Nicht-gerenderte Szenen werden als Platzhalter-Clips eingefügt.

### Was passiert:

1. Alle fertigen MP4s aus R2 werden als Video-Clips in die
   Media Library geladen (links in VibeGrid)

2. Video-Track: alle Clips werden lückenlos hintereinander
   auf dem Video-Track platziert, in Story-Reihenfolge

3. Crossfade-Szenen: die Clips überlappen um die definierte
   Crossfade-Dauer (bestehende Morph-Logik aus Plan 5.6)

4. Audio-Tracks: TTS-MP3s der Dialog/Voiceover-Szenen werden
   auf einem Audio-Track direkt unter dem jeweiligen Video-Clip
   platziert, zeitlich ausgerichtet

5. VibeGrid-Tab wird aktiviert — Timeline zeigt das Ergebnis

Musik: deine Frau zieht sie selbst rein. Automation und Lautstärke
werden manuell angepasst. Das ist bewusst — das ist VibeGrid-Territorium.

---

## Datenmodell (neue Supabase-Tabellen, VG_-Präfix)

```sql
VG_characters      — id, userId, name, type, referenceImageUrl,
                     voiceProvider, voiceId, imagePrompt

VG_stories         — id, userId, title, format, visualStyle,
                     status, config (JSON), createdAt, updatedAt

VG_story_scenes    — id, storyId, type, order, imagePrompt,
                     motionPrompt, cameraControl (JSON), duration,
                     audioType, ttsText,
                     speakingCharacterId, transition, startFrameMode,
                     imageUrl, videoUrl, audioUrl, endFrameUrl,
                     status, falRequestIds (JSON)
```

---

## fal.ai Modell-Auswahl

Alle über einen einzigen fal.ai Client. Model-ID ist der einzige
Unterschied — kein separater Code-Pfad.

### Empfohlene Defaults (basierend auf Preis-Leistungs-Analyse)

| Kategorie | Default | Kosten ca. | Alternativen |
|---|---|---|---|
| Image Gen | `fal-ai/flux/dev` | ~$0.025/Bild | `fal-ai/seedream-3`, `fal-ai/ideogram-v3` |
| Image-to-Video | `fal-ai/kling-video/v1.5/pro/image-to-video` | ~$0.75–1.00/Clip | `fal-ai/kling-video/v2.1/pro`, `fal-ai/minimax-video-01-live` |
| LipSync | `fal-ai/sync-lipsync` | ~$0.30/Clip | `fal-ai/omnihuman-lite` |
| TTS | Azure Neural (bestehend) | ~$0.01/1000 Zeichen | ElevenLabs (Voice ID) |

**Warum FLUX.1 Dev als Default?**
FLUX.1 Pro ist ~10× teurer bei kaum sichtbarem Qualitätsunterschied
für Storyboard-Zwecke. FLUX.1 Dev liefert herausragende Fotorealistik
bei Gesichtern, Händen und Texturen zu Bruchteilskosten.

**Warum Kling als Default?**
Kling hält menschliche Anatomie stabiler als Konkurrenten (Luma Dream
Machine neigt zu "KI-Morphen" bei Bewegungen wie Werfen, Greifen).
Kling 1.5 Pro ist preiswerter, Kling 2.1 für anspruchsvollere Szenen.

Geschätzte Gesamtkosten pro Szene (Bild + Video): **~$1.00–1.50**

Modell-Auswahl ist auf Story-Ebene (gilt für alle Szenen) und kann
pro Szene überschrieben werden. Power-User-Einstellungen sind
zugeklappt — Defaults reichen für normale Nutzung.

---

## Kamera-Steuerung via fal.ai Parameter

**Sonnet generiert nicht nur Prompts — sondern auch strukturierte
Kamera-Parameter**, die direkt an die fal.ai Video-API übergeben werden.
Das reduziert Fehlgenerierungen dramatisch, weil die Kamerabewegung
nicht aus einem Textprompt interpretiert werden muss.

### Kamera-Parameter im Szenen-JSON

```json
{
  "cameraControl": {
    "zoom": 2.0,        // negativ = Zoom-Out, positiv = Zoom-In (Dolly)
    "panX": 0.0,        // negativ = Pan Left, positiv = Pan Right
    "panY": 0.0,        // negativ = Tilt Down, positiv = Tilt Up
    "roll": 0.0,        // Kamera-Rotation (selten genutzt)
    "motionIntensity": 5 // 1–10: wie stark bewegt sich das Bild insgesamt
  }
}
```

### Sonnet-Aufgabe: Kamera-Parameter ableiten

Sonnet bekommt die Story und leitet daraus für jede Szene ab:

| Beschreibung | zoom | panX | panY | motionIntensity |
|---|---|---|---|---|
| Dolly-In (auf Person zufahren) | +2.0 | 0 | 0 | 5 |
| Statische Kamera (Naturaufnahme) | 0 | 0 | 0 | 1–2 |
| Kamera folgt fliegendem Objekt | 0 | +4.0 | 0 | 7 |
| Dolly-In + leichter Ausgleich | +1.5 | -0.5 | 0 | 4 |
| Zoom-Out (zwei Personen zeigen) | -1.5 | 0 | 0 | 3 |

### Erweitertes Szenen-JSON mit Kamera-Parametern

```json
{
  "id": "scene-1",
  "type": "action",
  "imagePrompt": "cinematisch, warmes Licht ...",
  "motionPrompt": "Kamera folgt der Figur sanft von hinten, leichter Dolly-Forward",
  "cameraControl": {
    "zoom": 2.0,
    "panX": 0.0,
    "panY": 0.0,
    "motionIntensity": 5
  },
  "duration": 5
}
```

`motionPrompt` bleibt als lesbarer Text für den User im Storyboard.
`cameraControl` ist die maschinenlesbare Version für die API.
Beide werden von Sonnet generiert. Beide sind im Storyboard editierbar
(motionPrompt als Textarea, cameraControl als Slider im Inspector).

### Kamera-Slider im Szenen-Inspector

```
Kamera-Steuerung:
  Zoom:      [←────●────→]  -5 ... 0 ... +5
  Pan Links/Rechts: [←──●────→]  -5 ... 0 ... +5
  Tilt Oben/Unten:  [←────●──→]  -5 ... 0 ... +5
  Bewegungsintensität: [●────────]  1 ... 10
```

---

## Inpainting-Tipp für komplexe Szenen

Bei Szenen mit Händen, Objekten oder physikalisch anspruchsvollen
Details (Stein in der Hand, Buch halten, Blume reichen) scheitern
Video-Modelle häufig wenn das Startbild nicht präzise genug ist.

**Lösungsweg:** Inpainting auf Fal.ai (`fal-ai/flux/dev/inpainting`).

Workflow:
1. Basisbild generieren (FLUX.1 Dev)
2. Falls Hand/Objekt nicht stimmt: Inpainting — nur die fehlerhafte
   Region neu generieren, Rest bleibt exakt erhalten
3. Korrigiertes Bild an Video-Modell übergeben

Dieses Inpainting ist **Phase 2** — in Phase 1 reicht ein Retry-Button.
Aber die Pipeline-Architektur muss Inpainting von Anfang an als
optionalen Schritt zwischen Image Gen und Video Gen vorsehen:

```
Image Gen → [optional: Inpainting] → Video Gen
```

Im Storyboard Phase 1: "Bild bearbeiten" Button öffnet ein einfaches
Crop-und-Retry Interface. Phase 2: echtes Inpainting mit Pinsel.

---

## Was SceneFlow nicht ist (Abgrenzung)

- **Kein Ersatz für VibeGrid-Timeline** — SceneFlow produziert Rohmaterial,
  VibeGrid veredelt es
- **Kein eigenständiges Produkt in Phase 1** — volle Integration in VibeGrid
- **Kein Echtzeit-Preview** — Render dauert Minuten, das ist by design
- **Kein Signup / User-Management** — Better Auth von VibeGrid wird genutzt

---

## Offene Entscheidungen (vor CC #1 Prompt zu klären)

| # | Frage | Vorschlag |
|---|---|---|
| 1 | Soll Sonnet auch den TTS-Text ausformulieren oder nur als Platzhalter eintragen? | Ausformulieren — User kann editieren |
| 2 | Wie viele fal.ai Calls parallel? (Kosten vs. Geschwindigkeit) | Max. 3 parallel, konfigurierbar |
| 3 | Soll die Modell-Auswahl für Nicht-Power-User versteckt sein? | Ja, zugeklappt wie in SceneFlow-Konzept v1 |
| 4 | Credit-Anzeige (♦) — echte fal.ai Credits anzeigen oder Schätzung? | Schätzung, kein eigenes Credit-System in v0.1 |
| 5 | ElevenLabs in Phase 1 schon fertig oder Platzhalter? | Platzhalter — Azure reicht für Praxistest |

---

*SceneFlow · VibeGrid v0.2 · Matthias Wöhlte · Mai 2026*
