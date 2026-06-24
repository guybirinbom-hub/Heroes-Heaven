import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { planAttach, attachHostTypes } from '../src/rules/attachments';
import type { InventoryItem, Item } from '../src/rules/types';

const db = content();
const items = Object.values(db.items) as Item[];
const runes = Object.values(db.runes);

const inv = (item: Item, extra: Partial<InventoryItem> = {}): InventoryItem =>
  ({ instanceId: 'inst-' + item.id, itemId: item.id, quantity: 1, ...extra }) as InventoryItem;

const weapon = items.find((i) => i.itemType === 'weapon')!;
const armor = items.find((i) => i.itemType === 'armor')!;
const consumablePlain = items.find((i) => i.itemType === 'consumable' && i.consumableType === 'potion')!;
// A talisman that can affix to a weapon (most default to all three host types).
const talisman = items.find(
  (i) => i.itemType === 'consumable' && i.consumableType === 'talisman' && !db.runes[i.id] && attachHostTypes(i).includes('weapon'),
)!;
// Property + potency runes (their twin items live in content.items under the same id).
const weaponProp = runes.find((r) => r.kind === 'property' && r.slot === 'weapon')!;
const weaponPropItem = db.items[weaponProp?.id] as Item | undefined;
const weaponPotency = runes.find((r) => r.kind === 'potency' && r.slot === 'weapon')!;
const weaponPotencyItem = db.items[weaponPotency?.id] as Item | undefined;

describe('planAttach — affixables (talisman/spellheart/banner)', () => {
  it('affixes a talisman onto a valid weapon host', () => {
    expect(talisman).toBeTruthy();
    const r = planAttach(talisman, inv(talisman), weapon, inv(weapon), [inv(talisman), inv(weapon)], db);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action).toBe('affix');
  });

  it('rejects affixing onto a non-host item (a potion), with a reason', () => {
    const r = planAttach(talisman, inv(talisman), consumablePlain, inv(consumablePlain), [], db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/weapon, armor, or shield/i);
  });

  it('rejects re-affixing a talisman already affixed elsewhere', () => {
    const r = planAttach(talisman, inv(talisman, { attachedTo: 'someoneElse' }), weapon, inv(weapon), [], db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already affixed/i);
  });

  it('rejects a second talisman on a host that already has one', () => {
    const host = inv(weapon);
    const existing = inv(talisman, { instanceId: 'already', attachedTo: host.instanceId });
    const dragged = inv(talisman, { instanceId: 'dragged' });
    const r = planAttach(talisman, dragged, weapon, host, [host, existing, dragged], db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already has a talisman/i);
  });

  it('rejects attaching an item to itself', () => {
    const r = planAttach(weapon, inv(weapon), weapon, inv(weapon), [inv(weapon)], db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/itself/i);
  });

  it('rejects a non-rune, non-attachable item', () => {
    const r = planAttach(consumablePlain, inv(consumablePlain), weapon, inv(weapon), [], db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/isn’t a rune or an attachment/i);
  });
});

describe('planAttach — runes', () => {
  it('etches a potency rune onto a weapon', () => {
    expect(weaponPotencyItem).toBeTruthy();
    const r = planAttach(weaponPotencyItem!, inv(weaponPotencyItem!), weapon, inv(weapon), [], db);
    expect(r.ok).toBe(true);
    if (r.ok && r.action === 'etch') {
      expect(r.runes.potency).toBe(weaponPotency.value);
      expect(r.consume).toBe(true);
    }
  });

  it('refuses a property rune when the host has no potency rune', () => {
    expect(weaponPropItem).toBeTruthy();
    const r = planAttach(weaponPropItem!, inv(weaponPropItem!), weapon, inv(weapon), [], db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/potency rune first/i);
  });

  it('etches a property rune when a potency rune opened a slot', () => {
    const host = inv(weapon, { runes: { potency: 1 } });
    const r = planAttach(weaponPropItem!, inv(weaponPropItem!), weapon, host, [], db);
    expect(r.ok).toBe(true);
    if (r.ok && r.action === 'etch') expect(r.runes.property).toContain(weaponProp.id);
  });

  it('refuses a duplicate property rune', () => {
    const host = inv(weapon, { runes: { potency: 2, property: [weaponProp.id] } });
    const r = planAttach(weaponPropItem!, inv(weaponPropItem!), weapon, host, [], db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already has the/i);
  });

  it('refuses a property rune when all slots are full', () => {
    // potency 1 → one slot, already filled by a different rune id.
    const other = runes.find((r) => r.kind === 'property' && r.slot === 'weapon' && r.id !== weaponProp.id)!;
    const host = inv(weapon, { runes: { potency: 1, property: [other.id] } });
    const r = planAttach(weaponPropItem!, inv(weaponPropItem!), weapon, host, [], db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no free property-rune slot/i);
  });

  it('refuses a weapon rune on armor (slot mismatch)', () => {
    const host = inv(armor, { runes: { potency: 1 } });
    const r = planAttach(weaponPropItem!, inv(weaponPropItem!), armor, host, [], db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/weapon rune/i);
  });
});
