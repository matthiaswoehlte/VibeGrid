// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// All four fal-billable routes share the same Plan 8.6 gate:
// `requireUserSession` returns 403 (banned) before any credit / fal code runs.
// We mock at the admin-guard level so the routes' own DB calls are never reached.

const getSessionMock = vi.fn();
const queryMock = vi.fn();

vi.mock('@/lib/auth/better-auth-server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } }
}));
vi.mock('@/lib/db/pg', () => ({
  pool: { query: (sql: string, params?: unknown[]) => queryMock(sql, params) }
}));
// Stub everything downstream — we never get past requireUserSession in these
// tests, but the route modules import these at load-time.
vi.mock('@/lib/sceneflow/stories-db', () => ({
  loadStory: vi.fn()
}));
vi.mock('@/lib/sceneflow/scenes-db', () => ({
  listScenes: vi.fn(),
  loadSceneById: vi.fn(),
  patchSceneRender: vi.fn()
}));
vi.mock('@/lib/sceneflow/characters-db', () => ({
  listCharactersByIds: vi.fn()
}));
vi.mock('@/lib/sceneflow/render-pipeline', () => ({
  runTtsForScenes: vi.fn(),
  generateAndStoreImages: vi.fn(),
  enqueueVideoJobs: vi.fn(),
  planRetryImage: vi.fn(),
  planRetryVideo: vi.fn(),
  applyRetryPlanPatch: vi.fn()
}));
vi.mock('@/lib/sceneflow/validation', () => ({
  validateScenesForGeneration: vi.fn(() => []),
  hasBlockers: () => false
}));
vi.mock('@/lib/credits/credits', () => ({
  getBalance: vi.fn(),
  readBalance: vi.fn(),
  deductCredits: vi.fn(),
  reserveCredits: vi.fn(),
  refundReserve: vi.fn(),
  getOpenReserve: vi.fn(() => 0),
  getStorySpend: vi.fn(() => 0),
  InsufficientCreditsError: class extends Error {}
}));

beforeEach(() => {
  getSessionMock.mockReset();
  queryMock.mockReset();
});

/** Helper: simulate a banned user — Better-Auth returns session, user row
 *  in DB says banned=true. requireUserSession's banned-branch fires. */
function mockBannedUser() {
  getSessionMock.mockResolvedValueOnce({ user: { id: 'u-banned' } });
  queryMock.mockResolvedValueOnce({
    rows: [{ id: 'u-banned', role: 'user', banned: true }]
  });
}

describe('banned-enforcement — fal-billable routes', () => {
  it('POST generate-images-and-voices: banned → 403 suspended', async () => {
    mockBannedUser();
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/generate-images-and-voices/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/suspended/i);
  });

  it('POST generate-videos: banned → 403', async () => {
    mockBannedUser();
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/generate-videos/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-1' }
    });
    expect(res.status).toBe(403);
  });

  it('POST retry-image: banned → 403', async () => {
    mockBannedUser();
    const { POST } = await import(
      '@/app/api/sceneflow/scenes/[sceneId]/retry-image/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { sceneId: 'sc-1' }
    });
    expect(res.status).toBe(403);
  });

  it('POST retry-video: banned → 403', async () => {
    mockBannedUser();
    const { POST } = await import(
      '@/app/api/sceneflow/scenes/[sceneId]/retry-video/route'
    );
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: { sceneId: 'sc-1' }
    });
    expect(res.status).toBe(403);
  });
});

describe('requireUserSession — exactly one getSession call', () => {
  it('healthy fal-route request makes 1 Better-Auth call + 1 DB user lookup', async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 'u-ok' } });
    // First DB call: admin-guard user lookup
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'u-ok', role: 'user', banned: false }]
    });
    // The route's loadStory mock returns null → 404 short-circuit, end of test.
    const { POST } = await import(
      '@/app/api/sceneflow/stories/[id]/generate-images-and-voices/route'
    );
    await POST(new Request('http://x', { method: 'POST' }), {
      params: { id: 'st-x' }
    });
    // The point of Fix W2-R: only ONE Better-Auth lookup per request.
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });
});
