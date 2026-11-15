import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { featPlaceKey, featPlaceKeyOf } from '../src/rules/blocks/active';
import { printedFeatPlaces } from '../src/rules/featSlots';
import { authoredKey } from '../src/data/authored';
import { editableBuildOf } from '../src/data/editBuild';
import { rebuildRoster } from '../src/data/rebuild';
import { exportNative, exportWg, importCharacter } from '../src/data/transfer';
import { normalizeCharacter } from '../src/rules/normalize';
import type { SavedChar } from '../src/data/storage';
import type { BuildOverrides, Character } from '../src/rules/types';

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
    const ov = contentFor(db, before);
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
    expect(buildCharacter(after, contentFor(db, after)), `${label}: the CHARACTER changed`).toEqual(ch);
  });

  // bug 2026-09-15: builder round-trip
  it("keeps a feat that is both a slot pick and a granted chip in its slot", () => {
    const db = content();
    const ov = contentFor(db, GUARDIAN);
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
    const ov = contentFor(db, ROGUE);
    const back = deriveBuildFromCharacter(buildCharacter(ROGUE, ov), ov);
    // The custom background grants Assurance; the skill it names lives in grantedFeatChoices, keyed
    // by the bare feat id, and went with the row that was dropped to avoid double-granting it.
    expect(back.grantedFeatChoices?.assurance).toBe('athletics');
  });

  // bug 2026-09-15: builder round-trip
  it("keeps a pick-granted feat's answer with the slot its granter lands in", () => {
    const db = content();
    const ov = contentFor(db, BARD);
    const back = deriveBuildFromCharacter(buildCharacter(BARD, ov), ov);
    expect(back.featPicks['7:general:0']).toBe('ancestral-paragon');
    expect(back.pickFeatChoices?.['7:general:0']).toBe('well-met-traveler');
  });

  // bug 2026-09-15: builder round-trip
  it('never files a granted skill as a class-skill pick', () => {
    const db = content();
    for (const [label, build] of Object.entries(FIXTURES)) {
      const ov = contentFor(db, build);
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

// =====================================================================================================================
// Tweaks phase 2, WP7 run 2 — EXTRA FEAT PLACES on the way back (work/tweaks-phase2-notes/plan.md WP7 step 6; C43, C46).
//
// An extra feat place (`choice.addPlace`, place 'feat') keeps its pick at `featPicks["<level>:extra<category>:<n>"]`.
//   C43  a LIVE place emits a Character.feats row with that exact slotKey; the reverse build puts it back under that
//        key with its answers — never into a real slot, never as a chip. A key whose block is missing counts (C9), so
//        it comes back the same way.
//   C46  a PAUSED place, or one whose character has Tweaks off, emits no row. buildCharacter keeps what it holds in
//        Character.tweakKept.featPlaces and the reverse build puts that back — never over an entry a store already
//        holds (UNKNOWN ≠ EMPTY). Absent when there is nothing to keep, so every other character is unchanged.
// Synthetic fighters only, built from the app's own content.
// =====================================================================================================================

const db7 = content();
let wp7Seq = 0;
const wp7Id = () => `t${++wp7Seq}_wp7rt${String(wp7Seq).padStart(2, '0')}`;
/** One `choice.addPlace` feat block (`on: false` = paused). */
const placeBlock = (level: number, category: string, n: number, on = true) => ({
  id: wp7Id(),
  kind: 'choice.addPlace',
  v: 1,
  place: 'feat',
  level,
  category,
  n,
  ...(on ? {} : { on: false }),
});
/** One `choice.changeAnswer` block: a carrier (WP10 applies it after the record rebuild; until then — WP13 — a stored one
 *  reads as made in a newer version: kept byte for byte, never applied). */
const answerBlock = (rest: Record<string, unknown>) => ({ id: wp7Id(), kind: 'choice.changeAnswer', v: 1, ...rest });
const tweaks = (...blocks: object[]): BuildOverrides => ({ v: 2, blocks }) as unknown as BuildOverrides;
const tweaksOff = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
/** The book (real) slot keys a build fills: every featPicks key that is no extra place. */
const bookKeys = (b: BuildState) => Object.keys(b.featPicks).filter((k) => !featPlaceKeyOf(k)).sort();

/** A level-`level` human fighter whose book slots through 3rd hold a feat; the 4th-level class slot stays EMPTY. */
function fighter(level: number, more: Partial<BuildState> = {}): BuildState {
  const b: BuildState = {
    ...emptyBuild(),
    name: 'WP7 round-trip fighter',
    level,
    classId: 'fighter',
    keyAbility: 'dex',
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    options: { overridesEnabled: true },
    ...more,
    featPicks: {
      '1:ancestry:0': 'cooperative-nature',
      '1:class:1': 'sudden-charge',
      '2:class:0': 'intimidating-strike',
      '2:skill:1': 'cat-fall',
      '3:general:0': 'fleet',
      ...more.featPicks,
    },
  };
  return JSON.parse(JSON.stringify(b)) as BuildState;
}

/**
 * build → Character → reverse build, with the two assertions of the table test above (every field outside RECOMPUTED
 * exactly; the rebuilt CHARACTER byte for byte), plus the Tweaks blocks byte for byte: the reverse build copies
 * `overrides`, it never rewrites one.
 */
function trip(label: string, before: BuildState): { ch: Character; after: BuildState } {
  const ov = contentFor(db7, before);
  const ch = buildCharacter(before, ov);
  const after = deriveBuildFromCharacter(ch, ov);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (RECOMPUTED.has(key)) continue;
    const a = (before as Record<string, unknown>)[key];
    const b = (after as Record<string, unknown>)[key];
    if (a === undefined && JSON.stringify(b ?? null) === '{}') continue;
    if (b === undefined && JSON.stringify(a ?? null) === '{}') continue;
    expect(key === 'classSkills' ? sorted(b) : b, `${label}: build.${key} changed on the way back`).toEqual(key === 'classSkills' ? sorted(a) : a);
  }
  expect(buildCharacter(after, contentFor(db7, after)), `${label}: the CHARACTER changed`).toEqual(ch);
  expect(JSON.stringify(after.overrides), `${label}: the blocks changed`).toBe(JSON.stringify(before.overrides));
  return { ch, after };
}

/** A fighter 4 with Canny Acumen (answer: Reflex) in an extra general place, live or paused. */
function canny(on: boolean) {
  const key = featPlaceKey(4, 'general', 483920);
  return { key, b: fighter(4, { overrides: tweaks(placeBlock(4, 'general', 483920, on)), featPicks: { [key]: 'canny-acumen' }, featChoices: { [key]: 'reflex' } }) };
}

describe('WP7 C43: a live extra feat place comes back under its own key', () => {
  it('(a) a general place: Canny Acumen and its answer come back under the exact key; no book slot is taken', () => {
    const { key, b } = canny(true);
    const { ch, after } = trip('canny', b);
    expect(ch.feats.find((f) => f.slotKey === key)?.category, 'the row keeps the raw extra category (C10)').toBe('extrageneral');
    expect(after.featPicks[key]).toBe('canny-acumen');
    expect(after.featChoices[key]).toBe('reflex');
    expect(bookKeys(after)).toEqual(bookKeys(b));
  });

  it('(a) a dedication in an extra class place never takes the empty 4th-level class slot', () => {
    const key = featPlaceKey(4, 'class', 483921);
    const before = fighter(4, { overrides: tweaks(placeBlock(4, 'class', 483921)), featPicks: { [key]: 'medic-dedication' } });
    expect(before.featPicks['4:class:0'], 'the book class slot is empty going in').toBeUndefined();
    const { after } = trip('dedication', before);
    expect(after.featPicks[key]).toBe('medic-dedication');
    expect(after.featPicks['4:class:0'], 'it used to land here, leaving the place empty and owed').toBeUndefined();
    expect(bookKeys(after)).toEqual(bookKeys(before));
  });

  it("(a) a pick-a-feat granter's answer comes back under the place's key", () => {
    const key = featPlaceKey(4, 'class', 483923);
    // qiTradition: the reverse build writes the tradition the sheet shows (a book-slot Social Purview does the same).
    const before = fighter(4, {
      overrides: tweaks(placeBlock(4, 'class', 483923)),
      featPicks: { [key]: 'social-purview' },
      pickFeatChoices: { [key]: 'student-of-perfection-dedication' },
      qiTradition: 'occult',
    });
    const { after } = trip('pickfocus', before);
    expect(after.featPicks[key]).toBe('social-purview');
    expect(after.pickFeatChoices?.[key]).toBe('student-of-perfection-dedication');
  });

  it("(a) a multi-pick choice comes back split over the place's #0 / #1 keys", () => {
    const key = featPlaceKey(4, 'skill', 483926);
    const before = fighter(4, {
      overrides: tweaks(placeBlock(4, 'skill', 483926)),
      featPicks: { [key]: 'kreightons-cognitive-crossover' },
      featChoices: { [`${key}#0`]: 'arcana', [`${key}#1`]: 'medicine' },
    });
    const { after } = trip('kreighton', before);
    expect(after.featChoices).toMatchObject({ [`${key}#0`]: 'arcana', [`${key}#1`]: 'medicine' });
    expect(after.featChoices[key], 'never joined under the bare key').toBeUndefined();
  });

  it('(a) a place row is kept even when its feat is one the subclass also grants: never dropped as the grant', () => {
    // Today's buildCharacter emits one row per feat (here the warpriest's own Shield Block, at 1st), so this shape
    // arrives only from a file or another app version: a row stamped with the place's key, for a feat a grant gives.
    const key = featPlaceKey(4, 'general', 483928);
    const b = JSON.parse(
      JSON.stringify({
        ...emptyBuild(),
        name: 'WP7 warpriest',
        level: 4,
        classId: 'cleric',
        keyAbility: 'wis',
        ancestryId: 'human',
        heritageId: 'versatile-human',
        backgroundId: 'acolyte',
        subclassId: 'warpriest',
        options: { overridesEnabled: true },
        overrides: tweaks(placeBlock(4, 'general', 483928)),
      }),
    ) as BuildState;
    const ov = contentFor(db7, b);
    const ch = buildCharacter(b, ov);
    const row = { featId: 'shield-block', level: 4, category: 'extrageneral', slotKey: key } as Character['feats'][number];
    const after = deriveBuildFromCharacter({ ...ch, feats: [...ch.feats, row] }, ov);
    expect(after.featPicks[key]).toBe('shield-block');
    expect(after.overrides?.addedFeats ?? [], 'never a chip').toEqual([]);
  });

  it('(a) a key whose place block is missing counts (C9), so it comes back under that key too', () => {
    const key = featPlaceKey(4, 'general', 483925);
    const before = fighter(4, { featPicks: { [key]: 'toughness' } });
    const { ch, after } = trip('noblock', before);
    expect(ch.feats.some((f) => f.slotKey === key)).toBe(true);
    expect(after.featPicks[key]).toBe('toughness');
    expect(bookKeys(after)).toEqual(bookKeys(before));
  });
});

describe("WP7 (b): an off-list answer a Tweaks block carries never replaces the store's own", () => {
  const skillSlotCarrier = () => answerBlock({ question: 'skillSlot', record: 'rogue-dedication', index: 0, value: 'lore:sailing' });
  const storesOf = (b: BuildState) => {
    const { overrides: _blocks, ...stores } = b;
    return JSON.stringify(stores);
  };

  it("(b) a paused place: the stored listed answer comes back from tweakKept, never the carrier's value; blocks byte-equal", () => {
    const key = featPlaceKey(4, 'archetype', 483930);
    const before = fighter(4, {
      overrides: tweaks(placeBlock(4, 'archetype', 483930, false), skillSlotCarrier()),
      featPicks: { [key]: 'rogue-dedication' },
      featSkillChoices: { 'rogue-dedication:0': 'thievery' },
    });
    const { ch, after } = trip('carrier, paused place', before);
    expect(ch.tweakKept?.featPlaces?.[0]?.answers).toEqual({ featSkillChoices: { 'rogue-dedication:0': 'thievery' } });
    expect(after.featSkillChoices?.['rogue-dedication:0']).toBe('thievery');
    expect(storesOf(after), "the carrier's value lands in no store").not.toContain('sailing');
  });

  it("(b) a live place: the carrier's value lands in no store, and the blocks come back byte for byte", () => {
    const key = featPlaceKey(4, 'archetype', 483930);
    const before = fighter(4, {
      overrides: tweaks(placeBlock(4, 'archetype', 483930), skillSlotCarrier()),
      featPicks: { [key]: 'rogue-dedication' },
      featSkillChoices: { 'rogue-dedication:0': 'thievery' },
    });
    const ov = contentFor(db7, before);
    const after = deriveBuildFromCharacter(buildCharacter(before, ov), ov);
    expect(after.featPicks[key]).toBe('rogue-dedication');
    expect(JSON.stringify(after.overrides)).toBe(JSON.stringify(before.overrides));
    expect(storesOf(after), "the carrier's value lands in no store").not.toContain('sailing');
    // Not asserted: the store's own `featSkillChoices` answer. The reverse build recovers no featSkillChoices for any
    // dedication, book slot or place alike (it was so before WP7) — wp7-report.md "Run 2", open items.
  });

  it("(b) a background answer: the stored listed answer comes back, never the carrier's off-list value", () => {
    const before = fighter(4, {
      backgroundId: 'magaambya-academic',
      backgroundSkillChoice: 'nature',
      overrides: tweaks(answerBlock({ question: 'backgroundSkill', record: 'magaambya-academic', index: 0, value: 'medicine' })),
    });
    const { after } = trip('carrier, background', before);
    expect(after.backgroundSkillChoice).toBe('nature');
  });
});

describe('WP7 C46: a paused or Tweaks-off place comes back from Character.tweakKept', () => {
  it('(c) paused: the feat and its answer emit no row, are kept aside, and come back under the key', () => {
    const { key, b } = canny(false);
    const { ch, after } = trip('paused canny', b);
    expect(ch.feats.some((f) => f.featId === 'canny-acumen'), 'a paused place adds nothing').toBe(false);
    expect(ch.tweakKept).toEqual({ featPlaces: [{ slotKey: key, featId: 'canny-acumen', answers: { featChoices: { [key]: 'reflex' } } }] });
    expect(after.featPicks[key]).toBe('canny-acumen');
    expect(after.featChoices[key]).toBe('reflex');
    // …and it is tweakKept that carries them: without it the place comes back empty (the loss C46 closes).
    const { tweakKept: _kept, ...bare } = ch;
    expect(deriveBuildFromCharacter(bare as Character, contentFor(db7, b)).featPicks[key]).toBeUndefined();
  });

  it('(d) a paused archetype place: the dedication and its dedicationSkillFeats answer both come back', () => {
    const key = featPlaceKey(4, 'archetype', 483922);
    const before = fighter(4, {
      overrides: tweaks(placeBlock(4, 'archetype', 483922, false)),
      featPicks: { [key]: 'rogue-dedication' },
      dedicationSkillFeats: { 'rogue-dedication': 'charlatan' },
    });
    const { ch, after } = trip('paused dedskill', before);
    expect(ch.tweakKept?.featPlaces).toEqual([{ slotKey: key, featId: 'rogue-dedication', answers: { dedicationSkillFeats: { 'rogue-dedication': 'charlatan' } } }]);
    expect(after.featPicks[key]).toBe('rogue-dedication');
    expect(after.dedicationSkillFeats?.['rogue-dedication']).toBe('charlatan');
  });

  it('(e) Tweaks off is the same as paused', () => {
    const { key, b } = canny(true);
    const { ch, after } = trip('Tweaks off canny', tweaksOff(b));
    expect(ch.feats.some((f) => f.featId === 'canny-acumen')).toBe(false);
    expect(ch.tweakKept).toEqual({ featPlaces: [{ slotKey: key, featId: 'canny-acumen', answers: { featChoices: { [key]: 'reflex' } } }] });
    expect(after.options?.overridesEnabled).toBe(false);
    expect(after.featPicks[key]).toBe('canny-acumen');
    expect(after.featChoices[key]).toBe('reflex');
  });

  it('(f) never over an entry: a store already holding a different answer keeps its own', () => {
    const { key, b } = canny(false);
    const ov = contentFor(db7, b);
    const ch = buildCharacter(b, ov);
    // A Character whose feats ALSO hold a row at the paused place's key (another app version read the place live),
    // with another answer: the row fills the store first, and the kept answer never replaces it.
    const row = { featId: 'canny-acumen', level: 4, category: 'extrageneral', choice: { value: 'will', label: 'Will' }, slotKey: key } as Character['feats'][number];
    const after = deriveBuildFromCharacter({ ...ch, feats: [...ch.feats, row] }, ov);
    expect(after.featPicks[key]).toBe('canny-acumen');
    expect(after.featChoices[key], "the store's answer, not the kept one").toBe('will');
    // A row holding ANOTHER feat at that key keeps its feat, and the kept answers (made for Canny Acumen) stay out.
    const other = { featId: 'toughness', level: 4, category: 'extrageneral', slotKey: key } as Character['feats'][number];
    const after2 = deriveBuildFromCharacter({ ...ch, feats: [...ch.feats, other] }, ov);
    expect(after2.featPicks[key]).toBe('toughness');
    expect(after2.featChoices[key]).toBeUndefined();
  });

  it('a paused Ultimate Flexibility keeps its 20th-level bonus slot on the way back (C11, the storage view)', () => {
    const key = featPlaceKey(20, 'class', 483950);
    const uf = fighter(20, { overrides: tweaks(placeBlock(20, 'class', 483950, false)), featPicks: { [key]: 'ultimate-flexibility' } });
    const bonus = printedFeatPlaces(uf, db7).find((p) => p.category === 'bonus' && p.level === 20)?.key;
    expect(bonus, 'the paused place still draws its bonus slot').toBeTruthy();
    const { ch, after } = trip('paused UF', { ...uf, featPicks: { ...uf.featPicks, [bonus!]: 'snagging-strike' } });
    expect(ch.tweakKept?.featPlaces).toEqual([{ slotKey: key, featId: 'ultimate-flexibility' }]);
    expect(after.featPicks[key]).toBe('ultimate-flexibility');
    expect(after.featPicks[bonus!]).toBe('snagging-strike');
  });

  it('an answer under a VARIANT key (`<granted feat>#<place key>`) goes and comes back with its place', () => {
    // The map mechanism only: Canny Acumen grants no feat, and this entry stands in for a granted feat's sub-choice
    // keyed to its granter's place (swapSlotKeys' VARIANT_KEYED maps).
    const key = featPlaceKey(4, 'general', 483940);
    const variant = `assurance#${key}`;
    const before = fighter(4, {
      overrides: tweaks(placeBlock(4, 'general', 483940, false)),
      featPicks: { [key]: 'canny-acumen' },
      featChoices: { [key]: 'fortitude' },
      grantedFeatChoices: { [variant]: 'athletics' },
    });
    const { ch, after } = trip('variant key', before);
    expect(ch.tweakKept?.featPlaces?.[0]?.answers).toEqual({ featChoices: { [key]: 'fortitude' }, grantedFeatChoices: { [variant]: 'athletics' } });
    expect(after.grantedFeatChoices?.[variant]).toBe('athletics');
  });

  it("a feat held live elsewhere keeps its feat-id answers there: the kept place carries none of them", () => {
    const key = featPlaceKey(4, 'archetype', 483931);
    const b = fighter(4, {
      overrides: tweaks(placeBlock(4, 'archetype', 483931, false)),
      featPicks: { '2:class:0': 'rogue-dedication', [key]: 'rogue-dedication' },
      dedicationSkillFeats: { 'rogue-dedication': 'charlatan' },
    });
    expect(buildCharacter(b, contentFor(db7, b)).tweakKept).toEqual({ featPlaces: [{ slotKey: key, featId: 'rogue-dedication' }] });
  });

  it('a kept entry the reverse build cannot use is ignored: a book key, a key with no block, a live place, junk', () => {
    const { key, b } = canny(false);
    const ov = contentFor(db7, b);
    const ch = buildCharacter(b, ov);
    const noBlock = featPlaceKey(4, 'general', 999999);
    const junk = {
      featPlaces: [
        { slotKey: '4:class:0', featId: 'sudden-charge' },
        { slotKey: noBlock, featId: 'toughness' },
        { slotKey: key, featId: 42 },
        null,
        'junk',
        { slotKey: key, featId: 'canny-acumen', answers: { featChoices: { [key]: 'will' }, featPicks: { '4:class:0': 'sudden-charge' }, classSkills: { 0: 'arcana' }, featLoreChoices: { x: 7 } } },
      ],
    };
    const after = deriveBuildFromCharacter({ ...ch, tweakKept: junk } as unknown as Character, ov);
    expect(after.featPicks['4:class:0'], 'a book key is never filled from here').toBeUndefined();
    expect(after.featPicks[noBlock], 'a key with no block counts live, so it is never held back').toBeUndefined();
    expect(after.featPicks[key]).toBe('canny-acumen');
    expect(after.featChoices[key]).toBe('will');
    expect(after.classSkills, 'only the answer maps are written').not.toContain('arcana');
    expect(after.featLoreChoices?.x, 'only strings').toBeUndefined();
    expect(deriveBuildFromCharacter({ ...ch, tweakKept: 'x' } as unknown as Character, ov).featPicks[key]).toBeUndefined();
    // A place this build reads as LIVE whose own row came back keeps that row's feat and answers: a kept entry fills
    // only an empty key, and never over an entry a store holds (run 3a reads live places' entries too).
    const live = canny(true);
    const liveOv = contentFor(db7, live.b);
    const liveCh = buildCharacter(live.b, liveOv);
    const back = deriveBuildFromCharacter({ ...liveCh, tweakKept: { featPlaces: [{ slotKey: live.key, featId: 'toughness', answers: { featChoices: { [live.key]: 'will' } } }] } }, liveOv);
    expect(back.featPicks[live.key]).toBe('canny-acumen');
    expect(back.featChoices[live.key]).toBe('reflex');
  });
});

// WP7 run 3a: a LIVE place whose pick buildCharacter emits no row for (the take cap, a level above the character's,
// a granted feat) is kept in Character.tweakKept too, and comes back under its own key on a build-less reopen.
describe('WP7 run 3a: a live place with no row under its key comes back from Character.tweakKept', () => {
  /** The reverse build of `ch` without tweakKept: the loss run 3a closes. */
  const bare = (ch: Character, b: BuildState) => {
    const { tweakKept: _kept, ...rest } = ch;
    return deriveBuildFromCharacter(rest as Character, contentFor(db7, b));
  };

  it('(1) Fleet in a book general slot AND in a live extra general place: both come back under their own keys', () => {
    const key = featPlaceKey(4, 'general', 483960);
    const before = fighter(4, { overrides: tweaks(placeBlock(4, 'general', 483960)), featPicks: { [key]: 'fleet' } });
    expect(before.featPicks['3:general:0'], 'the book slot holds Fleet too').toBe('fleet');
    const { ch, after } = trip('fleet twice', before);
    expect(ch.feats.some((f) => f.slotKey === key), "the take cap drops the place's row").toBe(false);
    expect(ch.tweakKept, 'the place is kept, with no feat-id answers (a row holds Fleet)').toEqual({ featPlaces: [{ slotKey: key, featId: 'fleet' }] });
    expect(after.featPicks['3:general:0']).toBe('fleet');
    expect(after.featPicks[key]).toBe('fleet');
    expect(bare(ch, before).featPicks[key], 'without tweakKept the place comes back empty').toBeUndefined();
  });

  it("(2) a live place above the character's level: its feat and answer come back under its key", () => {
    const key = featPlaceKey(6, 'general', 483961);
    const before = fighter(3, { overrides: tweaks(placeBlock(6, 'general', 483961)), featPicks: { [key]: 'canny-acumen' }, featChoices: { [key]: 'reflex' } });
    const { ch, after } = trip('above level', before);
    expect(ch.feats.some((f) => f.featId === 'canny-acumen'), 'a place above the level emits no row').toBe(false);
    expect(ch.tweakKept).toEqual({ featPlaces: [{ slotKey: key, featId: 'canny-acumen', answers: { featChoices: { [key]: 'reflex' } } }] });
    expect(after.featPicks[key]).toBe('canny-acumen');
    expect(after.featChoices[key]).toBe('reflex');
    expect(bare(ch, before).featPicks[key], 'without tweakKept the place comes back empty').toBeUndefined();
  });

  it('(3) a warpriest with a live place holding Shield Block (also granted): back under its key, never a chip', () => {
    const key = featPlaceKey(4, 'general', 483962);
    const before = JSON.parse(
      JSON.stringify({
        ...emptyBuild(),
        name: 'WP7 warpriest',
        level: 4,
        classId: 'cleric',
        keyAbility: 'wis',
        ancestryId: 'human',
        heritageId: 'versatile-human',
        backgroundId: 'acolyte',
        subclassId: 'warpriest',
        options: { overridesEnabled: true },
        overrides: tweaks(placeBlock(4, 'general', 483962)),
        featPicks: { [key]: 'shield-block' },
      }),
    ) as BuildState;
    const { ch, after } = trip('warpriest shield block', before);
    expect(ch.feats.some((f) => f.slotKey === key), "only the grant's row exists").toBe(false);
    expect(ch.feats.some((f) => f.featId === 'shield-block')).toBe(true);
    expect(ch.tweakKept).toEqual({ featPlaces: [{ slotKey: key, featId: 'shield-block' }] });
    expect(after.featPicks[key]).toBe('shield-block');
    expect(after.overrides?.addedFeats ?? [], 'never a chip').toEqual([]);
    expect(bare(ch, before).featPicks[key], 'without tweakKept the place comes back empty').toBeUndefined();
  });

  it('a live place WITH its row keeps nothing; a held-back place comes first and takes the feat-id answers', () => {
    const key = featPlaceKey(4, 'general', 483963);
    const withRow = fighter(4, { overrides: tweaks(placeBlock(4, 'general', 483963)), featPicks: { [key]: 'toughness' } });
    expect('tweakKept' in buildCharacter(withRow, contentFor(db7, withRow))).toBe(false);
    // Two places with the same dedication, one paused (first in tweakKept) and one live above the level (no row):
    // the feat-id answer travels once, on the first kept place, and both come back.
    const paused = featPlaceKey(4, 'archetype', 483964);
    const high = featPlaceKey(8, 'archetype', 483965);
    const both = fighter(4, {
      overrides: tweaks(placeBlock(8, 'archetype', 483965), placeBlock(4, 'archetype', 483964, false)),
      featPicks: { [paused]: 'rogue-dedication', [high]: 'rogue-dedication' },
      dedicationSkillFeats: { 'rogue-dedication': 'charlatan' },
    });
    const { ch, after } = trip('paused + high', both);
    expect(ch.tweakKept?.featPlaces).toEqual([
      { slotKey: paused, featId: 'rogue-dedication', answers: { dedicationSkillFeats: { 'rogue-dedication': 'charlatan' } } },
      { slotKey: high, featId: 'rogue-dedication' },
    ]);
    expect(after.featPicks[paused]).toBe('rogue-dedication');
    expect(after.featPicks[high]).toBe('rogue-dedication');
    expect(after.dedicationSkillFeats?.['rogue-dedication']).toBe('charlatan');
  });

  it("a live place's kept entry is ignored once its block is gone, and never fills a key holding another feat", () => {
    const key = featPlaceKey(6, 'general', 483966);
    const before = fighter(3, { overrides: tweaks(placeBlock(6, 'general', 483966)), featPicks: { [key]: 'canny-acumen' }, featChoices: { [key]: 'reflex' } });
    const ov = contentFor(db7, before);
    const ch = buildCharacter(before, ov);
    expect(ch.tweakKept?.featPlaces?.[0]?.slotKey).toBe(key);
    // The block deleted (another device): the place is neither held back nor live, so nothing comes back.
    const gone = deriveBuildFromCharacter({ ...ch, overrides: tweaks() }, ov);
    expect(gone.featPicks[key]).toBeUndefined();
    expect(gone.featChoices[key]).toBeUndefined();
    // A row at that key holding ANOTHER feat keeps its feat, and the kept answers stay out.
    const other = { featId: 'toughness', level: 6, category: 'extrageneral', slotKey: key } as Character['feats'][number];
    const back = deriveBuildFromCharacter({ ...ch, feats: [...ch.feats, other] }, ov);
    expect(back.featPicks[key]).toBe('toughness');
    expect(back.featChoices[key]).toBeUndefined();
  });
});

describe('WP7 C46 (g): Character.tweakKept is absent when there is nothing to keep', () => {
  it.each(Object.keys(FIXTURES))('%s', (label) => {
    const b = FIXTURES[label];
    expect('tweakKept' in buildCharacter(b, contentFor(db7, b))).toBe(false);
  });

  it('a live place, and a paused place that holds no pick', () => {
    const empty = fighter(4, { overrides: tweaks(placeBlock(4, 'general', 483920, false)) });
    for (const b of [canny(true).b, empty]) expect('tweakKept' in buildCharacter(b, contentFor(db7, b))).toBe(false);
  });
});

describe("WP7 C46: Character.tweakKept on the Character's other paths", () => {
  const sheet = () => {
    const { key, b } = canny(false);
    return { key, b, ch: buildCharacter(b, contentFor(db7, b)) };
  };

  it('a build-less native file keeps it through export → import, and the Builder reopens with the place filled', () => {
    const { key, ch } = sheet();
    const { saved } = importCharacter(exportNative({ id: 'rost-wp7', character: ch, archived: false }), db7);
    expect(saved.build).toBeUndefined();
    expect(saved.character.tweakKept).toEqual(ch.tweakKept);
    const opened = editableBuildOf(saved, contentFor(db7, saved.character));
    expect(opened?.derived).toBe(true);
    expect(opened?.build.featPicks[key]).toBe('canny-acumen');
    expect(opened?.build.featChoices[key]).toBe('reflex');
  });

  it('a native file WITH a build is re-derived on import, to the same tweakKept; normalizeCharacter passes it through', () => {
    const { b, ch } = sheet();
    const { saved } = importCharacter(exportNative({ id: 'rost-wp7', character: ch, build: b, archived: false }), db7);
    expect(saved.character.tweakKept).toEqual(ch.tweakKept);
    expect(normalizeCharacter(ch).tweakKept).toEqual(ch.tweakKept);
  });

  it("a launch rebuild adds it to an older app's sheet, and that is no edit (authoredKey unchanged)", () => {
    const { b, ch } = sheet();
    const { tweakKept: _kept, ...older } = ch;
    const entry: SavedChar = { id: 'rost-wp7', character: older as Character, build: b, archived: false };
    const [rebuilt] = rebuildRoster([entry], db7);
    expect(rebuilt.character.tweakKept).toEqual(ch.tweakKept);
    expect(authoredKey(rebuilt)).toBe(authoredKey(entry));
  });

  it("the Wanderer's Guide export never carries it", () => {
    const { b, ch } = sheet();
    expect(exportWg({ id: 'rost-wp7', character: ch, build: b, archived: false }, db7)).not.toContain('tweakKept');
  });
});

// Tweaks phase 2, WP8 (plan WP8 "Rev 3, finding 9"): the moreTakes duplicate — Fleet in TWO book general slots and a
// live "Take a feat more times" — reopened with no stored build keeps both Fleets in their real slots (the reverse
// build's slot test has no take count, and the take cap is the engine's `takesAllowed`) and the block byte for byte.
describe('WP8: a moreTakes duplicate survives a build-less reopen', () => {
  const moreBlock = (on = true) => ({ id: wp7Id(), kind: 'choice.moreTakes', v: 1, record: 'fleet', times: 1, ...(on ? {} : { on: false }) });
  it('Fleet in the 3rd- and 7th-level general slots + moreTakes 1: both back in real slots, the block byte-equal, the Character byte-equal', () => {
    const block = moreBlock();
    const before = fighter(7, { overrides: tweaks(block), featPicks: { '7:general:0': 'fleet' } });
    const { ch, after } = trip('moreTakes fleet twice', before);
    expect(ch.feats.filter((f) => f.featId === 'fleet').map((f) => f.slotKey), 'both copies count').toEqual(['3:general:0', '7:general:0']);
    expect(after.featPicks['3:general:0']).toBe('fleet');
    expect(after.featPicks['7:general:0']).toBe('fleet');
    expect(JSON.stringify(after.overrides?.blocks), 'the block comes back byte for byte').toBe(JSON.stringify([block]));
    expect(ch.tweakKept, 'nothing kept aside: both copies have rows').toBeUndefined();
  });

  // WP8 fixes round 1 (checker finding 1): paused or Tweaks off, the cap is the book's, so the 7th-level copy has no
  // row; without Character.tweakKept.featCopies the reverse build lost it and turning the tweak on found the slot empty.
  /** The reverse build of `ch` without tweakKept: the loss this closes. */
  const bare = (ch: Character, b: BuildState) => {
    const { tweakKept: _kept, ...rest } = ch;
    return deriveBuildFromCharacter(rest as Character, contentFor(db7, b));
  };
  /** `b` with every moreTakes block switched on (the player turning the tweak back on). */
  const resumed = (b: BuildState): BuildState => ({ ...b, overrides: tweaks(...((b.overrides as unknown as { blocks: object[] }).blocks.map((x) => { const { on: _on, ...rest } = x as Record<string, unknown>; return rest; }))) });
  const fleetCopy = [{ slotKey: '7:general:0', featId: 'fleet' }];

  it('paused: the 7th-level copy is kept aside and comes back under its own key; resumed, both count', () => {
    const before = fighter(7, { overrides: tweaks(moreBlock(false)), featPicks: { '7:general:0': 'fleet' } });
    const { ch, after } = trip('moreTakes paused', before);
    expect(ch.feats.filter((f) => f.featId === 'fleet').map((f) => f.slotKey), 'paused: the book cap drops the 7th-level copy').toEqual(['3:general:0']);
    expect(ch.tweakKept).toEqual({ featCopies: fleetCopy });
    expect(after.featPicks['7:general:0']).toBe('fleet');
    expect(bare(ch, before).featPicks['7:general:0'], 'without tweakKept the copy is lost').toBeUndefined();
    const on = buildCharacter(resumed(after), contentFor(db7, after));
    expect(on.feats.filter((f) => f.featId === 'fleet').map((f) => f.slotKey), 'turned back on: both copies count').toEqual(['3:general:0', '7:general:0']);
  });

  it('Tweaks off: the same', () => {
    const before = tweaksOff(fighter(7, { overrides: tweaks(moreBlock()), featPicks: { '7:general:0': 'fleet' } }));
    const { ch, after } = trip('moreTakes tweaks off', before);
    expect(ch.feats.filter((f) => f.featId === 'fleet').map((f) => f.slotKey)).toEqual(['3:general:0']);
    expect(ch.tweakKept).toEqual({ featCopies: fleetCopy });
    expect(after.featPicks['7:general:0']).toBe('fleet');
    expect(bare(ch, before).featPicks['7:general:0']).toBeUndefined();
  });

  it("paused, a granter's second copy keeps the answer under its slot (Natural Ambition → Double Slice)", () => {
    const block = { id: wp7Id(), kind: 'choice.moreTakes', v: 1, record: 'natural-ambition', times: 1, on: false };
    const before = fighter(5, {
      overrides: tweaks(block),
      featPicks: { '1:ancestry:0': 'natural-ambition', '5:ancestry:0': 'natural-ambition' },
      pickFeatChoices: { '1:ancestry:0': 'snagging-strike', '5:ancestry:0': 'double-slice' },
    });
    const { ch, after } = trip('moreTakes granter paused', before);
    expect(ch.tweakKept).toEqual({ featCopies: [{ slotKey: '5:ancestry:0', featId: 'natural-ambition', answers: { pickFeatChoices: { '5:ancestry:0': 'double-slice' } } }] });
    expect(after.featPicks['5:ancestry:0']).toBe('natural-ambition');
    expect(after.pickFeatChoices['5:ancestry:0']).toBe('double-slice');
  });

  it('never over a held entry; junk, an extra-place key or a feat with no moreTakes block is never filled', () => {
    const before = fighter(7, { overrides: tweaks(moreBlock(false)), featPicks: { '7:general:0': 'fleet' } });
    const ov = contentFor(db7, before);
    const ch = buildCharacter(before, ov);
    const held = deriveBuildFromCharacter({ ...ch, tweakKept: { featCopies: [{ slotKey: '3:general:0', featId: 'fleet' }, { slotKey: '1:class:1', featId: 'fleet' }] } }, ov);
    expect(held.featPicks['1:class:1'], 'a held key keeps its own feat').toBe('sudden-charge');
    const junk = { featCopies: [null, 5, { slotKey: 7 }, { slotKey: '7:general:0', featId: 'toughness' }, { slotKey: featPlaceKey(7, 'general', 483990), featId: 'fleet' }, { slotKey: '7:general:0#x', featId: 'fleet' }] };
    const back = deriveBuildFromCharacter({ ...ch, tweakKept: junk } as unknown as Character, ov);
    expect(back.featPicks['7:general:0']).toBeUndefined();
    expect(Object.keys(back.featPicks).some((k) => featPlaceKeyOf(k))).toBe(false);
    const { overrides: _o, ...noBlock } = ch;
    expect(deriveBuildFromCharacter({ ...noBlock, tweakKept: { featCopies: fleetCopy } } as Character, ov).featPicks['7:general:0'], 'no moreTakes block stored: never filled').toBeUndefined();
  });

  it('no moreTakes block: a duplicate the cap drops is the book case, nothing kept (the field stays absent)', () => {
    const before = fighter(7, { featPicks: { '7:general:0': 'fleet' } });
    expect('tweakKept' in buildCharacter(before, contentFor(db7, before))).toBe(false);
  });
});
