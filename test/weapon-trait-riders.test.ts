import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrike } from '../src/rules/derive';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * "Melee weapons you wield gain the versatile B trait."
 *
 * A weapon's traits came straight off its item record, so Hilt Hammer and Deadly Grace — feats whose
 * whole content is adding a trait to what you are holding — could not touch a single Strike. This is
 * the wielded sibling of the unarmed rider lane.
 */
const db = content();
const wield = (itemId: string): InventoryItem => ({ instanceId: 'w1', itemId, quantity: 1, equipped: true });
const strikeOf = (ch: Character, itemId: string) => deriveStrike({ ...ch, inventory: [wield(itemId)] }, db, wield(itemId))!;

/** A melee weapon carrying every trait in `has` and none in `lacks`. */
const findWeapon = (has: string[], lacks: string[] = [], melee = true) =>
  Object.entries(db.items).find(
    ([, it]) =>
      it.itemType === 'weapon' &&
      !!it.damage &&
      (melee ? !it.range : !!it.range) &&
      has.every((t) => it.traits.includes(t)) &&
      lacks.every((t) => !it.traits.some((x) => x.startsWith(t))),
  )?.[0];

describe('wielded weapon trait riders', () => {
  it('Hilt Hammer puts versatile B on a melee weapon', () => {
    const sword = findWeapon([], ['versatile'])!;
    const plain = build('fighter', 10, {});
    const withIt = build('fighter', 10, { featPicks: { '10:class': 'hilt-hammer' } });
    expect(strikeOf(plain, sword).traits).not.toContain('versatile-b');
    expect(strikeOf(withIt, sword).traits).toContain('versatile-b');
  });

  it('it leaves RANGED weapons alone — the text says melee', () => {
    const bow = findWeapon([], ['versatile'], false)!;
    const ch = build('fighter', 10, { featPicks: { '10:class': 'hilt-hammer' } });
    expect(strikeOf(ch, bow).traits).not.toContain('versatile-b');
  });

  it('Deadly Grace only touches an agile or finesse melee weapon', () => {
    const agile = findWeapon(['agile'], ['deadly'])!;
    const neither = Object.entries(db.items).find(
      ([, it]) => it.itemType === 'weapon' && !!it.damage && !it.range && !it.traits.includes('agile') && !it.traits.includes('finesse'),
    )?.[0];
    const ch = build('swashbuckler', 16, { featPicks: { '16:class': 'deadly-grace' } });
    expect(strikeOf(ch, agile).traits).toContain('deadly-d8');
    if (neither) expect(strikeOf(ch, neither).traits).not.toContain('deadly-d8');
  });

  it("it does NOT downgrade a weapon that already has deadly — the text says 'that doesn't have'", () => {
    const alreadyDeadly = Object.entries(db.items).find(
      ([, it]) =>
        it.itemType === 'weapon' &&
        !!it.damage &&
        !it.range &&
        (it.traits.includes('agile') || it.traits.includes('finesse')) &&
        it.traits.some((t) => t.startsWith('deadly-')),
    );
    if (!alreadyDeadly) return; // nothing in the corpus to prove it with
    const [id, item] = alreadyDeadly;
    const ch = build('swashbuckler', 16, { featPicks: { '16:class': 'deadly-grace' } });
    const got = strikeOf(ch, id).traits.filter((t) => t.startsWith('deadly-'));
    expect(got).toEqual(item.traits.filter((t) => t.startsWith('deadly-')));
  });

  it('a character without either feat gets the weapon exactly as printed', () => {
    const sword = findWeapon([], ['versatile'])!;
    const ch = build('fighter', 10, {});
    expect(strikeOf(ch, sword).traits.sort()).toEqual([...db.items[sword].traits].sort());
  });

  it('the data matches the printed filters', () => {
    expect(db.feats['hilt-hammer'].weaponTraits).toEqual({ match: { melee: true }, add: ['versatile-b'] });
    expect(db.feats['deadly-grace'].weaponTraits).toEqual({
      match: { melee: true, anyTrait: ['agile', 'finesse'] },
      add: ['deadly-d8'],
      onlyIfMissing: true,
    });
  });
});
