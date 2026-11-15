/*
 * Shared setup for the PC-only UI checks (docs/ui-tests.md).
 *
 * Everything is SEEDED into the same browser storage the app itself reads at start-up — the roster, the
 * appearance (palette / style / font), the zoom and the device prefs — so a picture never depends on
 * clicking through Settings. The character is the synthesized fixture from make-fixture.ts; never a real
 * player's save.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';

const ROSTER = readFileSync(fileURLToPath(new URL('./fixtures/roster.json', import.meta.url)), 'utf8');
export const FIXTURE_ID = 'c-uitest-fighter';

/**
 * Which synthesized roster to seed. Every spec uses the default (roster.json, "Test Fighter"), so the
 * baselines never move; the redesign capture passes REDESIGN_FIXTURE (make-redesign-fixture.ts).
 */
export interface Fixture {
  /** The roster JSON text (`[{ id, character, build, play? }]`). */
  roster: string;
  /** The roster entry to make active. */
  id: string;
  /** The character's name, which the screen markers wait for. */
  name: string;
}

export const DEFAULT_FIXTURE: Fixture = { roster: ROSTER, id: FIXTURE_ID, name: 'Test Fighter' };

/** Reads a fixture file in e2e/visual/fixtures; the active entry is the first one in it. */
export function loadFixture(fileName: string): Fixture {
  const roster = readFileSync(fileURLToPath(new URL(`./fixtures/${fileName}`, import.meta.url)), 'utf8');
  const first = (JSON.parse(roster) as { id: string; character: { name: string } }[])[0];
  if (!first) throw new Error(`${fileName} holds no character`);
  return { roster, id: first.id, name: first.character.name };
}

/** The screens these checks know how to reach. */
export type Screen = 'roster' | 'sheet' | 'builder' | 'settings';

export interface Look {
  themeId: string;
  /** Defaults = what a fresh install gets (theme-manager.ts DEFAULT, zoom.ts 1). */
  styleId?: string;
  fontId?: string;
  zoom?: number;
}

/**
 * Seeds storage before the app's first script runs. Every key here is one the app owns:
 *   sessionStorage hh-dev-skip      — App.tsx's DEV-only login bypass (never true in a production build)
 *   wanderers-codex:roster:v1       — src/data/storage.ts ROSTER_KEY
 *   wanderers-codex:active:v1       — src/data/storage.ts ACTIVE_KEY
 *   pf2e-codex.appearance           — src/theme/theme-manager.ts STORAGE_KEY
 *   pf2e-codex.zoom                 — src/theme/zoom.ts STORAGE_KEY
 *   pf2e-codex.prefs                — src/data/prefs.ts STORAGE_KEY (startupScreen picks roster vs sheet)
 */
export async function seed(page: Page, look: Look, screen: Screen, fixture: Fixture = DEFAULT_FIXTURE): Promise<void> {
  const appearance = { themeId: look.themeId, styleId: look.styleId ?? 'modern', fontId: look.fontId ?? 'system', accent: null };
  // The sheet is reached by the app's own boot restore (startupScreen 'last' + an active id); every other
  // screen starts from the Characters page.
  const prefs = { startupScreen: screen === 'sheet' ? 'last' : 'characters' };
  await page.addInitScript(
    ([roster, active, app, zoom, pr]) => {
      // Only on the first load of this page: a reload must not undo anything the test did since.
      if (sessionStorage.getItem('hh-uitest-seeded') === '1') return;
      sessionStorage.setItem('hh-uitest-seeded', '1');
      sessionStorage.setItem('hh-dev-skip', '1');
      localStorage.clear();
      localStorage.setItem('wanderers-codex:roster:v1', roster);
      localStorage.setItem('wanderers-codex:active:v1', active);
      localStorage.setItem('pf2e-codex.appearance', app);
      localStorage.setItem('pf2e-codex.zoom', zoom);
      localStorage.setItem('pf2e-codex.prefs', pr);
    },
    [fixture.roster, fixture.id, JSON.stringify(appearance), String(look.zoom ?? 1), JSON.stringify(prefs)] as const,
  );
}

/** Loads the app and walks to `screen`, then waits until it is settled enough to photograph or scan. */
export async function open(page: Page, look: Look, screen: Screen, fixture: Fixture = DEFAULT_FIXTURE): Promise<void> {
  await seed(page, look, screen, fixture);
  await page.goto('/');
  if (screen === 'sheet') {
    await page.locator('.tabs .tab.on', { hasText: 'Main' }).waitFor();
  } else {
    await page.locator('.roster-screen .rcard', { hasText: fixture.name }).waitFor();
    if (screen === 'builder') {
      await page.getByRole('button', { name: 'New character' }).click();
    } else if (screen === 'settings') {
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('menuitem', { name: 'Settings' }).click();
      await page.getByRole('menuitem', { name: 'Settings' }).waitFor({ state: 'detached' });
    }
  }
  await marker(page, screen, fixture).waitFor();
  await settle(page);
  // Checked AGAIN after settling, then the page is marked: a dev-server reload during settle() leaves a
  // blank page (or, for builder/settings, the Characters page), so this wait fails instead of letting a
  // wrong picture through.
  await marker(page, screen, fixture).waitFor();
  await page.evaluate(() => {
    (window as unknown as { __hhUiTestPage?: boolean }).__hhUiTestPage = true;
  });
}

/** One element that exists only once `screen` has really rendered with the test character. */
export function marker(page: Page, screen: Screen, fixture: Fixture = DEFAULT_FIXTURE): Locator {
  switch (screen) {
    case 'roster':
      return page.locator('.roster-screen .rcard', { hasText: fixture.name });
    case 'sheet':
      return page.locator(`.ws-app:has(.char-name:has-text(${JSON.stringify(fixture.name)})) .strike-name`).first();
    case 'builder':
      return page.getByText('character creation');
    case 'settings':
      return page.locator('.settings-desc').first();
  }
}

/**
 * Fails if the page RELOADED since open() finished. The first load on a fresh dev server can make Vite
 * discover a dependency, re-optimise and reload the page; a picture taken across that reload is a blank
 * white page that is perfectly "stable" — the very first baseline run here recorded one. A reload wipes
 * `window`, so the mark set at the end of open() is gone. Call it right after taking a picture or a scan.
 */
export async function assertNoReload(page: Page): Promise<void> {
  const same = await page.evaluate(() => (window as unknown as { __hhUiTestPage?: boolean }).__hhUiTestPage === true);
  if (!same) throw new Error('the page reloaded while it was being captured (a dev-server reload?) — run again');
}

/** Fonts loaded, no pending animation frame work, mouse parked off every hover target. */
export async function settle(page: Page): Promise<void> {
  // Bottom-left corner of whichever PC size the project uses (1440x900 or 1200x800).
  await page.mouse.move(0, (page.viewportSize()?.height ?? 900) - 1);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
}
