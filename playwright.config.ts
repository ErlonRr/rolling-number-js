import { defineConfig, devices } from '@playwright/test';

/**
 * Visual suite (`pnpm test:visual`, docs/design/v1.3.md §11 WP11): Chromium,
 * Firefox and WebKit against a prebuilt page served locally. The specs live
 * in tests/visual/*.spec.ts (WP11); helpers in tests/visual/_harness.ts.
 *
 * Environment overrides:
 * - `RN_VISUAL_SERVER`: command that serves the page (default: build the
 *   package and the demo, then `pnpm preview`). CI builds in a separate step
 *   and only passes the preview command.
 * - `RN_VISUAL_PORT`: port of that server (default 4173).
 * - `RN_VISUAL_BASE_URL`: test an already running server; no server is started.
 */
const port = Number(process.env.RN_VISUAL_PORT || 4173);
const externalBaseURL = process.env.RN_VISUAL_BASE_URL;
const baseURL = externalBaseURL || `http://localhost:${port}`;
const command =
  process.env.RN_VISUAL_SERVER || `pnpm build && pnpm build:demo && pnpm preview --port ${port} --strictPort`;
const ci = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/visual',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/visual',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  reporter: ci
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  expect: {
    // Engines differ in glyph rasterization: screenshots are per project, with a small tolerance.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002 }
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command,
        // Wait for the port, not for a page: the served root may have no index.
        port,
        reuseExistingServer: !ci,
        timeout: 240_000,
        stdout: 'pipe',
        stderr: 'pipe'
      }
});
