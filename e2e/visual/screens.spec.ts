/*
 * SCREENSHOT CHECK — PC only. 4 screens x 4 palettes = 16 pictures per width, compared against the
 * baselines in __screenshots__/screens.spec.ts/ (1440x900, project pc-1440) and
 * __screenshots__/screens.spec.ts/pc-1200/ (1200x800, project pc-1200). Default style, font and zoom.
 *
 * A failure means a screen LOOKS different. If that change was intended, look at the diff images in
 * work/.ui-test-report first, then accept it with `npm run test:visual -- --update-snapshots`
 * (docs/ui-tests.md). Never update baselines without a person looking at the diff.
 */
import { test, expect } from '@playwright/test';
import { open, assertNoReload, marker, type Screen } from './helpers';

/** Default palette first (theme-manager.ts DEFAULT.themeId), then the light / high-contrast ones. */
const PALETTES = ['midnight', 'parchment', 'daylight', 'contrast'] as const;
const SCREENS: Screen[] = ['roster', 'sheet', 'builder', 'settings'];

for (const screen of SCREENS) {
  for (const themeId of PALETTES) {
    test(`${screen} — ${themeId}`, async ({ page }) => {
      await open(page, { themeId }, screen);
      await expect(page).toHaveScreenshot(`${screen}-${themeId}.png`, {
        // Anything that changes with the clock or the release rather than the design.
        mask: [page.locator('[data-uitest-mask], .app-version, time')],
      });
      // A picture taken across a dev-server reload is a blank page that still "matches" — refuse it.
      // In --update-snapshots mode the bad picture has ALREADY been written as the new baseline by the
      // time this runs, so the message says to run the update again.
      try {
        await assertNoReload(page);
      } catch (e) {
        const updating = test.info().config.updateSnapshots !== 'none' && test.info().config.updateSnapshots !== 'missing';
        throw new Error(
          `${(e as Error).message}.` +
            (updating
              ? ' This run is in --update-snapshots mode: the picture it just wrote to __screenshots__ is BAD (taken across the reload).' +
                ' Run the update again until it passes, and look at the picture before committing it.'
              : ' If this run wrote a missing baseline, that picture is bad too: run the update again.'),
        );
      }
      await expect(marker(page, screen)).toBeVisible();
    });
  }
}
