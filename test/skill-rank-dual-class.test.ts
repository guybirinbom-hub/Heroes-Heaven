// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import {
  buildCharacter,
  classSkillIncreaseLevels,
  emptyBuild,
  levelChoices,
  levelGrants,
  restrictedSkillIncreaseAllowed,
  restrictedSkillIncreaseLanes,
  skillOrderLegacyOf,
  type BuildState,
} from '../src/rules/build';
import { SKILL_ORDER_CASES } from './fixtures/skill-order-cases';

/**
 * DUAL CLASS SKILL INCREASES (skill order WP6; plan work/skill-rank-level-by-level/plan.md D15 and section 4;
 * guard G9). GM Core Dual Class, rules-1329: "add everything from each class except Hit Points and starting
 * skills: … skill increases for rogues"; rules-1331: "a dual-class rogue/ranger still gets the extra skill feat
 * and skill increase at levels where the other class doesn't provide them". So the ordinary increase comes at
 * the UNION of both classes' levels (one per level), and each class's extra (bonus) increase comes at that
 * class's levels, on that class's terms.
 *
 * What is pinned here:
 *  - G9: no feat slot is added, removed or reordered for any of the six pairings below, levels 1-20 (a stored
 *    pick is keyed `<level>:<kind>:<index of featSlots>`, so a moved slot would re-home every saved feat). The
 *    lists are literals measured on the WP0 engine (3aa35e9, work/.wp0tree-probe), never recomputed here;
 *  - the increase levels `levelGrants` reports (the Builder's pages and the pending counter);
 *  - the engine's print lanes and the bonus restriction by owning class, and the live side (the Builder
 *    notice's "before", plan D19) still today's first-class lanes;
 *  - the Builder's bonus picker greys by the class that owns the level.
 * Synthetic characters only.
 */

const db = content();
const DC = { dualClass: true };
const mk = (o: Partial<BuildState>): BuildState =>
  ({ ...emptyBuild(), name: 't', keyAbility: 'cha', backgroundId: 'acolyte', classSkills: [], ancestryId: 'human', heritageId: 'versatile-human', ...o }) as BuildState;
const ranks = (b: BuildState) => buildCharacter(b, db).proficiencies.skills;

/* Measured on the WP0 engine (scratchpad wp6/slots.ts run in work/.wp0tree-probe): featSlots per level 1-20. */
const SLOTS_TODAY: Record<string, string[]> = {
  'fighter+rogue': ['ancestry,class,class', 'class,class,skill', 'general', 'class,class,skill', 'ancestry', 'class,class,skill', 'general', 'class,class,skill', 'ancestry,bonus', 'class,class,skill', 'general', 'class,class,skill', 'ancestry', 'class,class,skill', 'general,bonus', 'class,class,skill', 'ancestry', 'class,class,skill', 'general', 'class,class,skill'],
  'rogue+fighter': ['ancestry,class,class,skill', 'class,class,skill', 'skill,general', 'class,class,skill', 'ancestry,skill', 'class,class,skill', 'skill,general', 'class,class,skill', 'ancestry,skill,bonus', 'class,class,skill', 'skill,general', 'class,class,skill', 'ancestry,skill', 'class,class,skill', 'skill,general,bonus', 'class,class,skill', 'ancestry,skill', 'class,class,skill', 'skill,general', 'class,class,skill'],
  'swashbuckler+thaumaturge': ['ancestry,class,class', 'class,class,skill', 'skill,general', 'class,class,skill', 'ancestry', 'class,class,skill', 'skill,general', 'class,class,skill', 'ancestry', 'class,class,skill', 'general', 'class,class,skill', 'ancestry', 'class,class,skill', 'skill,general', 'class,class,skill', 'ancestry', 'class,class,skill', 'general', 'class,class,skill'],
  'thaumaturge+swashbuckler': ['ancestry,class,class', 'class,class,skill', 'general', 'class,class,skill', 'ancestry', 'class,class,skill', 'general', 'class,class,skill', 'ancestry', 'class,class,skill', 'general', 'class,class,skill', 'ancestry', 'class,class,skill', 'general', 'class,class,skill', 'ancestry', 'class,class,skill', 'general', 'class,class,skill'],
  'fighter+-': ['ancestry,class', 'class,skill', 'general', 'class,skill', 'ancestry', 'class,skill', 'general', 'class,skill', 'ancestry,bonus', 'class,skill', 'general', 'class,skill', 'ancestry', 'class,skill', 'general,bonus', 'class,skill', 'ancestry', 'class,skill', 'general', 'class,skill'],
  'rogue+-': ['ancestry,class,skill', 'class,skill', 'skill,general', 'class,skill', 'ancestry,skill', 'class,skill', 'skill,general', 'class,skill', 'ancestry,skill', 'class,skill', 'skill,general', 'class,skill', 'ancestry,skill', 'class,skill', 'skill,general', 'class,skill', 'ancestry,skill', 'class,skill', 'skill,general', 'class,skill'],
};
const EVERY = Array.from({ length: 19 }, (_, i) => i + 2); // 2..20
const ODD = [3, 5, 7, 9, 11, 13, 15, 17, 19];
/* The print increase levels: main = the union, bonus = each class's own (swashbuckler 3/7/15, thaumaturge 9/17). */
const INCREASES: Record<string, { main: number[]; bonus: number[] }> = {
  'fighter+rogue': { main: EVERY, bonus: [] },
  'rogue+fighter': { main: EVERY, bonus: [] },
  'swashbuckler+thaumaturge': { main: ODD, bonus: [3, 7, 9, 15, 17] },
  'thaumaturge+swashbuckler': { main: ODD, bonus: [3, 7, 9, 15, 17] },
  'fighter+-': { main: ODD, bonus: [] },
  'rogue+-': { main: EVERY, bonus: [] },
};
const grantsOf = (pair: string, level: number) => {
  const [a, b] = pair.split('+');
  return levelGrants(level, a, db, null, b === '-' ? undefined : DC, b === '-' ? null : b, null, false, []);
};

describe('G9: Dual Class increases add no feat slot and move none', () => {
  for (const pair of Object.keys(SLOTS_TODAY)) {
    it(`${pair}: every featPicks slot key of levels 1-20 is unchanged`, () => {
      const keys = (lists: string[]) => lists.flatMap((s, i) => (s ? s.split(',') : []).map((cat, n) => `${i + 1}:${cat}:${n}`));
      const now = Array.from({ length: 20 }, (_, i) => grantsOf(pair, i + 1).featSlots.join(','));
      expect(keys(now)).toEqual(keys(SLOTS_TODAY[pair]));
    });
    it(`${pair}: an increase at the union of both classes' levels, a bonus increase at each class's own`, () => {
      const main: number[] = [];
      const bonus: number[] = [];
      for (let l = 1; l <= 20; l++) {
        const g = grantsOf(pair, l);
        if (g.skillIncrease) main.push(l);
        if (g.bonusSkillIncrease) bonus.push(l);
      }
      expect({ main, bonus }).toEqual(INCREASES[pair]);
    });
  }
  it('classSkillIncreaseLevels: one class gives its own lists unchanged; a pair gives the sorted union', () => {
    const c = db.classes;
    expect(classSkillIncreaseLevels(c.fighter, undefined)).toEqual({ main: ODD, bonus: [] });
    expect(classSkillIncreaseLevels(c.swashbuckler, undefined)).toEqual({ main: ODD, bonus: [3, 7, 15] });
    expect(classSkillIncreaseLevels(c.fighter, c.rogue).main).toEqual(EVERY);
    expect(classSkillIncreaseLevels(c.thaumaturge, c.swashbuckler).bonus).toEqual([3, 7, 9, 15, 17]);
  });
});

describe("D15: the print lanes give each class's increases; the live side stays the first class's", () => {
  const caseOf = (id: string) => SKILL_ORDER_CASES.find((c) => c.id === id)!.build;
  it("DC1 (fighter + rogue): the 2nd- and 4th-level increases count; the live side keeps the fighter's levels", () => {
    const c = buildCharacter(caseOf('DC1'), db);
    expect(c.skillIncreases.map((s) => `${s.level}:${s.skill}`)).toEqual(['2:acrobatics', '3:thievery', '4:deception']);
    const steps = (c.skillHistory?.steps ?? []).filter((s) => s.phase === 'increase').map((s) => `${s.level} ${s.source} ${s.key} ${s.from}>${s.to}`);
    expect(steps).toEqual(['2 increase:2 acrobatics trained>expert', '3 increase:3 thievery untrained>trained', '4 increase:4 deception untrained>trained']);
    const legacy = skillOrderLegacyOf(c)!;
    expect(legacy.skillIncreases.map((s) => `${s.level}:${s.skill}`)).toEqual(['3:thievery']);
    expect(legacy.skills.acrobatics).toBe('trained');
  });
  it('DC1n: the empty 2nd- and 4th-level slots are pending choices (the pending counter reads levelGrants)', () => {
    const pending = levelChoices(caseOf('DC1n'), db).map((m) => m.label).filter((l) => l.endsWith('skill increase'));
    expect(pending).toHaveLength(3); // 2nd, 3rd, 4th
  });
  it("thaumaturge + swashbuckler: the 3rd-level bonus increase is Stylish Tricks', narrowed to Acrobatics or the style's skill", () => {
    const b = (skill: string) => mk({ level: 3, classId: 'thaumaturge', classId2: 'swashbuckler', subclassId2: 'braggart', variantRules: DC, bonusSkillIncreases: { 3: skill } });
    expect(ranks(b('acrobatics')).acrobatics).toBe('expert');
    expect(ranks(b('intimidation')).intimidation, "the style's skill (Braggart: Intimidation), through subclassId2").toBe('expert');
    expect(ranks(b('medicine')).medicine ?? 'untrained', 'dropped: Stylish Tricks forbids it').toBe('untrained');
    // The live side never had a bonus increase at 3rd for a thaumaturge first.
    expect(skillOrderLegacyOf(buildCharacter(b('acrobatics'), db))!.skills.acrobatics).toBe('trained');
  });
  it("swashbuckler + thaumaturge: the 9th-level bonus increase is the thaumaturge's, on its terms", () => {
    const b = (skill: string) => mk({ level: 9, classId: 'swashbuckler', subclassId: 'braggart', classId2: 'thaumaturge', variantRules: DC, bonusSkillIncreases: { 9: skill } });
    expect(ranks(b('arcana')).arcana).toBe('expert');
    expect(ranks(b('acrobatics')).acrobatics, 'dropped: Thaumaturgic Expertise forbids it').toBe('trained');
  });
  it('restrictedSkillIncreaseAllowed: by level, the owning class; without one, the first class (the live path, unchanged)', () => {
    const b = mk({ classId: 'swashbuckler', subclassId: 'braggart', classId2: 'thaumaturge', variantRules: DC });
    expect([...(restrictedSkillIncreaseAllowed(b, db, 3)?.skills ?? [])].sort()).toEqual(['acrobatics', 'intimidation']);
    expect([...(restrictedSkillIncreaseAllowed(b, db, 9)?.skills ?? [])].sort()).toEqual(['arcana', 'nature', 'occultism', 'religion']);
    expect(restrictedSkillIncreaseAllowed(b, db, 5)).toBeNull();
    expect(restrictedSkillIncreaseAllowed(b, db)?.levels).toEqual([3, 7, 15]);
    expect(restrictedSkillIncreaseLanes(b, db).map((l) => l.classId)).toEqual(['swashbuckler', 'thaumaturge']);
    // Not Dual Class: the second class is ignored, as everywhere.
    expect(restrictedSkillIncreaseLanes({ ...b, variantRules: {} }, db).map((l) => l.classId)).toEqual(['swashbuckler']);
  });
});

describe("the Builder's increase pickers follow both classes (D15)", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    for (const n of [...document.body.children]) n.remove();
  });
  const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
  const open = (b: BuildState, page: number) => {
    const r = renderDom(createElement(Builder, { content: db, initial: b, onCancel: () => undefined, onCreate: () => undefined }));
    cleanups.push(r.stop);
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === String(page)) ?? null);
    return r;
  };
  const rows = () => [...document.querySelectorAll('.picker-overlay .picker-item')] as HTMLButtonElement[];
  const row = (skill: string) => rows().find((x) => (x.querySelector('.picker-name')?.textContent ?? '').trim().startsWith(`${skill} (`));
  const openPicker = async (r: ReturnType<typeof open>, title: string) => {
    const ctl = r.host.querySelector(`[data-ctl-title="${title}"]`);
    expect(ctl, `a "${title}" control`).toBeTruthy();
    r.click(ctl!.querySelector('.ss-replace') ?? ctl);
    await flush();
  };

  it("fighter + rogue: the 2nd-level page has a skill increase (the rogue's)", () => {
    const r = open(SKILL_ORDER_CASES.find((c) => c.id === 'DC1n')!.build, 2);
    expect(r.host.querySelector('[data-ctl-title="Skill increase"]')).toBeTruthy();
  });
  it("swashbuckler + thaumaturge, 9th level: the bonus increase is greyed by the thaumaturge's terms", async () => {
    const r = open(mk({ level: 9, classId: 'swashbuckler', subclassId: 'braggart', classId2: 'thaumaturge', variantRules: DC }), 9);
    await openPicker(r, 'Bonus skill increase');
    expect(row('Arcana')?.disabled, 'Arcana offered').toBe(false);
    expect(row('Acrobatics')?.disabled, 'Acrobatics greyed').toBe(true);
    expect(row('Acrobatics')?.textContent ?? '').toContain('Thaumaturgic Expertise');
  });
  it("thaumaturge + swashbuckler, 3rd level: the bonus increase is the swashbuckler's (Acrobatics or the style's skill)", async () => {
    const r = open(mk({ level: 3, classId: 'thaumaturge', classId2: 'swashbuckler', subclassId2: 'braggart', variantRules: DC }), 3);
    await openPicker(r, 'Bonus skill increase');
    expect(row('Acrobatics')?.disabled, 'Acrobatics offered').toBe(false);
    expect(row('Medicine')?.disabled, 'Medicine greyed').toBe(true);
    expect(row('Medicine')?.textContent ?? '').toContain('Stylish Tricks');
  });
});
