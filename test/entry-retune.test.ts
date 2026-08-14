import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveBulk } from '../src/rules/derive';

/**
 * Two shapes that did not exist.
 *
 * A spellcasting entry's tradition and key attribute come from whatever granted it, and nothing could
 * change them afterwards. And nothing could put an ITEM in the inventory, so a feat whose benefit IS
 * an item delivered nothing.
 */
const db = content();

const withFeat = (classId: string, level: number, featId: string, over: Record<string, unknown> = {}) => {
  const c = build(classId, level, over);
  return { ...c, feats: [...c.feats, { featId, level: 1, slot: 'x' }] } as typeof c;
};

describe('Ancestral Mind retunes the innate entry', () => {
  it('the record says what it changes, its SCOPE, and reads the attribute off the psychic', () => {
    // The scope is the load-bearing half: "any innate spells you know FROM AN ANCESTRY FEAT OR
    // HERITAGE". Without it the one pooled innate entry relabelled a background's and an invested
    // item's spells occult too — spells the feat never mentions.
    expect(db.feats['ancestral-mind'].entryRetune).toEqual([
      { scope: 'innate', tradition: 'occult', onlySources: ['heritage', 'ancestryFeat'], keyAbilityFromClass: 'psychic' },
    ]);
  });

  it("the attribute is not NAMED — a psychic's key attribute is a choice", () => {
    // Writing one here would be right for some psychics and wrong for others.
    expect(db.feats['ancestral-mind'].entryRetune![0].keyAbility).toBeUndefined();
  });

  /** An ARCANE innate spell from an ancestry feat — exactly what Ancestral Mind converts. */
  const INNATE_FEAT = 'shory-aeromancer';
  const innateOf = (c: ReturnType<typeof build>) => c.spellcasting.find((e) => e.type === 'innate');

  it('the innate entry is arcane before the feat', () => {
    expect(db.feats[INNATE_FEAT].innateSpells?.[0].tradition, 'the fixture must grant an ARCANE innate spell').toBe('arcane');
    const c = build('psychic', 10, { featPicks: { '1:ancestry': INNATE_FEAT } });
    expect(innateOf(c), 'the innate entry must exist for this to mean anything').toBeTruthy();
    expect(innateOf(c)!.tradition).toBe('arcane');
  });

  it("and occult after it, keyed to the psychic's OWN attribute", () => {
    const key = build('psychic', 10, {}).spellcasting.find((e) => e.id === 'psychic-casting')!.keyAbility;
    const c = build('psychic', 10, { featPicks: { '1:ancestry': INNATE_FEAT, '2:class': 'ancestral-mind' } });
    expect(innateOf(c)!.tradition).toBe('occult');
    expect(innateOf(c)!.keyAbility, "the psychic's own key attribute, not a named one").toBe(key);
  });

  it('retunes ONLY the spells its scope clause names — per spell, not by relabelling the entry', () => {
    /* "You can cast any innate spells you know FROM AN ANCESTRY FEAT OR HERITAGE using your psychic
     * spellcasting… the spell's tradition becomes occult." There is ONE pooled innate entry and it
     * also collects a BACKGROUND's spell (Astrological Augur's divine Augury) and every invested
     * item's, so setting `entry.tradition = 'occult'` said something false about spells this feat
     * never mentions. */
    const BG = 'astrological-augur';
    expect(db.backgrounds[BG].innateSpells?.[0], 'the control must be a background-granted innate spell').toMatchObject({
      spellId: 'augury',
      tradition: 'divine',
    });
    const ch = build('psychic', 10, { backgroundId: BG, featPicks: { '1:ancestry': INNATE_FEAT, '2:class': 'ancestral-mind' } });
    const e = innateOf(ch)!;
    expect(e.spellTraditions?.['fly'], 'the ancestry feat’s spell is in scope').toBe('occult');
    expect(e.spellTraditions?.['augury'], 'the background’s spell is NOT').toBe('divine');
  });

  it('a non-psychic still turns the entry occult, and keeps its own attribute', () => {
    const plain = build('fighter', 10, { featPicks: { '1:ancestry': INNATE_FEAT } });
    const tuned = build('fighter', 10, { featPicks: { '1:ancestry': INNATE_FEAT, '2:class': 'ancestral-mind' } });
    expect(innateOf(tuned)!.tradition).toBe('occult');
    expect(innateOf(tuned)!.keyAbility, 'with no psychic entry to read, the attribute is left alone').toBe(
      innateOf(plain)!.keyAbility,
    );
  });
});

describe('the Razmiran priest', () => {
  it('retunes the cleric-archetype entry to occult with Charisma', () => {
    expect(db.feats['razmiran-priest-dedication'].entryRetune).toEqual([
      { scope: 'cleric-dedication-casting', tradition: 'occult', keyAbility: 'cha' },
    ]);
  });

  it('and hands over the mask', () => {
    expect(db.feats['razmiran-priest-dedication'].grantsItems).toEqual([{ itemId: 'razmiri-mask' }]);
    expect(db.items['razmiri-mask'], 'the item must ship or the grant delivers nothing').toBeTruthy();
  });
});

describe('an item a record hands you', () => {
  it('it appears in the inventory, tagged with the record that gave it', () => {
    const c = build('fighter', 6, { featPicks: { '2:class': 'razmiran-priest-dedication' } });
    const held = c.inventory.find((i) => i.itemId === 'razmiri-mask');
    expect(held, 'the mask must be in the inventory').toBeTruthy();
    expect(held!.grantedBy).toBe(db.feats['razmiran-priest-dedication'].name);
  });

  it('without the feat it is not there', () => {
    const c = build('fighter', 6, {});
    expect(c.inventory.some((i) => i.itemId === 'razmiri-mask')).toBe(false);
  });

  it('it costs no gold', () => {
    const plain = build('fighter', 6, {});
    const priest = build('fighter', 6, { featPicks: { '2:class': 'razmiran-priest-dedication' } });
    expect(priest.currency).toEqual(plain.currency);
  });

  it('a granted item does not duplicate one the player already carries', () => {
    const c = build('fighter', 6, {
      featPicks: { '2:class': 'razmiran-priest-dedication' },
      inventory: [{ itemId: 'razmiri-mask', quantity: 1 }],
    });
    expect(c.inventory.filter((i) => i.itemId === 'razmiri-mask').length).toBe(1);
  });
});

describe("Extradimensional Stash's container", () => {
  const ITEM = 'extradimensional-stash-space';

  it('it exists, with the numbers the feat prints', () => {
    const i = db.items[ITEM];
    expect(i.itemType).toBe('container');
    expect(i.bulk, 'it "has no Bulk of its own"').toBe(0);
    expect(i.capacity).toEqual({ bulk: 5 });
    expect(i.ignoredBulk, 'contents up to 5 Bulk add nothing').toBe(5);
  });

  it('the feat grants it', () => {
    expect(db.feats['extradimensional-stash'].grantsItems).toEqual([{ itemId: ITEM }]);
  });

  it('taking the feat puts it in the inventory and it weighs nothing', () => {
    const plain = build('rogue', 20, {});
    const c = build('rogue', 20, { featPicks: { '20:class': 'extradimensional-stash' } });
    expect(c.inventory.find((i) => i.itemId === ITEM), 'the stash must be in the inventory').toBeTruthy();
    expect(deriveBulk(c, db).total).toBe(deriveBulk(plain, db).total);
  });
});
