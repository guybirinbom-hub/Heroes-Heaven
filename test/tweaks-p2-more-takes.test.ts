/*
 * Tweaks phase 2, WP8 — "Take a feat more times" (`choice.moreTakes {record, times 1-9}`; plan
 * work/tweaks-phase2-notes/plan.md WP8, C5, C9, C23, C28, C29, C36; the orchestrator's decisions D1-D4 in state.md
 * "## WP8 + WP9 chat"). Synthetic characters only. The Builder's "Take again", the slot card words and the Tweaks page
 * are test/tweaks-p2-more-takes-ui.test.tsx.
 *
 * Pinned here:
 *   - Fleet twice = book + 10 ft (one Fleet = + 5), read on the DERIVED sheet speed (derive.ts), never the stored
 *     character; paused = + 5 with both picks byte for byte; Tweaks off = + 5; `times: 2` allows a third copy;
 *   - the three `takesAllowed` gates agree: the featPicks loop, `slotRefusal`'s cap (so the picker and `fitsSlot`) and
 *     `slotKept` (a second Natural Ambition hands over its feat AND that feat's answer; paused, both drop);
 *   - the app never lowers `times` (a copy removed: the block byte-equal, "1 more allowed, 0 used");
 *   - the write door: one block per feat (D1) — a second add is refused, a `times` edit on a two-tab duplicate saves;
 *   - the Builder names the SAME copy the engine drops (read off the character, the loop's own order);
 *   - "Take again" plans one block (new, or `times` raised), never offered on a paused block;
 *   - the count's floor counts a paused extra place's copy (the storage view);
 *   - measured: a second copy's OWN answer (keyed by its slot) counts (Canny Acumen's Fortitude); a once-only feat's
 *     SPELL answer (keyed by the feat id) is shared, and the row says so (Minor Deific Power; fixes round 1); so are its
 *     skill choice, cantrip choice, bonus skill feat and other choices (Natural Skill, Arcane Tattoos, Magical Knowledge,
 *     Magical Resistance; fixes round 3), while a slot-keyed Lore is its own (Different Worlds).
 */
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { extraTakes, featPlaceKey } from '../src/rules/blocks/active';
import { blockKind, STILL_TO_ADD } from '../src/rules/blocks/registry';
import { parseStoredBlocks } from '../src/rules/blocks/stored';
import { MORE_TAKES_COPY, writeChoiceTweak, writeTweak } from '../src/rules/blocks/write';
import { maxTakes, takesAllowed } from '../src/rules/featGrants';
import { TAKEN_WORDS, eligibleFeatsForSlot, featCopiesHeld, fitsSlot, slotRefusal, withFeat } from '../src/rules/featSlots';
import { deriveDefenses, deriveSave, deriveSpeeds } from '../src/rules/derive';
import { secondCopySharedQuestions, sharedAnswerWords, tweakRows, tweaksTurnOffList } from '../src/builder/tweaks/model';
import { extraCopiesHeld } from '../src/builder/tweaks/ChoiceEditor';
import { moreTakesSlotMarks, takeAgainPlan } from '../src/builder/tweaks/moreTakes';
import { heldFeatSlots } from '../src/rules/heldFeats';
import type { BuildOverrides, Character, Feat } from '../src/rules/types';

const db = content();
let seq = 0;
const nextId = (tag: string) => `t${++seq}_${tag}${String(seq).padStart(2, '0')}`;
/** One `choice.moreTakes` block (`on: false` = paused). */
const more = (record: string, times = 1, on = true) => ({ id: nextId('wp8mt'), kind: 'choice.moreTakes', v: 1, record, times, ...(on ? {} : { on: false }) });
const placeBlock = (level: number, category: string, n: number, on = true) => ({ id: nextId('wp8pl'), kind: 'choice.addPlace', v: 1, place: 'feat', level, category, n, ...(on ? {} : { on: false }) });
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const pause = (b: BuildState): BuildState => ({ ...b, overrides: ov(...((b.overrides?.blocks ?? []) as object[]).map((x) => ({ ...x, on: false }))) });
const built = (b: BuildState): Character => buildCharacter(b, contentFor(db, b));
const land = (b: BuildState) => deriveSpeeds(built(b), db).land;
const slot = (level: number, category: string, idx = 0) => ({ level, category: category as Feat['category'], idx });

function hero(classId: string, level: number, overrides?: BuildOverrides, more_: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  const b = {
    ...emptyBuild(),
    name: 'WP8 more-takes fixture',
    level,
    classId,
    keyAbility: cls.keyAbility[0] as BuildState['keyAbility'],
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    options: { overridesEnabled: true },
    ...more_,
    ...(overrides ? { overrides } : {}),
  } as BuildState;
  return JSON.parse(JSON.stringify(b)) as BuildState;
}
/** A level-7 fighter holding Fleet in the 3rd-level general slot, and in the 7th too when `twice`. */
const fleet = (twice: boolean, ...blocks: object[]) =>
  hero('fighter', 7, ov(...blocks), { featPicks: { '3:general:0': 'fleet', ...(twice ? { '7:general:0': 'fleet' } : {}) } });
const fleetRows = (b: BuildState) => built(b).feats.filter((f) => f.featId === 'fleet').map((f) => f.slotKey);

describe('Fleet more times: the derived sheet speed', () => {
  const book = land(hero('fighter', 7));
  it('one Fleet = book + 5; Fleet twice with "1 more time" = book + 10', () => {
    expect(maxTakes(db.feats.fleet), 'Fleet is a once-only feat').toBe(1);
    expect(land(fleet(false))).toBe(book + 5);
    expect(land(fleet(true)), 'no tweak: the book drops the second copy').toBe(book + 5);
    expect(land(fleet(true, more('fleet')))).toBe(book + 10);
    expect(fleetRows(fleet(true, more('fleet')))).toEqual(['3:general:0', '7:general:0']);
  });
  it('paused = book + 5, both picks byte for byte (a pause writes nothing); Tweaks off = book + 5', () => {
    const live = fleet(true, more('fleet'));
    const paused = pause(live);
    expect(land(paused)).toBe(book + 5);
    expect(JSON.stringify(paused.featPicks)).toBe(JSON.stringify(live.featPicks));
    expect(fleetRows(paused), 'the engine drops the second copy exactly as the book does').toEqual(['3:general:0']);
    expect(land(off(live))).toBe(book + 5);
    expect(JSON.stringify(off(live).featPicks)).toBe(JSON.stringify(live.featPicks));
  });
  it('"2 more times" allows a third copy; "1 more time" still drops it', () => {
    const three = (times: number) => hero('fighter', 11, ov(more('fleet', times)), { featPicks: { '3:general:0': 'fleet', '7:general:0': 'fleet', '11:general:0': 'fleet' } });
    const book11 = land(hero('fighter', 11));
    expect(land(three(2))).toBe(book11 + 15);
    expect(land(three(1))).toBe(book11 + 10);
    expect(fleetRows(three(1))).toEqual(['3:general:0', '7:general:0']);
  });
});

describe('the three takesAllowed gates agree', () => {
  it('takesAllowed = the book + every live block; paused / off / another feat add nothing; unlimited stays unlimited', () => {
    expect(takesAllowed('fleet', db, fleet(false, more('fleet')))).toBe(2);
    expect(takesAllowed('fleet', db, fleet(false, more('fleet', 1, false)))).toBe(1);
    expect(takesAllowed('fleet', db, off(fleet(false, more('fleet'))))).toBe(1);
    expect(takesAllowed('fleet', db, fleet(false, more('toughness')))).toBe(1);
    const unlimited = Object.values(db.feats).find((f) => f.maxTakable === null)!;
    expect(takesAllowed(unlimited.id, db, fleet(false, more(unlimited.id)))).toBe(Infinity);
  });
  it('the picker and fitsSlot: a second general slot takes Fleet only while the block is live', () => {
    const takes = (b: BuildState) => eligibleFeatsForSlot(b, db, slot(7, 'general')).some((f) => f.id === 'fleet');
    expect(takes(fleet(false)), 'book: Already taken').toBe(false);
    expect(slotRefusal(fleet(false), db, slot(7, 'general'))(db.feats.fleet)).toEqual([{ rule: 'taken', words: TAKEN_WORDS, liftable: false }]);
    expect(takes(fleet(false, more('fleet')))).toBe(true);
    expect(takes(fleet(false, more('fleet', 1, false)))).toBe(false);
    expect(takes(off(fleet(false, more('fleet'))))).toBe(false);
    expect(fitsSlot(fleet(true, more('fleet')), db, '7:general:0', '7:general:0')).toBe(true);
    expect(fitsSlot(fleet(true, more('fleet')), db, '3:general:0', '3:general:0')).toBe(true);
    expect(fitsSlot(fleet(true), db, '7:general:0', '7:general:0'), 'book: the duplicate is not valid').toBe(false);
  });
  it('a second copy of a non-repeatable pick-a-feat granter (the moretakes-granter spec) picks its feat; paused, it drops', () => {
    const a1 = '1:ancestry:0';
    const a5 = '5:ancestry:0';
    const g = (...blocks: object[]) => hero('fighter', 5, ov(...blocks), { featPicks: { [a1]: 'natural-ambition', [a5]: 'natural-ambition' }, pickFeatChoices: { [a1]: 'sudden-charge', [a5]: 'double-slice' } });
    const rows = (b: BuildState) => built(b).feats.filter((f) => f.grantedBy === 'natural-ambition').map((f) => [f.featId, f.grantedBySlot]);
    expect(rows(g(more('natural-ambition')))).toEqual([['sudden-charge', a1], ['double-slice', a5]]);
    expect(rows(pause(g(more('natural-ambition'))))).toEqual([['sudden-charge', a1]]);
    expect(rows(g())).toEqual([['sudden-charge', a1]]);
  });
  it("…and the granted feat's answer keys (slotKept): a second Basic Witchcraft's Basic Lesson teaches its lesson's hex; paused, the feat and the hex drop", () => {
    const w = (...blocks: object[]) =>
      hero('fighter', 6, ov(...blocks), {
        featPicks: { '2:class:0': 'witch-dedication', '4:class:0': 'basic-witchcraft', '6:class:0': 'basic-witchcraft' },
        pickFeatChoices: { '4:class:0': 'witchs-armaments', '6:class:0': 'basic-lesson' },
        grantedFeatChoices: { 'basic-lesson': 'aon-lesson-of-dreams' },
      });
    expect(maxTakes(db.feats['basic-witchcraft'])).toBe(1);
    const hexes = (c: Character) => (c.spellcasting ?? []).filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat());
    const live = built(w(more('basic-witchcraft')));
    expect(live.feats.find((f) => f.featId === 'basic-lesson')?.choice?.value).toBe('aon-lesson-of-dreams');
    expect(hexes(live), "the lesson's hex: its answer key is read through slotKept").toContain('veil-of-dreams');
    for (const b of [pause(w(more('basic-witchcraft'))), off(w(more('basic-witchcraft'))), w()]) {
      const c = built(b);
      expect(c.feats.some((f) => f.featId === 'basic-lesson')).toBe(false);
      expect(hexes(c)).not.toContain('veil-of-dreams');
    }
  });
  it("…and the granted feat's ANSWER: a warpriest's second Natural Ambition picks Domain Initiate (fire) — its row and focus spell; paused, the character is the book's", () => {
    const cleric = (...blocks: object[]) =>
      hero('cleric', 5, ov(...blocks), {
        subclassId: 'warpriest',
        deityId: 'sarenrae',
        featPicks: { '1:ancestry:0': 'natural-ambition', '5:ancestry:0': 'natural-ambition' },
        pickFeatChoices: { '1:ancestry:0': 'reach-spell', '5:ancestry:0': 'domain-initiate' },
        grantedFeatChoices: { 'domain-initiate': 'fire' },
      });
    const live = built(cleric(more('natural-ambition')));
    const book = built(cleric());
    const di = live.feats.find((f) => f.featId === 'domain-initiate');
    expect(di?.choice, "the granted feat's answer is read").toEqual({ value: 'fire', label: 'Fire' });
    expect(book.feats.some((f) => f.featId === 'domain-initiate')).toBe(false);
    // Measured (wp8-report.md, open item): the focus spell of that pick (Fire Ray) is on the BOOK character too — the
    // focus pass reads `pickFeatChoices` raw, so a dropped duplicate granter's pick already leaks it today. Not WP8's.
    const focus = (c: Character) => JSON.stringify(c.spellcasting?.find((e) => e.type === 'focus') ?? null);
    expect(focus(live)).toContain('fire-ray');
    const paused = built(pause(cleric(more('natural-ambition'))));
    expect(paused.feats).toEqual(book.feats);
    expect(paused.spellcasting).toEqual(book.spellcasting);
  });
});

/* WP8 round 4 (F1, the final checker): buildCharacter's given-feat loop is a FOURTH take gate that C23 missed — it
 * dropped a given feat already taken, so "Take again" over a feat given through Tweaks did nothing. It now skips a
 * taken given feat only while no live moreTakes block leaves room (`givenCopyCounts`); heldFeatSlots' given-feat
 * dedupe reads the same rule, so the Builder (the picker, the Tweaks row) and the sheet agree. */
describe('a feat GIVEN through Tweaks, then taken again (the given-feat gate, F1)', () => {
  const GIVEN = [{ featId: 'fleet', level: 1, category: 'general' }];
  const given = (picks: Record<string, string>, ...blocks: object[]) =>
    hero('fighter', 7, { ...ov(...blocks), addedFeats: GIVEN } as unknown as BuildOverrides, { featPicks: picks });
  const book = land(hero('fighter', 7));
  const fleetKeys = (b: BuildState) => fleetRows(b).sort();
  const heldKeys = (b: BuildState) => heldFeatSlots(b).filter((e) => e.featId === 'fleet').map((e) => e.slotKey);
  it('given Fleet + "Take again" in a general slot: book + 10 on the derived sheet, both copies listed, the Builder agrees', () => {
    const start = given({});
    expect(land(start), 'the given Fleet alone').toBe(book + 5);
    expect(slotRefusal(start, db, slot(7, 'general'))(db.feats.fleet), 'the given copy takes the cap').toEqual([{ rule: 'taken', words: TAKEN_WORDS, liftable: false }]);
    const plan = takeAgainPlan(start, db, 'fleet', '7:general:0');
    expect(plan).toMatchObject({ times: 1, raised: false });
    if ('refused' in plan) throw new Error(plan.refused);
    const w = writeChoiceTweak(start, [plan.draft], (x) => withFeat(x, '7:general:0', 'fleet'));
    expect(w.refused).toBeUndefined();
    const b = w.build;
    expect(land(b), 'two Fleets').toBe(book + 10);
    expect(fleetKeys(b), 'both copies on the character').toEqual(['7:general:0', 'override:fleet']);
    expect(heldKeys(b), 'heldFeatSlots holds both (the same rule)').toEqual(['7:general:0', 'override:fleet']);
    expect(featCopiesHeld(b, db, 'fleet')).toBe(2);
    expect(fitsSlot(b, db, '7:general:0', '7:general:0'), 'the slot copy fits').toBe(true);
    const row = tweakRows(b, built(b), contentFor(db, b)).find((r) => r.kind === 'choice.moreTakes')!;
    expect(row.what).toBe('Fleet — may be taken 1 more time (taken 2 of 2)');
    expect(row.chips.map((c) => c.kind), 'never "Not needed now: 1 more allowed, 0 used"').not.toContain('notNeededNow');
    // The same through the Tweaks page: the block added first, then the pick.
    const viaPage = withFeat(given({}, more('fleet')), '7:general:0', 'fleet');
    expect(land(viaPage)).toBe(book + 10);
    expect(fleetKeys(viaPage)).toEqual(['7:general:0', 'override:fleet']);
  });
  it("paused = book + 5 (today's dedupe: the slot copy counts, the given one is dropped); Tweaks off the same", () => {
    // (Paused through `given`, never `pause()`: that one rebuilds the overrides and would drop `addedFeats`.)
    const paused = given({ '7:general:0': 'fleet' }, more('fleet', 1, false));
    for (const b of [paused, off(given({ '7:general:0': 'fleet' }, more('fleet')))]) {
      expect(b.overrides?.addedFeats, 'the given feat is stored').toEqual(GIVEN);
      expect(land(b)).toBe(book + 5);
      expect(fleetKeys(b)).toEqual(['7:general:0']);
      expect(heldKeys(b)).toEqual(['7:general:0']);
    }
  });
  it('a live block that is full (two slot copies + "1 more time"): the given copy is dropped, as the featPicks loop caps', () => {
    const b = given({ '3:general:0': 'fleet', '7:general:0': 'fleet' }, more('fleet'));
    expect(land(b)).toBe(book + 10);
    expect(fleetKeys(b)).toEqual(['3:general:0', '7:general:0']);
    expect(heldKeys(b)).toEqual(['3:general:0', '7:general:0']);
  });
  it('no block: today exactly — the character deep-equals the one with the block paused (both read the book dedupe)', () => {
    const none = given({ '3:general:0': 'toughness', '7:general:0': 'fleet' });
    const paused = given({ '3:general:0': 'toughness', '7:general:0': 'fleet' }, more('fleet', 1, false));
    expect(fleetKeys(none)).toEqual(['7:general:0']);
    expect(heldFeatSlots(none, undefined, { via: ['override'] }), 'the given copy is not held').toEqual([]);
    const strip = (c: Character) => ({ ...c, overrides: undefined });
    expect(strip(built(none))).toEqual(strip(built(paused)));
    // A block for ANOTHER feat leaves Fleet's dedupe alone.
    expect(fleetKeys(given({ '7:general:0': 'fleet' }, more('toughness')))).toEqual(['7:general:0']);
  });
});

describe('the app never lowers times (C36); the Tweaks row', () => {
  const rowOf = (b: BuildState) => tweakRows(b, built(b), contentFor(db, b)).find((r) => r.kind === 'choice.moreTakes')!;
  it('both copies: "Fleet — may be taken 1 more time (taken 2 of 2)", no "Not needed now"', () => {
    const r = rowOf(fleet(true, more('fleet')));
    expect(r.what).toBe('Fleet — may be taken 1 more time (taken 2 of 2)');
    expect(r.chips.map((c) => c.kind)).not.toContain('notNeededNow');
  });
  it('a copy removed: the block byte for byte, the row "1 more allowed, 0 used"', () => {
    const b = fleet(true, more('fleet'));
    const before = JSON.stringify(b.overrides);
    const removed = withFeat(b, '7:general:0', null);
    expect(JSON.stringify(removed.overrides)).toBe(before);
    // A rebuild is a load, never an edit: the stored block is the same object, never rewritten.
    built(removed);
    expect(JSON.stringify(removed.overrides)).toBe(before);
    const r = rowOf(removed);
    expect(r.what).toBe('Fleet — may be taken 1 more time (taken 1 of 2)');
    expect(r.chips).toContainEqual({ kind: 'notNeededNow', text: 'Not needed now: 1 more allowed, 0 used' });
  });
  it('paused: the row says what the book allows now; Fleet gone from the character: Not in use; gone from the data: Broken', () => {
    expect(rowOf(fleet(true, more('fleet', 1, false))).what).toBe('Fleet — may be taken 1 more time (taken 2 of 1)');
    expect(rowOf(hero('fighter', 7, ov(more('fleet')))).chips.map((c) => c.text)).toContain('Not in use: not on your character');
    const gone = rowOf(hero('fighter', 7, ov(more('no-such-feat-wp8'))));
    expect(gone.broken).toBeTruthy();
  });
  it('the switch-off confirm lists it under "Stops counting"', () => {
    const b = fleet(true, more('fleet'));
    expect(tweaksTurnOffList(b, contentFor(db, b), built(b)).choices.stops).toContain('Fleet — may be taken 1 more time (taken 2 of 2)');
  });
});

describe('the write door: ONE moreTakes block per feat (D1)', () => {
  it('a second add for the same feat is refused; another feat is fine', () => {
    const b = fleet(true, more('fleet'));
    const r = writeTweak(b, { op: 'add', draft: { kind: 'choice.moreTakes', record: 'fleet', fields: { times: 2 } } });
    expect(r.refused).toBe(MORE_TAKES_COPY);
    expect(writeTweak(b, { op: 'add', draft: { kind: 'choice.moreTakes', record: 'toughness', fields: { times: 1 } } }).refused).toBeUndefined();
  });
  it('a times edit on either block of a two-tab duplicate saves; the two sum in extraTakes; a record edit onto a held feat is refused', () => {
    const a = more('fleet', 1);
    const c = more('fleet', 2);
    const b = fleet(true, a, c);
    expect(extraTakes(b, 'fleet')).toBe(3);
    const r1 = writeTweak(b, { op: 'update', key: `blocks:${c.id}`, draft: { fields: { times: 1 } } });
    expect(r1.refused).toBeUndefined();
    const r2 = writeTweak(b, { op: 'update', key: `blocks:${a.id}`, draft: { fields: { times: 4 } } });
    expect(r2.refused).toBeUndefined();
    const t = more('toughness', 1);
    const b2 = fleet(true, a, t);
    expect(writeTweak(b2, { op: 'update', key: `blocks:${t.id}`, draft: { record: 'fleet' } }).refused).toBe(MORE_TAKES_COPY);
  });
});

describe('"Take again" (D4) plans ONE block', () => {
  it('no block: a new {record, times: 1}; a live block: its times raised, the same key; written with the pick in one write', () => {
    const b = fleet(false);
    const p = takeAgainPlan(b, db, 'fleet', '7:general:0');
    expect(p).toEqual({ draft: { kind: 'choice.moreTakes', record: 'fleet', fields: { times: 1 } }, times: 1, raised: false });
    const w = writeChoiceTweak(b, [(p as { draft: never }).draft], (x) => withFeat(x, '7:general:0', 'fleet'));
    expect(w.refused).toBeUndefined();
    expect(w.build.featPicks['7:general:0']).toBe('fleet');
    expect(parseStoredBlocks(w.build.overrides?.blocks).known.map((k) => [k.kind, k.record, k.params?.times])).toEqual([['choice.moreTakes', 'fleet', 1]]);
    // the third copy: times raised on that one block
    const blk = more('fleet', 1);
    const b11 = hero('fighter', 11, ov(blk), { featPicks: { '3:general:0': 'fleet', '7:general:0': 'fleet' } });
    const p2 = takeAgainPlan(b11, db, 'fleet', '11:general:0');
    expect(p2).toEqual({ draft: { key: `blocks:${blk.id}`, kind: 'choice.moreTakes', fields: { times: 2 } }, times: 2, raised: true });
    const w2 = writeChoiceTweak(b11, [(p2 as { draft: never }).draft], (x) => withFeat(x, '11:general:0', 'fleet'));
    const stored = parseStoredBlocks(w2.build.overrides?.blocks).known;
    expect(stored).toHaveLength(1);
    expect(stored[0].params?.times).toBe(2);
    expect(land(w2.build)).toBe(land(hero('fighter', 11)) + 15);
  });
  it('never on a paused block (the player turns it on instead); a copy held back only by a paused extra place has its own words', () => {
    const p = takeAgainPlan(fleet(false, more('fleet', 1, false)), db, 'fleet', '7:general:0');
    expect('refused' in p && p.refused).toContain('paused');
    const key = featPlaceKey(5, 'general', 483980);
    const b = hero('fighter', 7, ov(placeBlock(5, 'general', 483980, false)), { featPicks: { [key]: 'fleet' } });
    const words = slotRefusal(b, db, slot(7, 'general'))(db.feats.fleet).map((r) => r.words);
    expect(words).toHaveLength(1);
    expect(words[0], 'the paused-place words, never the plain "Already taken" Take again is offered on').not.toBe(TAKEN_WORDS);
    expect(words[0]).toContain('paused extra place');
  });
  it('a copy in a paused extra place still takes a cap place: the plan asks for enough times that resuming it breaks nothing', () => {
    const key = featPlaceKey(5, 'general', 483981);
    const b = hero('fighter', 11, ov(placeBlock(5, 'general', 483981, false)), { featPicks: { '3:general:0': 'fleet', [key]: 'fleet' } });
    const p = takeAgainPlan(b, db, 'fleet', '7:general:0');
    expect('times' in p && p.times).toBe(2);
  });
});

describe('the Builder names the copy the engine drops (read off the character, never guessed)', () => {
  it('featPicks in the 7-then-3 order: the engine keeps 7 and drops 3; paused, the mark is on 3; live, the extra copy is 3', () => {
    const reversed = (blk: object) => hero('fighter', 7, ov(blk), { featPicks: { '7:general:0': 'fleet', '3:general:0': 'fleet' } });
    const paused = reversed(more('fleet', 1, false));
    const ch = built(paused);
    expect(ch.feats.filter((f) => f.featId === 'fleet').map((f) => f.slotKey), 'the loop runs in featPicks order').toEqual(['7:general:0']);
    expect([...moreTakesSlotMarks(paused, contentFor(db, paused), ch)].map(([k, m]) => [k, m.state])).toEqual([['3:general:0', 'paused']]);
    const live = reversed(more('fleet'));
    expect([...moreTakesSlotMarks(live, contentFor(db, live), built(live))].map(([k, m]) => [k, m.state])).toEqual([['3:general:0', 'live']]);
    const natural = fleet(true, more('fleet', 1, false));
    expect([...moreTakesSlotMarks(natural, contentFor(db, natural), built(natural))].map(([k]) => k)).toEqual(['7:general:0']);
  });
  it('Tweaks off, or no tweak at all: no mark', () => {
    const b = off(fleet(true, more('fleet')));
    expect(moreTakesSlotMarks(b, contentFor(db, b), built(b)).size).toBe(0);
    const none = fleet(true);
    expect(moreTakesSlotMarks(none, contentFor(db, none), built(none)).size).toBe(0);
  });
});

describe('the count never goes below the copies used (the one counter)', () => {
  it("the floor counts slot copies and a paused extra place's copy (the storage view)", () => {
    const key = featPlaceKey(5, 'general', 483982);
    const b = hero('fighter', 11, ov(more('fleet', 2), placeBlock(5, 'general', 483982, false)), { featPicks: { '3:general:0': 'fleet', '7:general:0': 'fleet', [key]: 'fleet' } });
    expect(featCopiesHeld(b, db, 'fleet')).toBe(3);
    expect(extraCopiesHeld(b, db, 'fleet')).toBe(2);
    expect(extraCopiesHeld(fleet(false, more('fleet')), db, 'fleet'), 'never below 1 (times is 1-9)').toBe(1);
  });
});

describe("measured: a second copy's OWN answer counts", () => {
  it("Canny Acumen twice (Perception, then Fortitude) on a 7th-level wizard: Fortitude becomes expert only with the tweak", () => {
    const w = (...blocks: object[]) =>
      hero('wizard', 7, ov(...blocks), { featPicks: { '3:general:0': 'canny-acumen', '7:general:0': 'canny-acumen' }, featChoices: { '3:general:0': 'perception', '7:general:0': 'fortitude' } });
    expect(maxTakes(db.feats['canny-acumen'])).toBe(1);
    const fort = (b: BuildState) => built(b).proficiencies.saves.fortitude;
    expect(fort(w())).toBe('trained');
    expect(fort(w(more('canny-acumen')))).toBe('expert');
    expect(fort(pause(w(more('canny-acumen'))))).toBe('trained');
    expect(deriveSave(built(w(more('canny-acumen'))), 'fortitude', db).modifier, 'the derived save rises with the rank').toBe(deriveSave(built(w()), 'fortitude', db).modifier + 2);
  });

  // WP8 fixes round 1 (checker finding 2): a once-only feat whose question picks a SPELL keeps that answer under the
  // feat id (`effectChoices['minor-deific-power:cantrip']`), so the second copy shares it and adds no spell; the row
  // says so (model.ts `secondCopySharesSpellChoice`). 24 such feats today (Minor Magic, Spell Runes, …).
  it("Minor Deific Power twice (a live block): the second copy shares the first copy's spells, and its row says so", () => {
    const m = (...blocks: object[]) =>
      hero('fighter', 6, ov(...blocks), {
        featPicks: { '1:class:1': 'sudden-charge', '2:class:0': 'starstone-aspirant-dedication', '4:class:0': 'minor-deific-power', '6:class:0': 'minor-deific-power' },
        effectChoices: { 'minor-deific-power:cantrip': 'guidance', 'minor-deific-power:rank-1': 'heal', '6:class:0:cantrip': 'light', '6:class:0:rank-1': 'bless' },
      });
    expect(maxTakes(db.feats['minor-deific-power'])).toBe(1);
    const once = built({ ...m(), featPicks: { ...m().featPicks, '6:class:0': '' } });
    const live = built(m(more('minor-deific-power')));
    expect(live.feats.filter((f) => f.featId === 'minor-deific-power').map((f) => f.slotKey), 'both copies count').toEqual(['4:class:0', '6:class:0']);
    expect(live.spellcasting, 'no second spell: the slot-keyed answers are never read for a once-only feat').toEqual(once.spellcasting);
    expect(JSON.stringify(live.spellcasting)).toContain('guidance');
    expect(JSON.stringify(live.spellcasting)).not.toContain('"light"');
    expect(rowOf(m(more('minor-deific-power'))).chips).toContainEqual({ kind: 'notAppliedNow', text: sharedAnswerWords(['spell choice']) });
    expect(rowOf(fleet(true, more('fleet'))).chips.map((c) => c.kind), 'Fleet has no question').not.toContain('notAppliedNow');
    expect(rowOf(hero('wizard', 7, ov(more('canny-acumen')), { featPicks: { '3:general:0': 'canny-acumen', '7:general:0': 'canny-acumen' }, featChoices: { '3:general:0': 'perception', '7:general:0': 'fortitude' } })).chips.map((c) => c.kind), "Canny Acumen's answer is its own").not.toContain('notAppliedNow');
    expect(secondCopySharedQuestions('minor-magic', db.feats['minor-magic'])).toContain('spell choice');
    expect(secondCopySharedQuestions('fleet', db.feats.fleet)).toEqual([]);
  });

  /* WP8 fixes round 3 (the orchestrator's item 1): every OTHER store a grant reads under the feat id, measured with the
   * real buildCharacter (and deriveDefenses where the answer shows on the sheet), one real once-only feat each. Each
   * case: two copies with a live block; `same` = what the second copy adds over one copy (nothing), even with a
   * slot-keyed answer stored for it, which no reader reads; and the row names the shared question in one sentence. */
  const twice = (featId: string, level: number, slots: [string, string], more_: Partial<BuildState>, second?: Partial<BuildState>) => {
    const b = (two: boolean, extra: Partial<BuildState> = {}) =>
      hero('fighter', level, two ? ov(more(featId)) : undefined, { ...more_, ...extra, featPicks: { [slots[0]]: featId, ...(two ? { [slots[1]]: featId } : {}) } });
    return { one: built(b(false)), two: built(b(true, second)), build: b(true, second) };
  };
  const chipsOf = (b: BuildState) => rowOf(b).chips.filter((c) => c.kind === 'notAppliedNow').map((c) => c.text);
  it('featSkillChoices (`<feat>:<i>`): Natural Skill twice trains no new skill; the row names its skill choice', () => {
    const t = twice('natural-skill', 5, ['1:ancestry:0', '5:ancestry:0'], { featSkillChoices: { 'natural-skill:0': 'arcana', 'natural-skill:1': 'crafting' } }, {
      featSkillChoices: { 'natural-skill:0': 'arcana', 'natural-skill:1': 'crafting', ['5:ancestry:0:0' as string]: 'nature' } as BuildState['featSkillChoices'],
    });
    expect(t.two.feats.filter((f) => f.featId === 'natural-skill')).toHaveLength(2);
    expect(t.two.proficiencies.skills, 'shared: the second copy adds no skill').toEqual(t.one.proficiencies.skills);
    expect(chipsOf(t.build)).toEqual([sharedAnswerWords(['skill choice'])]);
    expect(sharedAnswerWords(['skill choice'])).toBe("Not applied now: a second copy shares the first copy's skill choice — it adds no answer of its own");
  });
  it('pickCantripChoices (`<feat>`): Arcane Tattoos twice gives no second cantrip; the row names its cantrip choice', () => {
    const t = twice('arcane-tattoos', 5, ['1:ancestry:0', '5:ancestry:0'], { pickCantripChoices: { 'arcane-tattoos': 'shield' } }, { pickCantripChoices: { 'arcane-tattoos': 'shield', '5:ancestry:0': 'daze' } });
    expect(t.two.feats.filter((f) => f.featId === 'arcane-tattoos')).toHaveLength(2);
    expect(t.two.spellcasting, 'shared: one cantrip').toEqual(t.one.spellcasting);
    expect(JSON.stringify(t.two.spellcasting)).toContain('"shield"');
    expect(chipsOf(t.build)).toEqual([sharedAnswerWords(['cantrip choice'])]);
  });
  it("dedicationSkillFeats (`bonusSkillFeatKey(<feat>, i)`): Magical Knowledge twice adds no skill feat; its skill choice is shared too (the printed 'master if already expert' raises the SAME skill)", () => {
    const t = twice('magical-knowledge', 10, ['8:class:0', '10:class:0'], {
      featSkillChoices: { 'magical-knowledge:0': 'arcana', 'magical-knowledge:1': 'nature' },
      dedicationSkillFeats: { 'magical-knowledge': 'quick-identification', 'magical-knowledge:1': 'natural-medicine' },
    });
    const others = (c: Character) => c.feats.map((f) => f.featId).filter((id) => id !== 'magical-knowledge').sort();
    expect(t.two.feats.filter((f) => f.featId === 'magical-knowledge')).toHaveLength(2);
    expect(others(t.two), 'shared: no new skill feat').toEqual(others(t.one));
    expect(others(t.one)).toEqual(expect.arrayContaining(['natural-medicine', 'quick-identification']));
    const s = (c: Character) => c.proficiencies.skills as Record<string, string>;
    expect([s(t.one).arcana, s(t.two).arcana, s(t.two).nature]).toEqual(['expert', 'master', 'expert']);
    expect(chipsOf(t.build)).toEqual([sharedAnswerWords(['skill choice', 'bonus skill feat'])]);
    expect(sharedAnswerWords(['skill choice', 'bonus skill feat'])).toContain("the first copy's skill choice and bonus skill feat —");
  });
  it('effectChoices without a spell (`<feat>:<choice>`): Magical Resistance twice keeps one resistance on the derived sheet; the row names its choice', () => {
    const t = twice('magical-resistance', 9, ['5:ancestry:0', '9:ancestry:0'], { ancestryId: 'automaton', heritageId: 'warrior-automaton', effectChoices: { 'magical-resistance:energy-type': 'cold' } }, {
      effectChoices: { 'magical-resistance:energy-type': 'cold', '9:ancestry:0:energy-type': 'sonic' },
    });
    expect(t.two.feats.filter((f) => f.featId === 'magical-resistance')).toHaveLength(2);
    expect(deriveDefenses(t.two, db).resistances, 'shared: no sonic').toEqual(deriveDefenses(t.one, db).resistances);
    expect(deriveDefenses(t.two, db).resistances).toEqual([expect.objectContaining({ type: 'cold', value: 5 })]);
    expect(chipsOf(t.build)).toEqual([sharedAnswerWords(['choice'])]);
  });
  it("featLoreChoices under the SLOT (what the Builder writes): Different Worlds' second Lore counts, so no chip", () => {
    const t = twice('different-worlds', 7, ['3:general:0', '7:general:0'], { featLoreChoices: { '3:general:0:0': 'Sailing', '7:general:0:0': 'Warfare' } });
    const lores = (c: Character) => Object.keys(c.proficiencies.skills).filter((k) => k.startsWith('lore:'));
    expect(lores(t.one)).not.toContain('lore:warfare');
    expect(lores(t.two), "the second copy's own Lore").toContain('lore:warfare');
    expect(chipsOf(t.build)).toEqual([]);
    expect(secondCopySharedQuestions('different-worlds', db.feats['different-worlds'])).toEqual([]);
  });
});
const rowOf = (b: BuildState) => tweakRows(b, built(b), contentFor(db, b)).find((r) => r.kind === 'choice.moreTakes')!;

describe('registry: choice.moreTakes is built', () => {
  it('built and applied; no STILL_TO_ADD line', () => {
    expect(blockKind('choice.moreTakes')?.editor?.built).toBe(true);
    expect(blockKind('choice.moreTakes')?.applies).toBe('blocks');
    expect(blockKind('choice.moreTakes')?.test).toBe('test/tweaks-p2-more-takes.test.ts');
    expect(STILL_TO_ADD.some((s) => s.id === 'choice.moreTakes')).toBe(false);
  });
});
