// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay, applyPlayState } from '../src/rules/play';
import { derivePerception } from '../src/rules/derive';
import { computeSummary, type PartySummary } from '../src/sheet/partySummary';
import type { SavedChar } from '../src/data/storage';
import type { CampaignMembership } from '../src/data/campaigns';
import type { PartyMember } from '../src/data/party';
import type { Creature } from '../tracker/src/types/pf2e';
import { useCombatStore } from '../tracker/src/store/combatStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { useLayoutStore } from '../tracker/src/store/layoutStore';
import { useSettingsStore } from '../tracker/src/store/settingsStore';
import { PC_DETAIL_ALL, PC_DETAIL_PRESETS } from '../tracker/src/utils/pcDetail';
import { CONDITION_META } from '../tracker/src/utils/conditionEffects';
import { trackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';
import { clearGmPendingEdits } from '../src/sheet/gmSync';
import { computePcStats } from '../src/integration/computePcStats';

/**
 * THE TRACKER'S PLAYER STATS AGREE WITH THE CARDS — owner's list 2026-10-01, item 3: "stats shown in the
 * initiative tracker that don't do anything to the player cards". His answers: "some switches change
 * nothing, the switches need to do what they say; hp doesn't go with defense; the tracker should do that
 * for players [step conditions down each turn] but have a setting for it not to do that".
 *
 * Each leg is one way a PC's initiative row and their party card said different things about the same
 * character on the same screen, run through the real seam (CampaignTracker, the party mocked as the
 * server, every name synthetic):
 *  (C) conditions counted ONCE: the host's AC and saves already carry the sheet's conditions, and the row
 *      added the tracker's own penalty for the same badges again — a frightened player two under the card;
 *  (D) the sheet's temp HP on the row, display only — never the row's own temp HP, never pushed;
 *  (E) the sheet's `persistent-damage` drawn as the tracker's Persistent Damage, and never rolled;
 *  (G) what the sheet works out (Encumbered, a mode) shown locked, never a row condition;
 *  (H) a rename on either side keeps the row linked — and Quick add of a member's name adds them linked;
 *  (I) "Show level in initiative order" shows a PC's level;
 *  (A) "Stats shown" switches the dashboard card's own core;
 *  (F) a Perception item's bonus on the card.
 * The condition STEP (Frightened / Stunned with the turn) is in test/bug-tracker-seam-never-overwrite.test.tsx;
 * the card's switches one by one in test/bug-party-card-c.test.tsx.
 */

const srv = vi.hoisted(() => ({
  party: [] as PartyMember[],
  sheets: new Map<string, unknown>(),
  pushes: [] as { charId: string; ownerId: string; sheet: SavedChar }[],
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
    return sheet ? { sheet, ownerId: srv.party.find((m) => m.charId === charId)?.ownerId, updatedAt: '2026-09-15T10:00:00.000Z' } : null;
  },
  subscribeMemberSheet: () => () => undefined,
  subscribeParty: () => () => undefined,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  subscribeGmEdits: () => () => undefined,
  pushGmEdit: async (campaignId: string, charId: string, ownerId: string, sheet: SavedChar, base?: { stamp: string; hash: string }) => {
    srv.pushes.push({ charId, ownerId, sheet });
    const { rememberGmEdit } = await import('../src/sheet/gmSync');
    rememberGmEdit(campaignId, charId, sheet, new Date().toISOString(), base?.stamp, ownerId, base?.hash);
    return { ok: true, value: null };
  },
}));

const CAMPAIGN: CampaignMembership = { id: 'camp-g3', code: 'G3CODE', role: 'gm', name: 'The Glass Fens' };
const NAME = 'Ayla Brightwood'; // synthetic

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
/** Publish a character as the player's app does — the summary from the PLAYED character. */
function publish(sc: SavedChar, ownerId: string, summary?: Partial<PartySummary>): PartyMember {
  const db = content();
  srv.sheets.set(sc.id, sc);
  const live = applyPlayState(sc.character, sc.play, db);
  return { ownerId, charId: sc.id, name: sc.character.name, summary: { ...computeSummary(live, db), ...summary } };
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
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const store = () => useCombatStore.getState();
const pcRow = () => store().combatants.find((c) => c.isPC)!;
/** The PC's initiative row on screen. */
const rowEl = () => [...(host?.querySelectorAll('.init-row') ?? [])].find((r) => r.textContent?.includes('PC')) as HTMLElement | undefined;
const num = (s: string | null | undefined) => Number(/[+-]?\d+/.exec(s ?? '')?.[0]);
/** The row's AC and Fort/Ref/Will, as numbers. */
function rowNumbers() {
  const r = rowEl()!;
  const last = (sel: string) => r.querySelector(sel)?.lastElementChild?.textContent;
  return { ac: num(last('[data-pc-ac]')), fort: num(last('[data-save="fort"]')), ref: num(last('[data-save="ref"]')), will: num(last('[data-save="will"]')) };
}
/** The dashboard card's AC and Fort/Ref/Will, as numbers. */
function cardNumbers() {
  const card = host!.querySelector('.party-grid .party-card')!;
  const tile = (label: string) => [...card.querySelectorAll('.party-def')].find((d) => d.querySelector('.party-lab')?.textContent === label)?.querySelector('b')?.textContent;
  return { ac: num(tile('AC')), fort: num(tile('Fort')), ref: num(tile('Ref')), will: num(tile('Will')) };
}

beforeEach(() => {
  localStorage.clear();
  srv.party = [];
  srv.sheets.clear();
  srv.pushes.length = 0;
  clearGmPendingEdits();
  rememberCampaign(null);
  setOnCampaignsPage(false);
  trackerUi.reset();
  useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false, diceResults: [] });
  usePartyStore.setState({ parties: [], activePartyId: null });
  useLayoutStore.setState({ root: null, hoveredCid: null });
  useSettingsStore.setState({
    pcDetail: PC_DETAIL_ALL, showInitPcDefenses: true, showInitLevel: true, hideInitPcHp: false,
    pcConditionTicks: true, persistentDamageAutoRoll: false, persistentDamageWarn: true, turnTimerEnabled: false,
  });
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
  useSettingsStore.setState({ pcDetail: PC_DETAIL_ALL, showInitLevel: true, pcConditionTicks: true, persistentDamageAutoRoll: false });
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
/** The member's PC row, added the way the card's "+" adds it (charId + max HP). */
async function addRow(name = NAME, charId = 'char-a') {
  act(() => store().addCombatant(null, { name, isPC: true, maxHP: 40, charId }));
  await flush(2);
}

describe('a PC’s initiative row agrees with their party card', () => {
  it('(C) frightened 2 + off-guard: the row shows the SAME AC and saves as the card — the conditions counted once', async () => {
    /*
     * MUTATION (tried 2026-10-13): InitiativeTracker InitRow — `const pcCm = … : cm` → `const pcCm = cm`
     * (the tracker's penalty for every badge again, the old double count) and this fails —
     *   AssertionError: expected { ac: 9, fort: 5, ref: 5, will: 5 } to deeply equal { ac: 13, fort: 7, ref: 7, will: 7 }
     * MUTATION (tried 2026-10-13): CampaignTracker — `folded={conditionFolded}` dropped from the provider
     * → fails the same way (no predicate, every badge counted).
     */
    const a = saved('char-a', NAME, 5);
    const bare = computeSummary(a.character, content());
    a.play = { ...a.play!, conditions: [{ id: 'frightened', value: 2 }, { id: 'off-guard' }] };
    srv.party = [publish(a, 'owner-a')];
    await openTracker();
    await addRow();

    const card = cardNumbers();
    // Fixture: the conditions really are on the card's numbers (AC −2 off-guard, −2 frightened).
    expect(card.ac, 'fixture: the card counts the conditions').toBe(bare.ac - 4);
    expect(rowEl()!.querySelectorAll('[data-cond]').length, 'fixture: the sheet’s badges are on the row').toBe(2);
    expect(rowNumbers()).toEqual(card);
  }, 120_000);

  it('(D) the sheet’s temp HP shows on the row as "+N" — and is never the row’s own, nor pushed', async () => {
    /*
     * MUTATION (tried 2026-10-13): InitRow — `const hpTemp = 0` → fails at "+5 beside the bar". The other
     * assertions pin the display-only rule: a copy of their temp HP on the row would soak the GM's 4
     * before any real damage, and the push would carry less damage than he dealt.
     */
    const a = saved('char-a', NAME, 5);
    a.play = { ...a.play!, tempHp: 5 };
    srv.party = [publish(a, 'owner-a')];
    await openTracker();
    await addRow();
    expect(rowEl()!.querySelector('[data-temp-hp]')?.textContent?.trim(), '+5 beside the bar').toBe('+5');
    expect(pcRow().tempHP, 'the row keeps no temp HP').toBe(0);

    const before = pcRow().currentHP;
    act(() => store().applyDamage(pcRow().id, 4));
    await flush(3);
    expect(srv.pushes, 'the GM’s damage goes out').toHaveLength(1);
    expect(srv.pushes[0].sheet.play!.damage, 'all 4 of it, as real damage').toBe(a.play!.damage + 4);
    expect(srv.pushes[0].sheet.play!.tempHp, 'their temp HP is theirs: the push never touches it').toBe(5);
    expect(pcRow().currentHP).toBe(before - 4);
  }, 120_000);

  it('(E) the sheet’s persistent damage is the tracker’s Persistent Damage badge — and never rolls on a player', async () => {
    /*
     * MUTATION (tried 2026-10-13): drop the `'persistent-damage'` alias from conditionEffects
     * CONDITION_ALIASES → fails at the badge (expected 'persistent-damage' to be 'Persistent Damage': a
     * grey, unnamed "P"). The no-roll half needs no line of
     * this item's: the row keeps the sheet's id and no amount, and firePersistentDamage wants the exact
     * tracker name AND an amount — this pins that it stays that way.
     */
    const a = saved('char-a', NAME, 5);
    a.play = { ...a.play!, conditions: [{ id: 'persistent-damage' }] };
    srv.party = [publish(a, 'owner-a')];
    await openTracker();
    await addRow();
    const badge = rowEl()!.querySelector('[data-cond="persistent-damage"]') as HTMLElement;
    expect(badge, 'the sheet’s badge is on the row').toBeTruthy();
    expect(badge.getAttribute('title')).toBe('Persistent Damage');
    const probe = document.createElement('span');
    probe.style.background = CONDITION_META['persistent damage'].bg;
    expect(badge.style.background, 'styled as the tracker’s own').toBe(probe.style.background);

    useSettingsStore.setState({ persistentDamageAutoRoll: true });
    // A whole stat block: the turn moves to it, and the workspace opens it.
    const { SAMPLE_COMBATANT } = await import('../tracker/src/data/sampleStatBlock');
    const lurker = { ...JSON.parse(JSON.stringify(SAMPLE_COMBATANT.creature)), id: 'g3-lurker', name: 'Fen Lurker' } as Creature;
    act(() => {
      store().addCombatant(lurker, { initiative: 5 });
      store().setInitiative(pcRow().id, 20);
      store().startCombat();
    });
    await flush(2);
    const hp = pcRow().currentHP;
    act(() => store().nextTurn()); // their turn ends
    await flush(2);
    expect(pcRow().currentHP, 'nothing rolled').toBe(hp);
    expect(store().diceResults, 'no roll, no reminder').toEqual([]);
    expect(pcRow().conditions.map((c) => c.name), 'the row keeps the sheet’s name').toEqual(['persistent-damage']);
    expect(srv.pushes, 'and nothing went to the player').toEqual([]);
  }, 120_000);

  it('(G) what their sheet works out (Encumbered) and their active mode show LOCKED on the row — never as row conditions', async () => {
    /*
     * MUTATION (tried 2026-10-13): CampaignTracker — `badgesById={hostBadges}` dropped from the provider →
     * fails at the locked condition.
     */
    const db = content();
    const a = saved('char-a', NAME, 5);
    const modeId = 'item-addiction-suppressant-lesser';
    expect(db.modes[modeId], 'fixture: the mode exists').toBeTruthy();
    a.play = { ...a.play!, activeModes: [modeId] };
    srv.party = [publish(a, 'owner-a', {
      // A condition the PLAYER's app derived (their Bulk), carried onto this device's card.
      conditions: [{ id: 'encumbered', name: 'Encumbered', derivedFrom: 'Bulk — carrying 9 of 8' }],
    })];
    await openTracker();
    await addRow();
    const locked = [...rowEl()!.querySelectorAll('[data-locked]')];
    const enc = locked.find((b) => b.getAttribute('data-locked') === 'condition');
    expect(enc?.getAttribute('title')).toContain('Bulk');
    expect(enc?.textContent).toBe('E');
    const mode = locked.find((b) => b.getAttribute('data-locked') === 'mode');
    expect(mode?.textContent).toBe(db.modes[modeId].name);
    expect(pcRow().conditions.map((c) => c.name), 'never written onto the row').not.toContain('encumbered');
    expect(srv.pushes).toEqual([]);
  }, 120_000);

  it('(H) a rename on EITHER side keeps the row linked: AC and saves on the row, the card in the pane', async () => {
    /*
     * The row was added under the character's OLD name (the player has renamed them since), then the GM
     * renames the row as well. Both are the same character by id.
     * MUTATIONS (tried 2026-10-13, each alone on this leg): InitRow — `useHostPcStats(c.name, c.charId)` →
     * `useHostPcStats(c.name)` → fails at "AC on the row the player renamed"; CampaignTracker renderPcPane
     * — `memberOfRow(c)` back to a lookup by the row's name → fails at "the card in the pane"; the
     * dashboard card's `isSamePc` jump back to a name match → fails at "not the sheet" (the full sheet
     * opened instead of the pane).
     */
    const a = saved('char-a', 'Ayla Starwind', 5); // the player's current name
    srv.party = [publish(a, 'owner-a')];
    await openTracker();
    await addRow('Ayla Brightwood'); // the name the row was added under
    expect(pcRow().currentHP, 'the seam drives the row by id').toBe(a.character.hitPoints.current);
    const card = cardNumbers();
    expect(rowNumbers(), 'AC on the row the player renamed').toEqual(card);

    act(() => store().renameCombatant(pcRow().id, 'Ayla the Bold')); // and the GM renames the row
    await flush(2);
    expect(rowNumbers(), 'AC on the renamed row').toEqual(card);

    click(rowEl()!);
    await flush(3);
    expect(host!.querySelector('.ct-pane-card .party-card'), 'the card in the pane').toBeTruthy();
    expect(host!.querySelector('.ct-pane-card .party-card-name')?.textContent).toContain('Ayla Starwind');

    // In a fight, the dashboard card opens their pane — by id — not the full sheet. (Starting the fight
    // follows the turn into the workspace; the GM goes back to the dashboard.)
    act(() => store().startCombat());
    await flush(2);
    act(() => useLayoutStore.setState({ root: null }));
    act(() => trackerUi.showMain('party'));
    await flush(3);
    expect(host!.querySelector('.ct-pane-card'), 'fixture: no pane open').toBeNull();
    click(host!.querySelector('.party-grid .party-card')!);
    await flush(3);
    expect(host!.querySelector('.ct-sheet-full'), 'not the sheet').toBeNull();
    expect(host!.querySelector('.ct-pane-card .party-card'), 'the dashboard card opens the pane').toBeTruthy();
  }, 120_000);

  it('(H) Quick add of a member’s name adds that PC LINKED — once — and any other name as before', async () => {
    /*
     * MUTATION (tried 2026-10-13): MonsterSearch quickAdd — back to `addCombatant(null, { name })` for
     * every line → fails at "a player character" (isPC false, no charId).
     */
    const a = saved('char-a', NAME, 5);
    srv.party = [publish(a, 'owner-a')];
    await openTracker();
    act(() => trackerUi.setMonsterSearch(true));
    await flush(2);
    const box = [...host!.querySelectorAll('textarea')].find((t) => t.placeholder.startsWith('One name per line')) as HTMLTextAreaElement;
    expect(box, 'the Quick add box').toBeTruthy();
    const type = (v: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, v);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const addBtn = () => [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement;
    type(`${NAME.toLowerCase()}, Torch Bearer`);
    click(addBtn());
    await flush(3);
    const pc = store().combatants.find((c) => c.charId === 'char-a');
    expect(pc?.isPC, 'a player character').toBe(true);
    expect(pc?.name).toBe(NAME);
    expect(pc?.partyMemberId, 'the party member it was added for').toEqual(expect.any(String));
    expect(pc?.currentHP, 'the sheet drives it').toBe(a.character.hitPoints.current);
    const torch = store().combatants.find((c) => c.name === 'Torch Bearer');
    expect([torch?.isPC, torch?.charId], 'any other name is the name-only row it always was').toEqual([false, undefined]);

    type(NAME); // again: already in the order
    click(addBtn());
    await flush(2);
    expect(store().combatants.filter((c) => c.charId === 'char-a'), 'never twice').toHaveLength(1);
  }, 120_000);

  it('(I) "Show level in initiative order" shows a PC’s level from their sheet', async () => {
    // MUTATION (tried 2026-10-13): drop the `{showInitLevel && !!pcLevel && …}` chip from InitRow → fails.
    srv.party = [publish(saved('char-a', NAME, 5), 'owner-a')];
    await openTracker();
    await addRow();
    expect(rowEl()!.querySelector('[data-pc-level]')?.textContent).toBe('Lv 5');
    act(() => useSettingsStore.setState({ showInitLevel: false }));
    await flush(1);
    expect(rowEl()!.querySelector('[data-pc-level]')).toBeNull();
  }, 120_000);

  it('(A) "Stats shown" switches the DASHBOARD card’s own core — HP stays', async () => {
    // MUTATION (tried 2026-10-13): drop `core: cardCore(pcDetail),` from CampaignTracker.cardExtra → fails.
    srv.party = [publish(saved('char-a', NAME, 5), 'owner-a')];
    act(() => useSettingsStore.setState({ pcDetail: PC_DETAIL_PRESETS.find((p) => p.id === 'nameOnly')!.config }));
    await openTracker();
    const card = host!.querySelector('.party-grid .party-card')!;
    expect(card.querySelector('.party-card-sub'), 'Ancestry & class off').toBeNull();
    expect(card.querySelector('.party-perc'), 'Perception off').toBeNull();
    expect(card.querySelector('.party-def'), 'Defenses (and saves) off').toBeNull();
    expect(card.querySelector('.party-hp .party-hpbar'), '…and the HP bar stays').toBeTruthy();
  }, 120_000);

  it('(F) a Perception item’s bonus reaches the card (and the tracker’s PC stats), as it does the sheet', () => {
    // MUTATION (tried 2026-10-13): partySummary.computeSummary back to `derivePerception(c)` → fails at
    // the card; computePcStats back to `derivePerception(c)` → fails at the stats.
    const db = content();
    const a = saved('char-a', NAME, 5);
    expect(db.items['stags-helm']?.passiveEffects?.perception, 'fixture: a +1 Perception item').toBe(1);
    a.character = { ...a.character, inventory: [...a.character.inventory, { instanceId: 'helm-1', itemId: 'stags-helm', quantity: 1, worn: true, invested: true }] };
    const withItem = derivePerception(a.character, db).modifier;
    expect(withItem, 'fixture: the sheet counts it').toBe(derivePerception(a.character).modifier + 1);
    expect(computeSummary(a.character, db).perception, 'the card').toBe(withItem);
    expect(computePcStats(a.character, db).perceptionMod, 'the tracker’s PC stats').toBe(withItem);
  });
});
