import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, emptyBuild, boundGrantChoice, featSkillChoiceValue, type BuildState } from '../src/rules/build';
import { FEAT_FEAT_GRANTS, FEAT_GRANT_BOUND_CHOICE, isBoundGrant } from '../src/rules/featFeatGrants';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { CHOICE_SITUATIONAL } from '../src/rules/situationalBonuses';
import { explainStat, statHasSituational } from '../src/rules/explain';
import { SKILLS, type ProficiencyKey } from '../src/rules/types';

const db = content();

/**
 * Ruling Q20: *"remember Assurance needs to have a `*` on the skill that it affects."*
 *
 * Assurance changes no number — you take 10 + your proficiency bonus instead of rolling — so nothing
 * computes, and before this the word `assurance` appeared nowhere in situationalBonuses.ts. No
 * character had an Assurance star, however it was acquired.
 *
 * FEAT_SITUATIONAL could never carry it: that table names its targets when it is written, and
 * Assurance's target is whichever skill THIS player picked, on a feat they may take several times.
 * The star has to be built from the answer, at display time.
 */
const skillsOf = (ch: Parameters<typeof statHasSituational>[0]) =>
  (Object.keys(ch.proficiencies.skills) as ProficiencyKey[]).filter((k) =>
    statHasSituational(ch, { kind: 'skill', skill: k }, db),
  );

/** A character with one feat dropped into a slot, plus that slot's answer. */
function withFeat(featId: string, slotKey: string, answer?: string, over: Partial<BuildState> = {}) {
  return build('rogue', 15, {
    featPicks: { [slotKey]: featId } as BuildState['featPicks'],
    ...(answer ? { featChoices: { [slotKey]: answer } as BuildState['featChoices'] } : {}),
    ...over,
  });
}

describe('a star whose target comes from the player’s answer', () => {
  it('Assurance stars the skill the player chose — and only that one', () => {
    const ch = withFeat('assurance', '1:skill', 'athletics');
    expect(ch.feats.find((f) => f.featId === 'assurance')?.choice?.value).toBe('athletics');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'athletics' }, db)).toBe(true);
    // The whole point of reading the answer: a DIFFERENT skill must stay unstarred.
    expect(statHasSituational(ch, { kind: 'skill', skill: 'stealth' }, db)).toBe(false);
  });

  it('the answer moves the star, rather than the star being fixed on the record', () => {
    const stealth = withFeat('assurance', '1:skill', 'stealth');
    expect(statHasSituational(stealth, { kind: 'skill', skill: 'stealth' }, db)).toBe(true);
    expect(statHasSituational(stealth, { kind: 'skill', skill: 'athletics' }, db)).toBe(false);
  });

  it('an unanswered Assurance stars nothing — it must not guess a skill', () => {
    const ch = withFeat('assurance', '1:skill');
    expect(skillsOf(ch)).toEqual([]);
  });

  it('the note says what to do and opens the feat that says it', () => {
    const ch = withFeat('assurance', '1:skill', 'athletics');
    const notes = explainStat(ch, db, { kind: 'skill', skill: 'athletics' }).situational ?? [];
    expect(notes.length).toBe(1);
    expect(notes[0].text).toMatch(/Assurance/);
    expect(notes[0].text).toMatch(/10 \+ your proficiency bonus/);
    // Ruling H — the line has a place to click to open the full record.
    expect(notes[0].sourceId).toBe('assurance');
    expect(notes[0].sourceCollection).toBe('feats');
  });

  it('Assurance is repeatable, so two takings star two skills', () => {
    const ch = build('rogue', 15, {
      featPicks: { '1:skill': 'assurance', '2:skill': 'assurance' } as BuildState['featPicks'],
      featChoices: { '1:skill': 'athletics', '2:skill': 'stealth' } as BuildState['featChoices'],
    });
    expect(ch.feats.filter((f) => f.featId === 'assurance').length).toBe(2);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'athletics' }, db)).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'stealth' }, db)).toBe(true);
  });

  it('a granted Assurance stars its skill too, by the same route', () => {
    // Eidetic Ear grants "the Assurance (Performance) feat" — no slot, no featChoices entry. The
    // answer travels on the granted feat's own entry, which is why one loop covers both routes.
    const ch = withFeat('eidetic-ear', '1:ancestry');
    expect(ch.feats.find((f) => f.featId === 'assurance')?.grantedBy).toBe('eidetic-ear');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'performance' }, db)).toBe(true);
  });

  it('a Lore answer stars that Lore, not every Lore', () => {
    const ch = withFeat('gnome-obsession', '1:ancestry', undefined, {
      featLoreChoices: { 'gnome-obsession:0': 'Games' },
    } as Partial<BuildState>);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'lore:games' as ProficiencyKey }, db)).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'lore:warfare' as ProficiencyKey }, db)).toBe(false);
  });
});

describe('the other records whose choice names a skill they then act on', () => {
  it('Automatic Knowledge stars the skill it makes a free action', () => {
    const ch = withFeat('automatic-knowledge', '2:skill', 'society');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'society' }, db)).toBe(true);
    const notes = explainStat(ch, db, { kind: 'skill', skill: 'society' }).situational ?? [];
    expect(notes.some((n) => /Recall Knowledge/.test(n.text))).toBe(true);
  });

  it('Masterful Obfuscation stars the skill you roll instead of Deception', () => {
    const ch = withFeat('masterful-obfuscation', '10:skill', 'occultism');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'occultism' }, db)).toBe(true);
    const notes = explainStat(ch, db, { kind: 'skill', skill: 'occultism' }).situational ?? [];
    expect(notes.some((n) => /instead of Deception/.test(n.text))).toBe(true);
  });

  it('Heroic Scion keeps its shipped Perception entry AND stars the skill it asks for', () => {
    const ch = withFeat('heroic-scion-dedication', '12:class', 'diplomacy');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'diplomacy' }, db)).toBe(true);
    // The static entry and the answer-driven one are different lanes; adding one must not cost the other.
    expect(statHasSituational(ch, { kind: 'perception' }, db)).toBe(true);
  });

  /**
   * Two shapes, and each has its own way of being wrong.
   *
   * Without `skill` the ANSWER is the target, so it has to be a skill key — a `kind: 'array'` record
   * here would aim a star at "natural" and hit nothing. With `skill` the target is fixed and the answer
   * is only quoted, so any choice kind is fine; what must hold instead is that the record HAS a choice
   * (an entry on a choice-less feat can never fire) and that the fixed skill is real.
   */
  it('every entry names a real record whose answer it can actually use', () => {
    const bad: string[] = [];
    for (const [id, entries] of Object.entries(CHOICE_SITUATIONAL)) {
      const rec = db.feats[id];
      if (!rec) {
        bad.push(`${id}: no such feat`);
        continue;
      }
      if (!rec.choice) bad.push(`${id}: the record asks no question, so nothing can answer it`);
      for (const e of entries) {
        if (!e.skill && rec.choice?.kind !== 'skills') bad.push(`${id}: answer-targeted, but choice kind is ${rec.choice?.kind ?? 'none'}`);
        if (e.skill && !SKILLS.includes(e.skill)) bad.push(`${id}: "${e.skill}" is not a skill`);
        if (e.when.includes('{answer}') && !e.skill) bad.push(`${id}: quotes the answer into a star aimed AT the answer`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/**
 * The second defect. Weight of Experience: *"You gain the trained proficiency rank in one skill of
 * your choice and the Assurance skill feat IN THAT SKILL as a bonus feat."* The granted Assurance was
 * asking its own free 16-skill question, so a player could train Medicine and be assured in Stealth.
 */
describe('a granted choice the granting feat already answered', () => {
  const anc = Object.keys(db.ancestries)[0];
  const bg = Object.keys(db.backgrounds)[0];
  const withGranter = (featId: string, over: Partial<BuildState> = {}) =>
    buildCharacter(
      {
        ...emptyBuild(),
        level: 5,
        classId: 'rogue',
        ancestryId: anc,
        backgroundId: bg,
        keyAbility: 'dex',
        featPicks: { '1:ancestry': featId } as BuildState['featPicks'],
        ...over,
      } as BuildState,
      db,
    );

  it('Weight of Experience assures the skill it trained, not a second free pick', () => {
    const ch = withGranter('weight-of-experience', {
      featSkillChoices: { 'weight-of-experience:0': 'medicine' },
      // A stale answer to the free question the builder used to ask. The feat's own text must win.
      grantedFeatChoices: { assurance: 'stealth' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.medicine).toBe('trained');
    expect(ch.feats.find((f) => f.featId === 'assurance')?.choice?.value).toBe('medicine');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'medicine' }, db)).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'stealth' }, db)).toBe(false);
  });

  it('Quah Bond likewise assures the skill it trained', () => {
    const ch = withGranter('quah-bond', {
      featSkillChoices: { 'quah-bond:0': 'religion' },
      grantedFeatChoices: { assurance: 'stealth' },
    } as Partial<BuildState>);
    expect(ch.feats.find((f) => f.featId === 'assurance')?.choice?.value).toBe('religion');
  });

  it('Gnome Obsession assures the chosen Lore', () => {
    const ch = withGranter('gnome-obsession', {
      featLoreChoices: { 'gnome-obsession:0': 'Games' },
      grantedFeatChoices: { assurance: 'stealth' },
    } as Partial<BuildState>);
    expect(ch.feats.find((f) => f.featId === 'assurance')?.choice).toEqual({ value: 'lore:games', label: 'Games Lore' });
  });

  it('Eidetic Ear is fixed to Performance, because its text names it', () => {
    const ch = withGranter('eidetic-ear', { grantedFeatChoices: { assurance: 'stealth' } } as Partial<BuildState>);
    expect(ch.feats.find((f) => f.featId === 'assurance')?.choice?.value).toBe('performance');
  });

  it('an unanswered granter still binds to the skill it actually trained', () => {
    // The grant defaults an unanswered slot to its first option and trains that skill regardless, so
    // the bound Assurance has to name the same one — otherwise the sheet contradicts itself.
    const ch = withGranter('weight-of-experience');
    const bound = ch.feats.find((f) => f.featId === 'assurance')?.choice?.value as ProficiencyKey;
    expect(bound).toBeTruthy();
    expect(ch.proficiencies.skills[bound]).toBe('trained');
    expect(bound).toBe(featSkillChoiceValue({}, 'weight-of-experience', 0));
  });

  it('an un-named Lore binds nothing rather than inventing a subject', () => {
    const ch = withGranter('gnome-obsession');
    expect(ch.feats.find((f) => f.featId === 'assurance')?.choice).toBeUndefined();
  });

  it('a declared-but-unanswerable binding is still a binding', () => {
    // The builder withholds its free picker on `isBoundGrant`, not on the resolved value. Gnome
    // Obsession's Lore has no default, so between taking the feat and naming the Lore there is a
    // window where the binding exists and the answer does not — and offering the 16-skill list there
    // would hand the player a control whose answer is thrown away the moment they type the subject.
    expect(isBoundGrant('gnome-obsession', 'assurance')).toBe(true);
    expect(boundGrantChoice({}, 'gnome-obsession', 'assurance')).toBeUndefined();
    // An ordinary grant is untouched: Seeker of Truths' Domain Initiate still asks for itself.
    expect(isBoundGrant('seeker-of-truths', 'domain-initiate')).toBe(false);
  });

  it('every binding names a grant that actually exists', () => {
    const bad: string[] = [];
    for (const [granter, grants] of Object.entries(FEAT_GRANT_BOUND_CHOICE)) {
      for (const [granted, spec] of Object.entries(grants)) {
        if (!(FEAT_FEAT_GRANTS[granter] ?? []).includes(granted)) bad.push(`${granter} does not grant ${granted}`);
        if (!db.feats[granted]?.choice) bad.push(`${granted} has no choice to bind`);
        if (spec.kind === 'skillChoice' && !FEAT_GRANTS[granter]?.skillChoices?.[spec.index])
          bad.push(`${granter} has no skillChoices[${spec.index}]`);
        if (spec.kind === 'fixed' && !boundGrantChoice({}, granter, granted))
          bad.push(`${granter} → ${granted} resolves to nothing`);
      }
    }
    expect(bad).toEqual([]);
  });
});
