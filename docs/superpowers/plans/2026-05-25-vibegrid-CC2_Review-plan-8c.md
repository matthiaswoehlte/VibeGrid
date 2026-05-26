# 2. Architekt-Review — Plan 8c fal.ai Render-Pipeline

**Reviewer:** 2. Architekt (CC2-Slot)
**Datum:** 2026-05-25
**Reviewter Plan:** `docs/superpowers/plans/2026-05-25-vibegrid-cc1-prompt-plan-8c.md`
**Codebase-Stand:** HEAD `3d90ca5` (post-Voice-Picker, post-8b)
**Quergeprüft gegen:** `lib/fal/client.ts`, `lib/sceneflow/{types,sonnet,scenes-db,characters-db}.ts`, `lib/tts/{edge,elevenlabs}.ts`, `db/migrations/*.sql`, `package.json`

Verdict: ❌ **Nicht freigegeben** — 3 Blocker, 6 Wackler, 5 Doku-Lücken. Architektur ist im Kern richtig, aber drei Punkte sind hard breaks (Migration-Nummer-Collision, Vercel-Timeout-vs-Kling, TTS-Provider-Drift).

---

## 🔴 Blocker

### B1 — Migration-Nummer kollidiert mit Voice-Picker-Migration

**Fundstelle Plan:** Sektion "Migration 004", Z. 405–419.

`db/migrations/004_VG_characters_edge_provider_and_test_text.sql` **existiert bereits** (Voice-Picker-Migration vom 2026-05-24, HEAD `3d90ca5`). Der Plan überschreibt diese Nummer.

**Fix:** Migration-Nummer auf **005** ändern. Filename: `005_VG_sceneflow_render.sql`. Migration-Inhalte selbst sind sauber (ALTER ADD COLUMN IF NOT EXISTS — idempotent).

---

### B2 — `fal.subscribe()` reißt Vercel-Timeout für Video-Generierung

**Fundstelle Plan:** Z. 86–166 (fal.ai API-Schemas) + Feature 3 + Feature 5.

Plan verwendet durchgängig `fal.subscribe()` für FLUX, Kling, sync-lipsync. `fal.subscribe()` ist ein blocking Wrapper, der intern queue.submit + polling macht — also **die gesamte Generierungszeit hängt am Vercel-Function-Lifecycle**.

Tatsächliche Generierungszeiten:
- FLUX.1 Dev: ~5–15 s ✅ passt in Vercel-Timeout
- **Kling 2.5 Turbo Pro Image-to-Video: 60 s – 4 min** ❌
- **sync-lipsync/v3: 30 s – 2 min** ❌

Vercel Function-Timeout:
- Hobby: 60 s
- Pro: 300 s
- Enterprise: 900 s

KNOWN_LIMITATIONS sagt heute (Plan 5.9b): Vercel-Plan ist **Hobby-Tier**. → Kling-Calls werden **zuverlässig timeout-killen**, der Client sieht `504` oder hängende SSE-Verbindung, und das Geld für den fal.ai-Call ist trotzdem weg (request läuft auf fal-Seite weiter).

Auch SSE löst das nicht — SSE-Streaming hält die Verbindung offen, aber die Lambda-Function endet trotzdem am wall-clock-Timeout.

**Fix — saubere Architektur:**

```
Short-running calls (FLUX, TTS):
  → fal.subscribe() in einer normalen API-Route OK

Long-running calls (Kling, sync-lipsync, MuseTalk):
  → fal.queue.submit() → speichert request_id in VG_story_scenes.fal_request_ids
  → Client polled /api/sceneflow/scenes/[id]/status alle 5–10 s
  → Status-Route ruft fal.queue.status(requestId) auf
  → Bei "COMPLETED": fal.queue.result(requestId) → R2-Upload → image_url/video_url setzen → done
```

Damit:
- Kein Vercel-Timeout (jede Status-Anfrage ist <5 s)
- Browser-Tab-Close überlebt (request läuft auf fal-Seite, Client greift später ab)
- Retry idempotent (request_id wiederverwenden)

Plan **muss** eine eigene Architektur-Sektion *"Subscribe vs. Queue — wann welcher API-Stil"* einführen. SSE-Route bleibt sinnvoll für FLUX + TTS (Phase 1, alle <30 s parallelisierbar), aber Phase 2 (Kling + LipSync) muss queue-basiert sein.

---

### B3 — TTS-Provider-Drift: Plan sagt "Azure", Codebase ist auf "Edge TTS"

**Fundstelle Plan:** Z. 51 ("TTS: Azure Neural TTS + ElevenLabs"), Feature 3 Z. 244–254, File Map Z. 433 (`lib/sceneflow/tts.ts — Azure + ElevenLabs`).

Aber `lib/sceneflow/types.ts:5`:
```ts
export type VoiceProvider = 'edge' | 'azure' | 'elevenlabs';
```

und Voice-Picker (geshipt **gestern** mit den Commits `54543e4 feat(tts): Edge TTS backend` + `f9201d5 feat(tts): ElevenLabs backend`) hat:
- ✅ `lib/tts/edge.ts` — funktioniert, gestern erst gefixt (`serverComponentsExternalPackages`)
- ✅ `lib/tts/elevenlabs.ts` — funktioniert
- ❌ Azure-Backend gibt es **nicht** — `'azure'` ist nur ein Enum-Wert ohne Implementierung

**Konsequenz:** Plan baut ein neues `lib/sceneflow/tts.ts` mit Azure-Code von scratch, ignoriert die existierenden gestern frisch fertiggestellten Implementierungen, und kann auch keinen Charakter rendern bei dem `voice_provider === 'edge'` (was der aktuelle Default-Provider im Voice-Picker ist — `pickerProvider === 'elevenlabs' ? 'elevenlabs' : 'edge'`).

**Fix:**
1. Sektion "TTS" im Plan umschreiben auf **Edge + ElevenLabs**, Azure als v0.2-Stub markieren (oder ganz raus aus dem Enum, falls nie geplant).
2. Feature 3 TTS-Generierung: existierende `synthesizeEdge` und `synthesizeElevenLabs` aus `lib/tts/` re-usen, **kein** neues `lib/sceneflow/tts.ts`.
3. File Map: `lib/sceneflow/tts.ts` → **CREATE wird zu**: nur ein dünner Dispatcher `synthesizeForCharacter(character, text) → audio buffer`, der je nach `character.voice_provider` an `lib/tts/edge.synthesizeEdge` oder `lib/tts/elevenlabs.synthesizeElevenLabs` weiterleitet. ~20 Zeilen statt 100.
4. Voice-resolution chain (Dialog-Szene → speaking_character_id → CharacterRecord → voice_provider/voice_id → richtiger TTS-Call) explizit dokumentieren — fehlt heute (siehe D2).

---

## 🟡 Wackler

### W1 — `lib/fal/client.ts` Stubs: Verhältnis zu neuen `lib/fal/{image,video,lipsync}.ts` ungeklärt

`lib/fal/client.ts` existiert (Plan 8a-Output, 64 Zeilen) mit:
- `generateImage(input: FalImageGenInput): Promise<string>` — throws NOT_IMPL
- `generateVideo(input: FalVideoGenInput): Promise<string>` — throws NOT_IMPL
- `generateLipSync(input: FalLipSyncInput): Promise<string>` — throws NOT_IMPL
- `FalImageModel`, `FalVideoModel`, `FalLipSyncModel` Union-Typen
- `imageSize: '16:9' | '9:16' | '4:3'` (story-format-orientiert, nicht fal-spezifisch)
- `cameraControl` field

Plan 8c File Map sagt:
- `lib/fal/client.ts MODIFY — Stubs durch echte Implementierungen ersetzen`
- `lib/fal/image-gen.ts CREATE`
- `lib/fal/video-gen.ts CREATE`
- `lib/fal/lipsync.ts CREATE`

**Frage:** Bleiben die Stubs in `client.ts` und delegieren an die neuen Files, oder werden sie ganz aus `client.ts` rausgezogen? Die Typen (`FalImageModel` etc.) wo wohnen die? Type-Konsumenten in 8c (Dropdowns) müssen das wissen.

**Fix:** Plan-Sektion *"Code-Layout für `lib/fal/`"* — drei Optionen, eine wählen:
- (a) `client.ts` behält Typen + thin-wrapper-Funktionen, die an `image-gen.ts` / `video-gen.ts` / `lipsync.ts` delegieren. Bestehende Tests gegen `client.ts` brechen nicht.
- (b) `client.ts` löschen, alles in per-Modus-Files. Tests + Consumer-Imports umstellen.
- (c) `client.ts` bleibt aber wird ent-stubbed; KEINE separaten Files. Empfehlung: (c) für Phase 1, (b) später wenn Modus-Files wirklich getrennt sein müssen.

---

### W2 — `generation_step` Spalte überlappt mit URL-derivierter State

Plan-Migration fügt `generation_step TEXT` zu `VG_story_scenes` hinzu mit Werten `'image' | 'audio' | 'neutral_video' | 'lipsync' | 'video'`. Begründung: "für Retry-Granularität".

Aber: derselbe Zustand ist **aus den URL-Spalten ableitbar**:
- `image_url === null` → image fehlt
- `audio_url === null && audio_type !== 'none'` → audio fehlt
- `neutral_video_url === null && type === 'dialog'` → neutral video fehlt
- `video_url === null` → final video fehlt

Eine separate `generation_step`-Spalte → Quelle für Drift (URL gesetzt aber step nicht advanced, oder umgekehrt). Außerdem: bei Retry musst Du ja gerade NICHT auf `generation_step` schauen sondern auf das Ziel (welche URL fehlt → das wird neu gemacht).

**Fix:** Spalte raus, Helper-Funktion `computeNextGenerationStep(scene): Step | 'done'` in `lib/sceneflow/scene-state.ts`. ODER: `generation_step` behalten, aber Plan muss erklären welchen Mehrwert sie über URL-Inspektion hat (z.B. "läuft gerade Schritt X" — aber dafür gibt's `status === 'generating'` schon).

---

### W3 — `cameraControl`-Felder gehen heute nirgendwohin in der fal.ai-API

Plan-Konzept-Dokument (Phase 2) sagt cameraControl wird "an die fal.ai Video-API übergeben". Aber die echte `fal-ai/kling-video/v2.5-turbo/pro/image-to-video`-API (Plan-Sektion Z. 113–130) hat:
- `prompt`, `image_url`, `duration`, `end_image_url`, `negative_prompt`, `cfg_scale`

**Keine** `zoom`, `panX`, `panY`, `motionIntensity` Parameter. Plan 8c referenziert cameraControl nicht in den fal-Calls — ist also de facto ein DB-Feld ohne API-Verbindung.

Drei mögliche Interpretationen:
- (a) Sonnet nutzt cameraControl-Zahlen, um den `motion_prompt` zu bauen (Reverse-Mapping: zoom=+2 → "dolly forward"). Aktuell macht Sonnet das nicht.
- (b) cameraControl ist v0.2-Preparation für ein Modell, das das unterstützt (Luma Ray2 hat camera-control params, Kling nicht).
- (c) Nur als optionale User-Anzeige im Inspector, ohne Effekt auf Generierung.

**Fix:** Plan-Sektion *"cameraControl in v0.1: nur Anzeige"* oder *"cameraControl in v0.1: Sonnet baut motion_prompt aus den Werten"* — eine Variante festlegen, sonst baut CC1 die Slider, die nichts tun.

---

### W4 — `image_size`-Tabelle: 4:3-Zeile mit "(nächster Wert)" verraten Unsicherheit

Plan Z. 105–112:
```
| 4:3 | landscape_4_3 |
```
Im Text-Schema (Z. 95) zeigt der Plan zusätzlich `square_hd` mit Kommentar "für 4:3 (nächster Wert)". Beide Hinweise gleichzeitig.

Tatsächlich: `landscape_4_3` ist 1024×768 → genau 4:3. Sauber. `square_hd` ist 1:1 — falsch für 4:3.

**Fix:** Einzelne Zeile, kein Kommentar-Hedge: `4:3 → landscape_4_3`. Tabellen-Snippet im Code-Beispiel oben (Z. 95) auch entsprechend anpassen.

---

### W5 — `speaking_character_id` Cross-Story-Validation fehlt

Plan-Feature-2-Validierung erkennt: Dialog-Szene ohne speaking_character_id → 🔴. Aber nicht: Dialog-Szene mit speaking_character_id, der gar nicht in `story.characters[]` enthalten ist (z.B. Charakter wurde aus Story entfernt nach Sonnet-Run).

Konsequenz: TTS-Call bekommt Charakter, der zur Story nicht gehört. Edge-case aber real.

**Fix:** Validierung erweitern auf *"speaking_character_id ∈ story.characters[]"* (lookup gegen `useSceneFlowCharacters` o.ä.). Falls nicht: 🔴 *"Sprechender Charakter nicht mehr in Story-Charakteren — bitte ersetzen"*.

---

### W6 — `fal_request_ids` JSONB-Struktur unspezifiziert

`SceneRecord.fal_request_ids: Record<string, string> | null` existiert seit Plan 8a (`types.ts:72`). Plan 8c nutzt das implizit (queue-Architektur in B2 wird darauf aufbauen müssen), aber spezifiziert nicht das Key-Schema.

Vorschlag: `{ image?: string, audio?: string, neutral_video?: string, lipsync?: string }` — Keys matchen die Step-Namen (egal ob als separate Spalte oder nicht). Plan sollte das festlegen, sonst inkonsistent über Routes hinweg.

---

## 📋 Doku-Lücken

### D1 — @-Substitution: wo `@Magdalena` zu echter Beschreibung wird

Sonnet's SYSTEM_PROMPT (`lib/sceneflow/sonnet.ts:64`) sagt heute:
> "@Name-Referenzen im Story-Text werden durch Charakter-Details ersetzt (Namen + visuelle Beschreibung); die Charaktere sind im nächsten System-Block aufgelistet"

→ Sonnet inlined `@Magdalena` zu einer vollen Personenbeschreibung im `image_prompt`. fal.ai-FLUX sieht ein klares Prompt ohne @-Token.

Plan 8c **erwähnt das nirgendwo**. Ein neuer Leser kann ausgehen: "Was passiert wenn @Magdalena im imagePrompt steht?". Plan sollte einen Satz im "Pipeline je Szene" haben:

> "image_prompt enthält bereits aufgelöste Charakter-Beschreibungen (Sonnet-Aufgabe in 8b). FLUX bekommt den String 1:1."

---

### D2 — Voice-Resolution-Chain für Dialog-Szenen nicht explizit

Für jede Dialog-Szene mit `audio_type === 'lipsync'`:

1. `speaking_character_id` → DB-lookup → `CharacterRecord`
2. `character.voice_provider` (`'edge' | 'elevenlabs'`) wählt TTS-Modul
3. `character.voice_id` → spezifische Voice
4. TTS produziert MP3
5. R2-Upload → `audio_url` setzen

Plan deutet auf diese Kette hin (Feature 3 TTS-Generierung), aber stellt sie nicht als Diagramm/Liste dar. Auch nicht: was wenn `voice_id` null obwohl `voice_provider` gesetzt? Was wenn `voice_provider === 'azure'` und kein Backend existiert (B3)?

**Fix:** Sektion *"Voice-Resolution für Dialog/Voiceover"* mit obigen 5 Schritten + Edge-Cases.

---

### D3 — Endcard-Status-Modell im Transfer-Pfad

Plan sagt: Endcard → kein fal-Call → `status = 'done'`, `video_url = null`. Plan 8d übernimmt's als statisches Image-Clip.

Aber: in Phase 1 (Image+Voice) hätte Endcard auch kein Image-Generierung. Was wird mit `image_url` gemacht? `null`? Was zeigt die SceneCard für Endcards in Phase 1 — leeres Bild-Feld oder "Endcard"-Placeholder?

**Fix:** Ein Satz im Endcard-Block: *"Endcard-Szenen haben `image_url = null` und `video_url = null`. SceneCard rendert für Endcards einen speziellen "CTA-Editor"-Slot (kommt in 8d)."*

---

### D4 — KNOWN_LIMITATIONS-Einträge unspezifiziert

Plan File-Map sagt `docs/KNOWN_LIMITATIONS.md MODIFY` — aber kein Inhalt. Konkret zu adressieren:

1. **fal.ai-Kosten unvorhersehbar** — pro Szene ~$1.00–1.50, kein Hard-Cap, User kann Box mit `Mit KI aufteilen` schnell auf 20 Szenen blasen → $20–30 pro Render.
2. **Kling 2.5 Turbo Verfügbarkeit** — fal-modell kann zwischenzeitlich ausgemustert werden. Modell-Dropdown sollte tolerant gegen "unknown model id" sein.
3. **Vercel-Timeout für direkt-async Calls** — sobald B2 gefixt ist, sollte Plan dokumentieren: "Long-running calls wie Kling laufen async im Hintergrund. Browser-Tab kann geschlossen werden, Status erscheint beim nächsten Öffnen."
4. **R2-Bandbreite** — fal-MP4s sind ~5–20 MB, jeder Story = N×5–20 MB R2-Storage. Wirkt sich auf Cloudflare-Kosten aus.
5. **Story-Reset bei Migration** — wenn neue Migration `image_model`/`video_model`/`lipsync_model`-Spalten zu `VG_stories` hinzufügt: bestehende Story-Rows bekommen Defaults. Smoke-Test: alte Story laden, Plan 8c-UI bedienen, kein Crash.

---

### D5 — Retry-Endpunkte verhalten unklar

File Map:
- `app/api/sceneflow/scenes/[sceneId]/retry-image/route.ts CREATE`
- `app/api/sceneflow/scenes/[sceneId]/retry-video/route.ts CREATE`

Plan-Body erwähnt diese Routes nicht im Feature-Text. Frage:
- Reset `image_url` zu null und re-run pipeline? Oder write-thru (alte URL überschreiben)?
- Bei retry-video: nur Schritt 3 (lipsync) wenn neutral_video_url da ist, oder ab Schritt 2 (Kling neutral)?
- Wird `fal_request_ids` beim Retry leer gemacht?

**Fix:** Sektion *"Retry-Semantik"* — 3 Bullets pro Endpoint.

---

## ✅ Empfehlung an den Architekten

Konkrete Edits am Prompt vor CC1-Niederschrift:

1. **B1 fixen** — Migration auf **005** umnummerieren. Filename `005_VG_sceneflow_render.sql`. Bestehende `004_VG_characters_edge_provider_and_test_text.sql` nicht anfassen.

2. **B2 — Architektur-Sektion "Subscribe vs. Queue" einfügen** (ca. 30 LOC im Prompt):
   - FLUX + TTS bleiben in `fal.subscribe` / direkter Async-Aufruf (kurz)
   - Kling + sync-lipsync + MuseTalk: `fal.queue.submit` → request_id in `fal_request_ids` → Client polled `/api/sceneflow/scenes/[id]/status` → Status-Route ruft `fal.queue.status` / `fal.queue.result`
   - SSE-Routes: nur für Phase 1 (Image+Voice). Phase 2 (Videos) → Polling.
   - KNOWN_LIMITATIONS-Eintrag dazu.

3. **B3 — TTS-Provider-Strecke umschreiben:**
   - Sektion Tech Stack: "TTS: Edge TTS + ElevenLabs (Azure als v0.2-Option)"
   - Feature 3 TTS-Generierung: re-use von `lib/tts/edge.synthesizeEdge` + `lib/tts/elevenlabs.synthesizeElevenLabs`
   - `lib/sceneflow/tts.ts` ist dünner Dispatcher (~20 LOC), kein neues Azure-Backend
   - VoiceProvider-Enum klären: `'azure'` raus, oder als Stub markieren mit Error-Throw
   - Voice-Picker-Default ist `'edge'` — Plan muss damit konsistent sein

4. **W1 — `lib/fal/` Layout entscheiden:** Option (c) empfohlen (ent-stubbed in `client.ts`, keine per-Modus-Splits in 8c).

5. **W2 — `generation_step` Spalte entfernen** oder begründen. Empfehlung: weglassen, URL-derived state nutzen.

6. **W3 — cameraControl-Semantik festlegen:** v0.1 nur Anzeige im Inspector, Sonnet baut `motion_prompt` aus den Werten (Reverse-Mapping in SYSTEM_PROMPT). Update sonnet.ts-SYSTEM_PROMPT entsprechend.

7. **W4 — image_size-Tabelle bereinigen:** Nur `landscape_4_3` für 4:3, kein "(nächster Wert)"-Hedge.

8. **W5 — Validierung erweitern:** "speaking_character_id ∈ story.characters[]" als 🔴-Check.

9. **W6 — `fal_request_ids` Schema festlegen:** `{ image?, audio?, neutral_video?, lipsync? }` — JSON-Schema im Plan.

10. **D1 — @-Substitution Note** — ein Satz im "Pipeline je Szene"-Block.

11. **D2 — Voice-Resolution-Chain** als nummerierte Liste.

12. **D3 — Endcard Render-Verhalten** in Phase 1 — ein Satz.

13. **D4 — KNOWN_LIMITATIONS-Einträge** 5-Bullet-Liste im Plan.

14. **D5 — Retry-Semantik-Sektion** für retry-image + retry-video.

---

**Größenschätzung Plan-Prompt-Delta:** ~80 LOC Ergänzung (vor allem B2-Architektur + B3-Provider-Korrektur + KNOWN_LIMITATIONS). **CC1-Plan-Umfang erwartet:** 14–17 Commits (statt 16 wie im aktuellen Prompt), +15 Tests, Bundle-Delta ~+30 kB (Storyboard-UI + ImageViewer). Geschätzte CC1-Implementierung: 2–3 Werktage.

**Nach den 14 Punkten** durchlauffähig ohne weitere Architekt-Schleife. **Wichtig:** B2 ist nicht verhandelbar — ohne queue-Architektur scheitert jede Kling-Video-Szene auf Vercel-Hobby.

---

## Kreuzverweise

- [[architect-review-format]] — Review-Struktur
- `lib/fal/client.ts:1-64` — bestehende Stubs (Plan 8a Output)
- `lib/sceneflow/types.ts:5` — `VoiceProvider = 'edge' | 'azure' | 'elevenlabs'`
- `lib/sceneflow/sonnet.ts:64` — Sonnet inlines @-Refs in image_prompt
- `lib/tts/edge.ts` / `lib/tts/elevenlabs.ts` — Voice-Picker-Backends, gestern geshipt
- `db/migrations/004_VG_characters_edge_provider_and_test_text.sql` — die Migration die heute auf 004 sitzt
- `package.json` — `@fal-ai/client@^1.10.1` vorhanden
- VibeGrid KNOWN_LIMITATIONS (post-5.9b): Vercel Hobby-Plan 4.5 MB Payload-Cap + 60 s Function-Timeout
