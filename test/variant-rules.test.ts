import { describe, it, expect } from 'vitest';
import { build, content, firstSubclass } from './_content';
import { levelGrants, deriveBuildFromCharacter, buildCharacter, attributeBoostLevels, attributeBoostCount } from '../src/rules/build';
import { profBonus, deriveClassDc, derivePerception, deriveSave, deriveAc, deriveStrikes, deriveMaxHp, deriveSkill } from '../src/rules/derive';
import { abpAttack, abpDefense, abpSave, abpPerception, abpStrikingDice, abpSkillBudget } from '../src/rules/abp';
import type { VariantRules } from '../src/rules/types';

const db = () => content();
const ancestrySlots = (variant: VariantRules | undefined) => {
  let n = 0;
  for (let lvl = 1; lvl <= 20; lvl++) n += levelGrants(lvl, 'fighter', db(), null, variant).featSlots.filter((s) => s === 'ancestry').length;
  return n;
};

describe('variant rules — infrastructure', () => {
  it('variantRules round-trips through buildCharacter → deriveBuildFromCharacter', () => {
    const ch = build('fighter', 5, { keyAbility: 'str', variantRules: { freeArchetype: true, ancestryParagon: true, abp: true } });
    expect(ch.variantRules?.freeArchetype).toBe(true);
    const rt = deriveBuildFromCharacter(ch, db());
    expect(rt.variantRules?.freeArchetype).toBe(true);
    expect(rt.variantRules?.ancestryParagon).toBe(true);
    expect(rt.variantRules?.abp).toBe(true);
  });
});

describe('variant rules — Free Archetype', () => {
  it('adds an archetype-only class feat slot at every even level (2–20), none at odd', () => {
    for (let lvl = 1; lvl <= 20; lvl++) {
      const slots = levelGrants(lvl, 'fighter', db(), null, { freeArchetype: true }).featSlots;
      if (lvl >= 2 && lvl % 2 === 0) expect(slots, `level ${lvl}`).toContain('archetype');
      else expect(slots, `level ${lvl}`).not.toContain('archetype');
    }
  });
  it('adds no archetype slot when the variant is off', () => {
    for (let lvl = 1; lvl <= 20; lvl++) expect(levelGrants(lvl, 'fighter', db(), null).featSlots).not.toContain('archetype');
  });
});

describe('variant rules — Gradual Attribute Boosts', () => {
  it('schedule + count helpers', () => {
    expect(attributeBoostLevels({ gradualBoosts: true })).toEqual([2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20]);
    expect(attributeBoostLevels(undefined)).toEqual([5, 10, 15, 20]);
    expect(attributeBoostCount({ gradualBoosts: true })).toBe(1);
    expect(attributeBoostCount(undefined)).toBe(4);
    // levelGrants flags a boost at the gradual levels (and not at 6/11/16/1).
    expect(levelGrants(2, 'fighter', db(), null, { gradualBoosts: true }).attributeBoosts).toBe(true);
    expect(levelGrants(6, 'fighter', db(), null, { gradualBoosts: true }).attributeBoosts).toBe(false);
    expect(levelGrants(5, 'fighter', db(), null).attributeBoosts).toBe(true);
    expect(levelGrants(2, 'fighter', db(), null).attributeBoosts).toBe(false);
  });

  it('grants a boost as early as level 2 (standard grants none until 5)', () => {
    const std = build('fighter', 2, { keyAbility: 'str' });
    const grad = build('fighter', 2, { keyAbility: 'str', variantRules: { gradualBoosts: true }, attributeBoosts: { 2: ['dex'] } });
    expect(grad.abilities.dex).toBe(std.abilities.dex + 2);
  });

  it('reaches the same final L20 scores as standard given equivalent total boosts', () => {
    const four = ['con', 'dex', 'wis', 'cha'] as const;
    const std = build('fighter', 20, { keyAbility: 'str', attributeBoosts: { 5: [...four], 10: [...four], 15: [...four], 20: [...four] } });
    const grad = build('fighter', 20, {
      keyAbility: 'str',
      variantRules: { gradualBoosts: true },
      // one of con/dex/wis/cha per level, four-different within each set (2-5, 7-10, 12-15, 17-20).
      attributeBoosts: {
        2: ['con'], 3: ['dex'], 4: ['wis'], 5: ['cha'],
        7: ['con'], 8: ['dex'], 9: ['wis'], 10: ['cha'],
        12: ['con'], 13: ['dex'], 14: ['wis'], 15: ['cha'],
        17: ['con'], 18: ['dex'], 19: ['wis'], 20: ['cha'],
      },
    });
    for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) expect(grad.abilities[a], a).toBe(std.abilities[a]);
  });
});

describe('variant rules — Proficiency Without Level', () => {
  it('profBonus drops level and makes untrained a −2 penalty', () => {
    expect(profBonus('trained', 10, true)).toBe(2);
    expect(profBonus('expert', 10, true)).toBe(4);
    expect(profBonus('legendary', 20, true)).toBe(8);
    expect(profBonus('untrained', 10, true)).toBe(-2);
    // standard (level added) unchanged
    expect(profBonus('trained', 10, false)).toBe(12);
    expect(profBonus('untrained', 10, false)).toBe(0);
  });

  it('removes level from class DC, Perception, and saves', () => {
    const std = build('fighter', 10, { keyAbility: 'str' });
    const p = build('fighter', 10, { keyAbility: 'str', variantRules: { proficiencyWithoutLevel: true } });
    expect(deriveClassDc(std).dc - deriveClassDc(p).dc).toBe(10);
    expect(derivePerception(std).modifier - derivePerception(p).modifier).toBe(10);
    expect(deriveSave(std, 'fortitude').modifier - deriveSave(p, 'fortitude').modifier).toBe(10);
  });
});

describe('variant rules — Automatic Bonus Progression', () => {
  it('level tables', () => {
    expect([abpAttack(1), abpAttack(2), abpAttack(10), abpAttack(16)]).toEqual([0, 1, 2, 3]);
    expect([abpDefense(4), abpDefense(5), abpDefense(11), abpDefense(18)]).toEqual([0, 1, 2, 3]);
    expect([abpSave(7), abpSave(8), abpSave(14), abpSave(20)]).toEqual([0, 1, 2, 3]);
    expect([abpPerception(6), abpPerception(7), abpPerception(13), abpPerception(19)]).toEqual([0, 1, 2, 3]);
    expect([abpStrikingDice(3), abpStrikingDice(4), abpStrikingDice(12), abpStrikingDice(19)]).toEqual([0, 1, 2, 3]);
  });

  it('adds defense/save/perception potency to derived stats by level', () => {
    const on = (lvl: number) => build('fighter', lvl, { keyAbility: 'str', variantRules: { abp: true } });
    const off = (lvl: number) => build('fighter', lvl, { keyAbility: 'str' });
    expect(deriveAc(on(5), db()).value - deriveAc(off(5), db()).value).toBe(1);
    expect(deriveAc(on(11), db()).value - deriveAc(off(11), db()).value).toBe(2);
    expect(deriveSave(on(8), 'fortitude').modifier - deriveSave(off(8), 'fortitude').modifier).toBe(1);
    expect(derivePerception(on(7)).modifier - derivePerception(off(7)).modifier).toBe(1);
  });

  it('boosts the Fist strike attack (+1 @2) and adds devastating dice (2 dice @4)', () => {
    const fist = (ch: ReturnType<typeof build>) => deriveStrikes(ch, db()).find((s) => s.name === 'Fist')!;
    const off = fist(build('fighter', 4, { keyAbility: 'str' }));
    const on = fist(build('fighter', 4, { keyAbility: 'str', variantRules: { abp: true } }));
    expect(on.attack[0] - off.attack[0]).toBe(1);
    expect(off.damage).toContain('1d4');
    expect(on.damage).toContain('2d4');
  });

  it('skill-potency budget grows by level', () => {
    expect(abpSkillBudget(2)).toEqual({ total: 0, rank2: 0, rank3: 0 });
    expect(abpSkillBudget(3)).toEqual({ total: 1, rank2: 0, rank3: 0 });
    expect(abpSkillBudget(9)).toEqual({ total: 2, rank2: 1, rank3: 0 });
    expect(abpSkillBudget(20)).toEqual({ total: 6, rank2: 3, rank3: 2 });
  });

  it('skill potency adds its item bonus to the chosen skill', () => {
    const base = build('fighter', 9, { keyAbility: 'str' });
    const sp = build('fighter', 9, { keyAbility: 'str', variantRules: { abp: true }, abpSkills: { athletics: 2 } });
    expect(deriveSkill(sp, 'athletics').modifier - deriveSkill(base, 'athletics').modifier).toBe(2);
  });

  it('attribute apex raises one stat at L17 and round-trips without double-counting', () => {
    const base = build('fighter', 17, { keyAbility: 'str' });
    const apex = build('fighter', 17, { keyAbility: 'str', variantRules: { abp: true }, abpApex: 'int' });
    expect(apex.abilities.int - base.abilities.int).toBe(2); // Int 10 → 12
    const rt = deriveBuildFromCharacter(apex, content());
    expect(rt.abpApex).toBe('int');
    // re-building from the recovered build reproduces the apex-boosted score (no slot double-spent)
    expect(buildCharacter(rt, content()).abilities.int).toBe(apex.abilities.int);
  });
});

describe('variant rules — Ancestry Paragon', () => {
  it('grants 11 ancestry feats (2 at L1, one at each odd level 3–19), replacing the standard 5', () => {
    expect(ancestrySlots(undefined)).toBe(5); // standard: 1/5/9/13/17
    expect(ancestrySlots({ ancestryParagon: true })).toBe(11);
    expect(levelGrants(1, 'fighter', db(), null, { ancestryParagon: true }).featSlots.filter((s) => s === 'ancestry').length).toBe(2);
    expect(levelGrants(3, 'fighter', db(), null, { ancestryParagon: true }).featSlots.filter((s) => s === 'ancestry').length).toBe(1);
    expect(levelGrants(20, 'fighter', db(), null, { ancestryParagon: true }).featSlots.filter((s) => s === 'ancestry').length).toBe(0);
  });
});

describe('variant rules — Dual Class (Phase 1: HP / proficiencies / feats)', () => {
  const wizSub = () => firstSubclass('wizard');
  const dual = (lvl: number, over = {}) =>
    build('fighter', lvl, { keyAbility: 'str', variantRules: { dualClass: true }, classId2: 'wizard', subclassId2: wizSub(), ...over });

  it('HP uses the higher per-level value (fighter 10 beats wizard 6)', () => {
    expect(deriveMaxHp(dual(5), content())).toBe(deriveMaxHp(build('fighter', 5, { keyAbility: 'str' }), content()));
  });

  it('the second class raises a save the first class leaves lower (Will: trained → expert via wizard)', () => {
    expect(build('fighter', 1, { keyAbility: 'str' }).proficiencies.saves.will).toBe('trained');
    expect(dual(1).proficiencies.saves.will).toBe('expert');
    // fighter's own strong saves are retained
    expect(dual(1).proficiencies.saves.fortitude).toBe('expert');
  });

  it('grants a class feat slot from EACH class at a shared class-feat level', () => {
    const slots = levelGrants(2, 'fighter', content(), null, { dualClass: true }, 'wizard', wizSub()).featSlots;
    expect(slots.filter((s) => s === 'class').length).toBe(2);
  });

  it('trains the union of both classes’ skills', () => {
    // wizard trains Arcana; a plain fighter does not.
    expect(build('fighter', 1, { keyAbility: 'str', backgroundId: null }).proficiencies.skills.arcana ?? 'untrained').toBe('untrained');
    expect(dual(1, { backgroundId: null }).proficiencies.skills.arcana).toBe('trained');
  });

  it('Phase 2: a spellcasting second class grants its own spellcasting entry with slots', () => {
    const ch = dual(5); // fighter + wizard, level 5
    const wizEntry = ch.spellcasting.find((e) => e.id === 'wizard-casting');
    expect(wizEntry).toBeDefined();
    expect(wizEntry!.tradition).toBe('arcane');
    expect(wizEntry!.type).toBe('prepared');
    // prepared slots exist for ranks the wizard can cast at L5 (1st–3rd).
    expect(Object.keys(wizEntry!.prepared ?? {}).length).toBeGreaterThan(0);
    // a plain fighter has no spellcasting entry
    expect(build('fighter', 5, { keyAbility: 'str' }).spellcasting.find((e) => e.id === 'wizard-casting')).toBeUndefined();
  });

  it('Phase 2: a spontaneous second class gets a repertoire+slots entry', () => {
    const ch = build('fighter', 5, { keyAbility: 'str', variantRules: { dualClass: true }, classId2: 'sorcerer', subclassId2: firstSubclass('sorcerer') });
    const sorc = ch.spellcasting.find((e) => e.id === 'sorcerer-casting');
    expect(sorc?.type).toBe('spontaneous');
    expect(sorc?.slots && Object.keys(sorc.slots).length).toBeGreaterThan(0);
    expect(sorc?.repertoire).toBeDefined();
  });

  it('Phase 2: a second monk’s Path to Perfection raises a chosen save', () => {
    const ch = build('fighter', 7, {
      keyAbility: 'str',
      variantRules: { dualClass: true },
      classId2: 'monk',
      subclassId2: firstSubclass('monk'),
      pathToPerfection: ['will', null, null],
    });
    expect(ch.proficiencies.saves.will).toBe('master'); // L7 path pick → master
  });
});

describe('variant rules — Dual Class Phase 2: bespoke subsystems on the SECOND class', () => {
  const db2 = content();
  const dc = (classId2: string, lvl = 11, extra: Record<string, unknown> = {}) =>
    build('fighter', lvl, { keyAbility: 'str', variantRules: { dualClass: true }, classId2, subclassId2: firstSubclass(classId2), ...extra });

  it('commander tactics folio resolves when commander is the second class', () => {
    const ch = dc('commander');
    expect(ch.commanderTactics).toBeDefined();
    expect(ch.commanderTactics!.maxTier).toBeTruthy();
  });

  it('inventor innovation type resolves from the second class’s subclass', () => {
    const ch = build('fighter', 7, { keyAbility: 'str', variantRules: { dualClass: true }, classId2: 'inventor', subclassId2: 'armor-innovation' });
    expect(ch.inventor?.innovationType).toBe('armor');
  });

  it('kineticist elements drive the Elemental Blast when kineticist is the second class', () => {
    const elId = db2.classes.kineticist.extraChoices?.find((g) => g.id === 'element')?.options[0]?.id as string;
    const ch = dc('kineticist', 5, { extraChoices: { element: [elId] } });
    expect(ch.kineticist?.elements.length).toBeGreaterThan(0);
    expect(ch.kineticist?.elements[0]).toBe(elId.replace(/-gate$/, ''));
  });

  it('animist apparition pool appears when animist is the second class', () => {
    const apps = db2.classes.animist.extraChoices?.find((g) => g.id === 'apparition')?.options.slice(0, 2).map((o) => o.id) as string[];
    const ch = dc('animist', 5, { extraChoices: { apparition: apps } });
    expect(ch.spellcasting.find((e) => e.id === 'animist-apparition-casting')).toBeDefined();
  });

  it('cleric divine font lands on the second class’s casting entry', () => {
    const deity = Object.values(db2.deities).find((d) => (d.divineFont ?? []).includes('heal'));
    const ch = build('fighter', 5, { keyAbility: 'str', variantRules: { dualClass: true }, classId2: 'cleric', subclassId2: 'cloistered-cleric', deityId: deity!.id, divineFont: 'heal' });
    const cleric = ch.spellcasting.find((e) => e.id === 'cleric-casting');
    expect(cleric?.font?.type).toBe('heal');
  });

  it('magus studious spells appear on the second class’s prepared list', () => {
    const magus = dc('magus', 5).spellcasting.find((e) => e.id === 'magus-casting');
    expect(magus?.prepared && Object.keys(magus.prepared).length).toBeGreaterThan(0);
  });
});
