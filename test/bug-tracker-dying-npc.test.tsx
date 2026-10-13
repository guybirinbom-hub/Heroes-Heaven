// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import type { CampaignMembership } from '../src/data/campaigns';
import type { PartyMember } from '../src/data/party';
import type { SavedChar } from '../src/data/storage';
import type { Creature } from '../tracker/src/types/pf2e';
import { useCombatStore, downsAsPC } from '../tracker/src/store/combatStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { useLayoutStore } from '../tracker/src/store/layoutStore';
import { trackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';
import { clearGmPendingEdits } from '../src/sheet/gmSync';

/**
 * OWNER'S LIST 2026-10-01, ITEM 2, AT THE SEAM — the campaign view as a GM meets it. Synthetic names only.
 *
 *  (a) "Right-click on a stat block → treat like a player when at 0 HP." Inside Heroes Heaven the app
 *      swallows every right-click outside a text field (src/App.tsx), so a right-click on an open stat
 *      block did NOTHING. It now opens the combatant menu — the initiative row's own menu, on <body> as
 *      a `.tracker-root` — and one Escape closes that menu without leaving the campaign.
 *  (b) A defect of the same class as the row menu's 2026-10-10 Escape (found while building this): Escape
 *      in the initiative row's inline RENAME box, or in its initiative-number box, was never stopped, so
 *      it reached the dismiss stack, whose base handler found no popup on <body> for a box inside the
 *      tracker and LEFT THE CAMPAIGN (the local table: the whole page). It now cancels the edit and stays.
 *  (c) The same, in the open stat block's HP boxes (found 2026-10-11 by the round-1 refuter): the damage
 *      box — where the GM types the hit that drops a creature to 0 — and the max-HP box.
 *  (d) The same, in the stat block's notes box, with its ☰ menu open, and in its condition picker — where
 *      the GM adds Dying and Wounded (found 2026-10-11 by the round-2 refuter, and while fixing it). Every box the tracker draws ought to be safe from the host's side instead (its base
 *      Escape handler leaving alone a key typed in a text field); until then each box spends its own.
 *
 * The store's half (knock-out, turn order, death) is tracker/src/store/combatStore.transitions.test.ts;
 * the party NPC's kept setting is tracker/src/store/partyOrder.test.ts; the stat block's menu routes are
 * tracker/src/components/CombatantMenu.test.tsx; a player's own drop to 0 is a leg of
 * test/bug-tracker-seam-never-overwrite.test.tsx.
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
    return sheet ? { sheet, ownerId: 'owner-x', updatedAt: '2026-10-11T10:00:00.000Z' } : null;
  },
  subscribeMemberSheet: () => () => undefined,
  subscribeParty: () => () => undefined,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  subscribeGmEdits: () => () => undefined,
  pushGmEdit: async (_c: string, _ch: string, _o: string, _s: SavedChar) => ({ ok: true, value: null }),
}));

const CAMPAIGN: CampaignMembership = { id: 'camp-dying', code: 'DYINGNPC', role: 'gm', name: 'The Ember Road' };

/** A synthetic creature, so the stat block draws its Notes toggle and its ☰ menu. */
const LANTERN_SPIDER: Creature = {
  id: 'synth-lantern-spider', name: 'Lantern Spider', source: 'Test', level: 1,
  traits: ['animal'], perception: 7, senses: [], languages: [], skills: {},
  str: 1, dex: 3, con: 1, int: -4, wis: 2, cha: -3,
  items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
  defenses: { ac: 16, fort: 6, ref: 9, will: 5, hp: 18, immunities: [], resistances: [], weaknesses: [] },
  isHazard: false,
  raw: {} as Creature['raw'],
};

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

const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
/** Escape at `el`, delivered the way the browser does: up through the page to `document` and `window`. */
async function escapeAt(el: EventTarget): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  await flush(2);
}
/** Type into a React-controlled box. */
function type(input: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** The tracker's popup on <body> — the combatant menu (BodyPortal: exactly `.tracker-root`, no `campaign-tracker`). */
const popup = () => document.querySelector<HTMLElement>('body > .tracker-root:not(.campaign-tracker)');

beforeEach(() => {
  localStorage.clear();
  srv.party = [];
  srv.sheets.clear();
  clearGmPendingEdits();
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

/** The campaign view, counting how often it LEAVES (Escape / Back with nothing open on top). */
async function openCampaign(): Promise<{ el: HTMLElement; left: () => number }> {
  const { CampaignTracker } = await import('../src/integration/CampaignTracker');
  let left = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() =>
    live!.render(
      <CampaignTracker
        m={CAMPAIGN}
        content={content()}
        onOpenSettings={() => undefined}
        onLeave={() => {
          left++;
        }}
        onViewMember={() => undefined}
      />,
    ),
  );
  await flush();
  return { el: host, left: () => left };
}

const rowFor = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('.init-row')].find((r) => (r.textContent ?? '').includes(name)) as HTMLElement | undefined;

describe('item 2 at the seam — the stat block’s right-click, and Escape in the row’s own boxes', () => {
  it('(b) Escape in the row’s RENAME box cancels the rename and the campaign stays', async () => {
    /*
     * MUTATION (tried 2026-10-11): drop `e.stopPropagation();` from the rename box's Escape
     * (tracker/src/components/InitiativeTracker.tsx) and this fails —
     *   AssertionError: the campaign stays: expected 1 to be +0
     */
    const { el, left } = await openCampaign();
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Saltmarsh Gull', initiative: 12 }));
    await flush(1);
    const row = rowFor(el, 'Saltmarsh Gull');
    if (!row) throw new Error(`no initiative row — rail held: ${(el.querySelector('.ct-order')?.textContent ?? '(no rail)').slice(0, 200)}`);
    act(() => void row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })));
    await flush(1);
    const rename = [...(popup()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Rename');
    expect(rename, 'the row menu offers Rename').toBeTruthy();
    click(rename!);
    await flush(1);
    expect(popup(), 'the menu closed on Rename').toBeNull();
    const box = row.querySelector<HTMLInputElement>('input');
    expect(box, 'the rename box is open').not.toBeNull();
    type(box!, 'Gull Who Was Renamed');

    await escapeAt(box!);
    expect(left(), 'the campaign stays').toBe(0);
    expect(el.querySelector('.campaign-tracker')).not.toBeNull();
    expect(rowFor(el, 'Saltmarsh Gull')?.querySelector('input'), 'the box closed').toBeFalsy();
    expect(useCombatStore.getState().combatants[0].name, 'the rename was cancelled').toBe('Saltmarsh Gull');

    // Not vacuous: an Escape with nothing open still leaves, as it always has.
    await escapeAt(window);
    expect(left()).toBe(1);
  }, 120_000);

  it('(b) Escape in the row’s INITIATIVE box cancels the edit and the campaign stays', async () => {
    /*
     * MUTATION (tried 2026-10-11): drop `e.stopPropagation();` from the initiative box's Escape and this
     * fails —
     *   AssertionError: the campaign stays: expected 1 to be +0
     * MUTATION (tried 2026-10-11): drop `setInitVal(c.initiative?.toString() ?? '')` from beginEditInit
     * (the box kept the number the row MOUNTED with, so a Roll since then was put back on a click-away)
     * and this fails —
     *   AssertionError: it opens on the row’s current number: expected '12' to be '14'
     */
    const { el, left } = await openCampaign();
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Saltmarsh Gull', initiative: 12 }));
    await flush(1);
    // A new number after the row mounted (a Roll does the same).
    act(() => useCombatStore.getState().setInitiative(useCombatStore.getState().combatants[0].id, 14));
    await flush(1);
    const row = rowFor(el, 'Saltmarsh Gull')!;
    const number = [...row.querySelectorAll('span')].find((s) => s.textContent === '14');
    expect(number, 'the row shows its initiative').toBeTruthy();
    click(number!);
    await flush(1);
    const box = row.querySelector<HTMLInputElement>('input');
    expect(box, 'the initiative box is open').not.toBeNull();
    expect(box!.value, 'it opens on the row’s current number').toBe('14');
    type(box!, '3');

    await escapeAt(box!);
    expect(left(), 'the campaign stays').toBe(0);
    expect(rowFor(el, 'Saltmarsh Gull')?.querySelector('input'), 'the box closed').toBeFalsy();
    expect(useCombatStore.getState().combatants[0].initiative, 'the edit was cancelled').toBe(14);
  }, 120_000);

  it('(c) Escape in the stat block’s damage box and max-HP box clears / cancels them and the campaign stays', async () => {
    /*
     * MUTATION (tried 2026-10-11): the damage box's onKeyDown back to Enter only
     * (tracker/src/components/HPTracker.tsx), or `e.stopPropagation()` dropped from spendEscape (HPTracker's
     * own then; tracker/src/utils/spendEscape.ts since round 2), and this fails —
     *   AssertionError: the campaign stays (damage box): expected 1 to be +0
     * MUTATION (tried 2026-10-11): drop the max-HP box's `spendEscape(…)` line and this fails —
     *   AssertionError: the campaign stays (max-HP box): expected 1 to be +0
     */
    const { el, left } = await openCampaign();
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Ferry Warden', initiative: 12, maxHP: 30 }));
    await flush(1);
    click(rowFor(el, 'Ferry Warden')!);
    await flush(2);
    const dmg = el.querySelector<HTMLInputElement>('input[placeholder="50 · -30 · t15"]');
    if (!dmg) throw new Error('the row did not open its stat block (no damage box) in the workspace');
    type(dmg, '50');

    await escapeAt(dmg);
    expect(left(), 'the campaign stays (damage box)').toBe(0);
    expect(dmg.value, 'Escape clears the box').toBe('');
    expect(useCombatStore.getState().combatants[0].currentHP, 'nothing was applied').toBe(30);

    // The max-HP box: a click on "/ 30" opens it.
    const bar = dmg.parentElement!;
    const maxLink = [...bar.querySelectorAll('span')].find((s) => s.textContent === ' / 30');
    expect(maxLink, 'the max HP is shown').toBeTruthy();
    click(maxLink!);
    await flush(1);
    const maxBox = bar.querySelector<HTMLInputElement>('input[type="number"]');
    expect(maxBox, 'the max-HP box is open').not.toBeNull();
    type(maxBox!, '45');

    await escapeAt(maxBox!);
    expect(left(), 'the campaign stays (max-HP box)').toBe(0);
    expect(bar.querySelector('input[type="number"]'), 'the box closed').toBeNull();
    expect(useCombatStore.getState().combatants[0].maxHP, 'the edit was cancelled').toBe(30);
    expect(el.querySelector('.campaign-tracker')).not.toBeNull();
  }, 120_000);

  it('(d) Escape in the stat block’s notes box, its ☰ menu or its condition picker stays in the campaign', async () => {
    /*
     * The round-2 refuter (2026-10-11): the same class as (b) and (c), in this item's other boxes — the
     * stat block's notes boxes and its ☰ menu (the touch screen's way to the combatant menu; drawn inside
     * the tracker, it is no popup on <body> the base handler can see). Each component leg, with the PC's
     * and the party player's notes boxes and the party card's boxes, is in
     * tracker/src/components/CombatantMenu.test.tsx ("Escape in the stat block’s and the party card’s other
     * boxes goes no further").
     * MUTATION (tried 2026-10-11): drop `onKeyDown={escapeLeavesBox}` from the monster's notes box
     * (tracker/src/components/CombatantDetail.tsx) and this fails —
     *   AssertionError: the campaign stays (notes box): expected 1 to be +0
     * MUTATION (tried 2026-10-11): drop `document.addEventListener('keydown', k)` from HamburgerMenu and this
     * fails —
     *   AssertionError: the campaign stays (☰ menu): expected 1 to be +0
     * MUTATION (tried 2026-10-11): drop `document.addEventListener('keydown', onKey)` from the condition
     * picker (tracker/src/components/ConditionPanel.tsx) and this fails —
     *   AssertionError: the campaign stays (condition picker): expected 1 to be +0
     */
    const { el, left } = await openCampaign();
    act(() => useCombatStore.getState().addCombatant(LANTERN_SPIDER, { name: 'Lantern Spider', initiative: 12 }));
    await flush(1);
    click(rowFor(el, 'Lantern Spider')!);
    await flush(2);
    const notesButton = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Notes');
    if (!notesButton) throw new Error('the row did not open its stat block (no Notes button) in the workspace');
    click(notesButton);
    await flush(1);
    const notes = el.querySelector<HTMLTextAreaElement>('textarea[placeholder="Notes about this combatant..."]');
    expect(notes, 'the notes box is open').not.toBeNull();
    act(() => notes!.focus());
    await escapeAt(notes!);
    expect(left(), 'the campaign stays (notes box)').toBe(0);
    expect(document.activeElement, 'Escape left the box').not.toBe(notes);

    const options = el.querySelector<HTMLElement>('button[title="Options"]');
    expect(options, 'the stat block’s ☰ menu').not.toBeNull();
    click(options!);
    await flush(1);
    const scaleTo = () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Scale to');
    expect(scaleTo(), 'the ☰ menu is open').toBeTruthy();
    await escapeAt(options!);
    expect(left(), 'the campaign stays (☰ menu)').toBe(0);
    expect(scaleTo(), 'one Escape closed the ☰ menu').toBeFalsy();

    // The condition picker — where the GM adds Dying and Wounded — with the focus in its search box.
    const addCondition = [...el.querySelectorAll('button')].find((b) => b.textContent === '+ Condition');
    expect(addCondition, 'the stat block’s + Condition').toBeTruthy();
    click(addCondition!);
    await flush(1);
    const search = () => el.querySelector<HTMLInputElement>('input[placeholder="Search conditions…"]');
    expect(search(), 'the condition picker is open').not.toBeNull();
    await escapeAt(search()!);
    expect(left(), 'the campaign stays (condition picker)').toBe(0);
    expect(search(), 'one Escape closed the picker').toBeNull();
    expect(el.querySelector('.campaign-tracker')).not.toBeNull();

    // Not vacuous: an Escape with nothing open still leaves, as it always has.
    await escapeAt(window);
    expect(left()).toBe(1);
  }, 120_000);

  it('(a) a right-click on the open stat block opens the combatant menu; its switch sets the creature; one Escape closes it and stays', async () => {
    /*
     * MUTATION (tried 2026-10-11): drop `onContextMenu={onStatBlockContextMenu}` from CombatantDetail's
     * root (tracker/src/components/CombatantDetail.tsx) and this fails —
     *   AssertionError: the right-click was handled: expected false to be true
     */
    const { el, left } = await openCampaign();
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Hired Lantern-Bearer', initiative: 12 }));
    await flush(1);
    click(rowFor(el, 'Hired Lantern-Bearer')!);
    await flush(2);
    const heading = [...el.querySelectorAll('h1')].find((h) => h.textContent === 'Hired Lantern-Bearer');
    if (!heading) throw new Error('the row did not open its stat block in the workspace');

    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 });
    act(() => void heading.dispatchEvent(ev));
    await flush(1);
    // Prevented: HH's own right-click listener (src/App.tsx) leaves an event alone once it is.
    expect(ev.defaultPrevented, 'the right-click was handled').toBe(true);
    const menu = popup();
    expect(menu, 'the combatant menu, on <body>').not.toBeNull();
    const sw = menu!.querySelector<HTMLElement>('[role="menuitemcheckbox"]');
    expect(sw?.textContent).toContain('At 0 HP: dying like a player');
    expect(sw?.getAttribute('aria-checked')).toBe('false');
    click(sw!);
    await flush(1);
    expect(popup(), 'a choice closes the menu').toBeNull();
    expect(downsAsPC(useCombatStore.getState().combatants[0])).toBe(true);

    // Open again: the switch reads on, the knock-out is offered by name — and one Escape closes the
    // menu and leaves the campaign up.
    act(() => void heading.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 })));
    await flush(1);
    expect(popup()!.querySelector('[role="menuitemcheckbox"]')!.getAttribute('aria-checked')).toBe('true');
    expect(popup()!.textContent).toContain('Knock out (0 HP)');
    await escapeAt(popup()!);
    expect(popup(), 'the menu closed').toBeNull();
    expect(left(), 'one Escape closed the menu and left the table up').toBe(0);
    expect(el.querySelector('.campaign-tracker')).not.toBeNull();
  }, 120_000);
});
