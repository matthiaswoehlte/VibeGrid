import 'server-only';
import type { CharacterRecord, SceneRecord } from './types';
import type { NewSceneInput } from './scenes-db';

/**
 * Plan post-8.6 — JSON I/O for scenes (admin-only).
 *
 * The exchange format mirrors the raw Anthropic API response that
 * generate-scenes would have produced:
 *
 *   {
 *     id, type: "message", role: "assistant", model,
 *     stop_reason: "tool_use", stop_sequence: null, usage: {...},
 *     content: [{
 *       type: "tool_use", id, name: "submit_scenes",
 *       input: { scenes: [ ...portable scenes... ] }
 *     }]
 *   }
 *
 * Portable scene shape: speaking_character is a NAME string (or null),
 * not a UUID. This makes JSON re-importable across stories — the
 * import side looks up the character by name in the target story's
 * characters[].
 */

export interface PortableScene {
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
  tts_text: string | null;
  speaking_character: string | null;
  transition: 'last-frame' | 'crossfade' | 'cut';
  start_frame_mode: 'auto' | 'from-previous' | 'custom';
}

export interface ScenesEnvelope {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  stop_reason: 'tool_use';
  stop_sequence: null;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  };
  content: [
    {
      type: 'tool_use';
      id: string;
      name: string;
      input: { scenes: PortableScene[] };
    }
  ];
}

// ---------- Export ----------

export interface SerializeArgs {
  scenes: SceneRecord[];
  characters: CharacterRecord[];
  /** Sonnet model id to embed in the envelope (cosmetic). */
  model?: string;
}

export function serializeScenesToEnvelope(args: SerializeArgs): ScenesEnvelope {
  const charById = new Map(args.characters.map((c) => [c.id, c.name]));
  const portable: PortableScene[] = args.scenes
    .slice()
    .sort((a, b) => a.scene_order - b.scene_order)
    .map((s) => ({
      scene_order: s.scene_order,
      type: s.type,
      image_prompt: s.image_prompt ?? '',
      motion_prompt: s.motion_prompt ?? '',
      camera_control: s.camera_control,
      duration: s.duration,
      audio_type: s.audio_type,
      tts_text: s.tts_text,
      speaking_character:
        s.speaking_character_id !== null
          ? (charById.get(s.speaking_character_id) ?? null)
          : null,
      transition: s.transition,
      start_frame_mode:
        s.start_frame_mode === 'custom' ? 'custom' : s.start_frame_mode
    }));

  return {
    id: `msg_export_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model: args.model ?? 'claude-sonnet-4-export',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0
    },
    content: [
      {
        type: 'tool_use',
        id: `toolu_export_${Date.now().toString(36)}`,
        name: 'submit_scenes',
        input: { scenes: portable }
      }
    ]
  };
}

// ---------- Import ----------

export interface ParsedImport {
  scenes: PortableScene[];
  unknownCharacterNames: string[];
}

export interface ImportEnvelopeArgs {
  envelope: unknown;
  /** Names of characters available on the target story — used to
   *  validate speaking_character references; unknowns surface in
   *  the parsed result so the UI can warn before applying. */
  storyCharacterNames: string[];
}

export class ScenesImportError extends Error {}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

/**
 * Tolerant parser: accepts either
 *   (a) the full Anthropic envelope ({content:[{input:{scenes:[...]}}]})
 *   (b) a bare { scenes: [...] }
 *   (c) a bare scenes array [...]
 * — so users can paste whatever they have.
 */
export function parseScenesEnvelope(args: ImportEnvelopeArgs): ParsedImport {
  const { envelope } = args;
  let rawScenes: unknown;

  if (Array.isArray(envelope)) {
    rawScenes = envelope;
  } else if (isObject(envelope)) {
    if (Array.isArray((envelope as { scenes?: unknown }).scenes)) {
      rawScenes = (envelope as { scenes: unknown }).scenes;
    } else if (Array.isArray((envelope as { content?: unknown }).content)) {
      const block = (envelope as { content: unknown[] }).content.find(
        (b) =>
          isObject(b) &&
          (b as { type?: unknown }).type === 'tool_use' &&
          isObject((b as { input?: unknown }).input)
      );
      if (block && isObject((block as { input: unknown }).input)) {
        const input = (block as { input: Record<string, unknown> }).input;
        if (Array.isArray(input.scenes)) rawScenes = input.scenes;
      }
    }
  }

  if (!Array.isArray(rawScenes)) {
    throw new ScenesImportError(
      'JSON does not contain a scenes array (looked at envelope.content[].input.scenes, .scenes, root array).'
    );
  }

  const knownNames = new Set(args.storyCharacterNames);
  const unknown = new Set<string>();
  const scenes: PortableScene[] = rawScenes.map((rs, i): PortableScene => {
    if (!isObject(rs)) {
      throw new ScenesImportError(`scenes[${i}] is not an object`);
    }
    const speakingCharacter =
      typeof rs.speaking_character === 'string' && rs.speaking_character.length > 0
        ? rs.speaking_character
        : null;
    if (speakingCharacter !== null && !knownNames.has(speakingCharacter)) {
      unknown.add(speakingCharacter);
    }
    const type = String(rs.type);
    if (!['action', 'dialog', 'endcard'].includes(type)) {
      throw new ScenesImportError(`scenes[${i}].type "${type}" invalid`);
    }
    const audioType = String(rs.audio_type ?? 'none');
    if (!['none', 'voiceover', 'lipsync'].includes(audioType)) {
      throw new ScenesImportError(
        `scenes[${i}].audio_type "${audioType}" invalid`
      );
    }
    const transition = String(rs.transition ?? 'cut');
    if (!['last-frame', 'crossfade', 'cut'].includes(transition)) {
      throw new ScenesImportError(
        `scenes[${i}].transition "${transition}" invalid`
      );
    }
    const startFrame = String(rs.start_frame_mode ?? 'auto');
    if (!['auto', 'from-previous', 'custom'].includes(startFrame)) {
      throw new ScenesImportError(
        `scenes[${i}].start_frame_mode "${startFrame}" invalid`
      );
    }
    const cam = isObject(rs.camera_control)
      ? {
          zoom: Number(rs.camera_control.zoom ?? 0),
          panX: Number(rs.camera_control.panX ?? 0),
          panY: Number(rs.camera_control.panY ?? 0),
          motionIntensity: Number(rs.camera_control.motionIntensity ?? 5)
        }
      : null;
    return {
      scene_order:
        typeof rs.scene_order === 'number' && Number.isFinite(rs.scene_order)
          ? rs.scene_order
          : i + 1,
      type: type as PortableScene['type'],
      image_prompt: String(rs.image_prompt ?? ''),
      motion_prompt: String(rs.motion_prompt ?? ''),
      camera_control: cam,
      duration:
        typeof rs.duration === 'number' && Number.isFinite(rs.duration)
          ? Math.max(1, Math.min(8, Math.round(rs.duration)))
          : 5,
      audio_type: audioType as PortableScene['audio_type'],
      tts_text:
        typeof rs.tts_text === 'string' && rs.tts_text.length > 0
          ? rs.tts_text
          : null,
      speaking_character: speakingCharacter,
      transition: transition as PortableScene['transition'],
      start_frame_mode: startFrame as PortableScene['start_frame_mode']
    };
  });

  return { scenes, unknownCharacterNames: Array.from(unknown) };
}

/**
 * Convert portable (name-based) scenes into NewSceneInput[] for
 * createScenes. Maps speaking_character (name) → speaking_character_id
 * (UUID) using the target story's character list. Unknown names →
 * speaking_character_id = null (UI was already warned).
 */
export function portableToNewSceneInputs(
  portable: PortableScene[],
  characters: CharacterRecord[]
): NewSceneInput[] {
  const idByName = new Map(characters.map((c) => [c.name, c.id]));
  return portable
    .slice()
    .sort((a, b) => a.scene_order - b.scene_order)
    .map((s, idx): NewSceneInput => {
      const noAudio = s.audio_type === 'none';
      const speakerId =
        !noAudio && s.speaking_character !== null
          ? (idByName.get(s.speaking_character) ?? null)
          : null;
      return {
        scene_order: idx + 1,
        type: s.type,
        image_prompt: s.image_prompt,
        motion_prompt: s.motion_prompt,
        camera_control: s.camera_control,
        duration: s.duration,
        audio_type: s.audio_type,
        tts_text: noAudio ? null : s.tts_text,
        speaking_character_id: speakerId,
        transition: s.transition,
        start_frame_mode: s.start_frame_mode,
        status: 'pending',
        fal_request_ids: null
      };
    });
}
