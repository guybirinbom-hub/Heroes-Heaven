import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
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

  /**
   * ⚠ THE FIXTURE ABOVE IS WHY THIS SECTION EXISTS.
   *
   * `withSpells` sets `repertoire` and nothing else, so every assertion above describes a SPONTANEOUS
   * caster. `own-spell` never read `spellbook`, and the suite stayed green while a wizard's Westyr's
   * Wayfinder Repository picker showed one entry — a focus spell that leaked in through the class's
   * focus entry — and a witch's showed nothing at all. Four Library Robes had the same hole.
   *
   * A hand-rolled fixture can only test the shapes its author remembered. These cases go through the
   * REAL builder for one caster of each storage shape, so a resolver that reads a subset of the
   * known-spell stores fails here instead of shipping a blank picker.
   */
  describe('own-spell sees every store a caster keeps its spells in', () => {
    const rank1 = Object.entries(c.spells)
      .filter(([, s]) => s.rank === 1 && !(s.traits ?? []).includes('focus'))
      .slice(0, 4)
      .map(([id]) => id);

    /* wizard/witch keep known spells in `spellbook`; sorcerer/bard in `repertoire`. All four are the
     * same question to a player — "a spell you know" — and must answer the same way. */
    for (const cls of ['wizard', 'witch', 'sorcerer', 'bard'] as const) {
      it(`${cls} can pick a 1st-rank spell it knows`, () => {
        const ch = build(cls, 6, { spells: { 1: rank1 } });
        const menu = openChoiceOptions({ type: 'own-spell', rank: 1 }, c, { character: ch });
        expect(menu.length, `${cls} own-spell menu was empty`).toBeGreaterThan(0);
        /* Not merely non-empty — the spells the player actually chose have to be in there. A menu
         * holding only a leaked focus spell was the bug, and it was non-empty. */
        const ids = new Set(menu.map((o) => o.id));
        expect(rank1.filter((id) => ids.has(id)).length, `${cls} menu missed its own known spells`).toBeGreaterThan(0);
      });
    }

    it('a prepared caster’s daily loadout is not knowledge', () => {
      /* `prepared` is deliberately NOT a source: today's slots are what you readied, not what you
       * know, and reading them would make the menu change every morning. */
      const ch = build('wizard', 6, { spells: { 1: rank1 } });
      const entry = (ch.spellcasting ?? []).find((e) => e.type === 'prepared');
      expect(Object.keys(entry?.prepared ?? {}).length, 'fixture no longer prepares anything').toBeGreaterThan(0);
      const menu = openChoiceOptions({ type: 'own-spell', rank: 1 }, c, { character: ch });
      /* Every offered spell must come from a store that means KNOWLEDGE. A focus spell from the
       * class's focus entry qualifies and legitimately appears — the exclusion is `prepared`, and
       * only `prepared`. Asserting against the spellbook alone was wrong and this test caught it. */
      const known = new Set(
        (ch.spellcasting ?? []).flatMap((e) => [
          ...(e.cantrips ?? []),
          ...Object.values(e.repertoire ?? {}).flat(),
          ...Object.values(e.grantedRepertoire ?? {}).flat(),
          ...Object.values(e.spellbook ?? {}).flat(),
          ...Object.values(e.learned ?? {}).flat(),
        ]),
      );
      const fromPreparedOnly = menu.filter((o) => !known.has(o.id));
      expect(fromPreparedOnly.map((o) => o.id), 'a spell reached the menu from nothing but today’s slots').toEqual([]);
    });
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
