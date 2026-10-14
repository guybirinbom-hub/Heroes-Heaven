// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { computeSummary } from '../src/sheet/partySummary';
import type { SavedChar } from '../src/data/storage';
import type { CampaignMembership } from '../src/data/campaigns';
import type { PartyMember } from '../src/data/party';
import type { Creature } from '../tracker/src/types/pf2e';
import { useCombatStore } from '../tracker/src/store/combatStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { useLayoutStore, useGmLayoutStore } from '../tracker/src/store/layoutStore';
import { useSettingsStore } from '../tracker/src/store/settingsStore';
import { useWindowStore, BASE_Z } from '../tracker/src/store/windowStore';
import { trackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';

/**
 * ESCAPE INSIDE THE TRACKER NEVER DOES THE WRONG THING (the G2b and item-7 refuters, 2026-10-13).
 *
 *  (a) A TEXT BOX of the tracker's that does not spend its own Escape — the stat block's, the GM screen's,
 *      the Monster Parts popup's, any box added later — let the press fall through to the campaign's base
 *      handler, which LEFT THE CAMPAIGN (the local table: the whole page). The base handler now stands
 *      down for a press typed in a tracker text box, whichever file drew it.
 *  (b) A TRACKER MODAL drawn over the floating windows — the Encounter Building tables, Link Stat Block,
 *      the encounter-table editor, the advanced condition editor — is not one of the four overlays on the
 *      dismiss stack, so Escape went to the windows' handler and closed a window hidden BEHIND it (and,
 *      with no window open, left the campaign with the modal still up). The host now stands down while
 *      one is open — which left Escape doing NOTHING in a modal with no Escape of its own (the item-7
 *      refuter, round 2), so the tracker's modals now close themselves on Escape and spend the press
 *      (tracker/src/utils/spendEscape.ts useEscapeCloses; their own legs: tracker/src/components/
 *      modalEscape.test.tsx). HELD DOWN, the key's repeats went on peeling — the window behind the
 *      tables, then the campaign (the G7e refuter): a press that closed a tracker modal now keeps its
 *      repeats until the key is let go. And with Search (Ctrl+K) drawn OVER the tables, one press closed
 *      the tables under it and the search too (round 2): a modal covered all over now leaves the press
 *      to the layer on top.
 *  (c) The same for a party card's TURN-TIME GRAPH: opened before a window, the window's handler sits on
 *      top of the graph's — and the graph closed itself from its own `document` listener, which in a real
 *      browser takes it off the DOM before the windows' handler runs. Asked as of the key press
 *      (CampaignTracker's capture listener), the window still stood down. Since 2026-10-14 the graph is a
 *      registered tracker layer that spends its press; a stand-in that closes itself and lets the press
 *      go on keeps the as-of-the-press record guarded.
 *  (f) Outside a campaign, in Heroes Heaven's SETTINGS → Initiative tracker: the page closes on Escape, and
 *      a tracker editor opened there (a new encounter table) had no Escape — one press closed the whole
 *      Settings page, the half-made table with it.
 *  (g) A LAYER drawn over all of a tracker modal that takes the press without spending it — a tracker
 *      popup on <body>, a layer in the view with a text box — closed itself, and the same press went on to
 *      the campaign's Back handler for the modals, which then closed the modal under it too (the G7s
 *      refuter, 2026-10-13). A press the modal left to a layer never closes it through that handler now.
 *  (h) A stat block's EDIT CONVERTER IN A WINDOW is painted at that window's z-index, and a window opened
 *      since is painted over it: one Escape closed the converter hidden under that window (the G7s refuter,
 *      round 2). The press is that window's now.
 *  (i) HELD DOWN after a tracker popup that is no registered modal took the press (the condition picker,
 *      then; the stat block's ☰ menu now): the repeats went on to close the window on top, then left the
 *      campaign (the G7s refuter, round 2). A repeat now closes no window and never leaves.
 *  (j) Heroes Heaven's Settings → Initiative tracker → Turn timer: one Escape on the DM's turn-time graph
 *      closed the graph AND the Settings page (owner's list 2026-10-14, item 2).
 *  (k) The GM screen's + menu had no Escape; it, and its "Add to GM Screen" picker, now close alone — and
 *      a window drawn over all of the + menu (it is in the page, under the windows) goes first (item 3).
 *      A press or a focus outside the menu closes it, so Customize, opened from the top bar, never sits
 *      over it: Escape and Back did nothing at all there (the escape-lane refuter, 2026-10-14).
 *  BACK (G7s): the same places on the phone, where Back is a `popstate` and no key press at all — the last
 *      describe; with it, the modals' Back handler waiting for nothing drawn under the modals (its cover).
 *      Since 2026-10-14 (owner's list, items 1-3) also the condition picker, the turn-time graph (a party
 *      card's, and the DM's in Settings), the GM screen's + menu and its picker.
 *
 * Mounted the way the GM meets it: the campaigns page, the campaign opened as the tracker (server
 * mocked). Every character here is synthetic.
 */

const srv = vi.hoisted(() => ({
  party: [] as PartyMember[],
  sheets: new Map<string, unknown>(),
}));

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
    value: { id: 'camp-esc', code: 'ESCCODE', ownerId: 'gm-1', name: 'The Quiet Marsh', description: '', defaults: {} },
  }),
}));

const CAMPAIGN: CampaignMembership = { id: 'camp-esc', code: 'ESCCODE', role: 'gm', name: 'The Quiet Marsh' };

function saved(id: string, name: string, level: number): SavedChar {
  const db = content();
  const build: BuildState = {
    ...emptyBuild(),
    name,
    level,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    classId: 'fighter',
    keyAbility: 'str',
  };
  const character = buildCharacter(build, db);
  return { id, character, build, play: initialPlay(character, db) };
}
function publish(sc: SavedChar, ownerId: string): PartyMember {
  srv.sheets.set(sc.id, sc);
  return { ownerId, charId: sc.id, name: sc.character.name, summary: computeSummary(sc.character, content()) };
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
const campaignUp = () => !!q('.campaign-tracker');
const windowsOpen = () => useWindowStore.getState().wins.length;
/** Escape pressed ON an element — the way a browser delivers it: from the focused element up through
 *  `document` to `window`, where the dismiss stack listens. `{ repeat: true }`: the key held down. */
async function escapeOn(el: Element, held: Pick<KeyboardEventInit, 'repeat'> = {}): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, ...held }));
    await new Promise((r) => setTimeout(r, 0));
  });
  await flush(2);
}
async function letGoOfEscape(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
  });
}
function openWindow(): void {
  act(() => useWindowStore.getState().open('condition', 'synthetic glare', 'Synthetic Glare'));
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
  useWindowStore.setState({ wins: [], topZ: BASE_Z });
  useSettingsStore.setState({ turnTimerEnabled: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  window.matchMedia = ((qq: string) => ({
    matches: false, media: qq, onchange: null, addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  const files: Record<string, string> = {
    'core.json': 'public/core.json',
    'core-descriptions.json': 'public/core-descriptions.json',
  };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = files[String(url).split('/').pop() ?? ''];
    if (!path) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) as unknown, text: async () => '' };
  });
});

afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  for (const n of [...document.body.children]) n.remove();
  useWindowStore.setState({ wins: [], topZ: BASE_Z });
  useSettingsStore.setState({ turnTimerEnabled: false });
  vi.unstubAllGlobals();
});

/** The campaigns page with the campaign opened — the tracker in the body. */
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
  expect(campaignUp(), 'fixture: the campaign opened as the tracker').toBe(true);
  return el;
}

/** The campaign with a player and a creature on the board, so the encounter badge is up: its "i" opens
 *  the Encounter Building tables. */
async function campaignWithTablesButton(): Promise<HTMLElement> {
  srv.party = [publish(saved('char-a', 'Ayla Brightwood', 5), 'owner-a')];
  await openCampaign();
  const { SAMPLE_COMBATANT } = await import('../tracker/src/data/sampleStatBlock');
  const brute = { ...JSON.parse(JSON.stringify(SAMPLE_COMBATANT.creature)), id: 'esc-brute', name: 'Reed Brute' } as Creature;
  act(() => {
    useCombatStore.getState().addCombatant(null, { name: 'Ayla Brightwood', isPC: true, maxHP: 40, charId: 'char-a' });
    useCombatStore.getState().addCombatant(brute);
  });
  await flush(2);
  const tablesBtn = q('button[aria-label="Encounter building reference tables"]');
  expect(tablesBtn, 'fixture: the encounter badge is up').not.toBeNull();
  return tablesBtn!;
}

/** A synthetic creature on the board; answers its row's id. */
async function bruteOnTheBoard(): Promise<string> {
  const { SAMPLE_COMBATANT } = await import('../tracker/src/data/sampleStatBlock');
  const brute = { ...JSON.parse(JSON.stringify(SAMPLE_COMBATANT.creature)), id: 'esc-brute', name: 'Reed Brute' } as Creature;
  act(() => useCombatStore.getState().addCombatant(brute));
  await flush(1);
  return useCombatStore.getState().combatants.find((c) => c.name === 'Reed Brute')!.id;
}

/** The campaign with a creature's stat block open in a floating window and its Edit converter up there
 *  (☰ → Edit Stat Block): the converter's `.modal-overlay` is drawn INSIDE that window, at its z-index. */
async function converterInAWindow(): Promise<{ winA: string; converter: () => Element | null }> {
  await openCampaign();
  const id = await bruteOnTheBoard();
  act(() => useWindowStore.getState().open('creature', id, 'Reed Brute'));
  await flush(2);
  const winA = useWindowStore.getState().wins[0].id;
  const a = document.querySelector(`.campaign-tracker [data-float-win="${winA}"]`);
  expect(a, 'fixture: the stat block’s window').not.toBeNull();
  click(a!.querySelector('button[title="Options"]')!);
  await flush(1);
  click([...a!.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Edit Stat Block')!);
  await flush(2);
  const converter = () => document.querySelector(`.campaign-tracker [data-float-win="${winA}"] .modal-overlay`);
  expect(converter(), 'fixture: the Edit converter is open inside the window').not.toBeNull();
  return { winA, converter };
}
/** A window opened over the converter's (a link in its preview opens one): a higher z-index, so it is
 *  painted over all of the converter's window, the converter's overlay included. Answers its id. */
async function windowOverTheConverter(winA: string): Promise<string> {
  openWindow();
  await flush(1);
  const wins = useWindowStore.getState().wins;
  const winB = wins.find((w) => w.id !== winA)!.id;
  const z = (id: string) => wins.find((w) => w.id === id)!.z;
  expect(z(winB), 'fixture: the new window is drawn over the converter’s').toBeGreaterThan(z(winA));
  return winB;
}

/** Heroes Heaven's Settings → Initiative tracker → Turn timer, with the DM's turn-time graph open (a
 *  synthetic DM average seeded; `restore` puts the store back). */
async function settingsTimerGraph(): Promise<{
  settingsClosed: ReturnType<typeof vi.fn>;
  graph: () => Element | null;
  restore: () => void;
}> {
  const { SettingsPage } = await import('../src/sheet/SettingsPage');
  const { useDmAverageStore } = await import('../tracker/src/store/dmAverageStore');
  const { avgSeconds, turnCount, history } = useDmAverageStore.getState();
  act(() =>
    useDmAverageStore.setState({ avgSeconds: 42, turnCount: 6, history: [{ at: Date.UTC(2026, 9, 1), avgSeconds: 42, turnCount: 6 }] }),
  );
  const restore = () => act(() => useDmAverageStore.setState({ avgSeconds, turnCount, history }));
  const settingsClosed = vi.fn();
  const el = render(<SettingsPage onClose={settingsClosed} />);
  await flush();
  const button = (label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label);
  click(button('Initiative tracker')!);
  // The section is a lazy chunk (SettingsPage): wait for it to arrive.
  for (let i = 0; i < 300 && !button('Turn timer'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }
  expect(button('Turn timer'), 'fixture: the tracker section is up').toBeTruthy();
  click(button('Turn timer')!);
  await flush(2);
  const dm = el.querySelector('button[title="Click for the DM turn-time timeline"]');
  expect(dm, 'fixture: the DM average, a button').not.toBeNull();
  click(dm!);
  await flush(1);
  const graph = () => el.querySelector('.modal-overlay');
  expect(graph(), 'fixture: the DM’s graph is open over Settings').not.toBeNull();
  return { settingsClosed, graph, restore };
}

/** The campaign on its GM screen (empty: "Add Reference" in the middle, the + at the bottom right). */
async function gmScreen() {
  act(() => useGmLayoutStore.setState({ root: null }));
  await openCampaign();
  act(() => trackerUi.showMain('gm'));
  await flush(2);
  const fab = () => q<HTMLButtonElement>('.campaign-tracker button[title="Add to GM screen"]');
  /** The + menu's panel: its heading's parent. */
  const menu = () =>
    [...document.querySelectorAll<HTMLElement>('.campaign-tracker div')].find((d) => d.children.length === 0 && d.textContent === 'Add to GM screen')
      ?.parentElement ?? null;
  const addReference = () =>
    [...document.querySelectorAll<HTMLButtonElement>('.campaign-tracker button')].find((b) => (b.textContent ?? '').trim() === 'Add Reference');
  const picker = () => [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent === 'Add to GM Screen') ?? null;
  expect(fab(), 'fixture: the GM screen’s +').not.toBeNull();
  expect(addReference(), 'fixture: the empty GM screen offers Add Reference').toBeTruthy();
  return { fab, menu, addReference, picker };
}

/** The browser's hit test (jsdom has none) with the open window drawn over all of the + menu until it
 *  closes, and a box for the menu. Answers the undo. */
function windowOverAllOfTheMenu(menu: () => HTMLElement | null): () => void {
  const win = document.querySelector<HTMLElement>('.campaign-tracker [data-float-win]');
  expect(win, 'fixture: the window').not.toBeNull();
  return layerOverAllOfTheMenu(menu, () => (win!.isConnected ? win : null));
}
/** The same for any layer: `cover()` (while it answers one) is drawn over all of the + menu. */
function layerOverAllOfTheMenu(menu: () => HTMLElement | null, cover: () => Element | null): () => void {
  const doc = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
  doc.elementFromPoint = () => cover() ?? menu();
  const realRect = Element.prototype.getBoundingClientRect;
  const box = { x: 600, y: 300, left: 600, top: 300, width: 232, height: 240, right: 832, bottom: 540 };
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this === menu() ? ({ ...box, toJSON: () => box } as DOMRect) : realRect.call(this);
  };
  return () => {
    delete doc.elementFromPoint;
    Element.prototype.getBoundingClientRect = realRect;
  };
}

describe('Escape inside the tracker', () => {
  it('(a) typed in a tracker text box that does not spend it, never leaves the campaign — any other press still does', async () => {
    /*
     * The boxes stand in for every tracker box that handles no Escape of its own (StatBlock's, GMScreen's,
     * MonsterPartsPopup's — the rule asks the press's target, not which file drew it).
     * MUTATION (tried 2026-10-13): drop `editableAtPress.current ||` from the base handler's stand-down
     * (src/integration/CampaignTracker.tsx) and this fails at the first box —
     *   AssertionError: Escape in a text input: expected false to be true
     */
    await openCampaign();
    const main = q('.campaign-tracker .ct-main')!;
    const boxes: [string, HTMLElement][] = [];
    const input = document.createElement('input');
    input.type = 'text';
    boxes.push(['a text input', input]);
    boxes.push(['a textarea', document.createElement('textarea')]);
    const rich = document.createElement('div');
    rich.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span'); // the press lands INSIDE the editable region
    rich.appendChild(inner);
    boxes.push(['an editable region', rich]);
    const stage = document.createElement('div');
    main.appendChild(stage);
    for (const [what, box] of boxes) {
      stage.appendChild(box);
      box.focus();
      await escapeOn(box === rich ? inner : box);
      expect(campaignUp(), `Escape in ${what}`).toBe(true);
    }
    // A checkbox holds no text: an Escape on it is a plain press.
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    stage.appendChild(tick);
    await escapeOn(tick);
    expect(campaignUp(), 'Escape on a checkbox leaves, as any plain press does').toBe(false);
  }, 180_000);

  it('(a) a dropdown holds no text: Escape on a focused <select> is a plain press, and leaves', async () => {
    /*
     * After a pick, focus stays on the dropdown — so counting a <select> as a text box (as round 1 did)
     * made Escape stop leaving the campaign after any choice in a tracker dropdown (the G3 refuter,
     * 2026-10-13).
     * MUTATION (tried 2026-10-13): put `t.tagName === 'SELECT' ||` back into editableInTracker
     * (src/integration/CampaignTracker.tsx) and this fails —
     *   AssertionError: Escape on a focused dropdown leaves: expected true to be false
     */
    await openCampaign();
    const pick = document.createElement('select');
    for (const v of ['a', 'b']) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      pick.appendChild(o);
    }
    q('.campaign-tracker .ct-main')!.appendChild(pick);
    pick.focus();
    await escapeOn(pick);
    expect(campaignUp(), 'Escape on a focused dropdown leaves').toBe(false);
  }, 180_000);

  it('(d) with a window open, Escape typed in a text box OUTSIDE it closes no window — typed in a box INSIDE it, it closes that window', async () => {
    /*
     * A box in the stat-block pane, the GM screen or the initiative rail: its Escape is "cancel what I was
     * typing", and it closed whichever unrelated window was on top (the G3 refuter, 2026-10-13).
     * MUTATION (tried 2026-10-13, round 2's code): drop the whole `if (editableAtPress.current) { … }` block
     * from the windows' handler (src/integration/CampaignTracker.tsx) and this fails —
     *   AssertionError: the window stays: expected +0 to be 1
     * MUTATION (tried 2026-10-13): never record which window holds the box (`boxWinAtPress.current = null`
     * in the capture listener) and this fails at "a box inside the window closes it" (expected 1 to be +0).
     */
    await openCampaign();
    openWindow();
    await flush(1);
    expect(windowsOpen(), 'fixture: one window').toBe(1);
    const win = document.querySelector('.campaign-tracker [data-float-win]');
    expect(win, 'fixture: the window is drawn inside the campaign').not.toBeNull();

    const outside = document.createElement('input');
    outside.type = 'text';
    q('.campaign-tracker .ct-main')!.appendChild(outside);
    outside.focus();
    await escapeOn(outside);
    expect(windowsOpen(), 'the window stays').toBe(1);
    expect(campaignUp(), 'and so does the campaign').toBe(true);

    // A plain press (nothing focused) still closes the window, as always.
    await escapeOn(document.body);
    expect(windowsOpen()).toBe(0);
    expect(campaignUp()).toBe(true);

    openWindow();
    await flush(1);
    const inside = document.createElement('input');
    inside.type = 'text';
    document.querySelector('.campaign-tracker [data-float-win]')!.appendChild(inside);
    inside.focus();
    await escapeOn(inside);
    expect(windowsOpen(), 'a box inside the window closes it').toBe(0);
    expect(campaignUp()).toBe(true);
  }, 180_000);

  it('(e) a box in the LOWER of two windows, focused by the keyboard: Escape closes the box’s own window — never the one on top', async () => {
    /*
     * Clicking into a box raises its window first (FloatingWindow's mousedown → toFront), which hid this;
     * focus reached by Tab raises nothing, and the handler's `closeTop()` closed the unrelated window above
     * while the box's own stayed (the G3 refuter, round 2).
     * MUTATION (tried 2026-10-13): close the top window for a box inside a window (`closeTop()` in place of
     * `close(boxWinAtPress.current)`, src/integration/CampaignTracker.tsx) and this fails —
     *   AssertionError: the box’s own window closed: expected [ 'w…' ] to not include 'w…'
     */
    await openCampaign();
    act(() => useWindowStore.getState().open('condition', 'synthetic glare', 'Synthetic Glare'));
    act(() => useWindowStore.getState().open('condition', 'synthetic hush', 'Synthetic Hush'));
    await flush(1);
    expect(windowsOpen(), 'fixture: two windows').toBe(2);
    const byZ = () => [...useWindowStore.getState().wins].sort((a, b) => a.z - b.z).map((w) => w.id);
    const [lower, upper] = byZ();
    const box = document.createElement('input');
    box.type = 'text';
    document.querySelector(`.campaign-tracker [data-float-win="${lower}"]`)!.appendChild(box);
    box.focus(); // the keyboard's way in: no mousedown, so nothing is raised
    expect(byZ(), 'fixture: the box’s window is still the lower one').toEqual([lower, upper]);

    await escapeOn(box);
    const left = useWindowStore.getState().wins.map((w) => w.id);
    expect(left, 'the box’s own window closed').not.toContain(lower);
    expect(left, 'the window on top stays').toEqual([upper]);
    expect(campaignUp()).toBe(true);
  }, 180_000);

  it('(a) …and a text box OUTSIDE the tracker is not the tracker’s to protect', async () => {
    await openCampaign();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    await escapeOn(outside);
    expect(campaignUp(), 'a box elsewhere on the page: the press leaves').toBe(false);
  }, 180_000);

  it('(b) the Encounter Building tables over a window: Escape closes the TABLES — never the window hidden behind them, never the campaign', async () => {
    /*
     * Round 1 of this leg pinned "Escape closes neither the hidden window nor the campaign" — and with the
     * host standing down, nothing else either: Escape did nothing in the tables (the item-7 refuter,
     * round 2). They now close themselves and spend the press.
     * MUTATION (tried 2026-10-13): drop `useEscapeCloses(onClose)` from tracker/src/components/
     * EncounterTablesModal.tsx → fails at "Escape closed the tables" (expected <div …> to be null).
     * (The host's own stand-down for a modal is the next leg's: here the press never reaches it.)
     */
    const tablesBtn = await campaignWithTablesButton();
    openWindow();
    await flush(1);
    click(tablesBtn);
    await flush(2);
    const tables = () => q('.campaign-tracker .modal-overlay');
    expect(tables(), 'fixture: the tables are open').not.toBeNull();
    expect(windowsOpen(), 'fixture: a window under them').toBe(1);

    await escapeOn(document.body);
    expect(tables(), 'Escape closed the tables').toBeNull();
    expect(windowsOpen(), 'the window hidden behind the tables stays').toBe(1);
    expect(campaignUp()).toBe(true);
    // The next press is the window's, as always.
    await escapeOn(document.body);
    expect(windowsOpen()).toBe(0);
    expect(campaignUp()).toBe(true);

    // No window: Escape closes the tables and the campaign stays; the press after that leaves.
    click(tablesBtn);
    await flush(2);
    expect(tables(), 'fixture: open again').not.toBeNull();
    await escapeOn(document.body);
    expect(tables(), 'Escape closed the tables').toBeNull();
    expect(campaignUp(), 'no window: still in the campaign').toBe(true);
    await escapeOn(document.body);
    expect(campaignUp(), 'nothing open: the press leaves').toBe(false);
  }, 180_000);

  it('(b) HELD DOWN: the Escape that closed the tables never goes on to the window behind them, nor out of the campaign', async () => {
    /*
     * A held key repeats, and each repeat was a press of its own: the first closed the tables, the next
     * the window hidden behind them, the next left the campaign (the G7e refuter, 2026-10-13: from the
     * table editor's Link picker a held Escape went on to close the editor, the half-made table with it).
     * Now once a press has closed a tracker modal, its repeats reach nothing until the key is let go.
     * MUTATION (tried 2026-10-13): drop `holdUntilLetGo()` from onModalKey (tracker/src/utils/
     * spendEscape.ts) → fails at "held: the window hidden behind the tables stays" (expected +0 to be 1).
     * Since G7s the hold starts in onModalPress (a `window` capture listener, whichever listener closes the
     * modal); dropping its `holdUntilLetGo(e)` failed here the same way (re-tried 2026-10-13). Since G7s
     * round 2 the campaign itself also lets no repeat close a window or leave (`repeatAtPress`, leg (i)),
     * so that drop alone stays GREEN here (re-tried 2026-10-13); the hold is pinned by the tracker's own
     * legs — modalEscape.test.tsx (d), (e) and the StrictMode leg in CombatantMenu.test.tsx.
     */
    const tablesBtn = await campaignWithTablesButton();
    openWindow();
    await flush(1);
    click(tablesBtn);
    await flush(2);
    const tables = () => q('.campaign-tracker .modal-overlay');
    expect(tables(), 'fixture: the tables are open over a window').not.toBeNull();

    await escapeOn(document.body);
    expect(tables(), 'the press closed the tables').toBeNull();
    for (let i = 0; i < 3; i++) await escapeOn(document.body, { repeat: true });
    expect(windowsOpen(), 'held: the window hidden behind the tables stays').toBe(1);
    expect(campaignUp(), 'held: still in the campaign').toBe(true);

    // Let go, the next press is the window's, as always.
    await letGoOfEscape(document.body);
    await escapeOn(document.body);
    expect(windowsOpen()).toBe(0);
    expect(campaignUp()).toBe(true);
  }, 180_000);

  it('(b) SEARCH (Ctrl+K) over the Encounter Building tables: Escape closes the search — then the tables, then the window, never the campaign', async () => {
    /*
     * Search (z 9500) is drawn over the tables (z 2000), but the tables' own `document` listener was
     * added first: with the focus off the search box, one Escape closed the tables hidden UNDER the
     * search, then the search too (the G7e refuter, round 2). A tracker modal now stands down while the
     * browser's hit test finds something else covering its whole box. jsdom has no hit test, so the
     * leg answers for the browser: the search while it is open, the tables' box after.
     * MUTATION (tried 2026-10-13): drop `if (coveredAllOver(top.el())) return` from onModalKey
     * (tracker/src/utils/spendEscape.ts) → fails at "Escape closed the search" (expected <div …> to be
     * null): the tables under it took the press, and spent it before the search's own listener.
     */
    const tablesBtn = await campaignWithTablesButton();
    openWindow();
    await flush(1);
    click(tablesBtn);
    await flush(2);
    const tables = () => q('.campaign-tracker .modal-overlay');
    expect(tables(), 'fixture: the tables are open over a window').not.toBeNull();

    // Ctrl+K, as the GM presses it: the campaign opens Search over everything.
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    });
    await flush(2);
    const search = (): HTMLElement | null => {
      let el = document.querySelector<HTMLElement>('button[title="Close (Esc)"]');
      while (el && el.style.position !== 'fixed') el = el.parentElement;
      return el;
    };
    expect(search(), 'fixture: Search is open').not.toBeNull();
    (document.activeElement as HTMLElement | null)?.blur(); // a click on the box's padding
    const tablesBox = tables()!.querySelector('.modal-box')!;

    // The browser's hit test: the search over everything while it is open, then the tables' box.
    const doc = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
    doc.elementFromPoint = () => search() ?? tablesBox;
    const realRect = Element.prototype.getBoundingClientRect;
    const box = { x: 100, y: 100, left: 100, top: 100, width: 400, height: 300, right: 500, bottom: 400 };
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.classList.contains('modal-box') ? ({ ...box, toJSON: () => box } as DOMRect) : realRect.call(this);
    };
    try {
      await escapeOn(document.body);
      expect(search(), 'Escape closed the search').toBeNull();
      expect(tables(), 'the tables under the search stay').not.toBeNull();
      expect(windowsOpen(), 'so does the window behind them').toBe(1);
      expect(campaignUp(), 'and the campaign').toBe(true);

      await letGoOfEscape(document.body);
      await escapeOn(document.body);
      expect(tables(), 'the next press closes the tables').toBeNull();
      expect(windowsOpen(), 'the window stays').toBe(1);

      await letGoOfEscape(document.body);
      await escapeOn(document.body);
      expect(windowsOpen(), 'the next, the window').toBe(0);
      expect(campaignUp(), 'still in the campaign').toBe(true);
    } finally {
      delete doc.elementFromPoint;
      Element.prototype.getBoundingClientRect = realRect;
    }
  }, 180_000);

  it('(b) a tracker modal with NO Escape of its own, over a window: Escape closes neither the hidden window nor the campaign', async () => {
    /*
     * A stand-in `.modal-overlay` inside the tracker: one added later, or one whose own Escape is not wired
     * yet (as of 2026-10-13: a party card's "Link Stat Block", which is MonsterSearch in pick mode).
     * It keeps the host's stand-down guarded now that the tables (the legs above) spend their own press.
     * MUTATIONS (tried 2026-10-13 by the G7e refuter, each alone, on a copy of src/integration/
     * CampaignTracker.tsx mounted in its place — the file itself was another group's that wave and was
     * never touched; the unmutated copy ran green first):
     *  - drop `if (modalAtPress.current) return;` from the windows' handler → fails at "the window hidden
     *    behind the modal stays" (expected +0 to be 1);
     *  - drop `|| modalAtPress.current` from the base handler → fails at "no window: still in the
     *    campaign" (expected false to be true).
     * SINCE G7s (2026-10-13) both handlers also ask the DOM live (`trackerModalOpen()`, for Android's Back),
     * and this stand-in stays on screen, so each of those two drops alone stays GREEN here: the live check
     * holds it. The as-of-the-press record is now guarded by (c) — the turn-time graph, gone from the DOM
     * before the stack runs — for the windows' handler and, with no window, for the base handler; the live
     * check by the BACK legs below.
     */
    await openCampaign();
    openWindow();
    await flush(1);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    q('.campaign-tracker .ct-main')!.appendChild(modal);

    await escapeOn(document.body);
    expect(windowsOpen(), 'the window hidden behind the modal stays').toBe(1);
    expect(campaignUp()).toBe(true);

    act(() => useWindowStore.getState().closeAll());
    await flush(1);
    await escapeOn(document.body);
    expect(campaignUp(), 'no window: still in the campaign').toBe(true);

    // The modal gone, nothing is left above the campaign: Escape leaves as always.
    modal.remove();
    await escapeOn(document.body);
    expect(campaignUp(), 'nothing open: the press leaves').toBe(false);
  }, 180_000);

  it('(f) Heroes Heaven’s Settings → Initiative tracker → a new encounter table: Escape closes the editor — never the Settings page', async () => {
    /*
     * MUTATIONS (tried 2026-10-13, each alone): drop `useEscapeCloses(onClose)` from tracker/src/components/
     * EncounterTableEditor.tsx → fails at "Escape closed the editor" (the press went to Settings' own
     * handler instead); drop `e.stopPropagation()` from spendEscape (tracker/src/utils/spendEscape.ts) →
     * fails at "the Settings page stays" (the editor closed AND the press went on to close Settings).
     * (Since G7e round 2 onModalKey also spends with `stopImmediatePropagation`, so that drop alone stays
     * green; since G7s a press that leaks with both dropped reaches TrackerSettingsSection's modal Back
     * handler, above the page's, and still stays green here — re-tried 2026-10-13. The leak itself is
     * pinned by the Add Combatants leg below.)
     */
    const { SettingsPage } = await import('../src/sheet/SettingsPage');
    const { useEncounterTablesStore } = await import('../tracker/src/store/encounterTablesStore');
    act(() => useEncounterTablesStore.setState({ tables: [] }));
    const settingsClosed = vi.fn();
    const el = render(<SettingsPage onClose={settingsClosed} />);
    await flush();
    const button = (root: ParentNode, label: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label);
    click(button(el, 'Initiative tracker')!);
    // The section is a lazy chunk (SettingsPage): wait for it to arrive.
    for (let i = 0; i < 300 && !button(el, 'Encounter tables'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    }
    const tablesTab = button(el, 'Encounter tables');
    expect(tablesTab, 'fixture: the tracker section is up').toBeTruthy();
    click(tablesTab!);
    await flush(2);
    click(button(el, 'New table')!);
    await flush(1);
    const editor = () => [...el.querySelectorAll('h2')].find((h) => h.textContent === 'New encounter table') ?? null;
    expect(editor(), 'fixture: the table editor is open').not.toBeNull();

    await escapeOn(document.body);
    expect(editor(), 'Escape closed the editor').toBeNull();
    expect(settingsClosed, 'the Settings page stays').not.toHaveBeenCalled();
    expect(useEncounterTablesStore.getState().tables, 'nothing saved').toEqual([]);
    // Nothing open over Settings: the next press is Settings' own, as always.
    await escapeOn(document.body);
    expect(settingsClosed).toHaveBeenCalledTimes(1);
  }, 180_000);

  it('(c) a party card’s turn-time graph opened BEFORE a window: Escape closes the graph — never the window behind it', async () => {
    /*
     * The graph closed itself from a `document` listener of its own and let the press go on: the window's
     * handler (on `window`) stood down only because the campaign recorded, AS OF THE PRESS, that a modal
     * was up (the next leg keeps that record guarded). Since 2026-10-14 (owner's list, item 2) the graph is
     * a registered tracker layer (useEscapeCloses): it closes and SPENDS the press — the dismiss stack never
     * hears it.
     * MUTATION (tried 2026-10-14): TurnTimeline's `useEscapeCloses(onClose)` → a no-op ref (tracker/src/
     * components/TurnTimeline.tsx) → fails at "the graph closed" (expected <div …> to be null).
     */
    useSettingsStore.setState({ turnTimerEnabled: true });
    srv.party = [publish(saved('char-a', 'Ayla Brightwood', 5), 'owner-a')];
    await openCampaign();
    const chip = q('.party-grid .party-card .mt-turn-chip');
    expect(chip, 'fixture: the card’s turn chip').not.toBeNull();
    click(chip!);
    await flush(2);
    const graph = () => q('.campaign-tracker .modal-overlay');
    expect(graph(), 'fixture: the graph is open').not.toBeNull();
    openWindow(); // its handler would go on the stack ABOVE the graph's
    await flush(1);
    expect(windowsOpen()).toBe(1);

    await escapeOn(document.body);
    expect(graph(), 'the graph closed').toBeNull();
    expect(windowsOpen(), 'the window behind the graph stays').toBe(1);
    expect(campaignUp()).toBe(true);
    // The next press, nothing over the window: it closes the window, as always.
    await letGoOfEscape(document.body);
    await escapeOn(document.body);
    expect(windowsOpen()).toBe(0);
    expect(campaignUp()).toBe(true);

    // …and with NO window open: the graph closes, the campaign stays; the press after that leaves.
    click(q('.party-grid .party-card .mt-turn-chip')!);
    await flush(2);
    expect(graph(), 'fixture: the graph is open again, no window').not.toBeNull();
    await escapeOn(document.body);
    expect(graph(), 'the graph closed').toBeNull();
    expect(campaignUp(), 'no window: the graph closed, the campaign stays').toBe(true);
    await letGoOfEscape(document.body);
    await escapeOn(document.body);
    expect(campaignUp(), 'nothing open: the press leaves').toBe(false);
  }, 180_000);

  it('(c) a tracker modal that closes itself on Escape and lets the press go on (a stand-in): the window behind it stays — with no window, the campaign', async () => {
    /*
     * The turn-time graph and the Monster Parts popup were the last tracker modals that closed on Escape
     * from their own `document` listener and let the press go on (both registered since 2026-10-14;
     * tracker/src/components/modalEscapeCoverage.test.ts lets no new one in). The campaign's record of the
     * press (`modalAtPress`) still stands guard for one: in a browser such a modal is off the DOM before the
     * dismiss stack runs (React commits between listeners), so only the state AS OF THE PRESS can say it
     * was up. The stand-in takes itself off the DOM from its own `document` listener, as the browser would.
     * MUTATIONS (tried 2026-10-14, src/integration/CampaignTracker.tsx, each alone):
     *  - the windows' handler: `modalAtPress.current ||` dropped from its `closeWindowForPress(() => …)`
     *    → fails at "the window behind it stays" (expected +0 to be 1);
     *  - the base handler: `modalAtPress.current ||` dropped from its stand-down → fails at "no window: the
     *    campaign stays" (expected false to be true).
     */
    await openCampaign();
    openWindow();
    await flush(1);
    const listeners: ((e: KeyboardEvent) => void)[] = [];
    /** A `.modal-overlay` in the view that removes itself on Escape and leaves the press unspent. */
    const standIn = (): HTMLElement => {
      const m = document.createElement('div');
      m.className = 'modal-overlay';
      q('.campaign-tracker .ct-main')!.appendChild(m);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') m.remove();
      };
      listeners.push(onKey);
      document.addEventListener('keydown', onKey);
      return m;
    };
    try {
      const first = standIn();
      await escapeOn(document.body);
      expect(first.isConnected, 'fixture: it took the press').toBe(false);
      expect(windowsOpen(), 'the window behind it stays').toBe(1);
      expect(campaignUp()).toBe(true);
      await escapeOn(document.body);
      expect(windowsOpen(), 'the next press closes the window').toBe(0);

      const second = standIn();
      await escapeOn(document.body);
      expect(second.isConnected, 'fixture: it took the press').toBe(false);
      expect(campaignUp(), 'no window: the campaign stays').toBe(true);
      await escapeOn(document.body);
      expect(campaignUp(), 'nothing open: the press leaves').toBe(false);
    } finally {
      for (const l of listeners) document.removeEventListener('keydown', l);
    }
  }, 180_000);

  it('(g) a layer over the Encounter Building tables that takes the press without spending it: ONE Escape closes the layer — never the tables under it', async () => {
    /*
     * Covered all over, the tables' own listener leaves the press for the layer on top, unspent. A layer
     * that closes itself from its own `document` listener without spending it (the row menu's way) is
     * gone when the press reaches the dismiss stack — and the campaign's Back handler for the modals, on
     * top of the stack while a modal is open, closed the tables too: one press, two layers (the G7s
     * refuter, 2026-10-13: a full-cover body popup over the Edit converter). Two such layers here: a
     * tracker popup on <body>, and a layer inside the view whose text box holds the focus.
     * MUTATION (tried 2026-10-13): drop `if (layersPressOnItsWay()) return false` from closeTopTrackerModal
     * (tracker/src/utils/spendEscape.ts) → fails at "a popup on <body> took the press: the tables under it
     * stay" (expected null not to be null); with the popup half taken out, at "a layer with a text box
     * took the press: the tables under it stay".
     */
    const tablesBtn = await campaignWithTablesButton();
    openWindow();
    await flush(1);
    click(tablesBtn);
    await flush(2);
    const tables = () => q('.campaign-tracker .modal-overlay');
    expect(tables(), 'fixture: the tables are open over a window').not.toBeNull();
    const tablesBox = tables()!.querySelector('.modal-box')!;

    /** Puts `layer` over all of the tables (the browser's hit test, which jsdom has not got) until it is
     *  gone, closing itself on Escape from its own `document` listener — and leaving the press unspent. */
    let over: HTMLElement | null = null;
    const doc = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
    doc.elementFromPoint = () => (over?.isConnected ? over : tablesBox);
    const realRect = Element.prototype.getBoundingClientRect;
    const box = { x: 100, y: 100, left: 100, top: 100, width: 400, height: 300, right: 500, bottom: 400 };
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.classList.contains('modal-box') ? ({ ...box, toJSON: () => box } as DOMRect) : realRect.call(this);
    };
    const listeners: ((e: KeyboardEvent) => void)[] = [];
    const closesItselfOnEscape = (layer: HTMLElement) => {
      over = layer;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') layer.remove();
      };
      listeners.push(onKey);
      document.addEventListener('keydown', onKey);
    };
    try {
      // A tracker popup on <body> (`.tracker-root`, as BodyPortal draws one).
      const popup = document.createElement('div');
      popup.className = 'tracker-root';
      document.body.appendChild(popup);
      closesItselfOnEscape(popup);
      await escapeOn(document.body);
      expect(popup.isConnected, 'fixture: the popup took the press').toBe(false);
      expect(tables(), 'a popup on <body> took the press: the tables under it stay').not.toBeNull();
      expect(windowsOpen(), 'so does the window behind them').toBe(1);
      expect(campaignUp(), 'and the campaign').toBe(true);
      await letGoOfEscape(document.body);

      // A layer inside the view, the press typed in its text box.
      const layer = document.createElement('div');
      const input = document.createElement('input');
      input.type = 'text';
      layer.appendChild(input);
      q('.campaign-tracker .ct-main')!.appendChild(layer);
      closesItselfOnEscape(layer);
      input.focus();
      await escapeOn(input);
      expect(layer.isConnected, 'fixture: the layer took the press').toBe(false);
      expect(tables(), 'a layer with a text box took the press: the tables under it stay').not.toBeNull();
      expect(windowsOpen()).toBe(1);
      expect(campaignUp()).toBe(true);
      await letGoOfEscape(document.body);

      // Nothing over the tables: the next press is theirs, then the window's, as always.
      await escapeOn(document.body);
      expect(tables(), 'the next press closes the tables').toBeNull();
      expect(windowsOpen(), 'the window stays').toBe(1);
      await letGoOfEscape(document.body);
      await escapeOn(document.body);
      expect(windowsOpen(), 'the next, the window').toBe(0);
      expect(campaignUp(), 'still in the campaign').toBe(true);
    } finally {
      for (const l of listeners) document.removeEventListener('keydown', l);
      delete doc.elementFromPoint;
      Element.prototype.getBoundingClientRect = realRect;
    }
  }, 180_000);

  it('(h) a stat block’s Edit converter in a window, another window opened OVER it: Escape closes THAT window — never the converter under it', async () => {
    /*
     * A floating window is a stacking context of its own: the converter opened in one is painted at that
     * window's z-index, overlay and all, and a window opened since (a link in the converter's preview) is
     * painted over it. One Escape closed the converter hidden under that window, its unsaved edits with it
     * (the G7s refuter, 2026-10-13). The press is now the window's; the converter stays.
     * MUTATIONS (tried 2026-10-13, each alone):
     *  - tracker/src/utils/spendEscape.ts windowUnderAnother: `return over ? win : null` → `return null` →
     *    fails at "Escape closed the window on top" (the converter took the press);
     *  - src/integration/CampaignTracker.tsx, the modals' Back handler: the `if (topTrackerModalUnderAWindow())
     *    { … }` branch dropped → fails at "Escape closed the window on top" (the press was left for the
     *    window and nothing closed it);
     *  - the same branch asking `trackerModalOpen()` (the converter's own overlay) for `trackerModalOverWindows()`
     *    → fails the same way;
     *  - spendEscape notTheModals: the press from inside the converter's own window no longer the
     *    converter's (`return !(e && …)` → `return true`) → fails at "both windows stay" (the host closed the
     *    box's window, the converter in it).
     */
    const { winA, converter } = await converterInAWindow();
    await windowOverTheConverter(winA);

    await escapeOn(document.body);
    expect(useWindowStore.getState().wins.map((w) => w.id), 'Escape closed the window on top').toEqual([winA]);
    expect(converter(), 'the converter under it stays').not.toBeNull();
    expect(campaignUp()).toBe(true);
    // Held: the repeats close nothing — not the converter, not the window that holds it.
    for (let i = 0; i < 3; i++) await escapeOn(document.body, { repeat: true });
    expect(converter(), 'held: the converter stays').not.toBeNull();
    expect(windowsOpen(), 'held: its window stays').toBe(1);
    await letGoOfEscape(document.body);

    // Typed INSIDE the converter (its box focused by Tab, which raises no window): the press is its own.
    await windowOverTheConverter(winA);
    const box = converter()!.querySelector('textarea')!;
    box.focus();
    await escapeOn(box);
    expect(converter(), 'typed in the converter: the press closed it').toBeNull();
    expect(windowsOpen(), 'both windows stay').toBe(2);
    expect(campaignUp()).toBe(true);
  }, 180_000);

  it('(h) …and a modal in the window ON TOP that the host cannot close (it lets its press go on) keeps the press, and Back, from closing that window too', async () => {
    /*
     * A stand-in `.modal-overlay` inside the window drawn over the converter — MonsterPartsPopup's way until
     * 2026-10-14 (it registers now; none ships this way, modalEscapeCoverage.test.ts): it closes itself on
     * Escape from its own `document` listener, leaves the press unspent, and is off the DOM before the
     * dismiss stack runs (the browser commits React between listeners; the stand-in removes itself). So
     * only the state AS OF THE PRESS can say it was up, as in (c).
     * MUTATIONS (tried 2026-10-13, src/integration/CampaignTracker.tsx, the modals' Back handler, each alone):
     *  - `modalOverWindowsAtPress.current ||` dropped → fails at "Escape: the window it was in stays";
     *  - `|| trackerModalOverWindows()` dropped → fails at "Back: the window under that modal stays".
     */
    const { triggerBack } = await import('../src/sheet/useEscapeClose');
    const { winA, converter } = await converterInAWindow();
    const winB = await windowOverTheConverter(winA);
    const stand = document.createElement('div');
    stand.className = 'modal-overlay';
    document.querySelector(`.campaign-tracker [data-float-win="${winB}"]`)!.appendChild(stand);

    // Back (no key): that modal is on screen over the windows, and no handler of the host's closes it.
    act(() => void triggerBack());
    await flush(1);
    expect(windowsOpen(), 'Back: the window under that modal stays').toBe(2);
    expect(converter(), 'and the converter').not.toBeNull();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stand.remove();
    };
    document.addEventListener('keydown', onKey);
    try {
      await escapeOn(document.body);
    } finally {
      document.removeEventListener('keydown', onKey);
    }
    expect(stand.isConnected, 'fixture: it took the press').toBe(false);
    expect(windowsOpen(), 'Escape: the window it was in stays').toBe(2);
    expect(converter(), 'and the converter').not.toBeNull();
    expect(campaignUp()).toBe(true);
    await letGoOfEscape(document.body);

    // Nothing over the window now: the next press is the window's.
    await escapeOn(document.body);
    expect(useWindowStore.getState().wins.map((w) => w.id), 'the next press closes the window on top').toEqual([winA]);
    expect(converter(), 'the converter stays').not.toBeNull();
  }, 180_000);

  it('(i) HELD DOWN after a tracker popup took the press — the stat block’s ☰ menu, the condition picker where the GM adds Dying: the repeats close no window and never leave the campaign', async () => {
    /*
     * A popup of the tracker's that closes itself on Escape from its own `document` listener and spends the
     * press — the stat block's ☰ menu (tracker/src/components/CombatantDetail.tsx HamburgerMenu) — is no
     * registered tracker layer, so no hold starts, and each repeat of the held key went on to the campaign's
     * dismiss stack: the window on top, then out of the campaign (the G7s refuter, 2026-10-13, measured on
     * the condition picker: two repeats, the campaign left twice). A repeat now closes no window and never
     * leaves — one press, one layer. The condition picker is a registered layer since 2026-10-14 (owner's
     * list, item 1: its Back), so its repeats are held by the tracker itself as well; the ☰ menu keeps the
     * campaign's own rule guarded.
     * MUTATIONS (tried 2026-10-14, src/integration/CampaignTracker.tsx, each alone):
     *  - closeWindowForPress: `if (repeatAtPress.current) return;` dropped → fails at "the ☰ menu — held:
     *    the window stays" (expected +0 to be 1);
     *  - the base handler's `if (repeatAtPress.current) return;` dropped → fails at "the ☰ menu — held, no
     *    window: still in the campaign" (expected false to be true).
     */
    await openCampaign();
    await bruteOnTheBoard();
    const row = [...document.querySelectorAll<HTMLElement>('.campaign-tracker .init-row')].find((r) =>
      (r.textContent ?? '').includes('Reed Brute'),
    );
    expect(row, 'fixture: the creature’s row').toBeTruthy();
    click(row!);
    await flush(2);
    /** A button of the stat block in the workspace pane (never one inside a floating window). */
    const paneButton = (pick: (b: HTMLButtonElement) => boolean) =>
      [...document.querySelectorAll<HTMLButtonElement>('.campaign-tracker button')].find((b) => !b.closest('[data-float-win]') && pick(b));
    const addCondition = () => paneButton((b) => b.textContent === '+ Condition');
    const options = () => paneButton((b) => b.title === 'Options');
    expect(addCondition(), 'fixture: the stat block’s + Condition').toBeTruthy();
    expect(options(), 'fixture: the stat block’s ☰').toBeTruthy();
    const search = () => document.querySelector<HTMLInputElement>('input[placeholder="Search conditions…"]');
    const scaleRow = () => [...document.querySelectorAll('.campaign-tracker *')].find((el) => el.textContent === 'Scale to') ?? null;

    const POPUPS: [string, () => void, () => Element | null, () => Element][] = [
      ['the ☰ menu', () => click(options()!), scaleRow, () => options()!],
      ['the condition picker', () => click(addCondition()!), search, () => search()!],
    ];
    for (const [what, open, shown, pressOn] of POPUPS) {
      // A window open over the board.
      openWindow();
      await flush(1);
      open();
      await flush(1);
      expect(shown(), `fixture: ${what} is open`).not.toBeNull();
      const at = pressOn() as HTMLElement;
      at.focus();
      await escapeOn(at);
      expect(shown(), `${what}: the press closed it`).toBeNull();
      expect(windowsOpen(), `${what}: the window stays`).toBe(1);
      for (let i = 0; i < 3; i++) await escapeOn(document.body, { repeat: true });
      expect(windowsOpen(), `${what} — held: the window stays`).toBe(1);
      expect(campaignUp(), `${what} — held: still in the campaign`).toBe(true);
      await letGoOfEscape(document.body);

      // No window.
      act(() => useWindowStore.getState().closeAll());
      await flush(1);
      open();
      await flush(1);
      expect(shown(), `fixture: ${what}, no window`).not.toBeNull();
      const at2 = pressOn() as HTMLElement;
      at2.focus();
      await escapeOn(at2);
      expect(shown(), `${what}: the press closed it (no window)`).toBeNull();
      for (let i = 0; i < 3; i++) await escapeOn(document.body, { repeat: true });
      expect(campaignUp(), `${what} — held, no window: still in the campaign`).toBe(true);
      await letGoOfEscape(document.body);
    }
    // Let go, a fresh press with nothing open leaves, as always.
    await escapeOn(document.body);
    expect(campaignUp(), 'a fresh press leaves').toBe(false);
  }, 180_000);

  it('(j) Heroes Heaven’s Settings → Initiative tracker → Turn timer: Escape on the DM’s turn-time graph closes the GRAPH — never the Settings page', async () => {
    /*
     * The graph closed itself from its own `document` listener and let the press go on to the Settings
     * page's handler: one Escape closed the graph AND Settings (owner's list 2026-10-14, item 2). It is a
     * registered tracker layer now (useEscapeCloses): it closes and spends the press.
     * MUTATION (tried 2026-10-14): TurnTimeline's `useEscapeCloses(onClose)` → a no-op ref → fails at "Escape
     * closed the graph" (no closer at all; the press went on and closed the Settings page instead).
     */
    const { settingsClosed, graph, restore } = await settingsTimerGraph();
    try {
      await escapeOn(document.body);
      expect(graph(), 'Escape closed the graph').toBeNull();
      expect(settingsClosed, 'the Settings page stays').not.toHaveBeenCalled();
      await letGoOfEscape(document.body);
      // Nothing open over Settings: the next press is Settings' own, as always.
      await escapeOn(document.body);
      expect(settingsClosed).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  }, 180_000);

  it('(k) the GM screen: Escape closes the + menu alone, then the "Add to GM Screen" picker alone — the campaign stays', async () => {
    /*
     * The + menu had no Escape at all, and the picker's Escape (its own listeners, test/gm-search-popup)
     * no Back: each is a registered tracker layer now while it is open (owner's list 2026-10-14, item 3).
     * MUTATIONS (tried 2026-10-14, tracker/src/components/GMScreen.tsx, each alone):
     *  - AddMenu's `useEscapeCloses(onClose, { panel: true })` → a no-op ref → fails at the first "the
     *    campaign stays" (expected false to be true: the press went on and LEFT THE CAMPAIGN, the menu with it);
     *  - AddReferencePicker's `useEscapeCloses(onClose)` → a no-op ref → fails at the second "the campaign
     *    stays" (with the focus off its box nothing closed the picker, and the press left).
     */
    const { fab, menu, addReference, picker } = await gmScreen();
    click(fab()!);
    await flush(1);
    expect(menu(), 'fixture: the + menu is open').not.toBeNull();
    await escapeOn(document.body);
    expect(menu(), 'Escape closed the + menu').toBeNull();
    expect(campaignUp(), 'the campaign stays').toBe(true);
    await letGoOfEscape(document.body);

    click(addReference()!);
    await flush(1);
    expect(picker(), 'fixture: the picker is open').not.toBeNull();
    (document.activeElement as HTMLElement | null)?.blur(); // a click on the box's padding
    await escapeOn(document.body);
    expect(picker(), 'Escape closed the picker').toBeNull();
    expect(campaignUp(), 'the campaign stays').toBe(true);
    await letGoOfEscape(document.body);
    await escapeOn(document.body);
    expect(campaignUp(), 'nothing open: the press leaves').toBe(false);
  }, 180_000);

  it('(k) the GM screen’s + menu with a window drawn over ALL of it: Escape closes that WINDOW, then the menu', async () => {
    /*
     * The + menu is drawn in the page (z 41), under the floating windows (500 and up): a window over all of
     * it is the layer on top. The menu leaves that press unspent (utils/spendEscape, covered all over), and
     * the campaign's handler for its layers closes the window — the windows' own handler is off the stack
     * while any tracker layer is registered.
     * MUTATION (tried 2026-10-14, tracker/src/utils/spendEscape.ts): `|| coveredAllOver(el, top.box(), …)`
     * dropped from topTrackerModalUnderAWindow → fails at "Escape closed the window over the menu"
     * (expected 1 to be +0: nothing closed at all).
     */
    const { fab, menu } = await gmScreen();
    openWindow();
    await flush(1);
    click(fab()!);
    await flush(1);
    expect(menu(), 'fixture: the + menu is open').not.toBeNull();
    const restore = windowOverAllOfTheMenu(menu);
    try {
      await escapeOn(document.body);
      expect(windowsOpen(), 'Escape closed the window over the menu').toBe(0);
      expect(menu(), 'the menu under it stays').not.toBeNull();
      expect(campaignUp()).toBe(true);
      await letGoOfEscape(document.body);
      await escapeOn(document.body);
      expect(menu(), 'the next press closes the menu').toBeNull();
      expect(campaignUp(), 'still in the campaign').toBe(true);
    } finally {
      restore();
    }
  }, 180_000);
});

/*
 * ANDROID'S BACK INSIDE THE TRACKER (G7s, 2026-10-13 — the G7e refuter's "outside the brief" finding).
 *
 * On the phone Back reaches the dismiss stack as a `popstate`, never as a key. The tracker's modals close
 * themselves from a `document` keydown listener (tracker/src/utils/spendEscape.ts useEscapeCloses), which
 * Back never reaches, and the campaign's `modalAtPress` is set only from a keydown — so Back with the
 * Encounter Building tables up closed the window hidden behind them or LEFT THE CAMPAIGN, and in Heroes
 * Heaven's Settings it closed the whole Settings page over the half-made table. Now, while any tracker
 * modal is open, CampaignTracker and TrackerSettingsSection put a Back handler on the stack that closes
 * the top one (closeTopTrackerModal, useTrackerModalCount), and both campaign handlers also stand down for
 * a tracker modal still on screen (`trackerModalOpen()` live) — Back with one the host cannot close (the
 * turn-time graph, a stand-in here) does nothing.
 *
 * The trap is the real one: the app started on a phone held upright (≤720 px), where the dismiss stack
 * installs its `popstate` listener and its one history entry; turned sideways the phone is wide enough for
 * the GM's table (CampaignsPage shows it above 720 px), and the trap stays. Each Back is a `popstate`,
 * exactly what the WebView fires. The desktop's Escape legs above run unchanged beside these.
 */
describe('Android’s Back inside the tracker', () => {
  /** The app started on a phone held upright: the dismiss stack's Back trap goes in, and stays. */
  async function phoneBackTrap(): Promise<void> {
    const { useEscapeClose } = await import('../src/sheet/useEscapeClose');
    const wide = window.matchMedia;
    window.matchMedia = ((qq: string) => ({ ...wide(qq), matches: qq === '(max-width: 720px)' })) as typeof window.matchMedia;
    function Upright() {
      useEscapeClose(undefined);
      return null;
    }
    const div = document.createElement('div');
    document.body.appendChild(div);
    const r = createRoot(div);
    try {
      act(() => r.render(<Upright />));
      act(() => r.unmount());
    } finally {
      window.matchMedia = wide;
      div.remove();
    }
  }
  /** Android's Back: the WebView pops the trap's history entry and fires `popstate`. No key at all. */
  async function back(): Promise<void> {
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    await flush(2);
  }

  it('BACK with the Encounter Building tables over a window closes the TABLES — then the window, then the campaign', async () => {
    /*
     * MUTATIONS (tried 2026-10-13, each alone, src/integration/CampaignTracker.tsx):
     *  - the `useBackHandler(synced && modalCount > 0, …)` handler dropped → fails at "Back closed the
     *    tables" (the windows' handler is off while a modal is up, the base handler stands down: Back did
     *    nothing);
     *  - `&& modalCount === 0` dropped from the windows' handler's gate → fails at "a window opened while
     *    the tables are up: Back still closes the tables" (that window put the windows' handler above the
     *    modals' and it stood down for the tables).
     */
    await phoneBackTrap();
    const tablesBtn = await campaignWithTablesButton();
    openWindow();
    await flush(1);
    click(tablesBtn);
    await flush(2);
    const tables = () => q('.campaign-tracker .modal-overlay');
    expect(tables(), 'fixture: the tables are open over a window').not.toBeNull();

    await back();
    expect(tables(), 'Back closed the tables').toBeNull();
    expect(windowsOpen(), 'the window hidden behind them stays').toBe(1);
    expect(campaignUp(), 'and the campaign').toBe(true);
    await back();
    expect(windowsOpen(), 'the next Back closes the window').toBe(0);
    expect(campaignUp(), 'still in the campaign').toBe(true);

    // The tables first, THEN a window (a link inside a modal opens one, drawn under it): Back is still
    // the tables'.
    click(tablesBtn);
    await flush(2);
    expect(tables(), 'fixture: the tables are open, no window').not.toBeNull();
    act(() => useWindowStore.getState().open('condition', 'synthetic hush', 'Synthetic Hush'));
    await flush(1);
    expect(windowsOpen(), 'fixture: a window opened while the tables are up').toBe(1);
    await back();
    expect(tables(), 'a window opened while the tables are up: Back still closes the tables').toBeNull();
    expect(windowsOpen(), 'that window stays').toBe(1);

    await back();
    expect(windowsOpen(), 'the next Back closes the window').toBe(0);
    expect(campaignUp(), 'still in the campaign').toBe(true);
    await back();
    expect(campaignUp(), 'nothing open: Back leaves, as always').toBe(false);
  }, 180_000);

  it('BACK with a tracker modal the host cannot close (a stand-in) does NOTHING — never the window behind it, never the campaign', async () => {
    /*
     * MUTATIONS (tried 2026-10-13, each alone, src/integration/CampaignTracker.tsx):
     *  - `|| trackerModalOpen()` dropped from the windows' handler → fails at "the window hidden behind the
     *    modal stays" (expected 0 to be 1);
     *  - `|| trackerModalOpen()` dropped from the base handler → fails at "no window: still in the
     *    campaign" (expected false to be true).
     */
    await phoneBackTrap();
    await openCampaign();
    openWindow();
    await flush(1);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    q('.campaign-tracker .ct-main')!.appendChild(modal);

    await back();
    expect(windowsOpen(), 'the window hidden behind the modal stays').toBe(1);
    expect(campaignUp()).toBe(true);

    act(() => useWindowStore.getState().closeAll());
    await flush(1);
    await back();
    expect(campaignUp(), 'no window: still in the campaign').toBe(true);

    modal.remove();
    await back();
    expect(campaignUp(), 'the modal gone: Back leaves, as always').toBe(false);
  }, 180_000);

  it('Add Combatants (MonsterSearch, on the host’s stack too): Escape closes it ONCE — and so does Back — never the window under it', async () => {
    /*
     * MonsterSearch now closes itself on Escape (useEscapeCloses) as well as being one of the campaign's
     * four registered overlays: the tracker's listener spends the press first, so the host's never hears
     * it, and its close runs exactly once.
     * MUTATION (tried 2026-10-13): drop BOTH spends — `e.stopImmediatePropagation()` in onModalKey and
     * `e.stopPropagation()` in spendEscape (tracker/src/utils/spendEscape.ts); either alone spends the
     * press — → fails at "Escape closed it once: expected [ [ false ], [ false ] ] to deeply equal
     * [ [ false ] ]" (the press went on to the host's stack, whose top handler closed it a second time).
     */
    await phoneBackTrap();
    await openCampaign();
    openWindow();
    await flush(1);
    const closes = vi.spyOn(trackerUi, 'setMonsterSearch');
    try {
      const picker = () => q('.campaign-tracker .modal-overlay');
      act(() => trackerUi.setMonsterSearch(true));
      await flush(2);
      expect(picker(), 'fixture: Add Combatants is open over a window').not.toBeNull();
      closes.mockClear();

      await escapeOn(document.body);
      expect(picker(), 'Escape closed it').toBeNull();
      expect(closes.mock.calls, 'Escape closed it once').toEqual([[false]]);
      expect(windowsOpen(), 'the window under it stays').toBe(1);
      expect(campaignUp()).toBe(true);
      await letGoOfEscape(document.body);

      act(() => trackerUi.setMonsterSearch(true));
      await flush(2);
      expect(picker(), 'fixture: open again').not.toBeNull();
      closes.mockClear();
      await back();
      expect(picker(), 'Back closed it').toBeNull();
      expect(closes.mock.calls, 'Back closed it once').toEqual([[false]]);
      expect(windowsOpen(), 'the window under it stays').toBe(1);
      expect(campaignUp()).toBe(true);
    } finally {
      closes.mockRestore();
    }
  }, 180_000);

  it('BACK in Heroes Heaven’s Settings → Initiative tracker → a new encounter table closes the EDITOR — the Settings page stays', async () => {
    /*
     * MUTATION (tried 2026-10-13): drop TrackerSettingsSection's `useBackHandler(modalCount > 0, …)`
     * (src/integration/TrackerSettingsSection.tsx) → fails at "Back closed the editor" (Back went to the
     * Settings page's own handler and closed the page, the half-made table with it).
     */
    await phoneBackTrap();
    const { SettingsPage } = await import('../src/sheet/SettingsPage');
    const { useEncounterTablesStore } = await import('../tracker/src/store/encounterTablesStore');
    act(() => useEncounterTablesStore.setState({ tables: [] }));
    const settingsClosed = vi.fn();
    const el = render(<SettingsPage onClose={settingsClosed} />);
    await flush();
    const button = (root: ParentNode, label: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label);
    click(button(el, 'Initiative tracker')!);
    for (let i = 0; i < 300 && !button(el, 'Encounter tables'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    }
    click(button(el, 'Encounter tables')!);
    await flush(2);
    click(button(el, 'New table')!);
    await flush(1);
    const editor = () => [...el.querySelectorAll('h2')].find((h) => h.textContent === 'New encounter table') ?? null;
    expect(editor(), 'fixture: the table editor is open').not.toBeNull();

    await back();
    expect(editor(), 'Back closed the editor').toBeNull();
    expect(settingsClosed, 'the Settings page stays').not.toHaveBeenCalled();
    expect(useEncounterTablesStore.getState().tables, 'nothing saved').toEqual([]);
    // Nothing open over Settings: the next Back is the page's own, as always.
    await back();
    expect(settingsClosed).toHaveBeenCalledTimes(1);
  }, 180_000);

  it('BACK with a stat block’s Edit converter in a window and another window opened OVER it closes THAT window — then the converter, then its window', async () => {
    /*
     * The converter is painted under a window opened since (Escape's leg: (h)). The windows' handler is off
     * the stack while a tracker modal is open, and Back closed the converter hidden under that window (the
     * G7s refuter, 2026-10-13). The modals' Back handler now closes the window on top.
     * MUTATION (tried 2026-10-13): drop the `if (topTrackerModalUnderAWindow()) { … }` branch from the
     * modals' Back handler (src/integration/CampaignTracker.tsx) → fails at "Back closed the window on top"
     * (closeTopTrackerModal closed nothing under the window, and nothing else ran).
     */
    await phoneBackTrap();
    const { winA, converter } = await converterInAWindow();
    await windowOverTheConverter(winA);

    await back();
    expect(useWindowStore.getState().wins.map((w) => w.id), 'Back closed the window on top').toEqual([winA]);
    expect(converter(), 'the converter under it stays').not.toBeNull();
    await back();
    expect(converter(), 'the next Back closes the converter').toBeNull();
    expect(windowsOpen(), 'its window stays').toBe(1);
    await back();
    expect(windowsOpen(), 'the next, the window').toBe(0);
    expect(campaignUp(), 'still in the campaign').toBe(true);
  }, 180_000);

  it('BACK with the tables up and Customize opened since — drawn UNDER every tracker modal — closes the TABLES first', async () => {
    /*
     * The modals' Back handler is a cover (useEscapeClose DismissUnder): what is drawn under the modals — the
     * player's sheet, the Customize panel (`under`) — waits its turn, whenever it was pushed. Nothing guarded
     * it (the G7s refuter, 2026-10-13: dropping `{ cover: true }` left every leg green).
     * MUTATION (tried 2026-10-13): drop `{ cover: true },` from the modals' Back handler (src/integration/
     * CampaignTracker.tsx) → fails at "Back closed the tables" (Customize, pushed later, took the Back).
     */
    await phoneBackTrap();
    const tablesBtn = await campaignWithTablesButton();
    click(tablesBtn);
    await flush(2);
    const tables = () => q('.campaign-tracker .modal-overlay');
    expect(tables(), 'fixture: the tables are open').not.toBeNull();
    act(() => trackerUi.setAppearance(true));
    await flush(2);
    const customize = () => document.querySelector('.tc-overlay');
    expect(customize(), 'fixture: Customize opened while the tables are up').not.toBeNull();

    await back();
    expect(tables(), 'Back closed the tables').toBeNull();
    expect(customize(), 'Customize, drawn under them, stays').not.toBeNull();
    await back();
    expect(customize(), 'the next Back closes Customize').toBeNull();
    expect(campaignUp(), 'still in the campaign').toBe(true);
  }, 180_000);

  it('BACK with the condition picker up — over a window, and with none — closes the PICKER only: never the window behind it, never the campaign', async () => {
    /*
     * The picker (where the GM adds Dying) closed itself only from a `document` key listener, which Back
     * never reaches: on a phone turned sideways, Back with only the picker up closed the window behind it
     * — or, with no window, LEFT THE CAMPAIGN (owner's list 2026-10-14, item 1). It is a registered tracker
     * layer now (tracker/src/components/ConditionPanel.tsx, useEscapeCloses), closed by the campaign's Back
     * handler for its layers.
     * MUTATION (tried 2026-10-14, ConditionPanel): `useEscapeCloses(onClose, { panel: true })` → a no-op
     * ref → fails at "Back closed the picker" (expected <input …> to be null: the windows' handler took the
     * Back and closed the window behind it).
     */
    await phoneBackTrap();
    await openCampaign();
    await bruteOnTheBoard();
    const row = [...document.querySelectorAll<HTMLElement>('.campaign-tracker .init-row')].find((r) =>
      (r.textContent ?? '').includes('Reed Brute'),
    );
    click(row!);
    await flush(2);
    const addCondition = () =>
      [...document.querySelectorAll<HTMLButtonElement>('.campaign-tracker button')].find(
        (b) => !b.closest('[data-float-win]') && b.textContent === '+ Condition',
      );
    const search = () => document.querySelector<HTMLInputElement>('input[placeholder="Search conditions…"]');
    expect(addCondition(), 'fixture: the stat block’s + Condition').toBeTruthy();

    openWindow();
    await flush(1);
    click(addCondition()!);
    await flush(1);
    expect(search(), 'fixture: the picker is open over the board, a window open').not.toBeNull();
    await back();
    expect(search(), 'Back closed the picker').toBeNull();
    expect(windowsOpen(), 'the window behind it stays').toBe(1);
    expect(campaignUp(), 'and the campaign').toBe(true);
    await back();
    expect(windowsOpen(), 'the next Back closes the window').toBe(0);
    expect(campaignUp()).toBe(true);

    click(addCondition()!);
    await flush(1);
    expect(search(), 'fixture: the picker, no window').not.toBeNull();
    await back();
    expect(search(), 'Back closed the picker (no window)').toBeNull();
    expect(campaignUp(), 'no window: the campaign stays').toBe(true);
    await back();
    expect(campaignUp(), 'nothing open: Back leaves, as always').toBe(false);
  }, 180_000);

  it('BACK with a party card’s turn-time graph over a window closes the GRAPH — then the window', async () => {
    /*
     * The party card's graph has a Back of the campaign's own (src/integration/MemberTurnButton.tsx,
     * useBackHandler), and since 2026-10-14 the graph is also a registered tracker layer (owner's list,
     * item 2), closed by the campaign's Back handler for its layers: two handlers for one graph. This pins
     * that one Back still closes ONE layer — the graph — and the window behind it stays.
     * NOT A MUTATION GUARD for the graph's registration: TurnTimeline's `useEscapeCloses(onClose)` → a no-op
     * ref stays GREEN here (tried 2026-10-14: MemberTurnButton's handler closes it). That registration's
     * Back is pinned by the Settings leg below, where no such handler exists, and its Escape by (c), (j).
     */
    await phoneBackTrap();
    useSettingsStore.setState({ turnTimerEnabled: true });
    srv.party = [publish(saved('char-a', 'Ayla Brightwood', 5), 'owner-a')];
    await openCampaign();
    openWindow();
    await flush(1);
    click(q('.party-grid .party-card .mt-turn-chip')!);
    await flush(2);
    const graph = () => q('.campaign-tracker .modal-overlay');
    expect(graph(), 'fixture: the graph is open, a window under it').not.toBeNull();

    await back();
    expect(graph(), 'Back closed the graph').toBeNull();
    expect(windowsOpen(), 'the window behind it stays').toBe(1);
    expect(campaignUp()).toBe(true);
    await back();
    expect(windowsOpen(), 'the next Back closes the window').toBe(0);
    expect(campaignUp(), 'still in the campaign').toBe(true);
  }, 180_000);

  it('BACK in Heroes Heaven’s Settings → Initiative tracker → Turn timer closes the DM’s GRAPH — the Settings page stays', async () => {
    /*
     * Back closed the Settings page with the graph still up (owner's list 2026-10-14, item 2): the graph was
     * no registered layer, so TrackerSettingsSection's Back handler never went on the stack.
     * MUTATION (tried 2026-10-14): TurnTimeline's `useEscapeCloses(onClose)` → a no-op ref → fails at "Back
     * closed the graph" (Back went to the page's own handler and closed Settings).
     */
    await phoneBackTrap();
    const { settingsClosed, graph, restore } = await settingsTimerGraph();
    try {
      await back();
      expect(graph(), 'Back closed the graph').toBeNull();
      expect(settingsClosed, 'the Settings page stays').not.toHaveBeenCalled();
      // Nothing open over Settings: the next Back is the page's own, as always.
      await back();
      expect(settingsClosed).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  }, 180_000);

  it('BACK on the GM screen closes the + menu alone, then the "Add to GM Screen" picker alone — the campaign stays', async () => {
    /*
     * Neither had a Back: with either open, Back LEFT THE CAMPAIGN (owner's list 2026-10-14, item 3).
     * MUTATIONS (tried 2026-10-14, tracker/src/components/GMScreen.tsx, each alone):
     *  - AddMenu's `useEscapeCloses(onClose, { panel: true })` → a no-op ref → fails at the first "the
     *    campaign stays" (expected false to be true: the base handler took the Back and left);
     *  - AddReferencePicker's `useEscapeCloses(onClose)` → a no-op ref → fails at the second "the campaign
     *    stays".
     */
    await phoneBackTrap();
    const { fab, menu, addReference, picker } = await gmScreen();
    click(fab()!);
    await flush(1);
    expect(menu(), 'fixture: the + menu is open').not.toBeNull();
    await back();
    expect(menu(), 'Back closed the + menu').toBeNull();
    expect(campaignUp(), 'the campaign stays').toBe(true);

    click(addReference()!);
    await flush(1);
    expect(picker(), 'fixture: the picker is open').not.toBeNull();
    await back();
    expect(picker(), 'Back closed the picker').toBeNull();
    expect(campaignUp(), 'the campaign stays').toBe(true);
    await back();
    expect(campaignUp(), 'nothing open: Back leaves, as always').toBe(false);
  }, 180_000);

  it('BACK with a window drawn over ALL of the GM screen’s + menu closes that WINDOW first, then the menu', async () => {
    /*
     * The + menu is drawn in the page, under the floating windows: covered all over by one, the window is
     * the layer on top. The windows' own handler is off the stack while a tracker layer is registered, so
     * the campaign's handler for its layers closes it (tracker/src/utils/spendEscape.ts
     * topTrackerModalUnderAWindow).
     * MUTATION (tried 2026-10-14, spendEscape): `|| coveredAllOver(el, top.box(), …)` dropped from
     * topTrackerModalUnderAWindow → fails at "Back closed the window over the menu" (nothing closed).
     */
    await phoneBackTrap();
    const { fab, menu } = await gmScreen();
    openWindow();
    await flush(1);
    click(fab()!);
    await flush(1);
    expect(menu(), 'fixture: the + menu is open').not.toBeNull();
    const restore = windowOverAllOfTheMenu(menu);
    try {
      await back();
      expect(windowsOpen(), 'Back closed the window over the menu').toBe(0);
      expect(menu(), 'the menu under it stays').not.toBeNull();
      await back();
      expect(menu(), 'the next Back closes the menu').toBeNull();
      expect(campaignUp(), 'still in the campaign').toBe(true);
    } finally {
      restore();
    }
  }, 180_000);

  it('(k) the GM screen’s + menu, then Customize from the top bar: the menu goes first — Escape and Back close Customize, the campaign stays', async () => {
    /*
     * The + menu's tap-catcher covers the GM screen only; the top bar stays within reach. Its palette opened
     * Customize (`.tc-overlay`, z 60) over ALL of the menu, and then Escape and Back did nothing at all, press
     * after press: the menu, covered all over, left both to the layer on top, and the campaign's Back handler
     * for the tracker's layers (a cover) kept Customize's own handler (drawn under them) off the stack (the
     * escape-lane refuter, 2026-10-14, measured in a real browser). The menu now closes on any press or focus
     * outside it (tracker/src/components/GMScreen.tsx AddMenu), so nothing opens over it.
     * MUTATIONS (tried 2026-10-14, GMScreen AddMenu, each line removed alone):
     *  - `document.addEventListener('mousedown', elsewhere)` → fails at "Escape closed Customize" (expected
     *    <div …> to be null: the dead end — Customize and the menu both stay);
     *  - `document.addEventListener('focusin', elsewhere)` → fails at "the keyboard's way: Escape closed
     *    Customize" (Tab to the palette and Enter press no mouse).
     */
    await phoneBackTrap();
    const { fab, menu } = await gmScreen();
    const palette = () => q<HTMLButtonElement>('button[aria-label="Customize tracker appearance"]');
    const customize = () => document.querySelector('.tc-overlay');
    expect(palette(), 'fixture: the top bar’s palette').not.toBeNull();
    /** A mouse or finger on the palette: the press, then the click. */
    const tapPalette = () => {
      act(() => void palette()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
      click(palette()!);
    };
    // The browser's hit test: Customize, while it is up, is drawn over all of the menu.
    const restore = layerOverAllOfTheMenu(menu, customize);
    try {
      click(fab()!);
      await flush(1);
      expect(menu(), 'fixture: the + menu is open').not.toBeNull();
      tapPalette();
      await flush(1);
      expect(customize(), 'fixture: Customize is open').not.toBeNull();
      await escapeOn(document.body);
      expect(customize(), 'Escape closed Customize').toBeNull();
      expect(menu(), 'the menu went with the press on the palette').toBeNull();
      expect(campaignUp(), 'the campaign stays').toBe(true);
      await letGoOfEscape(document.body);

      click(fab()!);
      await flush(1);
      expect(menu(), 'fixture: the + menu is open again').not.toBeNull();
      tapPalette();
      await flush(1);
      expect(customize(), 'fixture: Customize is open again').not.toBeNull();
      await back();
      expect(customize(), 'Back closed Customize').toBeNull();
      expect(menu(), 'the menu went with the press on the palette').toBeNull();
      expect(campaignUp(), 'the campaign stays').toBe(true);

      // The keyboard's way: Tab to the palette (the focus moves there), Enter (a click, no mouse press).
      click(fab()!);
      await flush(1);
      expect(menu(), 'fixture: the + menu is open, a third time').not.toBeNull();
      act(() => palette()!.focus());
      click(palette()!);
      await flush(1);
      expect(customize(), 'fixture: Customize is open, by the keyboard').not.toBeNull();
      await escapeOn(palette()!);
      expect(customize(), 'the keyboard’s way: Escape closed Customize').toBeNull();
      expect(menu(), 'the menu went when the focus left it').toBeNull();
      expect(campaignUp(), 'the campaign stays').toBe(true);
      await letGoOfEscape(palette()!);
    } finally {
      restore();
    }
  }, 180_000);
});
