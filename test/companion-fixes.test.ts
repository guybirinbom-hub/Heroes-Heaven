import { describe, it, expect } from 'vitest';
import { deriveAnimalCompanion, deriveEidolon } from '../src/rules/companions';
import { abilityMod, profBonus } from '../src/rules/derive';
import { build, content, firstSubclass } from './_content';
import type { CompanionConfig } from '../src/rules/types';

const c = content();
const animal = (typeId: string, maturity: string, level: number) =>
  deriveAnimalCompanion({ id: 'x', kind: 'animal', name: '', typeId, maturity } as CompanionConfig, c.animalCompanions[typeId], level, c);

// Per-type ancestry HP + (6 + Con) per level (Con includes the maturity boost).
const expectHp = (typeId: string, level: number, conBoost = 0) => {
  const t = c.animalCompanions[typeId];
  return (t.hp ?? 6) + (6 + (t.abilities.con ?? 0) + conBoost) * level;
};

describe('animal companion per-type HP', () => {
  it('uses the per-type base HP (Bird 4, Wolf 6, Bear 8), not a flat 6', () => {
    expect(c.animalCompanions.bird.hp).toBe(4);
    expect(c.animalCompanions.wolf.hp).toBe(6);
    expect(c.animalCompanions.bear.hp).toBe(8);
    // distinct bases produce distinct HP at the same level
    expect(animal('bird', 'young', 1).hp).toBe(expectHp('bird', 1));
    expect(animal('bear', 'young', 1).hp).toBe(expectHp('bear', 1));
    expect(animal('bird', 'young', 1).hp).not.toBe(animal('bear', 'young', 1).hp);
  });
  it('a level-4 mature wolf is still 42 (regression — mature bumps Con +1)', () => {
    expect(animal('wolf', 'mature', 4).hp).toBe(42);
  });
});

describe('animal companion speed by maturity', () => {
  it('nimble grants no inherent land-Speed bonus (only the Racer specialization does)', () => {
    expect(animal('wolf', 'nimble', 4).speeds.land).toBe(c.animalCompanions.wolf.speeds.land);
    expect(animal('wolf', 'specialized', 7).speeds.land).toBe(c.animalCompanions.wolf.speeds.land);
  });
});

describe('eidolon AC', () => {
  it('uses its own UNARMORED defense — the eidolon’s OWN Dex + array AC bonus, not the summoner’s armored AC', () => {
    const summoner = build('summoner', 5, { subclassId: firstSubclass('summoner') ?? undefined });
    const eid = deriveEidolon(
      { id: 'e', kind: 'eidolon', name: '', typeId: firstSubclass('summoner') ?? '', eidolon: { abilities: { dex: 3 }, acItemBonus: 1 } } as CompanionConfig,
      summoner,
      c,
    );
    // 10 + the eidolon's own Dex (3) + array item bonus (1) + the summoner's (shared) unarmored proficiency
    const expected = 10 + 3 + 1 + profBonus(summoner.proficiencies.defenses.unarmored, summoner.level);
    expect(eid.ac).toBe(expected);
    expect(abilityMod(summoner.abilities.dex)).not.toBeNaN(); // summoner Dex no longer feeds the eidolon AC
  });
});
