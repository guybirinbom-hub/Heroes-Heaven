import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
import { applyBackfill } from '../scripts/lib/apply-backfill.mjs';
import { loadBaseline } from '../scripts/lib/embedded-descriptions.mjs';
import { chainValue, loadCreated, replayChanges, replayOverlay, unbakedRows } from '../scripts/lib/overlay-replay.mjs';

/**
 * scripts/lib/overlay-replay.mjs — the replay scripts/apply-backfill-now.mjs runs, and its proof.
 *
 * Package C, 2026-10-17. A whole replay of scripts/data/effect-backfill.json dropped the class-option links the
 * data chain adds after the overlay (classes/champion Blessed Armament + Blessed Shield, classes/animist
 * Lamentation of Sinister Deals 15 -> 11 links), because it skipped the chain's class-option sync — and the
 * parity-batch driver ran that replay after every spec. Each half of the fix is pinned here: the replay runs
 * the sync (so it leaves settled data alone), and `replayChanges` flags a replay that changes a record whose
 * rows were all already shipped — checked on a planted lossy replay, on a fixture and on today's real data.
 */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });

type Ref = { key: string; label: string };
type Row = Record<string, unknown> & { category: string; id: string };
type Db = Record<string, Record<string, any>>;

const REFS: Ref[] = [{ key: 'items', label: 'Fearsome' }, { key: 'items', label: 'Returning' }];
/** The whole-list row, as the champion's: the option restates the record's text but none of its links. */
const listRow: Row = {
  category: 'classes', id: 'paladin-like', field: 'extraChoices',
  value: [{ id: 'blessing', options: [{ id: 'blessed-arms', name: 'Blessed Arms', description: 'Your weapon gains a rune.' }] }],
};
const featRow: Row = { category: 'feats', id: 'quick-feat', field: 'level', value: 2 };

/** The artefacts as `npm run data` leaves them for these rows: the option carries the record's links. */
function shipped(): { core: Db; descs: Db } {
  return {
    core: {
      classes: { 'paladin-like': { name: 'Paladin-like', extraChoices: [{ id: 'blessing', options: [
        { id: 'blessed-arms', name: 'Blessed Arms', description: 'Your weapon gains a rune.', descRefs: REFS },
      ] }] } },
      classFeatures: { 'blessed-arms': { name: 'Blessed Arms' } },
      feats: { 'quick-feat': { name: 'Quick Feat', level: 2 }, 'other-feat': { name: 'Other Feat', level: 4 } },
    },
    descs: { classFeatures: { 'blessed-arms': { d: 'Your weapon gains a rune.', r: REFS } } },
  };
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** The replay as it was before package C: the overlay applier and nothing after it (on a copy of the rows,
 *  so the fixtures stay as written). */
function oldReplay(core: Db, rows: Row[]) {
  applyBackfill(core, clone(rows), { skipFields: ['description', 'descRefs'] });
}

it('replayOverlay never edits the rows it is given', () => {
  const rows = [listRow, featRow];
  const before = JSON.stringify(rows);
  const { core, descs } = shipped();
  replayOverlay(core, descs, rows);
  expect(JSON.stringify(rows)).toBe(before);
});

describe('replayOverlay leaves settled data alone', () => {
  it('a whole replay keeps the links the chain added to a whole-list row\'s options', () => {
    const before = shipped();
    const after = clone(before);
    const res = replayOverlay(after.core, after.descs, [listRow, featRow]);
    expect(after.core).toEqual(before.core);
    expect(after.descs).toEqual(before.descs);
    expect(res.sync.linked).toEqual(['paladin-like/blessed-arms']);
  });

  it('PLANTED: the old replay drops those links, and replayChanges names the record and the field', () => {
    const before = shipped();
    const after = clone(before);
    oldReplay(after.core, [listRow, featRow]);
    expect(after.core.classes['paladin-like'].extraChoices[0].options[0].descRefs).toBeUndefined();
    const { changes, pending } = replayChanges({
      coreBefore: before.core, descsBefore: before.descs, coreAfter: after.core, descsAfter: after.descs, rows: [listRow, featRow],
    });
    expect(pending).toEqual([]);
    expect(changes.map((c) => c.key)).toEqual(['classes/paladin-like']);
    expect(changes[0].diffs[0]).toMatchObject({ at: '/extraChoices/id=blessing/options/id=blessed-arms/descRefs', kind: 'removed' });
  });

  it('a change to a settled record that no row explains is flagged; the rest of the data is not', () => {
    const before = shipped();
    const after = clone(before);
    replayOverlay(after.core, after.descs, [listRow, featRow]);
    after.core.feats['other-feat'].level = 6;
    const { changes } = replayChanges({
      coreBefore: before.core, descsBefore: before.descs, coreAfter: after.core, descsAfter: after.descs, rows: [listRow, featRow],
    });
    expect(changes.map((c) => c.key)).toEqual(['feats/other-feat']);
  });
});

describe('a pending row may change its own record', () => {
  it('a new value on a field row is applied and explained', () => {
    const before = shipped();
    const after = clone(before);
    const rows = [listRow, { ...featRow, value: 3 }];
    replayOverlay(after.core, after.descs, rows);
    expect(after.core.feats['quick-feat'].level).toBe(3);
    const { changes, pending } = replayChanges({
      coreBefore: before.core, descsBefore: before.descs, coreAfter: after.core, descsAfter: after.descs, rows,
    });
    expect(pending).toEqual(['feats/quick-feat']);
    expect(changes).toEqual([]);
  });

  it('new record prose reaches the class option through the sync, and that change is explained', () => {
    const before = shipped();
    const after = clone(before);
    const prose: Row = { category: 'classFeatures', id: 'blessed-arms', field: 'description', value: 'Your weapon gains a fundamental rune.' };
    const rows = [listRow, featRow, prose];
    const res = replayOverlay(after.core, after.descs, rows);
    expect(res.prose).toBe(1);
    expect(after.descs.classFeatures['blessed-arms'].d).toBe('Your weapon gains a fundamental rune.');
    expect(after.core.classes['paladin-like'].extraChoices[0].options[0].description).toBe('Your weapon gains a fundamental rune.');
    const { changes } = replayChanges({
      coreBefore: before.core, descsBefore: before.descs, coreAfter: after.core, descsAfter: after.descs, rows,
    });
    expect(changes).toEqual([]);
  });

  it('--only replays just the named records', () => {
    const before = shipped();
    const after = clone(before);
    const rows = [listRow, { ...featRow, value: 3 }];
    replayOverlay(after.core, after.descs, rows, { only: new Set(['classes/paladin-like']) });
    expect(after.core.feats['quick-feat'].level).toBe(2);
    expect(after.core).toEqual(before.core);
  });
});

describe('unbakedRows (one rule with scripts/regen-durability-check.mjs)', () => {
  it('reads a whole-list row through the class-option sync, so the shipped links do not make it "unbaked"', () => {
    const { core, descs } = shipped();
    expect(unbakedRows(core, descs, [listRow, featRow]).stale).toEqual([]);
  });

  it('create, delete and value:null rows; a pathless row a later path row amends is excused', () => {
    const { core, descs } = shipped();
    /* What the chain makes of the last two rows: the whole `choice`, then its note amended. */
    core.feats['other-feat'].choice = { note: 'new' };
    const rows: Row[] = [
      { category: 'feats', id: 'new-feat', create: true, value: { name: 'New Feat' } },
      { category: 'feats', id: 'other-feat', delete: true },
      { category: 'feats', id: 'quick-feat', field: 'level', value: null },
      { category: 'feats', id: 'other-feat', field: 'choice', value: { note: 'old' } },
      { category: 'feats', id: 'other-feat', field: 'note', path: ['choice'], value: 'new' },
    ];
    expect(unbakedRows(core, descs, rows).stale.map((s) => s.label)).toEqual([
      'feats/new-feat (created record absent)',
      'feats/other-feat (deleted record present)',
      'feats/quick-feat.level',
    ]);
    core.feats['other-feat'].choice = { note: 'older' };
    expect(unbakedRows(core, descs, rows).stale.map((s) => s.label)).toContain('feats/other-feat.note');
  });
});

/*
 * The package C refuters' cases (2026-10-17). Each was a state the first draft got wrong: a refusal of a normal
 * batch step, a change the chain makes that the replay skipped, or a loss the check excused.
 */
describe('the refuters\' cases', () => {
  const replayAndCheck = (before: { core: Db; descs: Db }, rows: Row[], created: unknown = null) => {
    const after = clone(before);
    const res = replayOverlay(after.core, after.descs, rows, { created });
    const { changes, pending } = replayChanges({
      coreBefore: before.core, descsBefore: before.descs, coreAfter: after.core, descsAfter: after.descs, rows, created,
    });
    return { after, res, changes, pending };
  };

  it('a created record gets its prose in a LATER replay (the created-prose spec), and nothing is refused', () => {
    const create: Row = { category: 'classFeatures', id: 'new-feature', create: true, value: { name: 'New Feature', level: 3 } };
    const first = replayAndCheck(shipped(), [listRow, featRow, create]);
    expect(first.changes).toEqual([]);
    expect(first.after.core.classFeatures['new-feature']).toEqual({ name: 'New Feature', level: 3 });
    const text: Row = { category: 'classFeatures', id: 'new-feature', field: 'description', value: 'It does a new thing.' };
    const second = replayAndCheck(first.after, [listRow, featRow, create, text]);
    expect(second.pending).toEqual(['classFeatures/new-feature']);
    expect(second.changes).toEqual([]);
    expect(second.after.descs.classFeatures['new-feature']).toEqual({ d: 'It does a new thing.' });
    expect(unbakedRows(second.after.core, second.after.descs, [listRow, featRow, create, text]).stale).toEqual([]);
  });

  it('a description row for an existing record with no descriptions entry is written, not refused', () => {
    const rows = [listRow, featRow, { category: 'feats', id: 'other-feat', field: 'description', value: 'Restored text.' }];
    const { changes, after } = replayAndCheck(shipped(), rows);
    expect(changes).toEqual([]);
    expect(after.descs.feats['other-feat']).toEqual({ d: 'Restored text.' });
  });

  it('a create row carries its prose to the descriptions file; a delete row takes the record\'s prose with it', () => {
    const before = shipped();
    before.descs.feats = { 'other-feat': { d: 'Old text.' } };
    const rows: Row[] = [
      listRow, featRow,
      { category: 'feats', id: 'made-feat', create: true, value: { name: 'Made Feat', description: 'Made text.', descRefs: REFS } },
      { category: 'feats', id: 'other-feat', delete: true },
    ];
    const { changes, after } = replayAndCheck(before, rows);
    expect(changes).toEqual([]);
    expect(after.core.feats['made-feat']).toEqual({ name: 'Made Feat' });
    expect(after.descs.feats['made-feat']).toEqual({ d: 'Made text.', r: REFS });
    expect(after.core.feats['other-feat']).toBeUndefined();
    expect(after.descs.feats['other-feat']).toBeUndefined();
    expect(unbakedRows(after.core, after.descs, rows).stale).toEqual([]);
    expect(unbakedRows(after.core, { ...after.descs, feats: { ...after.descs.feats, 'other-feat': { d: 'x' } } }, rows).stale.map((s) => s.label))
      .toEqual(['feats/other-feat (deleted record present)']);
  });

  it('a whole value and a path row amending it, replayed together, are written and not refused', () => {
    const rows: Row[] = [
      listRow, featRow,
      { category: 'feats', id: 'quick-feat', field: 'choice', value: { note: 'one', a: 1 } },
      { category: 'feats', id: 'quick-feat', field: 'note', path: ['choice'], value: 'two' },
    ];
    const { changes, after } = replayAndCheck(shipped(), rows);
    expect(changes).toEqual([]);
    expect(after.core.feats['quick-feat'].choice).toEqual({ note: 'two', a: 1 });
    expect(unbakedRows(after.core, after.descs, rows).stale).toEqual([]);
  });

  it('a whole-list row that leaves out a created class option: the replay puts it back, as the chain does', () => {
    const before = shipped();
    before.core.classFeatures['twin-arms'] = { name: 'Twin Arms' };
    before.descs.classFeatures['twin-arms'] = { d: 'Two weapons gain runes.', r: [{ key: 'items', label: 'Shifting' }] };
    before.core.classes['paladin-like'].extraChoices[0].options.push(
      { id: 'twin-arms', name: 'Twin Arms', description: 'Two weapons gain runes.', descRefs: [{ key: 'items', label: 'Shifting' }] },
    );
    const created = { classFeatures: { 'twin-arms': { classId: 'paladin-like', groupId: 'blessing' } } };
    const { changes, after, res } = replayAndCheck(before, [listRow, featRow], created);
    expect(changes).toEqual([]);
    expect(res.appended).toBe(1);
    expect(after.core).toEqual(before.core);
    expect(unbakedRows(after.core, after.descs, [listRow, featRow], { created }).stale).toEqual([]);
  });

  it('a counters row keeps the printed-Frequency counter the chain adds beside it', () => {
    const before = shipped();
    const freq = { id: 'freq', label: 'per day', max: 1, per: 'day', resetsOnRest: true };
    before.core.items = { 'winged-boots': { name: 'Winged Boots', counters: [freq] } };
    before.descs.items = { 'winged-boots': { d: '**Frequency** once per day; **Effect** You fly.' } };
    const charges = { id: 'charges', label: 'Charges', max: 3 };
    const rows: Row[] = [listRow, featRow, { category: 'items', id: 'winged-boots', field: 'counters', value: [charges] }];
    const { changes, after } = replayAndCheck(before, rows);
    expect(changes).toEqual([]);
    expect(after.core.items['winged-boots'].counters.map((c: { id: string }) => c.id)).toEqual(['charges', 'freq']);
    expect(after.core.items['winged-boots'].description).toBeUndefined();
    expect(unbakedRows(after.core, after.descs, rows).stale).toEqual([]);
  });

  it('new item text that prints a Frequency gets its counter, as in the chain, and the replay is not refused', () => {
    const before = shipped();
    before.core.items = { 'plain-plate': { name: 'Plain Plate' } };
    const rows: Row[] = [listRow, featRow, { category: 'items', id: 'plain-plate', field: 'description', value: '**Frequency** once per day; **Effect** You brace.' }];
    const { changes, after } = replayAndCheck(before, rows);
    expect(changes).toEqual([]);
    expect(after.core.items['plain-plate'].counters.map((c: { id: string; per: string }) => `${c.id}/${c.per}`)).toEqual(['freq/day']);
  });

  it('PLANTED: a lossy replay is still caught on a record that ALSO has a pending row on another field', () => {
    const before = shipped();
    const rows: Row[] = [listRow, featRow, { category: 'classes', id: 'paladin-like', field: 'hp', value: 10 }];
    const after = clone(before);
    oldReplay(after.core, rows);
    const { changes, pending } = replayChanges({
      coreBefore: before.core, descsBefore: before.descs, coreAfter: after.core, descsAfter: after.descs, rows,
    });
    expect(pending).toEqual(['classes/paladin-like']);
    expect(changes.map((c) => c.key)).toEqual(['classes/paladin-like']);
    expect(changes[0].diffs[0].at).toBe('/extraChoices/id=blessing/options/id=blessed-arms/descRefs');
  });

  it('chainValue (the batch post-check\'s expectation) is the row with the record links the sync adds', () => {
    const { core, descs } = shipped();
    expect(chainValue([listRow], 0, { core, descs })).toEqual(core.classes['paladin-like'].extraChoices);
  });
});

describe("today's shipped data", () => {
  const ROOT = path.join(__dirname, '..');
  const text = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/^﻿/, '');
  const coreText = text('public/core.json');
  const descsText = text('public/core-descriptions.json');
  const rows = JSON.parse(text('scripts/data/effect-backfill.json')) as Row[];
  const keep = new Set(loadBaseline(ROOT).keys());
  const created = loadCreated(ROOT);

  it('a whole replay changes no settled record, and the old replay is caught on exactly the records the sync repairs', () => {
    const fixed = { core: JSON.parse(coreText), descs: JSON.parse(descsText) };
    const res = replayOverlay(fixed.core, fixed.descs, rows, { keep, created });
    const fixedChanges = replayChanges({
      coreBefore: JSON.parse(coreText), descsBefore: JSON.parse(descsText), coreAfter: fixed.core, descsAfter: fixed.descs, rows, keep, created,
    }).changes;
    expect(fixedChanges.map((c) => c.key)).toEqual([]);

    const old = { core: JSON.parse(coreText), descs: JSON.parse(descsText) };
    oldReplay(old.core, rows);
    const oldChanges = replayChanges({
      coreBefore: JSON.parse(coreText), descsBefore: JSON.parse(descsText), coreAfter: old.core, descsAfter: old.descs, rows, keep, created,
    }).changes;
    const repaired = [...new Set(res.sync.linked.map((k: string) => `classes/${k.split('/')[0]}`))].sort();
    expect(oldChanges.map((c) => c.key).sort()).toEqual(repaired);
    for (const c of oldChanges) for (const d of c.diffs) expect(d.at).toMatch(/\/descRefs$/);
  });
});
