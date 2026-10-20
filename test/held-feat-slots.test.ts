import { describe, expect, it } from 'vitest';
import {
  buildCharacter,
  buildUsesDeity,
  cantripBonusFor,
  choiceFlagAnswer,
  classArchetypeSpellMods,
  classCantripBonus,
  deityNamedBy,
  emptyBuild,
  extraPickCount,
  heldPickGranters,
  levelChoices,
  passionBackground,
  resolveBackground,
  resolveClassArchetype,
  secondHeritageIdOf,
  takenForDedicationRule,
  takesDeitySanctification,
  type BuildState,
} from '../src/rules/build';
import { activeGivenFeats, tweaksSwitchOn } from '../src/rules/blocks/stored';
import { tweaksSwitchOn as tweaksSwitchOnFromActive } from '../src/rules/blocks/active';
import { splinterDomainsOf } from '../src/rules/derive';
import { adoptedAncestryIds, eligibleFeatsForSlot } from '../src/rules/featSlots';
import { featIdAtSlot, heldFeatIds, heldFeatSlots, type HeldInput } from '../src/rules/heldFeats';
import { kineticistElements } from '../src/rules/kineticElements';
import type { BuildOverrides, CharacterOptions, FeatCategory } from '../src/rules/types';
import { content } from './_content';

/**
 * THE HELD-FEATS HELPER (case D, work/tweaks-part-a-notes/tweaks-part-a-caseD-plan.md sections 1 and 4).
 *
 * `heldFeatSlots` is the one list every rules walker reads instead of `build.featPicks`: slot picks
 * untouched (checker C6 — never level-filtered, deduped or dropped here), then the ACTIVE feats given
 * through Tweaks under `override:<featId>`. Part 1 pins its rules; part 2 is the property that makes the
 * routing safe — a character WITHOUT active given feats gets, from every routed walker, exactly the answer
 * it gets with `addedFeats` deleted — over the scripts/verify-characters.mjs mk() grid.
 */

const add = (featId: string, level = 1, category: FeatCategory = 'class') => ({ featId, level, category });
const keyOf = (featId: string, level: number) => `addedFeats:${featId}@${level}`;

describe('heldFeatSlots: slot entries', () => {
  it('lists every non-empty featPicks entry in its own order, at any level, malformed keys kept', () => {
    const b: HeldInput = { level: 3, featPicks: { '20:class:0': 'b', 'x:class:0': 'c', '1:class:0': 'a', '2:skill:0': '' } };
    const s = heldFeatSlots(b);
    expect(s.map((e) => e.featId)).toEqual(['b', 'c', 'a']);
    expect(s.map((e) => e.slotKey)).toEqual(['20:class:0', 'x:class:0', '1:class:0']);
    expect(s[0].level).toBe(20);
    expect(Number.isNaN(s[1].level)).toBe(true);
    expect(s[0].category).toBe('class');
    expect(s.every((e) => e.via === 'slot')).toBe(true);
  });

  it('never drops a slot entry for removedFeatIds, a duplicate or a paused/off switch', () => {
    const b: HeldInput = { level: 5, featPicks: { '1:class:0': 'a', '2:class:0': 'a' }, overrides: { removedFeatIds: ['a'], v: 2 }, options: { overridesEnabled: false } as CharacterOptions };
    expect(heldFeatIds(b)).toEqual(['a', 'a']);
  });

  it('order: slots, then pick-a-feat answers, then dedication skill feats, then given feats; pickFeat/dedicationSkill only on request', () => {
    const b: HeldInput = {
      level: 5,
      featPicks: { '1:class:0': 'slot' },
      pickFeatChoices: { 'general-training': 'pick' },
      dedicationSkillFeats: { 'rogue-dedication': 'ded' },
      overrides: { addedFeats: [add('given')] },
    };
    expect(heldFeatIds(b)).toEqual(['slot', 'given']);
    expect(heldFeatIds(b, undefined, { via: ['slot', 'pickFeat', 'dedicationSkill', 'override'] })).toEqual(['slot', 'pick', 'ded', 'given']);
    const s = heldFeatSlots(b, undefined, { via: ['pickFeat', 'dedicationSkill'] });
    expect(s.map((e) => [e.via, e.slotKey, e.category])).toEqual([
      ['pickFeat', 'general-training', undefined],
      ['dedicationSkill', 'rogue-dedication', 'skill'],
    ]);
    expect(s.every((e) => Number.isNaN(e.level))).toBe(true);
  });
});

describe('heldFeatSlots: given feats (override entries)', () => {
  it('a given feat is listed under override:<id>, with its level, category and Tweaks key', () => {
    const b: HeldInput = { level: 4, featPicks: {}, overrides: { addedFeats: [add('fleet', 3, 'general')] } };
    expect(heldFeatSlots(b)).toEqual([{ featId: 'fleet', via: 'override', slotKey: 'override:fleet', level: 3, category: 'general', tweakKey: keyOf('fleet', 3) }]);
  });

  it('gated at build.level, or at the level asked (D5)', () => {
    const b: HeldInput = { level: 4, featPicks: {}, overrides: { addedFeats: [add('a', 3), add('b', 5)] } };
    expect(heldFeatIds(b)).toEqual(['a']);
    expect(heldFeatIds(b, 5)).toEqual(['a', 'b']);
    expect(heldFeatIds(b, 2)).toEqual([]);
  });

  it('start level = max(stored level, meta.from) (D6); a stored level that is not a number counts as 1', () => {
    const ov: BuildOverrides = { addedFeats: [add('a', 2), { featId: 'b', level: undefined as unknown as number, category: 'class' }], meta: { [keyOf('a', 2)]: { from: 6, of: 'a@2' } } };
    expect(heldFeatSlots({ level: 5, featPicks: {}, overrides: ov }).map((e) => [e.featId, e.level])).toEqual([['b', 1]]);
    expect(heldFeatSlots({ level: 6, featPicks: {}, overrides: ov }).map((e) => [e.featId, e.level])).toEqual([['a', 6], ['b', 1]]);
    // meta written for another entry (`of` mismatch) is ignored.
    const stale: BuildOverrides = { addedFeats: [add('a', 2)], meta: { [keyOf('a', 2)]: { from: 6, of: 'a@3' } } };
    expect(heldFeatIds({ level: 2, featPicks: {}, overrides: stale })).toEqual(['a']);
  });

  it('dropped when a slot at or below the gate holds the feat; kept when the slot is above it or its key has no level', () => {
    const ov: BuildOverrides = { addedFeats: [add('a', 1)] };
    expect(heldFeatIds({ level: 4, featPicks: { '2:class:0': 'a' }, overrides: ov })).toEqual(['a']);
    expect(heldFeatSlots({ level: 4, featPicks: { '2:class:0': 'a' }, overrides: ov }).map((e) => e.via)).toEqual(['slot']);
    expect(heldFeatSlots({ level: 4, featPicks: { '6:class:0': 'a' }, overrides: ov }).map((e) => e.via)).toEqual(['slot', 'override']);
    expect(heldFeatSlots({ level: 4, featPicks: { 'x:class:0': 'a' }, overrides: ov }).map((e) => e.via)).toEqual(['slot', 'override']);
  });

  it('one per feat id, the first active one in addedFeats order', () => {
    const b: HeldInput = { level: 3, featPicks: {}, overrides: { addedFeats: [add('a', 5), add('a', 2), add('a', 1), add('b', 1)] } };
    expect(heldFeatSlots(b).map((e) => [e.featId, e.level])).toEqual([['a', 2], ['b', 1]]);
  });

  it('paused, broken (no feat named) and removed (D1) given feats are not held', () => {
    const paused: BuildOverrides = { addedFeats: [add('a', 1), add('b', 1)], meta: { [keyOf('a', 1)]: { on: false, of: 'a@1' } } };
    expect(heldFeatIds({ level: 3, featPicks: {}, overrides: paused })).toEqual(['b']);
    const broken: BuildOverrides = { addedFeats: [{ featId: '', level: 1, category: 'class' }, add('b', 1)] };
    expect(heldFeatIds({ level: 3, featPicks: {}, overrides: broken })).toEqual(['b']);
    const removed: BuildOverrides = { addedFeats: [add('a', 1), add('b', 1)], removedFeatIds: ['b'] };
    expect(heldFeatIds({ level: 3, featPicks: {}, overrides: removed })).toEqual(['a']);
  });

  it('the master switch: v absent → on; v 2 + overridesEnabled false → none; v 2 + true → on (one switch, D7)', () => {
    const ov = (v?: number): BuildOverrides => ({ addedFeats: [add('a', 1)], ...(v != null ? { v } : {}) });
    expect(heldFeatIds({ level: 1, featPicks: {}, overrides: ov() })).toEqual(['a']);
    expect(heldFeatIds({ level: 1, featPicks: {}, overrides: ov(2), options: { overridesEnabled: false } as CharacterOptions })).toEqual([]);
    expect(heldFeatIds({ level: 1, featPicks: {}, overrides: ov(2) })).toEqual([]);
    expect(heldFeatIds({ level: 1, featPicks: {}, overrides: ov(2), options: { overridesEnabled: true } as CharacterOptions })).toEqual(['a']);
    expect(tweaksSwitchOnFromActive).toBe(tweaksSwitchOn);
  });

  it('activeGivenFeats is read once per overrides object and again when addedFeats or meta is a new value', () => {
    const ov: BuildOverrides = { addedFeats: [add('a', 1)] };
    const first = activeGivenFeats(ov);
    expect(activeGivenFeats(ov)).toBe(first);
    ov.addedFeats = [add('b', 1)];
    expect(activeGivenFeats(ov).map((g) => g.featId)).toEqual(['b']);
    ov.meta = { [keyOf('b', 1)]: { on: false, of: 'b@1' } };
    expect(activeGivenFeats(ov)).toEqual([]);
    expect(activeGivenFeats(undefined)).toEqual([]);
    expect(activeGivenFeats({ addedFeats: [] })).toEqual([]);
  });
});

describe('featIdAtSlot', () => {
  it('a slot key reads featPicks; override:<id> names the feat while it is an active given feat', () => {
    const b: HeldInput = { level: 3, featPicks: { '2:class:0': 'x' }, overrides: { addedFeats: [add('a', 1), add('b', 5)], removedFeatIds: [] } };
    expect(featIdAtSlot(b, '2:class:0')).toBe('x');
    expect(featIdAtSlot(b, '4:class:0')).toBeUndefined();
    expect(featIdAtSlot(b, 'override:a')).toBe('a');
    expect(featIdAtSlot(b, 'override:b')).toBeUndefined(); // above the character's level
    expect(featIdAtSlot(b, 'override:zzz')).toBeUndefined();
  });
});

/* ───────────────────────── the property: no ACTIVE given feat → no walker moves ───────────────────────── */

const db = content();

/** scripts/verify-characters.mjs `mk` — the same grid. */
const mk = (classId: string, level: number): BuildState => {
  const cls = db.classes[classId];
  return {
    ...emptyBuild(),
    name: 'verify',
    level,
    classId,
    keyAbility: (cls?.keyAbility?.length === 1 ? cls.keyAbility[0] : (cls?.keyAbility?.[0] ?? 'str')) as BuildState['keyAbility'],
    ancestryId: 'human',
    heritageId: Object.values(db.heritages).find((h) => h.ancestryId === 'human')?.id ?? null,
    backgroundId: Object.keys(db.backgrounds)[0],
    subclassId: (cls?.subclass?.options?.[0]?.id as string) ?? null,
  } as BuildState;
};

/** Feats every routed walker reacts to, each with its answer under `override:<id>`. */
const GIVEN = [
  'flexible-spellcaster-dedication', // classArchetypeSpellMods, resolveClassArchetype, cantripBonusFor
  'adopted-ancestry', // adoptedAncestryIds, eligibleFeatsForSlot
  'runesmith-dedication', // levelChoices
  'rogue-dedication', // buildCharacter: the bonus skill feat
  'juggler-dedication', // takenForDedicationRule
  'ultimate-polymath', // buildCharacter: signature
  'ultimate-flexibility', // levelGrants' taken feats
  'syncretism', // buildCharacter: second favored weapon
  'kineticist-dedication', // kineticistElements
  'splinter-faith', // splinterDomainsOf
  'free-heart', // passionBackground
  'chosen-of-lamashtu', // secondHeritageIdOf
  'mortal-herald-dedication', // takesDeitySanctification
  'razmiran-priest-dedication', // deityNamedBy (with cleric-dedication)
  'cleric-dedication',
  'domain-initiate', // buildUsesDeity
  'blessing-of-the-sun-gods', // choiceFlagAnswer('sunGodsDomain')
  'additional-ikon', // extraPickCount (ikon)
  'basic-arcana', // heldPickGranters (its pick-a-feat answer under override:basic-arcana)
].filter((id) => db.feats[id]);
/**
 * Slot picks every grid character carries (low finding, fixer 2026-10-20: with `featPicks` empty the
 * property never ran a walker's SLOT half). Some of the given feats in slots with their answers under the
 * slot keys, a feat in two slots, an empty slot, a key with no level, and a pick-a-feat granter in a slot.
 * The control below clears them, so it measures the given feats alone.
 */
const SLOT_PICKS: Record<string, string> = {
  '1:general:0': 'adopted-ancestry',
  '2:class:0': 'basic-arcana',
  '3:general:0': '',
  '4:class:0': 'juggler-dedication',
  '6:class:0': 'juggler-dedication',
  'x:class:0': 'kineticist-dedication',
};
const ANSWERS: Partial<BuildState> = {
  deityId: 'sarenrae',
  featPicks: SLOT_PICKS,
  pickFeatChoices: { '2:class:0': 'cantrip-expansion', 'override:basic-arcana': 'cantrip-expansion' },
  featChoices: {
    'override:adopted-ancestry': 'elf',
    'override:kineticist-dedication': 'fire-gate',
    'override:splinter-faith#0': 'fire',
    'override:splinter-faith#1': 'healing',
    'override:splinter-faith#2': 'sun',
    'override:splinter-faith#3': 'repose',
    // Not the grid's own background (the first one): passionBackground ignores an answer equal to it.
    'override:free-heart': Object.keys(db.backgrounds)[1],
    'override:chosen-of-lamashtu': 'ancient-elf',
    'override:blessing-of-the-sun-gods': 'ambition',
    '1:general:0': 'dwarf',
    'x:class:0': 'water-gate',
  },
  dedicationSkillFeats: { 'rogue-dedication': 'quick-jump' },
  effectChoices: { 'syncretism:favored-weapon': 'longsword' },
};

type Ov = BuildOverrides & { v?: number };
type Given = { featId: string; level: number; category: FeatCategory }[];
/** The variants WITHOUT an active given feat the slots do not already hold, each with the overrides /
 *  options / extra slot picks that make it so. */
const INACTIVE: { name: string; ov: (given: Given) => Ov; options?: CharacterOptions; picks?: (given: Given) => Record<string, string> }[] = [
  { name: 'paused', ov: (g) => ({ addedFeats: g, meta: Object.fromEntries(g.map((a) => [keyOf(a.featId, a.level), { on: false, of: `${a.featId}@${a.level}` }])) }) },
  { name: 'switched off', ov: (g) => ({ addedFeats: g, v: 2 }), options: { overridesEnabled: false } as CharacterOptions },
  { name: 'not yet (start level 21)', ov: (g) => ({ addedFeats: g.map((a) => ({ ...a, level: 21 })) }) },
  { name: 'removed', ov: (g) => ({ addedFeats: g, removedFeatIds: g.map((a) => a.featId) }) },
  { name: 'absent (empty list)', ov: () => ({ addedFeats: [] }) },
  /* ACTIVE, but every given feat (twice over, so the one-per-id dedupe runs) is already in a level-1 slot:
   * `slotted()` drops each, as buildCharacter's `takenFeats.has` always did. */
  {
    name: 'active but already held by a slot (deduped)',
    ov: (g) => ({ addedFeats: [...g, ...g] }),
    picks: (g) => Object.fromEntries(g.map((a, i) => [`1:${a.category}:${10 + i}`, a.featId])),
  },
];

const plain = (x: unknown) => JSON.parse(JSON.stringify(x ?? null));
/** Both answers' walker names. `plain` drops a walker whose answer is undefined, so reading only one
 *  side's keys would skip every walker that answers undefined on that side (it once hid three). */
const walkersOf = (a: Record<string, unknown>, r: Record<string, unknown>) => new Set([...Object.keys(a), ...Object.keys(r)]);
/** Every routed walker's answer for one build, as plain data. */
function answers(b: BuildState, withSlots: boolean): Record<string, unknown> {
  const arch = resolveClassArchetype(b, db);
  const character = { ...buildCharacter(b, db) } as Record<string, unknown>;
  delete character.overrides;
  return plain({
    secondHeritageIdOf: secondHeritageIdOf(b, db),
    passionBackground: passionBackground(b, db, resolveBackground(b, db))?.id,
    extraPickCount: extraPickCount({ pickByLevel: { 1: 3 }, id: 'ikon' }, b.level, b),
    levelChoices: levelChoices(b, db),
    choiceFlagAnswer: choiceFlagAnswer('sunGodsDomain', b, db),
    buildUsesDeity: buildUsesDeity(b, db),
    takesDeitySanctification: [takesDeitySanctification(b, db), takesDeitySanctification(b, db, true)],
    deityNamedBy: deityNamedBy(b, db),
    classArchetypeSpellMods: [classArchetypeSpellMods(b, db), classArchetypeSpellMods(b, db, b.classId)],
    resolveClassArchetype: { carriers: arch.carriers, suppressed: [...arch.suppressed], added: arch.added, addedFrom: arch.addedFrom },
    cantripBonusFor: [cantripBonusFor(b, db), classCantripBonus(b, db, b.classId)],
    splinterDomainsOf: splinterDomainsOf(b, db),
    kineticistElements: kineticistElements(b, b.level),
    adoptedAncestryIds: adoptedAncestryIds(b, db, b.level),
    takenForDedicationRule: takenForDedicationRule(b, '2:class:0'),
    heldPickGranters: heldPickGranters(b, db, b.level, 'cantrip-expansion', () => false),
    ...(withSlots
      ? {
          eligibleAncestry: eligibleFeatsForSlot(b, db, { level: b.level, category: 'ancestry', idx: 0 }).length,
          eligibleGeneral: eligibleFeatsForSlot(b, db, { level: b.level, category: 'general', idx: 0 }).length,
        }
      : {}),
    buildCharacter: character,
  });
}

const GRID = Object.keys(db.classes)
  .sort()
  .flatMap((cid) => Array.from({ length: 20 }, (_, i) => ({ ...mk(cid, i + 1), ...ANSWERS }) as BuildState));
/** eligibleFeatsForSlot walks every feat: on the ancestry-feat levels only, to keep the run short. */
const SLOT_LEVELS = new Set([1, 5, 9, 13, 17]);
const given = GIVEN.map((id) => add(id, 1, (db.feats[id]?.category ?? 'class') as FeatCategory));
const without = (ov: Ov): Ov => {
  const { addedFeats: _gone, ...rest } = ov;
  void _gone;
  return rest;
};

describe('a character without active addedFeats: every routed walker answers as with addedFeats deleted', () => {
  it('the fixture gives feats every walker reacts to (all present in the data)', () => {
    expect(GIVEN.length).toBe(19);
  });

  for (const v of INACTIVE) {
    it(`addedFeats ${v.name}`, () => {
      const moved: string[] = [];
      for (const base0 of GRID) {
        const base = v.picks ? ({ ...base0, featPicks: { ...base0.featPicks, ...v.picks(given) } } as BuildState) : base0;
        const ov = v.ov(given);
        const withGiven = { ...base, overrides: ov, ...(v.options ? { options: v.options } : {}) } as BuildState;
        const deleted = { ...withGiven, overrides: without(ov) } as BuildState;
        const slots = SLOT_LEVELS.has(base.level);
        const a = answers(withGiven, slots);
        const r = answers(deleted, slots);
        for (const k of walkersOf(a, r)) if (JSON.stringify(a[k]) !== JSON.stringify(r[k])) moved.push(`${base.classId} L${base.level} ${k}`);
      }
      expect(moved).toEqual([]);
    }, 600_000);
  }

  it('control: with the same given feats ACTIVE, every walker moves for some character (the property is not vacuous)', () => {
    const movedBy = new Set<string>();
    // A given Cleric Dedication answers the sanctification itself, which silences Mortal Herald's reading
    // (`takesDeitySanctification`), so the control also runs once without it.
    for (const list of [given, given.filter((a) => a.featId !== 'cleric-dedication')]) {
      for (const base0 of GRID) {
        if (![1, 2, 5, 12, 20].includes(base0.level)) continue;
        const base = { ...base0, featPicks: {} } as BuildState; // the given feats alone (SLOT_PICKS would hold some)
        const withGiven = { ...base, overrides: { addedFeats: list } } as BuildState;
        const deleted = { ...base, overrides: {} } as BuildState;
        const slots = SLOT_LEVELS.has(base.level);
        const a = answers(withGiven, slots);
        const r = answers(deleted, slots);
        for (const k of walkersOf(a, r)) if (JSON.stringify(a[k]) !== JSON.stringify(r[k])) movedBy.add(k);
      }
    }
    expect([...movedBy].sort()).toEqual(
      [
        'adoptedAncestryIds', 'buildCharacter', 'buildUsesDeity', 'cantripBonusFor', 'choiceFlagAnswer', 'classArchetypeSpellMods',
        'deityNamedBy', 'eligibleAncestry', 'eligibleGeneral', 'extraPickCount', 'heldPickGranters', 'kineticistElements', 'levelChoices', 'passionBackground',
        'resolveClassArchetype', 'secondHeritageIdOf', 'splinterDomainsOf', 'takenForDedicationRule', 'takesDeitySanctification',
      ].sort(),
    );
  }, 600_000);
});
