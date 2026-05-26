# CC #1 Feedback — nach Plan 2 QA

Plan 2 freigegeben. 3 Fixes vor Plan 3, 2 Punkte auf Watchlist.

---

## Fix 1: HTMLMediaElement Stubs in vitest.setup.ts (MUSS vor Plan 3)

CC #2 hat recht — das Stderr-Rauschen wird bei Plan 3 (Renderer-Tests)
echte Fehler maskieren. Jetzt fixen:

```ts
// vitest.setup.ts — ergänzen:
window.HTMLMediaElement.prototype.play = async () => {};
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.load = () => {};
```

Commit: `test(setup): stub HTMLMediaElement methods to silence jsdom noise`

---

## Fix 2: BPM_MIN / BPM_MAX als Single Source of Truth

```ts
// lib/audio/types.ts — ergänzen:
export const BPM_MIN = 60;
export const BPM_MAX = 200;

// lib/audio/engine.ts — ersetzen:
// STATT: const BPM_MIN = 60; const BPM_MAX = 200;
import { BPM_MIN, BPM_MAX } from './types';

// lib/store/audio-slice.ts — ersetzen:
// STATT: const BPM_MIN = 60; const BPM_MAX = 200;
import { BPM_MIN, BPM_MAX } from '@/lib/audio/types';
```

Commit: `refactor(audio): BPM_MIN/MAX as single source of truth in types.ts`

---

## Fix 3: detectBPM abort-race absichern

```ts
// lib/audio/engine.ts — in worker.onmessage, result-Branch:
} else if (msg.type === 'result') {
  if (myAbortSignal.aborted) return; // ← neu: race condition guard
  signal.removeEventListener('abort', onAbort);
  worker.terminate();
  // ... rest wie bisher
}
```

Commit: `fix(audio): guard detectBPM result handler against abort race`

---

## Watchlist für Plan 3 (kein Fix jetzt)

**Punkt 4 — Engine-setBPM vs. Store-setBPM Divergenz:**
Plan 5 (UI) synchronisiert beide via `useAudioEngine` Hook.
CC #1 soll in Plan 5 explizit darauf hingewiesen werden.
Kein Fix jetzt.

**Punkt 5 — beatPhase negative beats:**
Plan 3 Renderer muss `if (beats < 0) return` Guard haben.
Wird als explizite Anforderung in Plan 3 Feedback aufgenommen.

---

Danach: Plan 3 (Renderer + FX) schreiben und zur Review schicken.
