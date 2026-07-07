import { describe, it, expect } from 'vitest';
import { mergeRoster, mergeBundles, charFingerprint } from '../src/data/cloudMerge';
import type { CloudBundle, SavedChar } from '../src/data/storage';

// Minimal SavedChar-shaped objects — the merge logic only touches `id` and overall content.
const ch = (id: string, extra: Record<string, unknown> = {}): SavedChar =>
  ({ id, character: { name: id, ...extra } } as unknown as SavedChar);

const emptyHomebrew = () => ({ items: {}, feats: {}, spells: {}, ancestries: {}, heritages: {}, backgrounds: {}, actions: {} });
const bundle = (over: Partial<CloudBundle> = {}): CloudBundle => ({
  roster: [],
  charUpdated: {},
  homebrew: emptyHomebrew() as CloudBundle['homebrew'],
  homebrewSources: {},
  modes: {},
  ...over,
});
const hp = (c: SavedChar) => (c.character as unknown as { hp: string }).hp;

describe('mergeRoster', () => {
  it('keeps characters that exist on only one side (never drops)', () => {
    const { roster } = mergeRoster([ch('a')], { a: 1 }, [ch('b')], { b: 1 });
    expect(roster.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('on a same-id conflict, the newer timestamp wins (both directions)', () => {
    const local = ch('x', { hp: 'local' });
    const cloud = ch('x', { hp: 'cloud' });
    expect(hp(mergeRoster([local], { x: 200 }, [cloud], { x: 100 }).roster[0])).toBe('local');
    expect(hp(mergeRoster([local], { x: 100 }, [cloud], { x: 200 }).roster[0])).toBe('cloud');
  });

  it('ties go to local (never lose in-progress local edits to an equal-age cloud copy)', () => {
    const { roster } = mergeRoster([ch('x', { hp: 'local' })], { x: 5 }, [ch('x', { hp: 'cloud' })], { x: 5 });
    expect(hp(roster[0])).toBe('local');
  });

  it('a missing timestamp counts as oldest (0)', () => {
    const { roster } = mergeRoster([ch('x', { hp: 'local' })], { x: 1 }, [ch('x', { hp: 'cloud' })], {});
    expect(hp(roster[0])).toBe('local'); // local ts 1 > cloud ts 0
  });

  it('merged timestamps are the max per id', () => {
    const { charUpdated } = mergeRoster([ch('x')], { x: 100 }, [ch('x')], { x: 300 });
    expect(charUpdated.x).toBe(300);
  });

  it('handles empty rosters', () => {
    expect(mergeRoster([], {}, [], {}).roster).toEqual([]);
    expect(mergeRoster([ch('a')], { a: 1 }, [], {}).roster.map((c) => c.id)).toEqual(['a']);
    expect(mergeRoster([], {}, [ch('b')], { b: 1 }).roster.map((c) => c.id)).toEqual(['b']);
  });
});

describe('mergeBundles', () => {
  it('returns local unchanged when the cloud has no row yet (null)', () => {
    const local = bundle({ roster: [ch('a')], charUpdated: { a: 1 } });
    expect(mergeBundles(local, null)).toBe(local);
  });

  it('unions homebrew content, sources, and modes (local wins key conflicts)', () => {
    const local = bundle({
      homebrew: { ...emptyHomebrew(), items: { i1: { name: 'local-i1' }, shared: { name: 'local' } } } as CloudBundle['homebrew'],
      homebrewSources: { s1: { id: 's1', name: 'S1' } },
      modes: { m1: { id: 'm1' } } as CloudBundle['modes'],
    });
    const cloud = bundle({
      homebrew: { ...emptyHomebrew(), items: { i2: { name: 'cloud-i2' }, shared: { name: 'cloud' } } } as CloudBundle['homebrew'],
      homebrewSources: { s2: { id: 's2', name: 'S2' } },
      modes: { m2: { id: 'm2' } } as CloudBundle['modes'],
    });
    const m = mergeBundles(local, cloud);
    expect(Object.keys(m.homebrew.items).sort()).toEqual(['i1', 'i2', 'shared']);
    expect((m.homebrew.items.shared as { name: string }).name).toBe('local');
    expect(Object.keys(m.homebrewSources).sort()).toEqual(['s1', 's2']);
    expect(Object.keys(m.modes).sort()).toEqual(['m1', 'm2']);
  });

  it('merges rosters across bundles by id + timestamp', () => {
    const local = bundle({ roster: [ch('a', { v: 'L' })], charUpdated: { a: 50 } });
    const cloud = bundle({ roster: [ch('a', { v: 'C' }), ch('b')], charUpdated: { a: 10, b: 5 } });
    const m = mergeBundles(local, cloud);
    expect(m.roster.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect((m.roster.find((c) => c.id === 'a')!.character as unknown as { v: string }).v).toBe('L');
    expect(m.charUpdated).toEqual({ a: 50, b: 5 });
  });

  it('tolerates bundles missing optional maps', () => {
    const local = bundle({ roster: [ch('a')], charUpdated: { a: 1 } });
    const cloud = { roster: [ch('b')], charUpdated: { b: 1 } } as CloudBundle; // no homebrew/sources/modes
    const m = mergeBundles(local, cloud);
    expect(m.roster.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(m.homebrew.items).toEqual({});
    expect(m.modes).toEqual({});
  });
});

describe('charFingerprint', () => {
  it('is stable for identical content and changes when content changes', () => {
    expect(charFingerprint(ch('x', { hp: 1 }))).toBe(charFingerprint(ch('x', { hp: 1 })));
    expect(charFingerprint(ch('x', { hp: 1 }))).not.toBe(charFingerprint(ch('x', { hp: 2 })));
  });
});
