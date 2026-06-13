# VibeGrid

> KI-gestütztes Tool zur Erstellung von Szenen- und Musikvideos — hier als offenes
> Arbeitsbeispiel veröffentlicht, nicht als Produkt.

VibeGrid war ein kommerzieller Anlauf, der eingestellt wurde (zu starke, gut
finanzierte Wettbewerber). Statt den Code in der Schublade verstauben zu lassen,
liegt er hier offen — als konkretes Beispiel für eine Arbeitsweise, über die ich
schreibe: **KI-gestützte Entwicklung, bei der die Qualität nicht aus dem Lesen
jeder Codezeile entsteht, sondern aus Spezifikation, Zerlegung und Verifikation.**

Hintergrund zur Methode:
[„Warum ich den Code nicht mehr lese, den meine KI schreibt"](https://www.linkedin.com/in/matthias-w%C3%B6hlte-4a7225143/)

---

## Warum dieses Repo öffentlich ist

In Diskussionen zu diesem Ansatz kommt regelmäßig dieselbe, berechtigte Frage:
*„Zeig mir das Repo — Code und Tests."*

Hier ist es. Aber mit einer Bitte um den richtigen Maßstab.

Dieses Repo ist **kein** Beleg für handwerklich perfekte, von Hand polierte
Codezeilen. Das wäre auch widersprüchlich — der ganze Punkt der Methode ist, dass
ich den generierten Code eben *nicht* zeilenweise lese. Der richtige Maßstab ist
ein anderer: **Wie umfassend ist das Ergebnis verifiziert, und tut das System, was
es soll?**

Wer also „flaky lines" sucht, wird vielleicht welche finden. Wer wissen will, ob
ein spezifikations- und testgetriebener Prozess ohne klassisches Code-Review
belastbare Software erzeugt, schaut auf die Testabdeckung und das Verhalten — und
genau dafür ist dieses Repo offen.

---

## Was man sich ansehen sollte

Die Evidenz liegt im Verzeichnis [`tests/`](./tests):

- **236 Testdateien** über drei Ebenen:
  - `tests/unit/` — Komponenten, Renderer, AI-Schema-Validierung, Admin
  - `tests/integration/` — API-Routen (SceneFlow, TTS, Uploads, Sessions)
  - `tests/e2e/` — End-to-End-Abläufe
- Bei jedem Lauf laufen **alle** Tests mit, auch die früherer Features — so werden
  Regressionen und Seiteneffekte sichtbar, nicht erst im Review.

Architektur zum Querlesen:

- [`app/`](./app) — Next.js App Router (Studio, Auth, API-Routen, Storyboard)
- [`components/`](./components) — UI: Timeline, Inspector, SceneFlow, Studio
- [`db/`](./db) — Schema und versionierte Migrationen

---

## Architektur & Stack

| Bereich        | Technologie |
|----------------|-------------|
| Framework      | Next.js (App Router), TypeScript |
| Datenbank      | PostgreSQL (versionierte Migrationen in `db/migrations`) |
| Objektspeicher | Cloudflare R2 |
| Video-/Bild-KI | fal.ai |
| Bildanalyse    | Anthropic API |
| Sprachausgabe  | ElevenLabs TTS |
| Tests          | Unit · Integration · E2E |

---

## Lokales Setup

> Voraussetzung: Node.js (LTS), eine erreichbare PostgreSQL-Instanz und API-Schlüssel
> für die genutzten Dienste.

```bash
# Abhängigkeiten installieren
npm install

# Umgebungsvariablen anlegen
cp .env.example .env.local
# .env.local mit echten Werten füllen

# Datenbank-Migrationen anwenden
node scripts/apply-pending-migrations.mjs

# Entwicklungsserver
npm run dev

# Tests
npm test
```

### `.env.example`

```dotenv
# Datenbank
DATABASE_URL=postgres://user:pass@host:5432/vibegrid

# Cloudflare R2
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=

# KI-Dienste
FAL_KEY=
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
```

> Die genauen Variablennamen bitte gegen die lokale Konfiguration abgleichen und
> ergänzen — dies ist die Mindestmenge, die im Code referenziert wird.

---

## Hinweise & Einschränkungen

- **Eingestelltes Produkt.** VibeGrid wird nicht aktiv weiterentwickelt. Dieses
  Repo ist eine Momentaufnahme, kein gepflegtes Open-Source-Projekt.
- **Audio-Assets entfernt.** Die ursprünglichen Sample-Packs (Drum-Loops etc.)
  sind aus Lizenzgründen **nicht** enthalten. Funktionen, die auf diese Dateien
  zugreifen, erwarten eigenes Material.
- **Snapshot ohne Historie.** Veröffentlicht als frischer Stand, ohne die
  ursprüngliche Commit-Historie.

---

## Lizenz

_Noch festzulegen_ — vor der Veröffentlichung eine Lizenz ergänzen
(z. B. MIT für maximale Offenheit, oder eine Source-Available-Lizenz, falls die
Nutzung eingeschränkt bleiben soll).
