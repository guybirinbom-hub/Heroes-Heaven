import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { applyPlayState, emptyPlay } from '../src/rules/play';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * `applyPlayState` overlays today's play on the STORED character (App.tsx hands it `active.character`),
 * so anything it writes into a nested part of its input lands in the character the next save writes.
 *
 * Three overlays copied only the OUTER map and then wrote one level down:
 *  - a spell borrowed for the day (Loaner Spell, a kitsune/nagaji daily spell) was pushed into the stored
 *    innate repertoire when the character already had an innate spell at that rank — so the borrowed
 *    spell stayed for good;
 *  - Share Eidolon Magic did the same with the eidolon's spells;
 *  - an answered item "choose one of N" re-appended its resistances onto the stored resolved passives,
 *    once more on every render.
 * Each case below deep-compares the input before and after. Synthetic characters only.
 */
const db = content();
const innate = (c: Character) => c.spellcasting.find((e) => e.id === 'innate-casting');
const ranked = (rank: number, not?: string) => Object.values(db.spells).find((s) => s.rank === rank && !s.ritual && s.id !== not)!;

/** A fighter with one stored 2nd-rank innate spell. */
function withStoredInnate(extra: Partial<Character> = {}): { ch: Character; own: string } {
  const own = ranked(2).id;
  const base = build('fighter', 10, { featPicks: { '8:class:0': 'loaner-spell' } } as never);
  const ch: Character = {
    ...base,
    ...extra,
    spellcasting: [
      ...(base.spellcasting ?? []),
      {
        id: 'innate-casting',
        name: 'Innate spells',
        type: 'innate',
        tradition: 'arcane',
        keyAbility: 'cha',
        proficiency: 'trained',
        cantrips: [],
        repertoire: { 2: [own] },
      },
    ],
  };
  return { ch, own };
}

describe('applyPlayState never alters the stored character', () => {
  it('a borrowed spell at a rank the character already casts innately stays out of the store', () => {
    const { ch, own } = withStoredInnate();
    const borrowed = ranked(2, own).id;
    const before = structuredClone(ch);
    const out = applyPlayState(ch, { ...emptyPlay(), dailyChoices: { 'loaner-spell:loanerSpell': borrowed } }, db);
    expect(ch, 'the borrowed spell was written into the stored character').toEqual(before);
    expect(innate(out)!.repertoire?.[2]).toEqual([own, borrowed]);
  });

  it('Share Eidolon Magic adds the eidolon’s spells to the sheet, not to the store', () => {
    const { ch: base, own } = withStoredInnate();
    const eidolonSpell = ranked(2, own).id;
    const ch: Character = {
      ...base,
      feats: [...(base.feats ?? []), { featId: 'share-eidolon-magic', level: 10, source: 'class' } as never],
      eidolonInnateSpells: [eidolonSpell],
    };
    const before = structuredClone(ch);
    const out = applyPlayState(ch, emptyPlay(), db);
    expect(ch, "the eidolon's spell was written into the stored character").toEqual(before);
    expect(innate(out)!.repertoire?.[2]).toEqual([own, eidolonSpell]);
  });

  it('an answered item choice does not grow the stored resolved passives', () => {
    const itemId = 'aeon-stone-pearly-white-spindle';
    expect(db.items[itemId]?.effectChoices?.length, 'test item lost its choice').toBeTruthy();
    const stone: InventoryItem = { instanceId: 'inv-test-1', itemId, quantity: 1, invested: true, effectChoices: { resonant: 'yes' } } as InventoryItem;
    const base = build('fighter', 10);
    const ch: Character = {
      ...base,
      inventory: [stone],
      resolvedItemPassives: { [itemId]: { resistances: [{ type: 'void', value: 1 }] } },
    };
    const before = structuredClone(ch);
    applyPlayState(ch, { ...emptyPlay(), inventory: [stone] }, db);
    const out = applyPlayState(ch, { ...emptyPlay(), inventory: [stone] }, db);
    expect(ch, 'the item choice was written into the stored character').toEqual(before);
    // The stored one plus the answered one — proves the choice still applies, so the check above bites.
    expect(out.resolvedItemPassives?.[itemId]?.resistances).toHaveLength(2);
  });
});
