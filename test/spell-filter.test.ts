import { describe, it, expect } from 'vitest';
import { spellCostMatches } from '../src/rules/spellFilter';
import type { ActionCost } from '../src/rules/types';

const a = (value: 1 | 2 | 3): ActionCost => ({ type: 'actions', value });
const variable = (min: 1 | 2 | 3, max: 1 | 2 | 3): ActionCost => ({ type: 'variable', min, max });
const free: ActionCost = { type: 'free' };
const reaction: ActionCost = { type: 'reaction' };

describe('spellCostMatches (action-cost filter)', () => {
  it('matches exact action counts', () => {
    expect(spellCostMatches(a(2), a(2))).toBe(true);
    expect(spellCostMatches(a(1), a(2))).toBe(false);
    expect(spellCostMatches(a(3), a(3))).toBe(true);
  });

  it('a variable-cost spell matches any count within its range', () => {
    expect(spellCostMatches(variable(1, 3), a(1))).toBe(true);
    expect(spellCostMatches(variable(1, 3), a(2))).toBe(true);
    expect(spellCostMatches(variable(1, 3), a(3))).toBe(true);
    expect(spellCostMatches(variable(2, 3), a(1))).toBe(false); // Wall of Light: 2–3, not 1
    expect(spellCostMatches(variable(2, 3), a(2))).toBe(true);
  });

  it('matches free and reaction by type', () => {
    expect(spellCostMatches(free, free)).toBe(true);
    expect(spellCostMatches(reaction, reaction)).toBe(true);
    expect(spellCostMatches(free, reaction)).toBe(false);
    expect(spellCostMatches(a(1), free)).toBe(false);
  });

  it('non-action casts (duration/passive) never match an action chip', () => {
    expect(spellCostMatches({ type: 'duration', text: '10 minutes' }, a(2))).toBe(false);
    expect(spellCostMatches({ type: 'duration', text: '1 hour' }, a(1))).toBe(false);
  });

  it('an unknown/missing cost matches nothing', () => {
    expect(spellCostMatches(undefined, a(2))).toBe(false);
  });
});
