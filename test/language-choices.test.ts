import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { bonusLanguageSlots, emptyBuild, recordLanguageSlots } from '../src/rules/build';

/**
 * "You learn three new languages of your choice."
 *
 * `grantsLanguages` names WHICH languages a record hands over, so a record handing over a CHOICE had
 * no field at all — and Multilingual, the most-taken language feat in the game, did nothing.
 */
const db = content();

/** A build whose Int gives no bonus slots, so every slot counted here came from a record. */
function withFeats(featIds: string[], over: Record<string, unknown> = {}) {
  const b = { ...emptyBuild(), ancestryId: 'human', heritageId: null, classId: 'fighter', level: 5, ...over };
  b.featPicks = Object.fromEntries(featIds.map((id, i) => [`${i + 1}:ancestry`, id]));
  return b;
}

describe('a record can grant language CHOICES', () => {
  it('Multilingual carries the two, and the two rank-gated extras', () => {
    expect(db.feats.multilingual?.languageChoices).toBe(2);
    expect(db.feats.multilingual?.languageChoicesAtRank).toEqual([
      { skill: 'society', rank: 'master', extra: 1 },
      { skill: 'society', rank: 'legendary', extra: 1 },
    ]);
  });

  it('taking it widens the pick budget by two', () => {
    const none = bonusLanguageSlots(withFeats([]), db);
    const one = bonusLanguageSlots(withFeats(['multilingual']), db);
    expect(one).toBe(none + 2);
  });

  it('it is repeatable, so taking it twice gives four', () => {
    const none = bonusLanguageSlots(withFeats([]), db);
    const twice = bonusLanguageSlots(withFeats(['multilingual', 'multilingual']), db);
    expect(twice).toBe(none + 4);
  });

  it('Gnome Polyglot gives three', () => {
    const none = bonusLanguageSlots(withFeats([]), db);
    expect(bonusLanguageSlots(withFeats(['gnome-polyglot']), db)).toBe(none + 3);
  });

  it('and it makes Multilingual give three instead of two', () => {
    // "When you select the Multilingual feat, you learn three new languages instead of two."
    const none = bonusLanguageSlots(withFeats([]), db);
    const both = bonusLanguageSlots(withFeats(['gnome-polyglot', 'multilingual']), db);
    expect(both).toBe(none + 3 + 3);
  });

  it('Pact of the Rune Dragon gives ten', () => {
    const none = bonusLanguageSlots(withFeats([]), db);
    expect(bonusLanguageSlots(withFeats(['pact-of-the-rune-dragon']), db)).toBe(none + 10);
  });
});

describe('the rank-gated extras rise with the character', () => {
  const slots = (rank: 'trained' | 'expert' | 'master' | 'legendary') =>
    recordLanguageSlots(db, ['multilingual'], null, [], { society: rank }, 15);

  it('"or BECOME a master in Society" is read from the character, not frozen at selection', () => {
    expect(slots('trained')).toBe(2);
    expect(slots('expert')).toBe(2);
    expect(slots('master')).toBe(3);
    expect(slots('legendary')).toBe(4); // master's extra AND legendary's
  });

  it('the extras apply per take, like the base does', () => {
    expect(recordLanguageSlots(db, ['multilingual', 'multilingual'], null, [], { society: 'legendary' }, 15)).toBe(8);
  });

  it('a Society rank on its own grants nothing without the feat', () => {
    expect(recordLanguageSlots(db, [], null, [], { society: 'legendary' }, 15)).toBe(0);
  });
});

describe('the chosen languages actually land on the sheet', () => {
  it('a language picked into a record-granted slot is known', () => {
    const langs = Object.keys(db.languages).slice(0, 3);
    const plain = build('fighter', 5, { ancestryId: 'human', languages: langs });
    const poly = build('fighter', 5, {
      ancestryId: 'human',
      languages: langs,
      featPicks: { '1:ancestry': 'gnome-polyglot' },
    });
    // Without the feat the extra picks are sliced off the end of the budget; with it they survive.
    expect(poly.languages.length).toBeGreaterThan(plain.languages.length);
    for (const l of langs) expect(poly.languages).toContain(l);
  });
});
