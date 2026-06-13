# CC #1 Prompt — Plan 9c.2: Playback-Clock-Fallback (RAF + BPM-Quelle)

**Wenn kein Soundtrack auf der Sync-Audio-Spur liegt, treibt eine
RAF-basierte Clock `currentTime` vorwärts — getaktet aus dem BPM-Feld der
Top-Bar.** Damit funktioniert Playback (und später der 9d-Loop) auch ohne
Audio, statt still zu hängen.

**Vorgänger-Plan zu 9d.** 9d (Loop-Wrap) setzt eine immer vorhandene,
getriebene Clock voraus — dieser Plan macht diese Annahme wahr.

Baseline: HEAD post-Plan-11b. Test-Zahl + Store-Version in Schritt 0 bestätigen.

---

## Warum dieser Plan existiert (Kontext)

Heute treibt der globale Soundtrack-`audioEl` (`engine.ts:151`, `timeupdate`)
die `currentTime`. Liegt kein sync-Soundtrack, gibt es keine vorrückende
Clock — Playback hängt. Das ist eine vorbestehende Lücke, kein 9d-Regress.

Architektonische Naht dahinter: Das **Tempo** kommt schon heute aus dem
BPM-Feld (`loop.ts:309`, `beats = (time - offsetMs/1000) * bpm / 60`), die
**Zeit-Achse** aber aus dem Audio. Die visuelle Beat-Phase hängt also am
BPM-Wert, nur die Clock am Audio. Dieser Plan schließt die Naht: eine
clock-Quelle, die unabhängig vom Audio aus BPM + RAF läuft, wenn kein
Soundtrack da ist.

Da Matthias den soundtrack-losen Fall als **normalen Workflow** einstuft
(SceneFlow: Szenen liegen auf der Timeline, Musik evtl. noch nicht geladen,
User will schon FX per Loop finetunen), ist das ein zu bauendes Feature,
keine KNOWN_LIMITATION.

---

## Schritt 0 — Codebase lesen (PFLICHT)

1. ⚠️ **Playback-Treiber — die zentrale Stelle.** Wo wird `currentTime` pro
   Tick an Store/Render-Loop weitergegeben? `engine.ts:151` (`audioEl` +
   `timeupdate`) ist die *bekannte* Audio-Quelle — aber wo konsumiert der
   Playback-Treiber das, und wo lebt die kanonische `currentTime` (Store?
   Engine-intern?). **Das ist die heikelste Stelle des Plans.** Datei:Zeile.

2. ⚠️ **Play/Stop/Spacebar-Handler.** Wo startet/stoppt Playback? Der
   Clock-Start/Stop hängt hier dran.

3. ⚠️ **BPM-Quelle.** Wo lebt der BPM-Wert aus der Top-Bar im Store? Ist er
   überschreibbar (User-Edit), und wo wird die Änderung publiziert? Die
   RAF-Clock muss den **aktuellen** BPM lesen, auch wenn er live geändert wird.
   (Hinweis: BPM treibt im Fallback nicht die Geschwindigkeit der Sekunden —
   eine Sekunde bleibt eine Sekunde. BPM bestimmt nur das Beat/Takt-Raster,
   das der Render-Loop ohnehin aus `currentTime` ableitet. Siehe „Klärung
   BPM-Rolle" unten — in Schritt 0 verifizieren, dass das stimmt.)

4. ⚠️ **Soundtrack-Erkennung.** Wie stellt das System fest, ob ein
   sync-Soundtrack geladen ist? (Bestimmt, welche Clock aktiv ist.)

5. ⚠️ **Bestehende `timeupdate`-Frequenz.** `audioEl.timeupdate` feuert
   typischerweise nur ~4–66×/s und unregelmäßig. Läuft die Render-Schleife
   heute schon auf einem eigenen RAF und liest `audioEl.currentTime` nur ab,
   oder treibt `timeupdate` die Frames direkt? Das entscheidet, ob die
   RAF-Clock ein neuer Treiber ist oder nur eine neue *Quelle* für einen
   schon existierenden RAF-Loop.

6. Test-Zahl + Store-Version:
   `npm test -- --run 2>&1 | grep -E "Tests|passed" | tail -3`

---

## Klärung: Rolle von BPM im Fallback (wichtig, kein Denkfehler einbauen)

**BPM bestimmt NICHT, wie schnell `currentTime` läuft.** Eine Sekunde
Wall-Clock = eine Sekunde `currentTime`, mit oder ohne Audio. Sonst liefen
Video-Clips, Automation-Zeiten und Export auseinander.

Was BPM tut: Es ist das Raster, aus dem der Render-Loop **Beats** ableitet
(`beats = currentTime * bpm / 60`). Das passiert heute schon und ändert
sich nicht. Die RAF-Clock liefert nur eine saubere, gleichmäßig
vorrückende `currentTime` in **Sekunden** — BPM bleibt reine Render-Loop-
Mathematik obendrauf.

**Konsequenz:** Die RAF-Clock ist eine simple Wall-Clock-Akkumulation
(`currentTime += deltaSeconds` pro RAF-Frame, via `performance.now()`-Delta).
BPM wird von ihr **nicht** gebraucht. Der BPM-Bezug aus Matthias' Anforderung
ist erfüllt, weil der *Render-Loop* den BPM-Wert ohnehin liest, um aus der
RAF-getriebenen `currentTime` die Beats/Takte zu zeichnen.

> Falls Schritt 0 #3/#5 zeigt, dass die heutige Clock das anders handhabt
> (z.B. BPM doch in die Zeit-Achse einfließt), zurückmelden — dann ist diese
> Klärung zu korrigieren, bevor gebaut wird.

---

## Feature — Dual-Clock mit Fallback

### Verhalten

| Zustand | Clock-Quelle |
|---|---|
| Sync-Soundtrack geladen | `audioEl` (wie heute, unverändert) |
| Kein Sync-Soundtrack | **RAF-Clock** (`performance.now()`-Delta, Wall-Clock) |
| Umschalten mitten im Playback | siehe „Umschalt-Verhalten" |

Beide Quellen schreiben in **dieselbe** kanonische `currentTime` (Ort aus
Schritt 0 #1). Der Render-Loop liest nur `currentTime` und merkt nicht,
welche Clock sie treibt — exakt die Entkopplung, die 9ds Loop-Wrap braucht.

### Umschalt-Verhalten (offene Verifikationspunkte)

Diese drei Fälle müssen in Schritt 0 geklärt und dann sauber behandelt sein:

1. **Soundtrack wird geladen, während RAF-Clock läuft (Playback aktiv):**
   Übergibt die RAF-Clock an `audioEl`? Sauberster Weg: beim nächsten
   Play/Seek neu entscheiden, nicht mitten im laufenden Tick umschalten.
   Empfehlung: Clock-Quelle wird bei **Play-Start** und bei **Seek**
   festgelegt, nicht kontinuierlich neu evaluiert. Verifizieren.

2. **Soundtrack wird entfernt, während er spielt:** `audioEl` stoppt →
   RAF-Clock übernimmt ab aktueller `currentTime`. Kein Sprung.

3. **BPM-Feld wird während laufendem Fallback-Loop geändert:** Die
   `currentTime` (Sekunden) bleibt unberührt — nur das Beat-Raster im
   Render-Loop verschiebt sich (gewünscht, das ist der Sinn des
   BPM-Felds). Kein Clock-Reset nötig. Verifizieren, dass eine
   Live-BPM-Änderung nicht die `currentTime` resettet.

### Audio↔RAF-Drift

Solange immer nur **eine** Clock aktiv ist (nie beide gleichzeitig), gibt es
keine Drift — sie schreiben dieselbe Variable, nicht zwei konkurrierende.
Schritt 0 #1 muss bestätigen, dass es genau eine kanonische `currentTime`
gibt und nicht zwei parallele Zeitquellen, die synchron gehalten werden
müssten. Falls doch zwei → das ist die eigentliche Drift-Gefahr und gehört
explizit adressiert.

---

## Dateien (Erwartung — Pfade in Schritt 0 bestätigen)

| Datei | Aktion |
|---|---|
| Playback-Treiber / Engine (⚠️ Pfad, Schritt 0 #1) | MODIFY — RAF-Clock als alternative Quelle für `currentTime` |
| Play/Stop-Handler (⚠️ Pfad, Schritt 0 #2) | MODIFY — Clock-Quelle bei Play-Start wählen (Soundtrack ja/nein) |
| Clock-Modul (evtl. CREATE) | RAF-Wall-Clock-Akkumulator (`performance.now()`-Delta), start/stop/seek |

Kein Eingriff in den Render-Loop selbst (er liest nur `currentTime`).
Kein Eingriff in die BPM→Beat-Mathematik (`loop.ts:309`, unverändert).

---

## Tests

1. Kein Soundtrack + Play → `currentTime` rückt vor (RAF-Clock aktiv)
2. RAF-Clock: 1 s Wall-Clock ≈ 1 s `currentTime` (Toleranz für RAF-Jitter)
3. Soundtrack geladen + Play → `audioEl` treibt (RAF-Clock inaktiv), Verhalten
   wie heute unverändert
4. Stop → Clock hält, `currentTime` bleibt stehen (kein Reset)
5. Seek während RAF-Clock aktiv → `currentTime` springt korrekt, Clock läuft
   ab neuer Position weiter
6. **Umschalt #2:** Soundtrack entfernt während Playback → RAF übernimmt ab
   aktueller `currentTime`, kein Sprung
7. **Umschalt #1:** Soundtrack geladen → nächster Play-Start nutzt `audioEl`
   (Quelle bei Play-Start festgelegt, nicht mitten im Tick)
8. **Live-BPM-Änderung** während Fallback-Loop → `currentTime` unberührt,
   nur Beat-Raster verschiebt sich (kein Clock-Reset)
9. Genau eine kanonische `currentTime` — keine zwei parallelen Zeitquellen
   (Architektur-Anker aus Schritt 0 #1)

---

## Commits (Vorschlag)

```
feat(playback): RAF wall-clock module (start/stop/seek, performance.now delta)
feat(playback): clock-source selection at play-start (soundtrack vs RAF)
feat(playback): RAF takeover when soundtrack removed mid-playback
test(9c2): dual-clock fallback + switch behaviour + live-bpm + single-source
```

4 Commits.

---

## Undo-Behaviour

Clock-Quelle und `currentTime` sind **Playback-Laufzeit-State**, nicht
Dokument-State — wie heute. Kein Undo-Eintrag, nicht im Snapshot, nicht
persistiert. (Bestätigen, dass die heutige `currentTime` schon so behandelt
wird — dann nur dem bestehenden Muster folgen.)

---

## Nicht im Scope

- Tempo-Automation / BPM-Kurven über die Zeit (BPM bleibt ein konstanter
  Wert pro Projekt, live überschreibbar)
- Variable Frame-Rate / Slow-Motion-Playback
- Metronom-Klick im soundtrack-losen Modus (denkbar später, nicht hier)
- 9d-Loop-Wrap selbst (das ist Plan 9d — dieser Plan macht ihn nur möglich)

---

## Verhältnis zu 9d

Nach diesem Plan kann 9d (Rev. 4) seine einfache Annahme behalten: „es gibt
immer eine getriebene Clock". Der 9d-Loop-Wrap wrappt `currentTime`,
unabhängig davon ob `audioEl` oder RAF sie treibt. 9d-Test 16 (Wrap ohne
Soundtrack) wird damit von „gegen getriebene Clock" zu einem echten
End-to-End-Test, der grün sein kann statt nur eine Annahme zu prüfen.

**Empfohlene Reihenfolge:** 9c.2 (dieser Plan) → 9d Feature 2 (Loop-Wrap).
Die übrigen 9d-Schritte (Store, onSeek, Export, Audio-Windowing, Header,
Overlay) sind clock-unabhängig und können parallel/vorher laufen — nur der
Loop-Wrap wartet auf 9c.2.

---

## Architekt-Checkliste

- [ ] Schritt 0 #1: kanonische `currentTime`-Quelle lokalisiert (Datei:Zeile)
- [ ] Schritt 0 #5: ist RAF-Loop schon Treiber, oder treibt `timeupdate`
      die Frames? → entscheidet, ob RAF-Clock neuer Treiber oder neue Quelle
- [ ] BPM-Rolle verifiziert: treibt NICHT die Sekunden, nur das Beat-Raster
- [ ] Genau eine `currentTime` (Test 9) — keine Drift-Gefahr durch Parallelquellen
- [ ] Clock-Quelle bei Play-Start gewählt, nicht kontinuierlich (Test 7)
- [ ] Live-BPM-Änderung resettet `currentTime` nicht (Test 8)
- [ ] Soundtrack-Pfad unverändert (Test 3 — kein Regress am heutigen Verhalten)

---

Rev. 1 — Vorgänger zu 9d. Schritt 0 #1 (Playback-Treiber) ist die heikelste
Verifikation. BPM-Rolle bewusst geklärt, um Geschwindigkeits-Denkfehler zu
vermeiden. ⚠️ = Schritt-0-Pflicht.
