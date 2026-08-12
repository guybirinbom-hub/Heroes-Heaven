import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { creatureTraitsOf, deriveSpeeds } from '../src/rules/derive';
import type { BuildState, Character, ModeDef } from '../src/rules/types';

/*
 * `grantsCreatureTraits` is a flat, unconditional, unchosen `string[]`, and twelve records used it for
 * clauses that were none of those things. These tests are written one per SHAPE of that mistake rather
 * than one per record, because the shape is what recurs: the next record whose trait sits behind a
 * branch, an answer or a duration has to land in one of these four lanes or it will be authored wrong
 * in exactly the same way.
 *
 * Every assertion goes through `creatureTraitsOf`, which is the reader the field's own doc comment
 * mandates and the only thing the Details tab calls — asserting the authored array instead would pass
 * for values that never reach a sheet, which is how several of these survived so long.
 */

const db = () => content();
const traitsOf = (c: Character) => creatureTraitsOf(c, db()).map((t) => t.trait);
const build = (over: Partial<BuildState>) =>
  buildCharacter(
    { ...emptyBuild(), level: 20, ancestryId: 'human', backgroundId: Object.keys(db().backgrounds)[0], classId: 'fighter', keyAbility: 'str', ...over },
    db(),
  );

/** The character with `featId` in their first class-feat slot, plus that feat's own answer if given. */
const withFeat = (featId: string, over: Partial<BuildState> = {}) =>
  build({ featPicks: { '1:class:0': featId }, ...over });

describe('shape 1 — a trait named in the printed sentence but missing from the array', () => {
  /*
   * The plainest defect: "You gain the elf trait, THE AIUVARIN TRAIT, and low-light vision" authored as
   * ["elf"]. The record's own `traits: ["aiuvarin"]` is not a substitute — `creatureTraitsOf` never
   * reads it, so it reached the heritage card in the builder and never the Details tab.
   */
  it('a versatile heritage grants its own name as well as the ancestry trait it confers', () => {
    const elfHalf = traitsOf(build({ heritageId: 'aiuvarin' }));
    expect(elfHalf).toContain('elf');
    expect(elfHalf).toContain('aiuvarin');

    const orcHalf = traitsOf(build({ heritageId: 'dromaar' }));
    expect(orcHalf).toContain('orc');
    expect(orcHalf).toContain('dromaar');
  });

  it('a trait granted by a LATER sentence of the same record is not dropped', () => {
    // Undine: "You gain the undine trait…" then "You gain a swim Speed of 10 feet and the amphibious
    // trait." The second clause was invisible to the authoring regex and to the sheet.
    const traits = traitsOf(build({ heritageId: 'undine' }));
    expect(traits).toContain('undine');
    expect(traits).toContain('amphibious');
  });

  it('Ghost Dedication is undead — all four of the traits its two sentences name', () => {
    const traits = traitsOf(withFeat('ghost-dedication'));
    // "You gain the ghost, spirit, and undead traits…" + "You also gain the incorporeal trait".
    // Only the "also" clause had been authored, so a ghost read as a living humanoid.
    for (const t of ['ghost', 'spirit', 'undead', 'incorporeal']) expect(traits, t).toContain(t);
  });
});

describe('shape 2 — the trait belongs to ONE BRANCH of a choice', () => {
  const swimmer = (branch?: string) =>
    build({
      ancestryId: 'awakened-animal',
      heritageId: 'swimming-animal',
      ...(branch ? { effectChoices: { 'swimming-animal:aquatic-or-water-dwelling': branch } } : {}),
    });

  it('the aquatic trait reaches an AQUATIC Swimming Animal', () => {
    expect(traitsOf(swimmer('aquatic'))).toContain('aquatic');
  });

  it('the aquatic trait does NOT reach a WATER-DWELLING Swimming Animal', () => {
    /*
     * The branch exists precisely because that character still breathes air: "you can hold your breath
     * underwater for 10 minutes before needing air", against an aquatic trait the same paragraph
     * defines as "you breathe water but not air". Held at record level, the trait contradicted the
     * branch the player picked.
     */
    expect(traitsOf(swimmer('water-dwelling'))).not.toContain('aquatic');
  });

  it('and not before the question is answered', () => {
    expect(traitsOf(swimmer())).not.toContain('aquatic');
  });

  it('the branch trait names the record that asked, so the pill can say where it came from', () => {
    const entry = creatureTraitsOf(swimmer('aquatic'), db()).find((t) => t.trait === 'aquatic');
    expect(entry?.from).toBe('granted');
    expect(entry?.source).toBe('Swimming Animal');
  });

  it('a champion is holy, unholy or NEITHER — never holy by default', () => {
    /*
     * Sanctification is three-way: "If you 'can be' holy or unholy … you make that choice… If the
     * deity lists 'none,' you can choose only options that don't require the holy or unholy trait."
     * The record granted holy to every champion, including the unholy one — and the same paragraph
     * says gaining the opposing trait costs you the one you had until you atone.
     */
    const champ = (pick?: string) =>
      traitsOf(
        build({ classId: 'champion', keyAbility: 'str', ...(pick ? { featChoices: { 'feature:deity-champion': pick } } : {}) }),
      );
    expect(champ('holy')).toContain('holy');
    expect(champ('holy')).not.toContain('unholy');
    expect(champ('unholy')).toContain('unholy');
    expect(champ('unholy')).not.toContain('holy');
    expect(champ('none')).not.toContain('holy');
    expect(champ('none')).not.toContain('unholy');
    expect(champ()).not.toContain('holy');
  });

  it('the branch that grants no trait still grants its own numbers', () => {
    // Guard against "fixing" a branch by deleting its grant: water-dwelling keeps its swim Speed.
    expect(deriveSpeeds(swimmer('water-dwelling'), db()).swim).toBe(20);
    expect(deriveSpeeds(swimmer('aquatic'), db()).swim).toBe(30);
  });
});

describe('shape 3 — the ANSWER is the trait', () => {
  /*
   * "…and the trait appropriate to the type of servitor you've become (archon, angel, or azata, FOR
   * EXAMPLE)". One trait, not three, and the printed list is illustrative — so neither a flat array
   * nor a closed option list can say it. `grantsCreatureTraitFromChoice` names the record's own choice
   * and takes the answer at its word.
   */
  const answered = (featId: string, answer: string) => withFeat(featId, { featChoices: { '1:class:0': answer } });

  it('a picked servitor becomes a creature trait alongside the fixed one', () => {
    const traits = traitsOf(answered('celestial-form', 'azata'));
    expect(traits).toContain('celestial'); // the half that was authored
    expect(traits).toContain('azata'); // the half that was dropped
    expect(traitsOf(answered('fiendish-form', 'devil'))).toContain('devil');
  });

  it('a TYPED answer is honoured too — the printed list says "such as", not "one of"', () => {
    // Gold-set principle I: free-text player input is a legitimate choice type. `allowCustom` is set
    // on both servitor pickers because the book itself declines to close the list.
    expect(db().feats['fiendish-form'].choice?.allowCustom).toBeTruthy();
    expect(traitsOf(answered('fiendish-form', 'asura'))).toContain('asura');
  });

  it('an unanswered picker grants nothing rather than guessing the first option', () => {
    const traits = traitsOf(withFeat('celestial-form'));
    expect(traits).toContain('celestial');
    for (const t of ['archon', 'angel', 'azata']) expect(traits, t).not.toContain(t);
  });

  it("Celestial Rebirth's picker was echo-only and now reaches the sheet", () => {
    const traits = traitsOf(answered('celestial-rebirth', 'agathion'));
    expect(traits).toEqual(expect.arrayContaining(['celestial', 'holy', 'agathion']));
  });

  it('the flag must be the record’s OWN choice, so it can never read a neighbour’s answer', () => {
    const c = db();
    for (const id of ['celestial-form', 'fiendish-form', 'celestial-rebirth']) {
      const rec = c.feats[id];
      expect(rec.grantsCreatureTraitFromChoice, id).toBe(rec.choice?.flag);
    }
  });

  it('Elemental Apotheosis carries the element trait on the answer it already collected', () => {
    // "You also gain the elemental trait AND THE TRAIT OF YOUR CHOSEN ELEMENT." The six options
    // existed for the Speeds; the second half of the sentence now rides the same pick, so the element
    // cannot be one thing for Speed and another for the trait.
    const fire = withFeat('elemental-apotheosis', { effectChoices: { 'elemental-apotheosis:elemental-apotheosis-element': 'fire' } });
    expect(traitsOf(fire)).toContain('elemental');
    expect(traitsOf(fire)).toContain('fire');
    const air = withFeat('elemental-apotheosis', { effectChoices: { 'elemental-apotheosis:elemental-apotheosis-element': 'air' } });
    expect(traitsOf(air)).toContain('air');
    expect(traitsOf(air)).not.toContain('fire');
    expect(deriveSpeeds(air, db()).fly).toBe(80); // the Speed the option already granted is untouched
  });
});

describe('shape 4 — the trait is only true WHILE something is running', () => {
  /** Switch a mode on the way play state does: the resolved def, not just its id. */
  const withMode = (c: Character, modeId: string): Character => ({
    ...c,
    activeModes: [...(c.activeModes ?? []), db().modes![modeId] as ModeDef],
  });

  it('Worm Form’s animal trait is absent until the form is entered', () => {
    /*
     * "WHILE IN THIS FORM, you gain the animal trait. You can Dismiss the form." Authored on the feat,
     * it made a level-14 worm caller standing in a tavern an animal, permanently, with a pill whose
     * popup said "Granted by Worm Form" and no way to tell it was conditional.
     */
    const caller = withFeat('worm-form');
    expect(caller.feats.map((f) => f.featId)).toContain('worm-form'); // not a vacuous pass
    expect(traitsOf(caller)).not.toContain('animal');
    expect(traitsOf(withMode(caller, 'worm-form-purple-worm'))).toContain('animal');
    expect(traitsOf(withMode(caller, 'worm-form-hybrid'))).toContain('animal');
  });

  it('the form-scoped trait names the FORM, not the feat, so the player knows what to switch off', () => {
    const entry = creatureTraitsOf(withMode(withFeat('worm-form'), 'worm-form-purple-worm'), db()).find((t) => t.trait === 'animal');
    expect(entry?.source).toBe('Worm Form (purple worm)');
  });

  it('Fey Life’s trait waits for the death that grants it', () => {
    /*
     * "The FIRST TIME YOU DIE after gaining this feat … you revive … and you gain the fey trait" —
     * against a prerequisite reading "you helped to save a fey from a terrible fate, AND YOU'RE NOT A
     * FEY". Authored unconditionally, the record made the character fey at the instant it says they
     * are not. Principle M2: the app supplies the capability, the player supplies the timing.
     */
    const bound = withFeat('fey-life');
    expect(bound.feats.map((f) => f.featId)).toContain('fey-life'); // not a vacuous pass
    expect(traitsOf(bound)).not.toContain('fey');
    expect(traitsOf(withMode(bound, 'fey-life-revived'))).toContain('fey');
  });

  it('the mode that carries it is offered to the character who has the feat, and to nobody else', () => {
    // A trait with no reachable switch is worse than no trait at all (Q27): the player would be left
    // with a feat whose stated effect can never appear.
    const mode = db().modes!['fey-life-revived'] as ModeDef;
    expect(mode.predefined).toBe(true);
    expect(mode.feats).toEqual(['fey-life']);
    expect(mode.note).toContain('fey trait');
  });
});

describe('the lanes stay honest', () => {
  it('no record states a trait through more than one lane at once', () => {
    // Two lanes granting the same trait would make one of them impossible to disprove: the trait would
    // still show with the mode off, or with the branch unpicked, and look correct.
    const c = db();
    for (const [id, rec] of Object.entries(c.feats)) {
      if (!rec.grantsCreatureTraitFromChoice) continue;
      const answers = new Set((rec.choice?.options ?? []).map((o) => o.value));
      for (const t of rec.grantsCreatureTraits ?? []) expect(answers.has(t), `${id} grants ${t} twice`).toBe(false);
    }
  });

  it('only the ALWAYS-ON sink carries an option-granted trait — the other two would drop it in silence', () => {
    /*
     * `EffectGrant` is resolved by three sinks and only one of them reads this field:
     *  · always-on (feats / heritages / class features / deity / background) — `applyAlwaysOn`, which
     *    is where the field is honoured;
     *  · items — `resolvedItemPassives`, typed `ItemPassiveEffects`, which has no trait lane;
     *  · daily preparations — `dailyChoiceGrants`, whose readers take skills, senses and IWR only.
     * A trait authored into either of the last two would be resolved, discarded and never warned
     * about, which is precisely the "authored and silently inert" failure this whole pass is fixing.
     */
    const c = db();
    for (const [id, item] of Object.entries(c.items)) {
      for (const ch of item.effectChoices ?? []) {
        for (const o of ch.options ?? []) {
          expect(o.grant?.grantsCreatureTraits, `items/${id} → ${ch.id}/${o.value}`).toBeUndefined();
        }
      }
    }
    for (const bucket of ['feats', 'classFeatures', 'heritages', 'backgrounds'] as const) {
      for (const [id, rec] of Object.entries(c[bucket])) {
        if (!rec.choice?.daily) continue;
        for (const o of rec.choice.options ?? []) {
          expect(o.grant?.grantsCreatureTraits, `${bucket}/${id} (daily)`).toBeUndefined();
        }
      }
    }
  });

  it('the four static records still say exactly what their sentence says', () => {
    const c = db();
    expect(c.heritages['aiuvarin'].grantsCreatureTraits).toEqual(['elf', 'aiuvarin']);
    expect(c.heritages['dromaar'].grantsCreatureTraits).toEqual(['orc', 'dromaar']);
    expect(c.heritages['undine'].grantsCreatureTraits).toEqual(['undine', 'amphibious']);
    expect(c.feats['ghost-dedication'].grantsCreatureTraits).toEqual(['ghost', 'spirit', 'undead', 'incorporeal']);
  });

  it('the eight conditional records no longer carry an unconditional array of the chosen trait', () => {
    const c = db();
    expect(c.heritages['swimming-animal'].grantsCreatureTraits).toBeUndefined();
    expect(c.classFeatures['deity-champion'].grantsCreatureTraits).toBeUndefined();
    expect(c.feats['worm-form'].grantsCreatureTraits).toBeUndefined();
    expect(c.feats['fey-life'].grantsCreatureTraits).toBeUndefined();
  });
});
