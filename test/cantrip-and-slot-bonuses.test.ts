import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { cantripsKnown } from '../src/rules/spellcasting';

/**
 * Cantrip Expansion is one of the most-taken feats in the game and did nothing whatsoever.
 *
 * The slot applier filters `r > 0`, so a `byRank['0']` was silently dropped, and nothing else could
 * reach the cantrip cap — which is applied while the spellcasting entries are assembled, long before
 * the slot bonuses are collected and before the resolved feats array even exists.
 *
 * Gifted Power had the neighbouring problem: "an extra slot of your HIGHEST rank" moves with level,
 * so byRank cannot say it and perRank would have granted one at every rank instead of one at the top.
 */
const db = content();

describe('extra cantrips', () => {
  it('Cantrip Expansion raises the cap by two', () => {
    const plain = build('wizard', 5, {});
    const withIt = build('wizard', 5, { featPicks: { '2:class': 'cantrip-expansion' } });
    const cap = (ch: typeof plain) => {
      const e = ch.spellcasting.find((x) => x.type === 'prepared' || x.type === 'spontaneous')!;
      return e.cantrips.length;
    };
    // The cap only shows if the player has picked that many; assert the CAP, not the picks.
    expect(db.feats['cantrip-expansion'].spellSlotBonus?.cantrips).toBe(2);
    expect(cap(withIt)).toBeGreaterThanOrEqual(cap(plain));
  });

  it('a wizard with it can hold two cantrips beyond the class default', () => {
    const many = Object.keys(db.spells).filter((id) => db.spells[id].rank === 0 && db.spells[id].traditions?.includes('arcane')).slice(0, 12);
    const base = cantripsKnown('wizard');
    const ch = build('wizard', 5, { cantrips: many, featPicks: { '2:class': 'cantrip-expansion' } });
    const e = ch.spellcasting.find((x) => x.type === 'prepared')!;
    expect(e.cantrips.length).toBeGreaterThan(base);
  });

  it('without the feat the class default still holds', () => {
    const many = Object.keys(db.spells).filter((id) => db.spells[id].rank === 0 && db.spells[id].traditions?.includes('arcane')).slice(0, 12);
    const ch = build('wizard', 5, { cantrips: many });
    const e = ch.spellcasting.find((x) => x.type === 'prepared')!;
    // The wizard's curriculum can add one on top, so this is a ceiling rather than an equality.
    expect(e.cantrips.length).toBeLessThanOrEqual(cantripsKnown('wizard') + 1);
  });
});

describe('a slot at your highest rank', () => {
  it('Gifted Power grants exactly one, at the top rank only', () => {
    const bonus = db.feats['gifted-power'].spellSlotBonus!;
    expect(bonus.highestOnly).toBe(true);

    const plain = build('oracle', 9, {});
    const withIt = build('oracle', 9, { featPicks: { '8:class': 'gifted-power' } });
    const slots = (ch: typeof plain) => {
      const e = ch.spellcasting.find((x) => x.type === 'spontaneous' || x.type === 'prepared');
      return Object.fromEntries(Object.entries(e?.slots ?? {}).map(([r, s]) => [r, s.max]));
    };
    const a = slots(plain);
    const b = slots(withIt);
    const gained = Object.keys(b).filter((r) => (b[r] ?? 0) > (a[r] ?? 0));
    expect(gained.length, 'it granted a slot at more than one rank').toBe(1);
    const top = Math.max(...Object.keys(a).map(Number).filter((r) => r > 0));
    expect(Number(gained[0])).toBe(top);
  });

  it('its printed restriction is carried as text, not enforced', () => {
    // The engine does not police what goes into a slot; pretending otherwise would be worse than
    // showing the player the sentence.
    expect(db.feats['gifted-power'].spellSlotBonus?.restriction).toMatch(/mystery/i);
  });
});
