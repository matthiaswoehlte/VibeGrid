# VibeGrid — App Store Strategie

**Status:** Draft v1 — zu reviewen vor Plan 5 (UI)
**Relevant ab:** v0.2 (Capacitor Build)

---

## 1. Plattform-Übersicht

| Plattform | Wrapper | Schwierigkeit | Timeline |
|---|---|---|---|
| Browser (Vercel) | — | ✅ bereits live | v0.1 |
| Google Play | Capacitor + TWA | Mittel | v0.2 |
| Apple App Store | Capacitor + WKWebView | Schwer | v0.2 |

---

## 2. Apple App Store — Kritische Punkte

### 2.1 Review-Risiken

**Problem 1: WebM Export**
iOS Safari spielt WebM nicht nativ ab. Apple könnte die App ablehnen
wenn der Export-Output auf dem Gerät selbst nicht abspielbar ist.

**Lösung v0.2:**
- Export als MP4 via WebCodecs API (bereits in Roadmap)
- Alternativ: Export nur auf Desktop freigeben, Mobile zeigt
  "Export auf Desktop verfügbar" — saubere UX, kein Review-Risiko

**Problem 2: Mehrwert gegenüber Web-Version**
Apple lehnt Apps ab die "nur eine Website" sind ohne native Mehrwert.

**Lösung:**
- Camera Roll Integration (Bilder direkt aus Fotos-App importieren)
  via `@capacitor/camera` — echter nativer Mehrwert
- Haptic Feedback auf Beat via `@capacitor/haptics` — kleiner Aufwand, großer Effekt
- Offline-Fähigkeit (Service Worker bereits durch Next.js PWA möglich)

**Problem 3: 30% Apple-Steuer**
Falls VibeGrid jemals kostenpflichtig wird.

**Lösung (bekannt aus Ask Jesus):**
- Stripe Web-Subscription über Browser-Checkout
- In-App kein Kaufbutton — nur "Abonnement verwalten auf vibegrid.app"
- Netflix/Spotify-Modell: legal, Apple-konform

### 2.2 App Store Voraussetzungen (TODO vor Submission)

- [ ] Apple Developer Account ($99/Jahr) — falls noch nicht vorhanden
- [ ] App Icons in allen Größen (1024x1024 master → Xcode generiert Rest)
- [ ] Screenshots für alle Device-Größen (iPhone 15 Pro Max Pflicht)
- [ ] Privacy Policy URL (Pflicht — auch für kostenlose Apps)
- [ ] App Store Connect Eintrag vorbereiten

---

## 3. Google Play — Unkomplizierter

### 3.1 Voraussetzungen

- [ ] Google Play Developer Account ($25 einmalig)
- [ ] Privacy Policy URL (Pflicht)
- [ ] Feature Graphic (1024x500px)
- [ ] Screenshots (min. 2, Phone + Tablet empfohlen)

### 3.2 TWA vs. Capacitor

Für Google Play gibt es zwei Wege:
- **TWA (Trusted Web Activity):** Direkter Web-Wrapper, sehr einfach,
  aber begrenzte native Features
- **Capacitor:** Volle native Plugin-Unterstützung, empfohlen für VibeGrid

Entscheidung: **Capacitor** — konsistent mit iOS, ein Codebase.

---

## 4. Monetarisierung

### v0.1 (Browser): Kostenlos, kein Account

### v0.2 Optionen (Entscheidung offen):

| Modell | Vorteil | Nachteil |
|---|---|---|
| **Kostenlos** | Maximale Adoption | Kein Revenue |
| **Einmalkauf ~$9.99** | Einfach | Keine recurring revenue |
| **Freemium** | 4 FX free, Export locked | Conversion-Friction |
| **Subscription ~$4.99/Mo** | Recurring revenue | Höhere Erwartungen |

**Empfehlung für v0.2:** Freemium
- Free: alle 4 FX, unlimitierte Timeline, kein Export
- Pro ($4.99/Mo): Export freigeschaltet, zukünftige FX inklusive
- Stripe Web-Checkout (kein App Store Cut)

---

## 5. Privacy Policy (Pflicht für beide Stores)

Minimale Privacy Policy muss vor Submission existieren.
Inhalte für v0.1 (kein Account, kein Tracking):

- Welche Daten gesammelt werden: Keine personenbezogenen Daten
- R2 Storage: User-Medien temporär auf Cloudflare R2 (EU)
- Keine Weitergabe an Dritte
- Kontakt-E-Mail

**Hosting:** Einfachste Lösung — eine statische Seite auf `vibegrid.app/privacy`

---

## 6. Capacitor Setup (Plan v0.2)

```bash
npm install @capacitor/core @capacitor/cli
npx cap init VibeGrid app.vibegrid.studio
npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android

# Native Plugins für echten Mehrwert:
npm install @capacitor/camera    # Bilder aus Camera Roll
npm install @capacitor/haptics   # Beat-Feedback
npm install @capacitor/filesystem # Lokaler Export
```

**Build-Prozess:**
```bash
npm run build          # Next.js static export
npx cap sync           # Web-Assets → native projects
npx cap open ios       # Xcode öffnen
npx cap open android   # Android Studio öffnen
```

---

## 7. Offene Entscheidungen (vor Plan 5 klären)

1. **Monetarisierung:** Freemium oder erstmal komplett kostenlos?
2. **Apple Developer Account:** Bereits vorhanden?
3. **Domain vibegrid.app:** Bereits registriert?
4. **Export auf Mobile:** WebM-Workaround oder warten auf WebCodecs in v0.3?
5. **App Name:** "VibeGrid" — Trademark-Check empfohlen vor Submission
