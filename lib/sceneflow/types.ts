// lib/sceneflow/types.ts
// TS types matching DB schema in db/migrations/002_VG_sceneflow.sql.

export type CharacterType = 'person' | 'group';
export type VoiceProvider = 'azure' | 'elevenlabs';

export interface CharacterRecord {
  id: string;
  user_id: string;
  name: string;
  type: CharacterType;
  reference_image_url: string | null;
  voice_provider: VoiceProvider | null;
  voice_id: string | null;
  image_prompt: string | null;
  created_at: string;
  updated_at: string;
}

export type StoryFormat = '16:9' | '9:16' | '4:3';
export type StoryStatus = 'draft' | 'generating' | 'done' | 'error';

export interface StoryRecord {
  id: string;
  user_id: string;
  title: string;
  format: StoryFormat;
  visual_style: string | null;
  status: StoryStatus;
  // Plan 8b additions:
  characters: string[];      // JSONB array of VG_characters.id (UUIDs)
  story_text: string | null; // user's freetext story description
  created_at: string;
  updated_at: string;
}

export type SceneType = 'action' | 'dialog' | 'endcard';
export type AudioType = 'none' | 'voiceover' | 'lipsync';
export type Transition = 'last-frame' | 'crossfade' | 'cut';
export type StartFrameMode = 'auto' | 'from-previous' | 'custom';
export type SceneStatus = 'pending' | 'generating' | 'done' | 'error';

export interface CameraControl {
  zoom: number;
  panX: number;
  panY: number;
  motionIntensity: number;
}

export interface SceneRecord {
  id: string;
  story_id: string;
  scene_order: number;
  type: SceneType;
  image_prompt: string | null;
  motion_prompt: string | null;
  camera_control: CameraControl | null;
  duration: number;
  audio_type: AudioType;
  tts_text: string | null;
  speaking_character_id: string | null;
  transition: Transition;
  start_frame_mode: StartFrameMode;
  start_frame_url: string | null;
  image_url: string | null;
  video_url: string | null;
  audio_url: string | null;
  end_frame_url: string | null;
  status: SceneStatus;
  error_message: string | null;
  fal_request_ids: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}
