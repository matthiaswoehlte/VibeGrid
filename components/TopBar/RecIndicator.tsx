'use client';
import { useAppStore } from '@/lib/store';

function formatMMSS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/**
 * Two visual layouts:
 * - **Realtime** (Plan 6): red blinking dot + "REC MM:SS / MM:SS" timecode.
 *   Audio is playing back live; the timer follows the audio element.
 * - **Offline** (Plan 6-R): teal progress bar + "Rendering X / Y (Z %) · ETA M:SS".
 *   No audio playback; progress comes from renderOffline's onProgress.
 *
 * Both layouts share the ✕ cancel button.
 */
export function RecIndicator({ onCancel }: { onCancel: () => void }) {
  const status = useAppStore((s) => s.ui.exportState.status);
  const mode = useAppStore((s) => s.ui.exportState.mode);
  const elapsed = useAppStore((s) => s.ui.exportState.elapsedSeconds);
  const total = useAppStore((s) => s.ui.exportState.totalSeconds);
  const currentFrame = useAppStore((s) => s.ui.exportState.currentFrame);
  const totalFrames = useAppStore((s) => s.ui.exportState.totalFrames);
  const etaSeconds = useAppStore((s) => s.ui.exportState.etaSeconds);
  const preparingPhase = useAppStore((s) => s.ui.exportState.preparingPhase);

  // Show during all "active" statuses so the user sees that something is
  // happening even before the first onProgress fires (preparing → finalizing).
  if (
    status !== 'preparing' &&
    status !== 'recording' &&
    status !== 'finalizing'
  ) {
    return null;
  }

  if (mode === 'offline') {
    const percent =
      totalFrames && totalFrames > 0 && currentFrame
        ? Math.min(100, Math.round((currentFrame / totalFrames) * 100))
        : 0;
    const etaLabel =
      etaSeconds !== undefined ? `· ETA ${formatMMSS(etaSeconds)}` : '';
    const headline =
      status === 'finalizing'
        ? 'Finalizing…'
        : status === 'preparing'
          ? // Pre-load phase: show what we're loading. The decoder pool
            // refetches each video MP4 (~50-150 MB total), which can take
            // 30-60 s on flaky connections — without this label the user
            // sees a blank progress bar and thinks the app froze.
            preparingPhase ?? 'Vorbereitung…'
          : `Rendering ${currentFrame ?? 0} / ${totalFrames ?? 0} (${percent}%) ${etaLabel}`;

    return (
      <div className="flex items-center gap-2 px-2">
        <span
          aria-label="Rendering"
          className="font-mono text-xs text-[var(--text)]"
        >
          {headline}
        </span>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="w-32 h-1.5 rounded bg-[var(--surface-3)] overflow-hidden"
        >
          <div
            className="h-full bg-[var(--a3)] transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <button
          type="button"
          aria-label="Cancel export"
          onClick={onCancel}
          className="h-6 w-6 rounded text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-3)]"
          title="Cancel export"
        >
          ✕
        </button>
      </div>
    );
  }

  // Realtime path — keep the original Plan-6 layout.
  if (status !== 'recording') return null;
  return (
    <div className="flex items-center gap-2 px-2">
      <span
        aria-label="Recording"
        className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"
      />
      <span className="font-mono text-xs text-[var(--text)]">
        REC {formatMMSS(elapsed)} / {formatMMSS(total)}
      </span>
      <button
        type="button"
        aria-label="Cancel export"
        onClick={onCancel}
        className="h-6 w-6 rounded text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-3)]"
        title="Cancel export"
      >
        ✕
      </button>
    </div>
  );
}
