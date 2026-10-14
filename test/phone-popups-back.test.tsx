// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { FilterableSelect, PickerRow, type FilterSpec } from '../src/sheet/FilterableSelect';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { ContentContext } from '../src/sheet/ContentContext';
import type { DescNode } from '../src/sheet/descref';

/**
 * Android Back (and Escape) inside two shared popups — phone audit 2026-10-14.
 *
 *  - C1/D8/E6, decision 3: with the Filters panel open in the full-screen feat/spell/item picker, Back or
 *    Escape closed the WHOLE picker and threw away the typed search and every filter; the panel had no
 *    Done button (dropped by accident in v0.1.16). Now Back/Escape close only the panel — on desktop too,
 *    where the panel is a takeover of the popup body as well — and the phone has its Done button back.
 *  - B5/C12/D11: after following a link inside a description, Back closed the whole description while
 *    the card's own "‹ Back" went one page back. On a phone the hardware Back now does what the visible
 *    one does. Desktop Escape still closes the whole chain (the card's documented behaviour).
 *
 * Back is the `popstate` the dismiss stack (useEscapeClose.ts) traps on a phone; Escape is the keydown
 * it listens for everywhere. Both are dispatched here exactly as the browser does.
 *
 * Each `it` was run once with its fix removed and failed (2026-10-14): without the panel's useBackHandler
 * the picker's onClose fired on the first Escape/Back; without the Done button the click target was
 * missing; without the card's useBackHandler the first Back called onExit.
 */

/** jsdom has no media queries: answer as a phone (≤720px) or a desktop does. */
function setViewport(phone: boolean) {
  const noop = () => undefined;
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = max ? phone && Number(max[1]) >= 360 : false;
    return { matches, media: query, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false };
  }) as unknown as typeof window.matchMedia;
}

const escape = () => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
const androidBack = () => act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });

function type(input: HTMLInputElement | null, text: string) {
  if (!input) throw new Error('input not found');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const mounted: { stop: () => void }[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.stop();
  for (const n of [...document.body.children]) n.remove();
});

type Thing = { id: string; name: string; rarity: string };
const THINGS: Thing[] = [
  { id: 'a', name: 'Alpha Strike', rarity: 'common' },
  { id: 'b', name: 'Beta Strike', rarity: 'rare' },
  { id: 'c', name: 'Gamma Guard', rarity: 'common' },
];
const SPEC: FilterSpec<Thing> = {
  fields: [
    { id: 'q', label: 'Search', kind: 'text', accessor: (t) => t.name },
    { id: 'rarity', label: 'Rarity', kind: 'chips', options: [{ id: 'common', label: 'Common' }, { id: 'rare', label: 'Rare' }], accessor: (t) => t.rarity },
  ],
};

function openPicker(onClose: () => void) {
  const r = renderDom(
    <FilterableSelect<Thing> title="Choose a class feat" items={THINGS} spec={SPEC} rowKey={(t) => t.id} onClose={onClose} renderRow={(t) => <PickerRow name={t.name} onSelect={() => undefined} />} />,
  );
  mounted.push(r);
  const head = () => r.host.querySelector<HTMLButtonElement>('.fsel-head-filters');
  const panel = () => r.host.querySelector('.fsel-panel');
  const search = () => r.host.querySelector<HTMLInputElement>('.fsel-results-search input');
  const openFilters = () => {
    r.click(head());
    expect(panel(), 'the Filters panel opened').toBeTruthy();
  };
  return { r, head, panel, search, openFilters };
}

describe('the Filters panel is its own layer (C1/D8/E6, decision 3)', () => {
  for (const phone of [true, false]) {
    it(`${phone ? 'phone' : 'desktop'}: Escape closes only the panel; the search and the filters stay`, () => {
      setViewport(phone);
      const onClose = vi.fn();
      const p = openPicker(onClose);
      type(p.search(), 'strike');
      p.openFilters();
      const common = [...p.r.host.querySelectorAll('.fsel-panel .fsel-chip')].find((c) => (c.textContent ?? '').includes('Common'));
      p.r.click(common!);
      expect(p.head()?.textContent).toContain('Filters (1)');
      escape();
      expect(p.panel(), 'Escape closed the panel').toBeNull();
      expect(onClose, 'Escape with the panel open must not close the picker').not.toHaveBeenCalled();
      expect(p.r.host.querySelector('.picker.fsel')).toBeTruthy();
      expect(p.search()?.value, 'the typed search survived').toBe('strike');
      expect(p.head()?.textContent, 'the filter survived').toContain('Filters (1)');
      expect(p.r.host.querySelectorAll('.fsel-list .picker-name').length).toBe(1); // Alpha Strike only
      // With the panel closed, the next Escape is the picker's again.
      escape();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  }

  it('phone: Android Back closes only the panel, then the picker', () => {
    setViewport(true);
    const onClose = vi.fn();
    const p = openPicker(onClose);
    type(p.search(), 'guard');
    p.openFilters();
    androidBack();
    expect(p.panel(), 'Back closed the panel').toBeNull();
    expect(onClose, 'Back with the panel open must not close the picker').not.toHaveBeenCalled();
    expect(p.search()?.value).toBe('guard');
    androidBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the panel has its Done button back, and it returns to the results', () => {
    setViewport(true);
    const onClose = vi.fn();
    const p = openPicker(onClose);
    p.openFilters();
    const done = p.r.host.querySelector('.fsel-panel .fsel-bar button.fsel-done');
    expect(done, 'a Done button in the panel bar').toBeTruthy();
    expect((done!.textContent ?? '').trim()).toBe('Done');
    p.r.click(done);
    expect(p.panel()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(p.r.host.querySelectorAll('.fsel-list .picker-name').length).toBe(3);
  });
});

describe('Back inside a description goes back one page on a phone (B5/C12/D11)', () => {
  const db = content();
  beforeAll(() => {
    // No network in jsdom: every page lookup degrades to the record's own text, as the card does offline.
    vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }));
  });
  const ROOT: DescNode = { title: 'Glimmerwick Lantern', description: 'While lit, you can Seek as a single action.', descRefs: [{ key: 'actions', label: 'Seek' }] };

  async function openCard(opts: { onClose: () => void; onExit?: () => void; backToSource?: boolean }) {
    const r = renderDom(
      <ContentContext.Provider value={db}>
        <DescriptionModal root={ROOT} onClose={opts.onClose} onExit={opts.onExit} backToSource={opts.backToSource} />
      </ContentContext.Provider>,
    );
    mounted.push(r);
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    const title = () => (r.host.querySelector('.info-title, .ast-name')?.textContent ?? '').trim();
    const drill = async () => {
      const link = [...r.host.querySelectorAll<HTMLElement>('button.desc-link')].find((b) => (b.textContent ?? '').trim() === 'Seek');
      expect(link, 'the Seek link in the description').toBeTruthy();
      await act(async () => { link!.click(); });
      await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
      expect(title(), 'drilled into the linked page').toBe('Seek');
      expect(r.host.querySelector('.info-back'), 'the card shows its own Back').toBeTruthy();
    };
    return { r, title, drill };
  }

  it('phone: Back after following a link returns to the first page; the next Back closes', async () => {
    setViewport(true);
    const onClose = vi.fn();
    const onExit = vi.fn();
    const c = await openCard({ onClose, onExit });
    expect(c.title()).toBe('Glimmerwick Lantern');
    await c.drill();
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
    expect(onExit, 'Back must not close the whole description chain').not.toHaveBeenCalled();
    expect(c.title(), 'one page back').toBe('Glimmerwick Lantern');
    expect(c.r.host.querySelector('.info-back')).toBeNull();
    androidBack();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('phone: a card opened from another popup (its Back says so) steps back to that popup, as its Back button does', async () => {
    setViewport(true);
    const onClose = vi.fn();
    const onExit = vi.fn();
    await openCard({ onClose, onExit, backToSource: true });
    androidBack();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('desktop: Escape still closes the whole chain, even after following a link', async () => {
    setViewport(false);
    const onClose = vi.fn();
    const onExit = vi.fn();
    const c = await openCard({ onClose, onExit });
    await c.drill();
    escape();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
