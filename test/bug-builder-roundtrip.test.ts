import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { applyOverrides, buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';

/**
 * "there are still times where i change something in the builder, save, go back to edit, and some of
 *  my changes were undone." — owner, 2026-09-15.
 *
 * The save path is byte-lossless (bug-save-anyway-roundtrip.test.ts measured it); the losses are all
 * in the REVERSE derive, which is what the app reopens with whenever there is no stored build — an
 * import, a GM edit, a party-published sheet, the seed, and every rebuild whose stored build failed
 * to reconstruct. Two were fixed on 2026-09-13; this is the property test that found the rest.
 *
 * The property: `build → buildCharacter → deriveBuildFromCharacter → build'`, compared field by
 * field, over three synthesized fixtures — one per losing shape, built here out of the app's own
 * content — and every builder fixture the suite already keeps. Four fields are compared normalised,
 * because the character genuinely does not record what would be needed to reproduce them exactly —
 * each one is named below with the reason, and each is still pinned by the second assertion, which is
 * the one that actually matters: the CHARACTER either side of the trip must be identical, because
 * that is what the player looks at.
 *
 * The three shapes were found in real saves; the builds below are synthesized to hold the same
 * shapes, and each one was re-run against the reverted fix (adversarially confirmed, not assumed).
 *
 * What it caught (all fixed in src/rules/build.ts):
 *   featPicks            a feat that is BOTH a slot pick and an `overrides.addedFeats` chip was
 *                        dropped whole — the guardian loses Toughness (3rd) and Fleet (7th), the
 *                        bard loses Lucky Break and Ancestral Paragon.
 *   pickFeatChoices      …and with Ancestral Paragon went the Well-Met Traveler its grant had picked.
 *   grantedFeatChoices   a background-granted feat's sub-choice went with the row that was dropped to
 *                        avoid double-granting it — the rogue's Assurance lost its Athletics.
 *   classSkills          every skill granted by a source the hand-written list here did not know —
 *                        a background's own Lore choice (the Guard background's Legal Lore), a
 *                        heritage skill, and every FEAT-trained skill (Bardic Lore, Well-Met
 *                        Traveler's Diplomacy) — came back as a class-skill PICK and ate one of the
 *                        player's few free trainings.
 */

/**
 * Shape 1: a feat that is BOTH a slot pick and an override chip.
 *
 * A level-7 lizardfolk guardian with the Guard background. Toughness (3rd) and Fleet (7th) are real
 * general-feat picks AND sit in `overrides.addedFeats`; the Legal Lore the background's own choice
 * grants is also listed in `classSkills`, which is the classSkills leg.
 */
const GUARDIAN: BuildState = {
  ...emptyBuild(),
  name: 'Guardian fixture',
  level: 7,
  ancestryId: 'lizardfolk',
  heritageId: 'frilled-lizardfolk',
  backgroundId: 'guard',
  classId: 'guardian',
  keyAbility: 'str',
  ancestryBoosts: ['con'],
  backgroundBoosts: ['str', 'con'],
  levelBoosts: ['con', 'str', 'cha', 'wis'],
  // The Int boost at 5th is load-bearing: lizardfolk's Int flaw would otherwise cost a free training.
  attributeBoosts: { 5: ['con', 'str', 'int', 'wis'] },
  classSkills: ['lore:legal', 'crafting', 'society'],
  skillIncreases: { 3: 'athletics', 5: 'intimidation', 7: 'athletics' },
  featPicks: { '3:general:0': 'toughness', '7:general:0': 'fleet' },
  overrides: {
    addedFeats: [
      { featId: 'fleet', level: 1, category: 'general' },
      { featId: 'shield-block', level: 1, category: 'general' },
      { featId: 'toughness', level: 1, category: 'general' },
    ],
  },
};

/**
 * Shape 2: a background-granted feat carrying a sub-choice.
 *
 * A level-7 ratfolk rogue whose custom ("deep") background grants Assurance; the skill Assurance
 * names lives in `grantedFeatChoices` under the bare feat id, and went with the row the derive drops
 * to avoid granting the background's feat twice.
 */
const ROGUE: BuildState = {
  ...emptyBuild(),
  name: 'Rogue fixture',
  level: 7,
  ancestryId: 'ratfolk',
  heritageId: 'sewer-rat',
  backgroundId: '__custom__',
  classId: 'rogue',
  subclassId: 'thief',
  keyAbility: 'dex',
  ancestryBoosts: ['con'],
  levelBoosts: ['dex', 'con', 'cha', 'wis'],
  attributeBoosts: { 5: ['dex', 'cha', 'con', 'wis'] },
  classSkills: ['athletics', 'acrobatics', 'survival', 'intimidation', 'society'],
  skillIncreases: { 3: 'thievery', 5: 'acrobatics', 7: 'stealth' },
  featPicks: { '1:class:1': 'nimble-dodge', '3:general:1': 'fleet' },
  customBackground: {
    name: '',
    description: '',
    boosts: [null, null],
    trainedSkill: null,
    loreSubject: '',
    skillFeatId: 'assurance',
  },
  grantedFeatChoices: { assurance: 'athletics' },
};

/**
 * Shape 3: a subclass-granted spell in the repertoire, plus a pick-granted feat's own answer.
 *
 * A level-7 catfolk maestro bard: Soothe is the maestro's granted rank-1 spell and is ALSO listed in
 * the repertoire, the background is a custom one, and Ancestral Paragon (7th) / Lucky Break (5th) are
 * slot picks that also appear as override chips. Ancestral Paragon's own pick — Well-Met Traveler —
 * has to travel with whichever slot Ancestral Paragon lands in.
 */
const BARD: BuildState = {
  ...emptyBuild(),
  name: 'Bard fixture',
  level: 7,
  ancestryId: 'catfolk',
  heritageId: 'liminal-catfolk',
  backgroundId: '__custom__',
  classId: 'bard',
  subclassId: 'maestro',
  keyAbility: 'cha',
  ancestryBoosts: ['wis'],
  levelBoosts: ['int', 'cha', 'dex', 'con'],
  attributeBoosts: { 5: ['int', 'wis', 'cha', 'dex'] },
  classSkills: ['acrobatics', 'deception', 'intimidation', 'nature'],
  skillIncreases: { 3: 'performance', 5: 'deception', 7: 'performance' },
  cantrips: ['light'],
  spells: { 1: ['command', 'soothe'] },
  featPicks: {
    '1:ancestry:0': 'cats-luck',
    '3:general:0': 'incredible-initiative',
    '5:ancestry:0': 'lucky-break',
    '7:general:0': 'ancestral-paragon',
  },
  pickFeatChoices: { '7:general:0': 'well-met-traveler' },
  customBackground: {
    name: '',
    description: '',
    boosts: ['dex', 'cha'],
    trainedSkill: 'survival',
    loreSubject: '',
    skillFeatId: 'seasoned',
  },
  overrides: {
    addedFeats: [
      { featId: 'ancestral-paragon', level: 3, category: 'general' },
      { featId: 'lucky-break', level: 5, category: 'ancestry' },
    ],
  },
};

const partial = (over: Partial<BuildState> = {}): BuildState => ({
  ...emptyBuild(),
  name: 'Unfinished',
  level: 7,
  ancestryId: 'catfolk',
  heritageId: 'liminal-catfolk',
  backgroundId: 'acolyte',
  classId: 'bard',
  subclassId: 'maestro',
  keyAbility: 'cha',
  ...over,
});

const FIXTURES: Record<string, BuildState> = {
  // The three losing shapes, synthesized.
  'a guardian 7 whose override chips double two slot picks': GUARDIAN,
  'a rogue 7 whose custom background grants a feat with a sub-choice': ROGUE,
  'a bard 7 with a granted spell, a custom background and override chips': BARD,
  // …and the shapes the suite already keeps (bug-save-anyway-roundtrip, bug-change-ancestry-confirm).
  'no ancestry boost answered': partial({ ancestryBoosts: [] }),
  'one skill increase of four': partial({ skillIncreases: { 3: 'acrobatics' } }),
  'one level-1 free boost of four, one of four at 5th': partial({
    levelBoosts: ['cha', null, null, null],
    attributeBoosts: { 5: ['cha', null, null, null] },
  }),
  'one class feat, the rest empty': partial({ featPicks: { '2:class:0': 'bardic-lore' } }),
  'a cantrip and one spell': partial({ cantrips: ['light'], spells: { 1: ['soothe'] } }),
  'an item picked, nothing paid for': partial({ inventory: [{ itemId: 'longsword', quantity: 1, equipped: true }] }),
  'a half-answered everything': partial({
    ancestryBoosts: ['int'],
    backgroundBoosts: [null, 'wis'],
    levelBoosts: ['cha', 'dex', null, null],
    skillIncreases: { 3: 'acrobatics' },
    featPicks: { '2:class:0': 'bardic-lore' },
    cantrips: ['light'],
    inventory: [{ itemId: 'longsword', quantity: 1, equipped: true }],
  }),
  'a level-3 catfolk bard with a pick of every kind': {
    ...emptyBuild(),
    name: 'Kyra',
    level: 3,
    ancestryId: 'catfolk',
    heritageId: 'clawed-catfolk',
    backgroundId: 'acolyte',
    classId: 'bard',
    subclassId: 'maestro',
    keyAbility: 'cha',
    ancestryBoosts: ['int'],
    languages: ['amurrun'],
    featPicks: { '1:ancestry:0': 'cats-luck', '2:class:0': 'bardic-lore' },
  },
};

/**
 * The four fields the derive may legitimately RECOMPUTE rather than reproduce, and why.
 *
 * None of them is a free pass: every one is still covered by the character comparison below, which
 * is byte-exact. A recomputation that changed anything the player can see fails there.
 *
 *   the four boost lanes  A `Character` records final ability SCORES, never which group each boost
 *                         came from. Any split that reaches the same scores is equally faithful, so
 *                         the solver's answer may move a boost between the ancestry/background/level
 *                         lanes and may fill the empty slots an unfinished build left as `[]`.
 *   classSkills           Order carries no meaning (the set is what trains), and a GRANTED skill that
 *                         the player also listed as a pick is dropped — buildCharacter skips it
 *                         anyway (`if (locked.has(sk)) continue`), so keeping it only burns a slot.
 *                         That drop is the point of the classSkills fix, not a loss.
 *   spells / cantrips     Same rule one lane over: a spell the subclass GRANTS (a maestro's Soothe)
 *                         is subtracted from the player's repertoire, and every reachable rank is
 *                         materialised as an empty list.
 *   languages             A language the ancestry already grants is not a bonus pick.
 */
const boostLanes = ['ancestryBoosts', 'backgroundBoosts', 'levelBoosts', 'attributeBoosts'];
const RECOMPUTED = new Set([...boostLanes, 'classSkills', 'spells', 'cantrips', 'languages']);

const sorted = (v: unknown) => (Array.isArray(v) ? [...(v as string[])].sort() : v);

describe('a builder round-trip loses nothing', () => {
  // bug 2026-09-15: builder round-trip
  it.each(Object.keys(FIXTURES))('%s', (label) => {
    const db = content();
    const before = FIXTURES[label];
    const ov = applyOverrides(db, before.overrides);
    const ch = buildCharacter(before, ov);
    const after = deriveBuildFromCharacter(ch, ov);

    // 1. Field by field. Anything outside RECOMPUTED must come back exactly as it went in.
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (RECOMPUTED.has(key)) continue;
      const a = (before as Record<string, unknown>)[key];
      const b = (after as Record<string, unknown>)[key];
      // An empty object/array and an absent field mean the same thing to the builder.
      if (a === undefined && JSON.stringify(b ?? null) === '{}') continue;
      if (b === undefined && JSON.stringify(a ?? null) === '{}') continue;
      expect(key === 'classSkills' ? sorted(b) : b, `${label}: build.${key} changed on the way back`).toEqual(
        key === 'classSkills' ? sorted(a) : a,
      );
    }

    // 2. …and the thing the player actually looks at, byte for byte. This is what makes the four
    // recomputed lanes above safe to skip: a re-solved boost split that moved a single ability, a
    // dropped spell that was NOT granted, a class skill that was NOT granted — all land here.
    expect(buildCharacter(after, applyOverrides(db, after.overrides)), `${label}: the CHARACTER changed`).toEqual(ch);
  });

  // bug 2026-09-15: builder round-trip
  it("keeps a feat that is both a slot pick and a granted chip in its slot", () => {
    const db = content();
    const ov = applyOverrides(db, GUARDIAN.overrides);
    const back = deriveBuildFromCharacter(buildCharacter(GUARDIAN, ov), ov);
    // The guardian's overrides.addedFeats names Fleet, Shield Block and Toughness; two of those are
    // also real general-feat picks. Dropping by feat ID emptied both slots.
    expect(back.featPicks['3:general:0']).toBe('toughness');
    expect(back.featPicks['7:general:0']).toBe('fleet');
    // …and the chips themselves are untouched, so nothing is granted twice or lost.
    expect(back.overrides?.addedFeats).toEqual(GUARDIAN.overrides?.addedFeats);
  });

  // bug 2026-09-15: builder round-trip
  it("keeps a background-granted feat's sub-choice", () => {
    const db = content();
    const ov = applyOverrides(db, ROGUE.overrides);
    const back = deriveBuildFromCharacter(buildCharacter(ROGUE, ov), ov);
    // The custom background grants Assurance; the skill it names lives in grantedFeatChoices, keyed
    // by the bare feat id, and went with the row that was dropped to avoid double-granting it.
    expect(back.grantedFeatChoices?.assurance).toBe('athletics');
  });

  // bug 2026-09-15: builder round-trip
  it("keeps a pick-granted feat's answer with the slot its granter lands in", () => {
    const db = content();
    const ov = applyOverrides(db, BARD.overrides);
    const back = deriveBuildFromCharacter(buildCharacter(BARD, ov), ov);
    expect(back.featPicks['7:general:0']).toBe('ancestral-paragon');
    expect(back.pickFeatChoices?.['7:general:0']).toBe('well-met-traveler');
  });

  // bug 2026-09-15: builder round-trip
  it('never files a granted skill as a class-skill pick', () => {
    const db = content();
    for (const [label, build] of Object.entries(FIXTURES)) {
      const ov = applyOverrides(db, build.overrides);
      const ch = buildCharacter(build, ov);
      const back = deriveBuildFromCharacter(ch, ov);
      const granted = Object.keys(ch.grantedSkills ?? {});
      expect(back.classSkills.filter((s) => granted.includes(s)), `${label}: granted skills in classSkills`).toEqual([]);
      // …and the feat-trained ones, which are not in `grantedSkills` either: the guardian's Legal Lore
      // came from the Guard background's own Lore choice, Kyra's Bardic Lore from a feat, the bard's
      // Diplomacy from the feat Ancestral Paragon picked. Each one burned a free training on reopen.
      for (const dead of ['lore:legal', 'lore:bardic', 'diplomacy']) {
        if (!granted.includes(dead) && build.classSkills.includes(dead as never)) continue;
        expect(back.classSkills, `${label}: ${dead} is granted, not a pick`).not.toContain(dead);
      }
    }
  });
});
