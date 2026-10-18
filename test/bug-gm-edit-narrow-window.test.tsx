// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { computeSummary } from '../src/sheet/partySummary';
import type { SavedChar } from '../src/data/storage';
import type { CampaignMembership } from '../src/data/campaigns';
import type { PartyMember } from '../src/data/party';
import { useCombatStore } from '../tracker/src/store/combatStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { useLayoutStore } from '../tracker/src/store/layoutStore';
import { trackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';
import { useMemberViewer } from '../src/sheet/PartyMembers';
import { useIsMobile } from '../src/sheet/useIsMobile';

/**
 * PACKAGE H2 (2026-10-18): the GM narrows the window below phone width (720 px) while editing a
 * player's sheet. The campaigns page decided "is this a GM's screen?" from the LIVE viewport on every
 * render, so the narrowing swapped the editor out — the tracker (and the sheet over it) for the
 * phone's campaign view, the page-replacing editor for a read-only sheet — and the GM's unsent working
 * copy went with it, without a word. The edit session now holds the GM layout until the GM leaves the
 * sheet himself (through its own Update / Discard / Cancel question); the sheet itself just takes the
 * phone layout meanwhile.
 *
 * Every character here is synthetic.
 */

const srv = vi.hoisted(() => ({
  party: [] as PartyMember[],
  sheets: new Map<string, unknown>(),
}));

// A RELEASE build.
vi.mock('../src/integration/enabled', () => ({
  TRACKER_IN_CAMPAIGN: true,
  TEST_CAMPAIGNS_WITHOUT_LOGIN: false,
}));
vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'gm@example.com' }),
  signOut: async () => undefined,
}));
vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  currentUserId: async () => 'gm-1',
  fetchParty: async () => srv.party,
  fetchMemberSheet: async (_campaignId: string, charId: string) => srv.sheets.get(charId) ?? null,
  fetchMemberRow: async (_campaignId: string, charId: string) => ({
    sheet: (srv.sheets.get(charId) as SavedChar | undefined) ?? null,
    summary: undefined,
    read: true,
  }),
  fetchPendingGmEdits: async () => [],
  subscribeMemberSheet: () => () => undefined,
  subscribeParty: () => () => undefined,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  subscribeGmEdits: () => () => undefined,
  pushGmEdit: async () => ({ ok: true, value: null }),
}));
vi.mock('../src/data/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaigns')>()),
  fetchCampaignByCode: async () => ({
    ok: true,
    value: { id: 'camp-1', code: 'TESTCODE', ownerId: 'gm-1', name: 'The Salt Road', description: '', defaults: {} },
  }),
}));

const CAMPAIGN: CampaignMembership = { id: 'camp-1', code: 'TESTCODE', role: 'gm', name: 'The Salt Road' };

const buildOf = (name: string, level: number): BuildState => ({
  ...emptyBuild(),
  name,
  level,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'fighter',
  keyAbility: 'str',
});
function saved(id: string, name: string, level: number): SavedChar {
  const db = content();
  const build = buildOf(name, level);
  const character = buildCharacter(build, db);
  return { id, character, build, play: initialPlay(character, db) };
}
function publish(sc: SavedChar, ownerId: string): PartyMember {
  srv.sheets.set(sc.id, sc);
  return { ownerId, charId: sc.id, name: sc.character.name, summary: computeSummary(sc.character, content()) };
}

/**
 * A window whose width the test sets. Every `(max-width: Npx)` query answers from it, and every query
 * list told about a change fires its listeners — what a browser does when the window is resized.
 */
const screen = { width: 1280, lists: [] as { q: string; mql: { matches: boolean }; listeners: Set<() => void> }[] };
function stubMedia(): void {
  window.matchMedia = ((q: string) => {
    const max = /max-width:\s*(\d+)px/.exec(q);
    const listeners = new Set<() => void>();
    const mql = {
      get matches() {
        return max ? screen.width <= Number(max[1]) : false;
      },
      media: q,
      onchange: null,
      addListener: (l: () => void) => listeners.add(l),
      removeListener: (l: () => void) => listeners.delete(l),
      addEventListener: (_t: string, l: () => void) => listeners.add(l),
      removeEventListener: (_t: string, l: () => void) => listeners.delete(l),
      dispatchEvent: () => false,
    };
    screen.lists.push({ q, mql, listeners });
    return mql;
  }) as unknown as typeof window.matchMedia;
}
async function resizeTo(width: number): Promise<void> {
  screen.width = width;
  act(() => {
    for (const l of screen.lists) for (const fn of [...l.listeners]) fn();
  });
  await flush(3);
}

function stubFetch(): void {
  const files: Record<string, string> = {
    'core.json': 'public/core.json',
    'core-descriptions.json': 'public/core-descriptions.json',
  };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = files[String(url).split('/').pop() ?? ''];
    if (!path) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) as unknown, text: async () => '' };
  });
}

let live: Root | null = null;
let host: HTMLElement | null = null;

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
function render(el: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(el));
  return host;
}
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const q = <T extends Element = HTMLElement>(sel: string) => host?.querySelector<T>(sel) ?? null;
const btn = (label: string): HTMLElement => {
  const all = [...(host?.querySelectorAll('button') ?? [])];
  const el = all.find((b) => (b.textContent ?? '').trim().includes(label) || b.title === label || b.getAttribute('aria-label') === label);
  if (!el) throw new Error(`no button labelled "${label}"`);
  return el;
};
const dialog = () => document.querySelector<HTMLElement>('.confirm-modal');
const dialogTitle = () => dialog()?.querySelector('.info-title')?.textContent ?? null;
async function press(label: string): Promise<void> {
  const b = [...(dialog()?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === label);
  if (!b) throw new Error(`the dialog has no “${label}”`);
  click(b);
  await flush(3);
}
/** The open GM sheet's hero point is spent (with one, the first pip reads "Set hero points to 0"). */
const heroPointSpent = (scope: string) =>
  !!q(`${scope} button[aria-label="Set hero points to 1"]`) && !q(`${scope} button[aria-label="Set hero points to 0"]`);

beforeEach(() => {
  localStorage.clear();
  srv.party = [];
  srv.sheets.clear();
  screen.width = 1280;
  screen.lists = [];
  rememberCampaign(null);
  setOnCampaignsPage(false);
  trackerUi.reset();
  useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false });
  usePartyStore.setState({ parties: [], activePartyId: null });
  useLayoutStore.setState({ root: null, hoveredCid: null });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  stubMedia();
  stubFetch();
});
afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  for (const n of [...document.body.children]) n.remove();
  vi.unstubAllGlobals();
});

const PC_A = () => saved('char-a', 'Ayla Brightwood', 5);

describe('H2: narrowing the window below phone width never drops the GM’s unsent edits', () => {
  it('the tracker route: the sheet over the tracker stays, edit and all, and still asks before it goes', async () => {
    /*
     * MUTATION (run 2026-10-18): read the bare viewport again in CampaignsPage (drop `&& !gmSheetOpen`
     * from `const isPhone = …`) — the tracker unmounts on the resize, and this fails on
     * `the GM’s sheet is still open: expected null not to be null`.
     */
    srv.party = [publish(PC_A(), 'owner-a')];
    await import('../src/integration/CampaignTracker');
    await import('../src/integration/TrackerTools');
    const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    const el = render(
      <CampaignsPage
        content={content()}
        onClose={() => undefined}
        onOpenRoster={() => undefined}
        onOpenHomebrew={() => undefined}
        characters={[]}
        modes={{}}
        onSaveMode={() => undefined}
        onDeleteMode={() => undefined}
      />,
    );
    await flush();
    click(el.querySelector('.cmp-card-btn')!);
    await flush(6);
    expect(q('.campaign-tracker'), 'fixture: the campaign opened as the tracker').not.toBeNull();
    click(q('.party-grid .party-card')!);
    await flush(4);
    expect(q('.ct-sheet-full .gm-edit-tab'), 'fixture: the card opened the GM sheet').not.toBeNull();
    click(q('.ct-sheet-full button[aria-label="Set hero points to 0"]')!); // the GM spends their hero point
    await flush(2);
    expect(heroPointSpent('.ct-sheet-full'), 'fixture: the edit is on the working copy').toBe(true);

    await resizeTo(600); // the GM makes the window narrower than a phone

    expect(q('.ct-sheet-full .gm-edit-tab'), 'the GM’s sheet is still open').not.toBeNull();
    expect(q('.ct-sheet-full .gm-edit-tab')?.className, 'it takes the phone layout').toContain('is-mobile');
    expect(heroPointSpent('.ct-sheet-full'), 'the unsent edit is still on the working copy').toBe(true);

    // Leaving still asks — the working copy is alive, and dirty.
    click(btn('Back to tracker'));
    await flush(2);
    expect(dialogTitle()).toBe('Update before leaving?');
    await press('Discard changes');
    // Only now, the GM having left the sheet himself, does the page take the phone layout.
    expect(q('.ct-sheet-full')).toBeNull();
    expect(q('.campaign-tracker'), 'no table on a phone-width page once the sheet is closed').toBeNull();
  }, 180_000);

  it('the page-replacing route: the editor stays an editor — it never turns into a read-only sheet', async () => {
    /*
     * MUTATION (run 2026-10-18): render from the hook's live option again in useMemberViewer
     * (`if (options?.gmEdit && …)` in place of `viewing.gmEdit`) — the editor becomes the read-only
     * sheet on the resize, and this fails on `still the GM’s editor: expected null not to be null`.
     */
    /** The viewer as the campaigns page drives it: GM editing offered only above phone width. */
    function Viewer({ target }: { target: PartyMember }): ReactElement {
      const phone = useIsMobile();
      const { sheetEl, open } = useMemberViewer(content(), { gmEdit: !phone, roster: [] });
      const started = useRef(false);
      useEffect(() => {
        if (started.current) return;
        started.current = true;
        void open(CAMPAIGN.id, target.charId, target.ownerId);
      });
      return <div>{sheetEl}</div>;
    }
    const theirs = publish(PC_A(), 'owner-a');
    render(<Viewer target={theirs} />);
    await flush(4);
    expect(q('.party-viewer .gm-edit-tab'), 'fixture: the GM sheet opened').not.toBeNull();
    click(q('.party-viewer button[aria-label="Set hero points to 0"]')!);
    await flush(2);
    expect(heroPointSpent('.party-viewer'), 'fixture: the edit is on the working copy').toBe(true);

    await resizeTo(600);

    expect(q('.party-viewer .gm-edit-tab'), 'still the GM’s editor').not.toBeNull();
    expect(q('.party-viewer .ro-frame-tab'), 'never a read-only sheet').toBeNull();
    expect(heroPointSpent('.party-viewer'), 'the unsent edit is still on the working copy').toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush(2);
    expect(dialogTitle(), 'leaving still asks').toBe('Update before leaving?');
    await press('Cancel');
    expect(q('.party-viewer .gm-edit-tab')).not.toBeNull();
  }, 180_000);

  it('a sheet opened at phone width is read-only, as before', async () => {
    screen.width = 600;
    function Viewer({ target }: { target: PartyMember }): ReactElement {
      const phone = useIsMobile();
      const { sheetEl, open } = useMemberViewer(content(), { gmEdit: !phone, roster: [] });
      const started = useRef(false);
      useEffect(() => {
        if (started.current) return;
        started.current = true;
        void open(CAMPAIGN.id, target.charId, target.ownerId);
      });
      return <div>{sheetEl}</div>;
    }
    render(<Viewer target={publish(PC_A(), 'owner-a')} />);
    await flush(4);
    expect(q('.party-viewer .ro-frame-tab'), 'a phone opens a teammate read-only').not.toBeNull();
    expect(q('.party-viewer .gm-edit-tab')).toBeNull();
  }, 180_000);
});
