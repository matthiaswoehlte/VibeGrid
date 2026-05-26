# Architekt-Review — Plan 8d Rev. 2: Timeline-Integration + Beat-Snap

Reviewer: Architekt
Datum: 2026-05-25
Reviewter Plan: 2026-05-25-vibegrid-plan-8d-timeline-integration.md (Rev. 2)
Vorgänger-Review: Rev. 1 (B1–B2, W1–W5, D1–D2)

**Verdict: ✅ Freigegeben mit 2 kleinen Wacklern (kein Blocker).**

Alle 9 Punkte aus dem Rev.-1-Review sauber adressiert. Der Plan ist
implementierungsreif. Die zwei Wackler kann CC1 während der Implementierung
mit Hausverstand lösen — ich erwähne sie trotzdem weil beide in der
Verification-Gate-Phase stumm scheitern könnten.

---

## ✅ Was aus Rev. 1 sauber gelöst ist

| Punkt | Belegstelle |
|---|---|
| B1 `sync_audio_bpm` Spalte + PATCH | Z. 100–104, Z. 202, Z. 555 |
| B2 `ConfirmReplaceAudioModal` statt `window.confirm` | Z. 455–483, File-Map Z. 525 |
| W1 `ENDCARD_DEFAULT_DURATION_SEC = 5` | Z. 317, Algorithmus Z. 360–362 |
| W2 `effectiveCrossfade` Min-Guard | Z. 382–388, Edge-Case Z. 404–406 |
| W3 Smoke-Text korrigiert (Default='beat') | Z. 597–605 |
| W4 `purgeSceneflowMediaRefs` in timeline-slice | Z. 295–306, File-Map Z. 519 |
| W5 `replaceMainVideoClips` ID-stabil | Z. 432–453 |
| D1 `AddTrackPicker` File-Map-MODIFY | Z. 528 |
| D2 File-Size-Guard + Info-Toast | Z. 193–196, Z. 420–421 |

Alle KNOWN_LIMITATIONS korrekt aktualisiert (Crossfade-Guard, Endcard-Dauer,
Clip-ID-Stabilität). Test-Zahl auf ≥ 27 erhöht, alle neuen Fixes abgedeckt.

---

## 🟡 Wackler (kein Blocker — CC1 kann während Implementierung lösen)

### W1-R — `purgeSceneflowMediaRefs` userId-Quelle undefiniert

Z. 299–301:
```typescript
purgeSceneflowMediaRefs(storyId: string): void
// userId kommt aus dem aktuell-angemeldeten Better-Auth-Session
// (Store kennt das via existing-pattern, sonst aus Helper)
```

Der URL-Prefix-Match lautet `/sceneflow/{userId}/{storyId}/` — ohne userId
filtert die Funktion falsch (alle Stories des Users, oder gar nichts). Die
Formulierung "via existing-pattern" ist zu vage für CC1.

**Fix in Implementierung:** CC1 liest in Schritt 0 Punkt 5 (`timeline-slice.ts`)
wie andere Slice-Funktionen an die userId kommen. Wahrscheinlich ist es
`state.auth.userId` oder ein `getSession()`-Aufruf außerhalb des Slices, der
die ID übergibt. Empfehlung: `purgeSceneflowMediaRefs(storyId, userId)` als
Signatur mit explizitem Parameter — der Aufrufer (`GenerationControls.tsx`)
kennt userId aus der Session und übergibt sie.

---

### W2-R — Transfer-Route sendet `durationSec` für Endcard-Szenen, aber woher?

Transfer-Response (Z. 253): `durationSec: number` ist required für jeden Clip.
`ENDCARD_DEFAULT_DURATION_SEC = 5` existiert in `lib/sceneflow/clip-layout.ts`.
Die Backend-Transfer-Route (`app/api/sceneflow/stories/[id]/transfer/route.ts`)
importiert nicht zwingend `clip-layout.ts` — nur der Frontend-Handler ruft
`layoutClips()` auf.

Konsequenz: Transfer-Route könnte `durationSec: 0` oder `durationSec: undefined`
für Endcards senden. Der Algorithmus fängt das mit dem `|| ENDCARD_DEFAULT_DURATION_SEC`-
Fallback ab (Z. 361), aber nur wenn CC1 den Fallback auch für den null/undefined-
Fall schreibt (nicht nur für `sceneType === 'endcard'`).

**Fix in Implementierung:** Transfer-Route sendet für Endcards explizit:
```typescript
durationSec: scene.type === 'endcard' ? 5 : (scene.duration ?? 5)
```
ODER `ENDCARD_DEFAULT_DURATION_SEC` aus `clip-layout.ts` importieren. Plan braucht
das nicht zu ändern — CC1 löst das beim Schreiben der Transfer-Route.

---

## ⚪ Eine Anmerkung

### Render-Pipeline-Idempotenz: `purgeSceneflowMediaRefs` vor `clearAllTracks`

Z. 263–266: Reihenfolge ist korrekt — zuerst alte MediaRefs raus, dann
Tracks clearen. Das ist wichtig weil `clearAllTracks` die Track-IDs löscht,
aber die mediaRefs-Liste davon getrennt lebt. Reihenfolge ist im Plan
explizit → gut.

---

## Größenschätzung

Keine Änderung zur Rev.-1-Schätzung: ~12–14 Commits, 1,5 Tage.
W1-R + W2-R sind je 1 Implementierungszeile, kein Plan-Nacharbeit nötig.

**Bereit für Schritt 0 + Implementierung.**
