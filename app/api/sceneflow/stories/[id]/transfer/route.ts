import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/better-auth-server';
import { loadStory } from '@/lib/sceneflow/stories-db';
import { listScenes } from '@/lib/sceneflow/scenes-db';
import { ENDCARD_DEFAULT_DURATION_SEC } from '@/lib/sceneflow/clip-layout';

export const runtime = 'nodejs';

/**
 * Plan 8d — Transfer to Timeline.
 *
 * Returns the SceneFlow story's renderable content as a wire-format
 * payload the client applies to the Zustand store. NO Frontend
 * layout-math here — that lives in lib/sceneflow/clip-layout.ts and
 * runs on the client so the same algorithm is reused when the user
 * later drops a sync-audio file in VibeGrid.
 *
 * The route deliberately does NOT touch the timeline (that's a
 * client-side store mutation). It just collects + serializes.
 */

export interface TransferClipPayload {
  /** Stable opaque id — used to construct the client-side MediaRef. */
  mediaId: string;
  /** Final video URL on R2. NULL only for endcard scenes (image-only). */
  videoUrl: string | null;
  /** Image URL — set for endcards (used as the visual) + dialog/action
   *  scenes that have a generated image even though video isn't done
   *  yet. */
  imageUrl: string | null;
  /** Effective seconds the layout helper uses. For endcards we pre-
   *  resolve to ENDCARD_DEFAULT_DURATION_SEC here so the client
   *  doesn't need to know about that constant separately [Fix W2-R].
   *
   *  NOTE: this is the user-intent `scene.duration` — for lipsync
   *  scenes the actual rendered file may be shorter (audio length
   *  cut). The client probes the real video duration via
   *  `getMediaDuration` and overrides this for layout. */
  durationSec: number;
  transition: 'last-frame' | 'crossfade' | 'cut';
  sceneType: 'action' | 'dialog' | 'endcard';
  sceneOrder: number;
  /** Plan 8d — audio routing per scene. `lipsync` means the video file
   *  has embedded mouth-synced audio that MUST play (otherwise the
   *  user can't hear what the character is saying), and the sync-audio
   *  track should duck to half volume during this clip. `voiceover`
   *  and `none` keep the video muted (sync-audio handles soundtrack). */
  audioType: 'none' | 'voiceover' | 'lipsync';
}

export interface TransferResponse {
  storyId: string;
  syncAudio: { url: string; bpm: number } | null;
  clips: TransferClipPayload[];
  snapMode: 'beat' | 'bar' | 'off';
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const story = await loadStory({
    userId: session.user.id,
    storyId: params.id
  });
  if (!story) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const scenes = await listScenes(session.user.id, params.id);
  if (scenes.length === 0) {
    return NextResponse.json(
      { error: 'no scenes — generate the storyboard first' },
      { status: 400 }
    );
  }

  // Renderable = scenes the layout helper can place. Endcards with no
  // image qualify too (they'd render as a black slate), but we filter
  // them out here to keep the timeline clean.
  const renderable = scenes
    .filter(
      (s) =>
        (s.type !== 'endcard' && s.video_url !== null) ||
        (s.type === 'endcard' && s.image_url !== null)
    )
    .sort((a, b) => a.scene_order - b.scene_order);

  const clips: TransferClipPayload[] = renderable.map((s) => ({
    // Deterministic mediaId per scene — re-transfer reuses the same id
    // so MediaLibrary entries stay stable. Plain `scene_id` works since
    // VG_story_scenes.id is a UUID already.
    mediaId: s.id,
    videoUrl: s.video_url,
    imageUrl: s.image_url,
    // [Fix W2-R] resolve endcard duration here so clip-layout doesn't
    // need to know about the constant + Backend has a single source.
    durationSec:
      s.type === 'endcard' ? ENDCARD_DEFAULT_DURATION_SEC : s.duration,
    transition: s.transition,
    sceneType: s.type,
    sceneOrder: s.scene_order,
    audioType: s.audio_type
  }));

  // [Fix B1] BPM is persisted at upload time in StorySetupForm —
  // route just reads it. Frontend uses syncAudio.bpm directly,
  // falls back to 120 in the layout step when null.
  const syncAudio =
    story.sync_audio_url !== null && story.sync_audio_bpm !== null
      ? { url: story.sync_audio_url, bpm: story.sync_audio_bpm }
      : null;

  const payload: TransferResponse = {
    storyId: story.id,
    syncAudio,
    clips,
    snapMode: story.snap_mode
  };
  return NextResponse.json(payload);
}
