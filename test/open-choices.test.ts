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

/**
 * BUILD-RESOLVED sources — the pool is what THIS character has.
 *
 * Library Robes stores "one spell YOU KNOW of 5th rank or lower"; Fuse Stance combines "two stances
 * you know". Offering all of content for those would let the player pick something they don't have,
 * so these resolve against the character and return NOTHING without one.
 */
describe('build-resolved open choices', () => {
  const withSpells = (repertoire: Record<number, string[]>) =>
    ({ spellcasting: [{ id: 'e', cantrips: [], repertoire }] }) as never;

  it('own-spell draws from the character, not from all of content', () => {
    const ch = withSpells({ 1: ['guidance'], 5: ['heal'] });
    const opts = openChoiceOptions({ type: 'own-spell' }, c, { character: ch });
    expect(opts.map((o) => o.id).sort()).toEqual(['guidance', 'heal']);
    // The same descriptor against ALL content would be enormous — that is the point of own-*.
    expect(openChoiceOptions({ type: 'spell' }, c).length).toBeGreaterThan(100);
  });

  it('own-spell honours the rank ceiling', () => {
    const ch = withSpells({ 1: ['guidance'], 8: ['heal'] });
    expect(openChoiceOptions({ type: 'own-spell', maxRank: 5 }, c, { character: ch }).map((o) => o.id)).toEqual(['guidance']);
  });

  it('own-* returns NOTHING without a character rather than falling back to content', () => {
    // Falling back would offer spells the character does not know — worse than an empty picker.
    for (const type of ['own-spell', 'own-feat', 'own-item', 'own-companion'] as const) {
      expect(openChoiceOptions({ type }, c), type).toEqual([]);
    }
  });

  it('own-feat filters the character\u2019s feats by trait', () => {
    const stanceFeat = Object.values(c.feats).find((f) => (f.traits ?? []).includes('stance'))!;
    const ch = { feats: [{ featId: stanceFeat.id }, { featId: 'toughness' }] } as never;
    const opts = openChoiceOptions({ type: 'own-feat', traits: ['stance'] }, c, { character: ch });
    expect(opts.map((o) => o.id)).toEqual([stanceFeat.id]);
  });

  it('own-item can require the item to be INVESTED', () => {
    const ch = {
      inventory: [
        { instanceId: 'a', itemId: 'cloak-of-elvenkind', quantity: 1, invested: true },
        { instanceId: 'b', itemId: 'backpack', quantity: 1 },
      ],
    } as never;
    expect(openChoiceOptions({ type: 'own-item' }, c, { character: ch }).length).toBe(2);
    expect(openChoiceOptions({ type: 'own-item', investedOnly: true }, c, { character: ch }).map((o) => o.id)).toEqual(['cloak-of-elvenkind']);
  });

  it('Library Robes stores a spell you know, re-picked each morning', () => {
    const ch = c.items['library-robes']?.choice;
    expect(ch?.kind).toBe('open');
    expect(ch?.daily).toBe(true);
    expect(ch?.from).toEqual({ type: 'own-spell', maxRank: 5 });
  });
});
