import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveDefenses } from '../src/rules/derive';
import type { Character, ContentDatabase, InventoryItem, ModeDef } from '../src/rules/types';

/**
 * LOST-CONDITION BLOCKED LANE (2026-10-17) — Obsidian Goggles (Greater) and (Major).
 *
 * Print (AoN equipment-3097-3040): *"the goggles can be activated any number of times per day, and the
 * activation lasts until you deactivate it as an Interact action or the item is no longer invested by you,
 * whichever comes first"* — the darkvision belongs to the base grade's *"Activate—Darkvision … you gain
 * darkvision"*, and the Major (equipment-3097-3041) *"the activation grants greater darkvision"*. Both
 * grades shipped it as a STANDING passive sense; ruling Q11 (an effect the player can shut down is a mode)
 * makes it modes/item-obsidian-goggles-greater and -major, beside the base grade's 1-hour
 * modes/item-obsidian-goggles. The records are DARK under the trust gate (Wanderer's Guide encodes only the
 * Perception bonus), so these build with the gate OFF, where the old passive reached the sheet. The
 * passive is mutation-proved by planting it back. Synthetic characters only.
 */
const db = content();
const GRADES: [string, string][] = [
  ['obsidian-goggles-greater', 'darkvision'],
  ['obsidian-goggles-major', 'greater-darkvision'],
];

const wearer = (d: ContentDatabase, itemId: string): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 'TEST lost-condition goggles',
      level: 18,
      classId: 'fighter',
      keyAbility: 'str',
      ancestryId: 'human',
      backgroundId: Object.keys(d.backgrounds)[0],
      inventory: [{ instanceId: 'g', itemId, quantity: 1, worn: true, invested: true } as InventoryItem],
    } as BuildState,
    d,
  );
const senses = (c: Character, d: ContentDatabase) => deriveDefenses(c, d).senses.map((s) => s.name);
const activated = (c: Character, d: ContentDatabase, modeId: string): Character => ({ ...c, activeModes: [...(c.activeModes ?? []), d.modes[modeId] as ModeDef] });

/** The goggles whose darkvision is on while nothing was activated. */
function standing(d: ContentDatabase): string[] {
  return GRADES.filter(([id, sense]) => senses(wearer(d, id), d).includes(sense)).map(([id]) => id);
}

describe('Obsidian Goggles (Greater/Major): the darkvision is the activation, a toggle (gate OFF)', () => {
  it('a human wearing either grade, nothing activated, has no darkvision', () => {
    expect(standing(db)).toEqual([]);
    for (const [id] of GRADES) expect(db.items[id]?.passiveEffects, id).toBeUndefined();
  });

  it('each grade has its own mode: the printed sense, the printed duration, no once-a-day cap in the note', () => {
    for (const [id, sense] of GRADES) {
      const m = db.modes[`item-${id}`];
      expect(m?.fromItemId, id).toBe(id);
      expect(m?.senses, id).toEqual([{ name: sense }]);
      expect(m?.duration, id).toBe('until you deactivate it as an Interact action or the goggles are no longer invested by you');
      expect(m?.note, id).toMatch(/any number of times per day/);
    }
  });

  it('activated, the wearer has it', () => {
    for (const [id, sense] of GRADES) {
      const c = activated(wearer(db, id), db, `item-${id}`);
      expect(senses(c, db), id).toContain(sense);
    }
  });

  it('mutation-proof: the old standing passive, planted back, is caught', () => {
    for (const [id, sense] of GRADES) {
      const saved = db.items[id];
      (db.items as Record<string, unknown>)[id] = { ...saved, passiveEffects: { senses: [{ name: sense }] } };
      try {
        expect(standing(db), id).toContain(id);
      } finally {
        db.items[id] = saved;
      }
    }
    expect(standing(db)).toEqual([]);
  });
});
