/*
 * REDESIGN REFERENCE CAPTURE — not a check. Photographs TODAY's sheet with the full test character
 * (fixtures/redesign-champion.json, made by make-redesign-fixture.ts) so the new layout can be compared
 * against it and its fit proven. Writes plain PNGs OUTSIDE the repo; compares nothing.
 *
 *   npx playwright test -c e2e/visual/redesign-capture.config.ts
 *
 * Kept away from `npm run test:visual`: that config matches *.spec.ts only, and this one matches only
 * *.capture.ts. Same browser, server and settings as playwright.config.ts, so the pictures match the
 * baselines' rendering.
 */
import { defineConfig } from '@playwright/test';

const PORT = 1420;

export default defineConfig({
  testDir: '.',
  testMatch: /\.capture\.ts$/,
  outputDir: '../../work/.ui-capture-results',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300_000,
  reporter: [['list']],
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
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: '../..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
