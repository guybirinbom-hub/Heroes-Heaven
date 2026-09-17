// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { computeSummary } from '../src/sheet/partySummary';
import { ROSTER_KEY, type SavedChar } from '../src/data/storage';
import type { CampaignMembership } from '../src/data/campaigns';
import type { PartyMember } from '../src/data/party';
import type { Creature } from '../tracker/src/types/pf2e';
import { useCombatStore } from '../tracker/src/store/combatStore';
import { DELAY_MIME, DELAY_RETURN_MIME } from '../tracker/src/components/InitiativeTracker';
import { usePartyStore, type Party } from '../tracker/src/store/partyStore';
import { useLayoutStore } from '../tracker/src/store/layoutStore';
import { trackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';

/**
 * THE SEAM between Heroes Heaven and the initiative tracker, as a GM actually meets it.
 *
 * Every leg here reproduces something the seam got wrong in a RELEASE build, not in dev:
 *  (a) the party bridge was gated on a dev-only flag, so a signed-in GM opened their campaign on
 *      "Party not found." and the encounter badge rated every fight against a level-1 party of one;
 *  (b) a PC's HP and conditions were a tracker-local copy, so what the GM saw was not what the
 *      player had, and what the GM applied never reached them;
 *  (c) Escape inside any tracker overlay LEFT THE CAMPAIGN;
 *  (d) the floating character-undo pair sat on a screen where Ctrl+Z undoes the combat;
 *  (e) Ctrl+K was advertised on the Search button and bound nowhere;
 *  (f) the tracker's own ErrorBoundary was never mounted inside HH, so one bad stat block took the
 *      whole campaign down;
 *  (g) the GM half of the page was on phones, where the owner does not want it.
 */

const srv = vi.hoisted(() => ({
  /** What fetchParty answers — the campaign's published members. */
  party: [] as PartyMember[],
  /** How the party read behaves: answered, refused (null), or still in flight. */
  partyFetch: 'ok' as 'ok' | 'fail' | 'pending',
  /** Whether the server accepts a GM edit (false = an RLS refusal). */
  pushOk: true,
  /** charId → the published SavedChar fetchMemberSheet answers. */
  sheets: new Map<string, unknown>(),
  /** Every pushGmEdit the seam made. */
  pushes: [] as { charId: string; ownerId: string; sheet: SavedChar }[],
  /** charId → the Realtime callback, so a test can publish a new sheet. */
  sheetCbs: new Map<string, () => void>(),
}));

// A RELEASE build: the dev flag that used to gate the whole party bridge is off.
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
  fetchParty: async () => {
    if (srv.partyFetch === 'fail') return null;
    if (srv.partyFetch === 'pending') return await new Promise<PartyMember[]>(() => undefined);
    return srv.party;
  },
  fetchMemberSheet: async (_campaignId: string, charId: string) => srv.sheets.get(charId) ?? null,
  subscribeMemberSheet: (_campaignId: string, charId: string, cb: () => void) => {
    srv.sheetCbs.set(charId, cb);
    return () => srv.sheetCbs.delete(charId);
  },
  subscribeParty: () => () => undefined,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  subscribeGmEdits: () => () => undefined,
  pushGmEdit: async (_campaignId: string, charId: string, ownerId: string, sheet: SavedChar) => {
    srv.pushes.push({ charId, ownerId, sheet });
    return srv.pushOk ? { ok: true, value: null } : { ok: false, error: 'new row violates row-level security policy' };
  },
}));

// The GM screen is only rendered by leg (f), where it stands in for a stat block that throws.
vi.mock('../tracker/src/components/GMScreen', () => ({
  GMScreen: () => {
    throw new Error('Cannot read properties of undefined (reading level)');
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

/** A stat block with just the two fields the tracker reads off an enemy. */
const OGRE = { name: 'Road Ogre', level: 6, defenses: { hp: 90 } } as unknown as Creature;

function stubMedia(phone: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches: phone && /max-width:\s*(720|768)px/.test(q),
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

/** Let every pending fetch/subscribe settle and React commit what they produced. */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function render(el: React.ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(el));
  return host;
}

/** The tracker's own overlay, found by the one string it renders. */
const globalSearchOpen = () =>
  [...(host?.querySelectorAll('input') ?? [])].some((i) => (i.placeholder ?? '').startsWith('Search everything'));

const btn = (label: string): HTMLElement => {
  const all = [...(host?.querySelectorAll('button') ?? [])];
  // Icon-only buttons (the hamburger) carry their name in `title`, not in any text node.
  const el = all.find((b) => (b.textContent ?? '').trim().includes(label) || b.title === label);
  // Name what WAS on screen: a missing button usually means the pane above it failed, and the list
  // says which pane rendered instead.
  if (!el) throw new Error(`no button labelled "${label}" — found: ${all.map((b) => JSON.stringify((b.textContent ?? '').trim() || b.title)).join(', ')}`);
  return el;
};
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

/*
 * jsdom has no DataTransfer and no DragEvent, so a drag is spelled out by hand: the payload the
 * source writes, carried on a plain bubbling Event that React reads `dataTransfer` off exactly as it
 * would a real one. (Same pair as test/bug-owner-2026-09-16-seam.test.tsx, which drags a party card
 * onto this same rail.)
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
    // What a real drag starts at when the source sets nothing — NOT 'none', which would forbid every
    // drop and make the negotiation below fire on drags that are fine.
    effectAllowed: 'uninitialized',
  } as unknown as DataTransfer;
}

/*
 * The one rule of the HTML drag-and-drop model a hand-rolled DataTransfer has to keep: the current
 * drag operation is the target's dropEffect MATCHED against the source's effectAllowed, and when
 * they don't match it resolves to "none" — the browser then fires NO drop at all, while the zone
 * still lights up, because dragover did run and did preventDefault. A stub that fires 'drop'
 * unconditionally passes a drop target that cannot work in a browser, which is exactly how a zone
 * answering 'move' to a 'copy' drag shipped. So the two values are pinned against each other here,
 * as the real handlers set them, and a drop the browser would not deliver fails the leg loudly.
 */
const EFFECT_PERMITS: Record<string, string[]> = {
  none: [],
  copy: ['copy'],
  move: ['move'],
  link: ['link'],
  copyMove: ['copy', 'move'],
  copyLink: ['copy', 'link'],
  linkMove: ['link', 'move'],
  all: ['copy', 'move', 'link'],
  uninitialized: ['copy', 'move', 'link'],
};

function fireDrag(el: Element, type: 'dragstart' | 'dragover' | 'dragleave' | 'drop', dataTransfer: DataTransfer): void {
  const { dropEffect, effectAllowed } = dataTransfer;
  // dropEffect 'none' = the target never accepted the drag; firing a drop at it anyway is the
  // synthetic "even then, nothing happens" probe below, and a browser's own refusal, not a defect.
  if (type === 'drop' && dropEffect !== 'none' && !(EFFECT_PERMITS[effectAllowed] ?? []).includes(dropEffect)) {
    throw new Error(
      `no drop would fire: the target answered dropEffect="${dropEffect}" to a drag whose source set ` +
        `effectAllowed="${effectAllowed}", so the drag operation resolves to none`,
    );
  }
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
  act(() => void el.dispatchEvent(ev));
}
const key = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })));

beforeEach(() => {
  localStorage.clear();
  srv.party = [];
  srv.partyFetch = 'ok';
  srv.pushOk = true;
  srv.sheets.clear();
  srv.pushes.length = 0;
  srv.sheetCbs.clear();
  rememberCampaign(null);
  setOnCampaignsPage(false);
  trackerUi.reset();
  useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false });
  usePartyStore.setState({ parties: [], activePartyId: null });
  useLayoutStore.setState({ root: null, hoveredCid: null });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  // jsdom has no ResizeObserver, and several tracker panes observe themselves in an effect — without
  // it PartyView throws on mount and every party assertion reads as a seam failure.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  stubMedia(false);
  stubFetch();
});

afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

async function openTracker(opts?: { onLeave?: () => void }): Promise<HTMLElement> {
  const { CampaignTracker } = await import('../src/integration/CampaignTracker');
  const el = render(
    <CampaignTracker
      m={CAMPAIGN}
      content={content()}
      onOpenSettings={() => undefined}
      onLeave={opts?.onLeave ?? (() => undefined)}
      onViewMember={() => undefined}
    />,
  );
  await flush();
  return el;
}

/** The GM's own work on a mirrored PC — the thing a bad prune destroys. */
const NOTES = 'Owes the innkeeper four gold.';

/** A party this campaign has already been mirrored into once, carrying that work. */
function seedMirroredParty(): void {
  const parties: Party[] = [
    {
      id: 'party-1',
      name: CAMPAIGN.name,
      level: 1,
      isFavorite: false,
      campaignId: CAMPAIGN.id,
      players: [
        {
          id: 'player-1',
          name: 'Ayla Brightwood',
          charId: 'char-a',
          memberType: 'pc',
          notes: NOTES,
          turnCount: 3,
          turnAvgSeconds: 42,
          turnHistory: [{ at: 1_700_000_000_000, avgSeconds: 42, turnCount: 3 }],
        },
      ],
    },
  ];
  usePartyStore.setState({ parties, activePartyId: null });
  localStorage.setItem('pf2e-parties', JSON.stringify(parties));
}

const mirroredPc = () =>
  usePartyStore
    .getState()
    .parties.find((p) => p.campaignId === CAMPAIGN.id)
    ?.players.find((pl) => pl.charId === 'char-a');

/** What was actually WRITTEN to disk — a prune that only happened in memory still isn't harmless. */
const storedPc = () =>
  (JSON.parse(localStorage.getItem('pf2e-parties') ?? '[]') as Party[])
    .find((p) => p.campaignId === CAMPAIGN.id)
    ?.players.find((pl) => pl.charId === 'char-a');

describe('the campaign ↔ tracker seam', () => {
  it('builds the tracker party from the SERVER party, and rates encounters against it', async () => {
    // tracker 2026-09-15: seam
    const a = PC_A();
    const b = PC_B();
    srv.party = [publish(a, 'owner-a'), publish(b, 'owner-b')];

    const el = await openTracker();

    // The bug, in the GM's own words: a signed-in GM opened the campaign on this.
    expect(el.textContent).not.toContain('Party not found.');

    const party = usePartyStore.getState().parties.find((p) => p.campaignId === CAMPAIGN.id);
    expect(party?.players.map((p) => p.name).sort()).toEqual(['Ayla Brightwood', 'Doran Vex']);
    expect(party?.players.every((p) => (p.pcStats?.maxHP ?? 0) > 0)).toBe(true);

    // The party the badge rates against is these two PCs, at their real levels.
    click(btn('Add to Initiative'));
    await flush(1);
    const pcs = useCombatStore.getState().combatants.filter((c) => c.isPC);
    expect(pcs.map((c) => c.name).sort()).toEqual(['Ayla Brightwood', 'Doran Vex']);
    // …and each row keeps the STABLE character id, not just the name. This button — not the card's
    // "+" — is the GM's bulk gesture, so a charId-less row here is a link that never existed: a save
    // has nothing to persist, and a mid-campaign rename orphans the pane.
    expect(pcs.every((c) => !!c.charId)).toBe(true);

    // Pressing it again after a rename must NOT add the same PC twice. The button used to hold its
    // own name-only dedupe; it now defers to the store's isSamePc, so the two can't disagree.
    act(() =>
      usePartyStore.setState((s) => {
        const pl = s.parties.find((p) => p.campaignId === CAMPAIGN.id)?.players.find((x) => x.name === 'Doran Vex');
        if (pl) pl.name = 'Doran the Vexed';
      }),
    );
    await flush(1);
    click(btn('Add to Initiative'));
    await flush(1);
    expect(useCombatStore.getState().combatants.filter((c) => c.isPC)).toHaveLength(2);

    act(() => useCombatStore.getState().addCombatant(OGRE));
    await flush(1);
    // Levels 5 and 6 → party level 6; a level-6 enemy is 40 XP, and a party of TWO has a 40 XP
    // moderate budget. Rated against the old level-1 party of one it was 160 XP and Extreme.
    expect(el.textContent).toContain('40 XP');
    expect(el.textContent).toContain('Moderate');
  }, 120_000);

  it('reads a PC’s HP and conditions from their sheet, and pushes the GM’s back to it', async () => {
    // tracker 2026-09-15: seam
    const db = content();
    const a = PC_A();
    const max = a.character.hitPoints.current;
    // The player is bloodied and frightened on their OWN sheet.
    a.play = { ...initialPlay(a.character, db), damage: max - 20, conditions: [{ id: 'frightened', value: 2 }] };
    srv.party = [publish(a, 'owner-a')];

    await openTracker();
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Ayla Brightwood', isPC: true, maxHP: max }));
    await flush(2);

    const pc = () => useCombatStore.getState().combatants.find((c) => c.isPC)!;
    expect(pc().currentHP).toBe(20);
    expect(pc().conditions.map((c) => `${c.name} ${c.value ?? ''}`.trim())).toContain('frightened 2');

    // The GM applies a condition in the tracker → it reaches the player's sheet.
    act(() => useCombatStore.getState().addCondition(pc().id, { name: 'sickened', value: 1, isPermanent: true }));
    await flush(2);
    const condPush = srv.pushes.at(-1);
    expect(condPush?.charId).toBe('char-a');
    expect(condPush?.ownerId).toBe('owner-a');
    expect(condPush?.sheet.play?.conditions).toEqual(
      expect.arrayContaining([{ id: 'sickened', value: 1 }, { id: 'frightened', value: 2 }]),
    );

    // The GM applies damage → the same channel, as damage on their sheet.
    act(() => useCombatStore.getState().applyDamage(pc().id, 5));
    await flush(2);
    const dmgPush = srv.pushes.at(-1);
    expect(dmgPush?.sheet.play?.damage).toBe(max - 15);

    // …and the tracker keeps no PC HP of its own: the player healing on their sheet wins.
    const healed: SavedChar = { ...a, play: { ...a.play!, damage: 0, conditions: [] } };
    srv.sheets.set('char-a', healed);
    await act(async () => {
      srv.sheetCbs.get('char-a')?.();
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush(2);
    expect(pc().currentHP).toBe(max);
    expect(pc().conditions).toEqual([]);
  }, 120_000);

  it('closes an open tracker overlay on Escape instead of leaving the campaign', async () => {
    // tracker 2026-09-15: seam
    srv.party = [publish(PC_A(), 'owner-a')];
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
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
    click(el.querySelector('.cmp-card-btn')!); // open the campaign
    await flush();
    expect(el.querySelector('.campaign-tracker')).not.toBeNull();

    // Any of the five overlays registers the same way; this one is reachable without the bestiary.
    act(() => trackerUi.setSearch(true));
    await flush(1);
    expect(globalSearchOpen()).toBe(true);

    await key({ key: 'Escape' });
    await flush(1);

    expect(globalSearchOpen()).toBe(false); // the overlay took the press…
    expect(el.querySelector('.campaign-tracker')).not.toBeNull(); // …and the campaign survived it
    expect(el.textContent).not.toContain('Campaigns you run');
  }, 120_000);

  it('keeps the floating character-undo pair off the campaigns screen', async () => {
    // tracker 2026-09-15: seam
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    localStorage.setItem(ROSTER_KEY, JSON.stringify([PC_A()]));
    // Stay on Characters rather than jumping to the last sheet: the sheet draws its own undo pair in
    // its header, so the floating one is hidden there anyway and would prove nothing.
    const { setPref } = await import('../src/data/prefs');
    setPref('startupScreen', 'characters');
    const { default: App } = await import('../src/App');
    render(<App />);
    await flush(8);

    // Make there be something to undo: duplicating a character is a one-click roster change.
    const dup = host!.querySelector('button[title="Duplicate"]');
    if (!dup) throw new Error(`no Duplicate button — on screen: ${(host!.textContent ?? '').slice(0, 300)}`);
    click(dup);
    await flush(2);
    expect(document.querySelector('.app-undo')).not.toBeNull();

    click(btn('Menu'));
    await flush(1);
    click(btn('Campaigns'));
    await flush(4);
    expect(document.querySelector('.cmp-page')).not.toBeNull();
    expect(document.querySelector('.app-undo')).toBeNull();
  }, 180_000);

  it('opens the tracker’s search on Ctrl+K', async () => {
    // tracker 2026-09-15: seam
    srv.party = [publish(PC_A(), 'owner-a')];
    await openTracker();
    expect(globalSearchOpen()).toBe(false);
    await key({ key: 'k', ctrlKey: true });
    await flush(1);
    expect(globalSearchOpen()).toBe(true);
  }, 120_000);

  it('catches a stat block that throws without taking the campaign with it', async () => {
    // tracker 2026-09-15: seam
    srv.party = [publish(PC_A(), 'owner-a')];
    const el = await openTracker();
    act(() => trackerUi.showMain('gm'));
    await flush(1);
    expect(el.textContent).toContain('Something went wrong in');
    // The chrome around it is still there: the initiative rail and its own controls.
    expect(el.querySelector('.ct-order')).not.toBeNull();
    expect(el.textContent).toContain('Add combatants');
  }, 120_000);

  /*
   * THE PARTY BRIDGE MIRRORS THE CAMPAIGN — so it must never mirror a list it hasn't actually read.
   *
   * `serverMembers` started as `[]`, which in a release build IS the member list, so the very first
   * layout effect synced an empty party and pruned every mirrored PC — the GM's per-player notes,
   * turn history and stat overrides with them — before the fetch had even answered. `fetchParty`
   * swallowing every error into `[]` did it again mid-session on one Supabase blip.
   */
  it('keeps a mirrored PC while the party read is still in flight', async () => {
    // tracker 2026-09-15: party bridge
    // Without the fix (drop `if (!known) return` in CampaignTracker's sync effect):
    //   AssertionError: expected undefined to be 'Owes the innkeeper four gold.'
    seedMirroredParty();
    srv.partyFetch = 'pending';

    await openTracker();

    expect(mirroredPc()?.notes).toBe(NOTES);
    expect(mirroredPc()?.turnHistory).toHaveLength(1);
    expect(storedPc()?.notes).toBe(NOTES);
  }, 120_000);

  it('keeps a mirrored PC when the party read fails', async () => {
    // tracker 2026-09-15: party bridge
    // Without the fix (fetchParty returning `[]` instead of null on error):
    //   AssertionError: expected undefined to be 'Owes the innkeeper four gold.'
    seedMirroredParty();
    srv.party = [publish(PC_A(), 'owner-a')];
    srv.partyFetch = 'fail';

    await openTracker();

    expect(mirroredPc()?.notes).toBe(NOTES);
    expect(mirroredPc()?.turnHistory).toHaveLength(1);
    expect(storedPc()?.notes).toBe(NOTES);
  }, 120_000);

  it('keeps a mirrored PC’s notes and turn history once the read succeeds', async () => {
    // tracker 2026-09-15: party bridge — the first, empty sync wiped the player and the arriving
    // read then re-created a blank one, so even a healthy open lost the GM's work.
    // Without the fix (drop `if (!known) return` in CampaignTracker's sync effect):
    //   AssertionError: expected '' to be 'Owes the innkeeper four gold.'
    seedMirroredParty();
    srv.party = [publish(PC_A(), 'owner-a')];

    await openTracker();

    expect(mirroredPc()?.notes).toBe(NOTES);
    expect(mirroredPc()?.turnHistory).toHaveLength(1);
    expect(usePartyStore.getState().activePartyId).toBe('party-1');
  }, 120_000);

  it('still prunes a PC who really left the campaign', async () => {
    // tracker 2026-09-15: party bridge — the other half: a read that SUCCEEDS with nobody in it is
    // authoritative, and a campaign with no members at all must still get its party.
    // Without the fix (guarding on `members.length` instead of "a read succeeded"):
    //   AssertionError: expected { id: 'player-1', … } to be undefined
    seedMirroredParty();
    srv.party = [];

    await openTracker();

    expect(mirroredPc()).toBeUndefined();
    expect(usePartyStore.getState().parties.find((p) => p.campaignId === CAMPAIGN.id)).toBeDefined();
  }, 120_000);

  it('never puts another campaign’s party in this campaign', async () => {
    // tracker 2026-09-15: party bridge — `partyId` fell back to `activePartyId` and then to the first
    // party on the device, and BOTH belong to whatever campaign was opened last. Skipping the sync on
    // an unknown party (above) is what made that reachable: nothing re-pointed the fallback.
    // Without the fix (`activePartyId ?? parties[0]?.id ?? ''`):
    //   AssertionError: expected [ 'Grishna Stonewhisper' ] to deeply equal [ 'Ayla Brightwood' ]
    seedMirroredParty();
    const other = {
      id: 'party-other',
      name: 'The Other Table',
      level: 3,
      isFavorite: false,
      campaignId: 'camp-other',
      players: [{ id: 'player-x', name: 'Grishna Stonewhisper', charId: 'char-x', memberType: 'pc' as const, notes: '' }],
    };
    // The other campaign was opened last (activePartyId) and is first in storage (the fallback after a
    // restart, which doesn't persist activePartyId). This campaign's own party is already mirrored, so
    // the failed read below correctly skips the sync — and nothing re-points those fallbacks.
    const parties: Party[] = [other, ...usePartyStore.getState().parties];
    usePartyStore.setState({ parties, activePartyId: 'party-other' });
    localStorage.setItem('pf2e-parties', JSON.stringify(parties));
    srv.partyFetch = 'fail';

    await openTracker();

    // The button the GM actually presses — wired to THIS campaign's party.
    click(btn('Add to Initiative'));
    await flush(1);
    expect(useCombatStore.getState().combatants.map((c) => c.name)).toEqual(['Ayla Brightwood']);
    // …and the other campaign's own party is left exactly as it was.
    expect(usePartyStore.getState().parties.find((p) => p.campaignId === 'camp-other')?.players).toHaveLength(1);
  }, 120_000);

  it('still gives a GM whose party read failed somewhere to work, and says what went wrong', async () => {
    // tracker 2026-09-15: party bridge — a party we haven't read must never be MIRRORED, but a
    // campaign this device never mirrored has nothing to prune. Stranding that GM (offline, or no
    // `campaign_characters` table) on "Party not found." with no message and no retry for the life of
    // the mount was the old bug wearing a new hat.
    // Without the fix (`if (!known) return` with no exception for an unmirrored campaign):
    //   AssertionError: expected '…Party not found.…' not to contain 'Party not found.'
    srv.partyFetch = 'fail';

    const el = await openTracker();

    expect(el.textContent).not.toContain('Party not found.');
    expect(el.textContent).toContain("Couldn't load the party");
    // Nothing had been mirrored, so nothing could be lost by creating it.
    expect(usePartyStore.getState().parties.find((p) => p.campaignId === CAMPAIGN.id)?.players).toEqual([]);
  }, 120_000);

  it('closes the initiative row’s right-click menu on Escape, and stays in the campaign', async () => {
    // tracker 2026-09-15: seam — the menu is NOT one of the five registered overlays; it closes from
    // its own `document` listener, which fires before the dismiss stack's `window` one.
    // Without the fix (no base back-handler in CampaignTracker, so goBack is still the top):
    //   AssertionError: expected null not to be null   ← the campaign was gone
    srv.party = [publish(PC_A(), 'owner-a')];
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    // Warm the lazy chunks so opening the campaign is a re-render, not a cold module transform.
    await import('../src/integration/CampaignTracker');
    await import('../src/integration/TrackerTools');
    const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
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
    await flush();

    act(() => useCombatStore.getState().addCombatant(null, { name: 'Ayla Brightwood', isPC: true, maxHP: 40 }));
    await flush(1);
    const row = el.querySelector('.init-row');
    if (!row) throw new Error(`no initiative row — rail held: ${(el.querySelector('.ct-order')?.textContent ?? '(no rail)').slice(0, 200)}`);
    act(() => void row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })));
    await flush(1);
    const menu = document.querySelector('body > .tracker-root:not(.campaign-tracker)');
    expect(menu).not.toBeNull();

    // Escape the way the browser delivers it: up through `document`, where the menu listens, and on
    // to `window`, where the dismiss stack does.
    await act(async () => {
      menu!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush(1);

    expect(document.querySelector('body > .tracker-root:not(.campaign-tracker)')).toBeNull(); // menu closed…
    expect(el.querySelector('.campaign-tracker')).not.toBeNull(); // …and that press bought nothing else
  }, 120_000);

  it('re-pushes a GM change the server refused', async () => {
    // tracker 2026-09-15: sheet truth — the row was stamped "agreed" before the push was even sent,
    // and the result was thrown away, so a refusal was silently permanent.
    // Without the fix (discard pushVitals' result):
    //   AssertionError: expected 1 to be greater than or equal to 2
    const a = PC_A();
    srv.party = [publish(a, 'owner-a')];
    srv.pushOk = false;

    await openTracker();
    act(() =>
      useCombatStore.getState().addCombatant(null, {
        name: 'Ayla Brightwood',
        isPC: true,
        maxHP: a.character.hitPoints.current,
      }),
    );
    await flush(2);

    const pc = () => useCombatStore.getState().combatants.find((c) => c.isPC)!;
    act(() => useCombatStore.getState().addCondition(pc().id, { name: 'sickened', value: 1, isPermanent: true }));
    await flush(3);
    const mine = () => srv.pushes.filter((p) => p.charId === 'char-a');
    expect(mine()).toHaveLength(1); // sent once, and refused

    // The next pass (any later combat change runs one) sends it again rather than dropping it.
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Torch' }));
    await flush(3);
    expect(mine().length).toBeGreaterThanOrEqual(2);
    expect(mine().at(-1)?.sheet.play?.conditions).toEqual(
      expect.arrayContaining([{ id: 'sickened', value: 1 }]),
    );
  }, 120_000);

  it('leaves a PC’s pane with nothing unpushed to lose', async () => {
    // owner 2026-09-16: seam
    /*
     * A PC's pane used to BE their editable GmEditSheet — one unpushed working copy per pane, each
     * of which the view had to ask about before it could be unmounted, through a registry keyed by
     * combatant id. The pane holds the player's CARD now (the sheet it opens is a layer over the
     * whole view), so there is exactly one working copy left and the registry went with the sheets.
     * This is what says that deletion is safe: the pane really holds a card, and one Escape still
     * leaves the campaign without something invisible swallowing the press.
     */
    srv.party = [publish(PC_A(), 'owner-a')];
    let left = 0;
    const el = await openTracker({
      onLeave: () => {
        left++;
      },
    });
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Ayla Brightwood', isPC: true, maxHP: 40 }));
    await flush(2);

    const row = [...el.querySelectorAll('.init-row')].find((r) => (r.textContent ?? '').includes('Ayla Brightwood'));
    expect(row).toBeTruthy();
    click(row!);
    await flush(2);
    expect(el.querySelector('.ct-pane-card .party-card')).toBeTruthy();
    expect(el.querySelector('.ct-pc-pane .ws-app')).toBeNull();

    key({ key: 'Escape' });
    await flush(2);
    expect(left).toBe(1);
  }, 120_000);

  it('the Delay area takes the acting creature, and gives it back ONE TURN BEFORE the current one', async () => {
    // lane delay 2026-09-17: seam
    /*
     * The owner's gesture, in his words: "I want a delay mechanic where I drag someone from the
     * initiative order and above the Add combatants button there will be a delay area that I can
     * drop into, and there will be a button to add back to initiative… players decide to enter after
     * they hear me say 'now it's this guy's turn' and say 'I want to enter' — so when I press the
     * return button they enter ONE TURN BEFORE the current turn AND THE CURRENT TURN MOVES TO THEM."
     *
     * Only the acting creature can go in (Player Core p. 416 — Delay is an action on your own turn),
     * and dragging a delayed row back onto the order is the Return button by another gesture.
     *
     * MUTATIONS:
     *  - InitiativeTracker `combatants.filter(c => !c.isDelayed).map(…)` → `combatants.map(…)`:
     *    FAILS at line 813 — "expected true to be false" (the delayed row is still in the order).
     *  - InitiativeTracker's `if (isActive) e.dataTransfer.setData(DELAY_MIME, c.id)` → unconditional:
     *    FAILS at line 799 — "expected [ 'text/combatant-id', …(1) ] to not include
     *    'application/x-hh-delay'" (any row could be dragged out of the order).
     *  - CampaignTracker: drop `onDragOver`/`onDrop` from the `.ct-order-scroll` wrapper:
     *    FAILS at line 840 — "expected 'Torch Bearer' to be 'Road Ogre'" (the drag back onto the
     *    order lands nowhere and the delayed creature stays out).
     *  - useDelayDropZone: `dropEffect = ROW_DRAG_EFFECT` → `'move'` (how it shipped, against the
     *    row's effectAllowed = 'copy'): FAILS at line 810 — "no drop would fire: the target answered
     *    dropEffect="move" to a drag whose source set effectAllowed="copy", so the drag operation
     *    resolves to none". The zone highlighted and the browser delivered nothing.
     *  - CampaignTracker's `onReturnDragOver`: `dropEffect = 'move'` → `'copy'`, against the delayed
     *    row's effectAllowed = 'move': FAILS at line 838, the same way, on the way back in.
     */
    const el = await openTracker();
    act(() => {
      // Name-only rows on purpose: a turn change opens the acting creature's stat block in the
      // workspace, and this leg is about the order, not about what a stat block renders.
      useCombatStore.getState().addCombatant(null, { name: 'Road Ogre', initiative: 20 });
      useCombatStore.getState().addCombatant(null, { name: 'Torch Bearer', initiative: 10 });
      useCombatStore.getState().startCombat();
    });
    await flush(2);

    const state = () => useCombatStore.getState();
    const acting = () => state().combatants[state().activeIndex]?.name;
    const order = () => state().combatants.map((c) => c.name);
    const zone = () => el.querySelector('.ct-delay')!;
    const listed = (name: string) => [...el.querySelectorAll('.init-row')].some((r) => (r.textContent ?? '').includes(name));
    const rowFor = (name: string) => [...el.querySelectorAll('.init-row')].find((r) => (r.textContent ?? '').includes(name))!;
    expect(acting()).toBe('Road Ogre');
    // Always on screen during the fight, one line tall and saying what it is for.
    expect(zone().textContent).toContain('Delay');
    expect(zone().textContent).toContain('drag the acting creature here');

    // A row whose turn has NOT begun writes no delay payload — its drag is the stat-block one only,
    // so the zone's dragover declines it (dropEffect stays 'none'; a browser would deliver no drop
    // here at all) and the drop fired anyway finds nothing to delay.
    const idle = makeDataTransfer();
    fireDrag(rowFor('Torch Bearer'), 'dragstart', idle);
    expect(idle.types).not.toContain(DELAY_MIME);
    fireDrag(zone(), 'dragover', idle);
    expect(idle.dropEffect).toBe('none');
    fireDrag(zone(), 'drop', idle);
    expect(state().combatants.find((c) => c.name === 'Torch Bearer')!.isDelayed).toBe(false);

    // The acting row does, and dropping it in the area takes it out of the order.
    const out = makeDataTransfer();
    fireDrag(rowFor('Road Ogre'), 'dragstart', out);
    expect(out.types).toContain(DELAY_MIME);
    fireDrag(zone(), 'dragover', out);
    fireDrag(zone(), 'drop', out);
    await flush(1);
    expect(state().combatants.find((c) => c.name === 'Road Ogre')!.isDelayed).toBe(true);
    expect(listed('Road Ogre')).toBe(false); // out of the ORDER, not merely dimmed in it…
    expect(zone().textContent).toContain('Road Ogre'); // …and waiting in the area
    expect(acting()).toBe('Torch Bearer');

    // Return: in immediately AHEAD of the creature whose turn it is, acting this instant.
    click(zone().querySelector('button')!);
    await flush(1);
    expect(acting()).toBe('Road Ogre');
    expect(order()).toEqual(['Road Ogre', 'Torch Bearer']);
    expect(listed('Road Ogre')).toBe(true);

    // And the drag out of the area does exactly what the button does — dropped ANYWHERE on the
    // order, because where it lands is not the GM's to choose.
    const again = makeDataTransfer();
    fireDrag(rowFor('Road Ogre'), 'dragstart', again);
    fireDrag(zone(), 'dragover', again);
    fireDrag(zone(), 'drop', again);
    await flush(1);
    expect(acting()).toBe('Torch Bearer');

    const back = makeDataTransfer();
    fireDrag(zone().querySelector('.ct-delay-row')!, 'dragstart', back);
    expect(back.types).toContain(DELAY_RETURN_MIME);
    const list = el.querySelector('.ct-order-scroll')!;
    fireDrag(list, 'dragover', back);
    fireDrag(list, 'drop', back);
    await flush(1);
    expect(acting()).toBe('Road Ogre');
    expect(order()).toEqual(['Road Ogre', 'Torch Bearer']);
    expect(zone().textContent).toContain('drag the acting creature here'); // empty again
  }, 120_000);

  it('hides the GM tools on a phone, and keeps joining a campaign', async () => {
    // tracker 2026-09-15: seam
    stubMedia(true);
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
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

    expect(el.textContent).toContain('GM tools are available on the desktop and web app');
    expect(el.textContent).toContain('Join with a code');
    expect(el.querySelector('.campaign-tracker')).toBeNull();
    expect(el.textContent).not.toContain('Create a campaign');

    // Opening a campaign on a phone is the PLAYER's view of it, never the tracker.
    click(el.querySelector('.cmp-card-btn')!);
    await flush();
    expect(el.querySelector('.campaign-tracker')).toBeNull();
    expect(el.textContent).toContain('Party');
  }, 120_000);
});
