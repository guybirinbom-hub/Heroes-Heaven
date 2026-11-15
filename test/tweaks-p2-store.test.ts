import { describe, expect, it } from 'vitest';
import {
  allowedInPicker,
  anyListRules,
  extraTakes,
  featPlaceKey,
  liveChoiceBlocks,
  livePlaces,
  placeLiveForKey,
  placeStatus,
  removedPlaceKeys,
  removedPlaces,
} from '../src/rules/blocks/active';
import {
  ADD_PLACES,
  ANSWER_QUESTIONS,
  ANY_LIST_RULES,
  ANY_PICKERS,
  BOOST_SETS,
  FEAT_PLACE_CATEGORIES,
  REMOVE_PLACES,
  REMOVE_SKILL_LANES,
} from '../src/rules/blocks/registry';
import { CHOICE_FIELDS, COMMA_REFUSAL, choiceBlockRecordIds, parseStoredBlocks, writeStoredBlocks, type StoredBlock } from '../src/rules/blocks/stored';
import { dropChoiceBlocks, dropChoiceTweak, MORE_TAKES_COPY, newBlockId, newPlaceN, writeChoiceTweak, writeTweak } from '../src/rules/blocks/write';
import { SLOT_PREFIX } from '../src/rules/featSlots';
import type { BuildOverrides, CharacterOptions } from '../src/rules/types';

/**
 * Tweaks phase 2, WP1 (work/tweaks-phase2-notes/plan.md section 4, decisions C3, C4, C8, C9, C27, C31, C32): the seven
 * choice kinds store, read, round-trip and keep what they cannot read. Synthetic data only.
 * WP13 (re-scoped 2026-10-25): the five BUILT kinds round-trip; the values a deferred work package owns (a skill increase
 * taken anyway, WP12; a class-choice, tactic or rune place removed, WP16 / WP17) and the two kinds nothing applies yet
 * ("Change an answer", WP10; "Edit a list", WP9) come after the record rebuild, so they read as made in a newer version:
 * kept byte for byte, never applied, and refused by the write door (the DEFERRED fixtures below).
 */

type Raw = Record<string, unknown>;
interface Host {
  overrides?: BuildOverrides;
  options?: CharacterOptions;
  level?: number;
}

/* Every closed-set value of section 4 has a fixture, each written in the kind's canonical field order
 * (id, kind, v, CHOICE_FIELDS, reason, on), so an untouched read + write gives the very same bytes. */
let seq = 0;
const blk = (kind: string, fields: Raw): Raw => {
  seq++;
  return { id: `t${seq}_ab${seq % 10}z`, kind, v: 1, ...fields };
};

const ALLOW: Raw[] = [
  blk('choice.allowAnywayAnyPicker', { picker: 'heritage', record: 'ancient-elf', reason: 'GM: raised by elves' }),
  blk('choice.allowAnywayAnyPicker', { picker: 'background', record: 'acolyte' }),
  blk('choice.allowAnywayAnyPicker', { picker: 'deity', record: 'sample-deity' }),
  blk('choice.allowAnywayAnyPicker', { picker: 'subclass', record: 'sample-cause', classId: 'champion' }),
  blk('choice.allowAnywayAnyPicker', { picker: 'spell', record: 'sample-spell' }),
  blk('choice.allowAnywayAnyPicker', { picker: 'sanctification', record: 'cleric-dedication', value: 'unholy' }),
];
const ANY_LIST: Raw[] = ANY_LIST_RULES.map((rule) => blk('choice.anyList', { record: 'toughness', rule }));
const MORE: Raw[] = [blk('choice.moreTakes', { record: 'fleet', times: 1 }), blk('choice.moreTakes', { record: 'fleet', times: 2, on: false })];
const ADD: Raw[] = [
  ...FEAT_PLACE_CATEGORIES.map((category, i) => blk('choice.addPlace', { place: 'feat', level: 4, category, n: 483920 + i })),
  blk('choice.addPlace', { place: 'skillIncrease', level: 5, skill: 'stealth' }),
  blk('choice.addPlace', { place: 'skillIncrease', level: 6 }),
  blk('choice.addPlace', { place: 'boost', level: 5, attribute: 'dex' }),
  blk('choice.addPlace', { place: 'boost', level: 9 }),
];
const REMOVE: Raw[] = [
  blk('remove.choicePlace', { place: 'feat', level: 4, category: 'class', ordinal: 0 }),
  ...REMOVE_SKILL_LANES.map((lane) => blk('remove.choicePlace', { place: 'skillIncrease', level: 5, lane })),
  ...BOOST_SETS.map((set, index) => blk('remove.choicePlace', set === 'level' ? { place: 'boost', set, level: 10, index: 2 } : { place: 'boost', set, index })),
];
/* WP13: what WP1 stored for the deferred work packages, exactly as WP1 wrote it — now a newer version's blocks. */
const TRIMMED: Raw[] = [
  ...['cap', 'locked', 'narrowed'].map((rule) => blk('choice.allowAnywayAnyPicker', { picker: 'skillIncrease', record: 'stealth', rule, level: 5, lane: 'main' })),
  blk('choice.allowAnywayAnyPicker', { picker: 'skillIncrease', record: 'lore:bardic', rule: 'locked', level: 7, lane: 'tweak', placeId: 't90_qqqq' }),
  blk('remove.choicePlace', { place: 'classChoice', classId: 'thaumaturge', group: 'implement', ordinal: 1 }),
  blk('remove.choicePlace', { place: 'tactic', ordinal: 4 }),
  blk('remove.choicePlace', { place: 'rune', ordinal: 3 }),
];
const ANSWER: Raw[] = ANSWER_QUESTIONS.map((question, i) =>
  blk('choice.changeAnswer', { question, record: `rec-${question}`, ...(i === 0 ? { index: 0, choiceValue: 'parent' } : {}), value: i === 3 ? 'lore:sailing' : 'athletics' }),
);
/** Even positions add and remove; odd ones only add. */
const EDIT: Raw[] = ANSWER_QUESTIONS.map((question, i) =>
  blk('choice.editOptions', { question, record: `rec-${question}`, ...(i === 0 ? { index: 1 } : {}), ...(i % 2 ? { add: ['fire'] } : { add: ['fire'], remove: ['cold'] }) }),
);
/** WP13: every stored value a deferred work package owns. */
const DEFERRED: Raw[] = [...TRIMMED, ...ANSWER, ...EDIT];
/** The built kinds' fixtures (every closed-set value this version offers). */
const BUILT: Raw[] = [...ALLOW, ...ANY_LIST, ...MORE, ...ADD, ...REMOVE];
const ALL: Raw[] = [...BUILT, ...DEFERRED];

/** A read instance back to the stored shape (canonical order), as an editor's untouched upsert would write it. */
const storedFrom = (b: ReturnType<typeof parseStoredBlocks>['known'][number]): Raw => {
  const out: Raw = { id: b.key.slice('blocks:'.length), kind: b.kind, v: b.version, ...b.params };
  if (b.reason) out.reason = b.reason;
  if (!b.on) out.on = false;
  return out;
};

/** WP13: the five kinds this version builds; "Change an answer" and "Edit a list" come after the record rebuild. */
const KINDS = ['choice.allowAnywayAnyPicker', 'choice.anyList', 'choice.moreTakes', 'choice.addPlace', 'remove.choicePlace'];
const NOT_YET_KINDS = ['choice.changeAnswer', 'choice.editOptions'];

describe('the fixtures cover every closed-set value of section 4 (rev 3)', () => {
  it('every picker, place, rule, lane, set and question value has a fixture', () => {
    const vals = (kind: string, f: string) => new Set(BUILT.filter((b) => b.kind === kind).map((b) => b[f]));
    for (const p of ANY_PICKERS) expect(vals('choice.allowAnywayAnyPicker', 'picker').has(p), p).toBe(true);
    for (const r of ANY_LIST_RULES) expect(vals('choice.anyList', 'rule').has(r), r).toBe(true);
    for (const p of ADD_PLACES) expect(vals('choice.addPlace', 'place').has(p), p).toBe(true);
    for (const c of FEAT_PLACE_CATEGORIES) expect(vals('choice.addPlace', 'category').has(c), c).toBe(true);
    for (const p of REMOVE_PLACES) expect(vals('remove.choicePlace', 'place').has(p), p).toBe(true);
    for (const l of REMOVE_SKILL_LANES) expect(vals('remove.choicePlace', 'lane').has(l), l).toBe(true);
    for (const s of BOOST_SETS) expect(vals('remove.choicePlace', 'set').has(s), s).toBe(true);
    expect(new Set(BUILT.map((b) => b.kind))).toEqual(new Set(KINDS));
    // WP13: every question still has a stored fixture of each not-yet kind (they read as a newer version's).
    const dVals = (kind: string) => new Set(DEFERRED.filter((b) => b.kind === kind).map((b) => b.question));
    for (const q of ANSWER_QUESTIONS) for (const k of NOT_YET_KINDS) expect(dVals(k).has(q), `${k} ${q}`).toBe(true);
  });

  it('WP13: the closed sets hold only built values — skillIncrease is no picker; classChoice, tactic, rune no removable place', () => {
    expect([...ANY_PICKERS]).toEqual(['heritage', 'background', 'deity', 'subclass', 'spell', 'sanctification']);
    expect([...REMOVE_PLACES]).toEqual(['feat', 'skillIncrease', 'boost']);
  });
});

describe('WP13: a stored value a deferred work package owns reads as made in a newer version (C3)', () => {
  it('every deferred fixture is foreign "newer-version", kept as the very same object; nothing reads it', () => {
    const { known, foreign } = parseStoredBlocks(DEFERRED);
    expect(known).toEqual([]);
    expect(foreign.map((f) => f.why)).toEqual(DEFERRED.map(() => 'newer-version'));
    foreign.forEach((f, i) => expect(f.raw).toBe(DEFERRED[i]));
    expect(choiceBlockRecordIds({ overrides: { blocks: DEFERRED } })).toEqual([]);
    expect(liveChoiceBlocks({ overrides: { blocks: DEFERRED } })).toEqual([]);
  });

  it('a malformed block of a not-yet kind is a newer version\'s too (this version cannot know its shape)', () => {
    const odd: Raw[] = [
      { id: 't19_aaaa', kind: 'choice.changeAnswer', v: 1, question: 'skillSlot', record: 'x', value: 'a,b' },
      { id: 't20_aaaa', kind: 'choice.editOptions', v: 1, question: 'choice', record: 'x', add: [], remove: [] },
      { id: 't21_aaaa', kind: 'choice.editOptions', v: 1, question: 'choice', record: 'x', add: 'fire' },
    ];
    expect(parseStoredBlocks(odd).foreign.map((f) => f.why)).toEqual(['newer-version', 'newer-version', 'newer-version']);
  });

  it('the write door refuses every deferred block as a new tweak; a stored one cannot be paused, edited or removed', () => {
    for (const raw of DEFERRED) {
      const { id: _id, kind, v: _v, reason: _r, on: _on, record, ...fields } = raw;
      const r = writeTweak({}, { op: 'add', draft: { kind: String(kind), ...(record ? { record: String(record) } : {}), fields } });
      expect(r.refused, JSON.stringify(raw)).toBeTruthy();
      expect(r.overrides, JSON.stringify(raw)).toBeUndefined();
    }
    expect(writeTweak({}, { op: 'add', draft: { kind: 'choice.changeAnswer', record: 'x', fields: { question: 'skillSlot', value: 'stealth' } } }).refused).toBe(
      'Answer a choice outside its list is not in this version yet',
    );
    const ov: BuildOverrides = { blocks: DEFERRED };
    for (const raw of DEFERRED) {
      const key = `blocks:${raw.id}`;
      for (const w of [{ op: 'setOn', key, on: false }, { op: 'remove', key }, { op: 'update', key, draft: { reason: 'x' } }] as const)
        expect(writeTweak({ overrides: ov }, w).refused, `${w.op} ${key}`).toBeTruthy();
    }
  });

  it('another tweak written beside them leaves every deferred block untouched and in its place', () => {
    const ov: BuildOverrides = { blocks: DEFERRED };
    const r = writeTweak({ overrides: ov }, { op: 'add', draft: { kind: 'choice.anyList', record: 'toughness', fields: { rule: 'list' } } });
    expect(r.refused).toBeUndefined();
    const list = r.overrides!.blocks as unknown[];
    DEFERRED.forEach((raw, i) => expect(list[i]).toBe(raw));
    expect(JSON.stringify(list.slice(0, DEFERRED.length))).toBe(JSON.stringify(DEFERRED));
  });
});

describe.each(KINDS)('%s: stores, reads and round-trips byte for byte', (kind) => {
  const mine = BUILT.filter((b) => b.kind === kind);

  it(`${kind}: every fixture reads, with its fields as params in the kind's order`, () => {
    const { known, foreign } = parseStoredBlocks(mine);
    expect(foreign).toEqual([]);
    expect(known.map((b) => b.kind)).toEqual(mine.map(() => kind));
    for (const [i, b] of known.entries()) {
      expect(Object.keys(b.params ?? {})).toEqual(CHOICE_FIELDS[kind].filter((f) => mine[i][f] !== undefined));
      expect(b.on).toBe(mine[i].on !== false);
      // C31: a choice kind has no start level
      expect(b.gate).toBeUndefined();
    }
  });

  it(`${kind}: an untouched upsert writes the very same bytes`, () => {
    const { known } = parseStoredBlocks(mine);
    const { list, refused } = writeStoredBlocks(mine, { upsert: known.map(storedFrom) as unknown as StoredBlock[] });
    expect(refused).toEqual([]);
    expect(JSON.stringify(list)).toBe(JSON.stringify(mine));
  });

  it(`${kind}: the write door's no-change edit (resume an on block) writes the very same bytes`, () => {
    for (const raw of mine.filter((b) => b.on === undefined)) {
      const r = writeTweak({ overrides: { blocks: [raw] } }, { op: 'setOn', key: `blocks:${raw.id}`, on: true });
      expect(r.refused, String(raw.id)).toBeUndefined();
      expect(JSON.stringify(r.overrides!.blocks)).toBe(JSON.stringify([raw]));
    }
  });
});

describe('C3: what this version cannot read is kept, read-only', () => {
  const NEWER: Raw[] = [
    { id: 't1_aaaa', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'mythicPath', record: 'x' },
    { id: 't2_aaaa', kind: 'choice.anyList', v: 1, record: 'x', rule: 'rarity' },
    { id: 't3_aaaa', kind: 'choice.addPlace', v: 1, place: 'cantrip', level: 3 },
    { id: 't4_aaaa', kind: 'choice.addPlace', v: 1, place: 'feat', level: 3, category: 'familiar', n: 100001 },
    { id: 't5_aaaa', kind: 'remove.choicePlace', v: 1, place: 'spellSlot', level: 3 },
    { id: 't6_aaaa', kind: 'choice.changeAnswer', v: 1, question: 'weaponGroup', record: 'x', value: 'axe' },
    { id: 't7_aaaa', kind: 'choice.editOptions', v: 1, question: 'weaponGroup', record: 'x', add: ['axe'] },
    // an unknown closed-set value wins over a missing field (this version cannot know what that value needs)
    { id: 't8_aaaa', kind: 'remove.choicePlace', v: 1, place: 'boost', set: 'mythic' },
    { id: 't9_aaaa', kind: 'choice.moreTakes', v: 2, record: 'x', times: 1 },
  ];
  const UNREADABLE: Raw[] = [
    { id: 't11_aaaa', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 7, record: 'x' },
    { id: 't12_aaaa', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'subclass', record: 'x' }, // no classId
    { id: 't13_aaaa', kind: 'choice.anyList', v: 1, record: 'x' }, // no rule
    { id: 't14_aaaa', kind: 'choice.moreTakes', v: 1, record: 'x', times: 0 },
    { id: 't15_aaaa', kind: 'choice.moreTakes', v: 1, record: 'x', times: 10 },
    { id: 't16_aaaa', kind: 'choice.addPlace', v: 1, place: 'feat', level: 4, category: 'class' }, // no n
    { id: 't17_aaaa', kind: 'choice.addPlace', v: 1, place: 'skillIncrease', level: 21 },
    { id: 't18_aaaa', kind: 'remove.choicePlace', v: 1, place: 'feat', level: 4, category: 'class', ordinal: -1 },
    // WP13: t19-t21 (a "Change an answer" with a comma, an empty or a non-list "Edit a list") read as a newer version's
    // now, with every block of a not-yet kind (the WP13 describe above); a comma in a built kind's answer stays here.
    { id: 't19_aaaa', kind: 'choice.addPlace', v: 1, place: 'skillIncrease', level: 5, skill: 'a,b' }, // comma (C27)
    { id: 't20_aaaa', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'sanctification', record: 'x', value: 'holy,unholy' },
    { id: 't22_aaaa', kind: 'choice.anyList', v: 1, record: 'x', rule: 'list', on: 'no' },
    { id: 't23_aaaa', kind: 'choice.anyList', v: 1, record: 'x', rule: 'list', reason: 5 },
  ];

  it('an unknown discriminator or closed-set value is newer-version, kept as the same object', () => {
    const { known, foreign } = parseStoredBlocks(NEWER);
    expect(known).toEqual([]);
    expect(foreign.map((f) => f.why)).toEqual(NEWER.map(() => 'newer-version'));
    foreign.forEach((f, i) => expect(f.raw).toBe(NEWER[i]));
  });

  it('a wrong type, a missing field, a comma or an empty edit is unreadable, kept as the same object', () => {
    const { known, foreign } = parseStoredBlocks(UNREADABLE);
    expect(known).toEqual([]);
    expect(foreign.map((f) => f.why)).toEqual(UNREADABLE.map(() => 'unreadable'));
    foreign.forEach((f, i) => expect(f.raw).toBe(UNREADABLE[i]));
  });

  it('rev 3 s7: choice.addPlace boost with attribute "luck" is unreadable (the six are fixed), kept, with no Remove', () => {
    const luck: Raw = { id: 't30_aaaa', kind: 'choice.addPlace', v: 1, place: 'boost', level: 5, attribute: 'luck' };
    const ov: BuildOverrides = { blocks: [luck] };
    expect(parseStoredBlocks(ov.blocks).foreign).toEqual([{ raw: luck, why: 'unreadable', id: 't30_aaaa' }]);
    const r = writeTweak({ overrides: ov }, { op: 'remove', key: 'blocks:t30_aaaa' });
    expect(r.refused).toMatch(/kept as it is/);
    expect(r.overrides).toBe(ov);
    expect(livePlaces({ overrides: ov })).toEqual([]);
  });

  it('every foreign block survives another tweak being written, untouched and in its place; none can be removed or edited', () => {
    const ov: BuildOverrides = { blocks: [...NEWER, ...UNREADABLE] };
    const r = writeTweak({ overrides: ov }, { op: 'add', draft: { kind: 'choice.anyList', record: 'toughness', fields: { rule: 'list' } } });
    expect(r.refused).toBeUndefined();
    const list = r.overrides!.blocks as unknown[];
    [...NEWER, ...UNREADABLE].forEach((raw, i) => expect(list[i]).toBe(raw));
    expect(list).toHaveLength(NEWER.length + UNREADABLE.length + 1);
    for (const raw of [...NEWER, ...UNREADABLE]) {
      const key = `blocks:${raw.id}`;
      expect(writeTweak({ overrides: ov }, { op: 'remove', key }).refused, key).toBeTruthy();
      expect(writeTweak({ overrides: ov }, { op: 'setOn', key, on: false }).refused, key).toBeTruthy();
    }
  });

  it('a block this version cannot read is never looked into: no record id, no drop, no live place', () => {
    const ov: BuildOverrides = { blocks: [...NEWER, ...UNREADABLE] };
    expect(choiceBlockRecordIds({ overrides: ov })).toEqual([]);
    expect(dropChoiceBlocks(ov, () => true)).toBe(ov);
    expect(liveChoiceBlocks({ overrides: ov })).toEqual([]);
  });
});

describe('an unknown extra field survives an edit (per-kind KNOWN fields)', () => {
  it('choice.anyList: a newer field is carried over when the reason is edited', () => {
    const raw: Raw = { id: 't3_kkkk', kind: 'choice.anyList', v: 1, record: 'toughness', rule: 'list', reason: 'old', futureNote: { a: 1 } };
    const r = writeTweak({ overrides: { blocks: [raw] } }, { op: 'update', key: 'blocks:t3_kkkk', draft: { reason: 'new' } });
    expect(r.refused).toBeUndefined();
    expect((r.overrides!.blocks as Raw[])[0]).toEqual({ id: 't3_kkkk', kind: 'choice.anyList', v: 1, record: 'toughness', rule: 'list', reason: 'new', futureNote: { a: 1 } });
  });

  it('choice.addPlace: the stored writer keeps a field neither the old nor the new kind knows', () => {
    const raw: Raw = { id: 't4_kkkk', kind: 'choice.addPlace', v: 1, place: 'skillIncrease', level: 5, laneHint: 'x' };
    const { list } = writeStoredBlocks([raw], { upsert: [{ id: 't4_kkkk', kind: 'choice.addPlace', v: 1, place: 'skillIncrease', level: 5, skill: 'stealth' } as unknown as StoredBlock] });
    expect((list as Raw[])[0]).toEqual({ laneHint: 'x', id: 't4_kkkk', kind: 'choice.addPlace', v: 1, place: 'skillIncrease', level: 5, skill: 'stealth' });
  });
});

describe('the write door for the choice kinds (C4, C27, C32)', () => {
  it('choice.addPlace: newBlockId v2 is t<max+1>_<4 base36>, over every stored id, foreign ones included', () => {
    const ov: BuildOverrides = { blocks: [{ id: 't7', kind: 'number.add', v: 1, target: 'ac', value: 1 }, { id: 't12_zz9a', kind: 'mystery', v: 9 }, { id: 'x99' }] };
    expect(newBlockId(ov, () => 0)).toBe('t13_0000');
    expect(newBlockId(undefined, () => 0.999)).toBe('t1_zzzz');
    expect(newBlockId(ov)).toMatch(/^t13_[0-9a-z]{4}$/);
  });

  it('choice.addPlace: a feat place gets n in 100000-999999, re-drawn on a clash at its level', () => {
    const ov: BuildOverrides = { blocks: [{ id: 't1_aaaa', kind: 'choice.addPlace', v: 1, place: 'feat', level: 4, category: 'class', n: 100000 }] };
    const draws = [0, 0, 0.5];
    let i = 0;
    expect(newPlaceN(ov, 4, () => false, () => draws[i++])).toBe(550000);
    expect(newPlaceN(ov, 5, () => false, () => 0)).toBe(100000);
    expect(newPlaceN(ov, 5, (n) => n === 100000, () => 0)).toBe(100001); // 200 unlucky draws: the first free number
    const r = writeTweak({ overrides: undefined }, { op: 'add', draft: { kind: 'choice.addPlace', fields: { place: 'feat', level: 4, category: 'class' } } });
    const n = (r.overrides!.blocks as Raw[])[0].n as number;
    expect(n).toBeGreaterThanOrEqual(100000);
    expect(n).toBeLessThanOrEqual(999999);
  });

  // WP13: was choice.changeAnswer / choice.editOptions (after the record rebuild now); the extra skill increase's
  // answer is the built kind that carries a typed skill.
  it('choice.addPlace: a comma is refused (C27); a Lore answer is keyed through loreKey', () => {
    const comma = writeTweak({}, { op: 'add', draft: { kind: 'choice.addPlace', fields: { place: 'skillIncrease', level: 5, skill: 'stealth, thievery' } } });
    expect(comma.refused).toBe(COMMA_REFUSAL);
    const lore = writeTweak({}, { op: 'add', draft: { kind: 'choice.addPlace', fields: { place: 'skillIncrease', level: 5, skill: 'Sailing Lore' } } });
    expect(lore.refused).toBeUndefined();
    expect((lore.overrides!.blocks as Raw[])[0].skill).toBe('lore:sailing');
  });

  it('choice.moreTakes: a field the kind does not store, a second identical tweak, a start level and a value its reader refuses are refused', () => {
    const one = writeTweak({}, { op: 'add', draft: { kind: 'choice.moreTakes', record: 'fleet', fields: { times: 1 } } });
    expect(one.refused).toBeUndefined();
    // tweaks p2 WP8 (D1): the door's identity is the record alone, so a second Fleet block is refused whatever its times.
    expect(writeTweak({ overrides: one.overrides }, { op: 'add', draft: { kind: 'choice.moreTakes', record: 'fleet', fields: { times: 1 } } }).refused).toBe(MORE_TAKES_COPY);
    expect(writeTweak({ overrides: one.overrides }, { op: 'add', draft: { kind: 'choice.moreTakes', record: 'fleet', fields: { times: 3 } } }).refused).toBe(MORE_TAKES_COPY);
    expect(writeTweak({}, { op: 'add', draft: { kind: 'choice.moreTakes', record: 'fleet', fields: { times: 1, slotKey: '4:class:0' } } }).refused).toMatch(/has no "slotKey"/);
    expect(writeTweak({}, { op: 'add', draft: { kind: 'choice.moreTakes', record: 'fleet', fields: { times: 12 } } }).refused).toMatch(/wrong kind of value/);
    // C31: no start level
    expect(writeTweak({}, { op: 'add', draft: { kind: 'choice.moreTakes', record: 'fleet', from: 5, fields: { times: 1 } } }).refused).toMatch(/no start level/);
  });

  it('C32: no writer output holds a slot key (a SLOT_PREFIX string), whatever the kind', () => {
    let host: Host = { overrides: undefined };
    // tweaks p2 WP8 (D1): ONE "Take a feat more times" per feat — the door refuses MORE's second Fleet block (a
    // two-tab merge can still store two; it is written here only once). WP13: the built kinds only (the door refuses
    // every DEFERRED block).
    const written = BUILT.filter((raw, i) => !(raw.kind === 'choice.moreTakes' && BUILT.slice(0, i).some((o) => o.kind === raw.kind && o.record === raw.record)));
    expect(written).toHaveLength(BUILT.length - 1);
    for (const raw of written) {
      const { id: _id, kind, v: _v, reason, on, record, ...fields } = raw;
      const r = writeTweak(host, { op: 'add', draft: { kind: String(kind), ...(record ? { record: String(record) } : {}), fields, ...(reason ? { reason: String(reason) } : {}), ...(on === false ? { on: false } : {}) } });
      expect(r.refused, JSON.stringify(raw)).toBeUndefined();
      host = { overrides: r.overrides };
    }
    const strings: string[] = [];
    const walk = (x: unknown) => {
      if (typeof x === 'string') strings.push(x);
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') Object.values(x).forEach(walk);
    };
    walk(host.overrides);
    expect(strings.length).toBeGreaterThan(50);
    expect(strings.filter((s) => SLOT_PREFIX.test(s))).toEqual([]);
    expect(parseStoredBlocks(host.overrides!.blocks).known).toHaveLength(written.length);
  });

  it('writeChoiceTweak + dropChoiceTweak: remove.choicePlace written and dropped, the pick left alone (C12)', () => {
    const build = { overrides: undefined as BuildOverrides | undefined, featPicks: { '4:class:0': 'power-attack' } as Record<string, string> };
    const w = writeChoiceTweak(build, [{ kind: 'remove.choicePlace', fields: { place: 'feat', level: 4, category: 'class', ordinal: 0 } }]);
    expect(w.refused).toBeUndefined();
    expect(w.keys).toHaveLength(1);
    const d = dropChoiceTweak(w.build, w.keys[0]);
    expect(d.refused).toBeUndefined();
    expect(d.build.overrides).toBeUndefined();
    expect(d.build.featPicks).toBe(build.featPicks);
    expect(dropChoiceTweak(build, 'blocks:t1').refused).toBeTruthy();
  });

  it('choice.allowAnywayAnyPicker: choiceBlockRecordIds names every record and class, never a skill key; dropChoiceBlocks drops by them', () => {
    const ov: BuildOverrides = { blocks: ALLOW };
    const ids = choiceBlockRecordIds({ overrides: ov }).map((r) => r.id);
    expect(ids).toEqual(['ancient-elf', 'acolyte', 'sample-deity', 'sample-cause', 'champion', 'sample-spell', 'cleric-dedication']);
    const kept = dropChoiceBlocks(ov, (id) => id === 'champion' || id === 'ancient-elf')!;
    expect((kept.blocks as Raw[]).map((b) => b.id)).toEqual(ALLOW.filter((b) => b.record !== 'ancient-elf' && b.classId !== 'champion').map((b) => b.id));
    expect(dropChoiceBlocks(ov, () => false)).toBe(ov);
    // never touches v; nothing but v left is no overrides at all (B15)
    expect(dropChoiceBlocks({ blocks: [ALLOW[0]], v: 2, maxHp: 30 }, () => true)).toEqual({ v: 2, maxHp: 30 });
    expect(dropChoiceBlocks({ blocks: [ALLOW[0]], v: 2 }, () => true)).toBeUndefined();
  });
});

describe('the accessors honour on, unreadable and the Tweaks switch (C5, C6, C9)', () => {
  const ON: Host = { overrides: { blocks: ALL } };
  const SWITCHED_OFF: Host = { overrides: { blocks: ALL, v: 2 }, options: { overridesEnabled: false } };
  const SWITCHED_ON: Host = { overrides: { blocks: ALL, v: 2 }, options: { overridesEnabled: true } };
  const paused = (h: Host): Host => ({ ...h, overrides: { ...h.overrides!, blocks: ALL.map((b) => ({ ...b, on: false })) } });

  it('choice.allowAnywayAnyPicker: allowedInPicker (WP13: a stored skill-increase allow counts for nothing)', () => {
    expect(allowedInPicker(ON, 'heritage', 'ancient-elf')).toBe(true);
    expect(allowedInPicker(ON, 'heritage', 'acolyte')).toBe(false);
    expect(allowedInPicker(ON, 'subclass', 'sample-cause', { classId: 'champion' })).toBe(true);
    expect(allowedInPicker(ON, 'subclass', 'sample-cause', { classId: 'cleric' })).toBe(false);
    expect(allowedInPicker(ON, 'sanctification', 'cleric-dedication', { value: 'unholy' })).toBe(true);
    expect(allowedInPicker(ON, 'sanctification', 'cleric-dedication', { value: 'holy' })).toBe(false);
    // WP13: ON stores four skill-increase allows (TRIMMED): none is an instance, so none reaches any accessor.
    expect(liveChoiceBlocks(ON).filter((b) => b.params?.picker === 'skillIncrease')).toEqual([]);
    for (const h of [SWITCHED_OFF, paused(ON)]) expect(allowedInPicker(h, 'heritage', 'ancient-elf')).toBe(false);
    expect(allowedInPicker(SWITCHED_ON, 'heritage', 'ancient-elf')).toBe(true);
  });

  it('choice.anyList and choice.moreTakes: anyListRules and extraTakes (a paused take does not count)', () => {
    expect([...anyListRules(ON, 'toughness')].sort()).toEqual(['level', 'list', 'onlyAtLevel']);
    expect(extraTakes(ON, 'fleet')).toBe(1); // the times-2 block is paused
    expect(extraTakes(ON, 'toughness')).toBe(0);
    for (const h of [SWITCHED_OFF, paused(ON)]) {
      expect(anyListRules(h, 'toughness').size).toBe(0);
      expect(extraTakes(h, 'fleet')).toBe(0);
    }
  });

  it('choice.addPlace: livePlaces and placeLiveForKey (C8, C9: only a readable, not-live place stops a key)', () => {
    const places = livePlaces(ON);
    expect(places).toHaveLength(ADD.length);
    expect(places[1]).toMatchObject({ place: 'feat', level: 4, category: 'class', n: 483921, slotKey: '4:extraclass:483921' });
    expect(places.find((p) => p.place === 'skillIncrease' && p.level === 5)!.skill).toBe('stealth');
    expect(places.find((p) => p.place === 'boost' && p.level === 5)!.attribute).toBe('dex');
    const key = featPlaceKey(4, 'class', 483921);
    expect(placeLiveForKey(ON, key)).toBe(true);
    expect(placeLiveForKey(ON, `${key}#0`)).toBe(true);
    expect(placeLiveForKey(paused(ON), key)).toBe(false);
    expect(placeLiveForKey(paused(ON), `${key}#0`)).toBe(false);
    expect(placeLiveForKey(SWITCHED_OFF, `${key}:granted-spell`)).toBe(false);
    expect(placeLiveForKey(paused(ON), '4:class:0')).toBe(true); // a book slot
    expect(placeLiveForKey(paused(ON), '4:extraclass:777777')).toBe(true); // no block: a feat with no slot
    const foreign: Host = { overrides: { blocks: [{ id: 't1_a', kind: 'choice.addPlace', v: 1, place: 'feat', level: 4, category: 'familiar', n: 5, on: false }] } };
    expect(placeLiveForKey(foreign, '4:extrafamiliar:5')).toBe(true); // UNKNOWN ≠ EMPTY
    for (const h of [SWITCHED_OFF, paused(ON)]) expect(livePlaces(h)).toEqual([]);
  });

  it('remove.choicePlace: removedPlaces by place kind, and removedPlaceKeys through the drawn slot list', () => {
    const r = removedPlaces(ON);
    // WP13: the stored class-choice, tactic and rune removals (TRIMMED) read as a newer version's: no list of their own.
    expect(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.length]))).toEqual({ feat: 1, skillIncrease: 3, boost: 4 });
    expect([...removedPlaceKeys(ON, (lvl) => (lvl === 4 ? ['ancestry', 'class', 'class'] : []))]).toEqual(['4:class:1']);
    expect([...removedPlaceKeys(ON, () => ['ancestry'])]).toEqual([]); // not drawn: names no key
    for (const h of [SWITCHED_OFF, paused(ON)]) expect(Object.values(removedPlaces(h)).flat()).toEqual([]);
  });

  // WP13: answerFor / optionEdits (WP1's accessors for "Change an answer" and "Edit a list") left with those kinds,
  // which come after the record rebuild; their stored blocks are never instances.
  it('choice.changeAnswer and choice.editOptions: never a live block, switch on or off', () => {
    for (const h of [ON, SWITCHED_ON]) expect(liveChoiceBlocks(h).filter((b) => NOT_YET_KINDS.includes(b.kind))).toEqual([]);
    expect(liveChoiceBlocks(ON).map((b) => b.kind).every((k) => KINDS.includes(k))).toBe(true);
  });

  it('placeStatus: broken, paused, off, not reached yet, live', () => {
    const [inst] = parseStoredBlocks([ADD[0]]).known;
    expect(placeStatus({ ...ON, level: 4 }, inst)).toBe('live');
    expect(placeStatus({ ...ON, level: 3 }, inst)).toBe('notReachedYet');
    expect(placeStatus({ ...SWITCHED_OFF, level: 4 }, inst)).toBe('off');
    expect(placeStatus({ ...ON, level: 4 }, { ...inst, on: false })).toBe('paused');
    expect(placeStatus({ ...ON, level: 4 }, { ...inst, broken: 'gone' })).toBe('broken');
  });

  it('liveChoiceBlocks reads a list once and an edit is never served a stale read', () => {
    const h: Host = { overrides: { blocks: [ANY_LIST[0]] } };
    expect(anyListRules(h, 'toughness').has('list')).toBe(true);
    const r = writeTweak(h, { op: 'setOn', key: `blocks:${ANY_LIST[0].id}`, on: false });
    expect(anyListRules({ overrides: r.overrides }, 'toughness').size).toBe(0);
    expect(anyListRules(h, 'toughness').has('list')).toBe(true);
  });
});

/* WP1 independent check, findings F1-F3 (fixed after 2e53715; wp1-report.md "Check findings F1-F5"). Each it()
 * failed on 2e53715's write.ts (proved once on a temp copy, the plant removed). */
describe('the write door after the WP1 check (F1, F2, F3)', () => {
  const add = (host: Host, kind: string, fields: Raw, record?: string) => writeTweak(host, { op: 'add', draft: { kind, ...(record ? { record } : {}), fields } });

  it('F1: choice.addPlace — two extra skill-increase places or two boosts at one level are two tweaks, both written', () => {
    for (const fields of [
      { place: 'skillIncrease', level: 5 }, // owed (skill absent), twice
      { place: 'skillIncrease', level: 5, skill: 'stealth' }, // both on Stealth
      { place: 'boost', level: 5 }, // owed, twice
      { place: 'boost', level: 5, attribute: 'dex' },
    ]) {
      const one = add({}, 'choice.addPlace', fields);
      expect(one.refused, JSON.stringify(fields)).toBeUndefined();
      const two = add({ overrides: one.overrides }, 'choice.addPlace', fields);
      expect(two.refused, JSON.stringify(fields)).toBeUndefined();
      const places = livePlaces({ overrides: two.overrides, level: 5 });
      expect(places, JSON.stringify(fields)).toHaveLength(2);
      expect(new Set(places.map((p) => p.key)).size).toBe(2);
    }
  });

  it('F1: remove.choicePlace and the permissions — a second identical copy is still refused', () => {
    const rm = { place: 'skillIncrease', level: 5, lane: 'main' };
    const one = add({}, 'remove.choicePlace', rm);
    expect(one.refused).toBeUndefined();
    expect(add({ overrides: one.overrides }, 'remove.choicePlace', rm).refused).toMatch(/already listed/);
    const allow = add({}, 'choice.allowAnywayAnyPicker', { picker: 'heritage' }, 'ancient-elf');
    expect(add({ overrides: allow.overrides }, 'choice.allowAnywayAnyPicker', { picker: 'heritage' }, 'ancient-elf').refused).toMatch(/already listed/);
    // a feat place's n names its slot: a second one with the same n at the same level is two tweaks on one slot
    const feat = { place: 'feat', level: 4, category: 'class', n: 483920 };
    const first = add({}, 'choice.addPlace', feat);
    expect(first.refused).toBeUndefined();
    expect(add({ overrides: first.overrides }, 'choice.addPlace', feat).refused).toMatch(/already listed/);
  });

  // WP13: F2 ran on a skill-increase allow and a "Change an answer" (after the record rebuild now); the extra skill
  // increase's `skill` is the built answer that carries a Lore.
  it('F2: a pause and a resume write nothing but `on` — an older stored Lore answer is not re-keyed', () => {
    const sail: Raw = { id: 't1_aaaa', kind: 'choice.addPlace', v: 1, place: 'skillIncrease', level: 5, skill: 'lore:Sailing Lore' };
    const paused = writeTweak({ overrides: { blocks: [sail] } }, { op: 'setOn', key: 'blocks:t1_aaaa', on: false });
    expect(paused.refused).toBeUndefined();
    expect(JSON.stringify(paused.overrides!.blocks)).toBe(JSON.stringify([{ ...sail, on: false }]));
    const resumed = writeTweak({ overrides: paused.overrides }, { op: 'setOn', key: 'blocks:t1_aaaa', on: true });
    expect(JSON.stringify(resumed.overrides!.blocks)).toBe(JSON.stringify([sail]));
    // an edit that SETS the answer is still keyed (C27)
    const edited = writeTweak({ overrides: { blocks: [sail] } }, { op: 'update', key: 'blocks:t1_aaaa', draft: { fields: { skill: 'Sailing Lore' } } });
    expect(edited.refused).toBeUndefined();
    expect((edited.overrides!.blocks as Raw[])[0].skill).toBe('lore:sailing');
    // a reason edit leaves the answer as stored too
    const why = writeTweak({ overrides: { blocks: [sail] } }, { op: 'update', key: 'blocks:t1_aaaa', draft: { reason: 'GM' } });
    expect((why.overrides!.blocks as Raw[])[0].skill).toBe('lore:Sailing Lore');
  });

  it('F2: a stored answer the keyer refuses (a bare "lore") can be paused and resumed; setting it is refused', () => {
    const bare: Raw = { id: 't2_aaaa', kind: 'choice.addPlace', v: 1, place: 'skillIncrease', level: 5, skill: 'lore' };
    expect(parseStoredBlocks([bare]).foreign).toEqual([]);
    const paused = writeTweak({ overrides: { blocks: [bare] } }, { op: 'setOn', key: 'blocks:t2_aaaa', on: false });
    expect(paused.refused).toBeUndefined();
    expect(JSON.stringify(paused.overrides!.blocks)).toBe(JSON.stringify([{ ...bare, on: false }]));
    const resumed = writeTweak({ overrides: paused.overrides }, { op: 'setOn', key: 'blocks:t2_aaaa', on: true });
    expect(JSON.stringify(resumed.overrides!.blocks)).toBe(JSON.stringify([bare]));
    expect(writeTweak({ overrides: { blocks: [bare] } }, { op: 'update', key: 'blocks:t2_aaaa', draft: { fields: { skill: 'lore' } } }).refused).toMatch(/names no Lore subject/);
  });

  it('F3: C32 enforced at the door — a record or an answer holding a slot key is refused', () => {
    // WP13: was a "Change an answer" and an "Edit a list" (after the record rebuild); the built kinds that name a record
    // or carry an answer.
    const rec = add({}, 'choice.allowAnywayAnyPicker', { picker: 'spell' }, '4:class:0');
    expect(rec.refused).toMatch(/feat slot/);
    expect(rec.overrides).toBeUndefined();
    expect(add({}, 'choice.addPlace', { place: 'skillIncrease', level: 5, skill: '2:skill:0#1' }).refused).toMatch(/feat slot/);
    expect(add({}, 'choice.allowAnywayAnyPicker', { picker: 'sanctification', value: '6:general:0' }, 'cleric-dedication').refused).toMatch(/feat slot/);
    expect(add({}, 'choice.anyList', { rule: 'list' }, '10:class:4:granted-spell').refused).toMatch(/feat slot/);
    // a repoint to a slot key is refused as well
    const ok = add({}, 'choice.anyList', { rule: 'list' }, 'toughness');
    const key = `blocks:${(ok.overrides!.blocks as Raw[])[0].id}`;
    expect(writeTweak({ overrides: ok.overrides }, { op: 'repoint', key, record: '4:class:0' }).refused).toMatch(/feat slot/);
    // a record id that merely contains digits and colons elsewhere is fine
    expect(add({}, 'choice.anyList', { rule: 'list' }, 'feat-4:class').refused).toBeUndefined();
  });
});
