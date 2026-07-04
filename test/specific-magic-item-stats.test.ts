import { describe, it, expect } from 'vitest';
import { deriveAc, deriveShield, deriveStrike } from '../src/rules/derive';
import { content, build } from './_content';
import type { Character } from '../src/rules/types';

const c = content();

/** Replace the character's inventory with a single worn armor. */
function wearing(ch: Character, itemId: string): Character {
  return { ...ch, inventory: [{ instanceId: 'arm1', itemId, quantity: 1, worn: true }] };
}
/** Replace the character's inventory with a single wielded shield. */
function holdingShield(ch: Character, itemId: string): Character {
  return { ...ch, inventory: [{ instanceId: 'shd1', itemId, quantity: 1, equipped: true }] };
}
/** Replace the character's inventory with a single wielded weapon and return its instance. */
function holdingWeapon(ch: Character, itemId: string): { ch: Character; inv: Character['inventory'][number] } {
  const inv = { instanceId: 'wpn1', itemId, quantity: 1, equipped: true };
  return { ch: { ...ch, inventory: [inv] }, inv };
}

const fighter = () => build('fighter', 5, { keyAbility: 'str' });

// These named specific magic items exist with correct stats in the Foundry packs (the AoN-scraped
// `aon-` stubs that used to duplicate them were removed — see test/item-aliases.test.ts). Equipping one
// must yield a real Strike / finite AC / finite shield stats.
describe('specific magic items carry their core stats', () => {
  it('a named specific weapon carries damage (Splintering Spear ← spear)', () => {
    const it = c.items['splintering-spear'];
    expect(it?.itemType).toBe('weapon');
    if (it?.itemType === 'weapon') {
      expect(it.damage).toEqual({ dice: 1, die: 'd6', type: 'piercing' });
      expect(it.category).toBe('simple');
      expect(it.group).toBe('spear');
    }
  });

  it('a named specific armor carries acBonus (Hero’s Plate (Greater) ← full-plate)', () => {
    const it = c.items['heros-plate-greater'];
    expect(it?.itemType).toBe('armor');
    if (it?.itemType === 'armor') {
      expect(it.acBonus).toBe(6);
      expect(it.category).toBe('heavy');
      expect(it.dexCap).toBe(0);
    }
  });

  it('a named specific shield carries reinforced hardness/hp (Energized Shield (Lesser))', () => {
    const it = c.items['energized-shield-lesser'];
    expect(it?.itemType).toBe('shield');
    if (it?.itemType === 'shield') {
      expect(it.acBonus).toBe(2);
      // Reinforced steel shield: Hardness 8, HP 64, BT 32 (not the bare-steel 5/20/10).
      expect(it.hardness).toBe(8);
      expect(it.hp).toBe(64);
      expect(it.brokenThreshold).toBe(32);
    }
  });

  it('deriveStrike returns an attack for a specific weapon', () => {
    const { ch, inv } = holdingWeapon(fighter(), 'cavalry-commanders-lance');
    const strike = deriveStrike(ch, c, inv);
    expect(strike).not.toBeNull();
    expect(strike!.attack.every((a) => Number.isFinite(a))).toBe(true);
    expect(strike!.damage).toContain('d8');
  });

  it('a specific armor yields a finite AC (no NaN)', () => {
    const ch = wearing(fighter(), 'heros-plate-greater');
    const ac = deriveAc(ch, c);
    expect(Number.isFinite(ac.value)).toBe(true);
    // full-plate acBonus 6 + heavy-armor prof; well above the unarmored 10 + dex baseline.
    expect(ac.value).toBeGreaterThan(15);
  });

  it('a specific shield yields finite shield stats (no NaN)', () => {
    const ch = holdingShield(fighter(), 'energized-shield-lesser');
    const s = deriveShield(ch, c);
    expect(s).not.toBeNull();
    for (const v of [s!.ac, s!.hardness, s!.hp, s!.brokenThreshold, s!.current]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// Defense-in-depth: even an item that somehow still lacks a stat must not corrupt the sheet.
describe('derive math is NaN-proof against stat-less items', () => {
  it('deriveAc stays finite when the worn armor has undefined acBonus', () => {
    const brokenArmor = { ...c, items: { ...c.items, 'test-broken-armor': { id: 'test-broken-armor', name: 'Broken Armor', itemType: 'armor', level: 0, category: 'light' } } } as typeof c;
    const ch = { ...fighter(), inventory: [{ instanceId: 'a1', itemId: 'test-broken-armor', quantity: 1, worn: true }] };
    const ac = deriveAc(ch, brokenArmor);
    expect(Number.isFinite(ac.value)).toBe(true);
  });

  it('deriveShield stays finite when the held shield has undefined hardness/hp/acBonus', () => {
    const brokenShield = { ...c, items: { ...c.items, 'test-broken-shield': { id: 'test-broken-shield', name: 'Broken Shield', itemType: 'shield', level: 0 } } } as typeof c;
    const ch = { ...fighter(), inventory: [{ instanceId: 's1', itemId: 'test-broken-shield', quantity: 1, equipped: true }] };
    const s = deriveShield(ch, brokenShield);
    expect(s).not.toBeNull();
    for (const v of [s!.ac, s!.hardness, s!.hp, s!.brokenThreshold]) expect(Number.isFinite(v)).toBe(true);
  });
});

// Three focus spells import with empty traits.traditions in the Foundry source, making them invisible
// in every spell list. A targeted override (fixes.json) sets their real traditions.
describe('empty-tradition focus spells get their traditions restored', () => {
  it.each([
    ['soulshelter-vessel', 'divine'],
    ['suffocate', 'occult'],
    ['web-of-influence', 'occult'],
  ])('%s has tradition %s', (id, tradition) => {
    const sp = c.spells[id];
    expect(sp).toBeTruthy();
    expect(sp.traditions).toContain(tradition);
  });
});
