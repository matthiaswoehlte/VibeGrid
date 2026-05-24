import 'server-only';
import { getAnthropicClient } from '@/lib/ai/anthropic';
import { getAnthropicConfig } from '@/lib/ai/env';
import type { CharacterRecord, StoryRecord } from './types';
import type { NewSceneInput } from './scenes-db';

const SUBMIT_SCENES_TOOL = {
  name: 'submit_scenes',
  description: 'Submit the structured scene list for the story.',
  input_schema: {
    type: 'object',
    properties: {
      scenes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            scene_order: { type: 'integer', minimum: 1 },
            type: { type: 'string', enum: ['action', 'dialog', 'endcard'] },
            image_prompt: { type: 'string' },
            motion_prompt: { type: 'string' },
            camera_control: {
              type: ['object', 'null'],
              properties: {
                zoom: { type: 'number' },
                panX: { type: 'number' },
                panY: { type: 'number' },
                motionIntensity: { type: 'number' }
              }
            },
            duration: { type: 'integer' },
            audio_type: { type: 'string', enum: ['none', 'voiceover', 'lipsync'] },
            tts_text: { type: ['string', 'null'] },
            speaking_character_id: { type: ['string', 'null'] },
            transition: { type: 'string', enum: ['last-frame', 'crossfade', 'cut'] },
            start_frame_mode: { type: 'string', enum: ['auto', 'from-previous', 'custom'] }
          },
          required: [
            'scene_order',
            'type',
            'image_prompt',
            'motion_prompt',
            'duration',
            'audio_type',
            'transition',
            'start_frame_mode'
          ]
        }
      }
    },
    required: ['scenes']
  }
} as const;

const SYSTEM_PROMPT = `Du bist ein professioneller Video-Storyboard-Autor.
Deine Aufgabe: Eine Story-Beschreibung in eine strukturierte Szenen-Liste
für KI-Video-Generierung aufteilen, und sie über das submit_scenes-Tool
abzugeben.

Regeln:
- Jede Szene 1–8 Sekunden (Standard: 5s)
- @Name-Referenzen im Story-Text werden durch Charakter-Details ersetzt
  (Namen + visuelle Beschreibung); die Charaktere sind im nächsten
  System-Block aufgelistet
- image_prompt: vollständig ausformuliert auf Englisch, visuellen
  Stil bereits eingearbeitet, fotorealistisch
- motion_prompt: Kamera-Beschreibung auf Englisch
- camera_control: zoom -5..+5, panX -5..+5, panY -5..+5, motionIntensity 1..10
- tts_text: ausformuliert, natürliche Sprache (Deutsch wenn Story auf
  Deutsch, sonst Englisch); null für action/endcard-Szenen ohne Audio
- speaking_character_id: GENAU eine der UUIDs aus der Charakter-Liste
  oder null — KEINE erfundenen IDs
- scene_order: 1, 2, 3, ... fortlaufend ohne Lücken
- Erste Szene: start_frame_mode = "auto"
- Folge-Szenen: start_frame_mode = "from-previous"
- Dialog/LipSync-Szenen: transition = "last-frame"
- Crossfade für emotionale Übergänge
- Immer mit einer endcard-Szene abschließen (type = "endcard")`;

export interface SonnetSceneRaw {
  scene_order: number;
  type: 'action' | 'dialog' | 'endcard';
  image_prompt: string;
  motion_prompt: string;
  camera_control: {
    zoom: number;
    panX: number;
    panY: number;
    motionIntensity: number;
  } | null;
  duration: number;
  audio_type: 'none' | 'voiceover' | 'lipsync';
  tts_text?: string | null;
  speaking_character_id?: string | null;
  transition: 'last-frame' | 'crossfade' | 'cut';
  start_frame_mode: 'auto' | 'from-previous' | 'custom';
}

const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));

export function coerceSonnetScenes(
  raw: SonnetSceneRaw[],
  characters: Pick<CharacterRecord, 'id'>[]
): NewSceneInput[] {
  const validIds = new Set(characters.map((c) => c.id));
  return raw.map((s, idx): NewSceneInput => {
    const cameraCtl = s.camera_control
      ? {
          zoom: clamp(s.camera_control.zoom, -5, 5),
          panX: clamp(s.camera_control.panX, -5, 5),
          panY: clamp(s.camera_control.panY, -5, 5),
          motionIntensity: Math.round(clamp(s.camera_control.motionIntensity, 1, 10))
        }
      : null;
    const duration = Math.round(clamp(s.duration, 1, 8));
    const noAudio = s.audio_type === 'none';
    let speaker = s.speaking_character_id ?? null;
    if (speaker !== null && !validIds.has(speaker)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[sonnet] hallucinated speaking_character_id ${speaker} — null-ing`
      );
      speaker = null;
    }
    return {
      scene_order: idx + 1,
      type: s.type,
      image_prompt: s.image_prompt,
      motion_prompt: s.motion_prompt,
      camera_control: cameraCtl,
      duration,
      audio_type: s.audio_type,
      tts_text: noAudio ? null : s.tts_text ?? null,
      speaking_character_id: noAudio ? null : speaker,
      transition: s.transition,
      start_frame_mode: s.start_frame_mode,
      status: 'pending',
      fal_request_ids: null
    };
  });
}

export interface GenerateScenesArgs {
  storyText: string;
  story: StoryRecord;
  characters: CharacterRecord[];
}

export interface GenerateScenesResult {
  scenes: NewSceneInput[];
  usage: { input_tokens: number; output_tokens: number };
}

export async function generateScenesViaSonnet(
  args: GenerateScenesArgs
): Promise<GenerateScenesResult> {
  const cli = getAnthropicClient();
  const cfg = getAnthropicConfig();

  const characterContext =
    args.characters.length === 0
      ? 'No characters defined.'
      : `Available characters (use their UUIDs verbatim in speaking_character_id):\n` +
        args.characters
          .map(
            (c) =>
              `- ${c.name} [${c.type}] uuid=${c.id}` +
              (c.image_prompt ? ` · visual: ${c.image_prompt}` : '')
          )
          .join('\n');

  const storyContext =
    `Story title: ${args.story.title}\n` +
    `Format: ${args.story.format}\n` +
    (args.story.visual_style ? `Visual style: ${args.story.visual_style}\n` : '');

  const res = await cli.messages.create({
    model: cfg.model,
    max_tokens: 16000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }
      },
      {
        type: 'text',
        text: characterContext,
        cache_control: { type: 'ephemeral' }
      }
    ],
    tools: [SUBMIT_SCENES_TOOL],
    tool_choice: { type: 'tool', name: 'submit_scenes' },
    messages: [
      {
        role: 'user',
        content: `${storyContext}\n\nStory:\n${args.storyText}`
      }
    ]
  // SDK 0.30 typing for tools/cache-control parameters is narrower than the
  // wire protocol — cast to any so the runtime-valid request compiles.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const block = res.content.find(
    (b): b is Extract<typeof b, { type: 'tool_use' }> =>
      b.type === 'tool_use' && b.name === 'submit_scenes'
  );
  if (!block) {
    throw new Error(
      'Sonnet did not call submit_scenes — got text response instead'
    );
  }
  const rawScenes = (block.input as { scenes: SonnetSceneRaw[] }).scenes;
  const scenes = coerceSonnetScenes(rawScenes, args.characters);

  return {
    scenes,
    usage: {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens
    }
  };
}
