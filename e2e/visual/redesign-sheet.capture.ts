/*
 * Today's sheet (Main tab) with Test Champion, at the three redesign sizes, default palette 'midnight'.
 * Run through redesign-capture.config.ts (never picked up by `npm run test:visual`). Output goes to
 * C:\trying ai 2\hh-redesign-references\today-sheet-champion\ — outside the repo on purpose.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { open, assertNoReload, marker, loadFixture } from './helpers';

const OUT_DIR = 'C:\\trying ai 2\\hh-redesign-references\\today-sheet-champion';
const CHAMPION = loadFixture('redesign-champion.json');
const SIZES = [
  { width: 1200, height: 800 },
  { width: 1200, height: 600 },
  { width: 900, height: 800 },
];

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.use({ viewport: size });
    test(`sheet main — midnight — ${size.width}x${size.height}`, async ({ page }) => {
      mkdirSync(OUT_DIR, { recursive: true });
      await open(page, { themeId: 'midnight' }, 'sheet', CHAMPION);
      await page.screenshot({
        path: join(OUT_DIR, `sheet-main-midnight-${size.width}x${size.height}.png`),
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      });
      // …and the same width made very tall, so what sits below the fold (conditions, resistances,
      // borrowed class DCs, panache, focus) is on record too. The sheet scrolls inside its own panes,
      // so a `fullPage` shot is no taller than the window — the window itself has to grow.
      await page.setViewportSize({ width: size.width, height: 3000 });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      await page.screenshot({
        path: join(OUT_DIR, `sheet-main-midnight-${size.width}-tall.png`),
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      });
      await page.setViewportSize(size);
      // A picture taken across a dev-server reload is a blank page: refuse it (run again).
      await assertNoReload(page);
      await expect(marker(page, 'sheet', CHAMPION)).toBeVisible();
    });
  });
}
