// Browser tests run against dist/ served by tools/serve.mjs on loopback. Build first (npm run build) or use npm run verify.
// Two projects drive the same dist/: "chromium" at the origin root and "chromium-subpath" under /KC7SecOpsClaude/, the
// path GitHub Pages gives a project site. Both must pass, which proves every asset and module path is relative.
import { defineConfig, devices } from '@playwright/test';

const rootPort = 4187, subPort = 4188;
export const SUBPATH = '/KC7SecOpsClaude/';
// PIER9_CHROMIUM points at an existing Chromium binary when the Playwright-managed download is not wanted or not available.
const executablePath = process.env.PIER9_CHROMIUM || undefined;
const shared = { trace: 'off', video: 'off', screenshot: 'only-on-failure', ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} };

export default defineConfig({
  testDir: 'tests/browser',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  projects: [
    { name: 'chromium', use: { ...shared, baseURL: `http://127.0.0.1:${rootPort}/` } },
    { name: 'chromium-subpath', use: { ...shared, baseURL: `http://127.0.0.1:${subPort}${SUBPATH}` } },
  ],
  webServer: [
    { command: 'node tools/serve.mjs', url: `http://127.0.0.1:${rootPort}/`, env: { PIER9_PORT: String(rootPort) }, reuseExistingServer: false, timeout: 20_000 },
    { command: 'node tools/serve.mjs', url: `http://127.0.0.1:${subPort}${SUBPATH}`, env: { PIER9_PORT: String(subPort), PIER9_BASE: SUBPATH }, reuseExistingServer: false, timeout: 20_000 },
  ],
});
