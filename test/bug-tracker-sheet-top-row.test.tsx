// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { computeSummary } from '../src/sheet/partySummary';
import { ROSTER_KEY, type SavedChar } from '../src/data/storage';
import type { CampaignMembership } from '../src/data/campaigns';
import type { PartyMember } from '../src/data/party';
import { useCombatStore } from '../tracker/src/store/combatStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { useLayoutStore } from '../tracker/src/store/layoutStore';
import { trackerUi, useTrackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';
import { useMemberViewer } from '../src/sheet/PartyMembers';

/**
 * THE OWNER, 2026-10 (his online list, item 4) — "when editing a player sheet from the tracker I don't
 * want to see the top row; leaving the sheet returns to the tracker."
 *
 * His answers: hiding the whole campaign title bar (tools, timer, Search / Party / GM Screen included)
 * is "fine"; "keep the gm editing strip".
 *
 *  (a) While a player's sheet covers the tracker, the campaign's title bar is HIDDEN (not unmounted —
 *      the timer and tools keep running) and comes back however the sheet closes: its "← Tracker",
 *      Escape, the tracker's Party request. The builder the sheet opens keeps it hidden.
 *  (b) The flag behind it (trackerUi.sheetOpen) is a REPORT and never outlives the view: a trip to the
 *      campaign's settings or out of the campaign leaves no hidden bar behind.
 *  (c) The sheet carries ONE labelled way back, first in its identity row, which still asks before it
 *      throws an unsent edit away; and the builder asks too (Discard / Cancel only).
 *  (d) The page-replacing sheet route asks on Escape like its arrow always did.
 *  (e) Your OWN card in the tracker opens your own sheet with the same "← Tracker", which brings you
 *      back to the campaign — and only that visit gets it.
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

/** Publish a character to the mocked server, exactly as the player's app would. */
function publish(sc: SavedChar, ownerId: string): PartyMember {
  srv.sheets.set(sc.id, sc);
  return { ownerId, charId: sc.id, name: sc.character.name, summary: computeSummary(sc.character, content()) };
}

function stubMedia(): void {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
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
const escape = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

const q = <T extends Element = HTMLElement>(sel: string) => host?.querySelector<T>(sel) ?? null;
const qq = (sel: string) => [...(host?.querySelectorAll(sel) ?? [])];
/** The campaign page's title bar — the "top row" the owner asked to lose while a sheet is open. */
const titleBar = () => q<HTMLElement>('.cmp-page > .chrome');

const btn = (label: string): HTMLElement => {
  const all = [...(host?.querySelectorAll('button') ?? [])];
  const el = all.find((b) => (b.textContent ?? '').trim().includes(label) || b.title === label);
  if (!el) throw new Error(`no button labelled "${label}" — found: ${all.map((b) => JSON.stringify((b.textContent ?? '').trim() || b.title)).join(', ')}`);
  return el;
};

const dialog = () => document.querySelector<HTMLElement>('.confirm-modal');
const dialogTitle = () => dialog()?.querySelector('.info-title')?.textContent ?? null;
const dialogLabels = () => [...(dialog()?.querySelectorAll('.confirm-actions button') ?? [])].map((b) => (b.textContent ?? '').trim());
async function press(label: string): Promise<void> {
  const b = [...(dialog()?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === label);
  if (!b) throw new Error(`the dialog has no “${label}” — it offers: ${dialogLabels().join(', ') || '(no dialog at all)'}`);
  click(b);
  await flush(3);
}

/** trackerUi.sheetOpen, read the way a component reads it — the store deliberately has no getter. */
function sheetOpenNow(): boolean {
  const probeHost = document.createElement('div');
  document.body.appendChild(probeHost);
  const probeRoot = createRoot(probeHost);
  const Probe = () => <span data-open={String(useTrackerUi().sheetOpen)} />;
  act(() => probeRoot.render(<Probe />));
  const open = probeHost.querySelector('span')?.getAttribute('data-open') === 'true';
  act(() => probeRoot.unmount());
  probeHost.remove();
  return open;
}

beforeEach(() => {
  localStorage.clear();
  srv.party = [];
  srv.sheets.clear();
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

/** The campaigns page, with the campaign opened — the tracker in the body, its tools in the title bar. */
async function openCampaign(): Promise<HTMLElement> {
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
  expect(el.querySelector('.campaign-tracker'), 'fixture: the campaign opened as the tracker').not.toBeNull();
  expect(titleBar()?.hidden, 'fixture: the title bar starts visible').toBe(false);
  return el;
}

/** A dashboard card → the GM's sheet over the tracker. */
async function openSheet(): Promise<void> {
  click(q('.party-grid .party-card')!);
  await flush(4);
  expect(q('.ct-sheet-full .ws-app'), 'fixture: the card opened the GM sheet').not.toBeNull();
}

describe('(a) no top row while a player’s sheet covers the tracker', () => {
  it('hides the campaign title bar while the sheet is open — the strip stays — and "← Tracker" brings it back', async () => {
    /*
     * MUTATIONS (run 2026-10-09):
     *  • `header.hidden = Math.random() > 2` in TrackerTools' sheetOpen effect — the bar never hides:
     *    `AssertionError: expected false to be true` (here, in the three legs below, and in
     *    test/bug-campaign-leave.test.tsx);
     *  • the trailing "Back to campaign" arrow rendered in the tracker again (`!inTracker ||` made true
     *    in CharacterSheet's GM set) — two ways back: `expected [ <button …> ] to have a length of +0`.
     */
    srv.party = [publish(PC_A(), 'owner-a')];
    await openCampaign();
    expect(q('.cmp-page > .chrome .tracker-tools')).not.toBeNull();

    await openSheet();
    // The bar is HIDDEN, not gone: the turn timer and the tools are still mounted inside it.
    expect(titleBar()!.hidden).toBe(true);
    expect(q('.cmp-page > .chrome .tracker-tools')).not.toBeNull();
    expect(sheetOpenNow()).toBe(true);
    // "keep the gm editing strip"
    expect(q('.ct-sheet-full .gm-edit-tab')?.textContent).toContain('GM editing Ayla Brightwood');

    // ONE way back, labelled, first in the identity row; the trailing unlabelled arrow is gone.
    const identity = q('.ct-sheet-full .identity')!;
    expect(identity.firstElementChild?.getAttribute('aria-label')).toBe('Back to tracker');
    expect(identity.firstElementChild?.textContent?.trim()).toBe('Tracker');
    expect(qq('.ct-sheet-full button[aria-label="Back to tracker"]')).toHaveLength(1);
    expect(qq('.ct-sheet-full button[aria-label="Back to campaign"]')).toHaveLength(0);
    // The desktop app draws its own title bar, and both bars above are hidden: this row is the drag
    // region now, padded so the window controls (WindowControls renders null on the web) sit flush.
    expect(identity.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(identity.style.getPropertyValue('--chrome-pad-y')).toBe('10px');

    click(btn('Back to tracker'));
    await flush(3);
    expect(q('.ct-sheet-full')).toBeNull();
    expect(q('.party-grid .party-card')).not.toBeNull(); // back where the GM came from
    expect(titleBar()!.hidden).toBe(false);
    expect(sheetOpenNow()).toBe(false);
  }, 180_000);

  it('brings the bar back when Escape closes the sheet, and when the tracker asks for the party', async () => {
    srv.party = [publish(PC_A(), 'owner-a')];
    await openCampaign();

    await openSheet();
    expect(titleBar()!.hidden).toBe(true);
    escape();
    await flush(3);
    expect(q('.ct-sheet-full')).toBeNull();
    expect(titleBar()!.hidden).toBe(false);
    expect(q('.campaign-tracker')).not.toBeNull(); // one press peeled the sheet, not the campaign

    await openSheet();
    expect(titleBar()!.hidden).toBe(true);
    // Party / GM Screen / a turn change all arrive as a paneRequest.
    act(() => trackerUi.showMain('party'));
    await flush(3);
    expect(q('.ct-sheet-full')).toBeNull();
    expect(titleBar()!.hidden).toBe(false);
  }, 180_000);

  it('keeps the bar hidden while the builder is open, and asks — Discard / Cancel only — before Escape throws its work away', async () => {
    /*
     * MUTATION (run 2026-10-09): disable the `if (editing) { … }` block at the top of GmEditSheet's
     * confirmLeave (`if (editing && Math.random() > 2)`) — Escape then closes the builder AND the
     * sheet with no dialog at all, the silent loss the report found, and this fails on
     *   AssertionError: expected null to be 'Leave the builder?'
     */
    srv.party = [publish(PC_A(), 'owner-a')];
    await openCampaign();
    await openSheet();

    click(q('.ct-sheet-full button[aria-label="Edit in builder"]')!);
    await flush(4);
    expect(q('.ct-sheet-full .builder')).not.toBeNull();
    expect(q('.ct-sheet-full .ws-app')).toBeNull();
    expect(titleBar()!.hidden).toBe(true); // the builder is in the same layer, so the bar stays down
    expect(sheetOpenNow()).toBe(true);

    escape();
    await flush(2);
    expect(dialogTitle()).toBe('Leave the builder?');
    // Never "Update player": the builder's unsaved state is not the working copy, so it would push the
    // wrong one.
    expect(dialogLabels()).toEqual(['Discard changes', 'Cancel']);
    await press('Cancel');
    expect(q('.ct-sheet-full .builder')).not.toBeNull(); // still building
    expect(titleBar()!.hidden).toBe(true);

    escape();
    await flush(2);
    await press('Discard changes');
    expect(q('.ct-sheet-full')).toBeNull();
    expect(titleBar()!.hidden).toBe(false);
  }, 180_000);
});

describe('(b) the flag never outlives the view', () => {
  it('is down on the campaign’s settings page, after coming back, and after leaving the campaign', async () => {
    /*
     * MUTATION (run 2026-10-09): drop `return () => trackerUi.setSheetOpen(false);` from the sheetOpen
     * effect in src/integration/CampaignTracker.tsx — the settings route unmounts the tracker with the
     * sheet open, nothing clears the report, and this fails on
     *   AssertionError: expected true to be false      ← sheetOpenNow() on the settings page
     */
    srv.party = [publish(PC_A(), 'owner-a')];
    const el = await openCampaign();
    await openSheet();
    expect(sheetOpenNow()).toBe(true);

    // The tools' "Campaign" button: the tracker (and the sheet with it) unmounts — the sheet is clean,
    // so nothing asks.
    act(() => trackerUi.requestCampaignSettings());
    await flush(4);
    expect(el.querySelector('.campaign-tracker')).toBeNull();
    expect(el.textContent).toContain('Share code');
    expect(sheetOpenNow()).toBe(false);
    expect(titleBar()!.hidden).toBe(false);

    // Back into the campaign: the bar is there, and the board is.
    click(el.querySelector('.hb-back')!);
    await flush(4);
    expect(el.querySelector('.campaign-tracker')).not.toBeNull();
    expect(titleBar()!.hidden).toBe(false);
    expect(sheetOpenNow()).toBe(false);

    // And out of the campaign altogether: Escape peels the sheet, the next one leaves.
    await openSheet();
    escape();
    await flush(3);
    escape();
    await flush(4);
    expect(el.querySelector('.campaign-tracker')).toBeNull();
    expect(el.textContent).toContain('Campaigns you');
    expect(sheetOpenNow()).toBe(false);
    expect(titleBar()!.hidden).toBe(false);
  }, 180_000);

  it('makes `hidden` stick in the stylesheet, and lets the strips size to their own text', () => {
    // jsdom applies no stylesheet: `[hidden]` alone loses to `.chrome { display: flex }`, so the rule
    // that makes it stick is asserted where it lives.
    const css = readFileSync('src/integration/campaign-tracker.css', 'utf8');
    const rule = (sel: string) =>
      new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}').exec(css)?.[0] ?? '';
    expect(rule('.cmp-page > .chrome[hidden]')).toMatch(/display:\s*none/);
    // The old `.ct-sheet-full > *` gave the "saved and waiting" strip an equal share of the height
    // with the sheet after every Update. Only the sheet and the builder grow now.
    expect(css).not.toMatch(/\.ct-sheet-full > \*/);
    expect(rule('.ct-sheet-full > .builder')).toMatch(/flex:\s*1/);
    expect(css).toMatch(/\.ct-sheet-full > \.ws-app,\s*\.ct-sheet-full > \.builder\s*\{/);
  });
});

describe('(c) the way back still asks', () => {
  it('"← Tracker" with an unsent edit asks Update / Discard / Cancel, and Cancel keeps the sheet', async () => {
    srv.party = [publish(PC_A(), 'owner-a')];
    await openCampaign();
    await openSheet();

    const pip = q<HTMLButtonElement>('.ct-sheet-full button[aria-label^="Set hero points to"]');
    expect(pip, 'fixture: the GM sheet can be edited').not.toBeNull();
    click(pip!);
    await flush(2);

    click(btn('Back to tracker'));
    await flush(2);
    expect(dialogTitle()).toBe('Update before leaving?');
    expect(dialogLabels()).toEqual(['Update player', 'Discard changes', 'Cancel']);
    await press('Cancel');
    expect(q('.ct-sheet-full .ws-app')).not.toBeNull();
    expect(titleBar()!.hidden).toBe(true);

    click(btn('Back to tracker'));
    await flush(2);
    await press('Discard changes');
    expect(q('.ct-sheet-full')).toBeNull();
    expect(titleBar()!.hidden).toBe(false);
  }, 180_000);
});

describe('(d) the page-replacing sheet route', () => {
  /** The viewer the campaigns page uses when the tracker has no sheet for a member yet. */
  function Viewer({ open: target }: { open: PartyMember }): ReactElement {
    const { sheetEl, open } = useMemberViewer(content(), { gmEdit: true, roster: [] });
    const started = useRef(false);
    useEffect(() => {
      if (started.current) return;
      started.current = true;
      void open(CAMPAIGN.id, target.charId, target.ownerId);
    });
    return <div>{sheetEl}</div>;
  }

  it('asks before Escape throws an unsent GM edit away, as its back arrow does', async () => {
    /*
     * MUTATION (run 2026-10-09): make useMemberViewer's back handler (src/sheet/PartyMembers.tsx) skip
     * the sheet's handle — `const gm = gmSheetRef.current && null;`, i.e. the old
     * `useBackHandler(!!viewing, () => setViewing(null))` — Escape then drops the working copy with no
     * prompt, and this fails on
     *   AssertionError: expected null to be 'Update before leaving?'
     */
    const theirs = publish(PC_A(), 'owner-a');
    render(<Viewer open={theirs} />);
    await flush(4);
    expect(q('.party-viewer .gm-edit-tab'), 'fixture: the GM sheet opened').not.toBeNull();

    const pip = q<HTMLButtonElement>('.party-viewer button[aria-label^="Set hero points to"]');
    expect(pip, 'fixture: the GM sheet can be edited').not.toBeNull();
    click(pip!);
    await flush(2);

    escape();
    await flush(2);
    expect(dialogTitle()).toBe('Update before leaving?');
    await press('Cancel');
    expect(q('.party-viewer .ws-app')).not.toBeNull(); // the working copy is still here

    escape();
    await flush(2);
    await press('Discard changes');
    expect(q('.party-viewer')).toBeNull();
  }, 180_000);
});

describe('(e) your own card in the tracker', () => {
  it('opens your own sheet with "← Tracker", which brings you back to the campaign — and only that visit has it', async () => {
    /*
     * MUTATIONS (run 2026-10-09):
     *  • `setOwnFromTracker(fromTracker ? null : null)` in App's CampaignsPage onOpenOwn — no
     *    "← Tracker" on the own sheet: `AssertionError: expected null to be 'Back to tracker'`;
     *  • the clearing effect in src/App.tsx made a no-op — the sheet opened from the roster afterwards
     *    still offers it: `AssertionError: expected [ …(1) ] to have a length of +0 but got 1`.
     */
    const mine = saved('char-me', 'Ilsabet Corrow', 3);
    localStorage.setItem(ROSTER_KEY, JSON.stringify([mine]));
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    srv.party = [publish(mine, 'gm-1'), publish(PC_A(), 'owner-a')];
    const { setPref } = await import('../src/data/prefs');
    setPref('startupScreen', 'characters');
    await import('../src/integration/CampaignTracker');
    await import('../src/integration/TrackerTools');
    const { default: App } = await import('../src/App');
    render(<App />);
    await flush(8);

    click(btn('Menu'));
    await flush(1);
    click(btn('Campaigns'));
    await flush(4);
    click(q('.cmp-card-btn')!);
    await flush(6);
    expect(q('.campaign-tracker'), 'fixture: in the campaign').not.toBeNull();

    const ownCard = () =>
      qq('.party-grid .party-card').find((c) => (c.querySelector('.party-card-name')?.textContent ?? '').includes('Ilsabet Corrow'));
    expect(ownCard(), 'fixture: the GM’s own card is on the dashboard').toBeTruthy();
    click(ownCard()!);
    await flush(6);

    // Your own sheet, not the GM editor of it (test/bug-own-sheet-from-campaign.test.tsx) …
    expect(q('.cmp-page')).toBeNull();
    expect(q('.gm-edit-tab')).toBeNull();
    expect(q('.char-name-text')?.textContent).toBe('Ilsabet Corrow');
    // … led by the same one way back.
    expect(q('.identity')!.firstElementChild?.getAttribute('aria-label')).toBe('Back to tracker');

    click(btn('Back to tracker'));
    await flush(8);
    expect(q('.cmp-page')).not.toBeNull();
    expect(q('.campaign-tracker'), 'the campaign reopened, not the list').not.toBeNull();
    expect(titleBar()!.textContent).toContain('The Salt Road');

    // Again from the tracker, then away through the menu: the sheet reached from the roster is an
    // ordinary sheet.
    click(ownCard()!);
    await flush(6);
    expect(qq('button[aria-label="Back to tracker"]')).toHaveLength(1);
    click(btn('Menu'));
    await flush(1);
    click(btn('Characters'));
    await flush(4);
    click(q('.rcard-open')!);
    await flush(4);
    expect(q('.char-name-text')?.textContent).toBe('Ilsabet Corrow');
    expect(qq('button[aria-label="Back to tracker"]')).toHaveLength(0);
  }, 240_000);
});
