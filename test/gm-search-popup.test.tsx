// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import type { CampaignMembership } from '../src/data/campaigns';
import { trackerUi } from '../src/integration/trackerUiStore';
import { useGmLayoutStore, type PaneNode } from '../tracker/src/store/layoutStore';
import { useWindowStore, BASE_Z } from '../tracker/src/store/windowStore';
import { useCombatStore } from '../tracker/src/store/combatStore';
import LEDGER from '../src/data/trust-ledger.json';

/**
 * THE GM SEARCH'S PAGES, ON THE SURFACE THEY ARE FOR (Campaigns -> a table -> Search).
 *
 * Item 7 of the owner's online list (2026-10-01): "Search everything results open in the tracker's
 * movable, windowed stat-block popup, not a static popup." A result used to open HH's description popup
 * on <body> — centred over a dimmed page, one at a time, impossible to move. It now opens as one of the
 * tracker's own floating windows ([data-float-win]: dragged, resized, tabbed, docked), drawn by the same
 * page renderer as a page pinned to the GM screen (CampaignTracker's HostPage, RecordCard gm/window).
 *
 * What every description popup had, the window keeps (the earlier round of this file):
 *  - the favourite star. The GM's pinned references are the GM screen, so the star pins the page there
 *    (a `host` pane tab) and the pane draws the page; the window's star sits in its header, and in a
 *    strip above the page of a pane holding two tabs (no header there);
 *  - the trust marker, in the page's own head where the popup puts it (never the one-row window header,
 *    where its words would crowd out the tabs and the close button);
 *  - the page's Archives of Nethys link (scripts/stamp-ast-urls.mjs puts each page's address on its tree).
 * And what a window needs that the popup never did:
 *  - Escape closes the top window, then the next, and only then leaves the campaign; a press spent by the
 *    row's right-click menu over a window closes the menu alone; a tracker overlay drawn OVER the windows
 *    takes the press first even when a window opened after it, and the Customize panel drawn UNDER them
 *    does not; while the table is still opening (no window on screen) Escape closes none;
 *  - a link inside a window opens another window where it was clicked — in the zoomed page's pixels;
 *  - a list keeps its bullets (the tracker's scoped preflight strips them; campaign-tracker.css restores),
 *    every kind of list a page draws;
 *  - the windows go when the GM returns to the campaigns list, and stay through an unmount (settings);
 *  - Escape in the GM screen's "Add to GM Screen" picker closes the picker and nothing else.
 * Mounted on the local table (no account), the way a GM without one opens it. Records are the shipped
 * ones (the Breachhill article, the Halfling family page); the combatant is synthetic.
 *
 * MUTATIONS (each applied, run, read off that run, then restored):
 *  - GlobalSearch choose: `else if (host?.render) openWin('host', ref, h.title)` dropped → leg 1 red (no
 *    window; the old static popup is gone, so nothing opens at all).
 *  - FloatingWindow WinItem: `controls={…HostControls…}` dropped → leg 1 red at the star.
 *  - CampaignTracker: the window Escape handler (`useBackHandler(synced && openWindows > 0, …)`) dropped →
 *    leg 3 red ("the first Escape left the campaign").
 *  - CampaignTracker window handler: `if (trackerPopupOpen() || popupAtPress.current) return;` dropped →
 *    leg 4 red (the window under the menu closed too).
 *  - CampaignTracker HostPage → hostSearch `open`: `openHostWindow(content, bucket, id, at)` → `(…, undefined)`
 *    → leg 2 red (the second window opened centred, not at the click).
 *  - campaign-tracker.css: the `.campaign-tracker ul.ast-list { list-style: disc; }` rule dropped → leg 5
 *    red ("expected 'none' to be 'disc'"); the `ul.ast-list ul.ast-list` circle rule dropped → leg 5 red
 *    at "a list in a list"; the `ol.ast-list` decimal rule → red at "a numbered list"; the stub-list
 *    `none` rule → red at "the compact feat list".
 *  - CampaignTracker openHostWindow: `fixedPopupPos(at.x, at.y, …)` → `{ left: at.x, top: at.y }` → the
 *    zoom-2 leg red ({600, 400} — the click was never divided by the zoom; at zoom 1 nothing can tell).
 *  - CampaignTracker: `trackerUi.onReset(…closeAll…)` dropped → leg 6 red (the windows survive the reset).
 *  - GlobalSearch: both Escape stops dropped (onKeyDown's and the document listener's) → leg 7 red (the GM
 *    left the campaign); tracker/src/components/GlobalSearch.host.test.tsx pins each one alone.
 *  - RecordCard WindowRecordCard: `headerControls={marker}` dropped → the marker leg red ("the marker, in
 *    the page head").
 *  - FloatingWindow PopupPreview: `{hideHeader && type === 'host' && <HostControls … bar />}` dropped → the
 *    marker leg red at "the star, above the page".
 *  - CampaignTracker window handler: `&& !overlayAboveWindows` dropped → the overlay leg red ("the first
 *    Escape closed the overlay the GM sees": the hidden window went instead).
 *  - CampaignTracker: the Customize handler's `{ under: true }` dropped → the overlay leg red ("the window
 *    over the panel went first").
 *  - CampaignTracker window handler: `synced &&` dropped → the opening leg red (the unseen window closed).
 */

vi.mock('../src/integration/enabled', () => ({ TRACKER_IN_CAMPAIGN: true, TEST_CAMPAIGNS_WITHOUT_LOGIN: false }));
/* One object, so a render reads the same answer every time; `status` is flipped to 'loading' by the leg
 * that needs the table still opening (CampaignTracker waits for auth's answer, up to its 4 s cap). */
const AUTH = vi.hoisted(() => ({ status: 'disabled' as string, session: null, email: null }));
vi.mock('../src/data/useAuth', () => ({ useAuth: () => AUTH, signOut: async () => undefined }));

/* Loaded here, under the mocks above, not inside the test: transforming the whole tracker counted against
 * the test's own time budget. */
const { CampaignTracker, openHostWindow } = await import('../src/integration/CampaignTracker');

const LOCAL_TABLE: CampaignMembership = { id: 'local', code: '', role: 'gm', name: 'Local table', description: '', local: true };
const PAGE = 'breachhill-outpost-of-secrets';
const PAGE_NAME = 'Breachhill, Outpost of Secrets';
/* Each file is read and parsed ONCE: gunzipping reference.json.gz again on every fetch put this test at
 * 3.4 s alone and past the 5 s default under a 36-file run (the refuter measured one timeout in two). */
const parsed = new Map<string, unknown>();
const once = (file: string, read: () => string) => parsed.get(file) ?? parsed.set(file, JSON.parse(read())).get(file);
const trees = (bucket: string) => once(bucket, () => gunzipSync(readFileSync(`public/ast/${bucket}.json.gz`)).toString('utf8')) as Record<string, { url?: string }>;
const astIndex = () => once('ast-index', () => readFileSync('public/ast-index.json', 'utf8'));
type Rec = { name: string };
const recName = (bucket: string, id: string) => (content() as unknown as Record<string, Record<string, Rec>>)[bucket][id].name;
/** A record that draws "Not yet verified" and has a page: the first the shipped ledger names (its
 *  `partly`, then its `unencoded`), the items bucket skipped (its trees take seconds to parse). */
function markedPage(): { bucket: string; id: string } {
  const ledger = LEDGER as { partly?: Record<string, string>; unencoded?: string[] };
  const db = content() as unknown as Record<string, Record<string, Rec> | undefined>;
  for (const key of [...Object.keys(ledger.partly ?? {}), ...(ledger.unencoded ?? [])]) {
    const [bucket, id] = key.split('/');
    if (bucket === 'items' || !db[bucket]?.[id]) continue;
    if (trees(bucket)[id]) return { bucket, id };
  }
  throw new Error('no marked record with a page in the shipped ledger');
}

let live: Root | null = null;
let host: HTMLElement | null = null;
const onLeave = vi.fn();

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function until(what: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 40 && !what(); i++) await flush(1);
  expect(what(), label).toBe(true);
}
const click = (el: Element | null) => act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
function type(input: HTMLInputElement, text: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** Escape the way the dismiss stack hears it (its listener is on `window`). */
async function escape(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  await flush(2);
}
function hostTabs(n: PaneNode | null): string[] {
  if (!n) return [];
  return n.kind === 'leaf' ? n.tabs.filter((t) => t.type === 'host').map((t) => t.ref) : [...hostTabs(n.a), ...hostTabs(n.b)];
}
const wins = () => [...document.querySelectorAll<HTMLElement>('[data-float-win]')];
const winOf = (text: string) => wins().find((w) => (w.textContent ?? '').includes(text));
/** The window whose tab reads `title`, once its page has drawn. */
const winTitled = (title: string) =>
  wins().find((w) => (w.querySelector('[data-tab-win]')?.textContent ?? '').includes(title) && !!w.querySelector('.ast-win > .ast-body'));

function mountTracker(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(
    <CampaignTracker m={LOCAL_TABLE} content={content()} onOpenSettings={() => undefined} onLeave={onLeave} onViewMember={() => undefined} />,
  ));
}
/** A page opened the way a Search result opens one (GlobalSearch → windowStore.open('host', …)). */
async function openPage(bucket: string, id: string, title: string): Promise<HTMLElement> {
  act(() => useWindowStore.getState().open('host', `${bucket}:${id}`, title));
  await until(() => !!winTitled(title), `the ${title} window draws its page`);
  return winTitled(title)!;
}

beforeEach(() => {
  localStorage.clear();
  trackerUi.reset();
  onLeave.mockReset();
  useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null });
  // Module-level: windows would leak from one leg into the next.
  useWindowStore.setState({ wins: [], topZ: BASE_Z });
  useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null, addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  // The description trees, through the loader's raw-JSON fallback (astStore.ts); nothing else is served.
  vi.stubGlobal('fetch', async (url: string) => {
    const m = /\/ast\/(\w+)\.json$/.exec(String(url));
    if (m) return { ok: true, status: 200, json: async () => trees(m[1]) };
    if (String(url).endsWith('/ast-index.json')) return { ok: true, status: 200, json: async () => astIndex() };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
  });
});

afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  for (const n of [...document.body.children]) n.remove();
  useWindowStore.setState({ wins: [], topZ: BASE_Z });
  AUTH.status = 'disabled';
  trackerUi.reset();
  vi.unstubAllGlobals();
});

describe('the GM Search opens pages as tracker windows', () => {
  // A whole CampaignTracker mount: the same 120 s budget as the other full-surface mounts
  // (bug-campaign-leave, bug-owner-2026-09-16-seam), not vitest's 5 s default, which suite load alone can use up.
  it('a result opens a movable window: the page, its Archives link, and the star that pins it to the GM screen', async () => {
    mountTracker();
    await flush();

    act(() => trackerUi.setSearch(true));
    await flush();
    const input = document.querySelector<HTMLInputElement>('input[placeholder^="Search everything"]');
    expect(input, 'the host-mode Search').toBeTruthy();
    type(input!, 'Breachhill');
    await until(() => [...document.querySelectorAll('[data-row]')].some((r) => r.textContent?.includes(PAGE_NAME)), 'the article is a Search row');
    click([...document.querySelectorAll('[data-row]')].find((r) => r.textContent?.includes(PAGE_NAME))!);
    await until(() => !!winOf('demographics of Breachill'), 'the page opens in a tracker window');

    const win = winOf('demographics of Breachill')!;
    // A tracker window — inside the tracker's own root, so it wears the tracker's look — and no static popup.
    expect(win.closest('.tracker-root.campaign-tracker'), 'the window is inside the tracker').not.toBeNull();
    expect(document.querySelector('.ast-modal, .picker-overlay'), 'no static popup').toBeNull();
    expect(useWindowStore.getState().wins.map((w) => w.tabs[0])).toEqual([{ type: 'host', ref: `reference:${PAGE}`, title: PAGE_NAME, castRank: undefined }]);
    expect(win.querySelector('[data-tab-win]')?.textContent, 'the tab is the title').toContain(PAGE_NAME);
    expect(document.querySelector('input[placeholder^="Search everything"]'), 'the Search box closed').toBeNull();
    // The window chrome's page: the popup's head without the name, then the body.
    expect(win.querySelector('.ast-win > .ast-body'), 'the page in the window chrome').not.toBeNull();
    expect(win.querySelector('.ast-name'), 'no second title under the tab').toBeNull();

    // The Archives link: the page's own address, stamped on its tree.
    const url = trees('reference')[PAGE].url!;
    expect(url).toMatch(/^\/Articles\.aspx\?ID=\d+$/);
    expect(win.querySelector<HTMLAnchorElement>('.ast-win-head .ast-aon')?.href).toBe(`https://2e.aonprd.com${url}`);

    // The star, in the window's header, provided by the GM surface itself (no test provider here).
    const star = () => win.querySelector<HTMLButtonElement>('[data-host-controls] .info-star');
    expect(star(), 'every description popup keeps the favourite star').toBeTruthy();
    expect(star()!.title).toBe('Favorite — add to GM screen');
    click(star());
    expect(hostTabs(useGmLayoutStore.getState().root)).toEqual([`reference:${PAGE}`]);
    await flush(1);
    expect(star()?.classList.contains('on')).toBe(true);

    // …and the GM screen draws the pinned page itself — with the window CLOSED first, so the text found
    // is the pane's, not the window's.
    click(win.querySelector('button[title="Close"]'));
    await flush(1);
    expect(wins(), 'the window closed').toHaveLength(0);
    act(() => trackerUi.showMain('gm'));
    await until(() => (host!.textContent ?? '').includes('demographics of Breachill'), 'the pinned page on the GM screen');
    expect(wins(), 'drawn by the pane, not a window').toHaveLength(0);
    // The same page renderer as the window, and the same header controls: on a pinned pane the star unpins.
    expect(host!.querySelector('.ast-win > .ast-body'), 'the pane draws the window chrome too').not.toBeNull();
    const paneStar = host!.querySelector<HTMLButtonElement>('[data-host-controls] .info-star.on');
    expect(paneStar?.title).toBe('Remove from GM screen');
    click(paneStar);
    expect(hostTabs(useGmLayoutStore.getState().root)).toEqual([]);
    expect(onLeave).not.toHaveBeenCalled();
  }, 120_000);

  it('a link inside a window opens another window where it was clicked', async () => {
    mountTracker();
    await flush();
    const first = await openPage('reference', PAGE, PAGE_NAME);
    const link = first.querySelector<HTMLElement>('.ast-body a.ast-lk');
    expect(link, 'the page has a live link').toBeTruthy();
    await act(async () => { link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 })); });
    await until(() => useWindowStore.getState().wins.length === 2, 'a second window');
    const [a, b] = useWindowStore.getState().wins;
    expect(b.tabs[0].type).toBe('host');
    expect(b.tabs[0].ref).not.toBe(a.tabs[0].ref);
    // At the click (jsdom: zoom 1, so the click's client point is the window's top-left), above the first.
    expect({ x: b.x, y: b.y }).toEqual({ x: 300, y: 200 });
    expect(b.z).toBeGreaterThan(a.z);
    // No popup of HH's own opened inside the window.
    expect(document.querySelector('.ast-modal, .picker-overlay')).toBeNull();
  }, 120_000);

  it('Escape closes the top window, then the next — and only then leaves the campaign', async () => {
    mountTracker();
    await flush();
    await openPage('reference', PAGE, PAGE_NAME);
    await openPage('reference', 'halfling', 'Halfling');
    const halfling = useWindowStore.getState().wins[1].id;

    await escape();
    expect(onLeave, 'the first Escape left the campaign').not.toHaveBeenCalled();
    expect(useWindowStore.getState().wins.map((w) => w.id), 'the top window went first').not.toContain(halfling);
    expect(wins()).toHaveLength(1);

    await escape();
    expect(onLeave, 'the second Escape left the campaign').not.toHaveBeenCalled();
    expect(wins()).toHaveLength(0);

    // Nothing left to peel: Escape leaves, as it always has.
    await escape();
    expect(onLeave).toHaveBeenCalledTimes(1);
  }, 120_000);

  it('Escape out of the row menu over a window closes the menu alone', async () => {
    mountTracker();
    await flush();
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Tidewrack Gull', initiative: 14 }));
    await flush(1);
    await openPage('reference', PAGE, PAGE_NAME);
    const row = host!.querySelector('.init-row');
    expect(row, 'the initiative row').not.toBeNull();
    act(() => void row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })));
    await flush(1);
    const menu = document.querySelector('body > .tracker-root:not(.campaign-tracker)');
    expect(menu, 'the row menu').not.toBeNull();

    // Escape the way the browser delivers it: up through `document`, where the menu listens, and on to
    // `window`, where the dismiss stack does.
    await act(async () => {
      menu!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush(1);
    expect(document.querySelector('body > .tracker-root:not(.campaign-tracker)'), 'the menu closed').toBeNull();
    expect(wins(), 'the window under the menu is still open').toHaveLength(1);
    expect(onLeave).not.toHaveBeenCalled();
  }, 120_000);

  it('a list in a window keeps its bullets', async () => {
    mountTracker();
    await flush();
    // The tracker's scoped preflight, as the app loads it, and the seam's own rules for HH lists — vitest
    // does not apply imported CSS, so the two sheets are put in the document by hand, read off the files.
    const scoped = readFileSync('tracker/dist-css/tracker.scoped.css', 'utf8');
    const preflight = /:where\(\.tracker-root\) ol,[^{}]*\{[^}]*\}/.exec(scoped)?.[0];
    expect(preflight, 'the preflight rule that strips list bullets').toMatch(/list-style:\s*none/);
    const seam = readFileSync('src/integration/campaign-tracker.css', 'utf8');
    const restore = [...seam.matchAll(/^\.campaign-tracker[^{}]*\.ast-list[^{}]*\{[^}]*\}/gm)].map((m) => m[0]).join('\n');
    const style = document.createElement('style');
    style.textContent = `${preflight}\n${restore}`;
    document.head.appendChild(style);
    try {
      const win = await openPage('reference', 'halfling', 'Halfling');
      await until(() => !!win.querySelector('ul.ast-list, ol.ast-list'), 'the Halfling page has a list');
      const list = win.querySelector<HTMLElement>('ul.ast-list, ol.ast-list')!;
      const markers = (el: Element) => getComputedStyle(el).getPropertyValue('list-style');
      expect(markers(list), 'the list keeps its markers').toBe(list.tagName === 'OL' ? 'decimal' : 'disc');
      // Every kind of list a page draws (AstRenderer: a list, a list in a list, a numbered list, an
      // archetype page's compact feat list), in the same window body.
      const kinds = document.createElement('div');
      kinds.innerHTML =
        '<ul class="ast-list" data-k="ul"><li>a<ul class="ast-list" data-k="nested"><li>b</li></ul></li></ul>' +
        '<ol class="ast-list" data-k="ol"><li>c</li></ol>' +
        '<ul class="ast-list ast-stub-list" data-k="stub"><li>d</li></ul>' +
        '<ul class="ast-list"><li>e<ul class="ast-list ast-stub-list" data-k="nested-stub"><li>f</li></ul></li></ul>';
      list.parentElement!.appendChild(kinds);
      const k = (name: string) => kinds.querySelector(`[data-k="${name}"]`)!;
      expect(markers(k('ul')), 'a list: discs').toBe('disc');
      expect(markers(k('nested')), 'a list in a list: circles').toBe('circle');
      expect(markers(k('ol')), 'a numbered list: numbers').toBe('decimal');
      expect(markers(k('stub')), 'the compact feat list: none, as everywhere').toBe('none');
      expect(markers(k('nested-stub')), 'a compact list inside a list: none').toBe('none');
      // Not vacuous: the same list outside the restoring rules is stripped by the preflight.
      const bare = document.createElement('div');
      bare.className = 'tracker-root';
      bare.innerHTML = '<ul class="ast-list"><li>x</li></ul>';
      document.body.appendChild(bare);
      expect(getComputedStyle(bare.firstElementChild!).getPropertyValue('list-style')).toBe('none');
    } finally {
      style.remove();
    }
  }, 120_000);

  it('a link at zoom 2 opens its window at the click, in the zoomed page\'s own pixels', () => {
    // Heroes Heaven scales the app with html{zoom}; a click arrives in real viewport pixels. At zoom 2 the
    // click (600, 400) is the page's (300, 200) — the window must open there, not at (600, 400).
    const realStyle = window.getComputedStyle;
    const realW = window.innerWidth;
    const realH = window.innerHeight;
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const cs = realStyle.call(window, el, pseudo);
      if (el !== document.documentElement) return cs;
      return new Proxy(cs, { get: (t, p) => (p === 'getPropertyValue' ? (name: string) => (name === 'zoom' ? '2' : t.getPropertyValue(name)) : Reflect.get(t, p)) });
    });
    Object.defineProperty(window, 'innerWidth', { value: 2400, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 1600, configurable: true });
    try {
      openHostWindow(content(), 'reference', PAGE, { x: 600, y: 400 });
      const [w] = useWindowStore.getState().wins;
      expect(w.tabs[0]).toMatchObject({ type: 'host', ref: `reference:${PAGE}` });
      expect({ x: w.x, y: w.y }, 'the click, divided by the zoom').toEqual({ x: 300, y: 200 });
    } finally {
      spy.mockRestore();
      Object.defineProperty(window, 'innerWidth', { value: realW, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: realH, configurable: true });
    }
  });

  it('the windows go when the GM returns to the campaigns list — and stay through an unmount (campaign settings)', async () => {
    mountTracker();
    await flush();
    await openPage('reference', PAGE, PAGE_NAME);
    // Campaign settings unmounts the tracker; the windows are the GM's view and wait for his return.
    act(() => live!.unmount());
    live = null;
    expect(useWindowStore.getState().wins, 'the windows outlived the unmount').toHaveLength(1);
    // Back to the campaigns list (CampaignsPage calls this there): gone.
    act(() => trackerUi.reset());
    expect(useWindowStore.getState().wins).toEqual([]);
  }, 120_000);

  it('the trust marker is the page\'s, in its head — never the one-row window header — and a pane holding two tabs keeps the star', async () => {
    const { bucket, id } = markedPage();
    const name = recName(bucket, id);
    mountTracker();
    await flush();
    await openPage(bucket, id, name);
    // The page itself, not its loading placeholder (which carries the marker too, as the popup's does).
    await until(() => !!winTitled(name)?.querySelector('.ast-win-head'), `the ${name} page drawn`);
    const win = winTitled(name)!;
    // Where the popup draws it: in the head's controls, beside the badge and the Archives link — free to
    // wrap there, so "…partly applied. Not applied: …" is read whole.
    const note = win.querySelector('.ast-win-head .ast-controls .sd-choice-note');
    expect(note?.textContent ?? '', `${bucket}:${id} — the marker, in the page head`).toMatch(/^Not yet verified/);
    // The window header is ONE row shared with the tabs and the close button: the star only.
    expect(win.querySelector('[data-tab-win] .sd-choice-note'), 'no marker in the window header').toBeNull();
    const star = win.querySelector<HTMLButtonElement>('[data-tab-win] [data-host-controls] .info-star');
    expect(star, 'the star in the header').not.toBeNull();
    click(star);
    expect(hostTabs(useGmLayoutStore.getState().root)).toEqual([`${bucket}:${id}`]);
    click(win.querySelector('button[title="Close"]'));
    await flush(1);
    act(() => trackerUi.showMain('gm'));
    await until(() => !!host!.querySelector('[data-pane-leaf] .ast-win-head .sd-choice-note'), 'the pinned page in its pane, with its marker');

    // A second tab in the same pane: the pane drops its header (the tab strip names the tabs). The star
    // used to go with it; it sits in a strip above the page now, and the marker stays in the page head.
    const gm = useGmLayoutStore.getState();
    const leaf = gm.root!;
    expect(leaf.kind).toBe('leaf');
    act(() => gm.dropPopups(leaf.id, [{ type: 'condition', ref: 'synthetic glare', title: 'Synthetic Glare' }], 'center'));
    act(() => useGmLayoutStore.getState().focusTab(leaf.id, 0));
    await flush(1);
    expect(host!.querySelectorAll('[data-pane-leaf] [data-tab-leaf] > div > div'), 'two tabs').toHaveLength(2);
    const paneStar = host!.querySelector<HTMLButtonElement>('[data-pane-leaf] [data-host-controls-bar] [data-host-controls] .info-star.on');
    expect(paneStar?.title, 'the star, above the page').toBe('Remove from GM screen');
    expect(host!.querySelector('[data-pane-leaf] .ast-win-head .sd-choice-note'), 'and the marker').not.toBeNull();
    expect(onLeave).not.toHaveBeenCalled();
  }, 120_000);

  it('a tracker overlay over the windows takes Escape first, even opened before the window; the Customize panel under them does not', async () => {
    mountTracker();
    await flush();
    // The Monster search (a `.modal-overlay`, z 2000 — over every window), THEN a window: a link inside an
    // overlay opens one (the Custom creature's stat block). Its window sits under the overlay.
    act(() => trackerUi.setMonsterSearch(true));
    await flush(1);
    const overlay = () => host!.querySelector('.campaign-tracker .modal-overlay');
    expect(overlay(), 'the Monster search').not.toBeNull();
    await openPage('reference', PAGE, PAGE_NAME);
    await escape();
    expect(overlay(), 'the first Escape closed the overlay the GM sees').toBeNull();
    expect(wins(), '…not the window hidden under it').toHaveLength(1);
    await escape();
    expect(wins(), 'the next one closed the window').toHaveLength(0);
    expect(onLeave).not.toHaveBeenCalled();

    // The Customize panel is drawn UNDER the windows (`.tc-overlay`, z 60): opened after a window, Escape
    // still takes the window over it first.
    await openPage('reference', PAGE, PAGE_NAME);
    act(() => trackerUi.setAppearance(true));
    await flush(1);
    const panel = () => host!.querySelector('.tc-overlay');
    expect(panel(), 'the Customize panel').not.toBeNull();
    await escape();
    expect(wins(), 'the window over the panel went first').toHaveLength(0);
    expect(panel(), 'the panel under it stayed').not.toBeNull();
    await escape();
    expect(panel(), 'then the panel').toBeNull();
    expect(onLeave).not.toHaveBeenCalled();
  }, 120_000);

  it('while the table is still opening, Escape closes no window — none is on screen yet', async () => {
    // Auth has not answered: the table waits (up to its 4 s cap) and draws only "Opening the table…".
    AUTH.status = 'loading';
    act(() => useWindowStore.getState().open('host', `reference:${PAGE}`, PAGE_NAME));
    mountTracker();
    await flush(2);
    expect(host!.textContent, 'the table is still opening').toContain('Opening the table');
    expect(wins(), 'no window drawn').toHaveLength(0);
    await escape();
    expect(useWindowStore.getState().wins, 'the window the GM has not seen yet is still there').toHaveLength(1);
  }, 120_000);

  it('Escape in the GM screen\'s "Add to GM Screen" picker closes the picker and nothing else', async () => {
    mountTracker();
    await flush();
    act(() => trackerUi.showMain('gm'));
    await flush(1);
    const add = [...host!.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Add Reference'));
    expect(add, 'the empty GM screen offers Add Reference').toBeTruthy();
    click(add!);
    await flush(1);
    const input = [...document.querySelectorAll<HTMLInputElement>('input')].find((i) => (i.placeholder ?? '').startsWith('Search everything'));
    expect(input, 'the picker').toBeTruthy();
    expect(host!.textContent).toContain('Add to GM Screen');
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush(2);
    expect([...document.querySelectorAll<HTMLInputElement>('input')].some((i) => (i.placeholder ?? '').startsWith('Search everything')), 'the picker closed').toBe(false);
    expect(onLeave, 'the same press left the campaign').not.toHaveBeenCalled();
    expect(host!.querySelector('.campaign-tracker')).not.toBeNull();
  }, 120_000);
});
