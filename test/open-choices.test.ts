import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { openChoiceOptions, openChoiceLabel } from '../src/rules/openChoice';

const c = content();

/**
 * OPEN-ENDED CHOICES — "any occult cantrip", "any 1st-level dwarf ancestry feat".
 *
 * A fixed options array can't express these: the legal set is a FILTER over content, and baking it
 * into the record would bloat core.json and go stale. The filter resolves at render time.
 */
describe('open choice options', () => {
  it('resolves spells by tradition and cantrip-ness', () => {
    const opts = openChoiceOptions({ type: 'spell', traditions: ['occult'], cantripsOnly: true }, c);
    expect(opts.length).toBeGreaterThan(10);
    expect(opts.every((o) => c.spells[o.id])).toBe(true);
    expect(opts.every((o) => (c.spells[o.id].rank ?? 0) === 0)).toBe(true);
  });

  it('anyTraits is an OR, not an AND', () => {
    // "divination, enchantment, OR necromancy". As an AND (`traits`) it would demand all three and
    // return nothing — which is precisely how this feature nearly shipped an empty picker.
    const or = openChoiceOptions({ type: 'spell', anyTraits: ['fire', 'cold'] }, c);
    const and = openChoiceOptions({ type: 'spell', traits: ['fire', 'cold'] }, c);
    expect(or.length).toBeGreaterThan(and.length);
  });

  it('resolves feats by category and level ceiling', () => {
    const opts = openChoiceOptions({ type: 'feat', featCategory: 'ancestry', maxLevel: 1 }, c);
    expect(opts.length).toBeGreaterThan(20);
    expect(opts.every((o) => c.feats[o.id].level <= 1)).toBe(true);
    expect(opts.every((o) => c.feats[o.id].category === 'ancestry')).toBe(true);
  });

  it('required traits narrow a feat list', () => {
    const all = openChoiceOptions({ type: 'feat', featCategory: 'ancestry', maxLevel: 1 }, c);
    const dwarf = openChoiceOptions({ type: 'feat', featCategory: 'ancestry', maxLevel: 1, traits: ['dwarf'] }, c);
    expect(dwarf.length).toBeGreaterThan(0);
    expect(dwarf.length).toBeLessThan(all.length);
  });

  it('resolves weapons and languages', () => {
    expect(openChoiceOptions({ type: 'weapon', weaponCategory: 'martial' }, c).length).toBeGreaterThan(5);
    expect(openChoiceOptions({ type: 'language' }, c).length).toBeGreaterThan(5);
  });

  it('an unresolvable descriptor returns [] rather than throwing', () => {
    // A throw here would take down the whole builder screen; an empty list is a visible "nothing matches".
    expect(openChoiceOptions(undefined, c)).toEqual([]);
    expect(openChoiceOptions({ type: 'spell', rank: 99 }, c)).toEqual([]);
  });

  it('labels a stored answer, falling back to the raw id', () => {
    expect(openChoiceLabel('guidance', c)).toBe(c.spells['guidance'].name);
    expect(openChoiceLabel('not-a-real-id', c)).toBe('not-a-real-id');
    expect(openChoiceLabel('', c)).toBe('');
  });
});
