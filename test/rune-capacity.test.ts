import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { planAttach } from '../src/rules/attachments';
import { propertyRuneCapacity } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';
import type { Character, InventoryItem, Item } from '../src/rules/types';

/**
 * Rune Capacity — "Your innovation can have one more property rune than a normal item of its kind
 * (to a maximum of four property runes with a +3 potency)."
 *
 * The whole difficulty is scope: the cap lives in a clamp shared by every item in the game.
 */
const db = content();
const items = Object.values(db.items) as Item[];
const runes = Object.values(db.runes);

const weapon = items.find((i) => i.itemType === 'weapon')!;
const props = runes.filter((r) => r.kind === 'property' && r.slot === 'weapon');
const propItems = props.map((r) => db.items[r.id]).filter((i): i is Item => !!i);

const inv = (item: Item, extra: Partial<InventoryItem> = {}): InventoryItem =>
  ({ instanceId: 'inst-' + item.id, itemId: item.id, quantity: 1, ...extra }) as InventoryItem;

/** An inventor with a weapon innovation, taking rune-capacity as the revolutionary modification. */
const inventor = (withCapacity: boolean): Character =>
  build('inventor', 20, {
    subclassId: 'weapon-innovation',
    inventorModifications: withCapacity ? { revolutionary: 'rune-capacity' } : {},
  } as Partial<BuildState>);

/** A host at +3 potency already carrying `n` property runes, optionally the innovation. */
const host = (n: number, innovation: boolean): InventoryItem =>
  inv(weapon, {
    runes: { potency: 3, property: props.slice(0, n).map((r) => r.id) },
    ...(innovation ? { designations: ['innovation'] } : {}),
  } as Partial<InventoryItem>);

describe('Rune Capacity', () => {
  it('needs at least four distinct weapon property runes to be testable at all', () => {
    expect(propItems.length).toBeGreaterThanOrEqual(4);
  });

  it('a +3 weapon holds three property runes for everyone else', () => {
    const plain = build('fighter', 20);
    expect(propertyRuneCapacity(plain, host(0, false), db)).toBe(3);
  });

  it('the innovation holds four — but only for an inventor who took the modification', () => {
    expect(propertyRuneCapacity(inventor(true), host(0, true), db)).toBe(4);
    expect(propertyRuneCapacity(inventor(false), host(0, true), db)).toBe(3);
  });

  it('THE REGRESSION THAT MATTERS: the inventor\'s OTHER weapons stay at three', () => {
    // A blanket bump would have handed a fourth slot to every weapon in the game.
    expect(propertyRuneCapacity(inventor(true), host(0, false), db)).toBe(3);
  });

  it('scales with potency, and never conjures a slot without a potency rune', () => {
    const at = (potency: number) => propertyRuneCapacity(inventor(true), host(0, true), db, potency);
    expect(at(0)).toBe(0); // a property rune still requires a potency rune
    expect(at(1)).toBe(2);
    expect(at(2)).toBe(3);
    expect(at(3)).toBe(4);
  });

  it('a fourth rune is refused on a normal weapon and accepted on the innovation', () => {
    const fourth = propItems[3];
    const refused = planAttach(fourth, inv(fourth), weapon, host(3, false), [], db, inventor(true));
    expect(refused.ok).toBe(false);
    expect((refused as { reason: string }).reason).toMatch(/3 of 3/);

    const allowed = planAttach(fourth, inv(fourth), weapon, host(3, true), [], db, inventor(true));
    expect(allowed.ok).toBe(true);
  });

  it('a FIFTH rune is refused even on the innovation', () => {
    // The record's own maximum is four; capacity must not keep climbing.
    const fifth = propItems[4] ?? propItems[3];
    const h = inv(weapon, {
      runes: { potency: 3, property: props.slice(0, 4).map((r) => r.id) },
      designations: ['innovation'],
    } as Partial<InventoryItem>);
    const r = planAttach(fifth, inv(fifth), weapon, h, [], db, inventor(true));
    expect(r.ok).toBe(false);
  });

  it('dropping potency to +2 trims to the innovation\'s capacity, not the generic one', () => {
    // Etching a LOWER potency rune re-clamps the property runes. Sized against the new potency
    // and this host's own capacity, a +2 innovation keeps three — a normal +2 weapon keeps two.
    const potency2 = runes.find((r) => r.kind === 'potency' && r.slot === 'weapon' && r.value === 2);
    if (!potency2) return; // no +2 weapon potency rune ships — nothing to assert
    const item2 = db.items[potency2.id]!;
    const onInnovation = planAttach(item2, inv(item2), weapon, host(3, true), [], db, inventor(true));
    expect(onInnovation.ok).toBe(true);
    expect((onInnovation as { runes: { property: string[] } }).runes.property).toHaveLength(3);

    const onNormal = planAttach(item2, inv(item2), weapon, host(3, false), [], db, inventor(true));
    expect((onNormal as { runes: { property: string[] } }).runes.property).toHaveLength(2);
  });

  it('without a character the capacity falls back to the standard cap', () => {
    // Every pre-existing planAttach call site passes no character; none of them may change behaviour.
    expect(propertyRuneCapacity(undefined, host(0, true), db)).toBe(3);
  });
});
