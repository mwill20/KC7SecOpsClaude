// Browser tests run against dist/ served by tools/serve.mjs on loopback. Build first (npm run build) or use npm run verify.
import { defineConfig, devices } from '@playwright/test';

const port = 4187;
// PIER9_CHROMIUM points at an existing Chromium binary when the Playwright-managed download is not wanted or not available.
const executablePath = process.env.PIER9_CHROMIUM || undefined;

export default defineConfig({
  testDir: 'tests/browser',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    trace: 'off', video: 'off', screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'node tools/serve.mjs',
    url: `http://127.0.0.1:${port}/`,
    env: { PIER9_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
