import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, deriveStrikes } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/*
 * §13.2–§13.6 heritage grant-type coverage: ranged natural strike, choice-based resistances,
 * negative healing, and the conditional low-light → darkvision upgrade.
 */
const c = content();
const withHeritage = (over: Partial<Character>): Character => ({ ...build('fighter', 6), ...over } as Character);

describe('§13.2 Spined Azarketi grants a ranged spine unarmed attack', () => {
  it('the Spine appears as a ranged 1d4 poison strike (range 10)', () => {
    // Natural attacks are generated at build time, so the heritage must be in the BuildState.
    const ch = build('fighter', 6, { ancestryId: 'azarketi', heritageId: 'spined-azarketi' });
    const spine = deriveStrikes(ch, c).find((s) => /spine/i.test(s.name));
    expect(spine).toBeTruthy();
    expect(spine!.ranged).toBe(true);
    expect(spine!.range).toBe(10);
    expect(spine!.damage).toMatch(/1d4.*poison/i);
  });
});

describe('§13.3/§13.4 choice-based resistance = half level (min 1)', () => {
  it('Deep Fetchling with cold chosen gives cold resistance = floor(level/2)', () => {
    const ch = withHeritage({ ancestryId: 'fetchling', heritageId: 'deep-fetchling', heritageResistanceChoice: 'cold' });
    const cold = deriveDefenses(ch, c).resistances.find((r) => r.type === 'cold');
    expect(cold?.value).toBe(3); // level 6 → floor(6/2)=3
  });
  it('Elementheart Kobold with the Air option grants COLD resistance', () => {
    const ch = withHeritage({ ancestryId: 'kobold', heritageId: 'elementheart-kobold', heritageResistanceChoice: 'cold' });
    expect(deriveDefenses(ch, c).resistances.find((r) => r.type === 'cold')?.value).toBe(3);
  });
  it('no resistance until a type is chosen', () => {
    const ch = withHeritage({ ancestryId: 'fetchling', heritageId: 'deep-fetchling', heritageResistanceChoice: null });
    expect(deriveDefenses(ch, c).resistances.length).toBe(0);
  });
});

describe('§13.5 Dhampir has negative (void) healing', () => {
  it('deriveDefenses reports negativeHealing for a dhampir', () => {
    expect(deriveDefenses(withHeritage({ heritageId: 'dhampir' }), c).negativeHealing).toBe(true);
    expect(deriveDefenses(withHeritage({ heritageId: 'nephilim' }), c).negativeHealing).toBeFalsy();
  });
});

describe('§13.6 Nephilim low-light → darkvision upgrade', () => {
  const senses = (ch: Character) => deriveDefenses(ch, c).senses.map((s) => s.name);
  it('an Elf (low-light) Nephilim gains darkvision', () => {
    expect(senses(withHeritage({ ancestryId: 'elf', heritageId: 'nephilim' }))).toContain('darkvision');
  });
  it('a Human (normal vision) Nephilim does NOT gain darkvision (only low-light)', () => {
    const s = senses(withHeritage({ ancestryId: 'human', heritageId: 'nephilim' }));
    expect(s).not.toContain('darkvision');
  });
});
