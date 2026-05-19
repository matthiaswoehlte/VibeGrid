# VibeGrid v0.1 — Acceptance Criteria

**Version:** 0.1  
**Status:** Draft — zu reviewen vor Plan 5  
**Owner:** Matthias  
**QA-Gate:** CC #2 verifiziert alle ACs vor v0.1 Release

---

## 1. Functional Acceptance Criteria

### 1.1 Media Import

**AC-01 — Bild-Upload**
```
Given: User öffnet VibeGrid im Browser
When:  User zieht ein JPEG, PNG oder WebP in die Mediathek
       ODER klickt auf "Upload" und wählt eine Datei
Then:  - Bild erscheint in der Mediathek als Thumbnail
       - Bild wird auf Cloudflare R2 hochgeladen
       - Upload dauert < 5 Sekunden bei < 5 MB
       - Fehlermeldung bei falschen Dateitypen (Toast)
       - Fehlermeldung bei > 20 MB (Toast)
```

**AC-02 — Audio-Upload**
```
Given: Mediathek ist offen
When:  User lädt eine MP3 oder WAV Datei hoch (< 50 MB)
Then:  - Audio erscheint in der Mediathek
       - Waveform wird in der Timeline sichtbar
       - BPM-Badge zeigt 120 BPM (Default) oder detected BPM
       - Audio ist abspielbar
```

**AC-03 — BPM Detection**
```
Given: Audio ist geladen
When:  User klickt "Detect BPM"
Then:  - Progress-Indicator erscheint (0–100%)
       - Nach Abschluss: BPM-Badge zeigt detektierten Wert
       - BPM bleibt manuell überschreibbar
       - Detection dauert < 5 Sekunden bei < 5 Min Audio
```

---

### 1.2 Timeline

**AC-04 — Clip platzieren**
```
Given: Bild und Audio sind geladen
When:  User zieht ein Bild aus der Mediathek auf den Image-Track
Then:  - Clip erscheint auf dem Track an der Drop-Position
       - Clip rastet auf das Beat-Grid ein (Snap aktiv)
       - Clip ist verschiebbar (Drag)
       - Clip ist größenveränderbar (rechter Rand)
       - Überlappende Clips werden abgelehnt (Toast "Clip overlaps")
```

**AC-05 — FX-Clip platzieren**
```
Given: Image-Clip ist auf dem Timeline
When:  User zieht einen FX aus der FX-Library auf einen FX-Track
Then:  - FX-Clip erscheint auf dem richtigen Track
       - Inspector zeigt Parameter des FX automatisch
       - FX-Clip ist editierbar (Drag, Resize)
```

**AC-06 — Playback**
```
Given: Mindestens ein Image-Clip und ein Audio-Clip sind platziert
When:  User klickt Play
Then:  - Audio startet ab Playhead-Position
       - Canvas zeigt das aktive Bild
       - FX-Animationen feuern beat-synchron
       - Playhead bewegt sich mit der Musik
       - Pause stoppt Audio und Playhead
       - Seek (Click auf Ruler) springt zur korrekten Position
```

**AC-07 — Mute**
```
Given: FX-Track ist aktiv
When:  User klickt den Mute-Button auf dem Track
Then:  - FX des Tracks ist nicht mehr sichtbar beim Playback
       - Clip bleibt auf der Timeline sichtbar (nur Rendering deaktiviert)
       - Erneutes Klicken reaktiviert den FX
```

---

### 1.3 Canvas & FX

**AC-08 — Kontur-Blitz (Contour)**
```
Given: Image-Clip ist aktiv, Contour-FX ist auf dem Track
When:  Playback läuft und ein Beat feuert
Then:  - Konturlinien des Bildes leuchten auf
       - Animation folgt dem Rhythmus (nicht random)
       - Inspector-Slider (Threshold, Color, Intensity) 
         verändern den Effekt sichtbar in Echtzeit
```

**AC-09 — Color Sweep**
```
Given: Sweep-FX ist aktiv
When:  Playback läuft
Then:  - 3 transparente Farbkreise driften durch das Bild
       - Drift-Geschwindigkeit ist per Slider einstellbar
       - Farbwechsel ist sichtbar
```

**AC-10 — Pulse**
```
Given: Pulse-FX ist aktiv
When:  Ein Beat feuert
Then:  - Full-Frame Glow pulsiert sichtbar auf dem Beat
       - Decay ist sichtbar (Glow faded nach dem Beat ab)
       - Pulse funktioniert auch ohne aktives Bild
```

**AC-11 — Particles**
```
Given: Particles-FX ist aktiv
When:  Ein Beat feuert
Then:  - Partikel-Burst erscheint am unteren Bildrand
       - Partikel steigen auf und faden aus
       - Spawn-Anzahl per Slider einstellbar
```

**AC-12 — Inspector**
```
Given: User klickt auf einen FX-Clip in der Timeline
When:  Inspector-Panel öffnet
Then:  - Alle Parameter des FX als Slider/Color/Toggle sichtbar
       - Jede Änderung ist sofort im Canvas sichtbar (Live-Preview)
       - Trigger (½ Bar / Beat / Bar / 2 Bar) ist einstellbar
       - "Wähle einen Clip oder Effekt aus" bei keiner Selektion
```

---

### 1.4 Export

**AC-13 — WebM Export**
```
Given: Playhead steht auf Beat 0, Audio + Image + min. 1 FX aktiv
When:  User klickt Export
Then:  - REC-Indicator erscheint (roter Dot + Timecode)
       - Export läuft in Echtzeit durch das gesamte Audio
       - Nach Ende: WebM-Datei wird automatisch heruntergeladen
       - Filename: vibegrid_export_YYYY-MM-DDTHH-MM-SS.webm
       - Datei ist abspielbar in Chrome und VLC
```

**AC-14 — Export Warnings**
```
Given: Export läuft
When:  User wechselt den Tab
Then:  - Persistenter Warning-Toast erscheint sofort
       - Export wird NICHT automatisch abgebrochen

When:  Performance unter 40fps während Recording
Then:  - Non-blocking Toast "Performance dropped"
       - Export läuft weiter, User entscheidet
```

**AC-15 — Export Cancel**
```
Given: Export läuft (REC-Indicator sichtbar)
When:  User klickt Cancel (X-Button)
Then:  - Recording stoppt sofort
       - Kein Download
       - Audio stoppt, Playhead reset zu Beat 0
       - UI kehrt in Normal-State zurück
```

---

## 2. Quality Acceptance Criteria

**QAC-01 — Beat Sync Präzision**
```
FX-Animation darf maximal ±40ms vom Beat abweichen.
Messbar: isOnBeat Window = 40ms (implementiert in lib/audio/grid.ts)
```

**QAC-02 — Canvas Performance**
```
Während Playback mit allen 4 aktiven FX:
- Keine sichtbaren Frame-Drops auf einem modernen Desktop
  (MacBook Pro M1 oder gleichwertig)
- RAF-Loop läuft stabil bei ≥ 30fps
```

**QAC-03 — Export Qualität**
```
Exported WebM:
- Mindest-Bitrate: 6 Mbps Video + 128 Kbps Audio
- Codec: VP9+Opus (Fallback: VP8+Opus)
- Kein schwarzer Screen am Anfang (>0.5s)
- Audio und Video synchron (kein Drift bei < 3 Min)
```

**QAC-04 — Upload Performance**
```
- Bild < 5 MB: Upload < 3 Sekunden
- Audio < 20 MB: Upload < 10 Sekunden
- Fehlgeschlagene Uploads zeigen verständliche Fehlermeldung
```

**QAC-05 — Retina / HiDPI**
```
Canvas-Output ist scharf auf Retina-Displays (kein Blur).
DPR-Fix verifiziert via manuelle Sichtprüfung auf MacBook/4K Monitor.
```

**QAC-06 — State Persistenz**
```
Nach Browser-Reload:
- Timeline-State (Clips, BPM, Snap) ist wiederhergestellt
- MediaRefs (R2-URLs) sind wiederhergestellt
- Audio + Bilder sind wiederherstellbar (URL noch gültig)
- Playhead steht auf Beat 0 (playing: false)
```

---

## 3. Release Acceptance Criteria (vor App Store Submission)

Diese ACs gelten für v0.2 App Store Submission — hier dokumentiert
damit v0.1 bereits darauf vorbereitet ist.

**RAC-01 — Browser (Vercel Deploy)**
```
- [ ] npm run build sauber (keine Errors, keine Warnings)
- [ ] Deployed auf Vercel Production URL
- [ ] HTTPS aktiv
- [ ] Alle Verification Gates grün (typecheck, lint, test, build)
- [ ] KNOWN_LIMITATIONS.md vollständig ausgefüllt
- [ ] Manuelle Checkliste aus KNOWN_LIMITATIONS.md komplett abgehakt
```

**RAC-02 — Datenschutz & Legal**
```
- [ ] Privacy Policy existiert und ist erreichbar
- [ ] R2 Bucket mit EU Jurisdiction konfiguriert
- [ ] .env.local nicht im Repo (verifiziert via git log)
- [ ] Keine API Keys im Client-Side Code
```

**RAC-03 — Apple App Store (v0.2)**
```
- [ ] Apple Developer Account aktiv ($99/Jahr)
- [ ] App Icons in allen Größen (Xcode generiert aus 1024×1024)
- [ ] Screenshots für iPhone 15 Pro Max + iPad
- [ ] MP4 Export via WebCodecs (WebM nicht iOS-kompatibel)
- [ ] Camera Roll Integration via @capacitor/camera
- [ ] Privacy Policy URL in App Store Connect eingetragen
- [ ] App Store Connect Eintrag komplett ausgefüllt
```

**RAC-04 — Google Play (v0.2)**
```
- [ ] Google Play Developer Account aktiv ($25 einmalig)
- [ ] Feature Graphic (1024×500px)
- [ ] Screenshots (min. 2 Phone + Tablet)
- [ ] Privacy Policy URL eingetragen
- [ ] Capacitor Android Build kompiliert ohne Errors
```

---

## 4. Explizit Out of Scope für v0.1

Diese Features führen zu KEINEM Failed-AC wenn sie fehlen:

- Authentifizierung / User Accounts
- Projekt-Speicherung in D1 (Schema vorbereitet, nicht aktiv)
- Mobile UI (Sheets, Tab-Bar) — Stubs vorhanden
- Capacitor Build / App Store Submission
- MP4 Export
- Glitch / Shake / Flare / Sparkle FX
- R2 Upload des exportierten Videos
- Multi-User / Collaboration
- Undo / Redo
- Keyboard Shortcuts

---

## 5. AC-Mapping zu Plans & Tests

| AC | Plan | Test-Typ | Verifiziert durch |
|---|---|---|---|
| AC-01 bis AC-03 | Plan 4 (Storage) | Integration | CC #2 npm test |
| AC-04 bis AC-07 | Plan 5 (UI) | E2E Playwright | CC #2 playwright |
| AC-08 bis AC-12 | Plan 3+5 | E2E Playwright | CC #2 playwright |
| AC-13 bis AC-15 | Plan 6 (Export) | E2E Playwright | CC #2 playwright |
| QAC-01 bis QAC-06 | Alle Plans | Manuell + Unit | Matthias manuell |
| RAC-01 bis RAC-04 | Post v0.1 | Manuell | Matthias manuell |
