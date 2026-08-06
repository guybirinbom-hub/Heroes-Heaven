import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveAc, deriveArmorCheckPenalty, wornArmorOf } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import type { Character } from '../src/rules/types';

/**
 * The two items in the game that restate the armour they are worn with.
 *
 * Both shipped as read-only flavour text, so the sheet showed a WRONG AC — and often a flattering
 * one, because an armoured skirt makes its host one step heavier and a wearer untrained in the
 * heavier category loses their entire proficiency bonus.
 *
 * The mode is never a player choice: each item prints which armours each of its modes covers, so the
 * host picks it. That is why this needs no attachment UI — wearing both is the whole interaction.
 */
const db = content();

const wearing = (armorId: string, extra: string[] = [], over: Record<string, unknown> = {}): Character =>
  build('fighter', 5, {
    inventory: [
      { itemId: armorId, quantity: 1, worn: true },
      ...extra.map((id) => ({ itemId: id, quantity: 1, worn: true })),
    ],
    ...over,
  } as never);

const armorOf = (c: Character) => wornArmorOf(c, db)!;

describe('the items exist and carry their printed modes', () => {
  it('an armoured skirt has two modes, a plated duster one', () => {
    expect(db.items['armored-skirt'].armorAdjust?.modes).toHaveLength(2);
    expect(db.items['plated-duster'].armorAdjust?.modes).toHaveLength(1);
    // Both print an exclusivity clause.
    expect(db.items['armored-skirt'].armorAdjust?.exclusive).toBe(true);
    expect(db.items['plated-duster'].armorAdjust?.exclusive).toBe(true);
  });
});

describe('Armored Skirt — the heavier mode', () => {
  // "increases the armor's item bonus to AC by 1, worsens the check penalty by 1, reduces the Dex cap
  // by 1, increases the Strength score required … by 2, and adds the noisy trait. This also makes the
  // armor one step heavier."
  it('restates a chain shirt exactly as printed', () => {
    const base = db.items['chain-shirt'];
    const w = armorOf(wearing('chain-shirt', ['armored-skirt']));
    expect(w.armor.acBonus).toBe(base.acBonus + 1);
    expect(w.armor.dexCap).toBe((base.dexCap as number) - 1);
    expect(w.armor.checkPenalty).toBe((base.checkPenalty as number) - 1);
    // Printed as "+2 to the Strength SCORE"; the app stores a MODIFIER, so it is +1 here.
    expect(w.armor.strength).toBe((base.strength as number) + 1);
    expect(w.armor.traits).toContain('noisy');
    // Light → medium, and the proficiency follows.
    expect(base.category).toBe('light');
    expect(w.armor.category).toBe('medium');
    expect(w.profCategory).toBe('medium');
  });

  it('steps a medium host to heavy', () => {
    const w = armorOf(wearing('breastplate', ['armored-skirt']));
    expect(w.armor.category).toBe('heavy');
    expect(w.profCategory).toBe('heavy');
  });

  it('covers all four printed hosts and nothing else', () => {
    for (const id of ['breastplate', 'chain-shirt', 'chain-mail', 'scale-mail'])
      expect(armorOf(wearing(id, ['armored-skirt'])).adjustedBy, id).toHaveLength(1);
    // "grants no benefit when worn by itself or with armors other than those listed here"
    const leather = Object.values(db.items).find((i) => i.itemType === 'armor' && i.id === 'leather-armor');
    expect(leather, 'no leather armor to test the exclusion with').toBeTruthy();
    expect(typeof db.items['leather-armor'].acBonus, 'leather armor has no acBonus — the check below would be vacuous').toBe('number');
    const w = armorOf(wearing('leather-armor', ['armored-skirt']));
    expect(w.adjustedBy).toBeUndefined();
    expect(w.armor.acBonus).toBe(db.items['leather-armor'].acBonus);
  });
});

describe('Armored Skirt — the lightening mode', () => {
  // "Alternatively, when wearing an armored skirt to replace appropriate portions of a set of half
  // plate or full plate, reduce the armor's item bonus to AC by 1, lessen the check penalty by 1,
  // decrease the Strength score required … by 2, increase the armor's Dex cap by 1, and add noisy."
  it('makes full plate worse at AC and better at everything else, without changing its category', () => {
    const base = db.items['full-plate'];
    const w = armorOf(wearing('full-plate', ['armored-skirt']));
    expect(w.armor.acBonus).toBe(base.acBonus - 1);
    expect(w.armor.dexCap).toBe((base.dexCap as number) + 1);
    expect(w.armor.checkPenalty).toBe((base.checkPenalty as number) + 1);
    expect(w.armor.strength).toBe((base.strength as number) - 1);
    expect(w.armor.traits).toContain('noisy');
    // This mode prints no step — heavy stays heavy.
    expect(w.armor.category).toBe('heavy');
    expect(w.profCategory).toBe('heavy');
  });
});

describe('Plated Duster', () => {
  it('restates light chain armour and changes its group to composite', () => {
    const base = db.items['chain-shirt'];
    const w = armorOf(wearing('chain-shirt', ['plated-duster']));
    expect(w.armor.acBonus).toBe(base.acBonus + 1);
    expect(w.armor.group).toBe('composite');
    expect(w.armor.category).toBe('medium');
    expect(w.profCategory).toBe('medium');
  });

  it('does nothing to armour that is not light cloth, leather or chain', () => {
    // Breastplate is medium plate — outside the duster's host test entirely.
    expect(armorOf(wearing('breastplate', ['plated-duster'])).adjustedBy).toBeUndefined();
  });
});

describe('the exclusivity clause', () => {
  it('two adjusting items on one suit apply only once', () => {
    // "You can't use a plated duster alongside an armored skirt or any other item that adjusts an
    // armor's statistics."
    const both = armorOf(wearing('chain-shirt', ['armored-skirt', 'plated-duster']));
    expect(both.adjustedBy).toHaveLength(1);
    // …and the numbers moved once, not twice.
    expect(both.armor.acBonus).toBe(db.items['chain-shirt'].acBonus + 1);
  });
});

describe('what the player actually sees', () => {
  it('the check penalty worsens by exactly 1', () => {
    // A Str 10 fighter does not meet the chain shirt's Strength entry, so the penalty applies and the
    // worsening is visible. Asserted exactly, not "<=" — an equal value would pass a weaker check
    // while meaning the item did nothing.
    const plain = wearing('chain-shirt');
    const skirted = wearing('chain-shirt', ['armored-skirt']);
    const cpPlain = deriveArmorCheckPenalty(plain, db).value;
    const cpSkirt = deriveArmorCheckPenalty(skirted, db).value;
    expect(cpPlain, 'the base penalty does not apply, so this proves nothing').toBeLessThan(0);
    expect(cpSkirt).toBe(cpPlain - 1);
  });

  it('the AC breakdown explains the number the sheet shows', () => {
    // The breakdown used to read the armour through applyArmorRiders only, so it would have itemised
    // an un-restated suit while the total came from a restated one.
    const skirted = wearing('chain-shirt', ['armored-skirt']);
    const e = explainStat(skirted, db, { kind: 'ac' });
    const summed = e.parts.reduce((n, p) => n + (typeof p.value === 'number' ? p.value : 0), 0);
    expect(summed).toBe(deriveAc(skirted, db).value);
    expect(e.parts.some((p) => /restated by/i.test(p.note ?? ''))).toBe(true);
  });

  it('a fighter, trained in every category, gains the +1', () => {
    const plain = deriveAc(wearing('chain-shirt'), db);
    const skirted = deriveAc(wearing('chain-shirt', ['armored-skirt']), db);
    // A fighter is trained in medium armour, so the step costs nothing and the +1 lands.
    expect(skirted.value).toBe(plain.value + 1);
  });

  it('warns, with the real number, when the step actually costs proficiency', () => {
    // A bard is trained in LIGHT and untrained in MEDIUM, so a skirt on a chain shirt takes them from
    // AC 19 to AC 13. This is the one place in the app where a 2 gp purchase makes you materially
    // worse, so it must not be silent — and the quoted figure must be the real one.
    const inv = [
      { itemId: 'chain-shirt', quantity: 1, worn: true },
      { itemId: 'armored-skirt', quantity: 1, worn: true },
    ];
    const bard = build('bard', 5, { inventory: inv } as never);
    expect(bard.proficiencies.defenses.light, 'a bard should be trained in light armour').not.toBe('untrained');
    expect(bard.proficiencies.defenses.medium).toBe('untrained');
    const lost = deriveAc(build('bard', 5, { inventory: [inv[0]] } as never), db).value - deriveAc(bard, db).value;
    expect(lost).toBeGreaterThan(0);
    const warn = (bard.effectWarnings ?? []).find((w) => /armored skirt/i.test(w.source));
    expect(warn, 'no warning for a wearer who loses proficiency').toBeTruthy();
    expect(warn!.message).toMatch(new RegExp(`costs you ${lost} AC`));
  });

  it('does NOT warn someone who loses nothing', () => {
    // A wizard is untrained in light armour too, so the step costs them nothing — they just gain the
    // +1. Warning there would be noise, and the first version of this warning did exactly that.
    const wiz = build('wizard', 5, {
      inventory: [
        { itemId: 'chain-shirt', quantity: 1, worn: true },
        { itemId: 'armored-skirt', quantity: 1, worn: true },
      ],
    } as never);
    expect(wiz.proficiencies.defenses.light).toBe('untrained');
    expect((wiz.effectWarnings ?? []).some((w) => /armored skirt/i.test(w.source))).toBe(false);
  });

  it('and does NOT warn a fighter, who is trained there', () => {
    const f = wearing('chain-shirt', ['armored-skirt']);
    expect((f.effectWarnings ?? []).some((w) => /armored skirt/i.test(w.source))).toBe(false);
  });
});
