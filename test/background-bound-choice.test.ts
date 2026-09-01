import { describe, it, expect } from 'vitest';
import { buildCharacter, emptyBuild, boundBackgroundGrantChoice, resolveBackground, type BuildState } from '../src/rules/build';
import { BACKGROUND_GRANT_BOUND_CHOICE, isBoundBackgroundGrant } from '../src/rules/backgroundGrants';
import { backgroundGrantedFeats } from '../src/rules/build';
import { statHasSituational } from '../src/rules/explain';
import { content } from './_content';
import type { ProficiencyKey, SkillId } from '../src/rules/types';

const db = content();

/**
 * A BACKGROUND that answers its granted feat's question, because its own text already did.
 *
 * Abadar's Avenger says *"You gain the Assurance skill feat with Religion"* and the builder offered
 * the free 16-skill list anyway — the same defect `FEAT_GRANT_BOUND_CHOICE` fixed one lane over, on
 * the other route that hands a character a feat they did not pick.
 *
 * Ruling Q20 is what makes it a real defect rather than a tidiness one: *"remember Assurance needs to
 * have a `*` on the skill that it affects."* Assurance moves no number, so the answer's ONLY job is
 * to place that star. A free answer put it on the wrong skill; no answer put it nowhere.
 */
const anc = Object.keys(db.ancestries)[0];

function withBackground(backgroundId: string, over: Partial<BuildState> = {}) {
  return buildCharacter(
    {
      ...emptyBuild(),
      level: 1,
      ancestryId: anc,
      backgroundId,
      classId: 'fighter',
      keyAbility: 'str',
      ...over,
    } as BuildState,
    db,
  );
}

const answerOn = (backgroundId: string, featId: string, over: Partial<BuildState> = {}) =>
  withBackground(backgroundId, over).feats.find((f) => f.featId === featId)?.choice;

describe('a background-granted feat whose answer the background already gave', () => {
  it('Abadar’s Avenger assures Religion, and a stale free pick does not override it', () => {
    // `grantedFeatChoices` is what the free picker used to write. The text outranks it.
    expect(answerOn('abadars-avenger', 'assurance', { grantedFeatChoices: { assurance: 'stealth' } })).toEqual({
      value: 'religion',
      label: 'Religion',
    });
  });

  it('the star lands on Religion and on nothing else — ruling Q20’s whole point', () => {
    const ch = withBackground('abadars-avenger');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'religion' }, db)).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'stealth' }, db)).toBe(false);
    // And it is the skill the background actually trained, so the sheet cannot contradict itself.
    expect(ch.proficiencies.skills.religion).toBe('trained');
  });

  it('a background naming its skill in passing binds too, not just the one that was reported', () => {
    // The eight other "with <Skill>" Assurance backgrounds are the same sentence with a different
    // noun; fixing only the reported one would have left them all wrong.
    expect(answerOn('mantis-scion', 'assurance')?.value).toBe('stealth');
    expect(answerOn('goblinblood-orphan', 'assurance')?.value).toBe('survival');
    expect(answerOn('eldritch-anatomist', 'assurance')?.value).toBe('medicine');
    expect(answerOn('star-athlete', 'assurance')?.value).toBe('athletics');
  });

  it('“your chosen skill” follows the background’s own skill pick', () => {
    // Scholar: "trained in your choice of the Arcana, Nature, Occultism, or Religion skill, and gain
    // the Assurance skill feat IN YOUR CHOSEN SKILL."
    expect(answerOn('scholar', 'assurance', { backgroundSkillChoice: 'occultism' as SkillId })?.value).toBe('occultism');
    expect(answerOn('scholar', 'assurance', { backgroundSkillChoice: 'nature' as SkillId })?.value).toBe('nature');
  });

  it('an unanswered skill pick binds to the skill the background actually trains', () => {
    // The background trains its first offered skill whether or not the player answered, so the
    // assured skill has to default the same way or the sheet names a skill nobody is trained in.
    const ch = withBackground('scholar');
    const bound = ch.feats.find((f) => f.featId === 'assurance')?.choice?.value as ProficiencyKey;
    expect(bound).toBeTruthy();
    expect(ch.proficiencies.skills[bound]).toBe('trained');
  });

  it('Aeronaut assures the LORE its text names, not the skill it trains', () => {
    // "You're trained in the Athletics skill and the Piloting Lore skill. You gain the Assurance
    // skill feat with Piloting Lore." Reading the binding off `trainedSkill` would say Athletics.
    expect(answerOn('aeronaut', 'assurance')).toEqual({ value: 'lore:piloting', label: 'Piloting Lore' });
    const ch = withBackground('aeronaut');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'lore:piloting' as ProficiencyKey }, db)).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'athletics' }, db)).toBe(false);
  });

  it('Driver’s “the chosen lore” follows the pick, defaulting to the first printed option', () => {
    /* Batch 21 made Driver's Lore the printed two-way pick (`trainedLoreOptions: driving/piloting`),
     * so an unanswered build defaults to Driving like every other unanswered named choice — the old
     * "waits for free text" behavior belonged to the free-text era of this record. */
    expect(answerOn('driver', 'assurance')).toEqual({ value: 'lore:driving', label: 'Driving Lore' });
    expect(answerOn('driver', 'assurance', { backgroundLore: 'piloting' })).toEqual({
      value: 'lore:piloting',
      label: 'Piloting Lore',
    });
  });

  it('Raised by Belief follows the deity’s Divine Skill', () => {
    // "You're trained in the deity's listed Divine Skill and gain the Assurance feat with that skill."
    expect(answerOn('raised-by-belief', 'assurance')).toBeUndefined(); // no deity chosen yet
    const abadar = db.deities['abadar'];
    expect(abadar?.skill, 'the deity record must carry the skill this binding reads').toBeTruthy();
    expect(answerOn('raised-by-belief', 'assurance', { deityId: 'abadar' })?.value).toBe(abadar!.skill);
  });

  it('the other four feats bind by their own option labels, not by skill names', () => {
    // Terrain Expertise / Specialty Crafting / Virtuosic Performer / Terrain Stalker are
    // `kind: 'array'` choices, so the label has to come off the record rather than be capitalised.
    expect(answerOn('clown', 'virtuosic-performer')).toEqual({ value: 'comedy', label: 'Comedy' });
    expect(answerOn('miner', 'terrain-expertise')).toEqual({ value: 'underground', label: 'Underground' });
    expect(answerOn('alloysmith', 'specialty-crafting')).toEqual({ value: 'blacksmithing', label: 'Blacksmithing' });
    expect(answerOn('nirmathi-guerrilla', 'terrain-stalker')).toEqual({ value: 'underbrush', label: 'Underbrush' });
  });

  it('Conservator binds only on the branch that actually grants Assurance', () => {
    // "If you chose Thievery, you gain the Assurance (Thievery) skill feat." The Crafting branch
    // grants Quick Repair, which has no choice at all — so the binding must not leak onto it.
    const thievery = withBackground('conservator', { backgroundSkillChoice: 'thievery' as SkillId });
    expect(thievery.feats.find((f) => f.featId === 'assurance')?.choice?.value).toBe('thievery');
    const crafting = withBackground('conservator', { backgroundSkillChoice: 'crafting' as SkillId });
    expect(crafting.feats.some((f) => f.featId === 'assurance')).toBe(false);
    expect(crafting.feats.some((f) => f.featId === 'quick-repair')).toBe(true);
  });
});

describe('the binding table describes records that really exist', () => {
  it('every background named grants the feat the entry answers for', () => {
    // A binding for a grant that does not happen is dead weight that reads as coverage.
    const bad: string[] = [];
    for (const [bgId, grants] of Object.entries(BACKGROUND_GRANT_BOUND_CHOICE)) {
      const bg = db.backgrounds[bgId];
      if (!bg) {
        bad.push(`${bgId}: no such background`);
        continue;
      }
      for (const grantedId of Object.keys(grants)) {
        // Either branch of a by-choice grant counts — Conservator only grants Assurance on one.
        // A FEAT-VALUED background `choice` counts too: Hermean Heritor's either/or (batch 20)
        // grants whichever feat the option names, through the bgChoiceFeat lane.
        const reachable =
          [undefined, ...(bg.trainedSkillChoice ?? [])].some((s) =>
            backgroundGrantedFeats(bg, s as SkillId | undefined).includes(grantedId),
          ) || (bg.choice?.options ?? []).some((o) => o.value === grantedId);
        if (!reachable) bad.push(`${bgId} does not grant ${grantedId}`);
        // A fixedLore/bgLore binding can answer a question the feat asks OFF-record: Additional
        // Lore's subject is featGrantsAuto's loreChoices lane (Returned binds it to Boneyard,
        // batch 23), so "no record-level choice" is not "nothing to bind" for the lore kinds.
        const spec = grants[grantedId];
        const answersLoreLane = spec.kind === 'fixedLore' || spec.kind === 'bgLore';
        if (!db.feats[grantedId]?.choice && !answersLoreLane) bad.push(`${grantedId} has no choice to bind`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every binding resolves to an option the feat would actually accept', () => {
    // A `fixed` value that is not one of the feat's own options would render a label the picker
    // never offered — the failure mode that makes a wrong answer look like a right one.
    const bad: string[] = [];
    for (const [bgId, grants] of Object.entries(BACKGROUND_GRANT_BOUND_CHOICE)) {
      const bg = resolveBackground({ ...emptyBuild(), backgroundId: bgId } as BuildState, db);
      for (const [grantedId, spec] of Object.entries(grants)) {
        if (spec.kind !== 'fixed') continue; // the deferred kinds resolve from build state, tested above
        const got = boundBackgroundGrantChoice({}, db, bg, grantedId);
        if (!got) {
          bad.push(`${bgId} → ${grantedId} resolves to nothing`);
          continue;
        }
        const def = db.feats[grantedId]!.choice!;
        const options = def.options?.map((o) => o.value);
        // `kind: 'skills'` is an open list resolved from the build, so only 'array' can be checked.
        if (options?.length && !options.includes(got.value)) {
          bad.push(`${bgId} → ${grantedId}: "${got.value}" is not one of ${options.join('/')}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('a background whose text leaves the pick open is NOT bound', () => {
    // Ruling Q20's test is two questions, and "does the choice name a specific stat?" has to be
    // allowed to answer no. These four say "you gain <feat>" and stop.
    for (const id of ['keys-to-destiny', 'trailblazer', 'musical-prodigy', 'relentless-dedication']) {
      expect(db.backgrounds[id], `${id} should still ship`).toBeTruthy();
      expect(isBoundBackgroundGrant(id, 'assurance')).toBe(false);
      expect(BACKGROUND_GRANT_BOUND_CHOICE[id]).toBeUndefined();
    }
  });

  it('a declared binding counts as bound even before it can be resolved', () => {
    // The builder withholds its free picker on `isBoundBackgroundGrant`, not on the resolved value.
    // Driver's Lore and Raised by Belief's deity both have a window where the binding exists and the
    // answer does not, and offering the 16-skill list there hands the player a discarded control.
    expect(isBoundBackgroundGrant('driver', 'assurance')).toBe(true);
    // Driver now resolves even unanswered (first printed option — batch 21); Raised by Belief still
    // has the unresolvable window (no deity chosen), which is what this property is really about.
    expect(boundBackgroundGrantChoice({}, db, db.backgrounds['driver'], 'assurance')).toEqual({ value: 'lore:driving', label: 'Driving Lore' });
    expect(isBoundBackgroundGrant('raised-by-belief', 'assurance')).toBe(true);
    // An ordinary grant is untouched.
    expect(isBoundBackgroundGrant('keys-to-destiny', 'assurance')).toBe(false);
    expect(isBoundBackgroundGrant(undefined, 'assurance')).toBe(false);
  });
});
