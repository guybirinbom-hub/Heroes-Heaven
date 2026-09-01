import { describe, it, expect } from 'vitest';
import { content } from './_content';

const db = content();

/**
 * A RECORD THAT PRINTS AN ARMOUR STAT BLOCK MUST GRANT THE ARMOUR.
 *
 * Three records were found shipping an action cost and nothing else, one per parity batch: Metal
 * Carapace (batch 3), Hardwood Armor (batch 5), Armor in Earth (batch 6). Each prints a full stat line
 * the sheet never received, so a kineticist using the impulse saw no AC change at all. Three of the
 * same shape in three consecutive batches is a lane, not three coincidences — this is the ratchet.
 *
 * The predicate is the printed STAT BLOCK, not the class: the same shape would catch a non-kineticist
 * record that creates armour.
 */

type Rec = { name?: string; grantsItems?: { itemId: string }[]; description?: string };

const AC = /AC Bonus \+?(-?\d+)/i;
const DEX = /Dex(?:terity)? Cap \+?(-?\d+)/i;

/** Every record whose text carries an armour stat block (an AC bonus AND a Dex cap). */
function printsArmourStats(): { bucket: string; id: string; rec: Rec; ac: number; dexCap: number }[] {
  const out: { bucket: string; id: string; rec: Rec; ac: number; dexCap: number }[] = [];
  for (const bucket of ['feats', 'classFeatures', 'heritages', 'actions'] as const) {
    for (const [id, rec] of Object.entries((db as unknown as Record<string, Record<string, Rec>>)[bucket] ?? {})) {
      const text = String(rec.description ?? '').replace(/\s+/g, ' ');
      const ac = AC.exec(text);
      const dex = DEX.exec(text);
      if (!ac || !dex) continue;
      out.push({ bucket, id, rec, ac: Number(ac[1]), dexCap: Number(dex[1]) });
    }
  }
  return out;
}

describe('records that create armour', () => {
  it('finds the stat blocks (so a silent zero cannot pass)', () => {
    expect(printsArmourStats().length).toBeGreaterThanOrEqual(3);
  });

  it('every one grants an item', () => {
    const bare = printsArmourStats()
      .filter((r) => !(r.rec.grantsItems ?? []).length)
      .map((r) => `${r.bucket}/${r.id} (AC +${r.ac}, Dex cap +${r.dexCap})`);
    expect(bare).toEqual([]);
  });

  it('and the item it grants carries the AC bonus the text prints', () => {
    const wrong: string[] = [];
    for (const r of printsArmourStats()) {
      const acs = (r.rec.grantsItems ?? [])
        .map((g) => (db.items[g.itemId] as { acBonus?: number; itemType?: string } | undefined))
        .filter((it) => it?.itemType === 'armor')
        .map((it) => it!.acBonus);
      /* A record may create two tiers (Armor in Earth is medium +4 then heavy +5), so the printed
       * number must be among them rather than equal to the only one. */
      if (acs.length && !acs.includes(r.ac)) wrong.push(`${r.id}: text says +${r.ac}, items say ${acs.join('/')}`);
    }
    expect(wrong).toEqual([]);
  });

  /* The three that prompted the lane, pinned by name so a re-import cannot quietly empty them. */
  it('the three kineticist armour impulses each grant their armour and shield/tier', () => {
    for (const [id, count] of [['metal-carapace', 2], ['hardwood-armor', 2], ['armor-in-earth', 2]] as const) {
      expect(db.feats[id]?.grantsItems, `${id} must grant items`).toHaveLength(count);
      for (const g of db.feats[id].grantsItems!) {
        expect(db.items[g.itemId], `${id} names a missing item ${g.itemId}`).toBeTruthy();
      }
    }
  });
});
