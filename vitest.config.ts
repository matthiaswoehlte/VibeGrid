import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // `server-only` throws on import outside a real Next.js Server Component
      // context — neutralise it for tests. Production build keeps the real guard.
      'server-only': fileURLToPath(new URL('./tests/__stubs__/server-only.ts', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { resources: 'usable' } },
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
    poolOptions: { threads: { singleThread: true } },
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**']
  }
});
