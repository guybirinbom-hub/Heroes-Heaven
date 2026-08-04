import { describe, it, expect } from 'vitest';
import { build, content } from './_content';

/**
 * "Increase your limit on invested items from 10 to 12."
 *
 * The inventory capped investment at a bare `const INVESTED_LIMIT = 10` — the Invest button, the
 * drag-to-Equipped guard and the counter badge all read it — so Incredible Investiture, whose entire
 * content is that sentence, could not raise anything.
 */
const db = content();

describe('invested-item limit', () => {
  it('is unset (meaning the RAW 10) without the feat', () => {
    expect(build('fighter', 12, {}).investedLimit).toBeUndefined();
  });

  it('Incredible Investiture raises it to 12', () => {
    const ch = build('fighter', 12, { featPicks: { '11:skill': 'incredible-investiture' } });
    expect(ch.investedLimit).toBe(12);
  });

  it('the data carries the printed increase, not a guess', () => {
    expect(db.feats['incredible-investiture'].investedLimitBonus).toBe(2);
  });

  it("the Thaumaturge's version grants the feat rather than duplicating the bonus", () => {
    // Thaumaturge's Investiture reads "You gain the Incredible Investiture skill feat" — if it ALSO
    // carried the field, a thaumaturge would end up at 14.
    expect(db.feats['thaumaturges-investiture'].investedLimitBonus).toBeUndefined();
  });
});
