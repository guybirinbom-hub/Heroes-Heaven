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

/**
 * THE GM SEARCH'S POPUP, ON THE SURFACE IT IS FOR (Campaigns -> a table -> Search).
 *
 * Two things every description popup has were missing there:
 *  - the favourite star. Only the character sheet and the Builder provide a pin target, so the popup
 *    CampaignTracker mounts had none — and test/archive-coverage.test.tsx only saw a star because it
 *    wrapped the modal in a provider the GM surface did not have. The GM's pinned references are the
 *    GM screen, so the star there pins the page to it (a `host` pane tab) and the pane draws the page;
 *  - the page's Archives of Nethys link. The tree's own title link is suppressed as a self-reference,
 *    so no popup linked out at all; scripts/stamp-ast-urls.mjs puts each page's address on its tree.
 * Mounted on the local table (no account), the way a GM without one opens it.
 */

vi.mock('../src/integration/enabled', () => ({ TRACKER_IN_CAMPAIGN: true, TEST_CAMPAIGNS_WITHOUT_LOGIN: false }));
vi.mock('../src/data/useAuth', () => {
  const AUTH = { status: 'disabled', session: null, email: null };
  return { useAuth: () => AUTH, signOut: async () => undefined };
});

/* Loaded here, under the mocks above, not inside the test: transforming the whole tracker counted against
 * the test's own time budget. */
const { CampaignTracker } = await import('../src/integration/CampaignTracker');

const LOCAL_TABLE: CampaignMembership = { id: 'local', code: '', role: 'gm', name: 'Local table', description: '', local: true };
const PAGE = 'breachhill-outpost-of-secrets';
/* Each file is read and parsed ONCE: gunzipping reference.json.gz again on every fetch put this test at
 * 3.4 s alone and past the 5 s default under a 36-file run (the refuter measured one timeout in two). */
const parsed = new Map<string, unknown>();
const once = (file: string, read: () => string) => parsed.get(file) ?? parsed.set(file, JSON.parse(read())).get(file);
const trees = (bucket: string) => once(bucket, () => gunzipSync(readFileSync(`public/ast/${bucket}.json.gz`)).toString('utf8')) as Record<string, { url?: string }>;
const astIndex = () => once('ast-index', () => readFileSync('public/ast-index.json', 'utf8'));

let live: Root | null = null;
let host: HTMLElement | null = null;

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
function hostTabs(n: PaneNode | null): string[] {
  if (!n) return [];
  return n.kind === 'leaf' ? n.tabs.filter((t) => t.type === 'host').map((t) => t.ref) : [...hostTabs(n.a), ...hostTabs(n.b)];
}

beforeEach(() => {
  localStorage.clear();
  trackerUi.reset();
  useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null });
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
  vi.unstubAllGlobals();
});

describe('the GM Search popup', () => {
  // A whole CampaignTracker mount: the same 120 s budget as the other full-surface mounts
  // (bug-campaign-leave, bug-owner-2026-09-16-seam), not vitest's 5 s default, which suite load alone can use up.
  it('keeps its star — which pins the page to the GM screen — and links to the page on the Archives', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    live = createRoot(host);
    act(() => live!.render(
      <CampaignTracker m={LOCAL_TABLE} content={content()} onOpenSettings={() => undefined} onLeave={() => undefined} onViewMember={() => undefined} />,
    ));
    await flush();

    act(() => trackerUi.setSearch(true));
    await flush();
    const input = document.querySelector<HTMLInputElement>('input[placeholder^="Search everything"]');
    expect(input, 'the host-mode Search').toBeTruthy();
    type(input!, 'Breachhill');
    await until(() => [...document.querySelectorAll('[data-row]')].some((r) => r.textContent?.includes('Breachhill, Outpost of Secrets')), 'the article is a Search row');
    click([...document.querySelectorAll('[data-row]')].find((r) => r.textContent?.includes('Breachhill, Outpost of Secrets'))!);
    await until(() => !!document.querySelector('.ast-modal') && (document.body.textContent ?? '').includes('demographics of Breachill'), 'the page opens in the design popup');

    // The Archives link: the page's own address, stamped on its tree.
    const url = trees('reference')[PAGE].url!;
    expect(url).toMatch(/^\/Articles\.aspx\?ID=\d+$/);
    expect(document.querySelector<HTMLAnchorElement>('.ast-modal .ast-aon')?.href).toBe(`https://2e.aonprd.com${url}`);

    // The star, provided by the GM surface itself (no test provider here).
    const star = document.querySelector<HTMLButtonElement>('.ast-modal .info-star');
    expect(star, 'every description popup keeps the favourite star').toBeTruthy();
    expect(star!.title).toBe('Favorite — add to GM screen');
    click(star);
    expect(hostTabs(useGmLayoutStore.getState().root)).toEqual([`reference:${PAGE}`]);
    await flush(1);
    expect(document.querySelector('.ast-modal .info-star')?.classList.contains('on')).toBe(true);

    // …and the GM screen draws the pinned page itself.
    click(document.querySelector('.ast-modal .picker-close'));
    act(() => trackerUi.showMain('gm'));
    await until(() => (host!.textContent ?? '').includes('demographics of Breachill'), 'the pinned page on the GM screen');

    // The star takes it off again.
    act(() => trackerUi.setSearch(true));
    await flush();
    type(document.querySelector<HTMLInputElement>('input[placeholder^="Search everything"]')!, 'Breachhill');
    await until(() => [...document.querySelectorAll('[data-row]')].some((r) => r.textContent?.includes('Breachhill, Outpost of Secrets')), 'the row again');
    click([...document.querySelectorAll('[data-row]')].find((r) => r.textContent?.includes('Breachhill, Outpost of Secrets'))!);
    await until(() => !!document.querySelector('.ast-modal .info-star.on'), 'the popup knows the page is pinned');
    click(document.querySelector('.ast-modal .info-star'));
    expect(hostTabs(useGmLayoutStore.getState().root)).toEqual([]);
  }, 120_000);
});
