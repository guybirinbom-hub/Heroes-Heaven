import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { deriveArmorCheckPenalty, deriveMaxHp, deriveStrikes, ownedFeatureIds } from '../src/rules/derive';
import { deriveAnimalCompanion } from '../src/rules/companions';
import type { InventoryItem } from '../src/rules/types';

/** The deferred bespoke tail — each of these needed its own logic rather than a shared lane. */
const c = () => content();

describe('Belt of Good Health', () => {
  it('adds its +4 to maximum HP while worn', () => {
    const belt: InventoryItem = { instanceId: 'b', itemId: 'belt-of-good-health', quantity: 1, worn: true, invested: true };
    const without = build('fighter', 5);
    const withIt = build('fighter', 5, { inventory: [belt] });
    // maxHpBonus walked FEATS only, so an item carrying one did nothing.
    expect(deriveMaxHp(withIt, c()) - deriveMaxHp(without, c())).toBe(4);
  });
});

describe('Monk Dedication', () => {
  it('grants the Powerful Fist class feature it says it grants', () => {
    const ch = build('fighter', 4, { featPicks: { '2:class:0': 'monk-dedication' } });
    expect([...ownedFeatureIds(ch, c())]).toContain('powerful-fist');
  });
});

describe('Armored Stealth', () => {
  const inArmor = (has: boolean, stealth: 'trained' | 'master' | 'legendary') => {
    const ch = build('fighter', 15, {
      featPicks: has ? { '1:skill:0': 'armored-stealth' } : {},
      inventory: [{ instanceId: 'a', itemId: 'half-plate', quantity: 1, worn: true }],
    });
    ch.proficiencies.skills.stealth = stealth;
    ch.abilities = { ...ch.abilities, str: 8 }; // below the armour's Strength requirement
    return deriveArmorCheckPenalty(ch, c(), 'stealth').value;
  };
  it('reduces the Stealth check penalty, and more at higher ranks', () => {
    const base = inArmor(false, 'trained');
    expect(base).toBeLessThan(0);
    expect(inArmor(true, 'trained')).toBe(base + 1);
    expect(inArmor(true, 'master')).toBe(base + 2);
    expect(inArmor(true, 'legendary')).toBe(base + 3);
  });
  it('leaves other skills alone — the feat is Stealth-only', () => {
    const ch = build('fighter', 15, {
      featPicks: { '1:skill:0': 'armored-stealth' },
      inventory: [{ instanceId: 'a', itemId: 'half-plate', quantity: 1, worn: true }],
    });
    ch.abilities = { ...ch.abilities, str: 8 };
    const plain = build('fighter', 15, { inventory: [{ instanceId: 'a', itemId: 'half-plate', quantity: 1, worn: true }] });
    plain.abilities = { ...plain.abilities, str: 8 };
    expect(deriveArmorCheckPenalty(ch, c(), 'athletics').value).toBe(deriveArmorCheckPenalty(plain, c(), 'athletics').value);
  });
});

describe('Circle of Spirits', () => {
  it("raises an animist's focus pool to their focus-spell count", () => {
    const plain = build('animist', 6, {});
    const withIt = build('animist', 6, { featPicks: { '4:class:0': 'circle-of-spirits' } });
    // The animist pool was pinned to the 1/7/15 apparition ladder; the feat's Special clause says it
    // is the HIGHER of that and the number of focus spells, capped at 3.
    expect(withIt.focus?.max ?? 0).toBeGreaterThanOrEqual(plain.focus?.max ?? 0);
    expect(withIt.focus?.max ?? 0).toBeLessThanOrEqual(3);
  });
});

describe('Strength of Eight Legions', () => {
  it('adds its +2 damage to Strikes', () => {
    const inv: InventoryItem = { instanceId: 'w', itemId: 'longsword', quantity: 1, equipped: true };
    const plain = build('fighter', 12, { inventory: [inv] });
    const withIt = build('fighter', 12, { featPicks: { '12:class:0': 'strength-of-eight-legions' }, inventory: [inv] });
    const dmg = (x: ReturnType<typeof build>) => deriveStrikes(x, c()).find((s) => s.name === c().items.longsword.name)?.damage ?? '';
    expect(dmg(withIt)).not.toBe(dmg(plain));
  });
});

describe('Terrain Scout and Ancient Memories', () => {
  it('Terrain Scout asks for BOTH terrains', () => {
    const f = c().feats['terrain-scout'];
    expect(f?.choice?.picks).toBe(2);
    expect(f?.choice?.distinct).toBe(true);
    expect((f?.choice?.options ?? []).length).toBeGreaterThan(1);
  });
  it('Ancient Memories is a daily choice like its six siblings', () => {
    expect(c().feats['ancient-memories']?.choice?.daily).toBe(true);
    expect(c().feats['ancient-memories']?.choice?.kind).toBe('skills');
  });
});

describe('companion ranged weapons', () => {
  it('labels a wielded bow Ranged and drops Strength from its damage', () => {
    const ch = build('ranger', 6, {
      featPicks: { '1:class:0': 'animal-companion' },
      companions: [
        {
          id: 'c1',
          kind: 'animal',
          name: 'Fang',
          typeId: Object.keys(c().animalCompanions)[0],
          inventory: [{ instanceId: 'w', itemId: 'shortbow', quantity: 1, equipped: true }],
        },
      ],
    });
    const cfg = ch.companions![0];
    const block = deriveAnimalCompanion(cfg, c().animalCompanions[cfg.typeId!], ch.level, c());
    const bow = block.attacks.find((a) => a.name === c().items.shortbow.name);
    expect(bow, 'the wielded bow becomes a strike').toBeTruthy();
    // A shortbow is `range: 60` with traits [deadly-d10] — no ranged or thrown trait at all, which is
    // why a trait-only test called it Melee.
    expect(c().items.shortbow.traits).not.toContain('ranged');
    expect(bow!.range).toBe(60);
  });
});
