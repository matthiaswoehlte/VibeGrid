export const runtime = 'nodejs';

/** GET /api/projects — list. v0.1: always empty until D1 is active. */
export async function GET(): Promise<Response> {
  return Response.json({ projects: [] }, { status: 200 });
}

/** POST /api/projects — create. v0.1: echo back with a generated id; no persistence. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }
  return Response.json(
    {
      ...(body as Record<string, unknown>),
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      note: 'v0.1 stub — not persisted'
    },
    { status: 201 }
  );
}
