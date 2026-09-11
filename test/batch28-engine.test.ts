// @vitest-environment jsdom
// jsdom for the two builder-only lanes below (the magus spellbook has no reader outside Builder.tsx),
// and so a later append to this file can render a control without moving the header; the engine
// assertions are pure and unaffected by the environment.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, setupMissing, type BuildState } from '../src/rules/build';
import { repertoireCounts, spellbookBudget } from '../src/rules/spellcasting';
import { deriveStrike } from '../src/rules/derive';
import { deriveFamiliar, familiarAbilityBudget } from '../src/rules/companions';
import { explainStat } from '../src/rules/explain';
import type { Character, ContentDatabase, ProficiencyKey } from '../src/rules/types';

const db = content();

/**
 * Wanderer's-Guide parity batch 28 — the ENGINE half (types + build).
 *
 * Every assertion is made on a BUILT character, and the POSITIVE leg reads the SHIPPED record — the
 * batch's data rows have landed, so a "patch the record and compare against shipped" delta would be
 * asserting nothing at all. The negative control is the mirror image: a copy of the shipped content
 * with the one field STRIPPED, which is what makes each assertion name its carrier.
 */

/**
 * Apply a patch to a record. A key whose patch value is `undefined` is REMOVED, so
 * `{ field: undefined }` is the stripped-carrier control rather than a key left sitting there holding
 * `undefined` (which reads the same to a truthiness check and differently to `in` / `Object.keys`).
 */
const patched = <T extends object>(rec: T, patch: Record<string, unknown>): T => {
  const out = { ...rec } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
};

/** The shipped content with one CLASS record patched (or, with `undefined`, stripped). */
const withClass = (id: string, patch: Record<string, unknown>): ContentDatabase =>
  ({ ...db, classes: { ...db.classes, [id]: patched(db.classes[id], patch) } }) as ContentDatabase;

/** …and with one SUBCLASS OPTION of a class patched. A class's `subclass` is ONE field, so the whole
 *  options array is re-emitted — which is also exactly how the overlay row has to be written. */
const withSubOption = (classId: string, optionId: string, patch: Record<string, unknown>): ContentDatabase => {
  const cls = db.classes[classId];
  const sub = cls.subclass!;
  return withClass(classId, {
    subclass: { ...sub, options: sub.options.map((o) => (o.id === optionId ? patched(o, patch) : o)) },
  });
};

/** …and one option of an EXTRA-CHOICE group (animist apparitions, kineticist elements). */
const withExtraOption = (classId: string, groupId: string, optionId: string, patch: Record<string, unknown>): ContentDatabase => {
  const cls = db.classes[classId];
  return withClass(classId, {
    extraChoices: (cls.extraChoices ?? []).map((g) =>
      g.id === groupId ? { ...g, options: g.options.map((o) => (o.id === optionId ? patched(o, patch) : o)) } : g,
    ),
  });
};

/** …and one CLASS FEATURE record (kineticist gate junctions). */
const withFeature = (id: string, patch: Record<string, unknown>): ContentDatabase =>
  ({ ...db, classFeatures: { ...db.classFeatures, [id]: patched(db.classFeatures[id], patch) } }) as ContentDatabase;

/** …and a class's spellcasting block, which is one field on the class record. */
const withCasting = (classId: string, patch: Record<string, unknown>): ContentDatabase =>
  withClass(classId, { spellcasting: patched(db.classes[classId].spellcasting!, patch) });

const mkBuild = (over: Partial<BuildState>): BuildState =>
  ({ ...emptyBuild(), name: 't', level: 1, ancestryId: 'human', backgroundId: 'acrobat', ...over }) as BuildState;

const hero = (over: Partial<BuildState>, content_ = db): Character => buildCharacter(mkBuild(over), content_);

const rank = (ch: Character, key: string): string | undefined => ch.proficiencies.skills[key as ProficiencyKey];
const main = (ch: Character) => ch.spellcasting.find((s) => s.type === 'prepared' || s.type === 'spontaneous');

describe('batch 28 — class carriers (engine 1: types + build)', () => {
  /*
   * investigator#empiricism-lore
   * "You are trained in one Intelligence-based skill of your choice." (methodology-2 / methodology-6)
   *
   * Lores ARE Intelligence-based, and WG's own select carries a nested "Select a Lore" branch beside
   * Arcana/Crafting/Occultism. Our `skillChoice` is a SkillId[] — a closed four-skill list with no
   * Lore reachable at all.
   */
  it('a subclass skillChoice can be answered with a LORE when the option opens that branch', () => {
    const stripped = withSubOption('investigator', 'empiricism-methodology', { skillChoiceLore: undefined });
    const b: Partial<BuildState> = {
      classId: 'investigator',
      subclassId: 'empiricism-methodology',
      keyAbility: 'int',
      subclassLore: 'engineering',
    };

    expect(rank(hero(b, db), 'lore:engineering'), 'the Lore branch trains the typed subject').toBe('trained');
    expect(
      rank(hero(b, db), 'arcana'),
      'and the named-skill default must NOT also fire — one choice trains one skill',
    ).toBe('untrained');
    // Strip `skillChoiceLore` and the branch closes: the Lore answer is ignored and the list's first
    // entry is trained instead — which is what the option did before the row landed.
    expect(rank(hero(b, stripped), 'lore:engineering')).toBeUndefined();
    expect(rank(hero(b, stripped), 'arcana')).toBe('trained');
  });

  /*
   * champion#cause-sanctification
   * "Whether you become holy, unholy, or neither will limit your choice of causes, devotion spells,
   * and feats." / "Some causes are limited to certain sanctifications." (class-58)
   *
   * The limit is printed on the cause page as a trait — cause-8 Desecration and cause-10 Iniquity are
   * Unholy; cause-9 Grandeur and cause-14 Redemption are Holy. Neither we nor WG encoded it.
   */
  it('a cause whose trait fights the answered sanctification is reported as outstanding setup', () => {
    const untraited = withSubOption('champion', 'desecration', { traits: undefined });
    const champ = (sanct: string): BuildState =>
      mkBuild({
        classId: 'champion',
        subclassId: 'desecration',
        keyAbility: 'str',
        deityId: 'urgathoa',
        featChoices: { 'feature:deity-champion': sanct },
      });

    expect(setupMissing(champ('holy'), db), 'an Unholy cause under a holy sanctification').toContain('Cause');
    expect(setupMissing(champ('unholy'), db), 'and it is legal for an unholy champion').not.toContain('Cause');
    expect(setupMissing(champ('none'), db), '"none" can take neither holy nor unholy').toContain('Cause');
    // Unanswered leaves the list WIDE — the convention every choiceFlagAnswer caller keeps.
    expect(setupMissing(mkBuild({ classId: 'champion', subclassId: 'desecration', keyAbility: 'str', deityId: 'urgathoa' }), db)).not.toContain('Cause');
    // Strip the cause's trait and the gate has nothing to read — the defect this closed.
    expect(setupMissing(champ('holy'), untraited)).not.toContain('Cause');
  });

  /*
   * sorcerer#repertoire-gift-spells
   * "you learn two 1st-rank spells of your choice and four cantrips of your choice, as well as an
   * additional spell and cantrip from your bloodline" / "your first new spell is always the sorcerous
   * gift spell for that rank" (class-62; the table's Cantrips column reads 5 at every level)
   *
   * The gift was appended AFTER the slice, so a level-1 sorcerer knew six cantrips against a printed
   * five. The psychic's own print footnotes its conscious-mind cantrips as *additional* ("3*"), so the
   * additive default has to stay — hence an opt-in flag rather than a change of rule.
   */
  it('a class whose grants count INSIDE the allowance keeps its printed cantrip total', () => {
    const b: Partial<BuildState> = {
      classId: 'sorcerer',
      subclassId: 'bloodline-aberrant',
      keyAbility: 'cha',
      cantrips: ['electric-arc', 'light', 'shield', 'telekinetic-projectile', 'prestidigitation'],
    };
    expect(db.classes.sorcerer.spellcasting!.grantedCountsAgainstRepertoire, 'the sorcerer opts in').toBe(true);
    const counted = main(hero(b, db))!;
    expect(counted.cantripCap).toBe(5);
    expect(counted.cantrips.length, 'five known cantrips, the bloodline gift among them').toBe(5);
    expect(counted.cantrips, 'and the gift is never the entry the cap discards').toEqual(
      expect.arrayContaining(counted.grantedCantrips ?? []),
    );
    // Strip the flag and the additive default returns: the gift rides on TOP of the five picks.
    const additive = withCasting('sorcerer', { grantedCountsAgainstRepertoire: undefined });
    expect(main(hero(b, additive))!.cantrips.length).toBe(6);
    // The psychic must be untouched — its conscious-mind cantrips are printed as additional ("3*",
    // "Your conscious mind gives you three additional cantrips with amps").
    const psychic = main(
      hero(
        {
          classId: 'psychic',
          keyAbility: 'int',
          cantrips: ['daze', 'light', 'shield'],
          extraChoices: { 'subconscious-mind': [db.classes.psychic.extraChoices![0].options[0].id] },
          subclassId: db.classes.psychic.subclass!.options[0].id,
        },
        db,
      ),
    )!;
    expect(psychic.cantripCap).toBe(3);
    expect(psychic.cantrips.length, 'the conscious mind still ADDS to the psychic total').toBeGreaterThan(3);
  });

  /*
   * summoner#repertoire-size
   * "At 1st level, you learn two 1st-level spells of your choice" … "At 4th level … your spell
   * repertoire reaches its maximum size of five spells" — against a table whose "maximum number of
   * spell slots you get from the summoner class is four". (class-18)
   *
   * oracle#tenth-rank-repertoire
   * "Add TWO common 10th-rank divine spells to your repertoire. You gain a SINGLE 10th-rank spell
   * slot" (Oracular Clarity, class-61)
   *
   * One field for both: a per-rank allowance beyond the slot count.
   */
  /*
   * ⚠ THE SUMMONER LOST ITS ALLOWANCE IN BATCH 037, and the field is still the field. The 2021 book's
   * two-rank table discarded lower ranks, so the repertoire reached five against four slots and
   * `extraRepertoire {1:1}` encoded that. The 2026 printing (class-77) says *"Each time you get a
   * spell slot (see the Summoner Spells per Day table), you add a spell to your spell repertoire of
   * the same rank"* — repertoire EQUALS slots — so the row dropped it. The lane is exercised here the
   * other way round, on a copy that still carries it, which is what this test was always about; the
   * oracle's 10th-rank allowance below is the unchanged shipped case.
   */
  // batch 037: summoner#2026-printing
  it('summoner: extraRepertoire gives a spontaneous caster known spells beyond its slots', () => {
    const b: Partial<BuildState> = {
      classId: 'summoner',
      subclassId: db.classes.summoner.subclass!.options[0].id,
      keyAbility: 'cha',
      spells: { 1: ['grease', 'fear'] },
    };
    // batch 037: summoner#2026-printing
    expect(db.classes.summoner.spellcasting!.extraRepertoire, 'the 2026 printing grants no spare pick').toBeUndefined();
    const withExtra = withCasting('summoner', { extraRepertoire: { 1: 1 } });
    const grown = main(hero(b, withExtra))!;
    expect(grown.repertoire![1].length, 'two 1st-rank spells known against one slot').toBe(2);
    expect(grown.slots![1].max, 'the SLOT table is untouched — only what you know grows').toBe(1);
    // Strip the allowance and the repertoire is sized to the slot count again — which is what ships.
    // batch 037: summoner#2026-printing
    expect(main(hero(b, db))!.repertoire![1].length).toBe(1);
  });

  it("extraRepertoire is ignored for a rank the caster cannot yet cast (the oracle's 10th)", () => {
    expect(db.classes.oracle.spellcasting!.extraRepertoire, '"Add TWO common 10th-rank divine spells"').toEqual({ 10: 1 });
    const at = (level: number) =>
      main(
        hero(
          {
            classId: 'oracle',
            subclassId: db.classes.oracle.subclass!.options[0].id,
            keyAbility: 'cha',
            level,
            spells: { 10: ['revival', 'remake'] },
          },
          db,
        ),
      )!;
    expect(at(1).repertoire![10], 'no 10th-rank pick before Oracular Clarity').toBeUndefined();
    expect(at(19).repertoire![10].length, '"Add two common 10th-rank divine spells"').toBe(2);
    expect(at(19).slots![10].max, 'for the ONE 10th-rank slot it also grants').toBe(1);
    // The helper the builder's picker cap shares with buildCharacter, on the same guard.
    expect(repertoireCounts({ 1: 3, 2: 3 }, { 10: 1 })).toEqual({ 1: 3, 2: 3 });
    expect(repertoireCounts({ 9: 4, 10: 1 }, { 10: 1 })[10]).toBe(2);
  });

  /*
   * magus#spellbook
   * "The spellbook contains your choice of eight arcane cantrips and four 1st-level arcane spells. …
   * Each time you gain a level, you add two more arcane spells to your spellbook." (class-17)
   *
   * The only spellbook lane in the app was a hardcoded `id === 'wizard' || id === 'witch'` test in the
   * builder, so the magus prepared straight off the arcane list with no book at all. The magus's 4 + 2
   * is NOT the wizard's 5 + 2, which is why the numbers ride on the class record.
   */
  /*
   * ⚠ FIVE SINCE BATCH 037, not four: the 2026 printing (class-74) says *"eight arcane cantrips and
   * five 1st-rank arcane spells"* where the 2021 book said four. `perLevel` is unchanged at two. The
   * point of the test is unchanged too — the numbers ride on the class record, and they are still not
   * the wizard's.
   */
  // batch 037: magus#2026-printing
  it("magus: a class's spellbook budget comes off its own record, not a class-id test", () => {
    const spec = db.classes.magus.spellcasting!.spellbook!;
    // batch 037: magus#2026-printing
    expect(spec, '"…your choice of eight arcane cantrips and five 1st-rank arcane spells"').toEqual({ spells: 5, perLevel: 2 });
    // batch 037: magus#2026-printing
    expect(spellbookBudget(spec, 1), 'five 1st-rank arcane spells').toBe(5);
    // batch 037: magus#2026-printing
    expect(spellbookBudget(spec, 5), 'plus two more each level').toBe(13);
    // …and it is genuinely a different ladder from the wizard's, so the class-id fallback could not
    // have served the magus even if it had matched.
    expect(spellbookBudget({ spells: 5, perLevel: 2 }, 5)).toBe(13);

    /* …and the reader lives ONLY in the builder (buildCharacter models no book), so this is where it
     * has to be exercised: render the real Builder and read the spellbook line off the page. */
    const bookLine = (c_: ContentDatabase): string | undefined => {
      const initial = {
        ...emptyBuild(),
        name: 't',
        level: 1,
        classId: 'magus',
        keyAbility: 'int',
        ancestryId: 'human',
        heritageId: 'skilled-human',
        backgroundId: 'acrobat',
        subclassId: c_.classes.magus.subclass!.options[0].id,
      } as BuildState;
      const r = renderDom(createElement(Builder, { content: c_, initial, onCancel: () => undefined, onCreate: () => undefined }));
      // Level 1 is where a 1st-level caster's spells (and the book) are chosen.
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '1') ?? null);
      const text = [...r.host.querySelectorAll<HTMLElement>('.bsec-sub')].map((el) => el.textContent ?? '').find((t) => t.startsWith('Spellbook'));
      r.stop();
      return text;
    };
    // batch 037: magus#2026-printing
    expect(bookLine(db), '"The spellbook contains … five 1st-rank arcane spells"').toContain('0 / 5 learned');
    const noBook = withCasting('magus', { spellbook: undefined });
    expect(bookLine(noBook), 'strip the book and the magus prepares straight off the arcane list — the class-id fallback never reaches it').toBeUndefined();
  });

  /*
   * rogue#avenger-favored-weapon-rank
   * "You are trained in your deity's favored weapon. Whenever you gain a class feature that grants you
   * expert or greater proficiency with simple or martial weapons, you also gain that proficiency rank
   * with your deity's favored weapon." (racket-10) — the rogue's Weapon Tricks grants expert at 5th
   * and Master Tricks master at 13th.
   */
  it("the avenger's favored weapon tracks the rogue's weapon tricks, not the cleric ladder", () => {
    const at = (level: number) =>
      hero({ classId: 'rogue', subclassId: 'avenger', keyAbility: 'dex', level, deityId: 'achaekek' })
        .proficiencies.weaponOverrides?.['sawtooth-saber'];
    expect(at(1)).toBe('trained');
    expect(at(5), 'Weapon Tricks (5th): expert in simple and martial weapons').toBe('expert');
    expect(at(13), 'Master Tricks (13th): master').toBe('master');
  });

  /*
   * fighter#weapon-legend-group
   * Fighter Weapon Mastery (5): "Choose one weapon group. Your proficiency rank increases to master
   * with the simple weapons, martial weapons, and unarmed attacks in that group, and to expert with the
   * advanced weapons in that group."
   * Weapon Legend (13): "You CAN SELECT ONE WEAPON GROUP and increase your proficiency ranks to
   * legendary … and to master for all advanced weapons in that weapon group." (class-35)
   *
   * Two independent selections; both levels used to read one field.
   */
  it('Weapon Legend can name a different weapon group from Weapon Mastery', () => {
    const rows = (over: Partial<BuildState>) =>
      hero({ classId: 'fighter', keyAbility: 'str', level: 13, ...over }).proficiencies.weaponGroupRanks ?? [];
    const rank_ = (rs: ReturnType<typeof rows>, group: string, category: string) =>
      rs.find((r) => r.group === group && r.category === category)?.rank;

    const split = rows({ fighterWeaponGroup: 'sword', fighterWeaponGroup2: 'axe' });
    expect(rank_(split, 'axe', 'simple'), 'the 13th-level group is legendary').toBe('legendary');
    expect(rank_(split, 'axe', 'advanced'), 'and master with its advanced weapons').toBe('master');
    expect(rank_(split, 'sword', 'simple'), 'the 5th-level group KEEPS master — it is not demoted').toBe('master');
    expect(rank_(split, 'sword', 'advanced')).toBe('expert');
    // Unanswered, Weapon Legend falls back to the 5th-level group (what every saved character meant),
    // and writes ONE row per group+category — a duplicate would leave a first-row reader short.
    const same = rows({ fighterWeaponGroup: 'sword' });
    expect(rank_(same, 'sword', 'martial')).toBe('legendary');
    expect(same.filter((r) => r.group === 'sword' && r.category === 'martial')).toHaveLength(1);

    /* …and both groups survive the lossy import path. That recovery read the flat `weaponGroups` map,
     * which the fighter lane stopped writing when the advanced-weapon clause was split out, so it had
     * been recovering nothing at all. */
    const roundTrip = (over: Partial<BuildState>) =>
      deriveBuildFromCharacter(hero({ classId: 'fighter', keyAbility: 'str', level: 13, ...over }), db);
    const split2 = roundTrip({ fighterWeaponGroup: 'sword', fighterWeaponGroup2: 'axe' });
    expect([split2.fighterWeaponGroup, split2.fighterWeaponGroup2]).toEqual(['sword', 'axe']);
    const same2 = roundTrip({ fighterWeaponGroup: 'sword' });
    expect([same2.fighterWeaponGroup, same2.fighterWeaponGroup2]).toEqual(['sword', null]);
  });

  /*
   * swashbuckler#stylish-tricks-increase
   * "At 3rd level, 7th level, and 15th level, you gain an additional skill increase you can apply only
   * to Acrobatics or the skill from your swashbuckler's style." (class-63)
   *
   * thaumaturge#bonus-skill-increases
   * "You also gain an additional skill increase, which you can apply only to Arcana, Nature, Occultism,
   * or Religion." (Thaumaturgic Expertise L9 / Thaumaturgic Mastery L17, class-69)
   *
   * The FEAT half of the swashbuckler's sentence was already enforced (restrictedSkillFeatLevels); the
   * INCREASE half was unguarded on both sides, so a level-3 Braggart could raise Medicine to expert.
   */
  it('a restricted bonus skill increase drops a pick the printed clause forbids', () => {
    const clause = db.classes.swashbuckler.restrictedSkillIncreaseLevels!;
    expect([clause.levels, clause.skills, clause.includeSubclassGrantedSkills], '"…3rd, 7th and 15th … only to Acrobatics or the skill from your style"').toEqual([
      [3, 7, 15],
      ['acrobatics'],
      true,
    ]);
    const braggart = (bonus: string, content_: ContentDatabase) =>
      hero(
        {
          classId: 'swashbuckler',
          subclassId: 'braggart',
          keyAbility: 'dex',
          level: 3,
          bonusSkillIncreases: { 3: bonus as ProficiencyKey },
        },
        content_,
      );

    expect(
      braggart('medicine', db).skillIncreases,
      'Medicine is neither Acrobatics nor the Braggart style skill, so the increase is dropped',
    ).toEqual([]);
    expect(rank(braggart('medicine', db), 'medicine')).toBe('untrained');
    expect(rank(braggart('acrobatics', db), 'acrobatics'), '"only to Acrobatics…"').toBe('expert');
    expect(rank(braggart('intimidation', db), 'intimidation'), '"…or the skill from your style" — Braggart grants Intimidation').toBe('expert');
    // Strip the clause and any skill is accepted again — the defect this closed. (The bonus increase
    // itself rides `bonusSkillIncreaseLevels`, which stays, so what is removed is only the restriction.)
    const unrestricted = withClass('swashbuckler', { restrictedSkillIncreaseLevels: undefined });
    expect(braggart('medicine', unrestricted).skillIncreases).toEqual([{ level: 3, skill: 'medicine' }]);
  });

  it('the thaumaturge gains its 9th- and 17th-level bonus increases, restricted to its four skills', () => {
    expect(db.classes.thaumaturge.bonusSkillIncreaseLevels, 'Thaumaturgic Expertise (9) and Mastery (17)').toEqual([9, 17]);
    expect(db.classes.thaumaturge.restrictedSkillIncreaseLevels?.skills, '"only to Arcana, Nature, Occultism, or Religion"').toEqual([
      'arcana',
      'nature',
      'occultism',
      'religion',
    ]);
    const thaum = (bonus: string, content_: ContentDatabase) =>
      hero(
        {
          classId: 'thaumaturge',
          subclassId: db.classes.thaumaturge.subclass?.options[0]?.id ?? null,
          keyAbility: 'cha',
          level: 9,
          // Trained first, so the increase has somewhere to step FROM (untrained → trained would
          // pass either way and prove nothing about the rank).
          classSkills: ['occultism', 'medicine'],
          bonusSkillIncreases: { 9: bonus as ProficiencyKey },
        },
        content_,
      );
    expect(rank(thaum('occultism', db), 'occultism'), 'the 9th-level increase is delivered').toBe('expert');
    expect(rank(thaum('medicine', db), 'medicine'), '"only to Arcana, Nature, Occultism, or Religion"').toBe('trained');
    // …and one stripped control per field, so neither half can be credited to the other: without
    // `bonusSkillIncreaseLevels` the increase never arrives, and without the restriction Medicine takes it.
    const noBonus = withClass('thaumaturge', { bonusSkillIncreaseLevels: undefined });
    expect(rank(thaum('occultism', noBonus), 'occultism')).toBe('trained');
    const unrestricted = withClass('thaumaturge', { restrictedSkillIncreaseLevels: undefined });
    expect(rank(thaum('medicine', unrestricted), 'medicine')).toBe('expert');
  });

  /*
   * animist#apparition-lore-ranks
   * "When you are attuned to an apparition, you are trained in these Lore skills … At 8th level and
   * beyond … expert proficiency in their apparition skills; at 16th level and beyond … master
   * proficiency in their apparition skills." (War of Immortals pg. 17)
   */
  it('apparition Lores climb to expert at 8th and master at 16th', () => {
    const apparitions = db.classes.animist.extraChoices!.find((g) => g.id === 'apparition')!.options;
    expect(
      apparitions.filter((o) => !o.loreProgression).map((o) => o.id),
      'every apparition climbs, not just the one this test builds on',
    ).toEqual([]);
    expect(apparitions[0].loreProgression, '"…expert at 8th … master at 16th"').toEqual([
      { level: 8, rank: 'expert' },
      { level: 16, rank: 'master' },
    ]);
    const at = (level: number, content_: ContentDatabase) =>
      rank(
        hero(
          {
            classId: 'animist',
            subclassId: db.classes.animist.subclass?.options[0]?.id ?? null,
            keyAbility: 'wis',
            level,
            extraChoices: { apparition: ['crafter-in-the-vault', 'custodian-of-groves-and-gardens'] },
          },
          content_,
        ),
        'lore:architecture',
      );
    expect(at(1, db)).toBe('trained');
    expect(at(8, db)).toBe('expert');
    expect(at(16, db)).toBe('master');
    // Strip the ladder off the apparition that owns Architecture Lore and it is flat trained to 20th.
    const flat = withExtraOption('animist', 'apparition', 'crafter-in-the-vault', { loreProgression: undefined });
    expect(at(16, flat)).toBe('trained');
  });

  /*
   * wizard#experimental-spellshaping
   * "Experimental Spellshaping … You gain one 1st-level spellshape wizard feat of your choice."
   * (arcane-thesis-6)
   *
   * Two defects in one: no FEAT_PICK_GRANTS spec, AND the pick walk could not see a thesis at all —
   * it called classFeatureIdsOwned with a bare BuildState, which carries no `classChoices`.
   */
  it('the Experimental Spellshaping thesis hands over the spellshape feat the player picks', () => {
    const ch = hero({
      classId: 'wizard',
      keyAbility: 'int',
      subclassId: db.classes.wizard.subclass!.options[0].id,
      extraChoices: { thesis: ['experimental-spellshaping'] },
      pickFeatChoices: { 'experimental-spellshaping': 'widen-spell' },
    });
    const granted = ch.feats.find((f) => f.featId === 'widen-spell');
    expect(granted, '"You gain one 1st-level spellshape wizard feat of your choice"').toBeTruthy();
    expect(granted!.grantedBy).toBe('experimental-spellshaping');
    // A different thesis must not hand it over.
    expect(
      hero({
        classId: 'wizard',
        keyAbility: 'int',
        subclassId: db.classes.wizard.subclass!.options[0].id,
        extraChoices: { thesis: ['spell-blending'] },
        pickFeatChoices: { 'experimental-spellshaping': 'widen-spell' },
      }).feats.some((f) => f.featId === 'widen-spell'),
    ).toBe(false);

    /* …and the pick has to be ASKED. The FEAT_PICK_GRANTS control was mounted for granted class
     * features and for the subclass, and an arcane thesis is neither, so the spec had nowhere on
     * screen to be answered. */
    const prompts = (thesis: string): string[] => {
      const initial = {
        ...emptyBuild(),
        name: 't',
        level: 1,
        classId: 'wizard',
        keyAbility: 'int',
        ancestryId: 'human',
        heritageId: 'skilled-human',
        backgroundId: 'acrobat',
        subclassId: db.classes.wizard.subclass!.options[0].id,
        extraChoices: { thesis: [thesis] },
      } as BuildState;
      const r = renderDom(createElement(Builder, { content: db, initial, onCancel: () => undefined, onCreate: () => undefined }));
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '1') ?? null);
      const titles = [...r.host.querySelectorAll<HTMLElement>('[data-ctl]')].map((el) => el.dataset.ctlTitle ?? '');
      r.stop();
      return titles;
    };
    expect(prompts('experimental-spellshaping')).toContain('Choose a 1st-level spellshape wizard feat');
    expect(prompts('spell-blending'), 'and no other thesis grows a feat picker').not.toContain(
      'Choose a 1st-level spellshape wizard feat',
    );
  });

  /*
   * kineticist#junction-skill-feat
   * "A skill junction makes you trained in the listed skill AND GRANTS YOU THE LISTED SKILL FEAT."
   * (class-23) — Air/Experienced Smuggler, Earth/Hefty Hauler, Fire/Intimidating Glare, Metal/Quick
   * Repair, Water/Underwater Marauder, Wood/Terrain Expertise.
   *
   * `EffectGrant.grantsFeats` was read for HERITAGE options only, so authoring the paired feat on a
   * class feature's effectChoice would have resolved and been dropped.
   */
  it("an effectChoices option on a CLASS FEATURE can grant a feat, not just a heritage's", () => {
    const junction = db.classFeatures['gates-threshold'].effectChoices!;
    const air = junction.flatMap((ch) => ch.options ?? []).find((o) => o.value === 'air-skill-junction')!;
    expect(air.grant?.grantsFeats, '"…and grants you the listed skill feat"').toEqual(['experienced-smuggler']);
    /* The negative control strips ONLY `grantsFeats` off that one option, so the skill half of the same
     * grant stays put — a feat that vanished with the whole option would prove nothing. */
    const proseOnly = withFeature('gates-threshold', {
      effectChoices: junction.map((ch) => ({
        ...ch,
        options: (ch.options ?? []).map((o) =>
          o.value === 'air-skill-junction' ? { ...o, grant: patched(o.grant!, { grantsFeats: undefined }) } : o,
        ),
      })),
    });
    const kin = (content_: ContentDatabase) =>
      hero(
        {
          classId: 'kineticist',
          keyAbility: 'con',
          level: 5,
          extraChoices: { element: ['air-gate', 'earth-gate'] },
          effectChoices: { 'gates-threshold:gate-junction': 'air-skill-junction' },
        },
        content_,
      );
    expect(kin(db).feats.map((f) => f.featId), '"…and grants you the listed skill feat"').toContain('experienced-smuggler');
    expect(rank(kin(db), 'stealth'), 'the skill half still fires').toBe('trained');
    // With `grantsFeats` stripped the option carries the skill and names the feat in prose only.
    expect(kin(proseOnly).feats.map((f) => f.featId)).not.toContain('experienced-smuggler');
    expect(rank(kin(proseOnly), 'stealth'), 'and the strip really did leave the skill grant alone').toBe('trained');
  });

  /*
   * inventor#master-overdrive-crafting
   * "Master Overdrive … You become a master in Crafting" (class-19, level 7)
   *
   * The ladder shipped with its middle rung missing: 'expert-overdrive' and 'legendary-overdrive' were
   * both in FEAT_GRANTS_AUTO and 'master-overdrive' was not, so Crafting sat at expert from 7 to 14.
   */
  it("Master Overdrive raises the inventor's Crafting to master at 7th", () => {
    const at = (level: number) =>
      rank(
        hero({ classId: 'inventor', keyAbility: 'int', level, subclassId: db.classes.inventor.subclass?.options[0]?.id ?? null }),
        'crafting',
      );
    expect(at(3), 'Expert Overdrive').toBe('expert');
    expect(at(7), 'Master Overdrive').toBe('master');
    expect(at(15), 'Legendary Overdrive').toBe('legendary');
  });

  /*
   * wizard#weapon-expertise
   * "Through sheer experience, you've improved your technique with your weapons. Your proficiency ranks
   * for simple weapons and unarmed attacks increase to expert." (class-39, Level 11)
   *
   * The five named weapons (club/crossbow/dagger/heavy-crossbow/staff) are the LEGACY text, and the
   * per-weapon override left a wizard trained in every other simple weapon forever. The build.ts half
   * is the deletion below; the category grant rides ADVANCEMENT.wizard
   * `{ level: 11, track: 'simple', rank: 'expert', source: 'weapon-expertise' }` (engine agent 2).
   */
  const wiz11 = () => hero({ classId: 'wizard', keyAbility: 'int', level: 11, subclassId: db.classes.wizard.subclass!.options[0].id });

  it('the legacy five-weapon wizard override is gone from build.ts', () => {
    const ov = wiz11().proficiencies.weaponOverrides ?? {};
    for (const w of ['club', 'crossbow', 'dagger', 'heavy-crossbow', 'staff']) {
      expect(ov[w], `${w} is no longer a per-weapon override — the category row carries it`).toBeUndefined();
    }
  });

  /* The two halves are one fix: build.ts deleted the five-weapon override, and ADVANCEMENT.wizard's
   * `{ level: 11, track: 'simple', rank: 'expert', source: 'weapon-expertise' }` row (engine agent 2,
   * src/rules/advancement.ts) replaces it with the printed category grant. Both have landed. */
  it('a level-11 wizard is expert in ALL simple weapons (needs the ADVANCEMENT.wizard simple row)', () => {
    const w = wiz11();
    expect(w.proficiencies.attacks.simple, '"your proficiency ranks for simple weapons … increase to expert"').toBe('expert');
    expect(w.proficiencies.attacks.unarmed).toBe('expert');
  });

  /*
   * rogue#eldritch-trickster-key-attribute
   * "You can choose the spellcasting ability score for the multiclass archetype you chose as your key
   * ability score." (racket-4)
   *
   * The reader already exists (`resolveOptionKeyAbility`); the racket option simply carries no
   * `keyAbilityOptions`, so the rogue was locked to Dexterity with no control on screen.
   */
  it("SubclassOption.keyAbilityOptions has a live reader — the Eldritch Trickster's is all that's missing", () => {
    const et = (keyAbility: BuildState['keyAbility']): Partial<BuildState> => ({
      classId: 'rogue',
      subclassId: 'eldritch-trickster',
      keyAbility,
    });
    expect(
      db.classes.rogue.subclass!.options.find((o) => o.id === 'eldritch-trickster')!.keyAbilityOptions,
      'the three spellcasting attributes a multiclass archetype can use, plus the rogue\'s own',
    ).toEqual(['dex', 'int', 'wis', 'cha']);
    expect(hero(et('int'), db).keyAbility, 'the archetype spellcasting attribute the player chose').toBe('int');
    expect(
      hero(et('str'), db).keyAbility,
      'and an attribute the racket does NOT offer falls back to the first — the reader is really filtering',
    ).toBe('dex');
    expect(setupMissing(mkBuild(et(null)), db), 'the choice is asked for').toContain('Key attribute');
    // Strip the options and nothing filters the pick, nor is the choice asked for at all.
    const locked = withSubOption('rogue', 'eldritch-trickster', { keyAbilityOptions: undefined });
    expect(hero(et('str'), locked).keyAbility).toBe('str');
    expect(setupMissing(mkBuild(et(null)), locked)).not.toContain('Key attribute');
  });
});

// ─── engine agent 2 appends below this line ───────────────────────────────────────────────────────

describe('batch 28 — derive / advancement / companions / builder display (engine 2)', () => {
  /*
   * runesmith#runic-optimization
   * Runic Optimization (L7): "You deal 2 additional damage with weapons bearing a striking rune. This
   * damage increases to 3 if the weapon bears a greater striking rune and 4 if it bears a major
   * striking rune." Greater Runic Optimization (L15) raises the three to 4 / 6 / 8.
   *
   * Neither side delivered it: our damage lane only knew the generic weapon-specialization feature ids
   * and the runesmith has none of them, so a runesmith's Strikes gained nothing at 7th or 15th. The
   * numbers are keyed to the WEAPON'S RUNE, not to proficiency, which is why it needed its own reader.
   */
  const runeStrike = (classId: string, level: number, striking?: 'striking' | 'greater' | 'major') => {
    const c = build(classId, level);
    c.inventory = [
      { instanceId: 'w', itemId: 'longsword', quantity: 1, equipped: true, ...(striking ? { runes: { striking } } : {}) },
    ] as never;
    return deriveStrike(c, db, c.inventory[0])!;
  };

  it('a runesmith deals extra Strike damage by STRIKING-RUNE tier, at 7th and again at 15th', () => {
    expect(runeStrike('runesmith', 7, 'striking').specDamage, '"2 additional damage … striking rune"').toBe(2);
    expect(runeStrike('runesmith', 7, 'greater').specDamage, '"3 … greater striking rune"').toBe(3);
    expect(runeStrike('runesmith', 7, 'major').specDamage, '"4 … major striking rune"').toBe(4);
    expect(runeStrike('runesmith', 15, 'striking').specDamage, 'Greater Runic Optimization: "4 … 6 … 8"').toBe(4);
    expect(runeStrike('runesmith', 15, 'greater').specDamage).toBe(6);
    expect(runeStrike('runesmith', 15, 'major').specDamage).toBe(8);
    // …and it really is folded into the damage the player reads, not just a side field.
    const bare = runeStrike('runesmith', 15, undefined).dmgBonus;
    expect(runeStrike('runesmith', 15, 'major').dmgBonus - bare).toBe(8);
  });

  it('…only with a striking rune, only from 7th, and only for a runesmith', () => {
    // (the Strike carries `specDamage || undefined`, so a zero reads as absent)
    expect(runeStrike('runesmith', 7, undefined).specDamage ?? 0, 'no striking rune, no extra damage').toBe(0);
    expect(runeStrike('runesmith', 6, 'major').specDamage ?? 0, 'the feature arrives at 7th').toBe(0);
    // A fighter at 7 has real Weapon Specialization (2 at expert) — the runesmith branch must not
    // stack onto a class that already gets the printed one.
    const fighter = runeStrike('fighter', 7, 'major');
    expect(fighter.specDamage, "the fighter's own weapon specialization, not the runesmith's rune ladder").toBe(2);
  });

  /*
   * swashbuckler#perception-mastery-source
   * Print (AoN class-63) names the level-11 feature "Perception Mastery" and classes.swashbuckler
   * .features carries featureId 'perception-mastery'; the advancement row said 'vigilant-senses', the
   * pre-remaster name, which exists nowhere else in the app — and explain.ts renders humanize(source)
   * straight into the player's Perception breakdown.
   */
  it("the swashbuckler's level-11 Perception bump is attributed to Perception Mastery", () => {
    const rows = explainStat(build('swashbuckler', 11), db, { kind: 'perception' }).timeline;
    const at11 = rows.filter((r) => r.level === 11);
    expect(at11.map((r) => r.detail), 'the remaster feature name, not "Vigilant senses"').toContain('Perception mastery');
    expect(at11.map((r) => r.detail).join(' ')).not.toMatch(/vigilant/i);
  });

  /*
   * witch#patron-familiar-ability
   * Familiar (AoN class-38): "Your familiar gains two additional familiar abilities: one of these is a
   * unique ability based on your patron and is ALWAYS SELECTED". classFeatures.patron.familiarAbilities
   * maps all 16 patrons to their ability id, all 16 ability records ship — and nothing read the field,
   * so the patron's ability simply never appeared.
   */
  const witchFamiliar = (patron: string, level = 1) =>
    deriveFamiliar(
      { id: 'f', kind: 'familiar', name: '', grantSlug: 'familiar-witch' },
      build('witch', level, { subclassId: patron }),
      db,
    );

  it("the patron's unique familiar ability is delivered, free, and follows the patron", () => {
    const snow = witchFamiliar('baba-yaga').abilities.find((a) => a.id === 'familiar-of-obscuring-snowfall');
    expect(snow, "Baba Yaga's familiar ability is on the familiar").toBeTruthy();
    expect(snow!.fromFeat, 'granted, not one of the player\'s picks — "always selected"').toBe('patron');
    const aid = witchFamiliar('choir-politic').abilities.map((a) => a.id);
    expect(aid, 'a different patron, a different ability').toContain('familiar-of-bolstering-aid');
    expect(aid).not.toContain('familiar-of-obscuring-snowfall');
    // It costs the player nothing: the wizard's familiar (no witch grant) gets no patron ability at all.
    const wiz = deriveFamiliar({ id: 'f', kind: 'familiar', name: '', grantSlug: 'familiar' }, build('wizard', 1, { keyAbility: 'int' }), db);
    expect(wiz.abilities.some((a) => a.fromFeat === 'patron')).toBe(false);
  });

  /*
   * witch#familiar-abilities
   * Familiar (AoN class-38): "Your familiar gains ANOTHER EXTRA ABILITY AT 6TH, 12TH, AND 18TH LEVELS",
   * and the class table repeats "Familiar ability" on rows 6, 12 and 18. `abilityBudget` was a bare
   * number with no level lane, so a 20th-level witch's familiar showed the same count as a 1st-level
   * one. Asserted as a DELTA off the shipped grant row, so it does not flip when that row is retuned.
   */
  it("the witch familiar's chosen-ability budget grows at 6th, 12th and 18th", () => {
    const cfg = { id: 'f', kind: 'familiar' as const, name: '', grantSlug: 'familiar-witch' };
    const at = (level: number) => familiarAbilityBudget(cfg, build('witch', level))!;
    expect(at(6) - at(1), 'one more at 6th').toBe(1);
    expect(at(12) - at(1), 'and again at 12th').toBe(2);
    expect(at(20) - at(1), 'and again at 18th — three extra by 20th').toBe(3);
    expect(at(5) - at(1), 'and nowhere in between').toBe(0);
    // No other familiar grows: the clause is the witch's.
    const pet = { id: 'p', kind: 'familiar' as const, name: '', grantSlug: 'familiar' };
    expect(familiarAbilityBudget(pet, build('wizard', 20, { keyAbility: 'int' }))).toBe(
      familiarAbilityBudget(pet, build('wizard', 1, { keyAbility: 'int' })),
    );
  });

  /*
   * kineticist#duplicate-junction-star
   * Gate Junctions (class-23): "While your kinetic aura is active, you gain a +1 status bonus to the
   * listed skill; the bonus increases to +2 at 10th level and +3 at 17th level." — ONE bonus, stated
   * once. The registry carried it four times (gate-junction, plus fire-/metal-/earth-gate copies keyed
   * on the ELEMENT), and the differing `when` strings kept pooling from merging them, so an affected
   * kineticist read the same star twice on the same skill — from 1st level, before any junction exists.
   */
  it('a kineticist sees the gate-junction bonus once per skill, not twice', () => {
    const c = build('kineticist', 5, { extraChoices: { element: ['fire-gate', 'metal-gate'] } } as Partial<BuildState>);
    const stars = (skill: string) =>
      (explainStat(c, db, { kind: 'skill', skill } as never).situational ?? []).filter((s) => /junction/i.test(s.text));
    expect(stars('intimidation').length, "fire's Intimidation junction — one line").toBe(1);
    expect(stars('crafting').length, "metal's Crafting junction — one line").toBe(1);
    const earth = build('kineticist', 5, { extraChoices: { element: ['earth-gate'] } } as Partial<BuildState>);
    expect(
      (explainStat(earth, db, { kind: 'skill', skill: 'athletics' } as never).situational ?? []).filter((s) => /junction/i.test(s.text)).length,
      "earth's Athletics junction — one line",
    ).toBe(1);
  });

  /*
   * psychic#key-attribute-blank
   * "Key Attribute: Intelligence or Charisma — At 1st level, your class gives you an attribute boost to
   * Intelligence or Charisma, as determined by your choice of subconscious mind." (AoN class-68)
   *
   * The psychic is the only class shipping `keyAbility: []`, so the class card printed a bare "Key:"
   * and the Key attribute card "—". The mechanic was already right (the subconscious mind sets it);
   * this is the pre-pick DISPLAY, and the pair is read off the extraChoices options that set it.
   */
  it('the psychic class card advertises Int/Cha before a subconscious mind is picked', () => {
    const page = (classId: string, keyAbility: BuildState['keyAbility']) => {
      const initial = {
        ...emptyBuild(),
        name: 't',
        level: 1,
        classId,
        keyAbility,
        ancestryId: 'human',
        heritageId: 'skilled-human',
        backgroundId: 'acrobat',
      } as BuildState;
      const r = renderDom(createElement(Builder, { content: db, initial, onCancel: () => undefined, onCreate: () => undefined }));
      // Page 0 is origins — where the class card and the Key attribute sub-card live.
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '0') ?? null);
      const text = r.host.textContent ?? '';
      r.stop();
      return text;
    };
    const psychic = page('psychic', null);
    expect(psychic, 'the class card names both attributes instead of "Key:" and nothing').toContain('Key: Int/Cha');
    expect(psychic, 'and the Key attribute card says which two, instead of "—"').toContain('Int or Cha');
    // Unchanged for a class that ships its own pair — including the record's own ordering.
    expect(page('fighter', null), "the fighter's pair still comes from classes.fighter.keyAbility").toContain('Key: Dex/Str');
  });
});

// ─── verifier pass: the CONTROLS that answer these fields ─────────────────────────────────────────
/*
 * Three of the fields above had no way to be answered: `build.subclassLore` (Empiricism's Lore branch)
 * and `build.fighterWeaponGroup2` (Weapon Legend's own group) were unreachable from the builder, and
 * the champion's cause list was still offered unfiltered. A field with no control is not a delivered
 * mechanic — the owner's rule is that every one of WG's `select`s is a visible control here — so the
 * pickers are pinned by the same markers the WG experience harness reads.
 */
describe('batch 28 — the pickers that answer the new fields (verifier)', () => {
  const originPage = (over: Partial<BuildState>, content_: ContentDatabase = db) => {
    const initial = {
      ...emptyBuild(),
      name: 't',
      level: 1,
      ancestryId: 'human',
      heritageId: 'skilled-human',
      backgroundId: 'acrobat',
      ...over,
    } as BuildState;
    const r = renderDom(createElement(Builder, { content: content_, initial, onCancel: () => undefined, onCreate: () => undefined }));
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '0') ?? null);
    const ctls = [...r.host.querySelectorAll<HTMLElement>('[data-ctl]')].map((el) => ({
      title: el.dataset.ctlTitle ?? '',
      options: Number(el.dataset.ctlOptions ?? 0),
      live: Number(el.dataset.ctlLive ?? 0),
      state: el.dataset.ctlState ?? '',
      text: el.textContent ?? '',
    }));
    r.stop();
    return ctls;
  };
  const ctl = (ctls: ReturnType<typeof originPage>, title: string) => ctls.find((c) => c.title === title);

  it("the Empiricism skill picker offers — and shows — a Lore", () => {
    const b: Partial<BuildState> = {
      classId: 'investigator',
      subclassId: 'empiricism-methodology',
      keyAbility: 'int',
      subclassLore: 'engineering',
    };
    const on = ctl(originPage(b, db), 'Trained skill')!;
    expect(on.state, 'the typed Lore reads as the answer').toBe('picked');
    expect(on.text, '"You are trained in one Intelligence-based skill of your choice"').toContain('Engineering Lore');
    const off = ctl(originPage(b, withSubOption('investigator', 'empiricism-methodology', { skillChoiceLore: undefined })), 'Trained skill')!;
    expect(off.text, 'strip the branch and the Lore has nowhere to be typed, so nothing shows it').not.toContain('Engineering Lore');
    expect(on.options, 'and the option exists only while the record opens the branch').toBe(off.options + 1);
  });

  it('an illegal champion cause is greyed in the picker, not merely reported', () => {
    const sub = db.classes.champion.subclass!;
    // The four causes print their limit as a trait: Desecration and Iniquity are Unholy, Grandeur and
    // Redemption Holy — and the other three are open to any sanctification.
    expect(
      Object.fromEntries(sub.options.filter((o) => o.traits?.length).map((o) => [o.id, o.traits])),
    ).toEqual({ desecration: ['unholy'], iniquity: ['unholy'], grandeur: ['holy'], redemption: ['holy'] });
    /* The negative control strips the traits back off all four — a picker that greyed nothing is what
     * shipped before the row landed. */
    const untraited = withClass('champion', {
      subclass: { ...sub, options: sub.options.map((o) => patched(o, { traits: undefined })) },
    });
    const causes = (sanct?: string, content_: ContentDatabase = db) =>
      ctl(
        originPage(
          {
            classId: 'champion',
            subclassId: 'justice',
            keyAbility: 'str',
            deityId: 'iomedae',
            ...(sanct ? { featChoices: { 'feature:deity-champion': sanct } } : {}),
          },
          content_,
        ),
        sub.name,
      )!;
    const holy = causes('holy');
    expect(holy.options - holy.live, 'the two Unholy causes are unpickable for a holy champion').toBe(2);
    const none = causes('none');
    expect(none.options - none.live, '"none" can take neither the holy nor the unholy four').toBe(4);
    const open = causes(undefined);
    expect(open.options - open.live, 'unanswered leaves the list wide').toBe(0);
    const stripped = causes('holy', untraited);
    expect(stripped.options - stripped.live, 'strip the traits and nothing is greyed — the gate reads them and nothing else').toBe(0);
    expect(stripped.options, 'and the same seven causes are on offer either way').toBe(open.options);
  });

  it('Weapon Legend has its own picker at 13th', () => {
    const at5 = originPage({ classId: 'fighter', keyAbility: 'str', level: 5 }).map((c) => c.title);
    expect(at5).toContain('Weapon group (5th)');
    expect(at5, 'Weapon Legend is a 13th-level selection — nothing to ask at 5th').not.toContain('Weapon group (13th)');
    const at13 = originPage({ classId: 'fighter', keyAbility: 'str', level: 13, fighterWeaponGroup: 'sword', fighterWeaponGroup2: 'axe' });
    expect(at13.map((c) => c.title), '"You can select one weapon group" — a second, independent selection').toContain('Weapon group (13th)');
    expect(ctl(at13, 'Weapon group (13th)')!.state).toBe('picked');
    // Left unanswered it stays empty (buildCharacter falls back to the 5th-level group) rather than
    // silently pre-filling, which would read as a second group the player never chose.
    expect(ctl(originPage({ classId: 'fighter', keyAbility: 'str', level: 13, fighterWeaponGroup: 'sword' }), 'Weapon group (13th)')!.state).toBe('empty');
  });
});
