# Architekt-Review — Plan 8d: Timeline-Integration + Beat-Snap

Reviewer: Architekt
Datum: 2026-05-25
Reviewter Plan: 2026-05-25-vibegrid-plan-8d-timeline-integration.md
Vorgänger: Plan 8c (fal.ai Pipeline), Plan 8.5 (Credits), Plan 8.6 (Admin)

**Verdict: 🔴 Nicht freigeben — 2 Blocker, 5 Wackler.**
Der Plan ist konzeptionell sehr gut strukturiert. Die Clip-Layout-Logik,
das Top-Pinning und die KNOWN_LIMITATIONS sind präzise. Zwei konzeptuelle
Lücken würden aber live sofort scheitern.

---

## 🔴 Blocker

### B1 — BPM fehlt in DB, aber Transfer-Response enthält `syncAudio.bpm`

Transfer-Response (Z. 207):
```typescript
syncAudio: { url: string; bpm?: number } | null;
```

Woher weiß die Backend-Transfer-Route das `bpm`? `sync_audio_url` wird in
`VG_stories` gespeichert — aber `bpm` gibt es nicht als DB-Spalte. Die
Transfer-Route läuft server-side, kann keine client-side Audio-Analyse machen.

Konsequenz: `syncAudio.bpm` ist immer `undefined`. Frontend macht
`BPM aus syncAudio.bpm ?? 120` → alle Stories bekommen 120 BPM, egal welcher
Song hochgeladen wurde. BPM-Detect im Story-Setup (Z. 155–158) läuft nur
"informativ" und wird nirgends persistiert.

**Fix — zwei Optionen, eine wählen:**

**(a) `sync_audio_bpm INTEGER` Spalte zu VG_stories + Migration 008:**
```sql
ALTER TABLE public."VG_stories"
  ADD COLUMN IF NOT EXISTS sync_audio_bpm INTEGER;
  -- NULL = noch nicht detected / kein Song
```
Story-Setup-Flow: BPM-Detect läuft client-side → PATCH `syncAudioBpm`
zusammen mit `syncAudioUrl`. Transfer-Route liest `story.sync_audio_bpm`
und gibt es zurück. Beim Sync-Audio-Drop in VibeGrid (Feature 5): BPM
neu detekten → weiteres PATCH. Empfehlung: diese Option — BPM ist ein
persistierbares Datum, kein transienter State.

**(b) Transfer-Response enthält kein `bpm`, BPM-Detection läuft rein client-side:**
Transfer gibt nur `syncAudio: { url: string }`. Nach Transfer: Client
lädt die Audio-URL, führt BPM-Detection durch, setzt `setBPM`. Erst dann
wird `layoutClips` mit echtem BPM aufgerufen. Nachteil: Seite lädt sichtbar
verzögert, Race zwischen "Tab öffnen" und "BPM fertig".

---

### B2 — `window.confirm` für Song-Replace ist nicht testbar und inkonsistent

Feature 5, Z. 343:
```
a. Ja → window.confirm('Aktuellen Song ersetzen?')
```

`window.confirm` ist ein synchroner Browser-nativer Dialog — blockt den
Event-Loop, ist in Vitest/jsdom nicht verfügbar (gibt immer `true` zurück),
und ist optisch inkonsistent mit dem Rest des UI (kein Tailwind, kein
Dark-Mode). Alle anderen Confirms im Projekt (TransferConfirmModal) sind
React-Modals.

**Fix:** `ConfirmReplaceAudioModal` analog zu `TransferConfirmModal` — kein
Checkbox nötig, nur "Ersetzen" / "Abbrechen". Plan ergänzt den File-Map-Eintrag
und den Test `SyncAudioTrack: zweiter Drop öffnet Modal, Cancel behält alten Song`.

---

## 🟡 Wackler

### W1 — Endcard `durationSec` ist undefined in LayoutInput

Z. 329–332: Endcard-Szenen haben kein Video, werden aber mit `mediaId: <image-mediaId>`
in den Layout-Helper gegeben. `LayoutInput.clips[n].durationSec: number` ist required
(Z. 265) — aber `scene.duration` für eine Endcard ist nicht definiert. Klings
Videodauer-Parameter gilt nur für Video-Szenen.

**Fix:** Im Transfer-Handler: für Endcard-Szenen `durationSec` aus
`story.config_meta.endcard_duration_sec ?? 5` nehmen (5 s als sinnvoller
Default für ein CTA-Bild). Plan ergänzt das als Konstante `ENDCARD_DEFAULT_DURATION_SEC = 5`
in `clip-layout.ts`. Ein Satz im Plan reicht.

---

### W2 — Crossfade-Edge-Case: `lengthBeats ≤ crossfadeBeats`

Algorithmus Z. 315:
```
startBeat = previousClip.startBeat + previousClip.lengthBeats - crossfadeBeats
```

Wenn eine Szene nach Snap `lengthBeats = 2` hat und `crossfadeBeats = 2`:
`startBeat = prevStart + 2 - 2 = prevStart` — der nächste Clip startet am
gleichen Beat wie der vorherige. Bei `lengthBeats = 1` und `crossfadeBeats = 2`
wäre `startBeat < prevStart` — negativer Offset, Clip liegt VOR dem Vorgänger.

Plan hat keinen Guard für diesen Fall. Auswirkung: Timeline-Darstellung
bricht visuell, Clips überlagern sich unendlich.

**Fix:** Minimum-Guard im Algorithmus:
```
crossfadeActual = Math.min(crossfadeBeats, Math.floor(lengthBeats / 2))
startBeat = previousClip.startBeat + previousClip.lengthBeats - crossfadeActual
```
Plus Test: `lengthBeats=2 + crossfadeBeats=2 → crossfadeActual=1, kein negativer startBeat`.

---

### W3 — Smoke-Test-Widerspruch: Default snap_mode ist 'beat', nicht 'off'

Smoke-Test Z. 457:
```
7. Clips sind in Story-Reihenfolge, kein Trim (snap_mode=off oder default 120 BPM)
```

Migration 008 setzt `DEFAULT 'beat'` (Z. 86). D.h. eine neue Story hat
`snap_mode = 'beat'`, nicht `'off'`. Bei 120 BPM und einer 5-s-Szene:
`rawLengthBeats = 5 * 120 / 60 = 10.0` — exakt, kein Trim. Der Smoke
funktioniert zufällig bei 120 BPM + ganzzahligen Sekunden, aber die
Begründung "snap_mode=off" stimmt nicht. Bei 130 BPM + 5 s hätte man
`10.833 Beats → trim auf 10 → trimmed=true`, und der Smoke würde falsch
beschreiben was passiert.

**Fix:** Smoke-Test anpassen: "Clips sind in Story-Reihenfolge, auf Beat-
Boundaries getrimmt (snap_mode='beat', Default 120 BPM)". Oder: für den
Transfer-ohne-Song-Smoke explizit `snap_mode='off'` in der Test-Story setzen.

---

### W4 — MediaRef-Cleanup bei Re-Transfer: kein File-Map-Eintrag

Z. 251–254:
> "Die alten MediaRefs der vorherigen Transfer-Session bleiben verwaist
> in `mediaRefs` — Cleanup-Routine im Helper räumt sie auf (Match auf
> URL-Prefix `/sceneflow/<userId>/<storyId>/`)."

"Im Helper" — welcher? `clip-layout.ts` ist ein Pure-Function-Modul
(layoutClips ohne Store-Zugriff), kann keine MediaRefs cleanen. File-Map
listet keinen MODIFY-Eintrag für diesen Cleanup. In `clearAllTracks()` in
`timeline-slice.ts`? Im `onTransfer`-Handler in `GenerationControls.tsx`?

**Fix:** Cleanup explizit verorten: `lib/store/timeline-slice.ts` bekommt
eine `clearOrphanedMediaRefs(urlPrefix: string)` Store-Action, oder
`GenerationControls.tsx` ruft einen `purgeSceneflowMediaRefs(storyId)` Helper
auf. File-Map-MODIFY-Eintrag ergänzen.

---

### W5 — `replaceMainVideoClips` Clip-ID-Semantik unklar

File-Map Z. 393: `lib/store/timeline-slice.ts | MODIFY — clearAllTracks, replaceMainVideoClips`

Feature 5, Z. 350: "Bestehende Main-Video Clips ersetzen (startBeat + lengthBeats neu)"
Feature 5, Z. 356: "die `mediaId`-Referenzen bleiben erhalten — nur `startBeat` + `lengthBeats` ändern sich"

Aber: Erzeugt `replaceMainVideoClips` neue Clip-Objekte (neue `id`s) oder mutiert es
bestehende? Das ist relevant für:
- Undo/Redo-History (neue IDs brechen undo-Ketten)
- `activeClipsAt`-Selektor (nutzt `clip.id` als Key)
- Persistierung in `VG_projects` JSONB

**Fix:** Plan spezifiziert: `replaceMainVideoClips` behält bestehende `clip.id`s,
mutiert nur `startBeat` + `lengthBeats`. Implementierungsmuster:
```typescript
clips: state.clips.map(c =>
  c.trackId === mainVideoTrackId
    ? { ...c, startBeat: newLayout[c.mediaId].startBeat,
              lengthBeats: newLayout[c.mediaId].lengthBeats }
    : c
)
```

---

## ⚪ Doku-Lücken

### D1 — Singleton-Enforcement im Add-Track-Flow fehlt

KNOWN_LIMITATIONS (Z. 533) sagt "Add-Track-Picker bietet die beiden Kinds
nicht an." Kein Code-Eintrag in File-Map oder Feature-Beschreibung, der das
implementiert. CC1 sieht diesen Hinweis, baut den Picker um, aber ohne
konkreten File-Map-MODIFY-Eintrag übersieht er es.

**Fix:** File-Map ergänzen: `components/Workspace/AddTrackPicker.tsx | MODIFY —
main-video + sync-audio aus Optionen ausblenden wenn bereits vorhanden`.

### D2 — BPM-Detect-Blockierung: fehlende Eskalation

KNOWN_LIMITATIONS Z. 541: "blockiert den Main-Thread — Web-Worker TODO". 2–5 s
Freeze bei 5+ MB MP3s ist keine Kleinigkeit. Plan sollte einen konkreten
Workaround für die Übergangsphase benennen: z.B. File-Size-Guard
(`if (file.size > 3 * 1024 * 1024) toast.warning("Große Datei — Analyse dauert kurz")`)
bevor der BPM-Detect aufgerufen wird. Ohne das keine UX-Kommunikation.

---

## ✅ Was gut ist

- **Algorithmus-Spec** (`layoutClips`) ist komplett und direkt implementierbar.
  Pseudocode-Reihenfolge stimmt, Edge Cases (erster Clip + crossfade, Off-Mode +
  Float) sind abgedeckt.
- **KNOWN_LIMITATIONS** — alle vier Einträge sind präzise und ehrlich.
  Re-Snap-Semantik für manuelle BPM-Edits klar abgegrenzt.
- **Endcard-Behandlung** (mediaKind: 'image') ist sauber — kein Sonderfall im
  Renderer nötig.
- **Transfer-Flow** mit Warn-Modal + Checkbox ist UX-korrekt. Die Zählung
  "3 Tracks und 12 Clips werden gelöscht" direkt im Modal ist wertvoll.
- **Top-Pinning via `sortedTracks`** — einfach, kein State nötig, 3 Tests
  reichen zum Verifizieren.
- **Re-Transfer-Idempotenz** und MediaRef-Cleanup-Konzept — richtig gedacht,
  nur Verortung fehlt (W4).
- **17 Tests** für einen Plan dieser Größe ist angemessen. Die ≥ 8 Clip-Layout-
  Tests sind ausreichend präzise spezifiziert.

---

## Größenschätzung

Mit den Blocker-Fixes:
- B1 (BPM-Spalte, Option a): +1 SQL-Zeile in Migration 008 + 1 PATCH-Feld → 30 min
- B2 (window.confirm → Modal): neues ConfirmReplaceAudioModal, ~50 LOC → 1h
- W2 (Crossfade-Guard): 2 Zeilen im Algorithmus + 1 Test → 15 min
- W4 (MediaRef-Cleanup): clearOrphanedMediaRefs in timeline-slice → 30 min
- W5 (replaceMainVideoClips): Signatur + Mutationspattern → 30 min

Gesamtgröße mit Fixes: ~12 Commits, 1,5 Tage. Ohne Fixes: 1 Tag,
aber B1 (BPM always 120) ist live sofort sichtbar.

---

## Kreuzverweise

- `lib/audio/beat-detector.ts` — client-side BPM-Detect, für B1-Option-a-Flow
- `lib/store/timeline-slice.ts` — clearAllTracks (Schritt-0-Pflicht, da noch nicht bestätigt ob Funktion existiert)
- `components/SceneFlow/TransferConfirmModal.tsx` — Vorbild für B2-Fix
- Plan 8.5 `lib/credits/credits.ts` — Vorbild für atomic Store-Mutations
- KNOWN_LIMITATIONS.md — Plan 8d Einträge bereits gut formuliert, nur D2 nachjustieren
