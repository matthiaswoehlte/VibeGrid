// Stub for `server-only` in the vitest environment.
//
// The real `server-only` package (Next.js) throws on import because it can
// only be loaded from a Server Component context. Vitest has no such context,
// so we alias the package to this empty module via vitest.config.ts. The
// production guard remains intact for `next build` — only tests bypass it.
export {};
