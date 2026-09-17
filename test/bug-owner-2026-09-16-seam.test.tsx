// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
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

/**
 * THE OWNER'S LIST OF 2026-09-16 — the four the seam owns.
 *
 *  A. The rail's "Quick add by name…" box is gone (quick add moved into the Add-combatants popup).
 *  B. A party card's kick button sat ON TOP of the card's chevron: both unreadable, only one
 *     clickable.
 *  C. A GM can drag a player's card onto the initiative rail to put that PC in the order.
 *  D. Clicking a PC in the initiative order dropped the GM straight into the editable sheet, with
 *     the "GM editing X" strip hidden and only a pane × to leave by. The pane holds the player's
 *     CARD now; the card opens the full sheet (strip and all) and its Back arrow returns to the card.
 */

const srv = vi.hoisted(() => ({
  party: [] as PartyMember[],
  sheets: new Map<string, unknown>(),
  pushes: [] as { charId: string }[],
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
  subscribeMemberSheet: () => () => undefined,
  subscribeParty: () => () => undefined,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  subscribeGmEdits: () => () => undefined,
  pushGmEdit: async (_campaignId: string, charId: string) => {
    srv.pushes.push({ charId });
    return { ok: true, value: null };
  },
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
  const db = content();
  srv.sheets.set(sc.id, sc);
  return { ownerId, charId: sc.id, name: sc.character.name, summary: computeSummary(sc.character, db) };
}

const PC_A = () => saved('char-a', 'Ayla Brightwood', 5);
const PC_B = () => saved('char-b', 'Doran Vex', 6);

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

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

const q = (sel: string) => host?.querySelector(sel) ?? null;
const qq = (sel: string) => [...(host?.querySelectorAll(sel) ?? [])];

const btn = (label: string): HTMLElement => {
  const all = [...(host?.querySelectorAll('button') ?? [])];
  const el = all.find((b) => (b.textContent ?? '').trim().includes(label) || b.title === label);
  if (!el) throw new Error(`no button labelled "${label}" — found: ${all.map((b) => JSON.stringify((b.textContent ?? '').trim() || b.title)).join(', ')}`);
  return el;
};

/** A button in a confirmDialog — those mount in their own root on <body>, outside the app tree. */
const dialogBtn = (label: string): HTMLElement => {
  const all = [...document.querySelectorAll('button')].filter((b) => !host?.contains(b));
  const el = all.find((b) => (b.textContent ?? '').trim() === label);
  if (!el) throw new Error(`no dialog button "${label}" — found: ${all.map((b) => JSON.stringify((b.textContent ?? '').trim())).join(', ')}`);
  return el;
};

/*
 * jsdom has no DataTransfer and no DragEvent, so a drag is spelled out by hand: the payload the
 * source wrote, carried on a plain bubbling Event that React reads `dataTransfer` off exactly as it
 * would a real one.
 */
function makeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    get types() {
      return [...store.keys()];
    },
    setData: (t: string, v: string) => void store.set(t, v),
    getData: (t: string) => store.get(t) ?? '',
    dropEffect: 'none',
    effectAllowed: 'none',
  } as unknown as DataTransfer;
}

function fireDrag(el: Element, type: 'dragstart' | 'dragover' | 'dragleave' | 'drop', dataTransfer: DataTransfer): void {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
  act(() => void el.dispatchEvent(ev));
}

beforeEach(() => {
  localStorage.clear();
  srv.party = [];
  srv.sheets.clear();
  srv.pushes.length = 0;
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
  // A confirmDialog tears its own root down on a timer; drop anything still parked on <body>.
  for (const n of [...document.body.children]) n.remove();
  vi.unstubAllGlobals();
});

async function openTracker(): Promise<HTMLElement> {
  const { CampaignTracker } = await import('../src/integration/CampaignTracker');
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() =>
    live!.render(
      <CampaignTracker
        m={CAMPAIGN}
        content={content()}
        onOpenSettings={() => undefined}
        onLeave={() => undefined}
        onViewMember={() => undefined}
      />,
    ),
  );
  await flush();
  return host;
}

describe('the owner’s 2026-09-16 list — the seam', () => {
  // ── A ──────────────────────────────────────────────────────────────────────
  it('has no quick-add box in the rail, and still clears the board', async () => {
    // owner 2026-09-16: A
    srv.party = [publish(PC_A(), 'owner-a')];
    await openTracker();

    // The box is gone — by placeholder AND by the class it was styled with, so neither a reworded
    // placeholder nor a reused class quietly puts a text field back in the rail.
    expect(qq('.ct-rail-foot input')).toHaveLength(0);
    expect(qq('input').map((i) => (i as HTMLInputElement).placeholder)).not.toContain('Quick add by name…');
    expect(qq('.ct-rail-add')).toHaveLength(0);

    // The two controls that stay.
    expect(btn('Add combatants')).toBeTruthy();
    const clear = btn('Clear') as HTMLButtonElement;
    expect(clear.disabled).toBe(true); // nothing on the board yet

    act(() => useCombatStore.getState().addCombatant(null, { name: 'Road Ogre' }));
    await flush(1);
    expect((btn('Clear') as HTMLButtonElement).disabled).toBe(false);

    // Clear really does empty the board (it clears combatants, never the quick-add text it used to
    // sit beside) — through its own confirm, since this app never uses a native confirm().
    click(btn('Clear'));
    await flush(1);
    click(dialogBtn('Clear'));
    await flush(1);
    expect(useCombatStore.getState().combatants).toHaveLength(0);
  }, 120_000);

  // ── B ──────────────────────────────────────────────────────────────────────
  it('keeps a party card’s kick button off its chevron', async () => {
    // owner 2026-09-16: B
    srv.party = [publish(PC_A(), 'owner-a')];
    await openTracker();

    const card = q('.party-card');
    expect(card).toBeTruthy();
    // The kick is a GM control on someone else's character — it is on this card.
    expect(card!.querySelector('.party-kick')).toBeTruthy();
    // …and so is the chevron. Both present is the whole point: they used to occupy the same corner.
    expect(card!.querySelector('.party-chev')).toBeTruthy();
    /*
     * SETTLED A DIFFERENT WAY, 2026-09-16 (design C) and again on 2026-09-17 (two rows): the kick is
     * a trash can at the bottom left of the card's BODY — under the reference row — so it cannot
     * share the header's corner at all, and the clearance padding that used to hold the chevron off
     * it is gone with the absolute positioning it was compensating for. A different block is a
     * stronger guarantee than a reserved 28px. (It spent one pass on a footer row of its own; the
     * owner said it doesn't need a row, so there is no `.party-foot` any more.)
     */
    expect(card!.querySelector('.party-card-h .party-kick')).toBeNull();
    expect(card!.querySelector('.party-card-body > .party-kick')).toBeTruthy();
    expect(card!.querySelector('.party-foot')).toBeNull();

    const css = readFileSync('src/sheet.css', 'utf8');
    expect(/\.party-kick\s*\{[^}]*\}/.exec(css)?.[0] ?? '').not.toMatch(/position:\s*absolute/);
  }, 120_000);

  // ── C ──────────────────────────────────────────────────────────────────────
  it('adds a PC to the initiative order when their card is dropped on the rail', async () => {
    // owner 2026-09-16: C
    const a = PC_A();
    srv.party = [publish(a, 'owner-a'), publish(PC_B(), 'owner-b')];
    await openTracker();

    const card = q('.party-card')!;
    const rail = q('.ct-order')!;

    // The card writes the payload; the rail reads it. One DataTransfer carries it between them, so
    // the two halves can never be tested against a payload only the test believes in.
    const data = makeDataTransfer();
    fireDrag(card, 'dragstart', data);
    expect(data.types).toContain('application/x-hh-party-member');
    expect(JSON.parse(data.getData('application/x-hh-party-member'))).toMatchObject({
      charId: 'char-a',
      name: 'Ayla Brightwood',
    });

    // Hovering the rail highlights it — the GM has to be able to see where the card can land.
    fireDrag(rail, 'dragover', data);
    await flush(1);
    expect(q('.ct-order')!.classList.contains('is-drop')).toBe(true);

    fireDrag(rail, 'drop', data);
    await flush(1);
    expect(q('.ct-order')!.classList.contains('is-drop')).toBe(false);

    const pcs = useCombatStore.getState().combatants.filter((c) => c.isPC);
    expect(pcs.map((c) => c.name)).toEqual(['Ayla Brightwood']);
    // No initiative — the drop position in the list is not a roll.
    expect(pcs[0].initiative).toBeNull();
    // The real character's HP, not a zero-HP placeholder.
    expect(pcs[0].maxHP).toBeGreaterThan(0);
    expect(pcs[0].maxHP).toBe(a.character.hitPoints.current);

    // Dropping the same PC again does nothing — and says so, rather than reading as a dead target.
    fireDrag(rail, 'drop', data);
    await flush(1);
    expect(useCombatStore.getState().combatants.filter((c) => c.isPC)).toHaveLength(1);
    expect(q('.ct-order-drop-msg')?.textContent).toContain('already in the initiative order');
  }, 120_000);

  it('leaves the tracker’s own row drag alone', async () => {
    // owner 2026-09-16: C — the rail is also where an initiative row's drag starts, and that one
    // belongs to the tracker: the seam must not claim it or light up for it.
    srv.party = [publish(PC_A(), 'owner-a')];
    await openTracker();
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Road Ogre' }));
    await flush(1);

    const rail = q('.ct-order')!;
    const other = makeDataTransfer();
    other.setData('application/x-pf2e-combatant', 'some-cid');

    fireDrag(rail, 'dragover', other);
    await flush(1);
    expect(q('.ct-order')!.classList.contains('is-drop')).toBe(false);

    fireDrag(rail, 'drop', other);
    await flush(1);
    expect(useCombatStore.getState().combatants.map((c) => c.name)).toEqual(['Road Ogre']);
    expect(q('.ct-order-drop-msg')).toBeNull();
  }, 120_000);

  // ── D ──────────────────────────────────────────────────────────────────────
  it('opens a PC row on their CARD, the card on the sheet, and the sheet’s back arrow on the card', async () => {
    // owner 2026-09-16: D
    const a = PC_A();
    const db = content();
    const max = a.character.hitPoints.current;
    // The player is hurt on their OWN sheet — the card in the pane has to show that, not the
    // summary frozen at whatever the dashboard last fetched.
    a.play = { ...initialPlay(a.character, db), damage: 11, conditions: [{ id: 'frightened', value: 2 }] };
    srv.party = [publish(a, 'owner-a')];
    await openTracker();

    act(() => useCombatStore.getState().addCombatant(null, { name: 'Ayla Brightwood', isPC: true, maxHP: max }));
    await flush(2);

    // Click the PC's row in the initiative order.
    const row = qq('.init-row').find((r) => (r.textContent ?? '').includes('Ayla Brightwood'));
    expect(row).toBeTruthy();
    click(row!);
    await flush(2);

    // → their CARD in the pane, not an editable sheet.
    const paneCard = q('.ct-pane-card .party-card');
    expect(paneCard).toBeTruthy();
    expect(q('.ct-pane-card .ws-app')).toBeNull();
    // No kick button on this one — it's a pane, not the GM's dashboard.
    expect(paneCard!.querySelector('.party-kick')).toBeNull();
    // Live HP off the player's sheet: 11 damage taken.
    expect(paneCard!.querySelector('.party-hp')?.textContent).toContain(String(max - 11));
    expect(paneCard!.querySelector('.party-chips')?.textContent).toContain('Frightened 2');

    // Click the card → the full GM-edit sheet, WITH the warm strip the pane version never had.
    click(paneCard!);
    await flush(2);
    const sheet = q('.ct-sheet-full');
    expect(sheet).toBeTruthy();
    expect(sheet!.querySelector('.gm-edit-tab')).toBeTruthy();
    expect(sheet!.querySelector('.gm-edit-tab')!.textContent).toContain('GM editing Ayla Brightwood');

    // Back → the CARD, still in its pane. Not the dashboard, and not out of the tracker.
    click(btn('Back to campaign'));
    await flush(2);
    expect(q('.ct-sheet-full')).toBeNull();
    expect(q('.ct-pane-card .party-card')).toBeTruthy();
    expect(q('.ct-order')).toBeTruthy(); // the initiative order is where it was
  }, 120_000);

  it('keeps the party dashboard’s own card → sheet flow', async () => {
    // owner 2026-09-16: D — out of combat a dashboard card still opens the sheet directly, and back
    // from it lands on the dashboard rather than in the workspace.
    srv.party = [publish(PC_A(), 'owner-a')];
    await openTracker();

    click(q('.party-card')!);
    await flush(2);
    expect(q('.ct-sheet-full')).toBeTruthy();
    expect(q('.ct-sheet-full .gm-edit-tab')).toBeTruthy();

    click(btn('Back to campaign'));
    await flush(2);
    expect(q('.ct-sheet-full')).toBeNull();
    expect(q('.party-grid .party-card')).toBeTruthy();
  }, 120_000);
});
