/**
 * SKILL RANKS LEVEL BY LEVEL — the guard cases (plan work/skill-rank-level-by-level/plan.md, WP0 step 3).
 *
 * Every case from work/skill-rank-timing-2026-10-21.md, in BOTH directions (the feat before and after the
 * increase), plus Dual Class, the Free Archetype order, the old Overrides "=" place, Snare Setter (D5), the
 * rank-gated feat grants, the reverse build and the Builder's own readers. Synthetic characters only.
 *
 * `expect` is the PRINT result under the owner's rulings of 2026-10-21 (docs/gold-set-answers.md, "The order
 * skill ranks are worked out in"): level by level; already trained from ANY source when the feat is taken →
 * a skill of your choice instead. `today` is today's engine, measured: a case with `flips` is wrong today
 * and names the work package that fixes it (D17: the test runs `it.fails` until that package flips it to
 * `it`, sets `flips: null` and deletes `today` in the same commit). Every `today` holds exactly on today's
 * engine (the premise test), so an `it.fails` can never be green for a typo.
 *
 * `finding` is the number of the finding in the findings file ("Why … is wrong", 1-9); `tag` only groups.
 * DC and FA cases come from Guy's request item 6 ("also cover what the findings did not check"), so they carry
 * `finding: null`.
 *
 * Read by test/skill-rank-level-order.test.ts, test/skill-rank-readers.test.tsx,
 * test/skill-rank-reverse-build.test.ts and scripts/blocks-parity-snapshot.mjs (family `skillorder:<id>`).
 */
import { content } from '../_content';
import { CUSTOM_BACKGROUND_ID, emptyBuild, levelGrants, type BuildState } from '../../src/rules/build';
import * as save from '../../src/rules/blocks/save';
import type { Character, ContentDatabase, ProficiencyKey, ProficiencyRank, VariantRules } from '../../src/rules/types';

/** The work packages of the plan (section 5). */
export type SkillOrderWp = 'WP3' | 'WP4' | 'WP5' | 'WP6' | 'WP7' | 'WP8' | 'WP9';
export const SKILL_ORDER_WPS: readonly SkillOrderWp[] = ['WP3', 'WP4', 'WP5', 'WP6', 'WP7', 'WP8', 'WP9'];

export interface SkillOrderExpect {
  /** Rank per key on the built character (`untrained` = absent). */
  skills?: Record<string, ProficiencyRank>;
  /** The EXACT `skillFallbacks` list as sorted `featId:skill`. */
  fallbacks?: string[];
  /** `featId:skill` entries that must NOT be in `skillFallbacks` (a case whose full list another WP still changes). */
  fallbacksLack?: string[];
  /** Feat rows that must exist: `id`, `id@level`, `id<grantedBy`, `id@level<grantedBy`. */
  featsHave?: string[];
  /** Feat rows that must not exist (same token format). */
  featsLack?: string[];
  /** Keys absent from `Character.grantedSkills` (the class skill picks' locks). */
  grantedSkillsLack?: string[];
  /**
   * The stored replacement answers that survive the open + Save stamp path of the Builder notice
   * (`openForSkillOrder` then `stampSkillOrderSave`, src/rules/blocks/save.ts, WP9). Read as `{}` while that
   * path does not exist or does not stamp `skillOrder: 2`.
   */
  storedAnswers?: Record<string, string>;
  /** Reverse-build cases: the rebuilt character's `skillIncreases` as sorted `level:skill`. */
  increases?: string[];
}

export interface SkillOrderCase {
  id: string;
  title: string;
  /** The findings-file number (1-9); null only for the DC / FA cases (Guy's item 6). */
  finding: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | null;
  tag?: 'DC' | 'FA' | 'OV' | 'D5' | 'RB' | 'P';
  /** The source's place against the increase it meets: before / after / the same level; or a control. */
  dir: 'before' | 'after' | 'same' | 'control';
  /** The case in the other direction (required for `before` and `same`). */
  twin?: string;
  build: BuildState;
  expect: SkillOrderExpect;
  flips: SkillOrderWp | null;
  today?: SkillOrderExpect;
  /** The ruling or AoN doc the expectation rests on. */
  print: string;
  /** Reverse-build cases (test/skill-rank-reverse-build.test.ts): the target ranks set on the built
   *  character before `skillIncreases` is deleted and `deriveBuildFromCharacter` runs. */
  reverse?: { set: Record<string, ProficiencyRank> };
}

/* ---------------------------------------------------------------------------------------------------- */
/* recipes (ported from the designer's map/map-cases/cases-all.ts)                                       */
/* ---------------------------------------------------------------------------------------------------- */
const db = () => content();
/** The featPicks key `<level>:<kind>:<index>` exactly as levelGrants draws it (variant + second class aware). */
export function slot(level: number, classId: string, kind: string, o: { variant?: VariantRules; classId2?: string; sub?: string; nth?: number } = {}): string {
  const g = levelGrants(level, classId, db(), o.sub ?? null, o.variant, o.classId2 ?? null, null, false, []);
  let seen = -1;
  const i = g.featSlots.findIndex((s: string) => s === kind && ++seen === (o.nth ?? 0));
  if (i < 0) throw new Error(`no ${kind} slot at ${level} for ${classId}: ${g.featSlots.join(',')}`);
  return `${level}:${kind}:${i}`;
}
export const mk = (o: Partial<BuildState>): BuildState =>
  ({ ...emptyBuild(), name: 't', keyAbility: 'str', backgroundId: 'acolyte', classSkills: [], ...o }) as BuildState;
/** The same build as a save from before the skill-order stamp (WP9): no `skillOrder` key at all. */
export const unstamped = (b: BuildState): BuildState => {
  const { skillOrder: _stamp, ...rest } = b;
  return rest as BuildState;
};
const kholo = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'kholo', heritageId: 'dog-kholo', ...o });
const human = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', ...o });
const dwarf = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'dwarf', heritageId: 'elemental-heart-dwarf', ...o });
const jot = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'jotunborn', heritageId: 'sage-jotunborn', ...o });
const keeperJot = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'jotunborn', heritageId: 'keeper-jotunborn', ...o });
const ash = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'ghoran', heritageId: 'ancient-ash', effectChoices: { 'ancient-ash:skill': 'stealth' }, ...o });
const shisk = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'shisk', heritageId: 'lorekeeper-shisk', effectChoices: { 'lorekeeper-shisk:int-wis-skill': 'society' }, ...o });
const anvil = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'dwarf', heritageId: 'anvil-dwarf', effectChoices: { 'anvil-dwarf:trained-skill': 'crafting' }, ...o });
const gob = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'goblin', heritageId: 'tailed-goblin', ...o });
const kobold = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'kobold', heritageId: 'strongjaw-kobold', ...o });
const exemplar = (o: Partial<BuildState>) => mk({ classId: 'exemplar', ancestryId: 'human', heritageId: 'versatile-human', extraChoices: { 'root-epithet': ['the-brave'] }, ...o });
const orc = (o: Partial<BuildState>) => mk({ classId: 'fighter', backgroundId: 'farmhand', ancestryId: 'orc', heritageId: 'badlands-orc', ...o });
const investigator = (o: Partial<BuildState>) => mk({ classId: 'investigator', keyAbility: 'dex', ancestryId: 'kholo', heritageId: 'dog-kholo', ...o });
const FA: VariantRules = { freeArchetype: true };
const DC: VariantRules = { dualClass: true };
/** A slot-picked feat with its sub-choice answered (`featChoices` is keyed by the same slot). */
const pickWith = (key: string, feat: string, choice: string) => ({ featPicks: { [key]: feat }, featChoices: { [key]: choice } });

/* ---------------------------------------------------------------------------------------------------- */
/* the cases                                                                                            */
/* ---------------------------------------------------------------------------------------------------- */
function cases(): SkillOrderCase[] {
  const C: SkillOrderCase[] = [];
  const add = (c: SkillOrderCase) => C.push(c);
  const R1 = 'ruling 1 (level by level, as print) + ruling 2 (already trained from ANY source when taken → a skill of your choice)';

  // ---- finding 4: the bug line, Kholo Lore ("If you would automatically become trained in one of those skills…")
  add({
    id: 'K1', title: 'Kholo Lore at 1, Stealth increase at 3 (feat BEFORE increase): the bug line', finding: 4, dir: 'before', twin: 'K2',
    build: kholo({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 3: 'stealth' } }),
    expect: { skills: { stealth: 'expert', survival: 'trained' }, fallbacks: [] }, flips: null, print: R1,
  });
  add({
    id: 'K1s', title: "K1 + a saved answer to today's free replacement pick (kholo-lore:fallback:stealth = arcana)", finding: 4, dir: 'before', twin: 'K2',
    build: kholo({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 3: 'stealth' }, featSkillChoices: { 'kholo-lore:fallback:stealth': 'arcana' } }),
    expect: { skills: { stealth: 'expert', arcana: 'untrained' }, fallbacks: [] }, flips: null,
    print: `${R1}; the stored answer is orphaned (kept, never deleted on load)`,
  });
  add({
    id: 'K1sa', title: 'K1s: the stored answer survives the Builder notice open + Save stamp (WP9)', finding: 4, dir: 'before', twin: 'K2',
    // An OLD save: no `skillOrder` stamp (emptyBuild stamps every new build since WP9), so the open + Save path
    // really stamps it.
    build: unstamped(kholo({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 3: 'stealth' }, featSkillChoices: { 'kholo-lore:fallback:stealth': 'arcana' } })),
    // skill-order WP9: K1sa — flipped (blocks/save.ts openForSkillOrder + stampSkillOrderSave stamp `skillOrder: 2` and
    // carry every stored answer, the orphaned kholo-lore:fallback:stealth included; plan 3.2).
    expect: { storedAnswers: { 'kholo-lore:fallback:stealth': 'arcana' } }, flips: null,
    print: "Guy's request: never rewrite on load; keep answers that no longer apply",
  });
  add({
    id: 'K2', title: 'Stealth increase at 3, Kholo Lore taken at 5 (feat AFTER increase)', finding: 4, dir: 'after',
    build: kholo({ level: 5, featPicks: { [slot(5, 'fighter', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 3: 'stealth' } }),
    expect: { skills: { stealth: 'trained', survival: 'trained' }, fallbacks: ['kholo-lore:stealth'] }, flips: null,
    print: 'ruling 2: already trained from ANY source (the increase) → a skill of your choice',
  });
  add({
    id: 'K3', title: 'Criminal background (Stealth) + Kholo Lore at 1 + Stealth increase at 3', finding: 4, dir: 'control',
    build: kholo({ level: 3, backgroundId: 'criminal', featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 3: 'stealth' } }),
    expect: { skills: { stealth: 'expert' }, fallbacks: ['kholo-lore:stealth'] }, flips: null, print: R1,
  });
  // The only single-class SAME-level feat + increase case (an investigator has an increase every level).
  add({
    id: 'K4', title: 'Investigator: Kholo Lore at 5 + Stealth increase at 5 (same level: feat, then increase)', finding: 1, dir: 'same', twin: 'K4b',
    build: investigator({ level: 5, featPicks: { [slot(5, 'investigator', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 5: 'stealth' } }),
    expect: { skills: { stealth: 'expert' }, fallbacks: [] }, flips: null,
    print: "ruling 1's gloss: that level's feats, then that level's skill increases (D3)",
  });
  add({
    id: 'K4b', title: 'Investigator: Stealth increase at 4, Kholo Lore at 5', finding: 1, dir: 'after',
    build: investigator({ level: 5, featPicks: { [slot(5, 'investigator', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 4: 'stealth' } }),
    expect: { skills: { stealth: 'trained' }, fallbacks: ['kholo-lore:stealth'] }, flips: null, print: 'ruling 2',
  });

  // ---- finding 1: Barbarian Dedication ("if you were already trained in Athletics, you instead…")
  add({
    id: 'B1', title: 'Athletics increase at 3, Barbarian Dedication at 4 (feat AFTER increase)', finding: 1, dir: 'after',
    build: human({ level: 4, skillIncreases: { 3: 'athletics' }, featPicks: { [slot(4, 'fighter', 'class')]: 'barbarian-dedication' } }),
    expect: { skills: { athletics: 'trained' }, fallbacks: ['barbarian-dedication:athletics'] }, flips: null, print: 'ruling 2',
  });
  add({
    id: 'B2', title: 'Barbarian Dedication at 2, Athletics increase at 3 (feat BEFORE increase)', finding: 1, dir: 'before', twin: 'B1',
    build: human({ level: 3, skillIncreases: { 3: 'athletics' }, featPicks: { [slot(2, 'fighter', 'class')]: 'barbarian-dedication' } }),
    expect: { skills: { athletics: 'expert' }, fallbacks: [] }, flips: null, print: R1,
  });
  // The conditionalSkills expert-upgrade branch: Blackjacket Dedication, Intimidation "trained, or expert if already trained".
  add({
    id: 'BJ1', title: 'Class pick Intimidation, Blackjacket Dedication at 2, Intimidation increase at 7 (fighter 7)', finding: 1, dir: 'before', twin: 'BJ2',
    build: human({ level: 7, classSkills: ['intimidation'], featPicks: { [slot(2, 'fighter', 'class')]: 'blackjacket-dedication' }, skillIncreases: { 7: 'intimidation' } }),
    expect: { skills: { intimidation: 'master' }, fallbacks: [] }, flips: null,
    print: 'Blackjacket Dedication: trained at 1, expert at 2 by the upgrade, master at 7 (ruling 1)',
  });
  add({
    id: 'BJ2', title: 'Class pick Intimidation, Intimidation increase at 3, Blackjacket Dedication at 4', finding: 1, dir: 'after',
    build: human({ level: 4, classSkills: ['intimidation'], featPicks: { [slot(4, 'fighter', 'class')]: 'blackjacket-dedication' }, skillIncreases: { 3: 'intimidation' } }),
    expect: { skills: { intimidation: 'expert' }, fallbacks: [] }, flips: null,
    print: 'the upgrade sees expert and adds nothing (already above its expert)',
  });
  /* BJ3 (WP3 checker round 1, finding 1): no Intimidation source before the dedication, so the record's place and
   * the finished character DISAGREE on "already trained" — the case G1 (d) needs (BJ1 is trained from 1st either way). */
  add({
    id: 'BJ3', title: 'No Intimidation source, Blackjacket Dedication at 2, Intimidation increase at 7 (fighter 7)', finding: 1, dir: 'control',
    build: human({ level: 7, featPicks: { [slot(2, 'fighter', 'class')]: 'blackjacket-dedication' }, skillIncreases: { 7: 'intimidation' } }),
    expect: { skills: { intimidation: 'expert' }, fallbacks: [] }, flips: null,
    print: 'Blackjacket Dedication: trained at 2 (untrained then), expert by the 7th-level increase (D6)',
  });

  // ---- finding 2: "If you have legendary X" gates (a standing gate, the final pass)
  const enigma = (db().classes.bard?.subclass?.options ?? []).find((x) => /enigma/.test(x.id))?.id ?? 'enigma';
  const bard = (lvl: number, inc: Record<number, string>) =>
    mk({ level: lvl, classId: 'bard', keyAbility: 'cha', subclassId: enigma, ancestryId: 'human', heritageId: 'versatile-human', skillIncreases: inc as BuildState['skillIncreases'] });
  add({
    id: 'BL15', title: 'Enigma bard L15, Occultism increases 3/7/15 (legendary at 15): Bardic Lore expert', finding: 2, dir: 'control',
    build: bard(15, { 3: 'occultism', 7: 'occultism', 15: 'occultism' }),
    expect: { skills: { occultism: 'legendary', 'lore:bardic': 'expert' }, fallbacks: [] }, flips: null, print: 'Bardic Lore: "If you have legendary proficiency in Occultism…" (D9)',
  });
  add({
    id: 'BL14', title: 'Enigma bard L14, Occultism 3/7 (master): the gate stays closed', finding: 2, dir: 'control',
    build: bard(14, { 3: 'occultism', 7: 'occultism' }),
    expect: { skills: { occultism: 'master', 'lore:bardic': 'trained' }, fallbacks: [] }, flips: null, print: 'Bardic Lore (D9)',
  });

  // ---- finding 5: rank-gated feat grants
  add({
    id: 'S1', title: "Stonemason's Eye at 1, Crafting increase at 3 (feat BEFORE increase)", finding: 5, dir: 'before', twin: 'S2',
    build: dwarf({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'stonemasons-eye' }, skillIncreases: { 3: 'crafting' } }),
    // skill-order WP4: S1 — flipped (rankGatedGrants reads the rank just before the feat's own place: untrained at 1).
    expect: { skills: { crafting: 'expert' }, featsLack: ['specialty-crafting'] }, flips: null,
    print: "Stonemason's Eye: Crafting untrained when taken at 1 → trained, no Specialty Crafting (D10)",
  });
  add({
    id: 'S2', title: "Crafting increase at 3, Stonemason's Eye at 5 (feat AFTER increase)", finding: 5, dir: 'after',
    build: dwarf({ level: 5, featPicks: { [slot(5, 'fighter', 'ancestry')]: 'stonemasons-eye' }, skillIncreases: { 3: 'crafting' } }),
    expect: { skills: { crafting: 'trained' }, featsHave: ['specialty-crafting<stonemasons-eye'] }, flips: null, print: "Stonemason's Eye: already trained → Specialty Crafting",
  });
  add({
    id: 'IC1', title: 'Intuitive Crafting at 1 + Crafting increase at 3', finding: 5, dir: 'before', twin: 'IC2',
    build: human({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'intuitive-crafting' }, skillIncreases: { 3: 'crafting' } }),
    // skill-order WP4: IC1 — flipped (as S1: Crafting untrained just before the feat at 1, so no Specialty Crafting).
    expect: { skills: { crafting: 'expert' }, featsLack: ['specialty-crafting'] }, flips: null,
    print: 'Intuitive Crafting: "If you were already trained in Crafting, you instead gain Specialty Crafting" (D10)',
  });
  add({
    id: 'IC2', title: 'Crafting increase at 3 + Intuitive Crafting taken at 5', finding: 5, dir: 'after',
    build: human({ level: 5, featPicks: { [slot(5, 'fighter', 'ancestry')]: 'intuitive-crafting' }, skillIncreases: { 3: 'crafting' } }),
    expect: { skills: { crafting: 'trained' }, featsHave: ['specialty-crafting<intuitive-crafting'] }, flips: null, print: 'Intuitive Crafting',
  });
  add({
    id: 'G1', title: 'Gildedsoul at 1 answered Diplomacy + Society increase at 3 (standing gate, today\'s reading kept)', finding: 5, dir: 'control',
    build: human({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'gildedsoul' }, featSkillChoices: { 'gildedsoul:0': 'diplomacy' }, skillIncreases: { 3: 'society' } }),
    expect: { skills: { diplomacy: 'trained', society: 'trained' }, fallbacks: [] }, flips: null, print: 'Gildedsoul reads either way → R9, today kept (D10)',
  });
  add({
    id: 'MW1', title: 'Molten Wit at 1 answered Deception + Deception increase at 3', finding: 5, dir: 'before', twin: 'MW2',
    build: human({ level: 3, ...pickWith(slot(1, 'fighter', 'ancestry'), 'molten-wit', 'deception'), skillIncreases: { 3: 'deception' } }),
    expect: { skills: { deception: 'expert', diplomacy: 'untrained' }, fallbacks: [] }, flips: null, print: R1,
  });
  add({
    id: 'MW2', title: 'Deception increase at 3, Molten Wit at 5 answered Deception → "you must take the other"', finding: 5, dir: 'after',
    build: human({ level: 5, ...pickWith(slot(5, 'fighter', 'ancestry'), 'molten-wit', 'deception'), skillIncreases: { 3: 'deception' } }),
    expect: { skills: { deception: 'trained', diplomacy: 'trained' }, fallbacks: [] }, flips: null, print: 'Molten Wit (feat-3930)',
  });
  const barbarian = (o: Partial<BuildState>) => mk({ classId: 'barbarian', ancestryId: 'human', heritageId: 'versatile-human', subclassId: (db().classes.barbarian?.subclass?.options[0]?.id as string) ?? null, ...o });
  add({
    id: 'RI1', title: 'Raging Intimidation at 1, Intimidation legendary at 15: Scare to Death arrives at 15th', finding: 5, dir: 'control',
    build: barbarian({ level: 15, classSkills: ['intimidation'], featPicks: { [slot(1, 'barbarian', 'class')]: 'raging-intimidation' }, skillIncreases: { 3: 'intimidation', 7: 'intimidation', 15: 'intimidation' } }),
    // skill-order WP4: RI1 — flipped (a 'reached' entry is granted at the first level its rank holds: legendary at 15th).
    expect: { skills: { intimidation: 'legendary' }, featsHave: ['intimidating-glare@1<raging-intimidation', 'scare-to-death@15<raging-intimidation'] }, flips: null,
    print: 'Raging Intimidation: "As soon as you meet the prerequisites … you gain these feats" (D10: at the first level the gate holds)',
  });
  add({
    id: 'IG1', title: 'Raging Intimidation with Intimidating Glare removed by a Tweaks removal: it stays removed', finding: 5, dir: 'control',
    build: barbarian({ level: 3, classSkills: ['intimidation'], featPicks: { [slot(1, 'barbarian', 'class')]: 'raging-intimidation' }, options: { overridesEnabled: true }, overrides: { removedFeatIds: ['intimidating-glare'] } }),
    expect: { featsLack: ['intimidating-glare'] }, flips: null, print: 'D10 (a Tweaks removal stays removed)',
  });

  // ---- finding 6: heritages and class features run after feats inside the feat pass
  add({
    id: 'J1', title: 'Sage Jotunborn (Society, 1st-level heritage) + Linguist Dedication at 2', finding: 6, dir: 'control',
    build: jot({ level: 2, featPicks: { [slot(2, 'fighter', 'class')]: 'linguist-dedication' } }),
    expect: { skills: { society: 'expert' }, fallbacks: [] }, flips: null, print: 'Linguist Dedication: "if you were already trained in Society, you instead become an expert" (ruling 1)',
  });
  add({
    id: 'J2', title: 'Sage Jotunborn + Society increase at 3 + Linguist Dedication at 4 (feat AFTER increase)', finding: 6, dir: 'after',
    build: jot({ level: 4, skillIncreases: { 3: 'society' }, featPicks: { [slot(4, 'fighter', 'class')]: 'linguist-dedication' } }),
    expect: { skills: { society: 'expert' }, fallbacks: [] }, flips: null, print: 'heritage T, increase E, Linguist: already above expert → no change',
  });
  add({
    id: 'J3', title: 'No heritage Society: Society increase at 3 + Linguist Dedication at 4', finding: 6, dir: 'after',
    build: keeperJot({ level: 4, skillIncreases: { 3: 'society' }, featPicks: { [slot(4, 'fighter', 'class')]: 'linguist-dedication' } }),
    expect: { skills: { society: 'expert' }, fallbacks: [] }, flips: null, print: 'Linguist Dedication',
  });
  add({
    id: 'J4', title: 'Linguist Dedication at 2 + Society increase at 3 (feat BEFORE increase)', finding: 6, dir: 'before', twin: 'J3',
    build: keeperJot({ level: 3, skillIncreases: { 3: 'society' }, featPicks: { [slot(2, 'fighter', 'class')]: 'linguist-dedication' } }),
    expect: { skills: { society: 'expert' }, fallbacks: [] }, flips: null, print: 'Linguist Dedication',
  });
  // Root Epithet (class-feature-1066): "If you are already trained in the granted skill, you become trained in a
  // different skill of your choice, as normal." The epithet arrives at 3.
  add({
    id: 'A5', title: 'Exemplar L3: Barbarian Dedication at 2 + Root Epithet The Brave at 3 (Athletics): the dedication owes nothing', finding: 6, dir: 'before', twin: 'A5b',
    build: exemplar({ level: 3, featPicks: { [slot(2, 'exemplar', 'class')]: 'barbarian-dedication' } }),
    expect: { skills: { athletics: 'trained' }, fallbacksLack: ['barbarian-dedication:athletics'] }, flips: null, print: 'ruling 1: the dedication at 2 comes first; Athletics is untrained then',
  });
  add({
    id: 'A5e', title: 'A5: the epithet at 3 is the redundant one and owes the replacement', finding: 6, dir: 'before', twin: 'A5b',
    build: exemplar({ level: 3, featPicks: { [slot(2, 'exemplar', 'class')]: 'barbarian-dedication' } }),
    // skill-order WP5: A5e — the epithet at 3 judges "already trained" at its own place (D14): Athletics, trained by
    // the dedication at 2, owes the replacement (class-feature-1066).
    expect: { fallbacks: ['the-brave:athletics'] }, flips: null,
    print: 'Root Epithet (class-feature-1066) "…a different skill of your choice, as normal" (D14)',
  });
  add({
    id: 'A5b', title: 'Exemplar L4: Root Epithet The Brave at 3, Barbarian Dedication at 4', finding: 6, dir: 'after',
    build: exemplar({ level: 4, featPicks: { [slot(4, 'exemplar', 'class')]: 'barbarian-dedication' } }),
    expect: { skills: { athletics: 'trained' }, fallbacks: ['barbarian-dedication:athletics'] }, flips: null, print: 'ruling 2',
  });
  add({
    id: 'A5c', title: 'Exemplar L3: Root Epithet The Brave at 3 + Athletics increase at 3 (feature, then increase)', finding: 6, dir: 'control',
    build: exemplar({ level: 3, skillIncreases: { 3: 'athletics' } }),
    expect: { skills: { athletics: 'expert' }, fallbacks: [] }, flips: null, print: 'ruling 1 (D3: P3 before P6)',
  });
  add({
    id: 'A6', title: 'Exemplar L3: class pick Athletics at 1 + Root Epithet The Brave at 3: the 1st-level pick is not locked', finding: 6, dir: 'control',
    build: exemplar({ level: 3, classSkills: ['athletics', 'arcana'] }),
    expect: { skills: { athletics: 'trained', arcana: 'trained' }, grantedSkillsLack: ['athletics'] }, flips: null,
    print: 'the epithet does not exist at 1st level, so it locks no 1st-level pick (grantedSkills = level-1 locks only)',
  });
  add({
    id: 'A6e', title: 'A6: the epithet owes a replacement for the 1st-level Athletics', finding: 6, dir: 'control',
    build: exemplar({ level: 3, classSkills: ['athletics', 'arcana'] }),
    // skill-order WP5: A6e — the 1st-level class pick trained Athletics before the epithet at 3 (D14, class-feature-1066).
    expect: { fallbacks: ['the-brave:athletics'] }, flips: null,
    print: 'Root Epithet (class-feature-1066) (D14)',
  });
  add({
    id: 'A6b', title: 'Exemplar L1 (epithet not reached): class pick Athletics', finding: 6, dir: 'control',
    build: exemplar({ level: 1, classSkills: ['athletics', 'arcana'] }),
    expect: { skills: { athletics: 'trained', arcana: 'trained' }, fallbacks: [] }, flips: null, print: 'control: an epithet answer stored below its level',
  });

  // ---- finding 3: a second lane (heritage / feat choice trainings) is not reached
  add({
    id: 'AA3', title: 'Ancient Ash picks Stealth + Stealth increase at 3 (L3)', finding: 3, dir: 'control',
    build: ash({ level: 3, skillIncreases: { 3: 'stealth' } }),
    expect: { skills: { stealth: 'expert' }, fallbacks: [] }, flips: null, print: R1,
  });
  add({
    id: 'AA5', title: 'Ancient Ash Stealth + increase at 3 (L5: the 5th-level expert step is then a no-op)', finding: 3, dir: 'control',
    build: ash({ level: 5, skillIncreases: { 3: 'stealth' } }),
    expect: { skills: { stealth: 'expert' }, fallbacks: [] }, flips: null, print: R1,
  });
  add({
    id: 'AA7', title: 'Ancient Ash Stealth + increases 3 and 7 (L7)', finding: 3, dir: 'control',
    build: ash({ level: 7, skillIncreases: { 3: 'stealth', 7: 'stealth' } }),
    expect: { skills: { stealth: 'master' }, fallbacks: [] }, flips: null, print: R1,
  });
  add({
    id: 'AA7b', title: 'Ancient Ash Stealth + increase only at 7 (heritage T at 1, E at 5, increase M at 7)', finding: 3, dir: 'control',
    build: ash({ level: 7, skillIncreases: { 7: 'stealth' } }),
    expect: { skills: { stealth: 'master' }, fallbacks: [] }, flips: null, print: R1,
  });
  add({
    id: 'LS1', title: 'Lorekeeper Shisk picks Society + Linguist Dedication at 2', finding: 3, dir: 'control',
    build: shisk({ level: 2, featPicks: { [slot(2, 'fighter', 'class')]: 'linguist-dedication' } }),
    expect: { skills: { society: 'expert' }, fallbacks: [] }, flips: null, print: R1,
  });
  add({
    id: 'LS2', title: 'Lorekeeper Shisk Society + Society increase at 3 (L3)', finding: 3, dir: 'control',
    build: shisk({ level: 3, skillIncreases: { 3: 'society' } }),
    expect: { skills: { society: 'expert' }, fallbacks: [] }, flips: null, print: R1,
  });
  add({
    id: 'LS3', title: 'Lorekeeper Shisk Society + Society increase at 3 + Linguist Dedication at 4', finding: 3, dir: 'after',
    build: shisk({ level: 4, skillIncreases: { 3: 'society' }, featPicks: { [slot(4, 'fighter', 'class')]: 'linguist-dedication' } }),
    expect: { skills: { society: 'expert' }, fallbacks: [] }, flips: null, print: 'Linguist Dedication: already expert → no change, no replacement',
  });
  add({
    id: 'AD1', title: 'Anvil Dwarf Crafting + Alchemist Dedication at 2', finding: 3, dir: 'control',
    build: anvil({ level: 2, featPicks: { [slot(2, 'fighter', 'class')]: 'alchemist-dedication' } }),
    expect: { skills: { crafting: 'trained' }, fallbacks: ['alchemist-dedication:crafting'] }, flips: null, print: 'ruling 2 (the heritage trained it first)',
  });
  add({
    id: 'AD2', title: 'Anvil Dwarf Crafting + Alchemist Dedication at 2 + Crafting increase at 3', finding: 3, dir: 'before', twin: 'AD3',
    build: anvil({ level: 3, featPicks: { [slot(2, 'fighter', 'class')]: 'alchemist-dedication' }, skillIncreases: { 3: 'crafting' } }),
    expect: { skills: { crafting: 'expert' }, fallbacks: ['alchemist-dedication:crafting'] }, flips: null, print: R1,
  });
  add({
    id: 'AD3', title: 'Anvil Dwarf Crafting + Crafting increase at 3 + Alchemist Dedication at 4', finding: 3, dir: 'after',
    build: anvil({ level: 4, featPicks: { [slot(4, 'fighter', 'class')]: 'alchemist-dedication' }, skillIncreases: { 3: 'crafting' } }),
    expect: { skills: { crafting: 'expert' }, fallbacks: ['alchemist-dedication:crafting'] }, flips: null, print: R1,
  });
  add({
    id: 'AD4', title: "Anvil Dwarf Crafting + Stonemason's Eye at 1 (heritage before the ancestry feat)", finding: 3, dir: 'control',
    build: anvil({ level: 1, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'stonemasons-eye' } }),
    expect: { skills: { crafting: 'trained' }, fallbacks: [] }, flips: null, print: 'rank-neutral (Specialty Crafting is not repeatable)',
  });
  add({
    id: 'OW1', title: 'Orc Warmask (divine → Religion) at 1 + Religion increase at 3', finding: 3, dir: 'before', twin: 'OW2',
    build: orc({ level: 3, ...pickWith(slot(1, 'fighter', 'ancestry'), 'orc-warmask', 'divine'), skillIncreases: { 3: 'religion' } }),
    expect: { skills: { religion: 'expert' }, fallbacks: [] }, flips: null, print: R1,
  });
  add({
    id: 'OW2', title: 'Religion increase at 3 + Orc Warmask (divine) at 5 (no "already trained" clause in print)', finding: 3, dir: 'after',
    build: orc({ level: 5, ...pickWith(slot(5, 'fighter', 'ancestry'), 'orc-warmask', 'divine'), skillIncreases: { 3: 'religion' } }),
    expect: { skills: { religion: 'trained' }, fallbacks: [] }, flips: null, print: 'Orc Warmask prints no replacement clause',
  });
  add({
    id: 'A2', title: 'Orc Warmask (divine → Religion) at 1 + Cleric Dedication at 2 (Iomedae)', finding: 3, dir: 'control',
    build: orc({ level: 2, deityId: 'iomedae', featPicks: { [slot(1, 'fighter', 'ancestry')]: 'orc-warmask', [slot(2, 'fighter', 'class')]: 'cleric-dedication' }, featChoices: { [slot(1, 'fighter', 'ancestry')]: 'divine' } }),
    expect: { skills: { religion: 'trained', intimidation: 'trained' }, fallbacks: ['cleric-dedication:religion'] }, flips: null, print: 'ruling 2: Religion trained by the 1st-level feat before the dedication',
  });

  // ---- finding 1: an ancestry feat at 5+ (Vandal) and a feat with no clause (Inventor Dedication)
  add({
    id: 'V1', title: 'Thievery increase at 3, Vandal at 5 (feat AFTER increase)', finding: 1, dir: 'after',
    build: gob({ level: 5, featPicks: { [slot(5, 'fighter', 'ancestry')]: 'vandal' }, skillIncreases: { 3: 'thievery' } }),
    expect: { skills: { thievery: 'trained' }, fallbacks: ['vandal:thievery'] }, flips: null, print: 'ruling 1 (even where Wanderer\'s Guide differs) + ruling 2',
  });
  add({
    id: 'V2', title: 'Vandal at 5, Thievery increase at 7 (feat BEFORE increase)', finding: 1, dir: 'before', twin: 'V1',
    build: gob({ level: 7, featPicks: { [slot(5, 'fighter', 'ancestry')]: 'vandal' }, skillIncreases: { 7: 'thievery' } }),
    expect: { skills: { thievery: 'expert' }, fallbacks: [] }, flips: null, print: R1,
  });
  add({
    id: 'I1', title: 'Crafting increase at 3, Inventor Dedication at 4 (feat AFTER; no clause → nothing extra)', finding: 1, dir: 'after',
    build: human({ level: 4, skillIncreases: { 3: 'crafting' }, featPicks: { [slot(4, 'fighter', 'class')]: 'inventor-dedication' } }),
    expect: { skills: { crafting: 'trained' }, fallbacks: [] }, flips: null, print: 'Inventor Dedication: "You become trained in Crafting" (no clause)',
  });
  add({
    id: 'I2', title: 'Inventor Dedication at 2, Crafting increase at 3 (feat BEFORE)', finding: 1, dir: 'before', twin: 'I1',
    build: human({ level: 3, skillIncreases: { 3: 'crafting' }, featPicks: { [slot(2, 'fighter', 'class')]: 'inventor-dedication' } }),
    expect: { skills: { crafting: 'expert' }, fallbacks: [] }, flips: null, print: R1,
  });
  // D5: a feat whose skill prerequisite needs that level's increase goes after it (Snare Setter: prerequisite
  // "trained in Crafting" + "If you were already trained in Crafting, you instead become trained in a skill of your choice").
  add({
    id: 'SN1', title: 'Kobold fighter 5: Snare Setter at 5 + the 5th-level increase on Crafting (one legal order: increase first)', finding: 1, tag: 'D5', dir: 'same', twin: 'SN2',
    build: kobold({ level: 5, featPicks: { [slot(5, 'fighter', 'ancestry')]: 'snare-setter' }, skillIncreases: { 5: 'crafting' } }),
    expect: { skills: { crafting: 'trained' }, fallbacks: ['snare-setter:crafting'] }, flips: null, print: 'D5 + Player Core pg.29 (rules-2065)',
  });
  add({
    id: 'SN2', title: 'Kobold fighter 5: Crafting increase at 3, Snare Setter at 5', finding: 1, tag: 'D5', dir: 'after',
    build: kobold({ level: 5, featPicks: { [slot(5, 'fighter', 'ancestry')]: 'snare-setter' }, skillIncreases: { 3: 'crafting' } }),
    expect: { skills: { crafting: 'trained' }, fallbacks: ['snare-setter:crafting'] }, flips: null, print: 'ruling 2',
  });
  // D6: a ladder reads the record's own level (Operatic Adventurer: master at 12, legendary at 15).
  add({
    id: 'OA1', title: 'Fighter 16: Acrobat Dedication at 2, Operatic Adventurer at 12 → Performance legendary', finding: 1, dir: 'control',
    build: human({ level: 16, featPicks: { [slot(2, 'fighter', 'class')]: 'acrobat-dedication', [slot(12, 'fighter', 'skill')]: 'operatic-adventurer' } }),
    expect: { skills: { performance: 'legendary' } }, flips: null, print: 'Operatic Adventurer: master, legendary at 15th',
  });

  // ---- Free Archetype order (Guy's item 6; WG puts FA last, print is level by level)
  add({
    id: 'FA1', title: 'Free Archetype Barbarian Dedication at 2 (archetype slot), Athletics increase at 3', finding: null, tag: 'FA', dir: 'before', twin: 'FA2',
    build: human({ level: 3, variantRules: FA, skillIncreases: { 3: 'athletics' }, featPicks: { [slot(2, 'fighter', 'archetype', { variant: FA })]: 'barbarian-dedication' } }),
    expect: { skills: { athletics: 'expert' }, fallbacks: [] }, flips: null, print: 'ruling 1 (even where Wanderer\'s Guide differs: FA is not last)',
  });
  add({
    id: 'FA2', title: 'Athletics increase at 3, Free Archetype Barbarian Dedication at 4', finding: null, tag: 'FA', dir: 'after',
    build: human({ level: 4, variantRules: FA, skillIncreases: { 3: 'athletics' }, featPicks: { [slot(4, 'fighter', 'archetype', { variant: FA })]: 'barbarian-dedication' } }),
    expect: { skills: { athletics: 'trained' }, fallbacks: ['barbarian-dedication:athletics'] }, flips: null, print: 'ruling 2',
  });
  add({
    id: 'FA3', title: 'Same level: class-slot Alchemist Dedication + FA-slot Barbarian Dedication at 2 (no overlap)', finding: null, tag: 'FA', dir: 'control',
    build: human({ level: 2, variantRules: FA, featPicks: { [slot(2, 'fighter', 'class', { variant: FA })]: 'alchemist-dedication', [slot(2, 'fighter', 'archetype', { variant: FA })]: 'barbarian-dedication' } }),
    expect: { skills: { athletics: 'trained', crafting: 'trained' }, fallbacks: [] }, flips: null, print: 'control',
  });

  // ---- Dual Class second-class increases (Guy's item 6; rules-1329 / rules-1331)
  add({
    id: 'DC1', title: 'Dual Class fighter (1st) + rogue (2nd), L4, increases stored at 2/3/4', finding: null, tag: 'DC', dir: 'control',
    build: human({ level: 4, classId2: 'rogue', variantRules: DC, skillIncreases: { 2: 'acrobatics', 3: 'thievery', 4: 'deception' } }),
    expect: { skills: { stealth: 'trained', acrobatics: 'expert', thievery: 'trained', deception: 'trained' }, fallbacks: [] }, flips: null, // skill-order WP6: DC1 (rules-1331, D15)
    print: 'rules-1331: a dual-class rogue still gets the skill increase at levels where the other class does not (D15)',
  });
  add({
    id: 'DC1n', title: 'DC1 with no stored increases (the notice names the new empty slots, WP9)', finding: null, tag: 'DC', dir: 'control',
    build: human({ level: 4, classId2: 'rogue', variantRules: DC }),
    expect: { skills: { stealth: 'trained', acrobatics: 'trained', thievery: 'untrained', deception: 'untrained' }, fallbacks: [] }, flips: null, print: 'D15 (no stored answer: ranks unchanged)',
  });
  add({
    id: 'DC2', title: 'Dual Class rogue (1st) + fighter (2nd), same increases', finding: null, tag: 'DC', dir: 'control',
    build: mk({ level: 4, classId: 'rogue', classId2: 'fighter', keyAbility: 'dex', variantRules: DC, ancestryId: 'human', heritageId: 'versatile-human', skillIncreases: { 2: 'acrobatics', 3: 'thievery', 4: 'deception' } }),
    expect: { skills: { stealth: 'trained', acrobatics: 'expert', thievery: 'trained', deception: 'trained' }, fallbacks: [] }, flips: null, print: 'rules-1331',
  });
  add({
    id: 'DC3', title: 'Dual Class fighter + rogue: Barbarian Dedication at 2 + Athletics increase at 2 (feat, then increase)', finding: null, tag: 'DC', dir: 'control',
    build: human({ level: 2, classId2: 'rogue', variantRules: DC, skillIncreases: { 2: 'athletics' }, featPicks: { [slot(2, 'fighter', 'class', { variant: DC, classId2: 'rogue' })]: 'barbarian-dedication' } }),
    expect: { skills: { athletics: 'expert' }, fallbacks: [] }, flips: null, // skill-order WP6: DC3 (rules-1331 + ruling 1)
    print: 'rules-1331 + ruling 1 (feats, then that level\'s increase; 2nd-level cap expert)',
  });

  // ---- finding 9: old Overrides "=" and Tweaks part B (values stated by plan WP0 step 3; never out-final's OV column)
  add({
    id: 'OV1', title: 'Old Overrides Stealth "=" expert, fighter 7, Stealth class pick, increases 3 + 7 on Stealth', finding: 9, tag: 'OV', dir: 'control',
    build: human({ level: 7, classSkills: ['stealth'], skillIncreases: { 3: 'stealth', 7: 'stealth' }, overrides: { proficiencies: { stealth: 'expert' } } }),
    expect: { skills: { stealth: 'expert' }, fallbacks: [] }, flips: null, print: 'part B kept (plan 3.4)',
  });
  add({
    id: 'OV2', title: 'Old Overrides Stealth "=" expert, Kholo Lore at 1, Stealth increase at 3 (L3)', finding: 9, tag: 'OV', dir: 'control',
    build: kholo({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 3: 'stealth' }, overrides: { proficiencies: { stealth: 'expert' } } }),
    expect: { skills: { stealth: 'expert' }, fallbacks: ['kholo-lore:stealth'] }, flips: null, print: 'part B kept: the moved floor sits at 1 before every feat (plan 3.4)',
  });
  add({
    id: 'OV3', title: 'Old Overrides Stealth "=" expert, Kholo Lore at 1, Stealth increases 3 + 7 (L7)', finding: 9, tag: 'OV', dir: 'control',
    build: kholo({ level: 7, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 3: 'stealth', 7: 'stealth' }, overrides: { proficiencies: { stealth: 'expert' } } }),
    expect: { skills: { stealth: 'master' }, fallbacks: ['kholo-lore:stealth'] }, flips: null, print: 'part B kept (plan 3.4)',
  });
  const skilledHuman = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'human', heritageId: 'skilled-human', heritageSkill: 'athletics', ...o });
  add({
    id: 'OV4', title: 'Skilled human Athletics + a moved "exactly" Athletics = untrained + Barbarian Dedication at 6', finding: 9, tag: 'OV', dir: 'control',
    build: skilledHuman({ level: 6, featPicks: { [slot(6, 'fighter', 'class')]: 'barbarian-dedication' }, overrides: { proficiencies: { athletics: 'untrained' }, meta: { 'proficiencies:athletics': { of: 'untrained', mode: 'exactly', moved: true } } } }),
    expect: { skills: { athletics: 'untrained' }, fallbacks: [] }, flips: null, print: 'D3 P2 swallow rule (part B B26 b)',
  });
  add({
    id: 'OV4c', title: 'OV4 with an unstamped old "=" (sorted "exactly" at read)', finding: 9, tag: 'OV', dir: 'control',
    build: skilledHuman({ level: 6, featPicks: { [slot(6, 'fighter', 'class')]: 'barbarian-dedication' }, overrides: { proficiencies: { athletics: 'untrained' } } }),
    expect: { skills: { athletics: 'untrained' }, fallbacks: [] }, flips: null, print: 'D3 P2 swallow rule',
  });
  /* OV5 (WP3 checker round 1, finding 3): plan 3.4 item 1, the one intended Tweaks move — an "at least" floor whose
   * start level (3) is above the same-key feat (Kholo Lore at 1). Print: the feat trains Stealth at 1 (untrained
   * then), the floor makes it expert at 3; nothing owed. Today's engine put the floor first and owed a replacement. */
  add({
    id: 'OV5', title: 'Tweaks "at least" Stealth expert from 3 + Kholo Lore at 1 (L3): the floor lands after the feat (plan 3.4 item 1)', finding: 9, tag: 'OV', dir: 'control',
    build: kholo({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' }, overrides: { proficiencies: { stealth: 'expert' }, meta: { 'proficiencies:stealth': { of: 'expert', mode: 'atLeast', from: 3 } } } }),
    expect: { skills: { stealth: 'expert' }, fallbacks: [] }, flips: null, print: 'ruling 1 + ruling 2; Tweaks floors at their start level (part B B1/B2, plan 3.4 item 1)',
  });
  add({
    id: 'AL1', title: 'Custom background Lore "Lore of the Sea" + an increase stored on the old key lore:lore-of-the-sea at 3', finding: 9, dir: 'control',
    build: human({
      level: 3,
      backgroundId: CUSTOM_BACKGROUND_ID,
      customBackground: { name: 'Sailor', description: '', boosts: ['str', 'con'], trainedSkill: 'athletics', loreSubject: 'Lore of the Sea', skillFeatId: null },
      skillIncreases: { 3: 'lore:lore-of-the-sea' },
    }),
    expect: { skills: { 'lore:sea': 'expert' } }, flips: null, print: 'part B Lore-row move kept (the old-key alias, plan 1.1 row 21)',
  });

  // ---- finding 8: the language-Lore rerun reads ranks (D2). Multilingual: +1 language at master Society.
  // Lorekeeper Shisk trains Society at 1st; today the increases at 3 and 7 run first and swallow it (expert);
  // print: trained at 1, expert at 3, master at 7 → one more language slot, so the Lore keeps its Int slot.
  // Measured on today's engine: Int +2 (2 slots, 1 held by the Lore) + Multilingual 2 = 3 slots at expert
  // Society, 4 at master. Four picked languages: today's legacy count (3) reruns and drops the Lore; print (4) fits.
  add({
    id: 'LL1', title: 'Lore instead of language + Multilingual: the print Society rank (master) gives the slot the Lore needs', finding: 8, dir: 'control',
    build: shisk({
      level: 7,
      levelBoosts: ['str', 'con', 'dex', 'int'],
      variantRules: { loreInsteadOfLanguage: true },
      languageLores: ['Sailing'],
      languages: ['common', 'celestial', 'dwarven', 'alghollthu'],
      featPicks: { [slot(3, 'fighter', 'general')]: 'multilingual' },
      skillIncreases: { 3: 'society', 7: 'society' },
    }),
    expect: { skills: { society: 'master', 'lore:sailing': 'trained' } }, flips: null, print: 'ruling 1 (the rerun reads the print ranks, D2)',
  });

  // ---- finding 8: the reverse build (test/skill-rank-reverse-build.test.ts). A BUILD-LESS character: built,
  // then `skillIncreases` deleted and Stealth set to expert, then deriveBuildFromCharacter → rebuild.
  add({
    id: 'RB1', title: 'Reverse build: Kholo Lore at 1, Stealth expert, no stored increases', finding: 8, tag: 'RB', dir: 'control',
    build: kholo({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 3: 'stealth' } }),
    reverse: { set: { stealth: 'expert' } },
    expect: { skills: { stealth: 'expert' }, increases: ['3:stealth'] }, flips: null, print: 'ruling 1: the rebuilt increase at 3 lands after the 1st-level training',
  });
  add({
    id: 'RB2', title: 'Reverse build: Kholo Lore at 5, Stealth expert, no stored increases', finding: 8, tag: 'RB', dir: 'control',
    build: kholo({ level: 5, featPicks: { [slot(5, 'fighter', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 5: 'stealth' } }),
    reverse: { set: { stealth: 'expert' } },
    // skill-order WP8: RB2 — the synthesized increase lands at the first level the baseline holds Stealth trained (5th), not 3rd
    expect: { skills: { stealth: 'expert' }, increases: ['5:stealth'] }, flips: null, print: 'the reverse build places a rebuilt increase after the training it builds on (findings fix step 7)',
  });

  return C;
}

/* ---------------------------------------------------------------------------------------------------- */
/* the Builder's own readers (test/skill-rank-readers.test.tsx) — every one flips in WP7                  */
/* ---------------------------------------------------------------------------------------------------- */
/** What a reader shows. Only the fields a case names are compared. */
export interface SkillOrderReaderObs {
  /** The increase picker's row name, e.g. "Athletics (U → T)". */
  label?: string;
  /** The row / option is greyed. */
  disabled?: boolean;
  /** The picked feat's prerequisites are met (no "no longer met" badge). */
  met?: boolean;
  /** The replacement card's heading (the text before " — replacement skill"). */
  heading?: string;
  /** Explain timeline: lines (`<level> <text>[ [detail]] = <rank>`) that must each be present. */
  lines?: string[];
  /** Explain timeline: the last line's rank. */
  lastRank?: ProficiencyRank;
  /** The feat picker offers the candidate as met (shown, no "Requires (unmet)"). */
  offeredAsMet?: boolean;
}
export interface SkillOrderReaderCase {
  id: string;
  title: string;
  finding: 7 | 8;
  tag: 'P';
  /** A case proving a source from a LATER point is not counted; its twin proves an EARLIER one is. */
  lower?: true;
  twin?: string;
  dir: 'before' | 'after' | 'same' | 'control';
  reader: 'increase' | 'prereq' | 'fallbackHeading' | 'explain' | 'trainedSlot' | 'featPicker';
  build: BuildState;
  /** The level page opened (increase, prereq, trained slot, feat picker, fallback heading). */
  page?: number;
  /** The skill read (increase picker row, explain timeline, trained-skill option). */
  skill?: string;
  /** The feat whose card / slot / replacement is read; for `featPicker`, the CANDIDATE's id. */
  feat?: string;
  /** `trainedSlot`: which "Trained skill" control of that feat (0 = first). */
  nth?: number;
  /** `featPicker`: the slot whose picker is opened. */
  slotKey?: string;
  expect: SkillOrderReaderObs;
  flips: 'WP7' | null;
  today?: SkillOrderReaderObs;
  print: string;
}

function readerCases(): SkillOrderReaderCase[] {
  const C: SkillOrderReaderCase[] = [];
  const add = (c: SkillOrderReaderCase) => C.push(c);
  const P = 'ruling 1: the level-N page reads the ranks at level N (findings 7)';
  // P1 / P1b — Barbarian Dedication at 4 (later) / at 2 (earlier), the level-3 increase picker.
  add({
    id: 'P1', title: 'Level-3 increase picker, Barbarian Dedication taken at 4: Athletics is untrained at 3', finding: 7, tag: 'P', lower: true, twin: 'P1b', dir: 'before', reader: 'increase', page: 3, skill: 'Athletics',
    build: human({ level: 5, featPicks: { [slot(4, 'fighter', 'class')]: 'barbarian-dedication' } }),
    // skill-order WP7: P1 — the increase picker reads the per-level history (ruling 1)
    expect: { label: 'Athletics (U → T)', disabled: false }, flips: null, print: P,
  });
  add({
    id: 'P1b', title: 'Level-3 increase picker, Barbarian Dedication taken at 2: Athletics is trained at 3', finding: 7, tag: 'P', dir: 'after', reader: 'increase', page: 3, skill: 'Athletics',
    build: human({ level: 5, featPicks: { [slot(2, 'fighter', 'class')]: 'barbarian-dedication' } }),
    expect: { label: 'Athletics (T → E)', disabled: false }, flips: null, print: P,
  });
  // P2 / P2b — skilled human (expert at 5).
  add({
    id: 'P2', title: 'Level-3 increase picker, skilled human Athletics (expert only at 5)', finding: 7, tag: 'P', lower: true, twin: 'P2b', dir: 'before', reader: 'increase', page: 3, skill: 'Athletics',
    build: mk({ level: 5, classId: 'fighter', ancestryId: 'human', heritageId: 'skilled-human', heritageSkill: 'athletics' }),
    // skill-order WP7: P2 — the increase picker reads the per-level history (ruling 1)
    expect: { label: 'Athletics (T → E)', disabled: false }, flips: null, print: P,
  });
  add({
    id: 'P2b', title: 'Level-7 increase picker, skilled human Athletics: the 5th-level expert step counts', finding: 7, tag: 'P', dir: 'after', reader: 'increase', page: 7, skill: 'Athletics',
    build: mk({ level: 7, classId: 'fighter', ancestryId: 'human', heritageId: 'skilled-human', heritageSkill: 'athletics' }),
    expect: { label: 'Athletics (E → M)', disabled: false }, flips: null, print: P,
  });
  // P3 / P3b — Kholo Lore at 5 / at 1.
  add({
    id: 'P3', title: 'Level-3 increase picker, Kholo Lore taken at 5: Stealth is untrained at 3', finding: 7, tag: 'P', lower: true, twin: 'P3b', dir: 'before', reader: 'increase', page: 3, skill: 'Stealth',
    build: kholo({ level: 5, featPicks: { [slot(5, 'fighter', 'ancestry')]: 'kholo-lore' } }),
    // skill-order WP7: P3 — the increase picker reads the per-level history (ruling 1)
    expect: { label: 'Stealth (U → T)', disabled: false }, flips: null, print: P,
  });
  add({
    id: 'P3b', title: 'Level-3 increase picker, Kholo Lore taken at 1: Stealth is trained at 3', finding: 7, tag: 'P', dir: 'after', reader: 'increase', page: 3, skill: 'Stealth',
    build: kholo({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' } }),
    expect: { label: 'Stealth (T → E)', disabled: false }, flips: null, print: P,
  });
  // P4 / P4b — Ancient Ash Stealth (expert at 5).
  add({
    id: 'P4', title: 'Level-3 increase picker, Ancient Ash Stealth (expert only at 5)', finding: 7, tag: 'P', lower: true, twin: 'P4b', dir: 'before', reader: 'increase', page: 3, skill: 'Stealth',
    build: ash({ level: 5 }),
    // skill-order WP7: P4 — the increase picker reads the per-level history (ruling 1)
    expect: { label: 'Stealth (T → E)', disabled: false }, flips: null, print: P,
  });
  add({
    id: 'P4b', title: 'Level-7 increase picker, Ancient Ash Stealth: the 5th-level expert step counts', finding: 7, tag: 'P', dir: 'after', reader: 'increase', page: 7, skill: 'Stealth',
    build: ash({ level: 7 }),
    expect: { label: 'Stealth (E → M)', disabled: false }, flips: null, print: P,
  });
  // P5 / P5b — a feat needing expert X: at 3 with X's expert increase at 5 (not met) / at 4 after the increase at 3 (met).
  add({
    id: 'P5', title: 'Powerful Leap (expert in Athletics) taken at 3, Athletics expert only by the increase at 5', finding: 7, tag: 'P', lower: true, twin: 'P5b', dir: 'before', reader: 'prereq', page: 3, feat: 'powerful-leap',
    build: human({ level: 5, classSkills: ['athletics'], featPicks: { [slot(3, 'fighter', 'general')]: 'powerful-leap' }, skillIncreases: { 5: 'athletics' } }),
    // skill-order WP7: P5 — checkPrerequisites reads the end of the slot's level (D5)
    expect: { met: false }, flips: null, print: 'D5: a prerequisite holds at the end of the record\'s level',
  });
  add({
    id: 'P5b', title: 'Athletics increase at 3, Powerful Leap at 4: the prerequisite is met', finding: 7, tag: 'P', dir: 'after', reader: 'prereq', page: 4, feat: 'powerful-leap',
    build: human({ level: 5, classSkills: ['athletics'], featPicks: { [slot(4, 'fighter', 'skill')]: 'powerful-leap' }, skillIncreases: { 3: 'athletics' } }),
    expect: { met: true }, flips: null, print: 'D5',
  });
  // P6 — the replacement heading reads the rank when the feat was taken (B1 + a later Athletics increase).
  add({
    id: 'P6', title: 'B1 + an Athletics increase at 5: the replacement heading says trained (the rank at 4), not expert', finding: 7, tag: 'P', dir: 'control', reader: 'fallbackHeading', page: 4, feat: 'barbarian-dedication',
    build: human({ level: 5, skillIncreases: { 3: 'athletics', 5: 'athletics' }, featPicks: { [slot(4, 'fighter', 'class')]: 'barbarian-dedication' } }),
    // skill-order WP7: P6 — the replacement heading reads the feat's print place (ruling 2)
    expect: { heading: 'Already trained in Athletics' }, flips: null, print: 'ruling 2: "already trained … when the feat is taken"',
  });
  // P7 — the "how was this calculated" timeline names Kholo Lore at 1st and the increase at 3rd (K1).
  add({
    id: 'P7', title: "K1's Stealth timeline names Kholo Lore at 1st and the increase at 3rd", finding: 8, tag: 'P', dir: 'control', reader: 'explain', skill: 'stealth',
    build: kholo({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'kholo-lore' }, skillIncreases: { 3: 'stealth' } }),
    // skill-order WP7: P7 — the timeline reads the per-level history and names the record
    expect: { lines: ['1 Trained [Kholo Lore] = trained', '3 Skill increase → Expert = expert'], lastRank: 'expert' }, flips: null,
    print: 'plan section 2, explain row',
  });
  // P8 / P8b — Gildedsoul's 1st-level "Trained skill" slot.
  add({
    id: 'P8', title: 'Gildedsoul at 1 answered Diplomacy + a Society increase at 3: Society is not greyed in the 1st-level slot', finding: 7, tag: 'P', lower: true, twin: 'P8b', dir: 'before', reader: 'trainedSlot', page: 1, feat: 'gildedsoul', skill: 'Society', nth: 0,
    build: human({ level: 3, featPicks: { [slot(1, 'fighter', 'ancestry')]: 'gildedsoul' }, featSkillChoices: { 'gildedsoul:0': 'diplomacy' }, skillIncreases: { 3: 'society' } }),
    // skill-order WP7: P8 — the "Trained skill" slot reads the feat's print place (ruling 1)
    expect: { disabled: false }, flips: null, print: 'ruling 1: at 1st level Society is untrained',
  });
  add({
    id: 'P8b', title: 'Gildedsoul at 1 answered Diplomacy, Society trained by the 1st-level class pick: greyed', finding: 7, tag: 'P', dir: 'after', reader: 'trainedSlot', page: 1, feat: 'gildedsoul', skill: 'Society', nth: 0,
    build: human({ level: 3, classSkills: ['society'], featPicks: { [slot(1, 'fighter', 'ancestry')]: 'gildedsoul' }, featSkillChoices: { 'gildedsoul:0': 'diplomacy' } }),
    expect: { disabled: true }, flips: null, print: 'ruling 2',
  });
  // P9 / P9b — Rogue Dedication's "any" slot.
  add({
    id: 'P9', title: 'Rogue Dedication at 2 + an Arcana increase at 3: Arcana is not greyed in its "any" slot', finding: 7, tag: 'P', lower: true, twin: 'P9b', dir: 'before', reader: 'trainedSlot', page: 2, feat: 'rogue-dedication', skill: 'Arcana', nth: 1,
    build: human({ level: 3, featPicks: { [slot(2, 'fighter', 'class')]: 'rogue-dedication' }, skillIncreases: { 3: 'arcana' } }),
    // skill-order WP7: P9 — the "Trained skill" slot reads the feat's print place (ruling 1)
    expect: { disabled: false }, flips: null, print: 'ruling 1: at 2nd level Arcana is untrained',
  });
  add({
    id: 'P9b', title: 'Rogue Dedication at 2, Arcana trained by the 1st-level class pick: greyed', finding: 7, tag: 'P', dir: 'after', reader: 'trainedSlot', page: 2, feat: 'rogue-dedication', skill: 'Arcana', nth: 1,
    build: human({ level: 3, classSkills: ['arcana'], featPicks: { [slot(2, 'fighter', 'class')]: 'rogue-dedication' } }),
    expect: { disabled: true }, flips: null, print: 'ruling 2',
  });
  /* P9c — the EARLIER source sits BETWEEN 1st level and the feat's level (skill-order WP7 round 2, checker finding
   * 2): P8b and P9b train their skill at 1st, so a slot reader that read only the creation ranks passed them. Here
   * only a 3rd-level increase trains Arcana, so such a reader offers it and fails. (No Gildedsoul twin: a lineage
   * feat is taken only at 1st level.) */
  add({
    id: 'P9c', title: 'Rogue Dedication at 4, Arcana trained by the 3rd-level increase: greyed in its "any" slot', finding: 7, tag: 'P', dir: 'after', reader: 'trainedSlot', page: 4, feat: 'rogue-dedication', skill: 'Arcana', nth: 1,
    build: human({ level: 4, featPicks: { [slot(4, 'fighter', 'class')]: 'rogue-dedication' }, skillIncreases: { 3: 'arcana' } }),
    expect: { disabled: true }, flips: null, print: 'ruling 2: trained from ANY source when the feat is taken (an increase included)',
  });
  // P10 / P10b — the feat picker of the slot the occupant fills: a candidate replaces it, so its Athletics does not count.
  add({
    id: 'P10', title: "Barbarian Dedication in 2:class:0, no other Athletics: that slot's picker shows Athletic Strategist as not met", finding: 7, tag: 'P', lower: true, twin: 'P10b', dir: 'before', reader: 'featPicker', page: 2, feat: 'athletic-strategist', slotKey: '2:class:0',
    build: investigator({ level: 2, featPicks: { [slot(2, 'investigator', 'class')]: 'barbarian-dedication' } }),
    // skill-order WP7: P10 — the feat picker leaves the slot's occupant subtree out (plan section 2)
    expect: { offeredAsMet: false }, flips: null, print: 'plan section 2: a candidate replaces the occupant (its subtree is left out)',
  });
  add({
    id: 'P10b', title: 'As P10, Athletics trained by the 1st-level class pick: Athletic Strategist is met', finding: 7, tag: 'P', dir: 'after', reader: 'featPicker', page: 2, feat: 'athletic-strategist', slotKey: '2:class:0',
    build: investigator({ level: 2, classSkills: ['athletics'], featPicks: { [slot(2, 'investigator', 'class')]: 'barbarian-dedication' } }),
    expect: { offeredAsMet: true }, flips: null, print: 'plan section 2',
  });
  return C;
}

/* ---------------------------------------------------------------------------------------------------- */
/* the shared readers (the guard test, its premise tests and the parity family read through these)      */
/* ---------------------------------------------------------------------------------------------------- */
const rankOf = (ch: Character, key: string): ProficiencyRank => (ch.proficiencies.skills[key as ProficiencyKey] ?? 'untrained') as ProficiencyRank;
/** `featId:skill`, sorted — the slot half of a slot fallback is left out on purpose (the list names the record). */
export const fallbacksOf = (ch: Character): string[] => (ch.skillFallbacks ?? []).map((f) => `${f.featId}:${f.skill}`).sort();
/** Does a feat row match `id`, `id@level`, `id<grantedBy` or `id@level<grantedBy`? */
export function featRowMatches(row: { featId: string; level: number; grantedBy?: string }, token: string): boolean {
  const m = /^([^@<]+)(?:@(\d+))?(?:<(.+))?$/.exec(token);
  if (!m) throw new Error(`bad feat token ${token}`);
  return row.featId === m[1] && (m[2] === undefined || row.level === Number(m[2])) && (m[3] === undefined || row.grantedBy === m[3]);
}
/** The stored answers named by `keys` after the Builder notice's open + Save stamp (WP9), or `{}` while that
 *  path does not exist or does not stamp `skillOrder: 2`. */
export function answersThroughStamp(build: BuildState, db: ContentDatabase, keys: string[]): Record<string, string> {
  const s = save as unknown as Record<string, ((b: BuildState, c: ContentDatabase) => BuildState) | undefined>;
  const open = s.openForSkillOrder;
  const stamp = s.stampSkillOrderSave;
  if (typeof open !== 'function' || typeof stamp !== 'function') return {};
  const out = stamp(open(build, db), db);
  if ((out as BuildState & { skillOrder?: number }).skillOrder !== 2) return {};
  const got: Record<string, string> = {};
  for (const k of keys) {
    const v = (out.featSkillChoices as Record<string, string> | undefined)?.[k];
    if (v !== undefined) got[k] = v;
  }
  return got;
}
/**
 * What the built character shows for every group `shape` names, in `shape`'s own form: skills by the keys it
 * names; fallbacks as the exact sorted list; fallbacksLack / featsLack / featsHave / grantedSkillsLack as the
 * named tokens that hold (so an equal value means "all hold"); storedAnswers through the stamp path.
 */
export function observe(shape: SkillOrderExpect, ch: Character, build: BuildState, db: ContentDatabase): SkillOrderExpect {
  const out: SkillOrderExpect = {};
  if (shape.skills) out.skills = Object.fromEntries(Object.keys(shape.skills).map((k) => [k, rankOf(ch, k)]));
  if (shape.fallbacks) out.fallbacks = fallbacksOf(ch);
  if (shape.fallbacksLack) out.fallbacksLack = shape.fallbacksLack.filter((t) => !fallbacksOf(ch).includes(t));
  if (shape.featsHave) out.featsHave = shape.featsHave.filter((t) => ch.feats.some((f) => featRowMatches(f, t)));
  if (shape.featsLack) out.featsLack = shape.featsLack.filter((t) => !ch.feats.some((f) => featRowMatches(f, t)));
  if (shape.grantedSkillsLack) out.grantedSkillsLack = shape.grantedSkillsLack.filter((k) => !(k in (ch.grantedSkills ?? {})));
  if (shape.storedAnswers) out.storedAnswers = answersThroughStamp(build, db, Object.keys(shape.storedAnswers));
  if (shape.increases) out.increases = (ch.skillIncreases ?? []).map((s) => `${s.level}:${s.skill}`).sort();
  return out;
}

/** Every record id a case names that `db` lacks (D17: a renamed id must fail the premise test loudly, never
 *  hide inside an `it.fails`). */
export function unresolvedIds(c: { build: BuildState; expect?: object; today?: object; feat?: string }, db: ContentDatabase): string[] {
  const b = c.build;
  const out: string[] = [];
  const need = (bucket: 'classes' | 'ancestries' | 'heritages' | 'backgrounds' | 'deities' | 'feats' | 'classFeatures', id: string | null | undefined, what: string) => {
    if (id && !(db[bucket] as Record<string, unknown> | undefined)?.[id]) out.push(`${what} ${id}`);
  };
  need('classes', b.classId, 'class');
  need('classes', b.classId2, 'second class');
  need('ancestries', b.ancestryId, 'ancestry');
  need('heritages', b.heritageId, 'heritage');
  if (b.backgroundId !== CUSTOM_BACKGROUND_ID) need('backgrounds', b.backgroundId, 'background');
  need('deities', b.deityId, 'deity');
  need('feats', c.feat, 'read feat');
  for (const id of Object.values(b.featPicks ?? {})) need('feats', id, 'feat');
  for (const k of Object.keys(b.featSkillChoices ?? {})) need('feats', k.split(':')[0], 'answered feat');
  for (const k of Object.keys(b.effectChoices ?? {})) {
    const rec = k.split(':')[0];
    if (!db.heritages[rec] && !db.feats[rec]) out.push(`choice record ${rec}`);
  }
  for (const vals of Object.values(b.extraChoices ?? {})) for (const v of vals as string[]) need('classFeatures', v, 'class option');
  for (const e of [c.expect ?? {}, c.today ?? {}] as SkillOrderExpect[]) {
    for (const t of [...(e.featsHave ?? []), ...(e.featsLack ?? [])]) {
      const [, id, , granter] = /^([^@<]+)(@\d+)?(?:<(.+))?$/.exec(t) ?? [];
      need('feats', id, 'feat row');
      if (granter) need('feats', granter, 'granter');
    }
    for (const f of [...(e.fallbacks ?? []), ...(e.fallbacksLack ?? [])]) {
      const id = f.split(':')[0];
      if (!db.feats[id] && !db.classFeatures[id]) out.push(`fallback record ${id}`);
    }
  }
  return out;
}

let built: SkillOrderCase[] | null = null;
let builtReaders: SkillOrderReaderCase[] | null = null;
/** Every build case (computed once; slot keys need the content database). */
export function skillOrderCases(): SkillOrderCase[] {
  return (built ??= cases());
}
export function skillOrderReaderCases(): SkillOrderReaderCase[] {
  return (builtReaders ??= readerCases());
}
export const SKILL_ORDER_CASES: SkillOrderCase[] = skillOrderCases();
export const SKILL_ORDER_READER_CASES: SkillOrderReaderCase[] = skillOrderReaderCases();
