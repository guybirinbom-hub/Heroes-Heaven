import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  homebrewFingerprint,
  loadCampaigns,
  loadHomebrewContent,
  loadHomebrewSources,
  loadModes,
  readCloudBundle,
  saveCampaigns,
  saveHomebrewItem,
  saveHomebrewSource,
  saveMode,
  writeCloudBundle,
  type CloudBundle,
} from '../src/data/storage';
import { mergeBundles } from '../src/data/cloudMerge';
import type { Item, ModeDef } from '../src/rules/types';

/**
 * "CHANGING AN ITEM DESCRIPTION ON ONE DEVICE AND OPENING IT ON ANOTHER DOESN'T SHOW THE CHANGE"
 * (Guy, 2026-11-13; "it happened with a name" too).
 *
 * An edited custom item lives in the homebrew store, a KEYED record with no timestamp of its own. The
 * cloud merge was a plain union where the LOCAL copy won every key conflict, so the device that still
 * held the old item kept it on every pull — and then pushed it back up, so the cloud flipped to whichever
 * device wrote last. Modes, homebrew sources and campaign memberships merged the same way.
 *
 * Each keyed record already gets a "last created/updated" stamp on every save (`revived`, storage.ts
 * recordReviveKeys). The merge now uses it: on a key both sides hold, the newer stamp wins (ties → local,
 * as for characters). These tests run two devices, each with its own localStorage, through the real save
 * functions and the real merge, the way cloudSync pulls and pushes.
 */

type Store = Record<string, string>;
const makeStorage = (store: Store): Storage =>
  ({
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  }) as Storage;

const deviceA: Store = {};
const deviceB: Store = {};
let cloud: CloudBundle | null = null;
let clock = 1_000_000;

/** Run `fn` on one device: its own localStorage, a clock that moves forward between steps. */
function on<T>(store: Store, fn: () => T): T {
  (globalThis as { localStorage?: Storage }).localStorage = makeStorage(store);
  clock += 5_000;
  vi.setSystemTime(clock);
  return fn();
}
/** cloudSync.push: re-pull, merge local over the cloud, upload. */
const push = (store: Store) =>
  on(store, () => {
    cloud = mergeBundles(readCloudBundle(), cloud);
  });
/** cloudSync.pull + adopt: merge the cloud into local and write the result. */
const pull = (store: Store) =>
  on(store, () => {
    writeCloudBundle(mergeBundles(readCloudBundle(), cloud));
  });

const rope = (name: string, description: string) => ({ id: 'hb-items-rope', name, description, level: 0, traits: [] }) as unknown as Item;

beforeEach(() => {
  for (const s of [deviceA, deviceB]) for (const k of Object.keys(s)) delete s[k];
  cloud = null;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('an edited custom item reaches the other device', () => {
  it('a new description and a new name made on device A show on device B', () => {
    on(deviceA, () => saveHomebrewItem(rope('Rope', 'old words')));
    push(deviceA);
    pull(deviceB);
    expect(on(deviceB, () => loadHomebrewContent().items['hb-items-rope']?.description)).toBe('old words');

    on(deviceA, () => saveHomebrewItem(rope('Silk Rope', 'new words')));
    push(deviceA);
    pull(deviceB);
    const onB = on(deviceB, () => loadHomebrewContent().items['hb-items-rope']);
    expect(onB?.description).toBe('new words');
    expect(onB?.name).toBe('Silk Rope');
  });

  it("device B's next upload does not put the old copy back, and A keeps the new one", () => {
    on(deviceA, () => saveHomebrewItem(rope('Rope', 'old words')));
    push(deviceA);
    pull(deviceB);
    on(deviceA, () => saveHomebrewItem(rope('Rope', 'new words')));
    push(deviceA);
    push(deviceB); // B uploads (some other change) BEFORE it pulled the edit — the push merges first
    expect((cloud!.homebrew.items['hb-items-rope'] as Item).description).toBe('new words');
    pull(deviceA);
    pull(deviceB);
    expect(on(deviceA, () => loadHomebrewContent().items['hb-items-rope']?.description)).toBe('new words');
    expect(on(deviceB, () => loadHomebrewContent().items['hb-items-rope']?.description)).toBe('new words');
  });

  it('an edit made on B AFTER the one on A wins on both devices (newest edit wins, either direction)', () => {
    on(deviceA, () => saveHomebrewItem(rope('Rope', 'first')));
    push(deviceA);
    pull(deviceB);
    on(deviceA, () => saveHomebrewItem(rope('Rope', 'from A')));
    on(deviceB, () => saveHomebrewItem(rope('Rope', 'from B, later')));
    push(deviceA);
    push(deviceB);
    pull(deviceA);
    pull(deviceB);
    expect(on(deviceA, () => loadHomebrewContent().items['hb-items-rope']?.description)).toBe('from B, later');
    expect(on(deviceB, () => loadHomebrewContent().items['hb-items-rope']?.description)).toBe('from B, later');
  });

  it("a device's own edit not uploaded yet is never replaced by the cloud's older copy", () => {
    on(deviceA, () => saveHomebrewItem(rope('Rope', 'first')));
    push(deviceA);
    pull(deviceB);
    on(deviceB, () => saveHomebrewItem(rope('Rope', 'B, not uploaded yet')));
    pull(deviceB); // a focus pull before B's push
    expect(on(deviceB, () => loadHomebrewContent().items['hb-items-rope']?.description)).toBe('B, not uploaded yet');
  });
});

describe('the other keyed records follow the same rule', () => {
  it('an edited mode reaches the other device', () => {
    const mode = (name: string) => ({ id: 'mode-rage-x', name, effects: [] }) as unknown as ModeDef;
    on(deviceA, () => saveMode(mode('Rage')));
    push(deviceA);
    pull(deviceB);
    on(deviceA, () => saveMode(mode('Big Rage')));
    push(deviceA);
    pull(deviceB);
    expect(on(deviceB, () => loadModes()['mode-rage-x']?.name)).toBe('Big Rage');
  });

  it("a mode arriving by sync changes the homebrew fingerprint, so the other device's open screen refreshes", () => {
    // App.tsx re-merges its content database after a sync only when homebrewFingerprint() moved. Modes are
    // merged into that database from storage too, and were missing from the fingerprint (checker, 2026-11-13).
    const mode = (name: string) => ({ id: 'mode-rage-y', name, effects: [] }) as unknown as ModeDef;
    on(deviceA, () => saveMode(mode('Rage')));
    push(deviceA);
    pull(deviceB);
    const before = on(deviceB, () => homebrewFingerprint());
    on(deviceA, () => saveMode(mode('Big Rage')));
    push(deviceA);
    pull(deviceB);
    expect(on(deviceB, () => homebrewFingerprint())).not.toBe(before);
  });

  it('a stamp past the retention window does not beat a rival the other side already pruned', () => {
    on(deviceA, () => saveHomebrewItem(rope('Rope', 'ancient, from an offline device')));
    const stale = on(deviceA, () => readCloudBundle());
    clock += 200 * 24 * 60 * 60 * 1000; // past the 180-day retention
    on(deviceB, () => saveHomebrewItem(rope('Rope', 'fresh')));
    const fresh = on(deviceB, () => readCloudBundle());
    // The fresh side's stamp is current, so it wins whichever side is "local".
    expect((mergeBundles(stale, fresh, clock).homebrew.items['hb-items-rope'] as Item).description).toBe('fresh');
    expect((mergeBundles(fresh, stale, clock).homebrew.items['hb-items-rope'] as Item).description).toBe('fresh');
  });

  it('an edited homebrew source reaches the other device', () => {
    on(deviceA, () => saveHomebrewSource({ id: 'src-1', name: 'My Book' }));
    push(deviceA);
    pull(deviceB);
    on(deviceA, () => saveHomebrewSource({ id: 'src-1', name: 'My Better Book' }));
    push(deviceA);
    pull(deviceB);
    expect(on(deviceB, () => loadHomebrewSources()['src-1']?.name)).toBe('My Better Book');
  });

  it('a changed campaign membership reaches the other device', () => {
    const m = (name: string) => ({ id: 'camp-1', role: 'player', name }) as never;
    on(deviceA, () => saveCampaigns([m('Old name')]));
    push(deviceA);
    pull(deviceB);
    on(deviceA, () => saveCampaigns([m('New name')]));
    push(deviceA);
    pull(deviceB);
    expect(on(deviceB, () => (loadCampaigns()[0] as unknown as { name: string })?.name)).toBe('New name');
  });
});
