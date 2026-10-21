// @vitest-environment jsdom
// owner 2026-10-21: hamburger menu fixed order
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderDom } from './_render';
import { MENU_PAGES, PageMenu, PageNavContext, menuPageEntries, type MenuPage, type PageNav } from '../src/sheet/PageMenu';

/**
 * "When a user is on a page and he opens the hamburger menu he doesn't see the page he is currently on.
 * The location of the other options changes depending on what page you are — make it that the page you
 * are on is marked, that way the menu stays the same." — owner, 2026-10-21.
 *
 * The legs: the same entries in the same order on every page; exactly one is marked (aria-current="page")
 * and it is the page on screen; choosing the marked one only closes the menu while choosing another opens it.
 *
 * Without the fix (menu built from per-page `items`, the current page left out) the order test fails with
 * the labels differing between pages and no aria-current at all.
 */
const ALL: MenuPage[] = ['sheet', 'roster', 'campaigns', 'homebrew', 'settings'];

function navFor(current: MenuPage | null, go: Record<string, ReturnType<typeof vi.fn>>): PageNav {
  return { current, go: Object.fromEntries(ALL.map((p) => [p, go[p]])) as PageNav['go'] };
}

function menuFrom(current: MenuPage | null) {
  const go = Object.fromEntries(ALL.map((p) => [p, vi.fn()]));
  const r = renderDom(createElement(PageNavContext.Provider, { value: navFor(current, go) }, createElement(PageMenu, {})));
  r.click(r.host.querySelector('button[title="Menu"]'));
  const rows = [...r.host.querySelectorAll<HTMLElement>('.topmenu [role="menuitem"]')];
  return { ...r, go, rows, labels: rows.map((b) => (b.textContent ?? '').trim()) };
}

describe('the hamburger menu lists every page in one fixed order', () => {
  it('shows the same entries in the same order from every page', () => {
    const seen = ALL.map((p) => {
      const m = menuFrom(p);
      const labels = m.labels;
      m.stop();
      return labels;
    });
    for (const labels of seen) expect(labels).toEqual(MENU_PAGES.map((p) => p.label));
    // …and so does a screen the menu does not list (the builder), which marks nothing.
    const b = menuFrom(null);
    expect(b.labels).toEqual(MENU_PAGES.map((p) => p.label));
    expect(b.rows.filter((r) => r.getAttribute('aria-current') === 'page')).toHaveLength(0);
    b.stop();
  });

  it('marks exactly one entry, the page on screen', () => {
    for (const p of ALL) {
      const m = menuFrom(p);
      const marked = m.rows.filter((r) => r.getAttribute('aria-current') === 'page');
      expect(marked).toHaveLength(1);
      expect((marked[0].textContent ?? '').trim()).toBe(MENU_PAGES.find((x) => x.id === p)!.label);
      expect(marked[0].classList.contains('current')).toBe(true);
      expect(m.rows.filter((r) => r.classList.contains('current'))).toHaveLength(1);
      m.stop();
    }
  });

  it('choosing the marked page only closes the menu; choosing another goes there', () => {
    const m = menuFrom('homebrew');
    const here = m.rows.find((r) => r.getAttribute('aria-current') === 'page')!;
    m.click(here);
    expect(m.go.homebrew).not.toHaveBeenCalled();
    expect(m.host.querySelector('.topmenu')).toBeNull();
    m.click(m.host.querySelector('button[title="Menu"]'));
    const campaigns = [...m.host.querySelectorAll<HTMLElement>('.topmenu [role="menuitem"]')].find((r) => (r.textContent ?? '').includes('Campaigns'))!;
    m.click(campaigns);
    expect(m.go.campaigns).toHaveBeenCalledTimes(1);
    expect(m.host.querySelector('.topmenu')).toBeNull();
    m.stop();
  });

  it('leaves a page that cannot be opened out of EVERY page’s menu alike (no character, signed-out phone)', () => {
    const entries = (current: MenuPage) =>
      menuPageEntries({ current, go: { roster: () => {}, homebrew: () => {}, settings: () => {} } }).map((e) => e.id);
    // No sheet or campaigns handler: both are left out everywhere except where the page IS on screen.
    expect(entries('roster')).toEqual(['roster', 'homebrew', 'settings']);
    expect(entries('homebrew')).toEqual(['roster', 'homebrew', 'settings']);
    expect(entries('settings')).toEqual(['roster', 'homebrew', 'settings']);
  });

  it('keeps an action (Customize) after the pages so it never moves them', () => {
    const go = Object.fromEntries(ALL.map((p) => [p, vi.fn()]));
    const onCustomize = vi.fn();
    const withActions = (current: MenuPage) => {
      const r = renderDom(
        createElement(
          PageNavContext.Provider,
          { value: navFor(current, go) },
          createElement(PageMenu, { actions: [{ label: 'Customize', icon: 'ti-adjustments', onClick: onCustomize }] }),
        ),
      );
      r.click(r.host.querySelector('button[title="Menu"]'));
      const labels = [...r.host.querySelectorAll('.topmenu [role="menuitem"]')].map((b) => (b.textContent ?? '').trim());
      r.stop();
      return labels;
    };
    expect(withActions('sheet')).toEqual([...MENU_PAGES.map((p) => p.label), 'Customize']);
    expect(withActions('roster')).toEqual([...MENU_PAGES.map((p) => p.label), 'Customize']);
  });

  it('without the app’s page list (the tracker app) falls back to the caller’s items plus Settings', () => {
    const onSettings = vi.fn();
    const r = renderDom(createElement(PageMenu, { items: [], onOpenSettings: onSettings }));
    r.click(r.host.querySelector('button[title="Menu"]'));
    const rows = [...r.host.querySelectorAll<HTMLElement>('.topmenu [role="menuitem"]')];
    expect(rows.map((b) => (b.textContent ?? '').trim())).toEqual(['Settings']);
    expect(rows[0].getAttribute('aria-current')).toBeNull();
    r.click(rows[0]);
    expect(onSettings).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('is wired: App provides the page list around every screen and the css marks the current row', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    // (other providers may sit between the page list and {screen}, so match the pair, not one line)
    expect(app).toMatch(/<PageNavContext\.Provider value=\{pageNav\}>[\s\S]{0,400}\{screen\}[\s\S]{0,200}<\/PageNavContext\.Provider>/);
    const css = readFileSync('src/sheet.css', 'utf8');
    expect(css).toMatch(/\.topmenu-item\.current/);
  });
});
