import { defineConfig, devices } from '@playwright/test'

// End-to-end tests drive a REAL, already-running game stack in a browser —
// login through a full campaign turn. Per the "attach to a running stack"
// decision (docs/CAMPAIGN_PLAN.md), this config never boots anything itself:
//
//   • Locally (Windows dev is Docker-only): `make docker-up`, then
//     `npm --prefix e2e test` (default target http://localhost:5173).
//   • In CI (Linux): the workflow boots the Docker image on 3001 and runs
//     with E2E_BASE_URL=http://localhost:3001.
//
// The image serves the built SPA and the /api routes from the SAME origin, so
// one baseURL reaches the whole app on either port.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173'

export default defineConfig({
  testDir: './tests',
  // A campaign turn spans several server round-trips plus a headless battle
  // subprocess; give each test room without being so generous a hang hides.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Tests register their own throwaway user, so they don't collide — but keep
  // a single worker so a failure's trace/video reads as one clean timeline and
  // the shared backend isn't hammered.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
