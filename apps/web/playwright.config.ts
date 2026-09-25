import { defineConfig, devices } from '@playwright/test';

/**
 * Gate-by-gate end-to-end run against the real API (fresh in-memory Postgres, seeded) and the
 * production build of the web app. Files run in order: gate0 → gate1 → gate2 → gate3.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'cd ../api && PORT=4000 npx tsx src/server.ts',
      url: 'http://localhost:4000/v1/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npx next start -p 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
