import { describe, it, expect, afterAll } from 'vitest';
import { content } from './_content';
import { buildCharacter, buildChoiceOptions, emptyBuild, type BuildState } from '../src/rules/build';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { dailyItemSlots } from '../src/rules/dailyItems';
import { recordMarkersFor, statHasSituational } from '../src/rules/explain';
import { ownedFeatureIds } from '../src/rules/derive';
import type { Character, ContentDatabase, FeatChoiceDef } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 031, ENGINE lane.
 *
 * Every assertion is made on a BUILT character through the reader the sheet or the builder actually
 * calls — `buildCharacter`'s own output, `buildChoiceOptions`, `dailyItemSlots`, `recordMarkersFor` /
 * `statHasSituational`. Reading a field back off a record would prove only that a row was typed.
 *
 * A finding whose fix is a DATA ROW the driver has yet to apply is tested against a content copy with
 * that row PATCHED IN MEMORY, never as a patched-vs-shipped delta: each assertion states the outcome
 * the row produces, so it reads the same before the row lands and after.
 */
const db = content();

/** A content copy with one record's fields overlaid — the in-memory stand-in for a backfill row. */
function patched(bucket: 'feats', id: string, fields: Record<string, unknown>): ContentDatabase {
  const b = db[bucket] as unknown as Record<string, Record<string, unknown>>;
  return { ...db, [bucket]: { ...b, [id]: { ...b[id], ...fields } } } as unknown as ContentDatabase;
}

/** `_content.build`, but against an arbitrary (usually patched) content database. */
function buildOn(cdb: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = cdb.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: Object.keys(cdb.ancestries)[0],
      backgroundId: Object.keys(cdb.backgrounds)[0],
      keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: (cls?.subclass?.options[0]?.id as string) ?? null,
      ...over,
    },
    cdb,
  );
}

const stateOn = (cdb: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): BuildState => {
  const cls = cdb.classes[classId];
  return {
    ...emptyBuild(),
    name: 't',
    level,
    classId,
    ancestryId: Object.keys(cdb.ancestries)[0],
    backgroundId: Object.keys(cdb.backgrounds)[0],
    keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
    subclassId: (cls?.subclass?.options[0]?.id as string) ?? null,
    ...over,
  } as BuildState;
};

/* --------------------------------------------- golden-league-xun-dedication#already-expert */

describe('golden-league-xun-dedication replaces a dead EXPERT slot at expert', () => {
  /*
   * AoN feat-2734: "You gain expert proficiency in two of the following skills (OR IN TWO OTHER SKILLS
   * OF YOUR CHOICE IN WHICH YOU'RE TRAINED, IF YOU WERE ALREADY AN EXPERT IN THE LISTED SKILLS):
   * Athletics, Deception, Intimidation, or Stealth."
   *
   * The parenthetical needs two things the fallback lane could not say: the replacement is worth
   * EXPERT (it was hard-coded to 'trained', so a character who triggered the clause bought nothing),
   * and its pool is the skills the character is ALREADY TRAINED in (any of the sixteen was accepted).
   *
   * The record's own `redundantFallback` flags live in src/rules/featGrantsAuto.ts, which is not this
   * lane's file — see CROSS-FILE GAPS in the report. So the registry entry is patched IN MEMORY here,
   * exactly as a not-yet-applied data row would be: every assertion below states the outcome the
   * flagged record produces and reads the same once the flags land.
   */
  const GLX = 'golden-league-xun-dedication';
  const shipped = FEAT_GRANTS[GLX];
  const slots = (shipped.skillChoices ?? []).map((s) => ({ ...s, redundantFallback: true as const }));
  FEAT_GRANTS[GLX] = { ...shipped, skillChoices: slots };
  afterAll(() => {
    FEAT_GRANTS[GLX] = shipped;
  });

  /** A level-8 rogue who spent two skill increases on Athletics, so the listed skill is already expert
   *  — the state the parenthetical is written for — with Acrobatics trained and Occultism untrained. */
  const xun = (over: Partial<BuildState> = {}): Character =>
    buildOn(db, 'rogue', 8, {
      classSkills: ['athletics', 'acrobatics'],
      skillIncreases: { 3: 'athletics' },
      featPicks: { '8:class:0': GLX },
      ...over,
    });

  // batch 031: golden-league-xun-dedication#already-expert
  it('golden-league-xun-dedication reports its dead slots as expert-rank replacements', () => {
    const c = xun();
    expect(c.proficiencies.skills.athletics).toBe('expert'); // the precondition the clause names
    const fb = (c.skillFallbacks ?? []).filter((f) => f.featId === GLX);
    expect(fb.length).toBeGreaterThan(0);
    expect(fb.every((f) => f.rank === 'expert')).toBe(true);
  });

  // batch 031: golden-league-xun-dedication#already-expert
  it('golden-league-xun-dedication raises a replacement the character is TRAINED in to expert', () => {
    const c = xun({ featSkillChoices: { [`${GLX}:fallback:athletics`]: 'acrobatics' } });
    expect(c.proficiencies.skills.acrobatics).toBe('expert');
  });

  // batch 031: golden-league-xun-dedication#already-expert
  it('golden-league-xun-dedication gives an UNTRAINED replacement nothing — print names skills you are trained in', () => {
    const c = xun({ featSkillChoices: { [`${GLX}:fallback:athletics`]: 'occultism' } });
    expect(c.proficiencies.skills.occultism ?? 'untrained').toBe('untrained');
  });

  // batch 031: golden-league-xun-dedication#already-expert
  it('a TRAINED-rank fallback still grants trained to an untrained pick (angelkin, unchanged)', () => {
    // The blast radius of the rank-aware replacement: every record whose dead grant was `trained`
    // behaves exactly as before, which is all but one of them.
    const c = buildOn(db, 'rogue', 3, {
      classSkills: ['society'],
      featPicks: { '1:ancestry:0': 'angelkin' },
      featSkillChoices: { 'angelkin:fallback:society': 'occultism' },
    });
    const fb = (c.skillFallbacks ?? []).find((f) => f.featId === 'angelkin');
    expect(fb?.rank).toBeUndefined();
    expect(c.proficiencies.skills.occultism).toBe('trained');
  });

  // batch 031: golden-league-xun-dedication#already-expert
  it('a conditionalRank slot never escalates its replacement (lion-blade-dedication, unchanged)', () => {
    /*
     * The other half of the blast radius, pinned rather than described. Lion Blade Dedication
     * (AoN feat-7724) prints *"You become trained in your choice of Deception or Stealth; if you were
     * already trained in that skill, you become an expert instead"* — a `conditionalRank` slot whose
     * only replacement clause is about Espionage Lore. Its record-wide `redundantFallback` still
     * reaches this slot for a character already EXPERT in the pick, and that pre-existing replacement
     * must stay exactly what it was: TRAINED, from any of the sixteen skills. Escalating it to expert
     * would hand a character print gives nothing at all here a free expert skill.
     */
    const c = buildOn(db, 'rogue', 8, {
      classSkills: ['deception', 'acrobatics'],
      skillIncreases: { 3: 'deception' },
      featPicks: { '8:class:0': 'lion-blade-dedication' },
      featSkillChoices: { 'lion-blade-dedication:fallback:deception': 'occultism' },
    });
    expect(c.proficiencies.skills.deception).toBe('expert'); // the state that makes the slot dead
    const fb = (c.skillFallbacks ?? []).find((f) => f.featId === 'lion-blade-dedication' && f.skill === 'deception');
    expect(fb).toBeDefined();
    expect(fb?.rank).toBeUndefined();
    expect(c.proficiencies.skills.occultism).toBe('trained');
  });
});

/* ------------------------------------------------------------------------- insistent-command */

describe('insistent-command shifts the degree of a Command an Animal check (feats/insistent-command)', () => {
  /* AoN feat-1207, the feat's whole text: "When you roll a success to Command an Animal, you get a
   * critical success; if you roll a critical failure, you get a failure." The record carried no
   * mechanic at all, so neither the Nature row nor the Command an Animal row said anything. The
   * `degreeShifts` lane already fans one entry onto both surfaces — the row is DATA STILL NEEDED. */
  const ROW = [
    { shift: 'successToCrit', when: 'on a check to Command an Animal', skills: ['nature'], actions: ['command-an-animal'] },
    { shift: 'critFailToFail', when: 'on a check to Command an Animal', skills: ['nature'], actions: ['command-an-animal'] },
  ];
  const cdb = patched('feats', 'insistent-command', { degreeShifts: ROW });
  const holder = () => buildOn(cdb, 'druid', 8, { featPicks: { '8:class:0': 'insistent-command' } });

  // batch 031: insistent-command
  it('insistent-command marks the Command an Animal action row with both shifts', () => {
    const marks = recordMarkersFor(holder(), cdb, 'action', 'command-an-animal');
    expect(marks.filter((m) => m.sourceId === 'insistent-command')).toHaveLength(2);
  });

  // batch 031: insistent-command
  it('insistent-command stars the Nature skill row it is rolled on', () => {
    expect(statHasSituational(holder(), { kind: 'skill', skill: 'nature' }, cdb)).toBe(true);
  });

  // batch 031: insistent-command
  it('a character without insistent-command gets neither the mark nor the star', () => {
    const c = buildOn(cdb, 'druid', 8);
    expect(recordMarkersFor(c, cdb, 'action', 'command-an-animal').filter((m) => m.sourceId === 'insistent-command')).toHaveLength(0);
    expect(statHasSituational(c, { kind: 'skill', skill: 'nature' }, cdb)).toBe(false);
  });
});

/* ------------------------------------------------------------------------- basic-modification */

describe('basic-modification gives an ARCHETYPE inventor their initial modification (feats/basic-modification)', () => {
  /*
   * AoN feat-3117: "You gain a basic modification of your choice for your innovation." The only
   * modification picker in the app was gated on OWNING the inventor class, so a dedicated inventor
   * reached no control and the feat delivered nothing. Their innovation is Inventor Dedication's own
   * answer, whose values are the same subclass ids the class path uses.
   */
  const MOD = Object.values(db.classFeatures).find((f) => f.otherTags?.includes('weapon-innovation-modification') && f.level === 1)!.id;
  const arch = (level: number, feats: Record<string, string>, mods: Record<string, string | null> = {}): Character =>
    buildOn(db, 'fighter', level, {
      featPicks: feats,
      featChoices: { '2:class:0': 'weapon-innovation' },
      inventorModifications: mods as BuildState['inventorModifications'],
    });

  // batch 031: basic-modification
  it('basic-modification resolves the archetype innovation and keeps the initial pick', () => {
    const c = arch(8, { '2:class:0': 'inventor-dedication', '8:class:0': 'basic-modification' }, { initial: MOD });
    expect(c.inventor?.innovationType).toBe('weapon');
    expect(c.inventor?.modifications.initial).toBe(MOD);
  });

  // batch 031: basic-modification
  it('the modification basic-modification bought becomes an OWNED class feature, so its own mechanics fire', () => {
    // The whole point of resolving `c.inventor` for an archetype: ownedFeatureIds is what makes a
    // modification's situational bonuses, modes and grants reach the sheet.
    const c = arch(8, { '2:class:0': 'inventor-dedication', '8:class:0': 'basic-modification' }, { initial: MOD });
    expect([...ownedFeatureIds(c, db)]).toContain(MOD);
  });

  // batch 031: basic-modification
  it('a dedicated inventor WITHOUT basic-modification keeps no modification', () => {
    const c = arch(8, { '2:class:0': 'inventor-dedication' }, { initial: MOD });
    expect(c.inventor?.innovationType).toBe('weapon');
    expect(c.inventor?.modifications.initial).toBeUndefined();
  });

  // batch 031: basic-modification
  it('basic-modification is a BASIC modification — the later tiers stay closed to the archetype at 20', () => {
    const c = arch(20, { '2:class:0': 'inventor-dedication', '8:class:0': 'basic-modification' }, { initial: MOD, breakthrough: MOD, revolutionary: MOD });
    expect(c.inventor?.modifications.breakthrough).toBeUndefined();
    expect(c.inventor?.modifications.revolutionary).toBeUndefined();
  });
});

/* ---------------------------------------------------------------- advanced-domain#domain-pool */

describe('advanced-domain offers only domains you have an initial domain spell for (feats/advanced-domain)', () => {
  /*
   * AoN feat-4666: "You gain an advanced domain spell from one of your domains FOR WHICH YOU HAVE AN
   * INITIAL DOMAIN SPELL." All 64 domains were offered, so a cleric could take the advanced spell of a
   * domain they have no initial spell in. `limitToAnswersOf` is the existing lane for exactly this —
   * the row is DATA STILL NEEDED; the engine half is the granted-taking fix below.
   */
  const DEF = { ...(db.feats['advanced-domain'].choice as FeatChoiceDef), limitToAnswersOf: 'domain-initiate' };
  const cdb = patched('feats', 'advanced-domain', { choice: DEF });
  const values = (b: BuildState) =>
    buildChoiceOptions('advanced-domain', DEF, b, cdb, buildCharacter(b, cdb), '8:class:0').map((o) => o.value);

  // batch 031: advanced-domain#domain-pool
  it('advanced-domain narrows to the domain a slot-picked Domain Initiate answered', () => {
    const b = stateOn(cdb, 'cleric', 8, {
      featPicks: { '1:class:0': 'domain-initiate', '8:class:0': 'advanced-domain' },
      featChoices: { '1:class:0': 'healing' },
    });
    expect(values(b)).toEqual(['healing']);
  });

  // batch 031: advanced-domain#domain-pool
  it('advanced-domain counts a GRANTED Domain Initiate — a cloistered cleric gets theirs from the doctrine', () => {
    const b = stateOn(cdb, 'cleric', 8, {
      featPicks: { '8:class:0': 'advanced-domain' },
      grantedFeatChoices: { 'domain-initiate': 'healing' },
    });
    expect(values(b)).toEqual(['healing']);
  });

  // batch 031: advanced-domain#domain-pool
  it('advanced-domain stays wide while no Domain Initiate has been answered', () => {
    // The house rule the field documents: an empty picker mid-build reads as broken data.
    const b = stateOn(cdb, 'cleric', 8, { featPicks: { '8:class:0': 'advanced-domain' } });
    expect(values(b).length).toBeGreaterThan(60);
  });
});

/* ------------------------------------------------------------------------ ubiquitous-gadgets */

describe('ubiquitous-gadgets adds two temporary gadgets a day (feats/ubiquitous-gadgets)', () => {
  /*
   * AoN feat-3068: "Increase the number of temporary gadgets you can create each day by 2." Neither
   * that feat nor its prerequisite Gadget Specialist (feat-3058: "you can create two temporary gadgets
   * … three at master … four at legendary") carried the per-day count, so the whole mechanic was
   * absent. `dailyTemporaryItems` is the shipped lane and sums across sources — both rows are DATA
   * STILL NEEDED, and this test states the count they produce.
   */
  const base = [
    {
      id: 'gadget',
      label: 'Temporary gadget',
      countByProficiency: { key: 'crafting', ranks: { expert: 2, master: 3, legendary: 4 } },
      filter: { traits: ['gadget'], fromKnownFormulas: true, note: 'x' },
    },
  ];
  const bonus = [{ id: 'ubiquitous', label: 'Temporary gadget', count: 2, filter: { traits: ['gadget'], fromKnownFormulas: true, note: 'x' } }];
  const cdb = { ...db, feats: { ...db.feats, 'gadget-specialist': { ...db.feats['gadget-specialist'], dailyTemporaryItems: base }, 'ubiquitous-gadgets': { ...db.feats['ubiquitous-gadgets'], dailyTemporaryItems: bonus } } } as unknown as ContentDatabase;
  const gadgets = (c: Character) => dailyItemSlots(c, cdb).filter((s) => s.label.startsWith('Temporary gadget'));
  const inv = (feats: Record<string, string>) => buildOn(cdb, 'inventor', 8, { featPicks: feats });
  /** Gadget Specialist's printed ladder: two per day, three at master, four at legendary. */
  const PRINTED = { untrained: 0, trained: 0, expert: 2, master: 3, legendary: 4 } as const;

  // batch 031: ubiquitous-gadgets
  it('gadget-specialist alone gives the printed count for the crafter Crafting rank', () => {
    const c = inv({ '4:class:0': 'gadget-specialist' });
    expect(gadgets(c)).toHaveLength(PRINTED[c.proficiencies.skills.crafting ?? 'untrained']);
  });

  // batch 031: ubiquitous-gadgets
  it('ubiquitous-gadgets increases that count by exactly two', () => {
    const before = gadgets(inv({ '4:class:0': 'gadget-specialist' })).length;
    expect(gadgets(inv({ '4:class:0': 'gadget-specialist', '8:class:0': 'ubiquitous-gadgets' }))).toHaveLength(before + 2);
  });

  // batch 031: ubiquitous-gadgets
  it('ubiquitous-gadgets without Gadget Specialist still only adds its own two', () => {
    expect(gadgets(inv({ '8:class:0': 'ubiquitous-gadgets' }))).toHaveLength(2);
  });
});
