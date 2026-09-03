// @vitest-environment jsdom
// jsdom so a later append to this file can render a builder control without moving the header; the
// engine assertions below are pure and unaffected by the environment.
import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { creatureTraitsOf, deriveMaxHp, deriveSpeeds, narrowChoiceOptions } from '../src/rules/derive';
import { recordMarkersFor, statHasSituational } from '../src/rules/explain';
import {
  buildCharacter,
  checkPrerequisites,
  deriveBuildFromCharacter,
  emptyBuild,
  forbiddenFeatReason,
  type BuildState,
} from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';
import { dyingDeathThreshold } from '../src/rules/conditions';
import { applyDamage, initialPlay } from '../src/rules/play';

const db = content();

/**
 * Wanderer's-Guide parity batch 26 — the ENGINE half (types + build).
 *
 * Every assertion is made on a BUILT character. Where the carrier is a DATA row the data lane
 * authors, the test builds the POST-ROW world explicitly and compares it against the same record with
 * the field STRIPPED: what is pinned is that the reader fires the moment the row lands, and neither
 * leg flips when it does.
 */

/** The shipped content with one heritage record patched — the row the data lane will author. */
const withHeritage = (id: string, patch: Record<string, unknown>): ContentDatabase =>
  ({ ...db, heritages: { ...db.heritages, [id]: { ...db.heritages[id], ...patch } } }) as ContentDatabase;

const hero = (over: Partial<BuildState>, content_ = db): Character =>
  buildCharacter(
    { ...emptyBuild(), name: 't', level: 1, classId: 'wizard', keyAbility: 'int', backgroundId: 'acrobat', ...over } as BuildState,
    content_,
  );

describe('batch 26 — heritage carriers (engine 1: types + build)', () => {
  /*
   * jinxed-halfling-halfling-luck-prohibition
   * "You can NEVER take the Halfling Luck feat, and you gain the Jinx action." (AoN heritage-257)
   * Not a prerequisite — halfling-luck ships `prerequisites: []` and the sentence is printed on the
   * OTHER record — so nothing could say it and the ancestry-feat picker offered an illegal feat.
   */
  it("a heritage's forbidsFeats blocks the feat everywhere prerequisites are checked", () => {
    expect(db.feats['halfling-luck'].prerequisites ?? [], 'nothing on the feat could have carried it').toEqual([]);
    const forbidding = withHeritage('jinxed-halfling', { forbidsFeats: ['halfling-luck'] });
    // …and the same record with the field STRIPPED, which is what every other halfling heritage is.
    const stripped = withHeritage('jinxed-halfling', { forbidsFeats: undefined });

    const jinxed = (c_: ContentDatabase) => hero({ ancestryId: 'halfling', heritageId: 'jinxed-halfling' }, c_);
    expect(checkPrerequisites(db.feats['halfling-luck'], jinxed(forbidding), forbidding).met).toBe(false);
    expect(checkPrerequisites(db.feats['halfling-luck'], jinxed(stripped), stripped).met).toBe(true);

    // The picker greys with a SENTENCE, not the bare "Prerequisites not met." a feat with no printed
    // prerequisites would otherwise fall back to (ruling Q27: a wrong reason is worse than a vague one).
    expect(forbiddenFeatReason('halfling-luck', jinxed(forbidding), forbidding)).toMatch(/never take this feat/);
    // …and only for the heritage that prints it: a gutsy halfling may still take Halfling Luck.
    const gutsy = hero({ ancestryId: 'halfling', heritageId: 'gutsy-halfling' }, forbidding);
    expect(checkPrerequisites(db.feats['halfling-luck'], gutsy, forbidding).met).toBe(true);
  });

  /*
   * sage-jotunborn / weaver-jotunborn-1 / keeper-jotunborn-1
   * "You are trained in Society." / "You are trained in Crafting." / "You are trained in Survival, and
   * you gain the Survey Wildlife skill feat." All three shipped a dataWarning telling the player to
   * apply the training by hand — a stale rejection from before grantSourcesForProficiency reached
   * heritages. The FEAT_GRANTS rows are code (featGrants.ts), so these run on the SHIPPED data.
   */
  it.each([
    ['sage-jotunborn', 'society'],
    ['weaver-jotunborn', 'crafting'],
    ['keeper-jotunborn', 'survival'],
  ])('%s trains %s through the heritage arm of FEAT_GRANTS', (heritageId, skill) => {
    const control = hero({ ancestryId: 'jotunborn', heritageId: 'plane-hopper-jotunborn' });
    expect(control.proficiencies.skills[skill], 'a jotunborn wizard has no other source for it').toBe('untrained');
    expect(hero({ ancestryId: 'jotunborn', heritageId }).proficiencies.skills[skill]).toBe('trained');
  });

  it("keeper-jotunborn's granted Survey Wildlife no longer sits on an unmet prerequisite", () => {
    // "trained in Survival" is the feat's own printed prerequisite, and the heritage that grants it is
    // what satisfies it — before the row the one thing we did grant was granted illegally.
    expect(db.feats['survey-wildlife'].prerequisites).toContain('trained in Survival');
    const keeper = hero({ ancestryId: 'jotunborn', heritageId: 'keeper-jotunborn' });
    expect(keeper.feats.some((f) => f.featId === 'survey-wildlife')).toBe(true);
    expect(checkPrerequisites(db.feats['survey-wildlife'], keeper, db).met).toBe(true);
  });

  /*
   * b26-ancient-ash-expert-at-5
   * "You become trained in one skill of your choice. AT 5TH LEVEL, YOU BECOME AN EXPERT IN THAT SKILL."
   * The effectChoices options grant `skills: { <skill>: 'trained' }` and EffectGrant.skills has no
   * level term, so the pick was trained from 1st to 20th.
   */
  it('skillProgressionFromChoice raises the skill the HERITAGE PICK trained, at the printed level', () => {
    const patch = { skillProgressionFromChoice: { choiceId: 'skill', at: [{ level: 5, rank: 'expert' }] } };
    const progressing = withHeritage('ancient-ash', patch);
    const stripped = withHeritage('ancient-ash', { skillProgressionFromChoice: undefined });
    const ash = (level: number, c_: ContentDatabase) =>
      hero(
        { level, ancestryId: 'ghoran', heritageId: 'ancient-ash', effectChoices: { 'ancient-ash:skill': 'medicine' } },
        c_,
      ).proficiencies.skills['medicine'];

    expect(ash(4, progressing), 'below 5th the printed rank is still trained').toBe('trained');
    expect(ash(5, progressing)).toBe('expert');
    expect(ash(5, stripped), 'with no carrier the pick stays trained forever').toBe('trained');
  });

  it('the upgrade follows "THAT skill" — the answer already given, not a second question', () => {
    const progressing = withHeritage('ancient-ash', {
      skillProgressionFromChoice: { choiceId: 'skill', at: [{ level: 5, rank: 'expert' }] },
    });
    const picked = hero(
      { level: 5, ancestryId: 'ghoran', heritageId: 'ancient-ash', effectChoices: { 'ancient-ash:skill': 'medicine' } },
      progressing,
    );
    expect(picked.proficiencies.skills['medicine']).toBe('expert');
    // Exactly ONE skill moved: WG models this as a second independent select, which would let a player
    // be trained in one skill and expert in another. Print says "that skill".
    const experts = Object.entries(picked.proficiencies.skills).filter(([, r]) => r === 'expert');
    expect(experts.map(([k]) => k)).toEqual(['medicine']);
    // An UNANSWERED pick still climbs — the skill-only effectChoiceDefault answers it with options[0],
    // and the engine must not train one skill at 1st and upgrade a different one at 5th.
    const defaulted = hero({ level: 5, ancestryId: 'ghoran', heritageId: 'ancient-ash' }, progressing);
    const first = db.heritages['ancient-ash'].effectChoices![0].options![0].value;
    expect(defaulted.proficiencies.skills[first]).toBe('expert');
  });

  /*
   * b26-woodstalker-underbrush
   * "You gain the Terrain Stalker feat, even if you're not trained in Stealth, and YOU MUST CHOOSE
   * UNDERBRUSH as your chosen terrain." Unbound, the builder offered rubble, snow and a typed-in
   * terrain, and both of Terrain Stalker's stars read "your chosen difficult terrain".
   */
  it('a HERITAGE can bind the choice on the feat it grants', () => {
    const woodstalker = hero({ ancestryId: 'lizardfolk', heritageId: 'woodstalker-lizardfolk' });
    const granted = woodstalker.feats.find((f) => f.featId === 'terrain-stalker');
    expect(granted?.grantedBy).toBe('woodstalker-lizardfolk');
    expect(granted?.choice?.value).toBe('underbrush');
    // The other two printed options are still what the feat itself offers — the binding is the
    // granter's, not a deletion from the record.
    expect((db.feats['terrain-stalker'].choice?.options ?? []).map((o) => o.value)).toContain('snow');
  });

  /*
   * mightyfall-kobold
   * "You gain 10 Hit Points from your ancestry instead of 6. Instead of the normal attribute boosts
   * and flaws, YOU CAN CHOOSE to gain a boost to Strength, a boost to Charisma, and a flaw in
   * Intelligence." — two independent clauses, so the HP is unconditional and cannot witness the
   * optional package's answer any more. The decode reads the ATTRIBUTES instead.
   */
  describe('mightyfall kobold — unconditional HP, answer decoded from the attributes', () => {
    // The post-row record: ancestryHp:10 outright, and alternateAttributes.hp DELETED (left in place
    // beside an unconditional 10 it would force every kobold's answer to 'kaiju' on decode).
    const altNoHp = { ...db.heritages['mightyfall-kobold'].alternateAttributes! } as Record<string, unknown>;
    delete altNoHp.hp;
    const post = withHeritage('mightyfall-kobold', { ancestryHp: 10, alternateAttributes: altNoHp });
    const shippedShape = withHeritage('mightyfall-kobold', {
      ancestryHp: undefined,
      alternateAttributes: db.heritages['mightyfall-kobold'].alternateAttributes,
    });
    // A FIGHTER, not the default wizard: the class key boost would raise the package's Int flaw back
    // to 10 and erase the very trace the legacy decode reads.
    const kobold = (answer: string, c_: ContentDatabase) =>
      hero(
        {
          classId: 'fighter',
          keyAbility: 'str',
          ancestryId: 'kobold',
          heritageId: 'mightyfall-kobold',
          featChoices: { 'heritage:mightyfall-kobold': answer },
        },
        c_,
      );

    it('the 10 HP is not gated behind the attribute package', () => {
      expect(db.ancestries['kobold'].hp, 'the printed "instead of 6"').toBe(6);
      expect(kobold('normal', post).ancestryHp).toBe(10);
      expect(kobold('kaiju', post).ancestryHp).toBe(10);
      // …and the same character against the record with the field stripped is the defect being closed.
      expect(kobold('normal', shippedShape).ancestryHp ?? db.ancestries['kobold'].hp).toBe(6);
      expect(deriveMaxHp(kobold('normal', post), post) - deriveMaxHp(kobold('normal', shippedShape), shippedShape)).toBe(4);
    });

    it('a stored character round-trips its package answer off the ATTRIBUTES, never the HP', () => {
      const kaiju = kobold('kaiju', post);
      const normal = kobold('normal', post);
      // HP can no longer tell them apart — which is exactly why the decode had to move.
      expect(normal.ancestryHp).toBe(kaiju.ancestryHp);
      // The carrier is the preferred source and still works.
      expect(kaiju.ancestryHeritageChoices?.['heritage:mightyfall-kobold']).toBe('kaiju');
      // A save from before the carrier existed falls back to the trace on the attributes: the package
      // flaws Int (8 with no boost is only reachable with a flaw), the normal kobold flaws Con.
      const legacy = (c: Character) => ({ ...c, ancestryHeritageChoices: undefined }) as Character;
      expect(kaiju.abilities.int).toBe(8);
      expect(deriveBuildFromCharacter(legacy(kaiju), post).featChoices?.['heritage:mightyfall-kobold']).toBe('kaiju');
      expect(normal.abilities.int).toBeGreaterThan(8);
      expect(deriveBuildFromCharacter(legacy(normal), post).featChoices?.['heritage:mightyfall-kobold']).toBeUndefined();
    });
  });

  /*
   * makari-lizardfolk-divine-tradition-swap
   * "The tradition of any spells or magical abilities you gain from A LIZARDFOLK HERITAGE OR ANCESTRY
   * FEAT is divine instead of its normal tradition (usually primal)." A blanket retune of OTHER
   * records' grants; the open-set note lane read `fromAncestrySpells` off FEATS only, so a heritage
   * printing the sentence reached nobody.
   */
  it('a HERITAGE can write the fromAncestrySpells note over its ancestry feats', () => {
    const note = 'Makari Lizardfolk: the tradition of this spell is divine instead of its normal tradition.';
    const makari = withHeritage('makari-lizardfolk', { spellNotes: [{ fromAncestrySpells: true, note }] });
    const stripped = withHeritage('makari-lizardfolk', { spellNotes: undefined });
    const boneCaller = (c_: ContentDatabase) =>
      hero({ level: 9, ancestryId: 'lizardfolk', heritageId: 'makari-lizardfolk', featPicks: { '9:ancestry': 'bone-caller' } }, c_);

    expect(db.feats['bone-caller'].innateSpells?.[0].tradition, 'the feat still ships primal').toBe('primal');
    expect((boneCaller(makari).spellNotes?.['animal-messenger'] ?? []).map((n) => n.note)).toContain(note);
    expect(boneCaller(stripped).spellNotes?.['animal-messenger'] ?? []).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// END OF ENGINE AGENT 1's BLOCK — append further batch-26 describes BELOW this line.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Batch 26 — the DERIVE/EXPLAIN half (engine 2).
 *
 * Same rule as above: where the carrier is a data row, the POST-ROW world is built explicitly and
 * compared against the same record with the new field STRIPPED, so neither leg flips when the row
 * lands.
 */
describe('batch 26 — heritage carriers (engine 2: derive + explain)', () => {
  /*
   * fungus-leshy-plant-loss
   * "You lose the plant trait and gain the fungus trait." The leshy chassis is traits:["leshy","plant"]
   * and every creature-trait source was additive, so the fungus grant alone would print
   * "leshy, plant, fungus" — which the printed sentence denies — and leave plant-bane weapons keyed on
   * this character.
   */
  describe('a record can LOSE a creature trait', () => {
    const post = withHeritage('fungus-leshy', { grantsCreatureTraits: ['fungus'], removesCreatureTraits: ['plant'] });
    // The same row WITHOUT the new field: what shipping only the additive half would have produced.
    const pre = withHeritage('fungus-leshy', { grantsCreatureTraits: ['fungus'], removesCreatureTraits: undefined });
    const leshy = (heritageId: string, content_: ContentDatabase) =>
      creatureTraitsOf(hero({ ancestryId: 'leshy', heritageId }, content_), content_).map((t) => t.trait.toLowerCase());

    it('drops the ancestry chassis trait the heritage prints away, and keeps the one it grants', () => {
      expect(leshy('fungus-leshy', post)).toContain('fungus');
      expect(leshy('fungus-leshy', post)).not.toContain('plant');
      expect(leshy('fungus-leshy', post), 'you are still a leshy').toContain('leshy');
    });

    it('is the REMOVAL that does it — the additive half alone reads "leshy, plant, fungus"', () => {
      expect(leshy('fungus-leshy', pre)).toEqual(expect.arrayContaining(['leshy', 'plant', 'fungus']));
    });

    it('takes nothing from a leshy whose heritage does not print the loss', () => {
      expect(leshy('leaf-leshy', post)).toContain('plant');
    });
  });

  /*
   * b26-kijimuna-gnome-choice
   * "You gain your choice of the following benefits. Once made, this choice can't be changed.
   *  - You can climb any banyan. You gain the Combat Climber feat, and if you roll a success on the
   *    Athletics check to Climb, you get a critical success instead.
   *  - You can catch any fish. You gain a swim Speed of 15 feet."
   * The record hard-coded branch one, so branch two was unreachable and a player who chose the fish was
   * still told their Climb successes crit.
   */
  describe('a degree shift can be gated to the branch that grants it', () => {
    // The SHIPPED row (batch 26) already carries the gate; the pre-row world below strips it.
    expect(db.heritages['kijimuna-gnome'].degreeShifts![0].fromChoice).toEqual({ choiceId: 'benefit', value: 'banyan' });
    const shift = { ...db.heritages['kijimuna-gnome'].degreeShifts![0], fromChoice: undefined };
    /** The record as the data row leaves it: both halves on an `effectChoices` block. */
    const kijimuna = {
      grantsFeats: undefined,
      effectChoices: [
        {
          id: 'benefit',
          prompt: "Choose your kijimuna benefit (once made, this choice can't be changed)",
          options: [
            { value: 'banyan', label: 'You can climb any banyan', grant: { grantsFeats: ['combat-climber'] } },
            { value: 'fish', label: 'You can catch any fish', grant: { speeds: { swim: 15 } } },
          ],
        },
      ],
      degreeShifts: [{ ...shift, fromChoice: { choiceId: 'benefit', value: 'banyan' } }],
    };
    const post = withHeritage('kijimuna-gnome', kijimuna);
    // The same record with only the GATE stripped: what the choice alone, without the answer gate,
    // would have produced.
    const pre = withHeritage('kijimuna-gnome', { ...kijimuna, degreeShifts: [shift] });
    const gnome = (answer: string | undefined, content_: ContentDatabase) =>
      hero(
        {
          ancestryId: 'gnome',
          heritageId: 'kijimuna-gnome',
          ...(answer ? { effectChoices: { 'kijimuna-gnome:benefit': answer } } : {}),
        },
        content_,
      );
    /** The ACTION half of ruling Q2 — the mark on the Climb row, read by its source id. */
    const climbMark = (c: Character, content_: ContentDatabase) =>
      recordMarkersFor(c, content_, 'action', 'climb').some((m) => m.sourceId === 'kijimuna-gnome');

    it('gives the banyan branch its feat, its star and its Climb mark', () => {
      const c = gnome('banyan', post);
      expect(c.feats.map((f) => f.featId)).toContain('combat-climber');
      expect(climbMark(c, post)).toBe(true);
      expect(statHasSituational(c, { kind: 'skill', skill: 'athletics' }, post)).toBe(true);
    });

    it('gives the fish branch the swim Speed and NEITHER half of the climb benefit', () => {
      const c = gnome('fish', post);
      expect(deriveSpeeds(c, post).swim).toBe(15);
      expect(c.feats.map((f) => f.featId)).not.toContain('combat-climber');
      expect(climbMark(c, post)).toBe(false);
      expect(statHasSituational(c, { kind: 'skill', skill: 'athletics' }, post)).toBe(false);
    });

    it('hands an UNANSWERED pick neither branch — a benefit nobody chose is never granted', () => {
      const c = gnome(undefined, post);
      expect(climbMark(c, post)).toBe(false);
      expect(deriveSpeeds(c, post).swim ?? 0).toBe(0);
    });

    it('without the gate the fish-eater is still told their Climb successes crit', () => {
      expect(climbMark(gnome('fish', pre), pre)).toBe(true);
    });
  });

  /*
   * frozen-wind-kitsune-1, half two (engine agent 1's cross-file gap, in this lane's file).
   * Foxfire: "**Special** If you are a frozen wind kitsune, your foxfire deals cold damage instead of
   * electricity or fire." `requiresAnyFeature` is read through `ownedFeatureIds`, which walks the class
   * table, the subclass and the class choices — so a HERITAGE id there matched nothing and the gated
   * option was offered to every kitsune.
   */
  describe('an option gated on a HERITAGE is narrowed by it', () => {
    const shipped = db.feats['foxfire'].choice!;
    /** The row the data lane will author: the gate on foxfire's own `cold` option. */
    const gated = {
      ...shipped,
      options: (shipped.options ?? []).map((o) => (o.value === 'cold' ? { ...o, requiresAnyFeature: ['frozen-wind-kitsune'] } : o)),
    };
    /** …and the same choice with the gate STRIPPED, which is what ships today. */
    const ungated = { ...shipped, options: (shipped.options ?? []).map((o) => ({ ...o, requiresAnyFeature: undefined })) };
    const values = (heritageId: string, def: typeof shipped) =>
      narrowChoiceOptions('foxfire', def, def.options ?? [], hero({ ancestryId: 'kitsune', heritageId }), db).map((o) => o.value);

    it('offers the cold branch to the frozen wind kitsune and to nobody else', () => {
      expect(values('frozen-wind-kitsune', gated)).toContain('cold');
      expect(values('empty-sky-kitsune', gated)).not.toContain('cold');
      expect(values('empty-sky-kitsune', gated), 'the ungated options are untouched').toEqual(['electricity', 'fire']);
    });

    it('without the gate every kitsune is offered cold', () => {
      expect(values('empty-sky-kitsune', ungated)).toContain('cold');
    });

    /*
     * …and the OTHER half of the same printed sentence, which the gate alone does not say: *"your
     * foxfire deals cold damage INSTEAD OF electricity or fire"* — cold is not merely offered to a
     * frozen wind kitsune, it REPLACES the two options print offers everyone else. That half is a
     * `choiceOptionLimits` row on the heritage and needs no new reader (`effectiveChoiceLimits`
     * already walks `heritageRecords`); this pins that the two rows compose to exactly one option,
     * so the data lane cannot ship the gate and call the finding closed.
     */
    it('FORCES cold on the frozen wind kitsune — the printed "instead of electricity or fire"', () => {
      const limited = withHeritage('frozen-wind-kitsune', {
        choiceOptionLimits: [
          {
            target: 'foxfire',
            flag: 'damage',
            allow: [{ value: 'cold' }],
            // `reason`, not `note` — Q27: a narrowed menu that says nothing reads as missing content,
            // and the field is REQUIRED on ChoiceOptionLimit, so the data row must carry this wording.
            reason: "A frozen wind kitsune's foxfire deals cold damage instead of electricity or fire.",
          },
        ],
      });
      const only = (heritageId: string) =>
        narrowChoiceOptions('foxfire', gated, gated.options ?? [], hero({ ancestryId: 'kitsune', heritageId }, limited), limited).map(
          (o) => o.value,
        );
      expect(only('frozen-wind-kitsune')).toEqual(['cold']);
      // …and the limit belongs to the heritage that prints it: every other kitsune keeps both.
      expect(only('empty-sky-kitsune')).toEqual(['electricity', 'fire']);
    });
  });
});

describe('batch 26 — the orchestrator\'s cross-file closes', () => {
  /* *"The doomed condition affects you as if its value were 1 lower"* — Vivacious Gnome. The stars
   * lane marked the condition; this is the NUMBER: DefenseGrants.doomedValueReduction → Character.
   * doomedReduction → dyingDeathThreshold, so doomed 1 does nothing and doomed 2 kills at dying 3. */
  describe('Doomed counts for less on a Vivacious Gnome', () => {
    const gnome = (content_ = db) => hero({ ancestryId: 'gnome', heritageId: 'vivacious-gnome' }, content_);

    it('the shipped row reaches the built character, and a stripped copy does not', () => {
      expect(db.heritages['vivacious-gnome'].doomedValueReduction).toBe(1);
      expect(gnome().doomedReduction).toBe(1);
      expect(gnome(withHeritage('vivacious-gnome', { doomedValueReduction: undefined })).doomedReduction).toBeUndefined();
      expect(hero({ ancestryId: 'gnome', heritageId: 'umbral-gnome' }).doomedReduction).toBeUndefined();
    });

    it('the threshold: doomed 1 is nothing, doomed 2 is dying 3, and it never rises above the base', () => {
      expect(dyingDeathThreshold(1, 4, 1)).toBe(4);
      expect(dyingDeathThreshold(2, 4, 1)).toBe(3);
      expect(dyingDeathThreshold(0, 4, 1)).toBe(4);
      expect(dyingDeathThreshold(2, 4)).toBe(2); // everybody else
    });

    it('…and a lethal blow uses it: a doomed-2 vivacious gnome goes dying 3 at most, not 2', () => {
      const play = { ...initialPlay(gnome(), db), conditions: [{ id: 'doomed', value: 2 }] } as ReturnType<typeof initialPlay>;
      const massive = applyDamage(play, 100, 10, 4, 1); // ≥ 2× max HP: straight to the death threshold
      expect(massive.conditions.find((c) => c.id === 'dying')?.value).toBe(3);
      const plain = applyDamage(play, 100, 10, 4, 0);
      expect(plain.conditions.find((c) => c.id === 'dying')?.value).toBe(2);
    });
  });

  /* *"Choose arcane, divine, or occult … any primal innate spells you gain from gnome ancestry feats
   * become the tradition you chose"* — Wellspring Gnome. The five gnome feats' rows carry
   * traditionFromChoiceFlag: 'wellspringTradition', but the resolver read PLACED FEATS only, so a flag
   * a heritage asked resolved to nothing and the spells stayed primal (the data verifier measured it). */
  describe('a heritage-asked tradition flag retunes the gnome feats\' innate spells', () => {
    const adept = (answer?: string) =>
      hero({
        level: 5,
        ancestryId: 'gnome',
        heritageId: 'wellspring-gnome',
        featPicks: { '1:ancestry': 'first-world-magic', '5:ancestry': 'first-world-adept' },
        ...(answer ? { featChoices: { 'heritage:wellspring-gnome': answer, 'heritage:wellspring-gnome:0': answer } } : {}),
      });
    // An innate grant lands in the innate entry of ITS tradition, ranks as repertoire keys.
    const tradition = (c: Character, spellId: string) =>
      (c.spellcasting ?? []).find((e) => e.type === 'innate' && Object.values(e.repertoire ?? {}).some((ids) => (ids ?? []).includes(spellId)))?.tradition;

    it('answered divine, First World Adept\'s invisibility is a DIVINE innate spell', () => {
      const row = db.feats['first-world-adept'].innateSpells?.find((s) => s.spellId === 'invisibility');
      expect(row?.tradition).toBe('primal');
      expect(row?.traditionFromChoiceFlag).toBe('wellspringTradition');
      expect(tradition(adept('divine'), 'invisibility')).toBe('divine');
    });

    it('unanswered, it stays primal as printed on the feat', () => {
      expect(tradition(adept(), 'invisibility')).toBe('primal');
    });
  });
});
