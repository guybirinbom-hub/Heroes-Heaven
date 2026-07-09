import { describe, it, expect } from 'vitest';
import { mergeRoster, mergeBundles, charFingerprint } from '../src/data/cloudMerge';
import { TOMBSTONE_TTL_MS, type CloudBundle, type SavedChar } from '../src/data/storage';

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

  it('takes settings from whichever side changed them more recently (ties → local)', () => {
    const localNewer = mergeBundles(
      bundle({ settings: { prefs: { a: 'L' } }, settingsUpdated: 200 }),
      bundle({ settings: { prefs: { a: 'C' } }, settingsUpdated: 100 }),
    );
    expect((localNewer.settings!.prefs as { a: string }).a).toBe('L');
    expect(localNewer.settingsUpdated).toBe(200);

    const cloudNewer = mergeBundles(
      bundle({ settings: { prefs: { a: 'L' } }, settingsUpdated: 100 }),
      bundle({ settings: { prefs: { a: 'C' } }, settingsUpdated: 200 }),
    );
    expect((cloudNewer.settings!.prefs as { a: string }).a).toBe('C');

    const tie = mergeBundles(
      bundle({ settings: { prefs: { a: 'L' } }, settingsUpdated: 5 }),
      bundle({ settings: { prefs: { a: 'C' } }, settingsUpdated: 5 }),
    );
    expect((tie.settings!.prefs as { a: string }).a).toBe('L');
  });

  it('merges the customization default on its OWN timestamp, independent of settings', () => {
    // A theme/prefs change on the cloud side is NEWER, but the LOCAL side has the newer customization edit.
    // The whole-blob settings LWW must NOT drag the stale cloud customization over the fresh local one.
    const m = mergeBundles(
      bundle({ settings: { appearance: { t: 'L' } }, settingsUpdated: 100, customization: { c: 'L' }, customizationUpdated: 200 }),
      bundle({ settings: { appearance: { t: 'C' } }, settingsUpdated: 300, customization: { c: 'C' }, customizationUpdated: 50 }),
    );
    expect((m.settings!.appearance as { t: string }).t).toBe('C'); // cloud settings won (300 > 100)
    expect((m.customization as { c: string }).c).toBe('L'); // but local customization won (200 > 50)
    expect(m.customizationUpdated).toBe(200);
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

describe('deletion tombstones', () => {
  it('mergeRoster drops a cloud-only character whose deletion is newer than its timestamp', () => {
    // Cloud still has 'b' (ts 10); this device deleted it at 50 → it must not be resurrected.
    const { roster } = mergeRoster([ch('a')], { a: 1 }, [ch('a'), ch('b')], { a: 1, b: 10 }, { 'char:b': 50 });
    expect(roster.map((c) => c.id)).toEqual(['a']);
  });

  it('mergeRoster keeps a character edited AFTER it was deleted (edit-after-delete wins)', () => {
    // Another device re-edited 'b' at ts 80, newer than the delete at 50 → survives.
    const { roster } = mergeRoster([], {}, [ch('b')], { b: 80 }, { 'char:b': 50 });
    expect(roster.map((c) => c.id)).toEqual(['b']);
  });

  it('mergeBundles drops deleted homebrew items, sources, modes, and campaigns from the union', () => {
    const now = 1_000_000_000_000;
    const t = now - 1000; // recent → within the retention window
    const local = bundle({
      homebrew: { ...emptyHomebrew(), items: { keep: { name: 'keep' } } } as CloudBundle['homebrew'],
      homebrewSources: {},
      modes: {},
      campaigns: [{ id: 'c-keep', code: 'K', role: 'gm', name: 'Keep' }] as CloudBundle['campaigns'],
      // Everything below was deleted on THIS device; the cloud copy must not bring it back.
      deleted: { 'hb:items:gone': t, 'hbsrc:s-gone': t, 'mode:m-gone': t, 'camp:c-gone': t },
    });
    const cloud = bundle({
      homebrew: { ...emptyHomebrew(), items: { gone: { name: 'gone' } } } as CloudBundle['homebrew'],
      homebrewSources: { 's-gone': { id: 's-gone', name: 'S' } },
      modes: { 'm-gone': { id: 'm-gone' } } as CloudBundle['modes'],
      campaigns: [{ id: 'c-gone', code: 'G', role: 'player', name: 'Gone' }] as CloudBundle['campaigns'],
    });
    const m = mergeBundles(local, cloud, now);
    expect(Object.keys(m.homebrew.items)).toEqual(['keep']);
    expect(m.homebrewSources).toEqual({});
    expect(m.modes).toEqual({});
    expect(m.campaigns!.map((c) => c.id)).toEqual(['c-keep']);
    expect(m.deleted).toMatchObject({ 'hb:items:gone': t, 'camp:c-gone': t });
  });

  it('mergeBundles unions tombstones across sides (newest wins) and carries them forward', () => {
    const now = 1_000_000_000_000;
    const local = bundle({ deleted: { k: now - 200, only_local: now - 500 } });
    const cloud = bundle({ deleted: { k: now - 100, only_cloud: now - 700 } });
    const m = mergeBundles(local, cloud, now);
    expect(m.deleted).toEqual({ k: now - 100, only_local: now - 500, only_cloud: now - 700 });
  });

  it('mergeBundles prunes tombstones past the retention window (and stops dropping)', () => {
    const now = 1_000_000_000_000;
    const local = bundle({ deleted: { 'char:old': now - TOMBSTONE_TTL_MS - 1 } });
    const cloud = bundle({ roster: [ch('old')], charUpdated: { old: 1 } });
    const m = mergeBundles(local, cloud, now);
    expect(m.deleted).toEqual({}); // expired → pruned
    expect(m.roster.map((c) => c.id)).toEqual(['old']); // no longer suppressed
  });

  it('a re-created keyed record beats a stale tombstone another device still holds', () => {
    const now = 1_000_000_000_000;
    // Device2 STILL holds the old tombstone locally (deleted at T1); the record was re-created on the
    // other device (cloud has the item + a revive stamp at T2 > T1, cloud.deleted cleared). It must
    // survive — a bare local tombstone-clear would not propagate, so the revive stamp is what saves it.
    const local = bundle({ deleted: { 'mode:m1': now - 1000 }, revived: {} }); // T1 = now-1000
    const cloud = bundle({
      modes: { m1: { id: 'm1' } } as CloudBundle['modes'],
      revived: { 'mode:m1': now - 500 }, // T2 = now-500 (re-created after the delete)
    });
    const m = mergeBundles(local, cloud, now);
    expect(Object.keys(m.modes)).toEqual(['m1']); // revived after the delete → kept
  });

  it('a tombstone newer than the revive still wins (delete after re-create)', () => {
    const now = 1_000_000_000_000;
    const local = bundle({ deleted: { 'mode:m1': now - 100 } }); // deleted at now-100
    const cloud = bundle({
      modes: { m1: { id: 'm1' } } as CloudBundle['modes'],
      revived: { 'mode:m1': now - 900 }, // created earlier at now-900
    });
    const m = mergeBundles(local, cloud, now);
    expect(m.modes).toEqual({}); // delete is newer than the create → dropped
  });
});

describe('charFingerprint', () => {
  it('is stable for identical content and changes when content changes', () => {
    expect(charFingerprint(ch('x', { hp: 1 }))).toBe(charFingerprint(ch('x', { hp: 1 })));
    expect(charFingerprint(ch('x', { hp: 1 }))).not.toBe(charFingerprint(ch('x', { hp: 2 })));
  });
});
