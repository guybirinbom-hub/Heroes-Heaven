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
import { useCombatStore, cancelPersist } from '../tracker/src/store/combatStore';
import { usePartyStore, type Party } from '../tracker/src/store/partyStore';
import { useLayoutStore } from '../tracker/src/store/layoutStore';
import { useSettingsStore } from '../tracker/src/store/settingsStore';
import { trackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';
import { triggerBack } from '../src/sheet/useEscapeClose';

/**
 * NO TIMER ICON ON A PLAYER CARD WHILE THE TURN TIMER IS OFF.
 *
 * The owner's item: "No timer icon on player cards when the initiative turn timer is off in
 * settings." The campaign party card's turn chip (MemberTurnButton) used to be drawn always — an
 * implementer's choice, not a ruling — so with the setting at its default (OFF) every GM saw a grey
 * clock on every card, and a GM who had turned the timer off saw a frozen old average.
 *
 * What is pinned here:
 *  - the chip renders NOTHING while "Enable turn timer" is off, data or not, and lets go of its
 *    Escape handler when the setting hides an open graph;
 *  - with the timer on it is today's chip: the average when there is data, a bare clock when not;
 *  - on the real campaign view (CampaignTracker.cardExtra) the PC pane card — which has no "+" —
 *    gets NO `.party-card-tools` at all while the timer is off, so no empty span widens the header,
 *    and it follows the setting live when it flips while the pane is open;
 *  - the slot builder leaves the chip out by itself too (checked with a chip that always draws), so
 *    neither of the two gates can quietly go while the other covers for it;
 *  - hiding is display-only: the saved turn history is still in the party store afterwards.
 *
 * Every name is synthetic. The setting is module state that outlives localStorage.clear(), so each
 * test sets it explicitly, both ways.
 */

const srv = vi.hoisted(() => ({
  party: [] as PartyMember[],
  sheets: new Map<string, unknown>(),
  /**
   * When true, the campaign cards get a chip that ALWAYS draws itself, so the slot builder's own
   * gate is tested on its own — the real chip also hides itself, which would cover for it.
   */
  stubChip: false,
}));

vi.mock('../src/integration/MemberTurnButton', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/integration/MemberTurnButton')>();
  const React = await import('react');
  return {
    MemberTurnButton: (props: Parameters<typeof real.MemberTurnButton>[0]) =>
      srv.stubChip
        ? React.createElement('button', { type: 'button', className: 'mt-turn-chip stub-chip' })
        : React.createElement(real.MemberTurnButton, props),
  };
});

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
  pushGmEdit: async () => ({ ok: true, value: null }),
}));

const { MemberTurnButton } = await import('../src/integration/MemberTurnButton');

const CAMPAIGN: CampaignMembership = { id: 'camp-x', code: 'SYNTH01', role: 'gm', name: 'Synth Campaign' };

/** The tracker's mirror of the campaign: Alpha has three saved turns averaging 42 s, Beta none. */
function seedParty(): void {
  const parties: Party[] = [
    {
      id: 'party-x',
      name: CAMPAIGN.name,
      level: 1,
      isFavorite: false,
      campaignId: CAMPAIGN.id,
      players: [
        {
          id: 'pl-a',
          name: 'Synth Alpha',
          charId: 'char-a',
          memberType: 'pc',
          notes: '',
          turnCount: 3,
          turnAvgSeconds: 42,
          turnHistory: [{ at: 1_700_000_000_000, avgSeconds: 42, turnCount: 3 }],
        },
        { id: 'pl-b', name: 'Synth Beta', charId: 'char-b', memberType: 'pc', notes: '' },
      ],
    },
  ];
  usePartyStore.setState({ parties, activePartyId: null });
  localStorage.setItem('pf2e-parties', JSON.stringify(parties));
}

const savedAlpha = () =>
  usePartyStore
    .getState()
    .parties.find((p) => p.campaignId === CAMPAIGN.id)
    ?.players.find((pl) => pl.charId === 'char-a');

const setTimer = (on: boolean) => act(() => useSettingsStore.setState({ turnTimerEnabled: on }));

let live: Root | null = null;
let host: HTMLElement | null = null;

function render(el: React.ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(el));
  return host;
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

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

beforeEach(() => {
  localStorage.clear();
  srv.party = [];
  srv.sheets.clear();
  srv.stubChip = false;
  rememberCampaign(null);
  setOnCampaignsPage(false);
  trackerUi.reset();
  useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false });
  cancelPersist();
  usePartyStore.setState({ parties: [], activePartyId: null });
  useLayoutStore.setState({ root: null, hoveredCid: null });
  useSettingsStore.setState({ turnTimerEnabled: false });
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
  useSettingsStore.setState({ turnTimerEnabled: false });
  vi.unstubAllGlobals();
});

describe('MemberTurnButton follows "Enable turn timer"', () => {
  it('draws nothing at all while the timer is off — not even for a PC with saved averages', () => {
    // Without the fix (no `if (!timerOn) return null`): the .mt-turn-chip below is found.
    seedParty();
    setTimer(false);
    const el = render(
      <>
        <MemberTurnButton campaignId="camp-x" charId="char-a" name="Synth Alpha" />
        <MemberTurnButton campaignId="camp-x" charId="char-b" name="Synth Beta" />
      </>,
    );
    expect(el.querySelector('.mt-turn-chip')).toBeNull();
    expect(el.querySelector('.ti-clock')).toBeNull();
    expect(el.querySelector('[aria-label^="Turn-time history for"]')).toBeNull();
    expect(el.innerHTML).toBe('');
    // Display-only: hiding it never touched the saved history.
    expect(savedAlpha()).toMatchObject({ turnCount: 3, turnAvgSeconds: 42 });
    expect(savedAlpha()?.turnHistory).toHaveLength(1);
  });

  it('shows the average, or the bare clock, while the timer is on — and follows a flip either way', () => {
    seedParty();
    setTimer(true);
    const el = render(
      <>
        <MemberTurnButton campaignId="camp-x" charId="char-a" name="Synth Alpha" />
        <MemberTurnButton campaignId="camp-x" charId="char-b" name="Synth Beta" />
      </>,
    );
    const alpha = el.querySelector('[aria-label="Turn-time history for Synth Alpha"]');
    expect(alpha).toBeTruthy();
    expect(alpha!.classList.contains('mt-turn-chip')).toBe(true);
    expect(alpha!.classList.contains('empty')).toBe(false);
    expect(alpha!.textContent).toBe('0:42');
    // No data yet → the bare clock, so the feature can still be found while the timer is on.
    const beta = el.querySelector('[aria-label="Turn-time history for Synth Beta"]');
    expect(beta).toBeTruthy();
    expect(beta!.matches('.mt-turn-chip.empty')).toBe(true);
    expect(beta!.querySelector('.ti-clock')).toBeTruthy();
    expect(beta!.textContent).toBe('');

    // Off → both gone; on again → both back, the saved average untouched in between.
    setTimer(false);
    expect(el.querySelectorAll('.mt-turn-chip')).toHaveLength(0);
    setTimer(true);
    expect(el.querySelectorAll('.mt-turn-chip')).toHaveLength(2);
    expect(el.querySelector('[aria-label="Turn-time history for Synth Alpha"]')!.textContent).toBe('0:42');
  });

  it('lets go of its Escape handler when the setting hides an open graph', () => {
    // Without the fix (`useBackHandler(open, …)` instead of `open && timerOn`): triggerBack() finds
    // the hidden chip's handler still on the dismiss stack and returns true — one Escape eaten.
    seedParty();
    setTimer(true);
    const el = render(<MemberTurnButton campaignId="camp-x" charId="char-a" name="Synth Alpha" />);
    click(el.querySelector('.mt-turn-chip')!);
    expect(el.querySelector('.modal-overlay')?.textContent).toContain('turn-time history');

    setTimer(false);
    expect(el.querySelector('.mt-turn-chip')).toBeNull();
    expect(el.querySelector('.modal-overlay')).toBeNull();
    let ran = true;
    act(() => {
      ran = triggerBack();
    });
    expect(ran).toBe(false);
  });
});

// ── The real campaign view: CampaignTracker.cardExtra ─────────────────────────────────────────
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

function publish(id: string, name: string, ownerId: string): PartyMember {
  const db = content();
  const build = buildOf(name, 3);
  const character = buildCharacter(build, db);
  const sc: SavedChar = { id, character, build, play: initialPlay(character, db) };
  srv.sheets.set(sc.id, sc);
  return { ownerId, charId: sc.id, name: character.name, summary: computeSummary(character, db) };
}

async function openTracker(): Promise<HTMLElement> {
  const { CampaignTracker } = await import('../src/integration/CampaignTracker');
  const el = render(
    <CampaignTracker
      m={CAMPAIGN}
      content={content()}
      onOpenSettings={() => undefined}
      onLeave={() => undefined}
      onViewMember={() => undefined}
    />,
  );
  await flush();
  return el;
}

/** A dashboard card by the character's name. */
function dashboardCard(el: HTMLElement, name: string): HTMLElement {
  const card = [...el.querySelectorAll('.party-grid .party-card')].find(
    (c) => (c.querySelector('.party-card-name')?.textContent ?? '').includes(name),
  );
  if (!card) throw new Error(`no dashboard card for ${name}`);
  return card as HTMLElement;
}

/** Put Alpha in the order and open their pane — which holds their party card. */
async function openAlphaPane(el: HTMLElement): Promise<HTMLElement> {
  act(() => useCombatStore.getState().addCombatant(null, { name: 'Synth Alpha', isPC: true, maxHP: 30 }));
  await flush(2);
  const row = [...el.querySelectorAll('.init-row')].find((r) => (r.textContent ?? '').includes('Synth Alpha'));
  expect(row).toBeTruthy();
  click(row!);
  await flush(2);
  const pane = el.querySelector('.ct-pane-card .party-card');
  expect(pane).toBeTruthy();
  return pane as HTMLElement;
}

describe('the campaign party cards follow the setting (CampaignTracker.cardExtra)', () => {
  it('timer off: no chip on the dashboard cards, and the PC pane card has no tools slot at all', async () => {
    // Without the fix (`header` always a fragment): the pane card gets an EMPTY .party-card-tools,
    // which in the flex header (gap 10px) pushes the chevron 10px in.
    seedParty();
    setTimer(false);
    srv.party = [publish('char-a', 'Synth Alpha', 'owner-a'), publish('char-b', 'Synth Beta', 'owner-b')];
    const el = await openTracker();

    for (const name of ['Synth Alpha', 'Synth Beta']) {
      const card = dashboardCard(el, name);
      // The dashboard still has its "+", so its tools slot stays — with the "+" alone in it.
      const tools = card.querySelector('.party-card-h .party-card-tools');
      expect([name, !!tools]).toEqual([name, true]);
      expect([name, tools!.querySelector('.party-add-init') !== null]).toEqual([name, true]);
      expect([name, card.querySelector('.mt-turn-chip')]).toEqual([name, null]);
    }

    const pane = await openAlphaPane(el);
    expect(pane.querySelector('.mt-turn-chip')).toBeNull();
    expect(pane.querySelector('.party-card-tools')).toBeNull();
    // The chevron sits straight after the name block (no host span between them).
    const head = pane.querySelector('.party-card-h')!;
    expect(head.lastElementChild!.classList.contains('party-chev')).toBe(true);
    expect(head.lastElementChild!.previousElementSibling!.classList.contains('party-card-tools')).toBe(false);
    // Nothing was cleared to get there.
    expect(savedAlpha()).toMatchObject({ turnCount: 3, turnAvgSeconds: 42 });
  }, 120_000);

  it('timer on: the chip rides in both headers, with the saved average', async () => {
    seedParty();
    setTimer(true);
    srv.party = [publish('char-a', 'Synth Alpha', 'owner-a'), publish('char-b', 'Synth Beta', 'owner-b')];
    const el = await openTracker();

    const alpha = dashboardCard(el, 'Synth Alpha');
    expect(alpha.querySelector('.party-card-tools .mt-turn-chip')?.textContent).toBe('0:42');
    expect(alpha.querySelector('.party-card-tools .party-add-init')).toBeTruthy();
    expect(dashboardCard(el, 'Synth Beta').querySelector('.party-card-tools .mt-turn-chip.empty')).toBeTruthy();

    const pane = await openAlphaPane(el);
    expect(pane.querySelector('.party-card-tools .mt-turn-chip')?.textContent).toBe('0:42');
    // Still no "+" on a pane card — a PC only has a pane because they are already in the order.
    expect(pane.querySelector('.party-add-init')).toBeNull();
  }, 120_000);

  it('leaves the chip out of the slot itself while the timer is off — not only by the chip hiding', async () => {
    // Without the fix (no `turnTimerEnabled &&` before <MemberTurnButton/> in cardExtra): the
    // always-drawn stub chip lands in every dashboard card's header.
    seedParty();
    srv.stubChip = true;
    setTimer(false);
    srv.party = [publish('char-a', 'Synth Alpha', 'owner-a')];
    const el = await openTracker();
    const card = dashboardCard(el, 'Synth Alpha');
    expect(card.querySelector('.stub-chip')).toBeNull();
    expect(card.querySelector('.party-card-tools .party-add-init')).toBeTruthy();

    // The stub is really wired: with the timer on, the slot carries it.
    setTimer(true);
    await flush(1);
    expect(dashboardCard(el, 'Synth Alpha').querySelector('.party-card-tools .stub-chip')).toBeTruthy();
  }, 120_000);

  it('follows a flip of the setting while the pane is open', async () => {
    // Without `turnTimerEnabled` in cardExtra's deps the slot builder keeps its old header: the chip
    // inside it hides itself, but the now-empty .party-card-tools span stays on the pane card.
    seedParty();
    setTimer(true);
    srv.party = [publish('char-a', 'Synth Alpha', 'owner-a')];
    const el = await openTracker();
    await openAlphaPane(el);
    const pane = () => el.querySelector('.ct-pane-card .party-card')!;
    expect(pane().querySelector('.party-card-tools .mt-turn-chip')).toBeTruthy();

    setTimer(false);
    await flush(1);
    expect(pane().querySelector('.mt-turn-chip')).toBeNull();
    expect(pane().querySelector('.party-card-tools')).toBeNull();

    setTimer(true);
    await flush(1);
    expect(pane().querySelector('.party-card-tools .mt-turn-chip')?.textContent).toBe('0:42');
  }, 120_000);
});
