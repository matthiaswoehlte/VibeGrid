import { getDeviceCapabilities, type DeviceCapabilities } from './capabilities';

/**
 * Plan 8f.1 — WebGL Quality Manager. Hält einen rollenden FPS-Mittelwert
 * (FPS_WINDOW Frames) und skaliert die WebGL-Render-Auflösung asymmetrisch:
 *
 *   FPS < DOWN_FPS für FRAMES_DOWN Frames hintereinander → scale 1.0→0.75→0.5
 *   FPS > UP_FPS    für FRAMES_UP   Frames hintereinander → scale eine Stufe hoch
 *
 *   Asymmetrie (FRAMES_DOWN=20, FRAMES_UP=60): verhindert Oszillation auf
 *   Geräten die genau an der Schwelle hängen.
 *
 * Zwei Override-Modi:
 *   - `pinToMax(true)` → User-Choice, scale bleibt 1.0 unabhängig von FPS.
 *     Persistierung: localStorage (kein STORE_VERSION-Bump nötig).
 *   - `setOffline(true)` → Offline-Export, scale=1.0 erzwungen + recordFrame
 *     ist No-Op. Export-Pfad muss try/finally setOffline(false) garantieren.
 *
 * Erste FPS_WINDOW Frames sind no-op (rolling-avg noch nicht stabil) —
 * bewusst, dokumentiert in KNOWN_LIMITATIONS.
 */
export type QualityScale = 1.0 | 0.75 | 0.5;
const LEVELS: QualityScale[] = [1.0, 0.75, 0.5];

const FPS_WINDOW = 30;
const DOWN_FPS = 45;
const UP_FPS = 55;
const FRAMES_DOWN = 20;
const FRAMES_UP = 60;

export interface QualityState {
  scale: QualityScale;
  userPinned: boolean;
  avgFps: number;
  tier: DeviceCapabilities['tier'];
  offline: boolean;
}

class QualityManager {
  private hist: number[] = [];
  private lastMs = 0;
  private below = 0;
  private above = 0;
  private idx = 0;
  private _pinned = false;
  private _offline = false;

  recordFrame(nowMs: number): void {
    if (this._offline) return;
    if (this.lastMs > 0) {
      const fps = 1000 / (nowMs - this.lastMs);
      this.hist.push(fps);
      if (this.hist.length > FPS_WINDOW) this.hist.shift();
    }
    this.lastMs = nowMs;
    if (!this._pinned) this.adjust();
  }

  setOffline(offline: boolean): void {
    this._offline = offline;
    if (offline) {
      this.idx = 0;
      this.below = 0;
      this.above = 0;
    }
  }

  get scale(): QualityScale {
    return this._pinned || this._offline ? 1.0 : LEVELS[this.idx];
  }

  get avgFps(): number {
    if (!this.hist.length) return 60;
    return this.hist.reduce((a, b) => a + b) / this.hist.length;
  }

  pinToMax(pin: boolean): void {
    this._pinned = pin;
    if (pin) {
      this.idx = 0;
      this.below = 0;
      this.above = 0;
    }
  }

  getState(): QualityState {
    return {
      scale: this.scale,
      userPinned: this._pinned,
      avgFps: Math.round(this.avgFps),
      tier: getDeviceCapabilities().tier,
      offline: this._offline
    };
  }

  private adjust(): void {
    if (this.hist.length < FPS_WINDOW) return;
    const avg = this.avgFps;
    if (avg < DOWN_FPS) {
      this.above = 0;
      if (++this.below >= FRAMES_DOWN && this.idx < LEVELS.length - 1) {
        this.idx++;
        this.below = 0;
        // eslint-disable-next-line no-console
        console.info(
          `[VibeGrid] WebGL quality → ${LEVELS[this.idx]}× (FPS ${avg.toFixed(0)})`
        );
      }
    } else if (avg > UP_FPS) {
      this.below = 0;
      if (++this.above >= FRAMES_UP && this.idx > 0) {
        this.idx--;
        this.above = 0;
        // eslint-disable-next-line no-console
        console.info(
          `[VibeGrid] WebGL quality → ${LEVELS[this.idx]}× (FPS ${avg.toFixed(0)})`
        );
      }
    } else {
      this.below = 0;
      this.above = 0;
    }
  }
}

export const qualityManager = new QualityManager();

/** Test-only: voller Reset (FPS-History, Counter, Modi). */
export function _resetQualityManagerForTests(): void {
  // We can't reach private fields from outside; provide a hard reset
  // by reaching into the manager. The cast is local to this helper.
  const m = qualityManager as unknown as {
    hist: number[];
    lastMs: number;
    below: number;
    above: number;
    idx: number;
    _pinned: boolean;
    _offline: boolean;
  };
  m.hist = [];
  m.lastMs = 0;
  m.below = 0;
  m.above = 0;
  m.idx = 0;
  m._pinned = false;
  m._offline = false;
}
