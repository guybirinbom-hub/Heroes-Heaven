// @vitest-environment jsdom
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom, renderText } from './_render';
import { Builder } from '../src/builder/Builder';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { buildCharacter, checkPrerequisites, collectChosenIds, emptyBuild, removeChosenIds, type BuildState } from '../src/rules/build';
import { deriveAc, deriveMaxHp, derivePerception, deriveSave, deriveSkill } from '../src/rules/derive';
import { heldFeatIds } from '../src/rules/heldFeats';
import { BLOCK_KINDS } from '../src/rules/blocks/registry';
import { activeGivenFeats, readTweaks } from '../src/rules/blocks/stored';
import { allowedInPicker, anyListRules, extraTakes, isAllowedAnyway, liveChoiceBlocks, liveGivenSpells, livePlaces, removedPlaceKeys } from '../src/rules/blocks/active';
import { contentFor } from '../src/rules/blocks/content';
import { markImported, setTweaksSwitch, writeTweak, type TweakDraft } from '../src/rules/blocks/write';
import type { BuildOverrides, Character, Feat } from '../src/rules/types';

/**
 * THE PAUSE TABLE (Tweaks part B, plan section 2; spec item 4 "one reader"; WP2): every registry kind obeys
 * the Tweaks master switch, its own on/off and — where its editor has a level part — its start level. One
 * predicate decides "live" (`entryLive`, src/rules/blocks/active.ts); every reader asks it. Each kind is
 * measured on what the player SEES change (a number, a held feat, a listed spell, the content the sheet
 * reads), never on a field of the stored object. Writes go through the write door (blocks/write.ts), as the
 * Tweaks page will. Synthetic characters only.
 */

const db = content();
const noop = () => undefined;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function hero(level: number, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes.fighter;
  return {
    ...emptyBuild(),
    name: 'Pause fixture',
    level,
    classId: 'fighter',
    keyAbility: 'str',
    ancestryId: 'human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    levelBoosts: ['str', 'dex', 'con', 'wis'],
    ...more,
  } as BuildState;
}
const built = (b: BuildState): Character => buildCharacter(b, db);

/** A fighter class feat of level 1 (removed by `remove.feat`; the fixture picks it in its slot). */
const FIGHTER_FEAT = Object.values(db.feats)
  .filter((f) => f.level === 1 && (f.traits ?? []).includes('fighter'))
  .map((f) => f.id)
  .sort()[0];
/** Any class feature: `grant.classFeature` lists it whatever the class (buildCharacter never re-validates). */
const FEATURE = Object.keys(db.classFeatures).sort()[0];
const RITUAL = Object.values(db.spells).find((s) => s.ritual)!;

const BASE = hero(5, { featPicks: { '1:class:0': FIGHTER_FEAT } });

interface Fixture {
  /** The tweak, as the Tweaks page hands it to the write door (absent: written straight into storage). */
  draft?: TweakDraft;
  /** `rank.legacySet` has no editor (nothing new is ever written as one): its stored shape. */
  stored?: BuildOverrides;
  /** What the player sees, read off the build. */
  see: (b: BuildState) => unknown;
  /** The draft with its start level above 5 (and at 5, where it must be live): a kind with a level part. */
  atLevel?: (lvl: number) => Partial<TweakDraft>;
}

const FIXTURES: Record<string, Fixture> = {
  'number.add': { draft: { kind: 'number.add', target: 'skill:athletics', value: 1 }, see: (b) => deriveSkill(built(b), 'athletics', db).modifier, atLevel: (from) => ({ from }) },
  'attribute.add': { draft: { kind: 'attribute.add', target: 'score:dex', value: 2 }, see: (b) => built(b).abilities.dex, atLevel: (from) => ({ from }) },
  'number.set': { draft: { kind: 'number.set', target: 'ac', value: 30 }, see: (b) => deriveAc(built(b), db).value, atLevel: (from) => ({ from }) },
  'number.atLeast': { draft: { kind: 'number.atLeast', target: 'perception', value: 25 }, see: (b) => derivePerception(built(b), db).modifier, atLevel: (from) => ({ from }) },
  'number.setMaxHp': { draft: { kind: 'number.setMaxHp', target: 'max-hp', value: 99 }, see: (b) => deriveMaxHp(built(b), db), atLevel: (from) => ({ from }) },
  'attribute.set': { draft: { kind: 'attribute.set', target: 'score:con', value: 22 }, see: (b) => built(b).abilities.con, atLevel: (from) => ({ from }) },
  'rank.atLeast': { draft: { kind: 'rank.atLeast', target: 'skill:stealth', rank: 'legendary' }, see: (b) => deriveSkill(built(b), 'stealth', db).modifier, atLevel: (from) => ({ from }) },
  'rank.exactly': { draft: { kind: 'rank.exactly', target: 'save:will', rank: 'untrained' }, see: (b) => deriveSave(built(b), 'will', db).modifier, atLevel: (from) => ({ from }) },
  'rank.legacySet': { stored: { proficiencies: { classDc: 'legendary' } }, see: (b) => built(b).proficiencies.classDc },
  'grant.feat': {
    draft: { kind: 'grant.feat', record: 'toughness', level: 1, category: 'general' },
    see: (b) => [built(b).feats.some((f) => f.featId === 'toughness'), heldFeatIds(b).includes('toughness')],
    // B10: a given feat's level part is its STORED level (no meta.from).
    atLevel: (level) => ({ level }),
  },
  'grant.classFeature': {
    draft: { kind: 'grant.classFeature', record: FEATURE, level: 1 },
    see: (b) => (built(b).grantedFeatures ?? []).some((g) => g.featureId === FEATURE),
    atLevel: (level) => ({ level }),
  },
  'grant.spell': {
    draft: { kind: 'grant.spell', record: 'fireball', spellRank: 3 },
    see: (b) => built(b).spellcasting.find((e) => e.id === 'added-spells')?.repertoire?.[3]?.includes('fireball') ?? false,
    atLevel: (from) => ({ from }),
  },
  'grant.language': { draft: { kind: 'grant.language', record: 'aklo' }, see: (b) => built(b).languages.includes('aklo'), atLevel: (from) => ({ from }) },
  'remove.feat': { draft: { kind: 'remove.feat', record: FIGHTER_FEAT }, see: (b) => built(b).feats.some((f) => f.featId === FIGHTER_FEAT) },
  'choice.allowAnyway': { draft: { kind: 'choice.allowAnyway', record: 'risky-feat' }, see: (b) => isAllowedAnyway(b, 'risky-feat') },
  'text.edit': { draft: { kind: 'text.edit', record: 'feats/toughness', text: { name: 'Tougher' } }, see: (b) => contentFor(db, b).feats.toughness?.name },
  // tweaks p2 WP1: a pause fixture per phase-2 choice kind ("every registry kind has a pause fixture"). WP1 wires
  // no seam yet (`applies: 'not-yet'`), so each is measured on the ONE blocks/active.ts accessor its later seam
  // will ask (plan C6) — the same answer every picker and engine reader of that WP will get. Each WP that wires
  // the seam moves its fixture onto the number or the pick the player sees.
  'choice.allowAnywayAnyPicker': {
    draft: { kind: 'choice.allowAnywayAnyPicker', record: 'ancient-elf', fields: { picker: 'heritage' } },
    see: (b) => allowedInPicker(b, 'heritage', 'ancient-elf'),
  },
  'choice.anyList': { draft: { kind: 'choice.anyList', record: 'toughness', fields: { rule: 'list' } }, see: (b) => [...anyListRules(b, 'toughness')] },
  'choice.moreTakes': { draft: { kind: 'choice.moreTakes', record: 'fleet', fields: { times: 1 } }, see: (b) => extraTakes(b, 'fleet') },
  'choice.addPlace': {
    draft: { kind: 'choice.addPlace', fields: { place: 'feat', level: 4, category: 'general', n: 483920 } },
    // the live places only: a PAUSED place's key stops counting (placeLiveForKey false) while a key with no
    // block counts (C9), so the key's own liveness is not a baseline measure
    see: (b) => livePlaces(b).map((p) => p.slotKey),
  },
  'remove.choicePlace': {
    draft: { kind: 'remove.choicePlace', fields: { place: 'feat', level: 1, category: 'class', ordinal: 0 } },
    see: (b) => [...removedPlaceKeys(b, (lvl) => (lvl === 1 ? ['ancestry', 'class'] : []))],
  },
  // WP13 (re-scoped 2026-10-25): "Change an answer" (WP10) and "Edit a list" (WP9) come after the record rebuild. A
  // stored one reads as a newer version's — no switch, nothing to pause (the "not-yet kinds" describe below) — so they
  // leave the pause table until those work packages give them a seam.
};

/** The kinds with a switch: every kind something applies (WP13: the not-yet kinds have none). */
const PAUSABLE = BLOCK_KINDS.filter((k) => k.applies !== 'not-yet').map((k) => k.id);
const NOT_YET = BLOCK_KINDS.filter((k) => k.applies === 'not-yet').map((k) => k.id);

/** The base character with `kind`'s tweak added (through the write door), and that tweak's instance key. */
function withTweak(kind: string, more: Partial<TweakDraft> = {}): { b: BuildState; key: string } {
  const fx = FIXTURES[kind];
  let ov: BuildOverrides | undefined;
  if (fx.draft) {
    const r = writeTweak({ overrides: BASE.overrides, options: BASE.options }, { op: 'add', draft: { ...fx.draft, ...more } });
    expect(r.refused, `${kind}: refused: ${r.refused}`).toBeUndefined();
    ov = r.overrides;
  } else {
    ov = { ...fx.stored, ...(more.from ? { meta: { [readTweaks(fx.stored).instances[0].key]: { from: more.from } } } : {}) };
  }
  const key = readTweaks(ov).instances.find((i) => i.kind === kind)!.key;
  return { b: { ...BASE, overrides: ov }, key };
}
const setOn = (b: BuildState, key: string, on: boolean): BuildState => {
  const r = writeTweak({ overrides: b.overrides, options: b.options }, { op: 'setOn', key, on });
  expect(r.refused, `setOn refused: ${r.refused}`).toBeUndefined();
  return { ...b, overrides: r.overrides };
};
const master = (b: BuildState, on: boolean): BuildState => ({ ...b, ...setTweaksSwitch({ overrides: b.overrides, options: b.options }, on) }) as BuildState;
/** The kinds with a start level (their editor has a level part; `rank.legacySet` has no editor and keeps the
 *  meta `from` it may carry). B25: remove.feat, choice.allowAnyway and text.edit have none. */
const LEVELLED = BLOCK_KINDS.filter((k) => k.applies !== 'not-yet' && (!k.editor || k.editor.parts.includes('level'))).map((k) => k.id);

describe('the pause table covers every registry kind', () => {
  it('every registry kind something applies has a pause fixture', () => {
    expect(PAUSABLE.filter((id) => !FIXTURES[id]), 'a kind with no pause fixture').toEqual([]);
    for (const id of LEVELLED) expect(FIXTURES[id].atLevel ?? FIXTURES[id].stored, `${id}: a start-level fixture`).toBeTruthy();
  });

  // WP13: a not-yet kind's stored block is a newer version's — never an instance, so there is no switch to obey.
  it('the not-yet kinds (choice.changeAnswer, choice.editOptions) are never live, and their stored block cannot be paused', () => {
    expect(NOT_YET.sort()).toEqual(['choice.changeAnswer', 'choice.editOptions']);
    const stored: BuildOverrides = {
      blocks: [
        { id: 't1_aaaa', kind: 'choice.changeAnswer', v: 1, question: 'skillSlot', record: 'rogue-dedication', index: 0, value: 'stealth' },
        { id: 't2_aaaa', kind: 'choice.editOptions', v: 1, question: 'choice', record: 'variable-core', add: ['fire'] },
      ],
    };
    const b = { ...BASE, overrides: stored };
    expect(readTweaks(stored).instances).toEqual([]);
    expect(readTweaks(stored).foreign.map((f) => f.why)).toEqual(['newer-version', 'newer-version']);
    expect(liveChoiceBlocks(b)).toEqual([]);
    for (const key of ['blocks:t1_aaaa', 'blocks:t2_aaaa']) expect(writeTweak({ overrides: stored }, { op: 'setOn', key, on: false }).refused, key).toBeTruthy();
    expect(JSON.stringify(built(b).feats), 'the stored blocks change nothing the player sees').toBe(JSON.stringify(built(BASE).feats));
  });
});

describe.each(PAUSABLE)('%s', (kind) => {
  const fx = FIXTURES[kind];
  const baseline = () => fx.see(BASE);

  it(`master switch off pauses ${kind}`, () => {
    const { b } = withTweak(kind);
    expect(fx.see(b), 'fixture: the tweak changes what the player sees').not.toEqual(baseline());
    expect(fx.see(master(b, true)), 'switched on (v:2 written with the option): still live').toEqual(fx.see(b));
    expect(fx.see(master(b, false)), 'switched off: as if the tweak were not there').toEqual(baseline());
  });

  it(`its own switch pauses ${kind}`, () => {
    const { b, key } = withTweak(kind);
    const paused = setOn(b, key, false);
    expect(fx.see(paused)).toEqual(baseline());
    // Paused data stays stored untouched: the entry is still there.
    expect(readTweaks(paused.overrides).instances.some((i) => i.key === key && !i.on)).toBe(true);
  });

  if (LEVELLED.includes(kind)) {
    it(`a start level above the character's level pauses ${kind}`, () => {
      const at = (lvl: number) => withTweak(kind, fx.atLevel ? fx.atLevel(lvl) : { from: lvl }).b;
      expect(fx.see(at(6)), 'starts at 6, the character is 5').toEqual(baseline());
      expect(fx.see(at(5)), 'starts at 5: live').toEqual(fx.see(withTweak(kind).b));
    });
  }

  it(`switching back on resumes ${kind}`, () => {
    const { b, key } = withTweak(kind);
    const live = fx.see(b);
    expect(fx.see(master(master(b, false), true)), 'the master switch').toEqual(live);
    expect(fx.see(setOn(setOn(b, key, false), key, true)), 'its own switch').toEqual(live);
  });
});

describe('import-stamped entries ignore the master switch (spec 2)', () => {
  it('an import-stamped given feat stays held when Tweaks is off', () => {
    const ov: BuildOverrides = { addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }] };
    const stamped = markImported(ov, 'addedFeats', 0);
    const off = (o: BuildOverrides) => ({ ...BASE, overrides: { ...o, v: 2 }, options: { overridesEnabled: false } }) as BuildState;
    expect(built(off(stamped)).feats.some((f) => f.featId === 'toughness'), 'stamped: held').toBe(true);
    expect(heldFeatIds(off(stamped))).toContain('toughness');
    // Mutation note: without the stamp the same switch-off build holds nothing.
    expect(built(off(ov)).feats.some((f) => f.featId === 'toughness'), 'not stamped: paused').toBe(false);
    // Its own switch still counts.
    const key = readTweaks(stamped).instances[0].key;
    expect(heldFeatIds(setOn(off(stamped), key, false))).not.toContain('toughness');
  });

  it('an import-stamped ritual stays listed when Tweaks is off', () => {
    const ov: BuildOverrides = { addedSpells: [{ spellId: RITUAL.id, rank: RITUAL.rank }] };
    const stamped = markImported(ov, 'addedSpells', 0);
    const sheet = (o: BuildOverrides) => built({ ...BASE, overrides: { ...o, v: 2 }, options: { overridesEnabled: false } } as BuildState);
    expect(liveGivenSpells(sheet(stamped)).map((s) => s.spellId)).toEqual([RITUAL.id]);
    expect(renderText(createElement(SpellsTab, { character: sheet(stamped), content: db })), 'the Rituals section lists it').toContain(RITUAL.name);
    // Not stamped: switched off with the rest.
    expect(liveGivenSpells(sheet(ov))).toEqual([]);
    expect(renderText(createElement(SpellsTab, { character: sheet(ov), content: db }))).not.toContain(RITUAL.name);
  });
});

describe('given feats: the start level and the switch outside the cache', () => {
  it('a given feat with from 5 is held at level 5 and above, not below (activeGivenFeats has no level)', () => {
    // A part-A-era meta `from` on a given feat (the write door folds it into the stored level on the
    // first edit, B10; an old character can still carry it).
    const ov: BuildOverrides = { addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }], meta: { 'addedFeats:toughness@1': { from: 5 } } };
    expect(activeGivenFeats(ov).map((g) => [g.featId, g.level]), 'held from max(stored, from) = 5').toEqual([['toughness', 5]]);
    for (const [lvl, held] of [[4, false], [5, true], [7, true]] as const) {
      const b = hero(lvl, { overrides: ov });
      expect(heldFeatIds(b).includes('toughness'), `level ${lvl}`).toBe(held);
      expect(built(b).feats.some((f) => f.featId === 'toughness'), `level ${lvl}: the sheet`).toBe(held);
    }
  });

  it('switching Tweaks off with the SAME overrides object un-holds a non-imported given feat and keeps an imported one', () => {
    const ov: BuildOverrides = {
      v: 2,
      ...markImported({ addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }, { featId: 'fleet', level: 1, category: 'general' }] }, 'addedFeats', 1),
    };
    expect(activeGivenFeats(ov, { overridesEnabled: true }).map((g) => g.featId), 'on: both (the cache is now warm)').toEqual(['toughness', 'fleet']);
    expect(activeGivenFeats(ov, { overridesEnabled: false }).map((g) => g.featId), 'off, same object: the imported one only').toEqual(['fleet']);
    expect(activeGivenFeats(ov, { overridesEnabled: true }).map((g) => g.featId), 'on again').toEqual(['toughness', 'fleet']);
    const b = (on: boolean) => ({ ...BASE, overrides: ov, options: { overridesEnabled: on } }) as BuildState;
    expect(heldFeatIds(b(false))).not.toContain('toughness');
    expect(heldFeatIds(b(false))).toContain('fleet');
  });
});

describe('paused entries are storage: still counted, dropped only with their meta', () => {
  it('a paused entry still counts in collectChosenIds', () => {
    const { b, key } = withTweak('grant.feat');
    expect(collectChosenIds(setOn(b, key, false), db).has('toughness'), 'its own switch off').toBe(true);
    expect(collectChosenIds(master(b, false), db).has('toughness'), 'Tweaks off').toBe(true);
  });

  it('removeChosenIds drops the meta of what it removes', () => {
    const ov: BuildOverrides = {
      v: 3,
      addedFeats: [
        { featId: 'toughness', level: 1, category: 'general' },
        { featId: 'fleet', level: 1, category: 'general' },
      ],
      meta: { 'addedFeats:toughness@1': { reason: 'gone with its book', of: 'toughness@1' }, 'addedFeats:fleet@1': { reason: 'kept', on: false, of: 'fleet@1' } },
    };
    const next = removeChosenIds({ ...BASE, overrides: ov }, new Set(['toughness']));
    expect(next.overrides?.addedFeats).toEqual([{ featId: 'fleet', level: 1, category: 'general' }]);
    expect(next.overrides?.meta, "the removed entry's meta goes; the kept one keeps its own").toEqual({ 'addedFeats:fleet@1': { reason: 'kept', on: false, of: 'fleet@1' } });
    expect(next.overrides?.v, 'v is never touched (B27)').toBe(3);
    // Nothing left: the overrides go (B15).
    expect(removeChosenIds({ ...BASE, overrides: { addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }] } }, new Set(['toughness'])).overrides).toBeUndefined();
  });
});

describe('choice.allowAnyway paused: the pick stays, its warning returns', () => {
  /** A level-4 fighter class feat this fixture does NOT qualify for (every level-1 fighter feat has no
   *  prerequisite), taken anyway in its slot. */
  const L4 = hero(4);
  const RISKY = Object.values(db.feats)
    .filter((f): f is Feat => f.level === 4 && (f.traits ?? []).includes('fighter') && (f.prerequisites ?? []).length > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .find((f) => !checkPrerequisites(f, built(L4), db).met)!;
  const SLOT = '4:class:0';

  it("a paused 'Take anyway' feat stays picked; only its warning returns", () => {
    expect(RISKY, 'fixture: a fighter feat with an unmet prerequisite').toBeDefined();
    const taken = { ...L4, featPicks: { [SLOT]: RISKY.id }, overrides: { allowedFeats: [RISKY.id] } } as BuildState;
    const key = readTweaks(taken.overrides).instances[0].key;
    const warned = (b: BuildState): boolean => {
      const r = renderDom(createElement(Builder, { content: db, initial: b, onCancel: noop, onCreate: noop }));
      try {
        const page = [...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '4');
        r.click(page ?? null);
        expect(r.host.querySelector(`[data-ctl="slot"]`), 'the level-4 page is drawn').not.toBeNull();
        return !!r.host.querySelector(`[data-invalid="${SLOT}"]`);
      } finally {
        r.stop();
      }
    };
    expect(warned(taken), 'taken anyway, live: no warning').toBe(false);
    for (const [label, b] of [
      ['its own switch off', setOn(taken, key, false)],
      ['Tweaks off', master(taken, false)],
    ] as const) {
      expect(isAllowedAnyway(b, RISKY.id), label).toBe(false);
      expect(b.featPicks[SLOT], `${label}: the pick stays`).toBe(RISKY.id);
      expect(built(b).feats.some((f) => f.featId === RISKY.id), `${label}: still on the character (the build never checks legality)`).toBe(true);
      expect(warned(b), `${label}: the prerequisite warning returns`).toBe(true);
    }
  }, 120_000);
});
