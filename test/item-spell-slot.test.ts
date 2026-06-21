import { describe, it, expect } from 'vitest';
import { build, content } from './_content';

describe('generic scroll/wand spell selection (item.spellSlot)', () => {
  const db = content();

  it('the importer flags generic scrolls/wands with a spellSlot (rank + any tradition lock)', () => {
    expect(db.items['scroll-of-3rd-rank-spell'].spellSlot).toEqual({ rank: 3 });
    expect(db.items['magic-wand-3rd-rank-spell'].spellSlot).toEqual({ rank: 3 });
    expect(db.items['cyrusian-wand-3rd-rank-spell'].spellSlot).toEqual({ rank: 3, traditions: ['arcane'] });
    // a SPECIFIC wand (its spell already parsed into heldSpells) is NOT a slot
    expect(Object.values(db.items).some((i) => i.heldSpells && i.spellSlot)).toBe(false);
  });

  it('a chosen spell on a generic scroll becomes an "items" spellcasting entry at the slot rank', () => {
    const spellId = Object.values(db.spells).find((s) => s.rank === 3 && !s.ritual)!.id;
    const ch = build('wizard', 7, { keyAbility: 'int', inventory: [{ itemId: 'scroll-of-3rd-rank-spell', quantity: 1, heldSpell: spellId }] });
    const entry = ch.spellcasting.find((e) => e.type === 'items');
    expect(entry).toBeDefined();
    expect(entry!.repertoire?.[3]).toContain(spellId);
  });

  it('an empty generic scroll (no chosen spell) produces no spellcasting entry', () => {
    const ch = build('wizard', 7, { keyAbility: 'int', inventory: [{ itemId: 'scroll-of-3rd-rank-spell', quantity: 1 }] });
    expect(ch.spellcasting.filter((e) => e.type === 'items').length).toBe(0);
  });

  it('the chosen spell round-trips through buildCharacter → the stored inventory', () => {
    const spellId = Object.values(db.spells).find((s) => s.rank === 2 && !s.ritual)!.id;
    const ch = build('cleric', 5, { keyAbility: 'wis', inventory: [{ itemId: 'scroll-of-2nd-rank-spell', quantity: 1, heldSpell: spellId }] });
    expect(ch.inventory.find((i) => i.itemId === 'scroll-of-2nd-rank-spell')?.heldSpell).toBe(spellId);
  });
});
