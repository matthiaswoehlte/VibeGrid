'use client';
import { useAppStore } from '@/lib/store';
import { isAutomationCurve } from '@/lib/automation/resolve';

export function AutomateButton({
  clipId,
  paramKey,
  paramLabel,
  value
}: {
  clipId: string;
  paramKey: string;
  paramLabel: string;
  value: unknown;
}) {
  const playheadBeats = useAppStore((s) => s.timeline.playhead.beats);
  const convertToAuto = useAppStore((s) => s.timelineActions.convertParamToAutomation);
  const convertToStatic = useAppStore((s) => s.timelineActions.convertParamToStatic);
  const automated = isAutomationCurve(value);

  const onClick = () => {
    if (automated) convertToStatic(clipId, paramKey);
    // Pass `value` so the store can seed a curve for clips that have never
    // written this key (clip.params is undefined / lacks the entry). The
    // Inspector already merges plugin defaults into `value`, so it's the
    // correct starting value regardless of whether the user has touched it.
    else convertToAuto(clipId, paramKey, playheadBeats, value);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Automate ${paramLabel}`}
      aria-pressed={automated}
      className={
        'ml-2 inline-flex h-5 w-5 items-center justify-center rounded text-[10px] ' +
        (automated
          ? 'bg-[var(--a2)] text-white'
          : 'bg-[var(--surface-3)] text-[var(--text-dim)] hover:text-[var(--text)]')
      }
      title={automated ? 'Remove automation' : 'Add automation'}
    >
      ⚡
    </button>
  );
}
