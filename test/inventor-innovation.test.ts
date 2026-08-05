import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';

/**
 * Inventor innovation modifications. These are not feats — they are chosen per tier
 * (initial @1, breakthrough @7, revolutionary @15) and found by `otherTags`.
 */
const db = content();

type Mods = NonNullable<BuildState['inventorModifications']>;
const inv = (level: number, modifications: Mods, subclassId = 'armor-innovation') =>
  build('inventor', level, { subclassId, inventorModifications: modifications } as Partial<BuildState>);

const res = (level: number, modifications: Mods, subclassId?: string) => {
  const d = deriveDefenses(inv(level, modifications, subclassId), db);
  return Object.fromEntries(d.resistances.map((r) => [r.type, r.value]));
};

describe('Enhanced Resistance', () => {
  it('the record still says full-level, and is a breakthrough ARMOR modification', () => {
    const rec = db.classFeatures['enhanced-resistance'];
    expect(rec.resistanceLevelUpgrade).toBe('inventor-initial');
    expect(rec.level).toBe(7);
    expect(rec.otherTags).toContain('armor-innovation-modification');
  });

  it('without it, the initial modification stays at half level', () => {
    expect(res(12, { initial: 'phlogistonic-regulator' })).toMatchObject({ cold: 6, fire: 6 });
  });

  it('with it, the same modification counts the full level', () => {
    expect(res(12, { initial: 'phlogistonic-regulator', breakthrough: 'enhanced-resistance' })).toMatchObject({
      cold: 12,
      fire: 12,
    });
  });

  it('a flat bonus in the formula survives the upgrade', () => {
    // metallic-reactance is "3+floor(@actor.level/2)" — at 12 that is 9, and 3+12 = 15 upgraded.
    // Setting the value to the level outright would have thrown the +3 away.
    expect(res(12, { initial: 'metallic-reactance' })).toMatchObject({ acid: 9, electricity: 9 });
    expect(res(12, { initial: 'metallic-reactance', breakthrough: 'enhanced-resistance' })).toMatchObject({
      acid: 15,
      electricity: 15,
    });
  });

  it("min(1) survives too — it just stops mattering once it's the full level", () => {
    // phlogistonic-regulator is max(1,floor(level/2)): at level 1 half-level floors to 0, so the
    // max(1,…) is what keeps it at 1. Upgraded it reads max(1,level).
    expect(res(1, { initial: 'phlogistonic-regulator' })).toMatchObject({ cold: 1, fire: 1 });
  });

  it('it upgrades ONLY the initial modification, not every resistance the inventor has', () => {
    // physical-protections is a REVOLUTIONARY modification with its own half-level resistance.
    // "The resistance from your initial armor modification" — this one is untouched.
    const r = res(20, {
      initial: 'phlogistonic-regulator',
      breakthrough: 'enhanced-resistance',
      revolutionary: 'physical-protections',
    });
    expect(r).toMatchObject({ cold: 20, fire: 20 }); // initial → full level
    expect(r).toMatchObject({ bludgeoning: 10, slashing: 10, bleed: 10 }); // revolutionary → still half
  });

  it('falls back to a later slot holding an initial-TIER modification', () => {
    // inventorModificationOptions filters `level <= tierLevel`, so a level-1 modification is legal in
    // the breakthrough slot. Here the initial slot grants no resistance at all, so the only "initial
    // modification that gives resistance" is the one taken later — and that is what improves.
    expect(db.classFeatures['harmonic-oscillator'].level).toBe(1);
    const r = res(15, { initial: 'muscular-exoskeleton', breakthrough: 'harmonic-oscillator', revolutionary: 'enhanced-resistance' });
    expect(r).toMatchObject({ force: 18, sonic: 18 }); // 3+level, not 3+floor(level/2)=10
  });

  it('a WEAPON innovation gets nothing — the feat says "initial armor modification"', () => {
    const c = inv(12, { initial: 'phlogistonic-regulator', breakthrough: 'enhanced-resistance' }, 'weapon-innovation');
    expect(c.inventor?.innovationType).toBe('weapon');
    // Whatever a weapon inventor's modifications resolve to, no cold/fire resistance is invented.
    const d = deriveDefenses(c, db);
    expect(d.resistances.find((r) => r.type === 'cold')?.value ?? 0).toBe(0);
  });

  it('the breakdown still names the modification, not the feat that improved it', () => {
    const d = deriveDefenses(inv(12, { initial: 'phlogistonic-regulator', breakthrough: 'enhanced-resistance' }), db);
    expect(d.sources['resistance:cold']?.map((s) => s.from)).toContain('Phlogistonic Regulator');
  });
});

describe('the three modifications carry their data', () => {
  it('heavy-construction restats to heavy but reads proficiency from MEDIUM', () => {
    const r = db.classFeatures['heavy-construction'].armorRestat!;
    expect(r.set?.category).toBe('heavy');
    // Without this an inventor — never trained in heavy armor — would lose the whole proficiency bonus.
    expect(r.proficiencyAs).toBe('medium');
    expect(r.set?.speedPenalty).toBe(-10);
    expect(r.set?.bulk).toBe(3);
    expect(r.addTraits).toEqual(['bulwark', 'entrench']);
    expect(r.removeSpeedPenaltyAtStr).toBe(3);
    // Power Suit only — the subterfuge suit must never be offered it.
    expect(db.classFeatures['heavy-construction'].otherTags).toContain('power-suit-modification');
  });

  it('rune-capacity is scoped to the innovation, never to weapons at large', () => {
    const p = db.classFeatures['rune-capacity'].propertyRuneBonus!;
    expect(p).toMatchObject({ designated: 'innovation', bonus: 1, max: 4 });
    // It is a revolutionary modification legal on BOTH innovation kinds.
    expect(db.classFeatures['rune-capacity'].otherTags).toEqual(
      expect.arrayContaining(['armor-innovation-modification', 'weapon-innovation-modification']),
    );
  });
});
