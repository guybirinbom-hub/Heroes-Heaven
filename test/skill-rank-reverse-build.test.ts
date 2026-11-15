import { describe, expect, it } from 'vitest';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { importCharacter } from '../src/data/transfer';
import type { Character, ProficiencyKey } from '../src/rules/types';
import { content } from './_content';
import { SKILL_ORDER_CASES, observe, unresolvedIds, type SkillOrderCase, type SkillOrderExpect } from './fixtures/skill-order-cases';

/**
 * THE REVERSE BUILD PLACES A REBUILT INCREASE AFTER THE TRAINING IT BUILDS ON (plan WP0 step 3, "Reverse
 * build"; findings 8 and fix step 7). A BUILD-LESS character — built, then its `skillIncreases` deleted and a
 * rank set the way an imported sheet arrives — goes through `deriveBuildFromCharacter` (the Wanderer's Guide
 * import's reverse build) and is rebuilt. The rebuilt rank and the rebuilt increases are compared with print.
 * RB1 flips when the engine works level by level (WP3); RB2 when the reverse build reads the history (WP8).
 * Same ratchet and premise rules as test/skill-rank-level-order.test.ts (D17). Synthetic characters only.
 */

const db = content();
type Group = keyof SkillOrderExpect;
const J = (v: unknown) => JSON.stringify(v);
const RB = SKILL_ORDER_CASES.filter((c) => c.reverse);

/** Build, strip the increases, set the target ranks, reverse-build, rebuild. */
function rebuilt(c: SkillOrderCase): { derived: BuildState; character: Character } {
  const ch = buildCharacter(c.build, db);
  const target = { ...ch, proficiencies: { ...ch.proficiencies, skills: { ...ch.proficiencies.skills, ...c.reverse!.set } } } as Character;
  delete (target as { skillIncreases?: unknown }).skillIncreases;
  const derived = deriveBuildFromCharacter(target, db);
  return { derived, character: buildCharacter(derived, db) };
}
const cache = new Map<string, ReturnType<typeof rebuilt>>();
const of = (c: SkillOrderCase) => {
  let r = cache.get(c.id);
  if (!r) cache.set(c.id, (r = rebuilt(c)));
  return r;
};

describe('the reverse build of a build-less character (RB)', () => {
  it('the RB cases exist', () => {
    expect(RB.map((c) => c.id)).toEqual(['RB1', 'RB2']);
  });
  for (const c of RB) {
    for (const g of ['skills', 'increases'] as Group[]) {
      if (c.expect[g] === undefined) continue;
      const fails = !!c.flips && J(c.today?.[g]) !== J(c.expect[g]);
      (fails ? it.fails : it)(`${c.id} ${g}: ${c.title}${fails ? ` [fails until ${c.flips}]` : ''}`, () => {
        const { derived, character } = of(c);
        expect(observe({ [g]: c.expect[g] } as SkillOrderExpect, character, derived, db)[g], `${c.id} ${g} (${c.print})`).toEqual(c.expect[g]);
      });
    }
    if (c.flips)
      it(`${c.id}: premise — ids resolve, the reverse build runs, today's values hold`, () => {
        expect(unresolvedIds(c, db)).toEqual([]);
        expect(() => of(c)).not.toThrow();
        const { derived, character } = of(c);
        expect(observe(c.today!, character, derived, db)).toEqual(c.today);
      });
  }
});

/* ---------------------------------------------------------------------------------------------------- */
/* skill-order WP8: round trips, lanes, the Dual Class union and the import warning (plan WP8, section 2) */
/* ---------------------------------------------------------------------------------------------------- */

/** Every trained skill, sorted, so two characters compare as the sheet reads them. */
const trainedSkills = (ch: Character): Record<string, string> =>
  Object.fromEntries(Object.entries(ch.proficiencies.skills).filter(([, r]) => r !== 'untrained').sort(([a], [b]) => a.localeCompare(b)));
/** `key → [original, rebuilt]` for every skill the round trip changed. */
function skillDiff(a: Character, b: Character): Record<string, [string, string]> {
  const A = trainedSkills(a);
  const B = trainedSkills(b);
  const out: Record<string, [string, string]> = {};
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) if ((A[k] ?? 'untrained') !== (B[k] ?? 'untrained')) out[k] = [A[k] ?? 'untrained', B[k] ?? 'untrained'];
  return out;
}

/**
 * The round trip's one known loss that is NOT about skill order, as an EXACT list (a fix turns it red until the
 * entry goes): the reverse build reads no `effectChoices` answer back, so Ancient Ash's own skill pick (Stealth)
 * is lost, the heritage trains its first option (Acrobatics, expert at 5th: heritage-207) and Stealth comes back
 * as a class pick instead. Measured identical on the WP7 engine (d4d4b02), native and build-less alike; Stealth
 * itself — the skill the order decides — comes back master. Not WP8's to fix: carrying the answer needs a new
 * Character field, which moves every parity hash (plan D18); state.md deviation 94.
 */
const ROUND_TRIP_KNOWN: Record<string, Record<string, [string, string]>> = {
  AA7: { acrobatics: ['trained', 'expert'] },
};
const ROUND_TRIP = ['K1', 'K2', 'B2', 'S1', 'AA7', 'DC1', 'RB2'];

describe('skill-order WP8: the reverse build round-trips the skill-order cases', () => {
  for (const id of ROUND_TRIP) {
    const c = SKILL_ORDER_CASES.find((x) => x.id === id)!;
    it(`${id} build-less (no stored increases): the rebuilt skills equal the original's`, () => {
      const ch = buildCharacter(c.build, db);
      const target = { ...ch } as Character;
      delete (target as { skillIncreases?: unknown }).skillIncreases;
      const again = buildCharacter(deriveBuildFromCharacter(target, db), db);
      expect(skillDiff(ch, again), `${id} (${c.print})`).toEqual(ROUND_TRIP_KNOWN[id] ?? {});
    });
    it(`${id} native: the rebuilt skills equal the original's (unchanged)`, () => {
      const ch = buildCharacter(c.build, db);
      const again = buildCharacter(deriveBuildFromCharacter(ch, db), db);
      expect(skillDiff(ch, again), id).toEqual(ROUND_TRIP_KNOWN[id] ?? {});
    });
  }
});

describe('skill-order WP8: increases go back to their lane; the Dual Class union (D15, D16)', () => {
  const DC = { dualClass: true };
  const mkb = (o: Partial<BuildState>): BuildState =>
    ({ ...emptyBuild(), name: 't', keyAbility: 'cha', backgroundId: 'acolyte', classSkills: [], ancestryId: 'human', heritageId: 'versatile-human', ...o }) as BuildState;
  /* Thaumaturge (1st) + swashbuckler (2nd, Braggart): the 3rd-level extra increase is the swashbuckler's
   * (Stylish Tricks, class-feature-1016: "At 3rd level, 7th level, and 15th level, you gain an additional skill
   * increase you can apply only to Acrobatics or the skill from your swashbuckler's style"); the first class
   * grants none at 3rd. */
  const thaumSwash = mkb({ level: 3, classId: 'thaumaturge', classId2: 'swashbuckler', subclassId2: 'braggart', variantRules: DC, skillIncreases: { 3: 'athletics' }, bonusSkillIncreases: { 3: 'intimidation' } });

  it("a second class's bonus increase goes back to the bonus store (its lane), and the rebuild keeps it", () => {
    const ch = buildCharacter(thaumSwash, db);
    expect(ch.skillIncreases, 'premise: the engine tags the bonus lane').toContainEqual({ level: 3, skill: 'intimidation', lane: 'bonus' });
    const back = deriveBuildFromCharacter(ch, db);
    expect(back.skillIncreases[3]).toBe('athletics');
    expect(back.bonusSkillIncreases?.[3]).toBe('intimidation');
    expect(back.backgroundSkillIncreases?.[3]).toBeUndefined();
    expect(skillDiff(ch, buildCharacter(back, db))).toEqual({});
  });

  it('an increase without a lane (an import) is routed by the UNION of both classes\' bonus levels', () => {
    const ch = buildCharacter(thaumSwash, db);
    const bare = { ...ch, skillIncreases: (ch.skillIncreases ?? []).map(({ level, skill }) => ({ level, skill })) } as Character;
    const back = deriveBuildFromCharacter(bare, db);
    expect(back.skillIncreases[3]).toBe('athletics');
    expect(back.bonusSkillIncreases?.[3], 'the swashbuckler, not the thaumaturge, grants the 3rd-level extra increase').toBe('intimidation');
    expect(skillDiff(ch, buildCharacter(back, db))).toEqual({});
  });

  it('a background-lane increase goes back to the background store even where the main slot is empty', () => {
    const ch = buildCharacter(mkb({ level: 3, classId: 'fighter', keyAbility: 'str' }), db);
    const tagged = { ...ch, skillIncreases: [{ level: 3, skill: 'lore:warfare' as ProficiencyKey, lane: 'background' as const }] } as Character;
    const back = deriveBuildFromCharacter(tagged, db);
    expect(back.backgroundSkillIncreases?.[3]).toBe('lore:warfare');
    expect(back.skillIncreases[3], 'not the class increase of 3rd').toBeUndefined();
  });

  it('a synthesized increase lands on the union main levels: DC1 build-less spends Acrobatics at 2nd (the rogue\'s level)', () => {
    const c = SKILL_ORDER_CASES.find((x) => x.id === 'DC1')!;
    const ch = buildCharacter(c.build, db);
    const target = { ...ch } as Character;
    delete (target as { skillIncreases?: unknown }).skillIncreases;
    const back = deriveBuildFromCharacter(target, db);
    // skill-order WP8: DC1 — rules-1331; the WP7 engine placed it at 3rd (the fighter's first increase level).
    expect(back.skillIncreases).toEqual({ 2: 'acrobatics' });
  });
});

describe('skill-order WP8: the import names a rank the rebuilt character cannot reach', () => {
  /** A synthetic Wanderer's Guide v4 file: a 3rd-level human fighter (Guard) with Athletics at `athletics`. */
  const wgFile = (athletics: number) =>
    JSON.stringify({
      version: 4,
      character: {
        name: 'Test Fighter',
        level: 3,
        experience: 0,
        details: { ancestry: { name: 'Human' }, background: { name: 'Guard' }, class: { name: 'Fighter' } },
        inventory: { coins: { gp: 5 }, items: [] },
      },
      content: {
        attributes: { ATTRIBUTE_STR: { value: 4 }, ATTRIBUTE_DEX: { value: 2 }, ATTRIBUTE_CON: { value: 2 }, ATTRIBUTE_INT: { value: 0 }, ATTRIBUTE_WIS: { value: 1 }, ATTRIBUTE_CHA: { value: 0 } },
        proficiencies: {
          SKILL_ATHLETICS: { total: '+11', parts: { profValue: athletics } },
          SKILL_INTIMIDATION: { total: '+6', parts: { profValue: 2 } },
        },
        feats_features: { classFeats: [], ancestryFeats: [], generalAndSkillFeats: [], otherFeats: [], heritages: [], classFeatures: [] },
        languages: ['COMMON'],
        spells: { cantrips: [], normal: [] },
      },
    });
  const reachWarnings = (w: string[]) => w.filter((s) => / the file has .*; the rebuilt character has /.test(s));

  it('Athletics master at 3rd level (no increase can give master before 7th): exactly one warning, naming it', () => {
    const { report } = importCharacter(wgFile(6), db);
    expect(reachWarnings(report.warnings)).toEqual(['Athletics: the file has Master; the rebuilt character has Expert.']);
  });
  it('control: Athletics expert at 3rd level is reached, so no such warning', () => {
    const { report } = importCharacter(wgFile(4), db);
    expect(reachWarnings(report.warnings)).toEqual([]);
  });
});
