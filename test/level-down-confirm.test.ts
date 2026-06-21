import { describe, it, expect } from 'vitest';
import { hasChoicesAtLevel } from '../src/builder/Builder';
import { emptyBuild, type BuildState } from '../src/rules/build';

const make = (over: Partial<BuildState>): BuildState => ({ ...emptyBuild(), ...over });

describe('hasChoicesAtLevel — gate the lower-level confirmation', () => {
  it('is false when nothing was chosen at that level', () => {
    expect(hasChoicesAtLevel(make({}), 5)).toBe(false);
    // choices at OTHER levels don't count
    expect(hasChoicesAtLevel(make({ featPicks: { '3:class:1': 'some-feat' } }), 5)).toBe(false);
    expect(hasChoicesAtLevel(make({ attributeBoosts: { 5: [null, null, null, null] } }), 5)).toBe(false);
  });

  it('is true when a feat was picked at that level', () => {
    expect(hasChoicesAtLevel(make({ featPicks: { '5:class:1': 'power-attack' } }), 5)).toBe(true);
  });

  it('is true when the skill increase at that level was chosen', () => {
    expect(hasChoicesAtLevel(make({ skillIncreases: { 5: 'athletics' } }), 5)).toBe(true);
  });

  it('is true when any attribute boost at that level was assigned', () => {
    expect(hasChoicesAtLevel(make({ attributeBoosts: { 5: ['str', null, null, null] } }), 5)).toBe(true);
  });

  it('an empty feat-pick value does not count as a choice', () => {
    expect(hasChoicesAtLevel(make({ featPicks: { '5:class:1': '' } }), 5)).toBe(false);
  });
});
