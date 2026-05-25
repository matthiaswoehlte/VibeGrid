'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CameraControlSliders } from './CameraControlSliders';
import { EndcardEditor } from './EndcardEditor';
import { ImageViewer } from './ImageViewer';
import { apiRetryImage, apiRetryVideo } from '@/lib/sceneflow/api-client';
import { computeNextGenerationStep } from '@/lib/sceneflow/scene-state';
import type {
  SceneRecord,
  CameraControl,
  AudioType,
  Transition,
  StartFrameMode,
  CharacterRecord
} from '@/lib/sceneflow/types';
import type { UpdateScenePatch } from '@/lib/sceneflow/scenes-db';

const DEBOUNCE_MS = 500;

const DEFAULT_CAMERA: CameraControl = {
  zoom: 0,
  panX: 0,
  panY: 0,
  motionIntensity: 5
};

export function SceneCard({
  scene,
  characters,
  canMoveUp,
  canMoveDown,
  onPatchField,
  onPatchFieldImmediate,
  onDelete,
  onMoveUp,
  onMoveDown
}: {
  scene: SceneRecord;
  characters: CharacterRecord[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPatchField(sceneId: string, field: keyof UpdateScenePatch, value: unknown): void;
  onPatchFieldImmediate(
    sceneId: string,
    field: keyof UpdateScenePatch,
    value: unknown
  ): Promise<void>;
  onDelete(sceneId: string): void;
  onMoveUp(): void;
  onMoveDown(): void;
}) {
  const [imagePrompt, setImagePrompt] = useState(scene.image_prompt ?? '');
  const [motionPrompt, setMotionPrompt] = useState(scene.motion_prompt ?? '');
  const [ttsText, setTtsText] = useState(scene.tts_text ?? '');
  const imgT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const motT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ttsT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setImagePrompt(scene.image_prompt ?? '');
  }, [scene.id, scene.image_prompt]);
  useEffect(() => {
    setMotionPrompt(scene.motion_prompt ?? '');
  }, [scene.id, scene.motion_prompt]);
  useEffect(() => {
    setTtsText(scene.tts_text ?? '');
  }, [scene.id, scene.tts_text]);

  function delTextarea(
    field: keyof UpdateScenePatch,
    v: string,
    ref: typeof imgT
  ) {
    if (ref.current) clearTimeout(ref.current);
    ref.current = setTimeout(
      () => onPatchField(scene.id, field, v),
      DEBOUNCE_MS
    );
  }

  if (scene.type === 'endcard') {
    return (
      <SceneCardShell
        scene={scene}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDelete={() => onDelete(scene.id)}
      >
        <EndcardEditor
          scene={scene}
          onPatchField={onPatchField}
          onPatchFieldImmediate={onPatchFieldImmediate}
        />
      </SceneCardShell>
    );
  }

  const camera = scene.camera_control ?? DEFAULT_CAMERA;

  return (
    <SceneCardShell
      scene={scene}
      canMoveUp={canMoveUp}
      canMoveDown={canMoveDown}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onDelete={() => onDelete(scene.id)}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Bild
          </span>
          <textarea
            value={imagePrompt}
            onChange={(e) => {
              setImagePrompt(e.target.value);
              delTextarea('image_prompt', e.target.value, imgT);
            }}
            rows={3}
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          />
          <ImageSlot scene={scene} />
        </div>
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Video
          </span>
          <textarea
            value={motionPrompt}
            onChange={(e) => {
              setMotionPrompt(e.target.value);
              delTextarea('motion_prompt', e.target.value, motT);
            }}
            rows={3}
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          />
          <VideoSlot scene={scene} />
        </div>
      </div>

      <div>
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          Startbild
        </span>
        <div className="flex gap-3 mt-1 text-xs text-[var(--text)]">
          {(['auto', 'from-previous', 'custom'] as StartFrameMode[]).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="radio"
                name={`sfm-${scene.id}`}
                checked={scene.start_frame_mode === m}
                onChange={() =>
                  onPatchFieldImmediate(scene.id, 'start_frame_mode', m)
                }
              />
              {m === 'auto'
                ? 'Auto'
                : m === 'from-previous'
                ? 'Letzter Frame'
                : 'Upload (8c)'}
            </label>
          ))}
        </div>
      </div>

      <CameraControlSliders
        value={camera}
        onChange={(next) => onPatchField(scene.id, 'camera_control', next)}
      />

      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          Audio
        </span>
        <div className="flex gap-3 text-xs text-[var(--text)]">
          {(['none', 'voiceover', 'lipsync'] as AudioType[]).map((a) => (
            <label key={a} className="flex items-center gap-1">
              <input
                type="radio"
                name={`audio-${scene.id}`}
                checked={scene.audio_type === a}
                onChange={() =>
                  onPatchFieldImmediate(scene.id, 'audio_type', a)
                }
              />
              {a === 'none'
                ? 'Kein Audio'
                : a === 'voiceover'
                ? 'Voiceover'
                : 'Dialog/LipSync'}
            </label>
          ))}
        </div>
        {scene.audio_type !== 'none' && (
          <>
            <select
              value={scene.speaking_character_id ?? ''}
              onChange={(e) =>
                onPatchFieldImmediate(
                  scene.id,
                  'speaking_character_id',
                  e.target.value || null
                )
              }
              className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
            >
              <option value="">— Charakter wählen —</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  @{c.name}
                </option>
              ))}
            </select>
            <textarea
              value={ttsText}
              onChange={(e) => {
                setTtsText(e.target.value);
                delTextarea('tts_text', e.target.value, ttsT);
              }}
              rows={2}
              placeholder="TTS-Text ..."
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-[var(--text-muted)]">Dauer (s)</span>
          <input
            type="number"
            min={1}
            max={8}
            value={scene.duration}
            onChange={(e) =>
              onPatchFieldImmediate(
                scene.id,
                'duration',
                Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 5))
              )
            }
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-[var(--text-muted)]">Transition</span>
          <select
            value={scene.transition}
            onChange={(e) =>
              onPatchFieldImmediate(
                scene.id,
                'transition',
                e.target.value as Transition
              )
            }
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] text-xs"
          >
            <option value="last-frame">Last frame</option>
            <option value="crossfade">Crossfade</option>
            <option value="cut">Cut</option>
          </select>
        </label>
      </div>
    </SceneCardShell>
  );
}

const STEP_LABEL: Record<
  ReturnType<typeof computeNextGenerationStep>,
  string
> = {
  image: 'generiert Bild …',
  audio: 'erzeugt Stimme …',
  neutral_video: 'Video wird verarbeitet …',
  lipsync: 'lipsync läuft …',
  done: 'fertig'
};

function ImageSlot({ scene }: { scene: SceneRecord }) {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const step = computeNextGenerationStep(scene);
  const errored = scene.status === 'error';

  async function onRetry() {
    setRetrying(true);
    try {
      await apiRetryImage(scene.id);
      toast.success('Bild wird neu generiert …');
    } catch (e) {
      toast.error('Retry fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  if (scene.image_url !== null) {
    return (
      <>
        <button
          type="button"
          onPointerDown={() => setOpen(true)}
          className="aspect-video w-full bg-[var(--surface-3)] rounded overflow-hidden"
          aria-label="Bild vergrößern"
        >
          <img
            src={scene.image_url}
            alt={`Szene ${scene.scene_order}`}
            className="w-full h-full object-cover"
          />
        </button>
        <div className="flex items-center justify-end mt-1">
          <button
            type="button"
            disabled={retrying}
            onPointerDown={onRetry}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
          >
            {retrying ? '…' : '↻ Bild neu'}
          </button>
        </div>
        {open && (
          <ImageViewer
            url={scene.image_url}
            alt={`Szene ${scene.scene_order}`}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }
  return (
    <div className="aspect-video bg-[var(--surface-3)] rounded flex items-center justify-center text-[10px] text-[var(--text-muted)] text-center p-2">
      {errored ? (
        <div className="space-y-1">
          <div className="text-red-300">✗ {scene.error_message ?? 'Fehler'}</div>
          <button
            type="button"
            onPointerDown={onRetry}
            className="text-[var(--a2)] hover:text-[var(--a1)]"
          >
            ↻ Erneut versuchen
          </button>
        </div>
      ) : scene.status === 'generating' && (step === 'image' || step === 'audio') ? (
        <span className="animate-pulse">{STEP_LABEL[step]}</span>
      ) : (
        <span>○ ausstehend</span>
      )}
    </div>
  );
}

function VideoSlot({ scene }: { scene: SceneRecord }) {
  const [retrying, setRetrying] = useState(false);
  const step = computeNextGenerationStep(scene);
  const errored = scene.status === 'error';

  async function onRetry() {
    setRetrying(true);
    try {
      await apiRetryVideo(scene.id);
      toast.success('Video wird neu generiert …');
    } catch (e) {
      toast.error('Retry fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  if (scene.video_url !== null) {
    return (
      <>
        <video
          src={scene.video_url}
          controls
          playsInline
          className="aspect-video w-full bg-black rounded"
        />
        <div className="flex items-center justify-end mt-1">
          <button
            type="button"
            disabled={retrying}
            onPointerDown={onRetry}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
          >
            {retrying ? '…' : '↻ Video neu'}
          </button>
        </div>
      </>
    );
  }
  return (
    <div className="aspect-video bg-[var(--surface-3)] rounded flex items-center justify-center text-[10px] text-[var(--text-muted)] text-center p-2">
      {errored ? (
        <div className="space-y-1">
          <div className="text-red-300">✗ {scene.error_message ?? 'Fehler'}</div>
          <button
            type="button"
            onPointerDown={onRetry}
            className="text-[var(--a2)] hover:text-[var(--a1)]"
          >
            ↻ Erneut versuchen
          </button>
        </div>
      ) : scene.status === 'generating' ? (
        <span className="animate-pulse">{STEP_LABEL[step]}</span>
      ) : (
        <span>○ ausstehend</span>
      )}
    </div>
  );
}

function SceneCardShell({
  scene,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDelete,
  children
}: {
  scene: SceneRecord;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp(): void;
  onMoveDown(): void;
  onDelete(): void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-[var(--text)]">
          Szene {scene.scene_order}
        </span>
        <span className="text-[10px] uppercase text-[var(--text-muted)] tracking-wider">
          {scene.type}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          disabled={!canMoveUp}
          onClick={onMoveUp}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-30 px-2"
          title="Nach oben"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={!canMoveDown}
          onClick={onMoveDown}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-30 px-2"
          title="Nach unten"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Szene ${scene.scene_order} löschen?`)) onDelete();
          }}
          className="text-xs text-[var(--text-muted)] hover:text-red-400 px-2"
          title="Löschen"
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}
