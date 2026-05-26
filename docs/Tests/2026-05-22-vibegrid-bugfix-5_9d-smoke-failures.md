# VibeGrid Bug-Report — Plan 5.9d Smoke-Gate Failures

**Datum:** 2026-05-22
**Gemeldet von:** Matthias (manuelle Smoke-Tests)
**Branch:** main, HEAD `99ca9db`

---

## Status

Plan 5.9d ist formal durch automatisierte Gates + Code-Review freigegeben,
aber die manuellen Smoke-Tests S1 und S2 scheitern. S3/S5/S7 (Audio-Sync,
Seek-while-Playing, Volume-Automation) konnten deshalb nicht ausgeführt werden.

---

## Bug A — Audio-Upload landet als Hintergrundbalken statt in der Media-Library

**Symptom:** Wenn eine Audio-Datei hochgeladen wird, erscheint sie sofort
als fixer Balken im Gantt/Timeline-Hintergrund — nicht in der Media-Library.
Es gibt keine Möglichkeit, den Clip manuell per Drag auf einen Track zu
ziehen oder ihn frei zu positionieren.

**Erwartetes Verhalten:**
Audio-Dateien sollen nach dem Upload in der Media-Library landen — exakt
gleich wie Image- und Video-Dateien. Von dort zieht der User den Clip
manuell per Drag-and-Drop auf den gewünschten Audio-Track an die gewünschte
Position.

**Vermutliche Ursache:**
Der alte "globale Soundtrack"-Flow aus dem Pre-5.9d `AudioEngine` ist noch
aktiv. Vor Plan 5.9d gab es genau einen Audio-Track der beim Upload
automatisch befüllt wurde (globaler BPM-Soundtrack). Dieser Auto-Fill-Pfad
wurde in Plan 5.9d nicht deaktiviert. Audio-Uploads gehen noch durch den
alten `load(file)`-Pfad statt durch den Media-Library-Upload-Pfad wie
Image/Video.

**Wo suchen:**
- Upload-Handler für Audio-Files — welcher Code-Pfad wird nach dem Upload
  aufgerufen? Geht er in `mediaRefs` (Media-Library) oder direkt in
  `AudioEngine.load()`?
- Die Waveform-Anzeige die als Hintergrundbalken sichtbar ist (Plan 5.5)
  ist vermutlich die globale Soundtrack-Waveform — sie signalisiert dass
  der alte Single-Buffer-Flow noch aktiv ist.

---

## Bug B — "Track hinzufügen" bietet keine Audio-Option an

**Symptom:** Über den "Track hinzufügen"-Button ist kein zweiter
Audio-Track anlegbar. Die Audio-Option fehlt im Menü.

**Erwartetes Verhalten (Smoke S1):**
> "+ Track hinzufügen" → Audio-Option sichtbar → Klick → neuer Track
> "Audio 2" erscheint in der Timeline.

**Vermutliche Ursache:**
Task 3 (Plan 5.9d) hat `addTrack('audio')` im Store korrekt freigeschaltet
(Store-Test grün, soft-reject entfernt). Aber die UI-Komponente hinter
"Track hinzufügen" rendert die verfügbaren Track-Kinds vermutlich aus einer
hardcodierten Liste oder einem Mapping das `'audio'` noch nicht enthält.
Store-Aktion vorhanden — UI-Einstiegspunkt fehlt.

**Wo suchen:**
- Die Komponente die das "Track hinzufügen"-Dropdown/Menü rendert
- Dort: welche `TrackKind`-Werte werden als Optionen angeboten?
  `'audio'` muss dort ergänzt werden.

---

## Auftrag an CC #1

1. Bug A und Bug B untersuchen und fixen.
2. Kein neues Feature — nur die beiden fehlenden Verbindungen herstellen.
3. Je ein Commit pro Bug:

```
fix(audio): route audio uploads through media-library instead of global AudioEngine
fix(ui): add audio option to "Track hinzufügen" menu
```

4. Nach den Fixes: Matthias führt Smoke S1–S3 + S5 + S7 erneut aus.

---

## Nicht betroffen

- Store-Logik: korrekt (Tests grün)
- `addTrack('audio')` Action: korrekt implementiert
- Multi-Clip API + Reconciler: korrekt implementiert
- Volume-Automation + Export: noch nicht verifizierbar bis Bug A behoben
