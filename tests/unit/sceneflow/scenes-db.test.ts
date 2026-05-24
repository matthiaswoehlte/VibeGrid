import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';

const { queryMock, connectMock, clientQueryMock, releaseMock } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const clientQueryMock = vi.fn();
  const releaseMock = vi.fn();
  const connectMock = vi.fn(() =>
    Promise.resolve({
      query: clientQueryMock,
      release: releaseMock
    } as unknown as PoolClient)
  );
  return { queryMock, connectMock, clientQueryMock, releaseMock };
});
vi.mock('@/lib/db/pg', () => ({
  pool: { query: queryMock, connect: connectMock }
}));

import {
  createScenes,
  listScenes,
  updateScene,
  deleteScenesByStory,
  swapSceneOrder
} from '@/lib/sceneflow/scenes-db';

beforeEach(() => {
  queryMock.mockReset();
  connectMock.mockClear();
  clientQueryMock.mockReset();
  releaseMock.mockClear();
});

describe('scenes-db', () => {
  it('createScenes — multi-VALUES insert, returns full records', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'sc-1' }, { id: 'sc-2' }]
    });
    const rows = await createScenes('story-1', [
      {
        scene_order: 1,
        type: 'action',
        image_prompt: 'a',
        motion_prompt: 'm',
        camera_control: { zoom: 0, panX: 0, panY: 0, motionIntensity: 5 },
        duration: 5,
        audio_type: 'none',
        tts_text: null,
        speaking_character_id: null,
        transition: 'last-frame',
        start_frame_mode: 'auto',
        status: 'pending',
        fal_request_ids: null
      },
      {
        scene_order: 2,
        type: 'endcard',
        image_prompt: 'b',
        motion_prompt: '',
        camera_control: null,
        duration: 3,
        audio_type: 'none',
        tts_text: 'CTA',
        speaking_character_id: null,
        transition: 'crossfade',
        start_frame_mode: 'from-previous',
        status: 'pending',
        fal_request_ids: null
      }
    ]);
    expect(rows.map((r) => r.id)).toEqual(['sc-1', 'sc-2']);
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO "VG_story_scenes"/);
    // 14 columns × 2 rows = 28 values
    expect((vals as unknown[]).length).toBe(28);
    expect(sql).toMatch(/RETURNING \*/);
  });

  it('listScenes — JOIN VG_stories, scoped by user_id, ORDER BY scene_order', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listScenes('u-1', 'story-1');
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/FROM "VG_story_scenes" s/);
    expect(sql).toMatch(/JOIN "VG_stories" st ON s\.story_id = st\.id/);
    expect(sql).toMatch(/WHERE st\.id = \$1 AND st\.user_id = \$2/);
    expect(sql).toMatch(/ORDER BY s\.scene_order/);
    expect(vals).toEqual(['story-1', 'u-1']);
  });

  it('updateScene — SET-builder + JOIN-Ownership in single UPDATE', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await updateScene({
      userId: 'u-1',
      sceneId: 'sc-1',
      patch: { image_prompt: 'new', duration: 7 }
    });
    expect(ok).toBe(true);
    const [sql, vals] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/UPDATE "VG_story_scenes" s/);
    expect(sql).toMatch(/SET image_prompt = \$1, duration = \$2/);
    expect(sql).toMatch(/FROM "VG_stories" st/);
    expect(sql).toMatch(/WHERE s\.id = \$3\s+AND s\.story_id = st\.id\s+AND st\.user_id = \$4/);
    expect(vals).toEqual(['new', 7, 'sc-1', 'u-1']);
  });

  it('updateScene — empty patch → false, no SQL', async () => {
    const ok = await updateScene({ userId: 'u-1', sceneId: 'sc-1', patch: {} });
    expect(ok).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('updateScene — rowCount=0 (foreign user) → false', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    const ok = await updateScene({
      userId: 'u-1',
      sceneId: 'sc-x',
      patch: { duration: 5 }
    });
    expect(ok).toBe(false);
  });

  it('deleteScenesByStory — single DELETE using optional tx client', async () => {
    const txClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 3 })
    };
    await deleteScenesByStory('story-1', txClient as unknown as PoolClient);
    expect(txClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM "VG_story_scenes" WHERE story_id = \$1/),
      ['story-1']
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('swapSceneOrder — runs both UPDATEs inside one transaction', async () => {
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          { id: 'sc-1', scene_order: 1, story_id: 'story-1' },
          { id: 'sc-2', scene_order: 2, story_id: 'story-1' }
        ]
      }) // SELECT
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE a
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE b
      .mockResolvedValueOnce({}); // COMMIT
    const ok = await swapSceneOrder({ userId: 'u-1', aId: 'sc-1', bId: 'sc-2' });
    expect(ok).toBe(true);
    const calls = clientQueryMock.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(releaseMock).toHaveBeenCalled();
  });
});
