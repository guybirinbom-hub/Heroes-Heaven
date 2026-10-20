// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { computeSummary } from '../src/sheet/partySummary';
import { ROSTER_KEY, loadHomebrewItems, saveHomebrewItem, type SavedChar } from '../src/data/storage';
import { CORE_BOOKS, storedSources } from '../src/rules/sources';
import type { ContentDatabase, Item, ModeDef } from '../src/rules/types';
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
  /** Characters the tracker's own sheet feed does not have (yet): their card falls through to the
   *  page's loader (useMemberViewer) — the page-replacing GM sheet. */
  trackerMiss: new Set<string>(),
}));

// A RELEASE build.
vi.mock('../src/integration/enabled', () => ({
  TRACKER_IN_CAMPAIGN: true,
  TEST_CAMPAIGNS_WITHOUT_LOGIN: false,
}));

// The DESKTOP app's window controls. The real one renders nothing outside Tauri (isDesktopApp), which
// would let every assertion about where they sit pass on an empty tree; this stand-in renders the same
// `.chrome-btns` group wherever the real one is mounted.
vi.mock('../src/sheet/WindowControls', () => ({
  WindowControls: () => (
    <div className="chrome-btns" data-test="window-controls">
      <button type="button" className="chrome-btn" aria-label="Minimize" />
      <button type="button" className="chrome-btn" aria-label="Maximize" />
      <button type="button" className="chrome-btn close" aria-label="Close" />
    </div>
  ),
}));

vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'gm@example.com' }),
  signOut: async () => undefined,
}));

vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  currentUserId: async () => 'gm-1',
  fetchParty: async () => srv.party,
  fetchMemberSheet: async (_campaignId: string, charId: string) => (srv.trackerMiss.has(charId) ? null : srv.sheets.get(charId) ?? null),
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
  srv.trackerMiss.clear();
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
async function openCampaign(
  writers?: { onDeleteMode?: (id: string) => void; onSaveMode?: (m: ModeDef) => void; onCreateItem?: (it: Item) => void },
  db: ContentDatabase = content(),
): Promise<HTMLElement> {
  await import('../src/integration/CampaignTracker');
  await import('../src/integration/TrackerTools');
  const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
  localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
  const el = render(
    <CampaignsPage
      content={db}
      onCreateItem={writers?.onCreateItem}
      onClose={() => undefined}
      onOpenRoster={() => undefined}
      onOpenHomebrew={() => undefined}
      characters={[]}
      modes={{}}
      onSaveMode={writers?.onSaveMode ?? (() => undefined)}
      onDeleteMode={writers?.onDeleteMode ?? (() => undefined)}
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
    // region now (the window controls are the next test's).
    expect(identity.hasAttribute('data-tauri-drag-region')).toBe(true);

    click(btn('Back to tracker'));
    await flush(3);
    expect(q('.ct-sheet-full')).toBeNull();
    expect(q('.party-grid .party-card')).not.toBeNull(); // back where the GM came from
    expect(titleBar()!.hidden).toBe(false);
    expect(sheetOpenNow()).toBe(false);
  }, 180_000);

  it('pins the window controls to the corner of the sheet layer, above the GM strip, and lets the strip drag the window', async () => {
    /*
     * U1 (2026-10-20): the desktop app's minimise / maximise / close sat ~23 px too low on a player's
     * sheet over the tracker — they were rendered inside the identity row, BELOW the "GM editing X"
     * strip (and below any pending / live banner GmEditSheet draws first). jsdom has no layout, so
     * this pins the structure that puts them in the corner and the stylesheet rule that does it.
     * Fails on b8f8a6e: `.ct-sheet-full > .chrome-btns` is null (they were in `.identity`).
     */
    srv.party = [publish(PC_A(), 'owner-a')];
    await openCampaign();
    await openSheet();

    const full = q('.ct-sheet-full')!;
    // (The sheet's own `.chrome` title bar still holds a set, hidden with it by `.ct-sheet-full .chrome`.)
    const ctl = qq('.ct-sheet-full .chrome-btns').filter((e) => !e.closest('.chrome'));
    expect(ctl, 'one set of window controls on the sheet layer').toHaveLength(1);
    expect(ctl[0].parentElement, 'a direct child of the layer, not of the identity row').toBe(full);
    expect(qq('.ct-sheet-full .identity .chrome-btns')).toHaveLength(0);
    // The strip is the sheet's top edge now: it drags the window like the identity row.
    expect(q('.ct-sheet-full .gm-edit-tab')!.hasAttribute('data-tauri-drag-region')).toBe(true);
    // The old inline padding override (it cancelled only the row's own padding) is gone.
    expect(q('.ct-sheet-full .identity')!.style.getPropertyValue('--chrome-pad-y')).toBe('');

    const css = readFileSync('src/integration/campaign-tracker.css', 'utf8');
    const rule = /\.ct-sheet-full > \.chrome-btns\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/top:\s*0/);
    expect(rule).toMatch(/right:\s*0/);
    // Above the GM strip, whose z-index is 6 (src/sheet.css .gm-edit-tab).
    const z = Number(/z-index:\s*(\d+)/.exec(rule)?.[1] ?? 0);
    const stripZ = Number(/\.gm-edit-tab\s*\{[^}]*z-index:\s*(\d+)/.exec(readFileSync('src/sheet.css', 'utf8'))?.[1] ?? 99);
    expect(z).toBeGreaterThan(stripZ);
    // …and the identity row (with the strips) keeps its buttons out from under them.
    expect(css).toMatch(/\.ct-sheet-full:has\(> \.chrome-btns\) \.identity\s*\{[^}]*padding-right:/);

    // Closed, the layer takes its controls with it.
    click(btn('Back to tracker'));
    await flush(3);
    expect(qq('.ct-sheet-full .chrome-btns')).toHaveLength(0);
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

describe('(f) the sheet over the tracker writes homebrew through the page’s writers', () => {
  it('a mode the GM deletes there reaches CampaignsPage’s onDeleteMode (App’s persisting one)', async () => {
    /*
     * U3 (2026-10-20) wiring: test/bug-gm-edit-homebrew-persists.test.tsx proves GmEditSheet calls the
     * writers it is given; this proves the tracker hands it the page's. MUTATION (run 2026-10-20): drop
     * `onDeleteMode={homebrew?.onDeleteMode}` from CampaignTracker's <GmEditSheet> —
     *   AssertionError: expected [] to have a length of 1 but got +0
     */
    const deleted: string[] = [];
    srv.party = [publish(PC_A(), 'owner-a')];
    await openCampaign({ onDeleteMode: (id) => deleted.push(id) });
    await openSheet();

    click(q('.ct-sheet-full .add-btn')!);
    await flush(2);
    const tab = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Modes');
    expect(tab, 'fixture: the Modes tab').toBeTruthy();
    click(tab!);
    await flush(2);
    const edit = document.querySelector('button.mode-edit[aria-label="Edit"]');
    expect(edit, 'fixture: the fixture database has a saved mode to edit').not.toBeNull();
    click(edit!);
    await flush(2);
    click(document.querySelector('button.me-delete')!);
    await flush(2);
    expect(deleted).toHaveLength(1);
  }, 180_000);

  /*
   * Checker finding (2026-10-20): mode SAVE had no wiring test — `onSaveMode={homebrew?.onSaveMode}` in
   * CampaignTracker and `onSaveMode={options?.homebrew?.onSaveMode}` in PartyMembers could each be
   * dropped with every test green, and a mode the GM saved on a player's sheet lasted one session again.
   * MUTATIONS (run 2026-10-20): drop the CampaignTracker line → the tracker-route test; drop the
   * PartyMembers line → the page-replacing test (`expected [] to have a length of 1 but got +0`).
   */
  /** In the open GM sheet (under `scope`): Add → Modes → a saved mode's Edit → Save mode. */
  async function saveModeFromSheet(scope: string): Promise<void> {
    const add = q(`${scope} .add-btn`);
    expect(add, `fixture: the rail's "Add" in ${scope}`).not.toBeNull();
    click(add!);
    await flush(2);
    const byText = (t: string) => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t);
    expect(byText('Modes'), 'fixture: the Modes tab').toBeTruthy();
    click(byText('Modes')!);
    await flush(2);
    const edit = document.querySelector('button.mode-edit[aria-label="Edit"]');
    expect(edit, 'fixture: the fixture database has a saved mode to edit').not.toBeNull();
    click(edit!);
    await flush(2);
    expect(byText('Save mode'), 'fixture: the mode editor').toBeTruthy();
    click(byText('Save mode')!);
    await flush(2);
  }

  it('a mode the GM saves there reaches CampaignsPage’s onSaveMode (App’s persisting one)', async () => {
    const saved: ModeDef[] = [];
    srv.party = [publish(PC_A(), 'owner-a')];
    await openCampaign({ onSaveMode: (m) => saved.push(m) });
    await openSheet();
    await saveModeFromSheet('.ct-sheet-full');
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBeTruthy();
  }, 180_000);

  it('…and from the page-replacing GM sheet', async () => {
    const saved: ModeDef[] = [];
    srv.party = [publish(PC_A(), 'owner-a')];
    srv.trackerMiss.add('char-a');
    await openCampaign({ onSaveMode: (m) => saved.push(m) });
    openSheetFor('Ayla Brightwood');
    await flush(6);
    expect(q('.ct-sheet-full'), 'fixture: not the tracker’s sheet').toBeNull();
    expect(q('.party-viewer .gm-edit-tab'), 'fixture: the page-replacing GM sheet').not.toBeNull();
    await saveModeFromSheet('.party-viewer');
    expect(saved).toHaveLength(1);
  }, 180_000);

  it('…and a mode the GM deletes on the page-replacing GM sheet reaches CampaignsPage’s onDeleteMode, with its id', async () => {
    /*
     * Fix-up F1 (2026-10-20): `onDeleteMode={options?.homebrew?.onDeleteMode}` in useMemberViewer
     * (src/sheet/PartyMembers.tsx) had no test — dropped, a mode the GM deleted on that sheet came back
     * next session. MUTATION (run 2026-10-20): drop that line → `the page's writer hears the delete:
     * expected [] to have a length of 1 but got +0`.
     */
    const deleted: string[] = [];
    srv.party = [publish(PC_A(), 'owner-a')];
    srv.trackerMiss.add('char-a');
    await openCampaign({ onDeleteMode: (id) => deleted.push(id) });
    openSheetFor('Ayla Brightwood');
    await flush(6);
    expect(q('.ct-sheet-full'), 'fixture: not the tracker’s sheet').toBeNull();
    expect(q('.party-viewer .gm-edit-tab'), 'fixture: the page-replacing GM sheet').not.toBeNull();

    click(q('.party-viewer .add-btn')!);
    await flush(2);
    const tab = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Modes');
    expect(tab, 'fixture: the Modes tab').toBeTruthy();
    click(tab!);
    await flush(2);
    const edit = document.querySelector('button.mode-edit[aria-label="Edit"]');
    expect(edit, 'fixture: the fixture database has a saved mode to edit').not.toBeNull();
    click(edit!);
    await flush(2);
    // The mode the editor opened on: its name, and the database ids that carry that name.
    const name = document.querySelector<HTMLInputElement>('.mode-editor .me-field input')?.value ?? '';
    expect(name, 'fixture: the editor shows the mode’s name').not.toBe('');
    const idsNamed = Object.values(content().modes).filter((m) => m.name === name).map((m) => m.id);
    click(document.querySelector('button.me-delete')!);
    await flush(2);
    expect(deleted, 'the page’s writer hears the delete').toHaveLength(1);
    expect(idsNamed, 'the id handed over is the edited mode’s').toContain(deleted[0]);
  }, 180_000);

  /*
   * Checker finding (2026-10-20): the ITEM writer's wiring had no test — App's `onCreateItem=
   * {addCustomItem}` on CampaignsPage, CampaignTracker's `onCreateItem={homebrew?.onCreateItem}` and
   * useMemberViewer's three lines could each be dropped with every test green (the props are
   * optional, so tsc cannot see it), and the GM sheet's Add-items "Delete" was session-only again.
   * MUTATIONS (run 2026-10-20), each turning exactly its own test red:
   *  • drop `onCreateItem={homebrew?.onCreateItem}` in CampaignTracker → the tracker-route test;
   *  • drop `onCreateItem={options?.homebrew?.onCreateItem}` in PartyMembers, or `homebrew: gmHomebrew`
   *    from CampaignsPage's useMemberViewer options → the page-replacing test
   *    (`expected [] to have a length of 1 but got +0`);
   *  • drop `onCreateItem={addCustomItem}` from App's <CampaignsPage> → the App test
   *    (`expected undefined to be true`).
   * (Dropping CampaignTracker's line also reddens the App test, which goes through it.)
   */
  const AUTHORED: Item = {
    id: 'custom-brass-compass-k7w3',
    name: 'Brass Compass of Shoals',
    itemType: 'equipment',
    level: 1,
    bulk: 0.1,
    traits: [],
    rarity: 'common',
    price: { gp: 4 },
    description: 'A compass that points to the nearest shallows.',
    source: { license: 'homebrew', book: 'My Homebrew' },
  } as Item;
  /** A player whose sheet offers the GM's homebrew book in the Add-items search. */
  const PC_HB = (): SavedChar => {
    const db = content();
    const build = { ...buildOf('Teodor Vance', 3), enabledSources: storedSources([...CORE_BOOKS, 'My Homebrew']) } as BuildState;
    const character = buildCharacter(build, db);
    return { id: 'char-hb', character, build, play: initialPlay(character, db) };
  };
  const withAuthored = (): ContentDatabase => ({ ...content(), items: { ...content().items, [AUTHORED.id]: AUTHORED } }) as ContentDatabase;

  /** In the open GM sheet (under `scope`): Inventory → Add item → search → Delete → the app's confirm. */
  async function retireFromSheet(scope: string): Promise<void> {
    const sheet = q(scope);
    expect(sheet, `fixture: the GM sheet (${scope}) is open`).not.toBeNull();
    const byText = (root: ParentNode, t: string) =>
      [...root.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t) as HTMLButtonElement | undefined;
    click(byText(sheet!, 'Inventory')!);
    await flush(2);
    click(byText(sheet!, 'Add item')!);
    await flush(2);
    const input = document.querySelector<HTMLInputElement>('.fsel-results-search input');
    expect(input, 'fixture: the Add-items search box').not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Brass Compass');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush(2);
    const del = document.querySelector<HTMLButtonElement>(`button.del[aria-label="Delete ${AUTHORED.name}"]`);
    expect(del, 'fixture: the search offers Delete on the GM’s own item').not.toBeNull();
    click(del!);
    await flush(2);
    const ok = byText(document, 'Delete');
    expect(ok, 'fixture: the app’s own confirm').toBeTruthy();
    click(ok!);
    await flush(3);
  }

  it('an item the GM retires in the tracker’s sheet reaches CampaignsPage’s onCreateItem, as a retire', async () => {
    const written: Item[] = [];
    srv.party = [publish(PC_HB(), 'owner-hb')];
    await openCampaign({ onCreateItem: (it) => written.push(it) }, withAuthored());
    openSheetFor('Teodor Vance');
    await flush(4);
    expect(q('.ct-sheet-full .ws-app'), 'fixture: the tracker’s own GM sheet (not the page-replacing one)').not.toBeNull();
    await retireFromSheet('.ct-sheet-full');
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ id: AUTHORED.id, retired: true });
  }, 180_000);

  it('…and from the page-replacing GM sheet (a card the tracker has no sheet for yet)', async () => {
    const written: Item[] = [];
    srv.party = [publish(PC_HB(), 'owner-hb')];
    srv.trackerMiss.add('char-hb');
    await openCampaign({ onCreateItem: (it) => written.push(it) }, withAuthored());
    openSheetFor('Teodor Vance');
    await flush(6);
    expect(q('.ct-sheet-full'), 'fixture: not the tracker’s sheet').toBeNull();
    expect(q('.party-viewer .gm-edit-tab'), 'fixture: the page-replacing GM sheet').not.toBeNull();
    await retireFromSheet('.party-viewer');
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ id: AUTHORED.id, retired: true });
  }, 180_000);

  it('in the app: the retire is saved to homebrew storage (App’s addCustomItem), not kept for the session', async () => {
    saveHomebrewItem(AUTHORED); // the GM authored it earlier, on his own sheet
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    srv.party = [publish(PC_HB(), 'owner-hb')];
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
    openSheetFor('Teodor Vance');
    await flush(4);
    expect(q('.ct-sheet-full .ws-app'), 'fixture: the GM sheet over the tracker').not.toBeNull();
    await retireFromSheet('.ct-sheet-full');
    expect(loadHomebrewItems()[AUTHORED.id]?.retired).toBe(true);
  }, 240_000);
});

/** Click the dashboard card of the member named `name`. */
function openSheetFor(name: string): void {
  const card = qq('.party-grid .party-card').find((c) => (c.querySelector('.party-card-name')?.textContent ?? '').includes(name));
  expect(card, `fixture: ${name}'s card is on the dashboard`).toBeTruthy();
  click(card!);
}

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

  it('keeps "← Tracker" through a trip to Settings and back — and still drops it when Settings leads elsewhere', async () => {
    /*
     * U2 (2026-10-20): App's clearing effect ended the tracker visit on ANY mode but 'sheet', and
     * Settings is a mode of its own — so Menu → Settings → back returned to the same sheet without
     * its way back to the tracker. Fails on b8f8a6e at the first `toHaveLength(1)` after Escape
     * (`expected [] to have a length of 1 but got +0`).
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
    const ownCard = () =>
      qq('.party-grid .party-card').find((c) => (c.querySelector('.party-card-name')?.textContent ?? '').includes('Ilsabet Corrow'));
    click(ownCard()!);
    await flush(6);
    expect(qq('button[aria-label="Back to tracker"]'), 'fixture: the own sheet from the tracker').toHaveLength(1);

    // Menu → Settings → Escape: the same sheet, with its way back.
    const menuItem = (label: string): HTMLElement => {
      const el = qq('.topmenu-item').find((b) => (b.textContent ?? '').trim() === label);
      if (!el) throw new Error(`no menu item "${label}"`);
      return el as HTMLElement;
    };
    click(btn('Menu'));
    await flush(1);
    click(menuItem('Settings'));
    await flush(4);
    expect(q('.char-name-text'), 'fixture: Settings replaced the sheet').toBeNull();
    escape();
    await flush(4);
    expect(q('.char-name-text')?.textContent).toBe('Ilsabet Corrow');
    expect(qq('button[aria-label="Back to tracker"]')).toHaveLength(1);
    click(btn('Back to tracker'));
    await flush(8);
    expect(q('.campaign-tracker'), 'the campaign reopened').not.toBeNull();

    // Settings → Characters → the same sheet: an ordinary sheet now.
    click(ownCard()!);
    await flush(6);
    expect(qq('button[aria-label="Back to tracker"]')).toHaveLength(1);
    click(btn('Menu'));
    await flush(1);
    click(menuItem('Settings'));
    await flush(4);
    click(btn('Menu'));
    await flush(1);
    click(menuItem('Characters'));
    await flush(4);
    click(q('.rcard-open')!);
    await flush(4);
    expect(q('.char-name-text')?.textContent).toBe('Ilsabet Corrow');
    expect(qq('button[aria-label="Back to tracker"]')).toHaveLength(0);
  }, 240_000);
});
