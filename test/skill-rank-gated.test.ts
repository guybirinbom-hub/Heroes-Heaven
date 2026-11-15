/**
 * RANK-GATED FEAT GRANTS, decided on the per-level skill history (skill-order plan D10, 1.4; WP4; guard G5).
 *
 * FEAT_RANK_FEAT_GRANTS hands a feat over when a skill rank holds: Stonemason's Eye and Intuitive Crafting
 * ("if you're ALREADY trained in Crafting, you instead gain Specialty Crafting"), Gildedsoul ("if you're trained
 * in Society … Courtly Graces"), Student of Water and Raging Intimidation ("AS SOON AS you meet the
 * prerequisites … you gain these feats"). Before WP4 the feat-grant queue decided them, before the skill ranks
 * were worked out level by level, and a later skill increase answered "already trained when taken" (findings
 * case 5). WP4 moves the decision after the resolve (`rankGatedGrants`), so the granted rows no longer exist
 * while the passes between the queue and the resolve run. G5 pins that this is safe: none of the six granted
 * records carries anything those passes read (the FIELD LIST below), except the one `hasFeat` reader the pass
 * re-runs for (D6).
 */
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, rankGatedGrants, skillOrderLegacyOf, type BuildState } from '../src/rules/build';
import {
  CHOICE_FEAT_GRANTS,
  EXTRA_FEAT_TAKINGS,
  FEAT_FEAT_GRANTS,
  FEAT_FEAT_GRANTS_LEVELED,
  FEAT_RANK_FEAT_GRANTS,
  FEAT_SUBSTITUTE_GRANTS,
  SKILL_RANK_BEFORE_OWN_GRANTS,
} from '../src/rules/featFeatGrants';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { mk, slot, SKILL_ORDER_CASES } from './fixtures/skill-order-cases';
import type { Character, ContentDatabase, SkillHistory, SkillStep } from '../src/rules/types';

const db = content();

/** Every feat a FEAT_RANK_FEAT_GRANTS entry hands over (the six granted records). */
const GRANTED = [...new Set(Object.values(FEAT_RANK_FEAT_GRANTS).flatMap((rows) => rows.map((r) => r.feat)))].sort();

/*
 * THE FIELD LIST (plan WP4 step 1). The passes between the feat-grant queue and the resolve point that read feat
 * rows, and what each reads of a row's record:
 *   - the queue's own expansion of a granted feat (it was queued as a granter): FEAT_FEAT_GRANTS,
 *     CHOICE_FEAT_GRANTS, FEAT_FEAT_GRANTS_LEVELED, FEAT_SUBSTITUTE_GRANTS, EXTRA_FEAT_TAKINGS,
 *     FEAT_RANK_FEAT_GRANTS (keyed by the granted id), and the `skillRankBefore` snapshot
 *     (SKILL_RANK_BEFORE_OWN_GRANTS, keyed by a held carrier);
 *   - the removal pass and the level sort (the id and level only; `rankGatedGrants` applies both itself);
 *   - the feat-proficiency pass (`grantSourcesForProficiency`): FEAT_GRANTS through `grantsFor` (skills,
 *     skillChoices, conditionalSkills, loreChoices, choiceGrants, proficiency and armor grants, rank upgrades);
 *   - Molten Wit's three branches (its own id only);
 *   - the effect picks and enhancements (`effectChoices`, `enhancement`, `enhancementPicker` on the record; the
 *     enhancement loop reads `enhancementPicker.choiceIds` on every row before the resolve) and the feat plain choice
 *     (`choice.options[].grant`); the record's own `grantsFeats` (the flat lane; read before the queue, listed
 *     so a record that gains it is looked at again);
 *   - a judge's `hasFeat` (FEAT_GRANTS `redundantFallbackIfFeat`): the one reader that names a granted feat
 *     (Intuitive Crafting → Specialty Crafting). The pass runs again with the rank-gated rows (D6), so it is
 *     allowed for exactly the ids in HASFEAT_RERUN, and the dwarf case below proves the re-run.
 */
const HASFEAT_RERUN = ['specialty-crafting'];
function fieldListViolations(d: ContentDatabase): string[] {
  const bad: string[] = [];
  const tables: [string, Record<string, unknown>][] = [
    ['FEAT_GRANTS', FEAT_GRANTS],
    ['FEAT_FEAT_GRANTS', FEAT_FEAT_GRANTS],
    ['CHOICE_FEAT_GRANTS', CHOICE_FEAT_GRANTS],
    ['FEAT_FEAT_GRANTS_LEVELED', FEAT_FEAT_GRANTS_LEVELED],
    ['FEAT_SUBSTITUTE_GRANTS', FEAT_SUBSTITUTE_GRANTS],
    ['EXTRA_FEAT_TAKINGS', EXTRA_FEAT_TAKINGS],
    ['FEAT_RANK_FEAT_GRANTS', FEAT_RANK_FEAT_GRANTS],
    ['SKILL_RANK_BEFORE_OWN_GRANTS', SKILL_RANK_BEFORE_OWN_GRANTS],
  ];
  for (const id of GRANTED) {
    const rec = d.feats[id] as unknown as Record<string, unknown> | undefined;
    if (!rec) {
      bad.push(`${id}: not in content`);
      continue;
    }
    for (const f of ['effectChoices', 'enhancement', 'enhancementPicker', 'grantsFeats']) if (rec[f] !== undefined) bad.push(`${id}: record field ${f}`);
    const opts = (rec.choice as { options?: { grant?: unknown }[] } | undefined)?.options ?? [];
    if (opts.some((o) => o.grant !== undefined)) bad.push(`${id}: record field choice.options[].grant`);
    for (const [name, t] of tables) if (t[id] !== undefined) bad.push(`${id}: ${name} entry`);
  }
  for (const [carrier, g] of Object.entries(FEAT_GRANTS)) {
    const f = g.redundantFallbackIfFeat;
    if (f && GRANTED.includes(f) && !HASFEAT_RERUN.includes(f)) bad.push(`${carrier}: redundantFallbackIfFeat ${f} (not in HASFEAT_RERUN)`);
  }
  return bad;
}

describe('G5: the six granted records carry nothing the passes before the resolve read', () => {
  it('the granted set is the six records D10 names', () => {
    expect(GRANTED).toEqual(['courtly-graces', 'intimidating-glare', 'scare-to-death', 'specialty-crafting', 'underwater-marauder', 'water-sprint']);
  });
  it('no granted record has a field on the field list', () => {
    expect(fieldListViolations(db)).toEqual([]);
  });
  it('planted: Specialty Crafting with an effectChoices is caught', () => {
    const patched = { ...db, feats: { ...db.feats, 'specialty-crafting': { ...db.feats['specialty-crafting'], effectChoices: [{ id: 'x', options: [] }] } } } as unknown as ContentDatabase;
    expect(fieldListViolations(patched)).toEqual(['specialty-crafting: record field effectChoices']);
  });
  it('planted: Specialty Crafting with an enhancementPicker is caught', () => {
    const patched = { ...db, feats: { ...db.feats, 'specialty-crafting': { ...db.feats['specialty-crafting'], enhancementPicker: { choiceIds: ['x'] } } } } as unknown as ContentDatabase;
    expect(fieldListViolations(patched)).toEqual(['specialty-crafting: record field enhancementPicker']);
  });
  it('planted: a choice option with a grant is caught', () => {
    const sc = db.feats['specialty-crafting'];
    const patched = {
      ...db,
      feats: { ...db.feats, 'specialty-crafting': { ...sc, choice: { ...sc.choice!, options: [{ value: 'a', label: 'A', grant: { skills: { arcana: 'trained' } } }] } } },
    } as unknown as ContentDatabase;
    expect(fieldListViolations(patched)).toEqual(['specialty-crafting: record field choice.options[].grant']);
  });
  it('HASFEAT_RERUN is exactly the granted ids a redundantFallbackIfFeat names', () => {
    const named = Object.values(FEAT_GRANTS).map((g) => g.redundantFallbackIfFeat).filter((f): f is string => !!f && GRANTED.includes(f));
    expect([...new Set(named)].sort()).toEqual(HASFEAT_RERUN);
  });
});

describe('every FEAT_RANK_FEAT_GRANTS entry says which moment it reads (`when`)', () => {
  it('the exact moment per entry, from each record\'s own sentence', () => {
    const got = Object.fromEntries(Object.entries(FEAT_RANK_FEAT_GRANTS).map(([k, rows]) => [k, rows.map((r) => `${r.feat}:${r.when}`)]));
    expect(got).toEqual({
      'stonemasons-eye': ['specialty-crafting:taken'], // "If you're ALREADY trained in Crafting"
      'intuitive-crafting': ['specialty-crafting:taken'], // "If you were ALREADY trained in Crafting"
      gildedsoul: ['courtly-graces:standing'], // "If you're trained in Society" (R9, today's reading kept)
      'student-of-water': ['underwater-marauder:reached', 'water-sprint:reached'], // "As soon as you meet the prerequisites"
      'raging-intimidation': ['intimidating-glare:reached', 'scare-to-death:reached'], // the same sentence
    });
  });
  it('countOwnGrant only on a standing entry (it is the one moment that may count the carrier\'s own grant)', () => {
    for (const rows of Object.values(FEAT_RANK_FEAT_GRANTS)) for (const r of rows) if (r.countOwnGrant) expect(r.when).toBe('standing');
  });
});

/* ---- the pure decision, on synthetic histories ---------------------------------------------------- */
const step = (level: number, phase: SkillStep['phase'], key: string, from: string, to: string, source: string): SkillStep =>
  ({ level, phase, key, from, to, source }) as SkillStep;
const hist = (steps: SkillStep[], at: Record<string, number>): SkillHistory => ({ v: 1, steps, at });

describe('rankGatedGrants (pure)', () => {
  const TABLE = FEAT_RANK_FEAT_GRANTS;
  it("'taken' reads the rank just before the carrier's own place, never a later increase", () => {
    // Crafting trained by the feat itself at 1, expert by an increase at 3.
    const h = hist([step(1, 'feat', 'crafting', 'untrained', 'trained', 'feat:stonemasons-eye'), step(3, 'increase', 'crafting', 'trained', 'expert', 'increase:3')], { 'feat:stonemasons-eye': 0 });
    expect(rankGatedGrants({ skillHistory: h, level: 3 }, { crafting: 'expert' }, [{ featId: 'stonemasons-eye', level: 1 }], TABLE)).toEqual([]);
    // Crafting trained at creation, the feat after it.
    const h2 = hist([step(1, 'create', 'crafting', 'untrained', 'trained', 'class:fighter'), step(1, 'feat', 'crafting', 'trained', 'trained', 'feat:stonemasons-eye')], { 'feat:stonemasons-eye': 1 });
    expect(rankGatedGrants({ skillHistory: h2, level: 1 }, { crafting: 'trained' }, [{ featId: 'stonemasons-eye', level: 1 }], TABLE)).toEqual([
      { carrier: 'stonemasons-eye', feat: 'specialty-crafting', level: 1 },
    ]);
  });
  it("'taken' with no place in the history reads that level's ranks before its increases, without the carrier", () => {
    const h = hist([step(3, 'increase', 'crafting', 'untrained', 'trained', 'increase:3'), step(5, 'increase', 'crafting', 'trained', 'expert', 'increase:5')], {});
    expect(rankGatedGrants({ skillHistory: h, level: 5 }, { crafting: 'expert' }, [{ featId: 'stonemasons-eye', level: 3 }], TABLE)).toEqual([]);
    expect(rankGatedGrants({ skillHistory: h, level: 5 }, { crafting: 'expert' }, [{ featId: 'stonemasons-eye', level: 5 }], TABLE)).toEqual([
      { carrier: 'stonemasons-eye', feat: 'specialty-crafting', level: 5 },
    ]);
  });
  it("'reached' grants at the first level the rank holds, never before the carrier's level", () => {
    const h = hist(
      [
        step(1, 'create', 'intimidation', 'untrained', 'trained', 'classPick:intimidation'),
        step(3, 'increase', 'intimidation', 'trained', 'expert', 'increase:3'),
        step(7, 'increase', 'intimidation', 'expert', 'master', 'increase:7'),
        step(15, 'increase', 'intimidation', 'master', 'legendary', 'increase:15'),
      ],
      {},
    );
    expect(rankGatedGrants({ skillHistory: h, level: 15 }, { intimidation: 'legendary' }, [{ featId: 'raging-intimidation', level: 2 }], TABLE)).toEqual([
      { carrier: 'raging-intimidation', feat: 'intimidating-glare', level: 2 },
      { carrier: 'raging-intimidation', feat: 'scare-to-death', level: 15 },
    ]);
    // A 14th-level character (no 15th-level step): legendary is never reached, so no Scare to Death.
    const h14 = hist(h.steps.filter((s) => s.level <= 14), {});
    expect(rankGatedGrants({ skillHistory: h14, level: 14 }, { intimidation: 'master' }, [{ featId: 'raging-intimidation', level: 1 }], TABLE)).toEqual([
      { carrier: 'raging-intimidation', feat: 'intimidating-glare', level: 1 },
    ]);
  });
  it("'standing' with countOwnGrant reads the finished rank (Gildedsoul)", () => {
    const h = hist([step(3, 'increase', 'society', 'untrained', 'trained', 'increase:3')], { 'feat:gildedsoul': 0 });
    expect(rankGatedGrants({ skillHistory: h, level: 3 }, { society: 'trained' }, [{ featId: 'gildedsoul', level: 1 }], TABLE)).toEqual([
      { carrier: 'gildedsoul', feat: 'courtly-graces', level: 1 },
    ]);
    expect(rankGatedGrants({ skillHistory: h, level: 3 }, {}, [{ featId: 'gildedsoul', level: 1 }], TABLE)).toEqual([]);
  });
  it('without a history every entry reads the finished rank', () => {
    expect(rankGatedGrants({ level: 3 } as Pick<Character, 'skillHistory' | 'level'>, { crafting: 'trained' }, [{ featId: 'stonemasons-eye', level: 1 }], TABLE)).toEqual([
      { carrier: 'stonemasons-eye', feat: 'specialty-crafting', level: 1 },
    ]);
  });
});

/* ---- in the engine ---------------------------------------------------------------------------------- */
const rowsOf = (ch: Character, feat: string) => ch.feats.filter((f) => f.featId === feat).map((f) => `${f.featId}@${f.level}${f.grantedBy ? `<${f.grantedBy}` : ''}`);
const caseBuild = (id: string): BuildState => SKILL_ORDER_CASES.find((c) => c.id === id)!.build;
const dwarfNephilim = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'dwarf', heritageId: 'nephilim', ...o });
const monk = (o: Partial<BuildState>) => mk({ classId: 'monk', keyAbility: 'str', ancestryId: 'human', heritageId: 'versatile-human', ...o });

describe('rank-gated grants in the engine', () => {
  it('IG1: a Tweaks-removed Intimidating Glare stays removed (D10 a)', () => {
    const ch = buildCharacter(caseBuild('IG1'), db);
    expect(rowsOf(ch, 'intimidating-glare')).toEqual([]);
    expect(rowsOf(ch, 'raging-intimidation').length).toBe(1);
  });
  it('a Tweaks-removed Raging Intimidation keeps Intimidating Glare (part B: a removal takes only that feat)', () => {
    // WP4 checker round 1, finding 1: today's queue ran before the removal pass, and Tweaks part B removes only the
    // named feat ("only this / what it gave" is phase 3, tweaks plan B25). IG1's character with the carrier removed
    // instead of the granted feat.
    const ig1 = caseBuild('IG1');
    const b: BuildState = { ...ig1, overrides: { ...ig1.overrides, removedFeatIds: ['raging-intimidation'] } };
    const ch = buildCharacter(b, db);
    expect(rowsOf(ch, 'raging-intimidation')).toEqual([]);
    expect(rowsOf(ch, 'intimidating-glare')).toEqual(['intimidating-glare@1<raging-intimidation']);
    expect(skillOrderLegacyOf(ch)?.rankGated).toEqual(['raging-intimidation>intimidating-glare']);
  });
  it('a held feat is never granted twice: Specialty Crafting taken in a skill slot stays the one row (D10 b)', () => {
    const b = mk({
      classId: 'fighter',
      ancestryId: 'dwarf',
      heritageId: 'elemental-heart-dwarf',
      level: 2,
      classSkills: ['crafting'],
      featPicks: { [slot(1, 'fighter', 'ancestry')]: 'stonemasons-eye', [slot(2, 'fighter', 'skill')]: 'specialty-crafting' },
    });
    const ch = buildCharacter(b, db);
    expect(rowsOf(ch, 'specialty-crafting')).toEqual(['specialty-crafting@2']);
  });
  it('two carriers of one feat hand it over once (Stonemason\'s Eye before Intuitive Crafting)', () => {
    const b = dwarfNephilim({
      level: 9,
      classSkills: ['crafting'],
      featPicks: { [slot(1, 'fighter', 'ancestry')]: 'stonemasons-eye', [slot(5, 'fighter', 'ancestry')]: 'aeonbound', [slot(9, 'fighter', 'ancestry')]: 'intuitive-crafting' },
    });
    const ch = buildCharacter(b, db);
    expect(rowsOf(ch, 'specialty-crafting')).toEqual(['specialty-crafting@1<stonemasons-eye']);
  });
  it('D6: Intuitive Crafting sees the Specialty Crafting a rank gate handed over before it, and owes its "if you have both" skill', () => {
    // Crafting trained at creation (class pick) → Stonemason's Eye at 1 hands over Specialty Crafting; Intuitive
    // Crafting at 9 finds Crafting trained AND Specialty Crafting held → "you instead become trained in a skill of
    // your choice" (featGrants.ts `redundantFallbackIfFeat`). The pass's first run cannot see the row (it is decided
    // from that run's history), so this is the re-run's proof.
    const b = dwarfNephilim({
      level: 9,
      classSkills: ['crafting'],
      featPicks: { [slot(1, 'fighter', 'ancestry')]: 'stonemasons-eye', [slot(5, 'fighter', 'ancestry')]: 'aeonbound', [slot(9, 'fighter', 'ancestry')]: 'intuitive-crafting' },
    });
    const ch = buildCharacter(b, db);
    expect((ch.skillFallbacks ?? []).map((f) => `${f.featId}:${f.skill}`)).toEqual(['intuitive-crafting:crafting']);
    // …and the live path (today's order) agreed: it held the row in the feat list.
    expect(skillOrderLegacyOf(ch)?.skillFallbacks.map((f) => `${f.featId}:${f.skill}`)).toEqual(['intuitive-crafting:crafting']);
  });
  it("Student of Water: Underwater Marauder at the carrier's level, Water Sprint at the level master Athletics is reached", () => {
    const b = monk({ level: 9, classSkills: ['athletics'], featPicks: { [slot(2, 'monk', 'class')]: 'student-of-water' }, skillIncreases: { 3: 'athletics', 7: 'athletics' } });
    const ch = buildCharacter(b, db);
    expect(ch.proficiencies.skills.athletics).toBe('master');
    expect(rowsOf(ch, 'underwater-marauder')).toEqual(['underwater-marauder@2<student-of-water']);
    expect(rowsOf(ch, 'water-sprint')).toEqual(['water-sprint@7<student-of-water']);
    // The feat list stays sorted by level after the rows join it (D10 c).
    expect(ch.feats.map((f) => f.level)).toEqual([...ch.feats.map((f) => f.level)].sort((x, y) => x - y));
  });
  it('the earliest source wins: a later flat grant of the same feat gives way to the rank gate, in either featPicks order', () => {
    // WP4 checker round 2, finding 1. Raging Intimidation at 1 (Intimidation trained at creation) gives Intimidating
    // Glare "as soon as you meet the prerequisites"; Sinister Appearance at 5 grants it flat. Print and today's engine
    // (carrier first in featPicks): the row is Raging Intimidation's, at 1. Before this fix the lane gave
    // intimidating-glare@5<sinister-appearance. Today's engine also gave @5 when featPicks listed Sinister Appearance
    // first (insertion-order dependence, D4); the print pass does not.
    const barb = (featPicks: Record<string, string>) => mk({ classId: 'barbarian', ancestryId: 'human', heritageId: 'versatile-human', level: 5, classSkills: ['intimidation'], featPicks });
    const ri = slot(1, 'barbarian', 'class');
    const sa = slot(5, 'barbarian', 'ancestry');
    const a = buildCharacter(barb({ [ri]: 'raging-intimidation', [sa]: 'sinister-appearance' }), db);
    expect(rowsOf(a, 'intimidating-glare')).toEqual(['intimidating-glare@1<raging-intimidation']);
    expect(skillOrderLegacyOf(a)?.rankGated).toEqual(['raging-intimidation>intimidating-glare']);
    expect(a.feats.map((f) => f.level)).toEqual([...a.feats.map((f) => f.level)].sort((x, y) => x - y));
    expect(rowsOf(buildCharacter(barb({ [sa]: 'sinister-appearance', [ri]: 'raging-intimidation' }), db), 'intimidating-glare')).toEqual(['intimidating-glare@1<raging-intimidation']);
    // Student of Water at 2, Marine Marauder Dedication at 4: Underwater Marauder is Student of Water's, at 2.
    const sw = slot(2, 'monk', 'class');
    const mm = slot(4, 'monk', 'class');
    expect(rowsOf(buildCharacter(monk({ level: 4, classSkills: ['athletics'], featPicks: { [sw]: 'student-of-water', [mm]: 'marine-marauder-dedication' } }), db), 'underwater-marauder')).toEqual([
      'underwater-marauder@2<student-of-water',
    ]);
  });
  it('an EARLIER flat grant keeps the feat: Sinister Appearance at 1, Raging Intimidation at 2', () => {
    const b = mk({
      classId: 'barbarian',
      ancestryId: 'human',
      heritageId: 'versatile-human',
      level: 2,
      classSkills: ['intimidation'],
      featPicks: { [slot(1, 'barbarian', 'ancestry')]: 'sinister-appearance', [slot(2, 'barbarian', 'class')]: 'raging-intimidation' },
    });
    expect(rowsOf(buildCharacter(b, db), 'intimidating-glare')).toEqual(['intimidating-glare@1<sinister-appearance']);
  });
  it('a SAME-LEVEL tie follows D4 (slot-draw order, a granted feat right after its granter), in either featPicks order', () => {
    // skill-order WP6L item 2 (WP4 checker's minor on deviation 58): a tie went to the flat granter whatever the order.
    // D4 (plan; Player Core pg.29, rules-2065: "in whichever order you want", so the slot-draw order is chosen).
    const FA = { freeArchetype: true };
    const sw = slot(2, 'monk', 'class', { variant: FA });
    const fa = slot(2, 'monk', 'archetype', { variant: FA });
    const monk2 = (featPicks: Record<string, string>) => monk({ level: 2, variantRules: FA, classSkills: ['athletics'], featPicks });
    // Carrier first: the class slot comes before the Free Archetype slot, and Athletics is trained from creation, so
    // Student of Water's gate opens at its own place — Underwater Marauder is its, not the dedication's.
    for (const fp of [{ [sw]: 'student-of-water', [fa]: 'marine-marauder-dedication' }, { [fa]: 'marine-marauder-dedication', [sw]: 'student-of-water' }]) {
      const ch = buildCharacter(monk2(fp), db);
      expect(rowsOf(ch, 'underwater-marauder'), Object.values(fp).join(',')).toEqual(['underwater-marauder@2<student-of-water']);
      expect(rowsOf(ch, 'marine-marauder-dedication')).toEqual(['marine-marauder-dedication@2']);
    }
    // Flat granter first: the ancestry slot comes before the class slot — Intimidating Glare is Sinister Appearance's,
    // in both orders (today's engine gave the carrier's when featPicks listed Raging Intimidation first: moves.md WP6L).
    const ri = slot(1, 'barbarian', 'class');
    const sa = slot(1, 'barbarian', 'ancestry');
    const barb1 = (featPicks: Record<string, string>) => mk({ classId: 'barbarian', ancestryId: 'human', heritageId: 'versatile-human', level: 1, classSkills: ['intimidation'], featPicks });
    for (const fp of [{ [ri]: 'raging-intimidation', [sa]: 'sinister-appearance' }, { [sa]: 'sinister-appearance', [ri]: 'raging-intimidation' }])
      expect(rowsOf(buildCharacter(barb1(fp), db), 'intimidating-glare'), Object.values(fp).join(',')).toEqual(['intimidating-glare@1<sinister-appearance']);
    // A flat granter taken on the strength of the level's own increase sits AFTER it (D5, P7), whatever its slot: a
    // Dual Class monk/rogue 2 with no Athletics until the 2nd-level increase (P6). Marine Marauder Dedication needs
    // "trained in Athletics" (feat-9030), so it moves to P7 even though it has no skill write of its own; Student of
    // Water's gate opens at the increase (P6), before it, in either slot and either featPicks order (WP6L checker
    // round 1, finding F1: the WP6L build compared the gate with the dedication's P5 slot place).
    const DC = { dualClass: true };
    const dc = (featPicks: Record<string, string>) =>
      monk({ level: 2, classId2: 'rogue', variantRules: DC, classSkills: [], skillIncreases: { 2: 'athletics' }, featPicks });
    for (const fp of [
      { '2:class:0': 'student-of-water', '2:class:1': 'marine-marauder-dedication' },
      { '2:class:1': 'marine-marauder-dedication', '2:class:0': 'student-of-water' },
      { '2:class:0': 'marine-marauder-dedication', '2:class:1': 'student-of-water' },
      { '2:class:1': 'student-of-water', '2:class:0': 'marine-marauder-dedication' },
    ]) {
      const ch = buildCharacter(dc(fp), db);
      expect(ch.proficiencies.skills.athletics).toBe('trained');
      expect(rowsOf(ch, 'underwater-marauder'), JSON.stringify(fp)).toEqual(['underwater-marauder@2<student-of-water']);
    }
    // The gate opens where the rank is REACHED when that is after the carrier: a Dual Class monk/rogue 4 with no
    // Athletics until the 4th-level increase (P6). Student of Water (class slot 0) comes first, Pirate Combat
    // Training (class slot 1, prerequisite Pirate Dedication only, so it stays at P5) hands over Underwater Marauder
    // before the increase opens the gate: the flat grant is first (the carrier's own place alone would say the carrier).
    const pct = (picks: [string, string][]) =>
      monk({
        level: 4,
        classId2: 'rogue',
        variantRules: DC,
        classSkills: ['intimidation'],
        skillIncreases: { 2: 'stealth', 4: 'athletics' },
        featPicks: Object.fromEntries(picks),
        pickFeatChoices: { 'pirate-combat-training': 'underwater-marauder' },
      });
    const pctPicks: [string, string][] = [['2:class:0', 'pirate-dedication'], ['4:class:0', 'student-of-water'], ['4:class:1', 'pirate-combat-training']];
    for (const picks of [pctPicks, [...pctPicks].reverse()]) {
      const ch = buildCharacter(pct(picks), db);
      expect(ch.proficiencies.skills.athletics).toBe('trained');
      expect(rowsOf(ch, 'underwater-marauder'), picks.map((p) => p[1]).join(',')).toEqual(['underwater-marauder@4<pirate-combat-training']);
    }
  });
  it("S1's legacy side keeps today's order's grant (the notice's \"before\", D19); the character does not", () => {
    const ch = buildCharacter(caseBuild('S1'), db);
    expect(rowsOf(ch, 'specialty-crafting')).toEqual([]);
    expect(skillOrderLegacyOf(ch)?.rankGated).toEqual(['stonemasons-eye>specialty-crafting']);
  });
  it('S2: the grant binds Stonemason\'s Eye\'s named specialty, as before', () => {
    const ch = buildCharacter(caseBuild('S2'), db);
    const row = ch.feats.find((f) => f.featId === 'specialty-crafting');
    expect(row?.grantedBy).toBe('stonemasons-eye');
    expect(row?.choice?.value).toBe('stonemasonry');
  });
});
