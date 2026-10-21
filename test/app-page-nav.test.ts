// owner 2026-10-21: hamburger menu fixed order — App's page list comes from one pure helper
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildPageNav, type Screen } from '../src/appScreen';
import { MENU_PAGES, menuPageEntries, type MenuPage } from '../src/sheet/PageMenu';

/**
 * App used to build the page list inline next to pickScreen, where nothing could test it. The legs: for each
 * screen the helper marks exactly that screen (and nothing on a screen the menu does not list), and every
 * reachable page has a handler that opens THAT page and no other.
 *
 * Without the helper (or with `current` wrong) the "marks the screen" leg fails; with the handlers crossed
 * (say roster -> homebrew) the "opens that page" leg fails.
 */
const SCREENS: Screen[] = ['roster', 'loading', 'builder', 'homebrew', 'campaigns', 'sheet', 'settings'];
const LISTED: MenuPage[] = ['sheet', 'roster', 'campaigns', 'homebrew', 'settings'];

function openers() {
  return {
    sheet: vi.fn(),
    roster: vi.fn(),
    campaigns: vi.fn(),
    homebrew: vi.fn(),
    settings: vi.fn(),
  };
}

describe('buildPageNav', () => {
  it('marks the screen on show as the current page, and nothing on a screen the menu does not list', () => {
    for (const screen of SCREENS) {
      const nav = buildPageNav(screen, openers());
      expect(nav.current).toBe(LISTED.includes(screen as MenuPage) ? screen : null);
    }
  });

  it('gives a handler for every reachable page that opens that page and no other', () => {
    for (const screen of SCREENS) {
      const open = openers();
      const nav = buildPageNav(screen, open);
      for (const page of LISTED) {
        const handler = nav.go[page];
        expect(handler, `${screen}: ${page}`).toBeTypeOf('function');
        for (const m of Object.values(open)) m.mockClear();
        handler!();
        for (const p of LISTED) expect(open[p]).toHaveBeenCalledTimes(p === page ? 1 : 0);
      }
    }
  });

  it('leaves an unreachable page (no character, signed-out phone) without a handler on every screen alike', () => {
    for (const screen of SCREENS) {
      const nav = buildPageNav(screen, { roster: vi.fn(), homebrew: vi.fn(), settings: vi.fn() });
      expect(nav.go.sheet).toBeUndefined();
      expect(nav.go.campaigns).toBeUndefined();
      // The menu then lists the reachable pages in the fixed order, plus the page on screen even if unreachable.
      const ids = menuPageEntries(nav).map((e) => e.id);
      const expected = MENU_PAGES.map((p) => p.id).filter((id) => id === nav.current || ['roster', 'homebrew', 'settings'].includes(id));
      expect(ids).toEqual(expected);
    }
  });
});

describe('the pages no longer carry their own menu list', () => {
  const PAGES = ['RosterScreen', 'CampaignsPage', 'HomebrewPage', 'SettingsPage', 'CharacterSheet'];
  it('has no `items` prop on a PageMenu inside the app (the list comes from PageNavContext)', () => {
    for (const name of PAGES) {
      const src = readFileSync(`src/sheet/${name}.tsx`, 'utf8');
      // every <PageMenu ...> opening tag, up to its first `/>` or `>` that is not an arrow
      const tags = [...src.matchAll(/<PageMenu\b[\s\S]*?(?:\/>|[^=]>)/g)].map((m) => m[0]);
      expect(tags.length, name).toBeGreaterThan(0);
      for (const t of tags) expect(t, name).not.toMatch(/\bitems=/);
    }
  });

  it('App builds the page list with the helper', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('buildPageNav(which,');
  });
});
