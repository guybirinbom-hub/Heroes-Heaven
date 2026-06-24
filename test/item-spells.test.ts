import { describe, it, expect } from 'vitest';
import { build } from './_content';

/**
 * A magic item that casts a specific named spell — via "Activate — Cast a Spell" / "You cast <spell>"
 * (worn items, prose-cast wands) as well as the staff/spellheart/wand cases — must surface on the
 * Spells page as a read-only `type:'items'` spellcasting entry (build.ts assembles these from
 * item.heldSpells, which the importer now extracts from the cast spell's @UUID ref).
 */
describe('spell-casting items become Spells-page sources', () => {
  const carry = (itemId: string) => ({ inventory: [{ instanceId: 'x1', itemId, quantity: 1 }] });

  it('a worn item ("Effect You cast Truesight") — Amulet of the Third Eye → Truesight', () => {
    const ch = build('wizard', 12, carry('amulet-of-the-third-eye'));
    const entry = ch.spellcasting.find((e) => e.type === 'items' && e.name === 'Amulet of the Third Eye');
    expect(entry, 'item should create a type:items spellcasting entry').toBeTruthy();
    expect(entry!.repertoire[6]).toContain('truesight');
  });

  it('a worn item — Ring of Bestial Friendship → Charm', () => {
    const ch = build('wizard', 5, carry('ring-of-bestial-friendship'));
    const entry = ch.spellcasting.find((e) => e.type === 'items' && e.name === 'Ring of Bestial Friendship');
    expect(entry).toBeTruthy();
    expect(entry!.repertoire[1]).toContain('charm');
  });

  it('a prose-cast wand — Wand of Fey Flames → Faerie Fire', () => {
    const ch = build('wizard', 5, carry('wand-of-fey-flames'));
    const entry = ch.spellcasting.find((e) => e.type === 'items' && /Fey Flames/.test(e.name));
    expect(entry).toBeTruthy();
    expect(entry!.repertoire[2]).toContain('faerie-fire');
  });
});
