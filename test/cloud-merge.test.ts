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

  it('unions homebrew content, sources, and modes (with no stamps on either side, local wins key conflicts)', () => {
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

  it('a player membership a merged character is still in outlives its tombstone; a GM one and an unheld one do not', () => {
    // A checker's finding, 2026-10-21: another device removed a campaign no character there was in (App's
    // launch cleanup) while this device, offline, put a character in it. MUTATION: drop the
    // `heldCampaigns.has(m.id)` term from mergeBundles' campaigns filter and this fails — the character
    // kept the campaign but the account lost the membership (the card showed "Campaign").
    const now = 1_000_000_000_000;
    const joinedHere = now - 5000;
    const removedThere = now - 1000; // newer than the join
    // c1 also holds the GM's deleted table: a GM's membership never outlives its tombstone (MUTATION: drop
    // `m.role === 'player' &&` from the filter and this fails).
    const local = bundle({
      roster: [ch('c1', { campaignIds: ['x-held', 'x-gm'] }), { ...ch('c2'), build: { campaignIds: ['x-build'] } } as unknown as SavedChar],
      charUpdated: { c1: joinedHere, c2: joinedHere },
      campaigns: [
        { id: 'x-held', code: 'H', role: 'player', name: 'Held' },
        { id: 'x-build', code: 'B', role: 'player', name: 'Held by a build' },
        { id: 'x-gone', code: 'U', role: 'player', name: 'Unheld' },
        { id: 'x-gm', code: 'G', role: 'gm', name: 'My deleted table' },
      ] as CloudBundle['campaigns'],
      revived: { 'camp:x-held': joinedHere },
    });
    const cloud = bundle({
      campaigns: [],
      deleted: { 'camp:x-held': removedThere, 'camp:x-build': removedThere, 'camp:x-gone': removedThere, 'camp:x-gm': removedThere },
    });
    const m = mergeBundles(local, cloud, now);
    expect(m.campaigns!.map((c) => c.id)).toEqual(['x-held', 'x-build']);
    // The other way round (this device removed it, the character arrives from the cloud) keeps it too.
    const back = mergeBundles(bundle({ deleted: cloud.deleted }), local, now);
    expect(back.campaigns!.map((c) => c.id)).toEqual(['x-held', 'x-build']);
  });

  it('a real Leave stays a Leave: an OLDER copy of the character still in the campaign does not hold it', () => {
    // The held set is the MERGED roster's, after the newest copy of each character won. MUTATION: build it
    // from local.roster and cloud.roster both and this fails — every last-character Leave came back from the
    // account's other device.
    const now = 1_000_000_000_000;
    const leftHere = bundle({
      roster: [ch('c1', { campaignIds: [] })],
      charUpdated: { c1: now - 1000 },
      campaigns: [],
      deleted: { 'camp:x': now - 1000 },
    });
    const olderThere = bundle({
      roster: [ch('c1', { campaignIds: ['x'] })],
      charUpdated: { c1: now - 9000 },
      campaigns: [{ id: 'x', code: 'X', role: 'player', name: 'Left' }] as CloudBundle['campaigns'],
      revived: { 'camp:x': now - 9000 },
    });
    expect(mergeBundles(leftHere, olderThere, now).campaigns).toEqual([]);
    expect(mergeBundles(olderThere, leftHere, now).campaigns).toEqual([]);
  });

  it('a campaign its GM deleted stays deleted, even as a "player" copy a character still holds', () => {
    // A checker's finding, 2026-10-21: an older install stored the GM's own campaign as 'player'; he deleted
    // it (CampaignsPage records `campdel:<id>`) while his characters still held it. MUTATION: drop the
    // `campdel:` term from mergeBundles' campaigns filter and this fails — the deleted campaign came back.
    const now = 1_000_000_000_000;
    const deletedHere = bundle({ roster: [ch('c1', { campaignIds: ['x'] })], charUpdated: { c1: now - 9000 }, campaigns: [], deleted: { 'camp:x': now - 1000, 'campdel:x': now - 1000 } });
    const staleCopy = bundle({ campaigns: [{ id: 'x', code: 'X', role: 'player', name: 'My deleted table' }] as CloudBundle['campaigns'] });
    expect(mergeBundles(deletedHere, staleCopy, now).campaigns).toEqual([]);
    expect(mergeBundles(staleCopy, deletedHere, now).campaigns).toEqual([]);
  });

  it('a campaign its GM deleted stays deleted against a NEWER revive stamp, whatever the role', () => {
    // A checker's finding, 2026-10-21: a join typed offline, or an older app version that stamped every
    // membership on every save, writes `camp:<id>` revive stamps after the delete. MUTATION: test
    // `campdel:` only inside the held-player rule and this fails — the deleted campaign came back as 'gm'.
    const now = 1_000_000_000_000;
    const deletedHere = bundle({ campaigns: [], deleted: { 'camp:x': now - 5000, 'campdel:x': now - 5000 } });
    const olderDevice = bundle({
      campaigns: [{ id: 'x', code: 'X', role: 'gm', name: 'My deleted table' }] as CloudBundle['campaigns'],
      revived: { 'camp:x': now - 1000 },
    });
    expect(mergeBundles(deletedHere, olderDevice, now).campaigns).toEqual([]);
    expect(mergeBundles(olderDevice, deletedHere, now).campaigns).toEqual([]);
  });

  it('a campaign its GM deleted leaves every character in the merge — keeping the newer edit and its time', () => {
    // A checker's finding, 2026-10-21: the deleting device took the campaign off its own copies, but another
    // of the GM's devices edited a character offline (or saved a Builder open on it); its newer copy won and
    // put a nameless "Campaign" back everywhere. Stamping the strip as an edit instead lost that edit.
    // MUTATION: return `merged.roster` unstripped in mergeBundles and this fails.
    const now = 1_000_000_000_000;
    const withBuild = (id: string, ids: string[], extra: Record<string, unknown>) =>
      ({ ...ch(id, { campaignIds: ids, ...extra }), build: { campaignIds: ids } }) as unknown as SavedChar;
    const offlineEdit = bundle({
      roster: [withBuild('c1', ['x', 'keep'], { hp: 'edited offline' }), ch('c2', { campaignIds: ['keep'] })],
      charUpdated: { c1: now - 1000, c2: now - 9000 },
    });
    const deletedThere = bundle({
      roster: [withBuild('c1', ['keep'], { hp: 'old' }), ch('c2', { campaignIds: ['keep'] })],
      charUpdated: { c1: now - 5000, c2: now - 9000 },
      deleted: { 'camp:x': now - 5000, 'campdel:x': now - 5000 },
    });
    for (const m of [mergeBundles(offlineEdit, deletedThere, now), mergeBundles(deletedThere, offlineEdit, now)]) {
      const c1 = m.roster.find((c) => c.id === 'c1')!;
      expect(hp(c1), 'the newer edit wins whole').toBe('edited offline');
      expect([c1.character.campaignIds, c1.build?.campaignIds], 'less the deleted campaign').toEqual([['keep'], ['keep']]);
      expect(m.charUpdated.c1, 'and the strip is no edit: its time is the edit’s').toBe(now - 1000);
      expect(m.roster.find((c) => c.id === 'c2')!.character.campaignIds).toEqual(['keep']);
    }
    const untouched = bundle({ roster: [ch('c2', { campaignIds: ['keep'] })], charUpdated: { c2: now - 9000 } });
    const r = mergeBundles(untouched, deletedThere, now);
    expect(r.roster.find((c) => c.id === 'c2'), 'a character not in it is not copied (local wins the tie)').toBe(untouched.roster[0]);
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
