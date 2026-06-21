import { describe, it, expect } from 'vitest';
import { ABILITIES } from '../src/rules/types';
import { build } from './_content';

describe('partial (past-18) attribute boosts', () => {
  // A level-20 fighter funnelling every free + mid-career boost into STR (and
  // dex/con/int), leaving CHA untouched, so STR is pushed well past 18.
  const ch = build('fighter', 20, {
    keyAbility: 'str',
    ancestryBoosts: ['str'],
    backgroundBoosts: ['str'],
    levelBoosts: ['str', 'dex', 'con', 'int'],
    attributeBoosts: {
      5: ['str', 'dex', 'con', 'int'],
      10: ['str', 'dex', 'con', 'int'],
      15: ['str', 'dex', 'con', 'int'],
      20: ['str', 'dex', 'con', 'int'],
    },
  });

  it('flags exactly the attributes pushed past 18 (final score ≥ 19)', () => {
    const partial = new Set(ch.partialBoosts ?? []);
    for (const ab of ABILITIES) {
      expect(partial.has(ab)).toBe(ch.abilities[ab] >= 19);
    }
  });

  it('the heavily-boosted attribute is partial; an unboosted one is not', () => {
    expect(ch.abilities.str).toBeGreaterThanOrEqual(19);
    expect(ch.partialBoosts).toContain('str');
    expect(ch.partialBoosts ?? []).not.toContain('cha');
  });
});
