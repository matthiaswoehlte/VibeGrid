import { defineConfig, devices } from '@playwright/test';

// Plan 9a CI follow-up — Plan 7's middleware redirects `/` to `/login`
// unless a `vibegrid.session_token` cookie is present. Middleware only
// checks PRESENCE, not validity (real session check happens in API
// routes via `auth.api.getSession`). The e2e tests don't hit any API,
// they just assert client-side DOM, so a stub cookie is enough to pass
// the middleware gate and render the studio shell.
const STUB_SESSION_COOKIE = {
  name: 'vibegrid.session_token',
  value: 'e2e-stub-session-cookie-not-a-real-session',
  domain: 'localhost',
  path: '/',
  expires: Math.floor(Date.now() / 1000) + 60 * 60,
  httpOnly: true,
  secure: false,
  sameSite: 'Lax' as const
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    storageState: {
      cookies: [STUB_SESSION_COOKIE],
      origins: []
    }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
