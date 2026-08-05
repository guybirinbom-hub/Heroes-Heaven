import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrike, strikeShowsCritSpec, critSpecSources } from '../src/rules/derive';
import { setItemDesignation } from '../src/rules/play';
import type { Character, InventoryItem, PlayState } from '../src/rules/types';

/**
 * Linking a class choice to an inventory item.
 *
 * The app never did. An inventor's build recorded an innovation TYPE and three modification ids but
 * no item; the thaumaturge's weapon implement and the wizard's bonded weapon were recorded nowhere at
 * all. That single absence is why 19 inventor modifications, both crit-spec clauses, the armour
 * restat and the rune cap were inert — every one says "your innovation…" and nothing knew which
 * object that meant.
 *
 * The rule that matters: a designation filter matches NOTHING when nothing is designated. There is
 * deliberately no "first weapon" fallback, because guessing hands a greatsword's modifications to a
 * dagger.
 */
const db = content();
const sword = Object.entries(db.items).find(([, i]) => i.itemType === 'weapon' && i.group === 'sword' && i.damage)![0];
const axe = Object.entries(db.items).find(([, i]) => i.itemType === 'weapon' && i.group === 'axe' && i.damage)![0];

const held = (instanceId: string, itemId: string, designations?: InventoryItem['designations']): InventoryItem => ({
  instanceId, itemId, quantity: 1, equipped: true, ...(designations ? { designations } : {}),
});
const play = (inventory: InventoryItem[]): PlayState =>
  ({ damage: 0, tempHp: 0, heroPoints: 0, xp: 0, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [], pinned: [], inventory }) as PlayState;

describe('designating an item', () => {
  it('is exclusive — marking a second item moves the mark', () => {
    const p = play([held('a', sword), held('b', axe)]);
    const one = setItemDesignation(p, 'a', 'innovation', true);
    expect(one.inventory![0].designations).toEqual(['innovation']);

    const two = setItemDesignation(one, 'b', 'innovation', true);
    expect(two.inventory![0].designations, 'the first item kept it — two innovations at once').toBeUndefined();
    expect(two.inventory![1].designations).toEqual(['innovation']);
  });

  it('unmarking removes the field rather than leaving an empty array', () => {
    const p = setItemDesignation(play([held('a', sword)]), 'a', 'innovation', true);
    expect(setItemDesignation(p, 'a', 'innovation', false).inventory![0].designations).toBeUndefined();
  });

  it('an item can hold two different designations at once', () => {
    let p = setItemDesignation(play([held('a', sword)]), 'a', 'innovation', true);
    p = setItemDesignation(p, 'a', 'rune-source', true);
    expect(p.inventory![0].designations).toEqual(['innovation', 'rune-source']);
  });
});

describe('a rider filtered on a designation', () => {
  const ch = (inv: InventoryItem[]): Character => ({
    ...build('inventor', 9, {}),
    inventory: inv,
    classChoices: [{ group: 'x', name: 'Razor Prongs', description: '', level: 1, id: 'razor-prongs' }],
  });

  it('applies to the designated weapon', () => {
    const inv = held('a', sword, ['innovation']);
    expect(deriveStrike(ch([inv]), db, inv)!.traits).toContain('tearing');
  });

  it('applies to NOTHING when nothing is designated — no "first weapon" fallback', () => {
    const inv = held('a', sword);
    expect(deriveStrike(ch([inv]), db, inv)!.traits).not.toContain('tearing');
  });

  it('leaves the character other weapons alone', () => {
    const one = held('a', sword, ['innovation']);
    const other = held('b', axe);
    const c = ch([one, other]);
    expect(deriveStrike(c, db, one)!.traits).toContain('tearing');
    expect(deriveStrike(c, db, other)!.traits).not.toContain('tearing');
  });
});

describe('crit specialization narrowed to the designated item', () => {
  const inventor = (inv: InventoryItem[]): Character => ({ ...build('inventor', 11, {}), inventory: inv });

  it('the designated innovation shows it', () => {
    const inv = held('a', sword, ['innovation']);
    const c = inventor([inv]);
    const s = deriveStrike(c, db, inv)!;
    expect(strikeShowsCritSpec(s, critSpecSources(c, db), c)).toBe(true);
  });

  it('an UNDESIGNATED weapon does not — this is the over-grant the filter exists to stop', () => {
    // Shipped unnarrowed, weaponMatches returns true for an unfiltered entry and every Strike the
    // character makes would light up crit spec.
    const inv = held('a', sword);
    const c = inventor([inv]);
    const s = deriveStrike(c, db, inv)!;
    expect(strikeShowsCritSpec(s, critSpecSources(c, db), c)).toBe(false);
  });

  it('and neither does a second, undesignated weapon', () => {
    const one = held('a', sword, ['innovation']);
    const other = held('b', axe);
    const c = inventor([one, other]);
    expect(strikeShowsCritSpec(deriveStrike(c, db, other)!, critSpecSources(c, db), c)).toBe(false);
  });
});

describe('the shipped data', () => {
  it('every crit-spec grant naming a designation is narrowed by it', () => {
    for (const id of ['inventor-weapon-expertise', 'initiate-benefit-weapon']) {
      expect(db.classFeatures[id].critSpec).toBe(true);
      expect(db.classFeatures[id].critSpecWeapons?.designated).toBeTruthy();
    }
    expect(db.feats['rod-of-rule'].critSpecWeapons?.designated).toBe('bonded');
  });

  it("the Implement's Interruption crit spec waits for 5th level, as printed", () => {
    expect(db.classFeatures['initiate-benefit-weapon'].critSpecLevel).toBe(5);
  });

  it('the rune-copy items carry the flag that replaced a hardcoded id list', () => {
    expect(db.items['doubling-rings'].passiveEffects?.copiesRunes).toBe('fundamental');
    expect(db.items['doubling-rings-greater'].passiveEffects?.copiesRunes).toBe('all');
    // These two never worked at all: the old code matched two ids and these were not among them.
    expect(db.items['blazons-of-shared-power'].passiveEffects?.copiesRunes).toBe('fundamental');
    expect(db.items['blazons-of-shared-power-greater'].passiveEffects?.copiesRunes).toBe('all');
  });
});
