import { NextResponse, type NextRequest } from 'next/server';

// Plan 7 — cheap cookie-presence check in Edge runtime. Better-Auth
// stores its session in `vibegrid.session_token`; large cookies split
// across `.0`, `.1`, ... chunks. We accept either the base name or
// the first chunk as "session present".
//
// This middleware does NOT validate the session against the database
// (would require pg, which is Edge-incompatible). Real authority lives
// in every API route via `auth.api.getSession({ headers })`. A client
// holding a tampered or DB-expired cookie can render the /studio shell,
// but every data action returns 401 — `lib/project/api-client.ts`
// catches 401 and redirects to /login?expired=1.

export function middleware(req: NextRequest): NextResponse {
  const hasCookie =
    req.cookies.has('vibegrid.session_token') || req.cookies.has('vibegrid.session_token.0');

  if (!hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('from', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Edge runtime by default — middleware does not import pg / better-auth/server,
  // so the bundle stays Edge-compatible.
  //
  // The studio lives on `/` (app/(studio) is a Next.js route group whose
  // parentheses suppress the URL segment). Guard the root AND any future
  // sub-routes; exclude /login, /api/*, and static assets from the matcher.
  matcher: ['/((?!api|_next|favicon.ico|login).*)']
};
