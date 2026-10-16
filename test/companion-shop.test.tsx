// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { CORE_BOOKS, storedSources } from '../src/rules/sources';
import { CompanionsTab } from '../src/sheet/CompanionsTab';
import { InventoryTab } from '../src/sheet/InventoryTab';
import type { Character, CompanionConfig, ContentDatabase } from '../src/rules/types';
import type { PlayState } from '../src/rules/play';

/*
 * Package G, item 1 (2026-10-16): "the Companions tab has a full Add items / Buy shop for a companion that
 * no button opens".
 *
 * Re-checked: the unreachable one is a LEFTOVER. Since b76d2b3 (2026-08-11) a companion's gear is the real
 * InventoryTab (CompanionInventory), and its own "Add item" button opens the shop — the backpack button on
 * every companion card leads there. The old `invAddFor` mount in CompanionsTab lost its only opener in that
 * commit and is removed. What this file pins is the path a player really takes: the companion's backpack →
 * Add item → Buy, and that the bought item lands on THAT companion and costs the character's coins, the way
 * the character's own shop does.
 *
 * The re-check found a real loss on that path: companion gear (barding, a saddle) bought inside a companion's
 * own pack went through the "who wears it" routing, which wrote it onto play.companions while the pack was
 * lent out (onCompanionInventory), and putting the pack back erased it — 130 gp spent, no barding. Run on the
 * code before the fix, the two gear legs below failed (`expected [] to deeply equal [ 'waverider-barding' ]`).
 *
 * MUTATION LINES (src/sheet/InventoryTab.tsx addMaybeToCompanion; proven on a scratch copy, 2026-10-16)
 *   1. Drop `scope ||` from the first test: both companion-gear legs go red (item lost / the question opens).
 *   2. Drop `&& !scope` from the "is companion gear" notice: both companion-gear legs go red (a dialog opens).
 */
const BAZAAR = 'Pathfinder Lost Omens The Grand Bazaar';
const BARDING = 'waverider-barding'; // companion trait, 130 gp, The Grand Bazaar
const REX: CompanionConfig = { id: 'cmp-0', kind: 'animal', name: 'Rex' } as CompanionConfig;
const MOTH: CompanionConfig = { id: 'cmp-1', kind: 'familiar', name: 'Moth' } as CompanionConfig;

function shopDb(): ContentDatabase {
  const c = content();
  return { ...c, items: { longsword: c.items['longsword'], [BARDING]: c.items[BARDING] } } as ContentDatabase;
}

/** Open `compName`'s backpack, press Add item, press Buy on `itemName`; returns the play state after. */
function buyFromCompanionPack(companions: CompanionConfig[], compName: string, itemName: string): PlayState {
  const db = shopDb();
  const character = {
    ...build('fighter', 3),
    companions,
    currency: { gp: 500 },
    enabledSources: storedSources([...CORE_BOOKS, BAZAAR]),
  } as Character;
  let play = { companions, currency: { gp: 500 }, inventory: [] } as unknown as PlayState;
  const onPlay = (fn: (p: PlayState) => PlayState) => {
    play = fn(play);
  };
  const s = renderDom(<CompanionsTab character={character} content={db} onPlay={onPlay} charKey="t" />);
  const pill = [...s.host.querySelectorAll('.cmp-pill')].find((e) => (e.textContent ?? '').includes(compName));
  s.click(pill ?? null);
  s.click(s.host.querySelector('button[title="Inventory"]'));
  const add = [...s.host.querySelectorAll('button')].find((e) => (e.textContent ?? '').trim() === 'Add item');
  expect(add, 'the companion pack has an Add item button').toBeTruthy();
  s.click(add!);
  const row = [...s.host.querySelectorAll('.ai-row')].find((r) => (r.querySelector('.ai-name')?.textContent ?? '').trim() === itemName);
  expect(row, `${itemName} is offered`).toBeTruthy();
  const buy = [...row!.querySelectorAll('.ai-buy button')].find((b) => (b.textContent ?? '').trim() === 'Buy');
  s.click(buy ?? null);
  s.stop();
  return play;
}

const packOf = (play: PlayState, id: string) => (play.companions ?? []).find((c) => c.id === id)?.inventory ?? [];

afterEach(() => {
  for (const el of [...document.querySelectorAll('.confirm-overlay')]) el.parentElement?.remove();
});

describe('package G: buying from a companion\'s own pack', () => {
  it('fixtures: the barding is companion gear from The Grand Bazaar at 130 gp; the longsword 1 gp', () => {
    const c = content();
    expect(c.items[BARDING]?.traits).toContain('companion');
    expect(c.items[BARDING]?.source?.book).toBe(BAZAAR);
    expect(c.items[BARDING]?.price).toEqual({ gp: 130 });
    expect(c.items['longsword']?.price).toEqual({ gp: 1 });
  });

  it('a plain item lands on that companion and costs the character its price', () => {
    const play = buyFromCompanionPack([REX], 'Rex', 'Longsword');
    expect(packOf(play, REX.id).map((i) => i.itemId)).toEqual(['longsword']);
    expect(play.inventory ?? []).toEqual([]);
    expect(play.currency).toEqual({ gp: 499 });
  });

  it('companion gear bought in a companion\'s own pack lands on that companion — not lost, not asked', async () => {
    const play = buyFromCompanionPack([REX], 'Rex', 'Waverider Barding');
    await act(async () => undefined);
    expect(document.querySelector('.confirm-modal'), 'no "who wears it" question inside a companion\'s own pack').toBeNull();
    expect(play.currency).toEqual({ gp: 370 });
    // Before the fix the coins above were taken and the pack below stayed empty: the item went onto
    // play.companions while the companion's pack was lent out, and putting the pack back overwrote it.
    expect(packOf(play, REX.id).map((i) => i.itemId)).toEqual([BARDING]);
  });

  /* The side the fix leaves alone (found unguarded by package G's checker): from the CHARACTER's own Inventory,
   * companion gear still goes to the companion that wears it. MUTATION LINE: make the first test in
   * addMaybeToCompanion `if (true)` — red (the barding lands in the character's pack). */
  it('companion gear bought from the CHARACTER\'s own Inventory still goes to their one companion', () => {
    const db = shopDb();
    const character = {
      ...build('fighter', 3),
      companions: [REX],
      currency: { gp: 500 },
      enabledSources: storedSources([...CORE_BOOKS, BAZAAR]),
    } as Character;
    let play = { companions: [REX], currency: { gp: 500 }, inventory: [] } as unknown as PlayState;
    const s = renderDom(<InventoryTab character={character} content={db} onPlay={(fn: (p: PlayState) => PlayState) => { play = fn(play); }} />);
    const add = [...s.host.querySelectorAll('button')].find((e) => (e.textContent ?? '').trim() === 'Add item');
    s.click(add ?? null);
    const row = [...s.host.querySelectorAll('.ai-row')].find((r) => (r.querySelector('.ai-name')?.textContent ?? '').trim() === 'Waverider Barding');
    s.click([...row!.querySelectorAll('.ai-buy button')].find((b) => (b.textContent ?? '').trim() === 'Buy') ?? null);
    s.stop();
    expect(packOf(play, REX.id).map((i) => i.itemId)).toEqual([BARDING]);
    expect(play.inventory ?? []).toEqual([]);
    expect(play.currency).toEqual({ gp: 370 });
  });

  it('with two companions, gear bought in the second one\'s pack lands on the second one', async () => {
    const play = buyFromCompanionPack([REX, MOTH], 'Moth', 'Waverider Barding');
    await act(async () => undefined);
    expect(document.querySelector('.confirm-modal')).toBeNull();
    expect(packOf(play, MOTH.id).map((i) => i.itemId)).toEqual([BARDING]);
    expect(packOf(play, REX.id)).toEqual([]);
    expect(play.currency).toEqual({ gp: 370 });
  });
});
