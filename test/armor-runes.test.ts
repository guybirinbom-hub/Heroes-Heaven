import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveAc, deriveBulk } from '../src/rules/derive';

/**
 * Armour property runes could not do anything.
 *
 * `RuneDef` carried a `damage` payload and nothing else — and `damage` is weapon-side. So both of the
 * armour property runes that ship were bare registrations: etchable, and changing no number.
 */
const db = content();

/** A character wearing `armorId` with `property` runes etched. */
function wearing(armorId: string, property: string[], extra: Record<string, unknown> = {}) {
  const c = build('fighter', 10, {});
  return {
    ...c,
    inventory: [
      { instanceId: 'a', itemId: armorId, quantity: 1, worn: true, equipped: true, invested: true, runes: { property }, ...extra },
    ],
  } as typeof c;
}

const ARMOR = 'leather-armor';

describe('a property rune that FUNCTIONS AS a fundamental one', () => {
  it('the record says so, and is still a property rune', () => {
    const r = db.runes['adamantine-echo'];
    expect(r.slot).toBe('armor');
    expect(r.kind, 'recording it as a potency rune would move it out of the property slot').toBe('property');
    expect(r.actsAs).toEqual({ kind: 'potency', value: 1 });
  });

  it('it delivers the +1 item bonus to AC', () => {
    expect(db.items[ARMOR], 'the fixture armour must ship').toBeTruthy();
    const plain = deriveAc(wearing(ARMOR, []), db).value;
    const echo = deriveAc(wearing(ARMOR, ['adamantine-echo']), db).value;
    expect(echo).toBe(plain + 1);
  });

  it('it does not stack with a real potency rune — both are item bonuses', () => {
    const withPotency = {
      ...wearing(ARMOR, ['adamantine-echo']),
    } as ReturnType<typeof wearing>;
    withPotency.inventory[0].runes = { potency: 2, property: ['adamantine-echo'] } as never;
    const only2 = wearing(ARMOR, []);
    only2.inventory[0].runes = { potency: 2 } as never;
    expect(deriveAc(withPotency, db).value).toBe(deriveAc(only2, db).value);
  });

  it('an unrelated property rune does nothing to AC', () => {
    const plain = deriveAc(wearing(ARMOR, []), db).value;
    expect(deriveAc(wearing(ARMOR, ['assisting']), db).value).toBe(plain);
  });
});

describe('a property rune that moves the Bulk thresholds', () => {
  it('the record carries the payload', () => {
    expect(db.runes.assisting.passiveEffects).toEqual({ bulkLimitBonus: 1 });
  });

  it('both thresholds rise by one', () => {
    const plain = deriveBulk(wearing(ARMOR, []), db);
    const assisted = deriveBulk(wearing(ARMOR, ['assisting']), db);
    expect(assisted.encumberedAt).toBe(plain.encumberedAt + 1);
    expect(assisted.max).toBe(plain.max + 1);
  });

  it('the printed numbers are 6 + Str and 11 + Str', () => {
    const c = wearing(ARMOR, ['assisting']);
    const str = Math.floor((c.abilities.str - 10) / 2);
    const b = deriveBulk(c, db);
    expect(b.encumberedAt).toBe(6 + str);
    expect(b.max).toBe(11 + str);
  });

  it('it keys off INVESTING the armour, as its own text does', () => {
    const c = wearing(ARMOR, ['assisting']);
    const uninvested = { ...c, inventory: [{ ...c.inventory[0], invested: false }] } as typeof c;
    expect(deriveBulk(uninvested, db).max).toBe(deriveBulk(wearing(ARMOR, []), db).max);
  });

  it('a rune on armour you are not WEARING does nothing', () => {
    const c = wearing(ARMOR, ['assisting']);
    const carried = { ...c, inventory: [{ ...c.inventory[0], worn: false }] } as typeof c;
    expect(deriveBulk(carried, db).max).toBe(deriveBulk(wearing(ARMOR, []), db).max);
  });

  it('two assisting suits do not stack — it is one set of supports', () => {
    const c = wearing(ARMOR, ['assisting']);
    const two = {
      ...c,
      inventory: [c.inventory[0], { ...c.inventory[0], instanceId: 'b' }],
    } as typeof c;
    expect(deriveBulk(two, db).max).toBe(deriveBulk(c, db).max);
  });
});
