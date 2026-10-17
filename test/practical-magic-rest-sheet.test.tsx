// @vitest-environment jsdom
/*
 * The Rest sheet's "Temporary spell catalyst" pickers for Practical Magic (Hedge Mage, AoN feat-9331), rendered
 * (package I, item I6c, finding i6c-practical-magic-common-catalysts, 2026-10-17).
 *
 * test/daily-items.test.ts proves the rules function. This proves the sheet CALLS it the way the player meets it:
 * the Daily preparations dialog, two pickers, listing only the common catalysts at half level or lower — and the
 * catalyst the player already picked today stays on its picker whatever its rarity (a player's change is never
 * overwritten). All catalyst books are switched on, so the book filter does not hide the answer being tested.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { CharacterSheet } from '../src/sheet/CharacterSheet';
import { dailyItemOptions, dailyItemSlots } from '../src/rules/dailyItems';
import { CORE_BOOKS, enabledBookSet, storedSources } from '../src/rules/sources';
import type { Character } from '../src/rules/types';

const noop = () => undefined;
const db = content();
const FEAT = 'practical-magic-impossible-magic';
const catalysts = Object.values(db.items).filter((i) => (i.traits ?? []).includes('catalyst'));
const allBooks = storedSources([...CORE_BOOKS, ...new Set(catalysts.map((i) => i.source?.book).filter((b): b is string => !!b))]);

const hedgeMage = (over: Partial<Character> = {}): Character => {
  const c = build('wizard', 12, {});
  return { ...c, feats: [...c.feats, { featId: FEAT, level: 2, slot: 'x:0' }], enabledSources: allBooks, ...over } as Character;
};

afterEach(() => {
  for (const el of [...document.querySelectorAll('.confirm-overlay')]) el.parentElement?.remove();
});

/** Open the Daily preparations dialog and read each catalyst picker's option count, by slot order. */
function catalystPickerCounts(ch: Character): number[] {
  const s = renderDom(<CharacterSheet character={ch} content={db} charKey="t" onPlay={noop} onRest={noop} />);
  s.click([...s.host.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Daily preparations') ?? null);
  const dialog = s.host.querySelector('.confirm-modal');
  expect(dialog, 'the Daily preparations dialog is open').toBeTruthy();
  const counts = dailyItemSlots(ch, db).map((slot) => {
    const ctl = [...dialog!.querySelectorAll<HTMLElement>('[data-ctl-title]')].find((e) => e.getAttribute('data-ctl-title') === slot.label);
    expect(ctl, `${slot.label} has a picker`).toBeTruthy();
    return Number(ctl!.getAttribute('data-ctl-options'));
  });
  s.stop();
  return counts;
}

describe('the rendered Daily preparations dialog for Practical Magic', () => {
  const common6 = catalysts.filter((i) => (i.level ?? 0) <= 6 && (i.rarity ?? 'common') === 'common').length;
  const all6 = catalysts.filter((i) => (i.level ?? 0) <= 6).length;

  it('two catalyst pickers, each listing the common catalysts at half level or lower and not the 23 uncommon or rare ones', () => {
    expect(common6).toBeGreaterThan(30);
    expect(all6).toBeGreaterThan(common6);
    // package I: i6c-practical-magic-common-catalysts
    expect(catalystPickerCounts(hedgeMage())).toEqual([common6, common6]);
  });

  it("the catalyst the player already picked today stays on its picker whatever its rarity, and only on that picker", () => {
    const ch = hedgeMage();
    const [first] = dailyItemSlots(ch, db);
    expect(db.items['black-ash'].rarity).toBe('rare');
    const picked = hedgeMage({ dailyItems: { [first.key]: 'black-ash' } });
    // the rules function agrees with what the sheet shows
    expect(dailyItemOptions(first, picked, db, { enabled: enabledBookSet(allBooks), keep: 'black-ash' })).toHaveLength(common6 + 1);
    // package I: i6c-practical-magic-common-catalysts
    expect(catalystPickerCounts(picked)).toEqual([common6 + 1, common6]);
  });
});
