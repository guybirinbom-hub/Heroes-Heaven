import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { ownedFeatureIds, deriveDefenses, deriveSpeeds } from '../src/rules/derive';
import { statHasSituational } from '../src/rules/explain';
import { buildCharacter, emptyBuild, extraPickLevel, type BuildState } from '../src/rules/build';

const c = content();
const build = (over: Partial<BuildState>): BuildState => ({ ...emptyBuild(), ...over });
const thaum = (level: number, picks: string[], over: Partial<BuildState> = {}) =>
  buildCharacter(build({ classId: 'thaumaturge', level, extraChoices: { implement: picks }, ...over }), c);

/**
 * THAUMATURGE IMPLEMENT BENEFITS.
 *
 * The implement picker existed and stored the choice, but the initiate / adept / paragon benefit
 * records — thirty of them, with situational bonuses already authored — were reachable from nothing.
 *
 *  - initiate: automatic for every implement, when that implement is gained (1st / 5th / 15th)
 *  - adept:    Implement Adept (7) picks one of your implements; Second Adept (11) gives the other
 *              of your first two
 *  - paragon:  Implement Paragon (17) picks one that ALREADY has adept — never the third implement
 */
describe('thaumaturge implement benefits', () => {
  it('a pick slot knows its own level, not the group entry level', () => {
    const g = c.classes.thaumaturge.extraChoices!.find((x) => x.id === 'implement')!;
    expect([0, 1, 2].map((i) => extraPickLevel(g, i))).toEqual([1, 5, 15]);
  });

  it('every implement grants its initiate benefit', () => {
    const owned = ownedFeatureIds(thaum(5, ['amulet', 'tome']), c);
    expect(owned.has('initiate-benefit-amulet')).toBe(true);
    expect(owned.has('initiate-benefit-tome')).toBe(true);
  });

  it("the second implement's initiate benefit waits for level 5", () => {
    expect(ownedFeatureIds(thaum(4, ['amulet', 'tome']), c).has('initiate-benefit-tome')).toBe(false);
    expect(ownedFeatureIds(thaum(5, ['amulet', 'tome']), c).has('initiate-benefit-tome')).toBe(true);
  });

  it('Implement Adept picks one at 7, Second Adept gives the other at 11', () => {
    const at7 = ownedFeatureIds(thaum(7, ['amulet', 'tome'], { implementAdept: 'tome' }), c);
    expect(at7.has('adept-benefit-tome')).toBe(true);
    expect(at7.has('adept-benefit-amulet'), 'the other one waits for 11th').toBe(false);

    const at11 = ownedFeatureIds(thaum(11, ['amulet', 'tome'], { implementAdept: 'tome' }), c);
    expect(at11.has('adept-benefit-tome')).toBe(true);
    expect(at11.has('adept-benefit-amulet')).toBe(true);
  });

  it('no adept benefit before level 7', () => {
    const owned = ownedFeatureIds(thaum(6, ['amulet', 'tome']), c);
    expect([...owned].some((id) => id.startsWith('adept-benefit-'))).toBe(false);
  });

  it('paragon goes to an implement that already has adept, never the third', () => {
    const ch = thaum(17, ['amulet', 'tome', 'chalice'], { implementAdept: 'amulet', implementParagon: 'chalice' });
    const owned = ownedFeatureIds(ch, c);
    // 'chalice' never gained adept, so the stored pick is invalid and falls back to a legal one.
    expect(owned.has('paragon-benefit-chalice')).toBe(false);
    expect([...owned].filter((id) => id.startsWith('paragon-benefit-')).length).toBe(1);
  });

  it("the adept benefit's situational bonuses reach the sheet", () => {
    // adept-benefit-tome upgrades the tome's Recall Knowledge bonus — authored, never displayed.
    const withTome = thaum(7, ['tome', 'amulet'], { implementAdept: 'tome' });
    expect(statHasSituational(withTome, { kind: 'skill', skill: 'arcana' }, c)).toBe(true);
  });

  it('an implement you never picked grants nothing', () => {
    const owned = ownedFeatureIds(thaum(17, ['amulet', 'tome', 'chalice'], { implementAdept: 'amulet' }), c);
    for (const tier of ['initiate', 'adept', 'paragon']) expect(owned.has(`${tier}-benefit-mirror`)).toBe(false);
  });
});

/**
 * CHAMPION — BLESSING OF THE DEVOTED.
 *
 * The level-3 feature says "choose one of the following blessings" and the class had no choice group,
 * so nothing was ever chosen and Blessed Swiftness's +5-foot Speed bonus was unreachable.
 */
describe('champion Blessing of the Devoted', () => {
  const champ = (level: number, blessing?: string) =>
    buildCharacter(build({ classId: 'champion', subclassId: 'justice', level, extraChoices: blessing ? { blessing: [blessing] } : {} }), c);

  it('the class offers exactly the three blessings, from 3rd level', () => {
    const g = c.classes.champion.extraChoices?.find((x) => x.id === 'blessing');
    expect(g, 'champion has no blessing group').toBeTruthy();
    expect(g!.pickByLevel).toEqual({ 3: 1 });
    expect(g!.options.map((o) => o.id).sort()).toEqual(['blessed-armament', 'blessed-shield', 'blessed-swiftness']);
  });

  it('Blessed Swiftness actually adds its +5 feet', () => {
    const base = deriveSpeeds(champ(3), c).land ?? 0;
    const swift = deriveSpeeds(champ(3, 'blessed-swiftness'), c).land ?? 0;
    expect(swift - base).toBe(5);
  });

  it('a different blessing does not add Speed', () => {
    expect(deriveSpeeds(champ(3, 'blessed-shield'), c).land).toBe(deriveSpeeds(champ(3), c).land);
  });

  it('the blessing is not owned before level 3', () => {
    expect(ownedFeatureIds(champ(2, 'blessed-swiftness'), c).has('blessed-swiftness')).toBe(false);
    expect(ownedFeatureIds(champ(3, 'blessed-swiftness'), c).has('blessed-swiftness')).toBe(true);
  });

  it('picking a blessing grants no stray defenses', () => {
    const d = deriveDefenses(champ(3, 'blessed-swiftness'), c);
    expect(d.resistances).toEqual(deriveDefenses(champ(3), c).resistances);
  });
});
