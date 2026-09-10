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

/*
 * The armour is WORN here on purpose. Several modifications print *"while wearing your armor, you gain
 * resistance…"* and that clause is now enforced (`defensesRequire.armored`), so an inventor tested in
 * their underwear legitimately has no armour resistance. These cases are about the Enhanced Resistance
 * upgrade MATH, so they equip the suit the modifications require; the gate itself is covered by
 * test/armor-gated-defences.test.ts, including the with-the-suit-off case.
 */
const res = (level: number, modifications: Mods, subclassId?: string) => {
  const base = inv(level, modifications, subclassId);
  const armored = { ...base, inventory: [...base.inventory, { instanceId: 'suit', itemId: 'half-plate', quantity: 1, worn: true }] };
  const d = deriveDefenses(armored, db);
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

  /*
   * WAS "min(1) survives too": phlogistonic-regulator shipped max(1,floor(level/2)) and this test
   * pinned the floor. Batch 035 read the record against print and removed it — AoN innovation-5
   * §Phlogistonic Regulator is "You gain resistance equal to half your level to cold and fire damage",
   * with no minimum, and WG's row 24832 (adjValue RESISTANCES "cold, {{level/2}}") has none either, so
   * a 1st-level inventor was reading 1 where BOTH authorities read 0. What this test is actually for —
   * that Enhanced Resistance rewrites the formula rather than replacing it, keeping whatever wrapper
   * the modification's own value carries — is preserved on the upgraded half, which is the half that
   * exercises the rewriter.
   */
  // batch 035: phlogistonic-regulator#resistance-minimum
  it('phlogistonic-regulator has no floor: half of level 1 is 0, and Enhanced Resistance still rewrites it at 7th', () => {
    expect(res(1, { initial: 'phlogistonic-regulator' })).toEqual({});
    // Enhanced Resistance is a BREAKTHROUGH modification (level 7), so 7th is the first level at which
    // the rewriter runs at all: half of 7 is 3, upgraded to the full 7.
    expect(res(7, { initial: 'phlogistonic-regulator' })).toMatchObject({ cold: 3, fire: 3 });
    expect(res(7, { initial: 'phlogistonic-regulator', breakthrough: 'enhanced-resistance' })).toMatchObject({ cold: 7, fire: 7 });
  });

  /*
   * WAS physical-protections in the revolutionary slot. Batch 036 enforced the printed prerequisite on
   * every revolutionary modification that carries one, and physical-protections' own is a BREAKTHROUGH
   * one — which this build cannot hold, because Enhanced Resistance is already in that single slot. So
   * the old build became illegal by print and the modification granted nothing, which is the gate
   * working, not a regression. energy-barrier is the same shape one modification over and IS legal here:
   * its prerequisite list is initial-tier and the build's initial already satisfies it. What the case is
   * for — that Enhanced Resistance rewrites the INITIAL modification's formula and leaves every other
   * modification's alone — is unchanged and now reads on six non-overlapping energy types instead of
   * three physical ones. Level 20: initial half-level 10 upgraded to the full 20; energy-barrier
   * 2 + half level = 12, untouched. cold/fire are asserted at 20 because both modifications grant them
   * and the higher wins, which is the same assertion the old case made.
   */
  // batch 036 premise: innovation-5 "You must have the dense plating, layered mesh, or tensile absorption breakthrough modification to select "
  // batch 036 premise: innovation-5 "You must have the harmonic oscillator, metallic reactance, or phlogistonic regulator modification to select this modification."
  it('it upgrades ONLY the initial modification, not every resistance the inventor has', () => {
    // energy-barrier is a REVOLUTIONARY modification with its own 2 + half-level resistance.
    // "The resistance from your initial armor modification" — this one is untouched.
    const r = res(20, {
      initial: 'phlogistonic-regulator',
      breakthrough: 'enhanced-resistance',
      revolutionary: 'energy-barrier',
    });
    expect(r).toMatchObject({ cold: 20, fire: 20 }); // initial → full level
    // batch 036 premise: innovation-5 "you gain resistance to all energy damage (acid, cold, electricity, fire, force, negative, positive, and sonic damage) equal to 2 + half your level"
    expect(r).toMatchObject({ acid: 12, force: 12, sonic: 12, void: 12 }); // revolutionary → still 2 + half
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
