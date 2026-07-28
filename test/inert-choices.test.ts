import { describe, it, expect } from 'vitest';
import { content } from './_content';

const c = content();

/**
 * PICKS THAT ARE RECORDED BUT GRANT NOTHING.
 *
 * Two agreed cases (work/choice-lane/DECISIONS.md §2 and §4):
 *   - Kingdom feats belong to a kingdom sheet that doesn't exist yet — prompt anyway and store the
 *     answer, so it's already there when one arrives.
 *   - Legacy content keyed off something the Remaster deleted (Warding Rune wants a school of magic)
 *     — still offer the choice, but say plainly that it won't grant the benefit.
 *
 * The rule these encode: never silently show a pick that does nothing. `inert` is the reason, and it
 * must never appear on a pick that SHOULD work.
 */
describe('inert (recorded-only) choices', () => {
  const KINGDOM = ['civil-service', 'aon-civil-service', 'kingdom-assurance', 'aon-kingdom-assurance', 'skill-training-kingdom'];
  const LEGACY = ['warding-rune', 'aon-warding-rune'];

  it('every kingdom feat that asks for a pick offers one, and explains it is recorded only', () => {
    for (const id of KINGDOM) {
      const choice = c.feats[id]?.choice;
      expect(choice, `${id} should offer a choice`).toBeTruthy();
      expect(choice!.kind, `${id} has no option data in the app, so it must be free text`).toBe('text');
      expect(choice!.inert, `${id} must say why it grants nothing`).toMatch(/no Kingdom sheet/i);
    }
  });

  it('the legacy school-of-magic pick warns that the Remaster removed schools', () => {
    for (const id of LEGACY) {
      const choice = c.feats[id]?.choice;
      expect(choice?.kind).toBe('text');
      expect(choice?.inert).toMatch(/Remaster removed schools of magic/i);
    }
  });

  it('the school taxonomy really is gone — the warning is true, not defensive boilerplate', () => {
    const SCHOOLS = /^(abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)$/i;
    const spells = Object.values(c.spells);
    const withSchool = spells.filter((s) => (s.traits ?? []).some((t) => SCHOOLS.test(t)));
    // If a future data import restores schools to most spells, this fails and the warning should go.
    expect(withSchool.length).toBeLessThan(spells.length / 2);
  });

  it('NO working choice was marked inert (the flag must not paper over a real pick)', () => {
    // Assurance is the canary: a real, working choose-a-skill pick.
    expect(c.feats['assurance']?.choice?.inert).toBeUndefined();
    expect(c.feats['domain-initiate']?.choice?.inert).toBeUndefined();
    // And across the whole database, inert is confined to the agreed ids.
    const agreed = new Set([...KINGDOM, ...LEGACY]);
    const stray = Object.entries(c.feats)
      .filter(([id, f]) => f.choice?.inert && !agreed.has(id))
      .map(([id]) => id);
    expect(stray, `unexpected inert choices: ${stray.join(', ')}`).toHaveLength(0);
  });

  it('kingdom feats that ask nothing were left alone', () => {
    const kingdomFeats = Object.entries(c.feats).filter(([, f]) => (f.traits ?? []).includes('kingdom'));
    expect(kingdomFeats.length).toBe(32);
    // Only the 5 whose text actually says "choose" gained a picker; the other 27 stay untouched.
    const withChoice = kingdomFeats.filter(([, f]) => f.choice);
    expect(withChoice).toHaveLength(5);
  });
});
