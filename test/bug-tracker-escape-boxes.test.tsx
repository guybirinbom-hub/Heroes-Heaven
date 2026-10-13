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
import { useLayoutStore } from '../tracker/src/store/layoutStore';
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
 *      with no window open, left the campaign with the modal still up).
 *  (c) The same for a party card's TURN-TIME GRAPH: opened before a window, the window's handler sits on
 *      top of the graph's — and the graph closes itself from its own `document` listener, which in a real
 *      browser takes it off the DOM before the windows' handler runs. Asked as of the key press
 *      (CampaignTracker's capture listener), the window still stands down.
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
 *  `document` to `window`, where the dismiss stack listens. */
async function escapeOn(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  await flush(2);
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

  it('(b) the Encounter Building tables over a window: Escape closes neither the hidden window nor the campaign', async () => {
    /*
     * MUTATIONS (tried 2026-10-13, each alone, in src/integration/CampaignTracker.tsx):
     *  - drop `if (modalAtPress.current) return;` from the windows' handler → fails at "the window
     *    hidden behind the tables stays" (expected 0 to be 1);
     *  - drop `|| modalAtPress.current` from the base handler → fails at "no window: still in the
     *    campaign" (it left with the tables up).
     */
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
    openWindow();
    await flush(1);
    click(tablesBtn!);
    await flush(2);
    const tables = () => q('.campaign-tracker .modal-overlay');
    expect(tables(), 'fixture: the tables are open').not.toBeNull();
    expect(windowsOpen(), 'fixture: a window under them').toBe(1);

    await escapeOn(document.body);
    expect(windowsOpen(), 'the window hidden behind the tables stays').toBe(1);
    expect(campaignUp()).toBe(true);

    act(() => useWindowStore.getState().closeAll());
    await flush(1);
    expect(tables()).not.toBeNull();
    await escapeOn(document.body);
    expect(campaignUp(), 'no window: still in the campaign').toBe(true);

    // Closed by its own backdrop, nothing is left above the campaign: Escape leaves as always.
    act(() => void tables()!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush(1);
    expect(tables()).toBeNull();
    await escapeOn(document.body);
    expect(campaignUp(), 'nothing open: the press leaves').toBe(false);
  }, 180_000);

  it('(c) a party card’s turn-time graph opened BEFORE a window: Escape closes the graph — never the window behind it', async () => {
    /*
     * In the browser's order: the graph's own `document` listener closes it and React commits that
     * before the windows' handler (on `window`) runs, so only the state AS OF THE PRESS can say a modal
     * was up. A second `document` listener flushes React exactly where the browser's checkpoint would.
     * MUTATION (tried 2026-10-13): drop `if (modalAtPress.current) return;` from the windows' handler
     * (src/integration/CampaignTracker.tsx) and this fails —
     *   AssertionError: the window behind the graph stays: expected 0 to be 1
     * (a check made when the handler runs would find nothing: the fixture line below pins that the graph
     * is already off the DOM by then).
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
    openWindow(); // its handler goes on the stack ABOVE the graph's
    await flush(1);
    expect(windowsOpen()).toBe(1);

    const { flushSync } = await import('react-dom');
    let goneBeforeTheStack = false;
    const checkpoint = () => {
      flushSync(() => undefined);
      goneBeforeTheStack = !document.querySelector('.campaign-tracker .modal-overlay');
    };
    document.addEventListener('keydown', checkpoint);
    const was = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = was;
      document.removeEventListener('keydown', checkpoint);
    }
    await flush(2);

    expect(goneBeforeTheStack, 'fixture: the graph was off the DOM before the dismiss stack ran').toBe(true);
    expect(graph(), 'the graph closed').toBeNull();
    expect(windowsOpen(), 'the window behind the graph stays').toBe(1);
    expect(campaignUp()).toBe(true);
    // The next press, nothing over the window: it closes the window, as always.
    await escapeOn(document.body);
    expect(windowsOpen()).toBe(0);
    expect(campaignUp()).toBe(true);
  }, 180_000);
});
