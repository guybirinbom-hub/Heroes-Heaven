import { describe, expect, it } from 'vitest';
import { jsonEqual, mergeRosterEdits, mergeValue } from '../src/data/rosterMerge';
import { addInventoryItem, emptyPlay, type PlayState } from '../src/rules/play';
import type { InventoryItem } from '../src/rules/types';

/**
 * H1 (2026-10-18): the three-way merge two tabs of one browser profile fold each other's roster writes
 * with (src/data/rosterMerge.ts). The App-level legs are test/bug-two-tabs-roster.test.tsx; this pins
 * every rule of the merge itself, and (last) fuzzes the one property the owner's rule needs: nothing
 * the local side changed is ever lost, and nothing only the incoming side changed is either.
 * MUTATION (run 2026-10-18): let a conflict always take the incoming value (`return incomingWins ||
 * Math.random() < 2 ? incoming : local;` at the end of mergeValue) — three legs fail, the fuzz first on
 * `seed 8: character.name: expected 'I8-character.name' to deeply equal 'L8-character.name'`.
 * Synthetic rosters only.
 */
type Entry = { id: string; [k: string]: unknown };
const e = (id: string, fields: Record<string, unknown> = {}): Entry => ({ id, ...fields });

describe('jsonEqual — JSON semantics', () => {
  it('treats an undefined property as absent and an undefined array slot as null', () => {
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(jsonEqual([1, undefined], [1, null])).toBe(true);
    expect(jsonEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 0 })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual(undefined, null)).toBe(false);
  });
});

describe('mergeRosterEdits — whole entries', () => {
  const base = [e('a', { hp: 10 }), e('b', { hp: 5 })];

  it('returns the LOCAL array itself when nothing changes (no undo step, no write)', () => {
    const local = base.slice();
    expect(mergeRosterEdits(base, local, base.map((c) => ({ ...c })))).toBe(local);
    const mine = [e('a', { hp: 7 }), base[1]];
    expect(mergeRosterEdits(base, mine, [{ ...mine[0] }, { ...base[1] }])).toBe(mine);
  });

  it('takes an entry only the other tab changed, as its object; keeps one only this tab changed, as ours', () => {
    const theirs = e('b', { hp: 1 });
    const mine = e('a', { hp: 9 });
    const out = mergeRosterEdits(base, [mine, base[1]], [{ ...base[0] }, theirs]);
    expect(out[0]).toBe(mine);
    expect(out[1]).toBe(theirs);
  });

  it('merges an entry BOTH changed value by value; a value both changed keeps ours', () => {
    const b0 = e('a', { hp: 10, name: 'Ayla', xp: 0 });
    const out = mergeRosterEdits([b0], [e('a', { hp: 12, name: 'Ayla', xp: 0 })], [e('a', { hp: 3, name: 'GM name', xp: 40 })]);
    expect(out[0]).toEqual({ id: 'a', hp: 12, name: 'GM name', xp: 40 });
  });

  it('yieldTo "conflicts" hands a value both changed to the other tab; "whole" takes its entry as is', () => {
    const b0 = e('a', { hp: 10, name: 'Ayla' });
    const mine = e('a', { hp: 12, name: 'Mine' });
    const theirs = e('a', { hp: 3, name: 'Ayla' });
    expect(mergeRosterEdits([b0], [mine], [theirs], { yieldTo: () => 'conflicts' })[0]).toEqual({ id: 'a', hp: 3, name: 'Mine' });
    expect(mergeRosterEdits([b0], [mine], [theirs], { yieldTo: () => 'whole' })[0]).toBe(theirs);
    // Asked only for an entry both changed.
    const asked: string[] = [];
    mergeRosterEdits([b0, e('b')], [mine, e('b', { x: 1 })], [theirs, e('b')], {
      yieldTo: (l) => {
        asked.push(l.id);
        return null;
      },
    });
    expect(asked).toEqual(['a']);
  });

  it('deleting: one side deleted and the other did not touch it → gone; deleted against a change → the change stays', () => {
    const b = [e('a', { hp: 10 }), e('b', { hp: 5 })];
    expect(mergeRosterEdits(b, b.slice(), [b[0]]).map((c) => c.id)).toEqual(['a']); // they deleted b
    expect(mergeRosterEdits(b, [b[0]], b.slice()).map((c) => c.id)).toEqual(['a']); // we deleted b
    expect(mergeRosterEdits(b, [b[0], e('b', { hp: 1 })], [b[0]]).map((c) => c.id)).toEqual(['a', 'b']); // they deleted, we changed
    expect(mergeRosterEdits(b, [b[0]], [b[0], e('b', { hp: 1 })]).find((c) => c.id === 'b')).toEqual({ id: 'b', hp: 1 }); // we deleted, they changed
  });

  it('keeps characters each side ADDED, each after the one it followed on its own side', () => {
    const b = [e('a'), e('c')];
    const out = mergeRosterEdits(b, [e('a'), e('mine'), e('c')], [e('a'), e('c'), e('theirs')]);
    expect(out.map((c) => c.id)).toEqual(['a', 'mine', 'c', 'theirs']);
  });

  it('a REORDER by this tab is kept; otherwise the other tab’s order is', () => {
    const b = [e('a'), e('b'), e('c')];
    expect(mergeRosterEdits(b, [b[2], b[0], b[1]], [b[0], b[1], b[2], e('d')]).map((c) => c.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(mergeRosterEdits(b, b.slice(), [b[1], b[0], b[2]]).map((c) => c.id)).toEqual(['b', 'a', 'c']);
  });

  it('never copies a symbol mark onto a merged entry; an untouched entry keeps its own (it is the same object)', () => {
    const MARK = Symbol('mark');
    const mine = Object.assign(e('a', { hp: 12, name: 'x' }), { [MARK]: 'm1' });
    const out = mergeRosterEdits([e('a', { hp: 10, name: 'x' })], [mine], [e('a', { hp: 10, name: 'y' })]);
    expect((out[0] as Record<symbol, unknown>)[MARK]).toBeUndefined();
    const kept = mergeRosterEdits([e('a', { hp: 10 })], [mine], [e('a', { hp: 10 })]);
    expect((kept[0] as Record<symbol, unknown>)[MARK]).toBe('m1');
  });
});

describe('mergeValue — arrays', () => {
  it('merges records by `instanceId`: a potion drunk here and a rope bought there both stay', () => {
    const base = [{ instanceId: 'p', itemId: 'potion', quantity: 3 }];
    const local = [{ instanceId: 'p', itemId: 'potion', quantity: 2 }];
    const incoming = [...base, { instanceId: 'r', itemId: 'rope', quantity: 1 }];
    expect(mergeValue(base, local, incoming)).toEqual([
      { instanceId: 'p', itemId: 'potion', quantity: 2 },
      { instanceId: 'r', itemId: 'rope', quantity: 1 },
    ]);
  });

  it('merges records by `id`: two conditions added on two sides both stay; one removed here stays removed', () => {
    const base = [{ id: 'frightened', value: 1 }, { id: 'prone' }];
    const local = [{ id: 'frightened', value: 1 }, { id: 'clumsy', value: 1 }]; // prone removed, clumsy added
    const incoming = [{ id: 'frightened', value: 2 }, { id: 'prone' }, { id: 'drained', value: 1 }];
    // Neither side reordered, so the other tab's order leads; ours, added last, goes last.
    expect(mergeValue(base, local, incoming)).toEqual([{ id: 'frightened', value: 2 }, { id: 'drained', value: 1 }, { id: 'clumsy', value: 1 }]);
  });

  it('an array of plain values, or of records with a repeated key, is ONE value: ours on a conflict', () => {
    expect(mergeValue(['a'], ['a', 'b'], ['a', 'c'])).toEqual(['a', 'b']);
    expect(mergeValue(['a'], ['a', 'b'], ['a', 'c'], true)).toEqual(['a', 'c']);
    const dup = [{ id: 'x' }, { id: 'x', v: 1 }];
    expect(mergeValue([], dup, [{ id: 'y' }])).toBe(dup);
  });
});

describe('a record ADDED on both sides (checker finding 1, 2026-10-19)', () => {
  /*
   * Inventory ids used to be numbered in sequence (`inv-${max + 1}`), so an add in each tab made two
   * different rows under ONE key and this merge mixed them into one. A player's add now mints a key no
   * other tab can (src/rules/recordIds.ts). These legs add through the real helper; on 6393b29 (run
   * 2026-10-20, `git archive` copy with this file) both fail — the rope comes out `worn` with the
   * torches gone, and the second chalk is gone.
   */
  const base = { id: 'pc', play: addInventoryItem({ ...emptyPlay(), inventory: [] }, 'healing-potion-minor') };
  const added = (itemId: string, init?: Partial<InventoryItem>) => ({ id: 'pc', play: addInventoryItem(base.play, itemId, init) });
  const rows = (c: { play: PlayState }, itemId: string) => (c.play.inventory ?? []).filter((i) => i.itemId === itemId);

  it('different content: a rope here, five worn torches there — both kept, neither mixed', () => {
    const [out] = mergeRosterEdits([base], [added('rope')], [added('torch', { quantity: 5, worn: true })]);
    expect(rows(out, 'rope')).toEqual([expect.objectContaining({ quantity: 1 })]);
    expect(rows(out, 'rope')[0].worn).toBeUndefined();
    expect(rows(out, 'torch')).toEqual([expect.objectContaining({ quantity: 5, worn: true })]);
  });

  it('IDENTICAL content: the same item bought on both sides is two purchases', () => {
    const [out] = mergeRosterEdits([base], [added('chalk')], [added('chalk')]);
    expect(rows(out, 'chalk')).toHaveLength(2);
  });

  /*
   * THE CHOICE (2026-10-20, rosterMerge.ts "ONE KEY IS ONE RECORD"): a key new on BOTH sides is a
   * DERIVED record both tabs made from the same state (the formula book, an automatic companion made
   * real) — merged into ONE, never kept twice. A player's add can no longer produce one.
   */
  it('a key new on both sides with the same content is ONE record (a derived record is never duplicated)', () => {
    const book = { instanceId: 'inv-3', itemId: 'formula-book', quantity: 1 };
    expect(mergeValue([], [{ ...book }], [{ ...book }])).toEqual([book]);
  });

  it('a key new on both sides, edited differently on each, is still ONE record: what only one side set comes from it; a value both set differently is ours', () => {
    const local = [{ instanceId: 'inv-3', itemId: 'formula-book', quantity: 1, formulas: ['x'], note: 'mine' }];
    const incoming = [{ instanceId: 'inv-3', itemId: 'formula-book', quantity: 1, invested: true, note: 'theirs' }];
    expect(mergeValue([], local, incoming)).toEqual([{ instanceId: 'inv-3', itemId: 'formula-book', quantity: 1, formulas: ['x'], invested: true, note: 'mine' }]);
  });
});

describe('ONE KEY IS ONE RECORD — the merge never splits a row by its contents (rosterMerge.ts)', () => {
  /*
   * A row whose itemId changed under one key is ONE record, merged field by field: a copy-on-write edit
   * (a `custom-…` copy repointed onto the row: InventoryTab / VitalsRail) or an alias rewrite on load is
   * an edit of the same item the other tab equipped. Rounds 1–2 of the id fix (2026-10-20) added a guard
   * here that split such a row in two (`splitItems`), to cover a builder Save handing a new item the build
   * index of the row it replaced; every checker round found a case it broke (two copies of one item, a
   * lost item, a stack split in two), so it was removed and the id REUSE fixed where ids are minted
   * (play.ts mergeRebuiltInventory; test/record-ids.test.ts). These legs pass on 6393b29 too: they pin
   * that no such guard comes back — round 2's guard turned the first into a phantom plain longsword
   * (`inA: rows: expected [ … ] to have a length of 2 but got 3`).
   */
  const both = (b: unknown[], l: unknown[], i: unknown[]) => [mergeValue(b, l, i), mergeValue(b, i, l)];

  it('copy-on-write in one tab, the row equipped in the other: ONE row — the custom copy, equipped', () => {
    const base = [{ instanceId: 'inv-0', itemId: 'longsword', quantity: 1 }, { instanceId: 'inv-1', itemId: 'rope', quantity: 1 }];
    const copied = [{ ...base[0], itemId: 'custom-longsword-k2j4h' }, base[1]];
    const equipped = [{ ...base[0], equipped: true }, base[1]];
    for (const [n, out] of (both(base, copied, equipped) as unknown[][]).entries()) {
      const tab = n ? 'inB' : 'inA';
      expect(out, `${tab}: rows`).toHaveLength(2);
      expect(out[0], tab).toEqual({ instanceId: 'inv-0', itemId: 'custom-longsword-k2j4h', quantity: 1, equipped: true });
    }
  });

  it('an alias rewrite (a removed `aon-…` id → its canonical twin) in one tab, the row invested in the other: ONE row', () => {
    const base = [{ instanceId: 'inv-4', itemId: 'aon-surprise-doll', quantity: 1 }];
    for (const out of both(base, [{ ...base[0], itemId: 'doll-surprise' }], [{ ...base[0], invested: true }])) {
      expect(out).toEqual([{ instanceId: 'inv-4', itemId: 'doll-surprise', quantity: 1, invested: true }]);
    }
  });

  it('the same built-in item edited into a copy in EACH tab: still one row (a conflict: each tab keeps its own copy until the next fold)', () => {
    const base = [{ instanceId: 'inv-0', itemId: 'longsword', quantity: 1 }];
    const a = [{ ...base[0], itemId: 'custom-longsword-aaaaa' }];
    const b = [{ ...base[0], itemId: 'custom-longsword-bbbbb', equipped: true }];
    expect(mergeValue(base, a, b)).toEqual([{ instanceId: 'inv-0', itemId: 'custom-longsword-aaaaa', quantity: 1, equipped: true }]);
    expect(mergeValue(base, b, a)).toEqual([{ instanceId: 'inv-0', itemId: 'custom-longsword-bbbbb', quantity: 1, equipped: true }]);
  });

  it('no key is invented: every merged row keeps a key one side had (a split moved rows to `inv-<item>-N`)', () => {
    const base = [{ instanceId: 'inv-1', itemId: 'rope', quantity: 1 }];
    const other = [{ instanceId: 'inv-1', itemId: 'shortbow', quantity: 1 }];
    const edited = [{ instanceId: 'inv-1', itemId: 'rope', quantity: 3 }];
    for (const out of both(base, other, edited) as Record<string, unknown>[][]) {
      expect(out.map((r) => r.instanceId)).toEqual(['inv-1']);
    }
  });
});

describe('the H1 shape', () => {
  it('the GM’s rename (applied in the other tab) and the player’s potion (queued here) both survive', () => {
    const P = e('pc', { character: { name: 'Ayla' }, play: { heroPoints: 1, inventory: [{ instanceId: 'inv-0', quantity: 3 }] } });
    const E = e('pc', { character: { name: 'Ayla' }, play: { heroPoints: 1, inventory: [{ instanceId: 'inv-0', quantity: 4 }] } });
    const G = e('pc', { character: { name: 'GM Version' }, play: { heroPoints: 1, inventory: [{ instanceId: 'inv-0', quantity: 3 }] } });
    expect(mergeRosterEdits([P], [E], [G])[0]).toEqual({
      id: 'pc',
      character: { name: 'GM Version' },
      play: { heroPoints: 1, inventory: [{ instanceId: 'inv-0', quantity: 4 }] },
    });
  });
});

/** A small seeded generator, so a failure names the case it found. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('the owner’s rule, fuzzed: nothing either side changed is lost', () => {
  it('2,000 random edits on both sides: every value only one side changed comes from that side; a value both changed is ours', () => {
    type Leaf = { path: string[]; value: unknown };
    const leaves = (o: unknown, at: string[] = []): Leaf[] =>
      o && typeof o === 'object' && !Array.isArray(o)
        ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, [...at, k]))
        : [{ path: at, value: o }];
    const get = (o: unknown, path: string[]) => path.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);
    const set = (o: Record<string, unknown>, path: string[], v: unknown) => {
      let x = o;
      for (const k of path.slice(0, -1)) x = x[k] as Record<string, unknown>;
      x[path[path.length - 1]] = v;
    };
    for (let seed = 1; seed <= 2000; seed++) {
      const r = rng(seed);
      const base = {
        id: 'c',
        character: { name: 'n', level: 1, customization: { zoom: 1, theme: 't' } },
        play: { damage: 0, heroPoints: 1, xp: 0, details: { age: '20', notes: 'x' } },
      };
      const all = leaves(base).filter((l) => l.path[0] !== 'id');
      const local = structuredClone(base) as Record<string, unknown>;
      const incoming = structuredClone(base) as Record<string, unknown>;
      const mine = new Map<string, unknown>();
      const theirs = new Map<string, unknown>();
      for (const leaf of all) {
        const key = leaf.path.join('.');
        if (r() < 0.3) {
          const v = `L${seed}-${key}`;
          set(local, leaf.path, v);
          mine.set(key, v);
        }
        if (r() < 0.3) {
          const v = r() < 0.2 && mine.has(key) ? mine.get(key) : `I${seed}-${key}`; // sometimes the same value
          set(incoming, leaf.path, v);
          theirs.set(key, v);
        }
      }
      const [out] = mergeRosterEdits([base], [local as typeof base], [incoming as typeof base]);
      for (const leaf of all) {
        const key = leaf.path.join('.');
        const want = mine.has(key) ? mine.get(key) : theirs.has(key) ? theirs.get(key) : leaf.value;
        expect(get(out, leaf.path), `seed ${seed}: ${key}`).toEqual(want);
      }
    }
  });
});
