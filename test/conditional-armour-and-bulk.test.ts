import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveBulk } from '../src/rules/derive';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { FEAT_SKILL_GRANTS } from '../src/rules/featGrantsAuto';
import type { BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';

const db = content();

/**
 * *"You become trained in light armor and medium armor. If you already were trained in light armor
 * and medium armor, you gain training in heavy armor as well."*
 *
 * Three dedications print that sentence word for word. All three shipped only the first half, and
 * featGrants.ts's own docstring recorded the second as "conditional and not modeled" — so the
 * character the clause exists for, the one who already wears medium armour, got nothing.
 */
describe('conditional armour training', () => {
  const DEDICATIONS = ['sentinel-dedication', 'champion-dedication', 'guardian-dedication'];

  it('all three records carry the clause', () => {
    for (const id of DEDICATIONS) {
      const g = FEAT_GRANTS[id] ?? FEAT_SKILL_GRANTS[id];
      expect(g?.conditionalArmor, id).toEqual({ ifTrainedIn: ['light', 'medium'], grant: 'heavy', rank: 'trained' });
    }
  });

  it('a wizard gets light and medium — and NOT heavy', () => {
    // Untrained in armour, so the "already were trained" condition is false and must stay false.
    const ch = build('wizard', 2, { featPicks: { '2:class': 'sentinel-dedication' } as BuildState['featPicks'] });
    expect(ch.proficiencies.defenses.light).toBe('trained');
    expect(ch.proficiencies.defenses.medium).toBe('trained');
    expect(ch.proficiencies.defenses.heavy).toBe('untrained');
  });

  it('a druid — already trained in light AND medium — gains heavy', () => {
    const bare = build('druid', 2);
    expect([bare.proficiencies.defenses.light, bare.proficiencies.defenses.medium]).toEqual(['trained', 'trained']);
    expect(bare.proficiencies.defenses.heavy).toBe('untrained');

    const ch = build('druid', 2, { featPicks: { '2:class': 'sentinel-dedication' } as BuildState['featPicks'] });
    expect(ch.proficiencies.defenses.heavy).toBe('trained');
  });

  it('the feat\'s OWN grant does not satisfy its own condition', () => {
    /*
     * The whole risk in this lane: the feat grants light + medium and then asks whether you had light
     * and medium. Read in the wrong order every character qualifies and the clause becomes "everyone
     * gets heavy armour" — which is the failure the wizard case above is there to catch, stated here
     * as the rule rather than one example.
     */
    for (const cls of ['wizard', 'rogue'] as const) {
      const ch = build(cls, 2, { featPicks: { '2:class': 'guardian-dedication' } as BuildState['featPicks'] });
      const had = build(cls, 2).proficiencies.defenses;
      const qualified = had.light !== 'untrained' && had.medium !== 'untrained';
      expect(ch.proficiencies.defenses.heavy === 'trained', `${cls} qualified=${qualified}`).toBe(qualified);
    }
  });

  it('Sentinel no longer asks a question the rules answer', () => {
    // It shipped a Light/Heavy picker with no `choiceGrants` behind it: inert, and asking the player
    // to decide something the printed text decides from their existing training.
    expect(db.feats['sentinel-dedication'].choice).toBeUndefined();
  });
});

/**
 * *"You treat armor you wear of 2 Bulk or higher as though it were 1 Bulk lighter (to a minimum of
 * 1 Bulk)."* — Warpriest's Armor, third sentence, previously unmodelled.
 */
describe("Warpriest's Armor bulk relief", () => {
  it('carries the threshold and the floor', () => {
    expect(db.feats['warpriests-armor'].armorBulkReduction).toEqual({ by: 1, whenBulkAtLeast: 2, floor: 1 });
  });

  const withArmor = (itemId: string, feats: string[]): Character => {
    const ch = build('cleric', 3) as Character;
    return {
      ...ch,
      feats: feats.map((featId) => ({ featId, source: 'class' as const, level: 1 })),
      inventory: [{ instanceId: 'a1', itemId, quantity: 1, worn: true, equipped: true, invested: true }],
    } as Character;
  };

  const bulkOf = (id: string) => db.items[id]?.bulk;

  it('takes 1 Bulk off armour of 2 Bulk or more', () => {
    // Half plate is 3 Bulk; the relief brings the carried total to 2.
    expect(bulkOf('half-plate')).toBe(3);
    const off = deriveBulk(withArmor('half-plate', []), db).total;
    const on = deriveBulk(withArmor('half-plate', ['warpriests-armor']), db).total;
    expect(off - on).toBe(1);
  });

  it('leaves armour under the threshold alone', () => {
    // Leather is 1 Bulk — below "2 Bulk or higher", so nothing comes off.
    expect(bulkOf('leather-armor')).toBe(1);
    const off = deriveBulk(withArmor('leather-armor', []), db).total;
    const on = deriveBulk(withArmor('leather-armor', ['warpriests-armor']), db).total;
    expect(on).toBe(off);
  });

  it('never takes armour below 1 Bulk', () => {
    // Exactly 2 Bulk: the threshold is met, but the printed floor stops the cut at 1.
    const two = Object.entries(db.items).find(([, i]) => i.itemType === 'armor' && i.bulk === 2)?.[0];
    expect(two).toBeTruthy();
    const off = deriveBulk(withArmor(two!, []), db).total;
    const on = deriveBulk(withArmor(two!, ['warpriests-armor']), db).total;
    expect(off - on).toBe(1);
    expect(on).toBeGreaterThanOrEqual(1);
  });
});
