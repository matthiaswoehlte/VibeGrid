export const runtime = 'nodejs';

/** GET /api/projects/:id — v0.1: 404. Active in v0.2 when D1 is wired. */
export async function GET(
  _request: Request,
  { params: _params }: { params: { id: string } }
): Promise<Response> {
  return Response.json(
    { error: 'not found', note: 'v0.1 stub — D1 not yet active' },
    { status: 404 }
  );
}
