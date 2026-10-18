import { describe, expect, it } from 'vitest';
import { jsonEqual, mergeRosterEdits, mergeValue } from '../src/data/rosterMerge';

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
