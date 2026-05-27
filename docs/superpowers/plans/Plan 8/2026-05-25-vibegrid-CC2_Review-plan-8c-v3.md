# 2. Architekt-Review — Plan 8c v3 fal.ai Render-Pipeline

**Reviewer:** 2. Architekt (CC2-Slot)
**Datum:** 2026-05-25
**Reviewter Plan:** `docs/superpowers/plans/2026-05-25-vibegrid-plan-8c-v3-fal-render-pipeline.md`
**Vorgänger-Reviews:**
- v1: `2026-05-25-vibegrid-CC2_Review-plan-8c.md` (14 Punkte: B1–B3, W1–W6, D1–D5)
- v2: inline-Antwort in der Konversation (4 Punkte: N1–N4)

---

## Verdict: ✅ Freigegeben

Alle 14 Punkte aus dem v1-Review und alle 4 Wackler aus dem v2-Review sind sauber im v3 adressiert. Die Architektur ist konsistent (Queue-Pattern für Phase 1 + Phase 2), Postgres-JSONB-Idempotenz für den Status-Endpoint sauber spezifiziert, Validation-Tabelle komplett.

CC1 kann den Plan jetzt niederschreiben und ohne weitere Architekt-Schleife in die Implementierung gehen.

---

## 🟡 Drei winzige Kosmetik-Drifts (kein Blocker — beim Niederschreiben mitfixen)

### M1 — Header-Versionsnummer

`v3-Plan-Z. 1`:
```markdown
# CC #1 Prompt — Schreibe Plan 8c: fal.ai Render-Pipeline (Rev. 2)
```

Soll heißen `(Rev. 3)` — passt zur Sub-Header-Zeile direkt darunter (`Revision 3 — 2026-05-25`) und zum Filename. Reine Header-Drift.

### M2 — `Feature 3 / Reihenfolge` post-N3 inkonsistent

`v3-Plan-Z. 337-339`:
```
1. TTS-Generierung aller Dialog/Voiceover-Szenen (parallel, max 3)
2. Bild-Generierung aller Szenen via Flux (parallel, max 3)
3. Alle Ergebnisse → R2-Upload → URL in DB
```

Stammt aus v2 (SSE-Variante mit clientseitigem max-3-Concurrency). Mit N3 ist FLUX queue-basiert — fal.ai handhabt Throttling selbst, kein clientseitiges max-3-Limit nötig. **Reformulierung:**

```
1. TTS-Generierung aller Dialog/Voiceover-Szenen — direkter Sync-Call,
   Promise.allSettled mit max-3-Concurrency-Wrapper (Rate-Limit-Schutz
   gegen Edge/ElevenLabs)
2. Bild-Generierung aller Szenen via FLUX — alle parallel via
   fal.queue.submit (fal.ai handelt Throttling selbst), request_ids
   in fal_request_ids.image
3. TTS-Ergebnisse sofort → R2 → audio_url
   FLUX-Ergebnisse über Status-Polling → R2 → image_url
```

### M3 — Postgres-JSONB-Annahme explizit machen

`v3-Plan-Z. 521`:
```sql
WHERE fal_request_ids->>'lipsync' IS NULL
```

`->>` ist Postgres-JSONB-spezifische Syntax. VibeGrid läuft auf Supabase/Postgres — also faktisch OK. Aber für CC1 explizit als Eintrag in `KNOWN_LIMITATIONS.md` Plan-8c-Block:

```markdown
**Postgres-JSONB-Abhängigkeit für Status-Idempotenz:**
Status-Endpoint nutzt JSONB-`->>`-Operator für Race-Guards
(`WHERE fal_request_ids->>'lipsync' IS NULL`). Funktioniert auf Supabase
(Postgres). Bei einer hypothetischen v0.2-Migration zu D1/SQLite müsste
das Schema auf separate Spalten umgestellt werden.
```

---

## Bereich für die frische Implementierungs-Session

Wenn CC1 (frische Session) Plan 8c v3 niederschreibt:

1. Niederschrift in `docs/superpowers/plans/2026-05-25-vibegrid-plan-8c-fal-render-pipeline.md` (ohne `-v3-`-Suffix — das war nur der CC1-Prompt; der finale Plan ist die ausführliche Plan-5.7-Struktur)
2. Beim Niederschreiben M1–M3 mitfixen (Header-Version, Concurrency-Reformulierung, JSONB-KNOWN_LIMITATIONS-Eintrag)
3. Optional internen architect-review-Subagent aus `superpowers:writing-plans` Skill dispatchen → `docs(plan): apply CC review fixes for Plan 8c`
4. Dann erst Implementierung

Verification-Gate am Ende: 4 Standard-Checks (typecheck/lint/test/build) + die 8 manuellen Smoke-Schritte aus v3 Z. 808-828.

---

## Größenschätzung

- Prompt-Delta für M1–M3 beim Niederschreiben: ~5 LOC
- Finaler Plan-Umfang: erwartete **16–18 Commits**, **+27 Tests**, **~30 kB Bundle-Delta**
- Implementierung: **2–3 Werktage**
- Migration: **005** (004 ist Voice-Picker, nicht anfassen)

---

## Kreuzverweise

- [[architect-review-format]] — Review-Struktur
- [[workflow-plan-execution]] — direct-on-main, one-commit-per-task
- [[roles-actors]] — frische Session = CC1-Implementierungs-Slot
- v3-Plan-Prompt: `2026-05-25-vibegrid-plan-8c-v3-fal-render-pipeline.md`
- v1-Review: `2026-05-25-vibegrid-CC2_Review-plan-8c.md`
- Bestehender Code: `lib/fal/client.ts` (Stubs), `lib/tts/{edge,elevenlabs}.ts` (Voice-Picker post-8b), `lib/sceneflow/{types,sonnet,scenes-db}.ts`, Migrationen bis `004`
- Vercel-Hobby-60s-Timeout — KNOWN_LIMITATIONS.md (post-5.9b)
