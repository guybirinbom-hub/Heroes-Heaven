// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay, applyPlayState } from '../src/rules/play';
import { computeSummary } from '../src/sheet/partySummary';
import type { SavedChar } from '../src/data/storage';
import type { CampaignMembership } from '../src/data/campaigns';
import type { PartyMember } from '../src/data/party';
import type { ContentDatabase, InventoryItem } from '../src/rules/types';
import { foreignContent, withCarriedAttached } from '../src/data/carried';
import { useCombatStore } from '../tracker/src/store/combatStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { useGmLayoutStore, useLayoutStore } from '../tracker/src/store/layoutStore';
import { useWindowStore, BASE_Z } from '../tracker/src/store/windowStore';
import { trackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';
import { clearGmPendingEdits } from '../src/sheet/gmSync';

/**
 * A PIN OF A RECORD ONLY A PLAYER'S SHEET CARRIES, ON THE GM SCREEN (2026-10-20, checker finding N2).
 *
 * Every description popup keeps PinStar; in the tracker the star pins the page to the GM screen as its
 * `bucket:id` alone (CampaignTracker gmPin → a `host` pane tab), and the pane draws it with HostPage from
 * the GM's database. A player's own item (owner ruling 2026-10-20: "the others should see the same item as
 * the player") is in no database of his — it rides on the player's sheet (`SavedChar.carried`) — so the
 * pane said "This page is not in this version of Heroes Heaven" and had no star to take it off again.
 * The windows and the panes now draw from `partyContent`: his database, with the party's carried records
 * filling only the ids it lacks (src/data/carried.ts). A printed pin draws exactly as before.
 *
 * The real seam (CampaignTracker, signed in as the GM, the party mocked as the server); every name synthetic.
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
  fetchPublishedSheet: async (_campaignId: string, charId: string) => {
    const sheet = srv.sheets.get(charId);
    return sheet ? { sheet, ownerId: srv.party.find((m) => m.charId === charId)?.ownerId, updatedAt: '2026-10-20T10:00:00.000Z' } : null;
  },
  subscribeMemberSheet: () => () => undefined,
  subscribeParty: () => () => undefined,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  subscribeGmEdits: () => () => undefined,
  pushGmEdit: async () => ({ ok: true, value: null }),
}));

const CAMPAIGN: CampaignMembership = { id: 'camp-n2', code: 'N2CODE', role: 'gm', name: 'The Salt Marches' };

/** The PLAYER's own item — made on their device; the GM's database has no such record. */
const LOCKET = {
  id: 'custom-player-tide-locket-n2',
  name: 'Tide Locket of Wren',
  itemType: 'equipment',
  level: 1,
  bulk: 0,
  traits: [],
  rarity: 'common',
  description: 'A locket that hums when the tide turns.',
  source: { license: 'homebrew' },
};

function playerSheet(): SavedChar {
  const db = content();
  const build = {
    ...emptyBuild(),
    name: 'Wren Halloway',
    level: 1,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    classId: 'fighter',
    keyAbility: 'str',
    campaignIds: [CAMPAIGN.id],
  } as BuildState;
  const character = buildCharacter(build, db);
  const play = initialPlay(character, db);
  const sc = { id: 'char-n2', character, build, play: { ...play, inventory: [...(play.inventory ?? []), { instanceId: 'loc-1', itemId: LOCKET.id, quantity: 1 } as InventoryItem] } } as SavedChar;
  // As the player's app publishes it: the records it uses ride along (collected from their own database).
  const ownerDb = { ...db, items: { ...db.items, [LOCKET.id]: LOCKET } } as unknown as ContentDatabase;
  return withCarriedAttached(sc, foreignContent(ownerDb, sc));
}
function publish(sc: SavedChar, ownerId: string): PartyMember {
  const db = content();
  srv.sheets.set(sc.id, sc);
  const live = applyPlayState(sc.character, sc.play, db);
  return { ownerId, charId: sc.id, name: sc.character.name, summary: computeSummary(live, db) };
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
async function until(what: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 60 && !what(); i++) await flush(1);
  expect(what(), label).toBe(true);
}
const click = (el: Element | null) => act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
/** The GM-screen pane drawing the tab titled `title`. */
const paneOf = (title: string) =>
  [...(host?.querySelectorAll<HTMLElement>('[data-pane-leaf]') ?? [])].find((p) => (p.textContent ?? '').includes(title));

beforeEach(() => {
  localStorage.clear();
  srv.party = [];
  srv.sheets.clear();
  clearGmPendingEdits();
  rememberCampaign(null);
  setOnCampaignsPage(false);
  trackerUi.reset();
  useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false, diceResults: [] });
  usePartyStore.setState({ parties: [], activePartyId: null });
  useLayoutStore.setState({ root: null, hoveredCid: null });
  useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null });
  useWindowStore.setState({ wins: [], topZ: BASE_Z });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null, addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  const files: Record<string, string> = { 'core.json': 'public/core.json', 'core-descriptions.json': 'public/core-descriptions.json' };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = files[String(url).split('/').pop() ?? ''];
    if (!path) return { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
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
  useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null });
  trackerUi.reset();
  vi.unstubAllGlobals();
});

async function openTracker(): Promise<HTMLElement> {
  const { CampaignTracker } = await import('../src/integration/CampaignTracker');
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() =>
    live!.render(
      <CampaignTracker m={CAMPAIGN} content={content()} onOpenSettings={() => undefined} onLeave={() => undefined} onViewMember={() => undefined} />,
    ),
  );
  await flush();
  return host;
}

describe("a pin of a player's carried record on the GM screen", () => {
  it('the pane draws the record from the party’s sheet, with the star that unpins it; a printed pin draws as before', async () => {
    // mutation-proof: give CampaignTracker's hostSearch `render` / `controls` the plain `content` (not
    // `hostContent`, src/integration/CampaignTracker.tsx) and this goes red: the pane reads "This page is not
    // in this version of Heroes Heaven", with no star.
    const sheet = playerSheet();
    expect(Object.keys(sheet.carried?.items ?? {}), 'fixture: the published sheet carries the locket').toEqual([LOCKET.id]);
    expect(content().items[LOCKET.id], 'fixture: the GM’s database has no such record').toBeUndefined();
    srv.party = [publish(sheet, 'owner-n2')];
    await openTracker();

    // What the star of the locket's popup does (CampaignTracker gmPin.toggle), and a printed pin beside it.
    const frightened = content().conditions?.frightened as { name: string } | undefined;
    expect(frightened, 'fixture: a printed record to pin').toBeTruthy();
    act(() => {
      useGmLayoutStore.getState().addPopup({ type: 'host', ref: `items:${LOCKET.id}`, title: LOCKET.name });
      useGmLayoutStore.getState().addPopup({ type: 'host', ref: 'conditions:frightened', title: frightened!.name });
    });
    act(() => trackerUi.showMain('gm'));
    await until(() => (host!.textContent ?? '').includes(LOCKET.description), 'the locket’s page, drawn from the party’s sheet');
    expect(host!.textContent ?? '').not.toContain('This page is not in this version');

    // The pane holding the locket: focus its tab, so its star is the one drawn.
    const gm = useGmLayoutStore.getState();
    const leafOf = (ref: string) => {
      const walk = (n: typeof gm.root): { id: string; idx: number } | null => {
        if (!n) return null;
        if (n.kind === 'leaf') {
          const idx = n.tabs.findIndex((t) => t.type === 'host' && t.ref === ref);
          return idx >= 0 ? { id: n.id, idx } : null;
        }
        return walk(n.a) ?? walk(n.b);
      };
      return walk(useGmLayoutStore.getState().root);
    };
    const at = leafOf(`items:${LOCKET.id}`);
    expect(at, 'fixture: the locket is a GM-screen tab').not.toBeNull();
    act(() => useGmLayoutStore.getState().focusTab(at!.id, at!.idx));
    await flush(2);
    const pane = paneOf(LOCKET.description);
    expect(pane, 'the locket’s pane').toBeTruthy();
    const star = pane!.querySelector<HTMLButtonElement>('[data-host-controls] .info-star.on');
    expect(star, 'every description popup keeps the favourite star').not.toBeNull();
    expect(star!.title).toBe('Remove from GM screen');

    // The printed pin: unchanged.
    const p = leafOf('conditions:frightened');
    act(() => useGmLayoutStore.getState().focusTab(p!.id, p!.idx));
    await until(() => !!paneOf(frightened!.name)?.querySelector('[data-host-controls] .info-star.on'), 'the printed pin draws with its star, as before');

    // …and the locket's star takes it off the GM screen.
    act(() => useGmLayoutStore.getState().focusTab(at!.id, at!.idx));
    await flush(2);
    click(paneOf(LOCKET.description)!.querySelector('[data-host-controls] .info-star.on'));
    await flush(1);
    expect(leafOf(`items:${LOCKET.id}`), 'unpinned').toBeNull();
    expect(leafOf('conditions:frightened'), 'the printed pin stays').not.toBeNull();
  }, 120_000);
});
