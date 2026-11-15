/*
 * PC-only UI checks for the visual redesign (docs/ui-tests.md):
 *   screens.spec.ts  — screenshot comparisons, 4 screens x 4 palettes  (npm run test:visual)
 *   contrast.spec.ts — axe color-contrast ratchet, every palette        (npm run test:contrast)
 *
 * Desktop only (1440x900, plus the screenshots again at 1200x800) — phone layouts come later. Uses the installed Microsoft Edge, so no browser
 * download is ever needed. Not part of `npm run verify`: these need a browser and a dev server.
 * Kept out of vitest on purpose: vitest.config.ts only includes test/**.
 */
import { defineConfig } from '@playwright/test';

const PORT = 1420;

export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  outputDir: '../../work/.ui-test-results',
  // One worker: the dev server is shared, and the baselines must not depend on how loaded the machine is.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      // Tight on purpose: the same Edge on the same PC renders pixel-exact (unchanged screens measured
      // pixel-identical), and anti-aliased edges are already ignored by the comparator. Measured on
      // 2026-10-24: a 3% page tint and a hidden 22-px pin icon both PASSED at threshold 0.05 /
      // maxDiffPixels 100 and both FAILED at 0.02 / 10. Playwright's defaults (0.2, ratio 0.002) let far
      // more through.
      threshold: 0.02,
      maxDiffPixels: 10,
    },
  },
  // Baselines live next to the specs, one folder per spec, with no OS/browser suffix — they are taken
  // with Edge on Windows and only ever compared there.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  reporter: [['list'], ['html', { outputFolder: '../../work/.ui-test-report', open: 'never' }]],
  // Two PC widths. 1440x900 is the original set (its baselines stay in the folder above). 1200x800 is
  // the size the Windows app opens at (src-tauri/tauri.conf.json); the redesign designs at 1200 and
  // checks 900 and 1440. The 1200 project runs only the screenshots (the contrast ratchet's keys have
  // no width, so it runs once, at 1440), and keeps its baselines in their own `pc-1200` folder.
  projects: [
    { name: 'pc-1440', use: { viewport: { width: 1440, height: 900 } } },
    {
      name: 'pc-1200',
      testMatch: /screens\.spec\.ts$/,
      use: { viewport: { width: 1200, height: 800 } },
      snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{projectName}/{arg}{ext}',
    },
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'msedge',
    headless: true,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    navigationTimeout: 300_000,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: '../..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
