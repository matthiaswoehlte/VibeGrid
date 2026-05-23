import type { SerializedProject, ProjectRecord } from './types';

async function json<T>(res: Response): Promise<T> {
  // Plan 7 — 401 means the Better-Auth session is invalid/expired on
  // the server side. The Edge middleware lets it through (cheap cookie
  // check only); the API route just rejected it. Bounce to /login with
  // a hint so the page can show "Session abgelaufen — bitte erneut anmelden".
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.assign('/login?expired=1');
    throw new Error('Session expired');
  }
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return res.json() as Promise<T>;
}

export async function apiCreateProject(
  name: string,
  serialized: SerializedProject
): Promise<{ id: string }> {
  return json(
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, serialized })
    })
  );
}

export async function apiListProjects(): Promise<{
  projects: Array<{ id: string; name: string; updated_at: string }>;
}> {
  return json(await fetch('/api/projects'));
}

export async function apiLoadProject(id: string): Promise<ProjectRecord> {
  return json(await fetch('/api/projects/' + encodeURIComponent(id)));
}

export async function apiPatchProject(
  id: string,
  patch: { name?: string; serialized?: SerializedProject }
): Promise<{ ok: true }> {
  return json(
    await fetch('/api/projects/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch)
    })
  );
}

export async function apiDeleteProject(id: string): Promise<{ ok: true }> {
  return json(
    await fetch('/api/projects/' + encodeURIComponent(id), {
      method: 'DELETE'
    })
  );
}
