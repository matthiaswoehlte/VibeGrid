'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  apiGenerateImagesAndVoices,
  apiGenerateVideos,
  apiTransfer
} from '@/lib/sceneflow/api-client';
import {
  validateScenesForGeneration,
  hasBlockers,
  warningsByScene
} from '@/lib/sceneflow/validation';
import { SceneWarningList } from './SceneWarning';
import type { SceneRecord, CharacterRecord, StoryRecord } from '@/lib/sceneflow/types';

/**
 * Plan 8c — bottom-bar controls for Phase 1, Phase 2, and Transfer.
 *
 * Phase 1 button is disabled while any 🔴 blocker is present. 🟡 warnings
 * are surfaced and the button switches to a confirm prompt. Phase 2 is
 * disabled until every non-endcard scene has an image_url. Transfer is
 * active when at least one scene has a video_url.
 */
export function GenerationControls({
  story,
  scenes,
  characters,
  onTransfer
}: {
  story: StoryRecord;
  scenes: SceneRecord[];
  characters: CharacterRecord[];
  onTransfer?(clips: unknown[]): void;
}) {
  const [busyPhase1, setBusyPhase1] = useState(false);
  const [busyPhase2, setBusyPhase2] = useState(false);
  const [busyTransfer, setBusyTransfer] = useState(false);

  const warnings = validateScenesForGeneration({
    story,
    scenes,
    characters
  });
  const blockerOn = hasBlockers(warnings);
  const warnOnly = warnings.length > 0 && !blockerOn;

  const phase1Done = scenes
    .filter((s) => s.type !== 'endcard')
    .every((s) => s.image_url !== null);

  const phase2HasAnyVideo = scenes.some((s) => s.video_url !== null);
  const phase2Done = scenes.every(
    (s) => s.type === 'endcard' || s.video_url !== null
  );

  async function runPhase1() {
    if (blockerOn) return;
    if (warnOnly) {
      const ok = window.confirm(
        'Es gibt gelbe Warnungen. Generierung trotzdem starten?'
      );
      if (!ok) return;
    }
    setBusyPhase1(true);
    try {
      const res = await apiGenerateImagesAndVoices(story.id);
      const ttsFail = res.tts.total - res.tts.ok;
      const imgFail = res.images.total - res.images.ok;
      if (ttsFail === 0 && imgFail === 0) {
        toast.success('Phase 1 fertig — Bilder und Stimmen generiert.');
      } else {
        toast.warning(
          `Phase 1 teilweise fehlgeschlagen — TTS ${ttsFail}, Bilder ${imgFail}`
        );
      }
    } catch (e) {
      toast.error('Phase 1 fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusyPhase1(false);
    }
  }

  async function runPhase2() {
    setBusyPhase2(true);
    try {
      const res = await apiGenerateVideos(story.id);
      toast.success(`Phase 2 gestartet — ${res.enqueued} Job(s) in der Queue.`);
    } catch (e) {
      toast.error('Phase 2 fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusyPhase2(false);
    }
  }

  async function runTransfer() {
    setBusyTransfer(true);
    try {
      const res = await apiTransfer(story.id);
      onTransfer?.(res.clips);
      toast.success(
        `Transfer bereit — ${res.clips.length} Clip(s). Timeline-Integration: Plan 8d.`
      );
    } catch (e) {
      toast.error('Transfer fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setBusyTransfer(false);
    }
  }

  const byScene = warningsByScene(warnings);

  return (
    <div className="sticky bottom-0 mt-4 bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-3 space-y-2">
      {warnings.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--text-dim)] select-none">
            {blockerOn ? '🔴' : '🟡'} {warnings.length} Warnung(en) — Details
          </summary>
          <div className="mt-2 space-y-2">
            {Array.from(byScene.entries()).map(([sceneId, sceneWarnings]) => {
              const s = scenes.find((x) => x.id === sceneId);
              return (
                <div key={sceneId}>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">
                    Szene {s?.scene_order}
                  </div>
                  <SceneWarningList warnings={sceneWarnings} />
                </div>
              );
            })}
          </div>
        </details>
      )}
      <div className="flex gap-2 items-center">
        <button
          type="button"
          disabled={busyPhase1 || blockerOn || scenes.length === 0}
          onClick={runPhase1}
          className="px-3 py-1.5 text-xs rounded bg-[var(--a1)] text-white disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busyPhase1 ? 'läuft …' : 'Image + Voice Generation'}
        </button>
        <button
          type="button"
          disabled={busyPhase2 || !phase1Done}
          onClick={runPhase2}
          className="px-3 py-1.5 text-xs rounded bg-[var(--a2)] text-white disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busyPhase2 ? 'enqueued …' : 'Create Full Movie'}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          disabled={busyTransfer || !phase2HasAnyVideo}
          onClick={runTransfer}
          className="px-3 py-1.5 text-xs rounded bg-[var(--a3)] text-black disabled:opacity-30 disabled:cursor-not-allowed"
          title={
            phase2Done
              ? 'Alle Szenen fertig — Timeline öffnen'
              : 'Mindestens ein Video erstellt — Timeline-Integration in Plan 8d'
          }
        >
          {busyTransfer ? '...' : 'Transfer to Timeline'}
        </button>
      </div>
    </div>
  );
}
