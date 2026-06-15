# SceneFlow — Creating an AI Video (User Guide)

This guide walks through the full SceneFlow workflow: from defining characters
and voices, through letting the AI break your story into a storyboard and
generating images, voices, and video (with lip‑sync), to transferring the
finished result into the VibeGrid timeline editor for final editing.

> **UI language note.** The app interface is currently in German. Throughout
> this guide the exact on‑screen button/label text is shown in `code` so you
> can find it, with the English meaning in the surrounding sentence.

---

## Prerequisites

Before you start, make sure the following are configured (see `.env.example`):

- **`ANTHROPIC_API_KEY`** — required. Claude (`claude-sonnet-4-6`) splits your
  story into a storyboard.
- **`FAL_KEY`** — required. fal.ai generates the images and videos (and runs
  lip‑sync).
- **`ELEVENLABS_API_KEY`** — optional. Enables ElevenLabs voices. **Edge TTS is
  free and needs no key**, so you can produce voiceovers without this.
- A working database and storage (R2). See the README's *Local setup* and
  `npm run db:setup`.

Generation costs **credits**. Your current balance is shown in the story header
as `💳 {balance} Credits`. You can optionally cap spend per story (see
*Story setup* below).

---

## Step 1 — Open SceneFlow

At the top‑left of the app there are two tabs:

- `VibeGrid` — the timeline video editor.
- `SceneFlow` — the AI story/scene builder.

Click **`SceneFlow`**. You now see the SceneFlow shell with a characters button
(`👤 Charaktere`) and `+ Neue Story` ("New Story").

The recommended order is: **create your characters first**, then build the story.

---

## Step 2 — Create characters and give them a voice

Characters are reusable across stories and carry a reference look and a TTS
voice. Any character that speaks in your story needs a voice.

1. Click **`👤 Charaktere`** to open the character drawer, then
   **`+ Neuer Charakter`** ("New character").
2. Fill in the form:
   - **`Name`** — the character's name. You will reference it in the story text
     as `@Name`, so keep it short and unique.
   - **Type** — choose `Person` or `Gruppe` ("Group").
   - **`Referenzbild`** ("Reference image") — optionally upload an image that
     anchors the character's look.
   - **`Bild-Prompt`** — an optional text prompt describing the character's
     appearance for image generation.
   - **`Stimme`** ("Voice") — open the voice picker (next).
3. In the **voice picker**:
   - Choose a provider tab: **`Edge TTS (frei)`** (free) or **`ElevenLabs`**.
   - Search with the `Stimme suchen…` field and click a voice to select it.
     Each voice shows a gender badge (**M / F / ?**).
   - Type a sample sentence in **`Test-Text`** and click **`▶ Stimme testen`**
     ("Test voice") to hear it; **`⏹ Stopp`** stops playback.
4. Click **`Speichern`** ("Save"). Repeat for every character in your story.

---

## Step 3 — Create a new story

Back in SceneFlow, click **`+ Neue Story`** and set:

- **`Titel`** ("Title") — defaults to *Untitled Story* if left blank.
- **`Format`** — `16:9 (Landscape)`, `9:16 (Portrait)`, or `4:3`.
- **`Visueller Stil`** ("Visual style", optional) — e.g. *"cinematic, warm
  light"*. This style is baked into every generated image.

The story opens in its detail view, where you complete the setup.

---

## Step 4 — Story setup (characters, music, models, budget)

In the story detail view you can refine everything before generating:

- **`Charaktere`** — click **`+ Charakter wählen`** ("Choose character") to add
  the characters that appear in this story. Selected ones show as `@name` pills.
  *Only characters added here can be referenced in the story text.*
- **`Sync-Audio (optional)`** — upload a music track (mp3/wav/m4a). On upload,
  the **BPM is detected automatically** (a toast confirms `BPM … detected`), and
  the track shows as `♪ filename BPM …`. Pick a **snap mode**: `Beat`,
  `Takt (4 Beats)` ("Bar"), or `Aus` ("Off"). This determines how scene clips
  align to the beat when transferred to the timeline.
- **`Credit-Budget für diese Story`** — optional spend cap. Leave empty for no
  limit.
- **`Modelle`** ("Models", collapsible) — choose the generation models:
  - **Image:** *Flux – Dev* (default)
  - **Video:** *Kling 2.5 Turbo* (default)
  - **Lip‑sync:** *Sync LipSync v3* (default) or *MuseTalk*

> Changing story setup only affects scenes generated **afterwards**:
> *"Änderungen wirken sich erst beim nächsten „Mit KI aufteilen" auf bestehende
> Szenen aus."*

---

## Step 5 — Write the story and let the AI build the storyboard

In the **`Beschreibe deine Story`** ("Describe your story") text box, write a
free‑text description of what happens. Reference characters with the `@`
syntax, e.g.:

> *"A woman (`@Magdalena`) walks through a forest …"*

The editor validates `@`‑references live: it warns if a character exists but
isn't added to the story (with a quick‑add button) and errors on unknown names.

When the text and characters are ready, click **`Mit KI aufteilen →`**
("Split with AI"). Claude (`claude-sonnet-4-6`) analyzes the story and produces
an ordered storyboard. For each scene it decides:

- **Scene type** — `action`, `dialog`, or `endcard`.
- **Image prompt** and **motion prompt** (camera/movement), in English.
- **Camera control** — zoom, pan, motion intensity.
- **Duration** (1–8 s) and **transition** (`last-frame`, `crossfade`, `cut`).
- **Audio** — for **spoken dialog the AI detects the speech**, sets the scene to
  **lip‑sync**, assigns the speaking character, and fills in the dialog text.
  Non‑spoken scenes get *voiceover* or *no audio*.

The scenes are arranged in order, one after another, ready to review.

---

## Step 6 — Review and adjust the storyboard

Each scene appears as a **scene card** (`Szene 1`, `Szene 2`, …). You can edit
everything the AI proposed before spending credits:

- **`Bild`** ("Image") — edit the image prompt.
- **`Video`** — edit the motion prompt.
- **`Startbild`** ("Start frame") — `Auto` or `Letzter Frame` ("Last frame") so
  a scene continues visually from the previous one.
- Camera sliders — zoom / pan / motion intensity.
- **`Audio`** — `Kein Audio` ("No audio"), `Voiceover`, or `Dialog/LipSync`;
  pick the speaking character and edit the dialog/TTS text.
- **`Dauer (s)`** ("Duration") and **`Transition`**.
- **Reorder** scenes with the up/down arrows; delete with `×`.

Changes auto‑save as you type.

---

## Step 7 — Generate images, voices, and video

Generation runs in two phases. A validation panel flags blockers (🔴) and
warnings (🟡) before you start.

1. **Phase 1 — `Image + Voice Generation`.** Generates an image for every scene
   and a voice track for every scene that has audio. When done you'll see
   *"Phase 1 fertig — Bilder und Stimmen generiert."*
2. **Phase 2 — `Create Full Movie`.** Becomes available once all scenes have
   images. It enqueues video generation for each scene and, for dialog scenes,
   runs **lip‑sync** on top of the generated video. Jobs run in a queue; the
   scene cards and credit balance update as results arrive (polled
   automatically).

You can regenerate any single asset from its scene card
(`↻ Bild neu generieren`, `↻ Video neu generieren`, `↻ Stimme neu generieren`).

---

## Step 8 — Transfer everything to the VibeGrid timeline

Once at least one video is ready, click **`Transfer to Timeline`**. This copies
the **entire finished storyboard into the VibeGrid editor in one go**.

> ⚠️ **This is destructive and cannot be undone.** A confirmation dialog
> (`Achtung`) warns that the transfer **completely overwrites the current
> VibeGrid timeline** — all existing tracks, clips, FX, and automation are
> deleted. Tick **`Verstanden, weiter`** ("Understood, continue") and click
> **`Transferieren`** to proceed.

The transfer builds two master tracks:

| Track | Name | Contents |
|---|---|---|
| `main-video` | **Main Video** | Every scene's video (or endcard image), laid out sequentially, each clip labeled `Szene N`, snapped to the beat grid per your snap mode. |
| `sync-audio` | **Sync Audio** | Your uploaded music track (if any), spanning the timeline. |

Details:

- The **BPM** comes from your uploaded song (or defaults to 120 if none).
- Real video durations are probed so clips have accurate lengths.
- **Lip‑sync scenes** are flagged with audio enabled and the music track gets an
  **automatic ducking curve**, so the song drops in volume while characters
  speak.
- A toast reports how many clips were transferred (and how many were trimmed to
  the snap grid / carry lip‑sync). The app then switches you to the `VibeGrid`
  tab.

---

## Step 9 — Continue in the VibeGrid editor

You're now in the timeline editor with a **Main Video** track and a **Sync
Audio** track. From here it's normal video editing: add FX tracks and
beat‑synced effects, tweak clip timing and transitions, set an export range,
preview, and export the final video.

---

## Quick reference — the happy path

1. `SceneFlow` tab → `👤 Charaktere` → create characters, assign a voice
   (`Edge TTS (frei)` or `ElevenLabs`), test with `▶ Stimme testen`.
2. `+ Neue Story` → set `Titel` / `Format` / `Visueller Stil`.
3. Add `Charaktere`, upload music under `Sync-Audio`, pick snap mode and models.
4. Write the story in `Beschreibe deine Story` (use `@Name`) → `Mit KI aufteilen →`.
5. Review/adjust the scene cards.
6. `Image + Voice Generation` → `Create Full Movie`.
7. `Transfer to Timeline` → confirm `Verstanden, weiter` → `Transferieren`.
8. Finish editing on the `VibeGrid` tab and export.
