import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveSpeeds } from '../src/rules/derive';
import { statHasSituational } from '../src/rules/explain';
import type { Character, ContentDatabase } from '../src/rules/types';

/*
 * Batch 036, WG-comparison lane — the RED round's inventor-modification rows (gaps C, E and the
 * A-prime follow-through).
 *
 * Every assertion is read off a BUILT character or a derived Speed block. The overlay rows this group
 * emits are applied by the DRIVER after this file is written, so each row is PATCHED INTO A CONTENT
 * COPY IN MEMORY: the tests pin the readers and cannot flip when the rows land.
 */
const db = () => content();

function buildWith(dbase: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = dbase.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: Object.keys(dbase.ancestries)[0],
      backgroundId: Object.keys(dbase.backgrounds)[0],
      keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
      ...over,
    },
    dbase,
  );
}

/** A content copy with one field patched onto each of several classFeatures. */
function withFeatureFields(patch: Record<string, Record<string, unknown>>): ContentDatabase {
  const base = db();
  const classFeatures = { ...base.classFeatures };
  for (const [id, fields] of Object.entries(patch)) classFeatures[id] = { ...classFeatures[id], ...fields };
  return { ...base, classFeatures } as ContentDatabase;
}

/* ============================================================================================
 * gap C — the five printed modification prerequisites that had no carrier
 * ========================================================================================== */

/** The five `requiresModification` rows this group's spec emits, patched in memory. */
const withPrereqs = () =>
  withFeatureFields({
    'energy-barrier': { requiresModification: ['harmonic-oscillator', 'metallic-reactance', 'phlogistonic-regulator'] },
    'physical-protections': { requiresModification: ['dense-plating', 'layered-mesh', 'tensile-absorption'] },
    'marvelous-gears': { requiresModification: ['wonder-gears'] },
    'turret-configuration': { requiresModification: ['projectile-launcher'] },
    'miracle-gears': { requiresModification: ['marvelous-gears'] },
  });

describe('energy-barrier / physical-protections: the armour innovation prerequisites', () => {
  const armour = (dbase: ContentDatabase, mods: Record<string, string>) =>
    buildWith(dbase, 'inventor', 15, {
      subclassId: 'armor-innovation',
      inventorArmorStats: 'power-suit',
      inventorModifications: mods,
    });

  /*
   * *"You must have the harmonic oscillator, metallic reactance, or phlogistonic regulator
   * modification to select this modification."* Nothing gated the pick, so a 15th-level armour
   * inventor could take Energy Barrier's resistance-to-eight-types with no energy modification at all
   * underneath it.
   */
  // batch 036 premise: innovation-5 "You must have the harmonic oscillator, metallic reactance, or phlogistonic regulator modification to select this modification."
  it('energy-barrier is refused when none of the three named modifications is held', () => {
    const ch = armour(withPrereqs(), { initial: 'speed-boosters', revolutionary: 'energy-barrier' });
    expect(ch.inventor?.modifications.revolutionary).toBeUndefined();
  });

  /* An OR-list: any one of the three satisfies it, which is what the printed sentence says. */
  // batch 036 premise: innovation-5 "You must have the harmonic oscillator, metallic reactance, or phlogistonic regulator modification to select this modification."
  it('energy-barrier stands on any ONE of the three — phlogistonic-regulator here', () => {
    const ch = armour(withPrereqs(), { initial: 'phlogistonic-regulator', revolutionary: 'energy-barrier' });
    expect(ch.inventor?.modifications.revolutionary).toBe('energy-barrier');
  });

  /*
   * *"You must have the dense plating, layered mesh, or tensile absorption breakthrough modification
   * to select this modification."* The sibling clause on the other 15th-level armour modification —
   * same or-list shape, gated on the BREAKTHROUGH tier rather than the initial one.
   */
  // batch 036 premise: innovation-5 "You must have the dense plating, layered mesh, or tensile absorption breakthrough modification to select this modification."
  it('physical-protections needs one of the three breakthrough platings', () => {
    const p = withPrereqs();
    expect(armour(p, { revolutionary: 'physical-protections' }).inventor?.modifications.revolutionary).toBeUndefined();
    expect(
      armour(p, { breakthrough: 'layered-mesh', revolutionary: 'physical-protections' }).inventor?.modifications.revolutionary,
    ).toBe('physical-protections');
  });
});

describe('marvelous-gears / miracle-gears / turret-configuration: the construct innovation prerequisites', () => {
  const construct = (dbase: ContentDatabase, mods: Record<string, string>) =>
    buildWith(dbase, 'inventor', 15, { subclassId: 'construct-innovation', inventorModifications: mods });

  /*
   * *"You must have the marvelous gears modification to select this modification."* A single-id gate,
   * and it CHAINS — marvelous-gears is itself gated on wonder-gears — so the printed 15th-level
   * cortex upgrade costs the 1st- and 7th-level slots too.
   */
  // batch 036 premise: innovation-2 "You must have the marvelous gears modification to select this modification."
  it('miracle-gears is refused without marvelous-gears, and stands with the whole chain held', () => {
    const p = withPrereqs();
    expect(
      construct(p, { initial: 'projectile-launcher', breakthrough: 'turret-configuration', revolutionary: 'miracle-gears' })
        .inventor?.modifications.revolutionary,
    ).toBeUndefined();
    const chained = construct(p, { initial: 'wonder-gears', breakthrough: 'marvelous-gears', revolutionary: 'miracle-gears' });
    expect(chained.inventor?.modifications.breakthrough).toBe('marvelous-gears');
    expect(chained.inventor?.modifications.revolutionary).toBe('miracle-gears');
  });

  /*
   * *"You must have the wonder gears modification to select this modification."* The middle link on
   * its own: marvelous-gears without wonder-gears underneath it is not a modification this character
   * has, however the revolutionary slot is spent.
   */
  // batch 036 premise: innovation-2 "You must have the wonder gears modification to select this modification."
  it('marvelous-gears is refused without wonder-gears', () => {
    expect(construct(withPrereqs(), { breakthrough: 'marvelous-gears' }).inventor?.modifications.breakthrough).toBeUndefined();
  });

  /*
   * *"You must have the projectile launcher modification to select this modification."* The turret is
   * a configuration OF the launcher — its printed benefit is a bigger damage die and a longer range
   * increment "from its projectile launcher", which is nothing at all without one.
   */
  // batch 036 premise: innovation-2 "You must have the projectile launcher modification to select this modification."
  it('turret-configuration is refused without projectile-launcher and stands with it', () => {
    const p = withPrereqs();
    expect(construct(p, { initial: 'wonder-gears', breakthrough: 'turret-configuration' }).inventor?.modifications.breakthrough).toBeUndefined();
    expect(
      construct(p, { initial: 'projectile-launcher', breakthrough: 'turret-configuration' }).inventor?.modifications.breakthrough,
    ).toBe('turret-configuration');
  });
});

/* ============================================================================================
 * gap E + gap A-prime — the Overdrive Speed ladder, and the star that must go with it
 * ========================================================================================== */

describe('hyper-boosters and speed-boosters: the Overdrive Speed ladder pays both printed numbers', () => {
  /** The two `whileActive` rows this group's spec emits — speed-boosters gains one, hyper-boosters'
   *  existing clause is recalibrated from 10 to 5 because deriveSpeeds ADDS the pair. */
  const withLadder = () =>
    withFeatureFields({
      'speed-boosters': { whileActive: [{ state: 'overdrive', speeds: { land: 5 } }] },
      'hyper-boosters': { whileActive: [{ state: 'overdrive', speeds: { land: 5 } }] },
    });

  const inventor = (dbase: ContentDatabase, mods: Record<string, string>) =>
    buildWith(dbase, 'inventor', 7, {
      subclassId: 'armor-innovation',
      inventorArmorStats: 'power-suit',
      inventorModifications: mods,
    });

  /** Land Speed with Overdrive off, then on, for the given modification set. */
  const speeds = (dbase: ContentDatabase, mods: Record<string, string>) => {
    const ch = inventor(dbase, mods);
    const off = deriveSpeeds(ch, dbase).land;
    const on = deriveSpeeds({ ...ch, classResources: { ...ch.classResources, overdrive: 1 } }, dbase).land;
    return { ch, off, on };
  };

  /*
   * *"You gain a +5-foot status bonus to your Speed, which increases to a +10-foot status bonus when
   * under the effects of Overdrive."* The standing +5 landed earlier in this batch as
   * `landSpeedBonus`; the Overdrive step was carried by nothing, so a speed-boosters-only inventor
   * read +5 whether the toggle was on or off.
   */
  // batch 036: hyper-boosters#overdrive
  it('a speed-boosters-only inventor walks +5, and +10 with Overdrive on', () => {
    const p = withLadder();
    const bare = deriveSpeeds(inventor(p, {}), p).land;
    const { ch, off, on } = speeds(p, { initial: 'speed-boosters' });
    expect(ch.inventor?.modifications.initial).toBe('speed-boosters');
    expect(off).toBe(bare + 5);
    expect(on).toBe(bare + 10);
  });

  /*
   * …and the pair still pays hyper-boosters' printed *"+10-foot status bonus to your Speed, which
   * increases to a +20-foot status bonus when you're in Overdrive"* — NOT +25. This is the whole
   * reason the hyper-boosters clause is recalibrated to 5 alongside the new speed-boosters row: the
   * prerequisite makes the pair inseparable, so every hyper-boosters number is a delta over the
   * speed-boosters number underneath it, exactly as its `landSpeedBonus` already is.
   */
  // batch 036: hyper-boosters#overdrive
  it('speed-boosters + hyper-boosters walks +10, and +20 with Overdrive on', () => {
    const p = withLadder();
    const bare = deriveSpeeds(inventor(p, {}), p).land;
    const { off, on } = speeds(p, { initial: 'speed-boosters', breakthrough: 'hyper-boosters' });
    expect(off).toBe(bare + 10);
    expect(on).toBe(bare + 20);
  });

  /*
   * gap A-prime's follow-through. The closer suppressed the speed-boosters star only for a character
   * holding BOTH records; with the row above, the number is on the sheet for the speed-boosters-ONLY
   * inventor too, so the star is a duplicate of a live value for everyone and the entry is gone.
   * Read off a BUILT character through the same helper the sheet uses to decide whether to print the
   * asterisk.
   */
  // batch 036: hyper-boosters#overdrive
  it('the speed-boosters-only inventor gets no star on the Speed row', () => {
    const shipped = db();
    const ch = inventor(shipped, { initial: 'speed-boosters' });
    expect(ch.inventor?.modifications.initial).toBe('speed-boosters');
    expect(statHasSituational(ch, { kind: 'speed' }, shipped)).toBe(false);
  });

  /*
   * …and the star the removal must NOT take with it. hyper-boosters keeps one entry, for the single
   * rung no number carries: innovation-5's *"If you're legendary in Crafting, it instead increases to
   * a +30-foot status bonus when you're in Overdrive"* (WhileActiveClause has no skill-rank gate, and
   * WG's own row encodes +10/+20 with no legendary branch — hyper-boosters#wg-legendary).
   * This is also what SITUATIONAL_SUPERSEDES['hyper-boosters'] now means: the hop is inert in the star
   * lane because there is no speed-boosters entry left to silence, and the pair's one remaining star
   * is hyper-boosters' own.
   */
  // batch 036: hyper-boosters#overdrive
  it('the pair still stars the legendary-Crafting rung, which no number carries', () => {
    const shipped = db();
    const pair = inventor(shipped, { initial: 'speed-boosters', breakthrough: 'hyper-boosters' });
    expect(pair.inventor?.modifications.breakthrough).toBe('hyper-boosters');
    expect(statHasSituational(pair, { kind: 'speed' }, shipped)).toBe(true);
  });
});
