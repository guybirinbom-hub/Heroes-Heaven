// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudBundle, SavedChar } from '../src/data/storage';

/**
 * THE ROSTER WIPE (found 2026-11-17 by a read-only check; the same code in release/v0.1.46-public and main).
 *
 * 1. parseRoster wrapped the whole roster in ONE try/catch: one entry whose normalize threw (a character
 *    without an id whose name is {"toString":0}) — or a stored value that did not JSON.parse — loaded as [].
 * 2. App's mount persist wrote that [] over the stored roster 400 ms later. Every character gone.
 * 3. Signed in with a first pull that failed (offline), the first persist tombstoned every id in charUpdated
 *    the roster did not show; the next good pull dropped those characters from the cloud and every device.
 *
 * Owner rules: a player's change is never overwritten by the app; UNKNOWN is not EMPTY; a load is not an
 * edit. Every leg drives the real modules (fresh graph each, vi.resetModules); "the mount persist" is
 * exactly what App.tsx wires up: setupPersist(saveRoster) + schedulePersist(the loaded roster) + 400 ms.
 * Synthetic characters only.
 */

/** A fake supabase: the cloud row, every upload, and a pull that can be made to fail (offline). */
const sb = vi.hoisted(() => {
  const state = { cloudRow: null as CloudBundle | null, failNext: 0, upserts: [] as CloudBundle[] };
  type Chan = { on: () => Chan; subscribe: () => Chan };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (state.failNext > 0) {
              state.failNext--;
              return { data: null, error: { message: 'offline' } };
            }
            return { data: state.cloudRow ? { data: JSON.parse(JSON.stringify(state.cloudRow)) } : null, error: null };
          },
        }),
      }),
      upsert: async (row: { data: CloudBundle }) => {
        const copy = JSON.parse(JSON.stringify(row.data)) as CloudBundle;
        state.upserts.push(copy);
        state.cloudRow = copy;
        return { error: null };
      },
    }),
    channel: () => {
      const ch: Chan = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: () => {},
  };
  return { state, client };
});
vi.mock('../src/data/supabase', () => ({ supabase: sb.client, isCloudConfigured: true, isCloudSyncEnabled: true }));

// A cold run transforms cloudSync's whole import graph inside the first leg that imports it (75 s once).
vi.setConfig({ testTimeout: 180_000 });

const ROSTER_KEY = 'wanderers-codex:roster:v1';
const OWNER_KEY = 'pf2e-codex.syncOwner';
const LINEAGE_KEY = 'wanderers-codex:roster-lineage:v1';
const CHAR_UPDATED_KEY = 'wanderers-codex:char-updated:v1';
const TOMBSTONES_KEY = 'pf2e-codex.deleted';
const UNREADABLE_PREFIX = 'wanderers-codex:roster-unreadable:v1:';
const PERSIST_MS = 400; // persist.ts PERSIST_DEBOUNCE_MS

/** A plain stored character, as an older save or a hand edit could leave it (no build). */
const pc = (id: string, name: unknown, extra: Record<string, unknown> = {}) => ({ id, character: { name, ...extra } });

/** The ids a stored roster value holds (null when it is not a JSON array). */
function storedIds(): (string | undefined)[] | null {
  const raw = localStorage.getItem(ROSTER_KEY);
  try {
    const v = raw === null ? null : (JSON.parse(raw) as unknown);
    return Array.isArray(v) ? v.map((e) => (e && typeof e === 'object' ? (e as { id?: string }).id : undefined)) : null;
  } catch {
    return null;
  }
}

/** A fresh module graph, opened the way App opens: load the roster key as this tab's KNOWN roster, wire
 *  the persist writer, and schedule the mount persist of what was loaded. */
async function mount() {
  vi.resetModules();
  const storage = await import('../src/data/storage');
  const persist = await import('../src/data/persist');
  const tabs = await import('../src/data/rosterTabs');
  const loaded = tabs.loadRosterKnown();
  const results: boolean[] = [];
  persist.setupPersist(storage.saveRoster, (ok) => results.push(ok));
  persist.schedulePersist(loaded); // App.tsx: useEffect(() => schedulePersist(roster), [roster]) on mount
  await vi.advanceTimersByTimeAsync(PERSIST_MS + 50);
  return { storage, persist, tabs, loaded, results };
}

/** Make normalizeCharacter throw for a character named BREAKS — a stand-in for any entry a future
 *  normalize cannot read, so the guard holds even after the {"toString":0} cause itself is fixed. */
function plantThrowingNormalize() {
  vi.doMock('../src/rules/normalize', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/rules/normalize')>();
    return {
      ...actual,
      normalizeCharacter: (c: unknown) => {
        if (c && typeof c === 'object' && (c as { name?: unknown }).name === 'BREAKS') throw new Error('planted: unreadable entry');
        return actual.normalizeCharacter(c);
      },
    };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  vi.doUnmock('../src/rules/normalize');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a load never empties the roster (bug 2026-11-17: the mount persist wrote [] over every character)', () => {
  it('a character whose name is {"toString":0} or [{"toString":null}] (no id) loads, and every character is still stored after the mount persist', async () => {
    const stored = [pc('a', 'Ayla'), pc('t1', { toString: 0 }), pc('t2', [{ toString: null }]), pc('b', 'Bram')];
    localStorage.setItem(ROSTER_KEY, JSON.stringify(stored));
    const { loaded } = await mount();
    expect(loaded.map((c) => c.id)).toEqual(['a', 't1', 't2', 'b']);
    expect(storedIds()).toEqual(['a', 't1', 't2', 'b']);
    expect(localStorage.getItem(ROSTER_KEY)).not.toBe('[]');
  });

  it('an entry whose normalize THROWS is kept exactly as stored: the good ones load, and the key still holds all three after the mount persist', async () => {
    plantThrowingNormalize();
    const bad = pc('bad', 'BREAKS', { level: 4, notes: ['keep me'] });
    const stored = [pc('a', 'Ayla'), bad, pc('b', 'Bram')];
    localStorage.setItem(ROSTER_KEY, JSON.stringify(stored));
    const { loaded, storage, persist } = await mount();
    expect(loaded.map((c) => c.id)).toEqual(['a', 'b']); // the one it cannot read is not shown…
    expect(storedIds()).toEqual(['a', 'b', 'bad']); // …and not dropped
    const onDisk = JSON.parse(localStorage.getItem(ROSTER_KEY)!) as unknown[];
    expect(JSON.stringify(onDisk[2])).toBe(JSON.stringify(bad)); // byte-for-byte as stored
    // A later edit of a good character carries it again, and a reload reads the same.
    persist.schedulePersist([{ ...loaded[0], archived: true }, loaded[1]]);
    await vi.advanceTimersByTimeAsync(PERSIST_MS + 50);
    expect(storedIds()).toEqual(['a', 'b', 'bad']);
    expect(storage.loadRoster().map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('entries without an id or a character object are kept too (they used to be filtered out and lost on the next save)', async () => {
    const stored = [pc('a', 'Ayla'), { id: 'x', note: 'no character' }, null, { character: { name: 'No id' } }];
    localStorage.setItem(ROSTER_KEY, JSON.stringify(stored));
    const { loaded } = await mount();
    expect(loaded.map((c) => c.id)).toEqual(['a']);
    const onDisk = JSON.parse(localStorage.getItem(ROSTER_KEY)!) as unknown[];
    expect(onDisk).toHaveLength(4);
    expect(onDisk.slice(1)).toEqual(stored.slice(1));
  });

  it('a stored value that does not parse is never overwritten by the mount persist, and a real save copies it aside first', async () => {
    const broken = '[{"id":"a","character":{"name":"Ayla"}},{"id":"b","charac'; // cut off mid-write
    localStorage.setItem(ROSTER_KEY, broken);
    const { loaded, persist, results } = await mount();
    expect(loaded).toEqual([]); // the app opens, empty…
    expect(localStorage.getItem(ROSTER_KEY)).toBe(broken); // …and the launch wrote nothing over it
    expect(results.every(Boolean)).toBe(true); // no "can't save" banner for it either
    // The player then creates a character: that is saved — and the unread value is kept, unchanged.
    persist.schedulePersist([pc('new', 'Newcomer')]);
    await vi.advanceTimersByTimeAsync(PERSIST_MS + 50);
    expect(storedIds()).toEqual(['new']);
    const copies = Object.keys(localStorage).filter((k) => k.startsWith(UNREADABLE_PREFIX));
    expect(copies).toHaveLength(1);
    expect(localStorage.getItem(copies[0])).toBe(broken);
  });

  it('a stored value that is JSON but not a roster is kept the same way', async () => {
    const odd = '{"characters":[{"id":"a"}]}';
    localStorage.setItem(ROSTER_KEY, odd);
    await mount();
    expect(localStorage.getItem(ROSTER_KEY)).toBe(odd);
  });

  it('when the copy cannot be made, the write is refused — the unread value is never replaced without one', async () => {
    const broken = '[{"id":"a",';
    localStorage.setItem(ROSTER_KEY, broken);
    const { persist, results } = await mount();
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith(UNREADABLE_PREFIX)) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, k, v);
    });
    persist.schedulePersist([pc('new', 'Newcomer')]);
    await vi.advanceTimersByTimeAsync(PERSIST_MS + 50);
    expect(localStorage.getItem(ROSTER_KEY)).toBe(broken);
    expect(results.at(-1)).toBe(false); // the player is told it did not save
  });
});

describe('every other reader of the roster key counts what it cannot read', () => {
  it('rosterUnshownText (campaign homebrew\'s "is this entry still used?" scan) holds the kept entries, or the whole unread value', async () => {
    vi.resetModules();
    const storage = await import('../src/data/storage');
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('a', 'Ayla'), { id: 'x', note: 'uses hb-entry-7' }]));
    expect(storage.rosterUnshownText()).toContain('hb-entry-7');
    expect(storage.rosterUnreadCounts()).toEqual({ entries: 1, lists: 0 }); // the Characters screen's notice
    localStorage.setItem(ROSTER_KEY, '[{"id":"a","feats":["hb-entry-9"]');
    expect(storage.rosterUnshownText()).toContain('hb-entry-9');
    expect(storage.rosterUnreadCounts()).toEqual({ entries: 0, lists: 1 });
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('a', 'Ayla')]));
    expect(storage.rosterUnshownText()).toBe('');
  });

  it('an account switch copies a roster holding entries this version cannot read aside before removing it', async () => {
    vi.resetModules();
    const storage = await import('../src/data/storage');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const withKept = JSON.stringify([pc('a', 'Ayla'), { id: 'x', character: null, note: 'never synced' }]);
    localStorage.setItem(ROSTER_KEY, withKept);
    storage.wipeSyncedLocalData();
    expect(localStorage.getItem(ROSTER_KEY)).toBeNull();
    const copies = Object.keys(localStorage).filter((k) => k.startsWith(UNREADABLE_PREFIX));
    expect(copies).toHaveLength(1);
    expect(localStorage.getItem(copies[0])).toBe(withKept);
    // A roster the app reads whole is uploaded already: nothing is copied for it.
    localStorage.clear();
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('a', 'Ayla')]));
    storage.wipeSyncedLocalData();
    expect(Object.keys(localStorage).filter((k) => k.startsWith(UNREADABLE_PREFIX))).toHaveLength(0);
  });

  it('the cloud merge keeps every entry without an id (keyed by `undefined` they overwrote each other), each once', async () => {
    const { mergeRoster } = await import('../src/data/cloudMerge');
    const one = { note: 'first' };
    const two = { note: 'second' };
    const out = mergeRoster([pc('a', 'Ayla') as never, one as never], {}, [one as never, two as never, null as never], {});
    expect(out.roster).toHaveLength(4);
    expect(out.roster).toContainEqual(two);
    expect(out.roster).toContainEqual(null);
  });
});

describe('another tab writing a roster with one bad entry is not read as deleting everything', () => {
  /** What another tab's saveRoster leaves behind: its lineage record, then the roster. */
  function otherTabWrites(raw: string, on: string | null, sig: (raw: string) => string) {
    localStorage.setItem(LINEAGE_KEY, JSON.stringify({ sig: sig(raw), on }));
    localStorage.setItem(ROSTER_KEY, raw);
  }

  it('the good entries arrive, the unreadable one stays on the key exactly once (the other tab\'s copy), and nothing is lost', async () => {
    plantThrowingNormalize();
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('a', 'Ayla'), pc('b', 'Bram'), pc('c', 'Cora')]));
    vi.resetModules();
    const tabs = await import('../src/data/rosterTabs');
    const lineage = await import('../src/data/rosterLineage');
    const storage = await import('../src/data/storage');
    const { mergeRosterEdits } = await import('../src/data/rosterMerge');
    const mine = tabs.loadRosterKnown();
    // The other tab edits Bram and writes Cora in a shape this tab cannot read.
    const theirC = pc('c', 'BREAKS', { level: 5 });
    otherTabWrites(JSON.stringify([pc('a', 'Ayla'), pc('b', 'Bram the Bold'), theirC]), lineage.knownRoster().sig, lineage.rosterSig);
    const f = tabs.takeForeignRoster();
    expect(f?.kind).toBe('write');
    if (f?.kind !== 'write') return;
    expect(f.unread).toEqual(['c']); // App hands these to cloudSync.forgetHeld: not a deletion
    const merged = mergeRosterEdits(f.base, mine, f.incoming);
    expect(merged.find((c) => c.id === 'b')?.character.name).toBe('Bram the Bold');
    // This tab's next write: Cora is on the key once, as the other tab wrote her — never this tab's older
    // readable copy beside it (the base stand-in wrote both: two entries with one id, a checker's finding
    // on 12e9ad2).
    expect(storage.saveRoster(merged)).toBe(true);
    const onDisk = JSON.parse(localStorage.getItem(ROSTER_KEY)!) as { id: string; character: { name: string } }[];
    expect(onDisk.map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
    expect(onDisk.find((e) => e.id === 'c')).toEqual(theirC);
    expect(onDisk.find((e) => e.id === 'b')?.character.name).toBe('Bram the Bold');
  });

  it('App tells cloud sync about an unread character on both foreign-roster paths (wiring of the tab test below)', () => {
    const app = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8') // vt.mjs runs from the checkout root;
    expect(app.match(/forgetHeld\(f\.unread\)/g)?.length).toBe(2); // foldForeign + reconcileWrite
  });

  it('signed in: a character another tab wrote unreadably is not tombstoned, and the cloud keeps it', async () => {
    plantThrowingNormalize();
    vi.resetModules();
    const { normalizeCharacter } = await import('../src/rules/normalize');
    const ch = (id: string, name: string) => ({ id, character: normalizeCharacter({ id, name }) }) as SavedChar;
    sb.state.cloudRow = { roster: [ch('a', 'Ayla'), ch('b', 'Bram'), ch('c', 'Cora')], charUpdated: { a: 1000, b: 1000, c: 1000 } } as unknown as CloudBundle;
    sb.state.upserts = [];
    sb.state.failNext = 0;
    localStorage.setItem(OWNER_KEY, 'user-1');
    const storage = await import('../src/data/storage');
    const persist = await import('../src/data/persist');
    const tabs = await import('../src/data/rosterTabs');
    const lineage = await import('../src/data/rosterLineage');
    const { mergeRosterEdits } = await import('../src/data/rosterMerge');
    const sync = await import('../src/data/cloudSync');
    persist.setupPersist(storage.saveRoster, () => {});
    const applied: SavedChar[][] = [];
    const stop = await sync.startCloudSync((r) => applied.push(r));
    try {
      await vi.advanceTimersByTimeAsync(10);
      const mine = applied.at(-1)!;
      expect(mine.map((c) => c.id).sort()).toEqual(['a', 'b', 'c']);
      // The other tab (a newer version, say) writes Cora in a shape this tab cannot read.
      otherTabWrites(JSON.stringify([...mine.filter((c) => c.id !== 'c'), pc('c', 'BREAKS')]), lineage.knownRoster().sig, lineage.rosterSig);
      const f = tabs.takeForeignRoster();
      if (f?.kind !== 'write') throw new Error(`expected a write, got ${f?.kind}`);
      sync.forgetHeld(f.unread); // what App's foldForeign does first
      persist.schedulePersist(mergeRosterEdits(f.base, mine, f.incoming));
      await vi.advanceTimersByTimeAsync(PERSIST_MS + 50);
      const tomb = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) ?? '{}') as Record<string, number>;
      expect(tomb['char:c']).toBeUndefined();
      expect(storedIds()?.sort()).toEqual(['a', 'b', 'c']);
      await vi.advanceTimersByTimeAsync(3100); // the live push
      for (const up of sb.state.upserts) expect(up.roster.map((c) => c.id)).toContain('c');
    } finally {
      stop();
    }
  });

  it('a value that is not a roster at all is no information: nothing is taken from it', async () => {
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('a', 'Ayla'), pc('b', 'Bram')]));
    vi.resetModules();
    const tabs = await import('../src/data/rosterTabs');
    tabs.loadRosterKnown();
    localStorage.setItem(ROSTER_KEY, '[{"id":"a","charac');
    expect(tabs.takeForeignRoster()).toBeNull();
  });

  it('…also on the account-switch path: another tab signed in as someone else and the key holds a value that is not a roster', async () => {
    localStorage.setItem(OWNER_KEY, 'user-1');
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('a', 'Ayla'), pc('b', 'Bram')]));
    vi.resetModules();
    const tabs = await import('../src/data/rosterTabs');
    tabs.loadRosterKnown();
    localStorage.setItem(OWNER_KEY, 'user-2');
    localStorage.setItem(ROSTER_KEY, '[{"id":"z","charac');
    expect(tabs.takeForeignRoster()).toBeNull(); // never "the new account has no characters"
  });
});

describe('copies of an unreadable roster (checker findings on 54f6585)', () => {
  it('the scans that delete by "nothing uses it" still see a list once it is copied aside (portrait GC, campaign cleanup, homebrew)', async () => {
    const broken = '[{"id":"a","character":{"name":"Ayla","portraitRef":"p_1"}},{"id":"b","charac';
    localStorage.setItem(ROSTER_KEY, broken);
    const { persist, storage } = await mount();
    persist.schedulePersist([pc('new', 'Newcomer')]); // the first real save copies it aside
    await vi.advanceTimersByTimeAsync(PERSIST_MS + 50);
    expect(storedIds()).toEqual(['new']);
    expect(storage.rosterUnshownText()).toContain('p_1');
    // App gates the portrait GC and the cleanup of unheld campaigns on exactly that text.
    const app = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');
    expect(app.match(/rosterUnshownText\(\)/g)?.length).toBe(2);
  });

  it('a copy made at an account switch is the old account\'s: not counted, not exported for the new one, kept on the device, and never cleared by a restore', async () => {
    vi.resetModules();
    const storage = await import('../src/data/storage');
    const backup = await import('../src/data/backup');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(OWNER_KEY, 'user-1');
    const withKept = JSON.stringify([pc('a', 'Ayla'), { id: 'x', character: null }]);
    localStorage.setItem(ROSTER_KEY, withKept);
    expect(storage.rosterUnreadCounts()).toEqual({ entries: 1, lists: 0 });
    // cloudSync's switch: the new owner is saved first, then the wipe names the old one.
    expect(readFileSync(`${process.cwd()}/src/data/cloudSync.ts`, 'utf8')).toMatch(/saveSyncOwner\(uid\);\s*wipeSyncedLocalData\(prevOwner\);/);
    localStorage.setItem(OWNER_KEY, 'user-2');
    storage.wipeSyncedLocalData('user-1');
    const copies = Object.keys(localStorage).filter((k) => k.startsWith(UNREADABLE_PREFIX));
    expect(copies).toHaveLength(1);
    expect(localStorage.getItem(copies[0])).toBe(withKept);
    expect(storage.rosterUnreadCounts()).toEqual({ entries: 0, lists: 0 }); // user-2 is told nothing about user-1's list
    expect(Object.keys(backup.parseBackup(backup.createBackup()).data).some((k) => k.startsWith(UNREADABLE_PREFIX))).toBe(false);
    expect(storage.rosterUnshownText()).toContain('"x"'); // …but the device's GC still sees it
    // A restore replaces everything else, never the copy.
    backup.restoreBackup(backup.parseBackup(backup.createBackup()));
    expect(localStorage.getItem(copies[0])).toBe(withKept);
    // user-1 signs in here again: told, and it goes in user-1's export.
    localStorage.setItem(OWNER_KEY, 'user-1');
    expect(storage.rosterUnreadCounts()).toEqual({ entries: 0, lists: 1 });
    expect(backup.parseBackup(backup.createBackup()).data[copies[0]]).toBe(withKept);
  });

  it('Settings counts a kept unreadable character in the Export and Uninstall lines (wiring)', () => {
    const page = readFileSync(`${process.cwd()}/src/sheet/SettingsPage.tsx`, 'utf8');
    expect(page.match(/const charCount = savedCharCount\(\);/g)?.length).toBe(2);
    expect(page).toMatch(/function savedCharCount\(\): number \{\s*return loadRoster\(\)\.length \+ rosterUnreadCounts\(\)\.entries;/);
  });
});

describe('a character this version cannot read, edited on a newer device, never piles up copies here (checker finding on 54f6585)', () => {
  it('five remote edits of an unreadable cloud x leave exactly one x on the key, the newest; the notice counts one', async () => {
    vi.resetModules();
    const { normalizeCharacter } = await import('../src/rules/normalize');
    const ch = (id: string, name: string) => ({ id, character: normalizeCharacter({ id, name }) }) as SavedChar;
    const x = (rev: number) => ({ id: 'x', character: null, future: { rev } });
    sb.state.cloudRow = { roster: [ch('a', 'Ayla'), x(1)], charUpdated: { a: 1000, x: 1001 } } as unknown as CloudBundle;
    sb.state.upserts = [];
    sb.state.failNext = 0;
    localStorage.setItem(OWNER_KEY, 'user-1');
    const storage = await import('../src/data/storage');
    const persist = await import('../src/data/persist');
    const sync = await import('../src/data/cloudSync');
    persist.setupPersist(storage.saveRoster, () => {});
    const stop = await sync.startCloudSync(() => {});
    try {
      await vi.advanceTimersByTimeAsync(10);
      for (let rev = 2; rev <= 5; rev++) {
        await vi.advanceTimersByTimeAsync(5000); // past the pull throttle (and any push)
        sb.state.cloudRow = { ...sb.state.cloudRow!, roster: [ch('a', 'Ayla'), x(rev)], charUpdated: { a: 1000, x: 1000 + rev } } as unknown as CloudBundle;
        window.dispatchEvent(new Event('focus')); // a pull, as Realtime would start one
        await vi.advanceTimersByTimeAsync(10);
        await vi.advanceTimersByTimeAsync(10);
      }
      const onDisk = JSON.parse(localStorage.getItem(ROSTER_KEY)!) as { id: string; future?: { rev: number } }[];
      expect(onDisk.filter((e) => e.id === 'x').map((e) => e.future?.rev)).toEqual([5]);
      expect(storage.rosterUnreadCounts().entries).toBe(1);
    } finally {
      stop();
    }
  });

  it('a stored entry kept unread here stays when the roster written holds no unreadable copy of its id', async () => {
    vi.resetModules();
    const storage = await import('../src/data/storage');
    const keptX = { id: 'x', character: null, note: 'only here' };
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('a', 'Ayla'), keptX]));
    storage.loadRoster();
    expect(storage.saveRoster([...storage.loadRoster(), { id: 'y', character: null } as never])).toBe(true);
    expect(JSON.parse(localStorage.getItem(ROSTER_KEY)!)).toContainEqual(keptX);
  });

  it('the merge takes the FIRST of two local entries with one id (the newest; later ones are older kept copies)', async () => {
    const { mergeRoster } = await import('../src/data/cloudMerge');
    const NEW = { id: 'x', character: { name: 'NEW' } } as never;
    const OLD = { id: 'x', character: { name: 'OLD' } } as never;
    const out = mergeRoster([NEW, OLD], { x: 1000 }, [NEW], { x: 1000 });
    expect(out.roster).toEqual([NEW]);
    const cloudDup = mergeRoster([], {}, [NEW, OLD], { x: 1000 });
    expect(cloudDup.roster).toEqual([NEW]);
  });
});

describe('cloud: a failed first pull never tombstones characters this session never held', () => {

  it('offline open, roster loads empty, the player creates a character: no tombstone for the old ids, and the next good pull keeps the cloud characters', async () => {
    vi.resetModules();
    const { normalizeCharacter } = await import('../src/rules/normalize');
    const cloudChar = (id: string, name: string) => ({ id, character: normalizeCharacter({ id, name }) }) as SavedChar;
    sb.state.cloudRow = { roster: [cloudChar('c1', 'Ayla'), cloudChar('c2', 'Bram')], charUpdated: { c1: 1000, c2: 1000 } } as unknown as CloudBundle;
    sb.state.upserts = [];
    sb.state.failNext = 1; // the opening pull fails
    // This device synced c1 and c2 before, but its roster key no longer shows them (lost, or unreadable).
    localStorage.setItem(CHAR_UPDATED_KEY, JSON.stringify({ c1: 1000, c2: 1000 }));
    localStorage.setItem(OWNER_KEY, 'user-1');
    const storage = await import('../src/data/storage');
    const persist = await import('../src/data/persist');
    const sync = await import('../src/data/cloudSync');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    persist.setupPersist(storage.saveRoster, () => {});
    const applied: SavedChar[][] = [];
    const stop = await sync.startCloudSync((r) => applied.push(r));
    try {
      expect(sync.hasSyncedOnce()).toBe(false);
      // The player creates a character while offline.
      persist.schedulePersist([cloudChar('c3', 'Cora')]);
      await vi.advanceTimersByTimeAsync(PERSIST_MS + 50);
      const tomb = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) ?? '{}') as Record<string, number>;
      expect(tomb['char:c1']).toBeUndefined();
      expect(tomb['char:c2']).toBeUndefined();
      // Back online: the pull succeeds and the cloud's characters stay — here and in the upload.
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(10);
      expect(sync.hasSyncedOnce()).toBe(true);
      expect(storage.loadRoster().map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
      expect(applied.at(-1)?.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
      expect(sb.state.upserts.at(-1)?.roster.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
    } finally {
      stop();
    }
  });

  it('a character the player really deletes is still tombstoned', async () => {
    vi.resetModules();
    const { normalizeCharacter } = await import('../src/rules/normalize');
    const ch = (id: string, name: string) => ({ id, character: normalizeCharacter({ id, name }) }) as SavedChar;
    sb.state.cloudRow = null;
    sb.state.upserts = [];
    sb.state.failNext = 0;
    localStorage.setItem(OWNER_KEY, 'user-1');
    const storage = await import('../src/data/storage');
    const persist = await import('../src/data/persist');
    const sync = await import('../src/data/cloudSync');
    storage.saveRoster([ch('c1', 'Ayla'), ch('c2', 'Bram')]);
    storage.saveCharUpdated({ c1: 1000, c2: 1000 });
    persist.setupPersist(storage.saveRoster, () => {});
    const stop = await sync.startCloudSync(() => {});
    try {
      await vi.advanceTimersByTimeAsync(10);
      persist.schedulePersist([storage.loadRoster()[0]]); // the player deletes Bram
      await vi.advanceTimersByTimeAsync(PERSIST_MS + 50);
      const tomb = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) ?? '{}') as Record<string, number>;
      expect(tomb['char:c2']).toBeGreaterThan(0);
      expect(tomb['char:c1']).toBeUndefined();
    } finally {
      stop();
    }
  });

  it('a kept unreadable entry sharing an id with a readable character never blocks deleting that character (checker finding on 12e9ad2)', async () => {
    vi.resetModules();
    const { normalizeCharacter } = await import('../src/rules/normalize');
    const ch = (id: string, name: string) => ({ id, character: normalizeCharacter({ id, name }) }) as SavedChar;
    // This device's key holds Ayla and an entry for x it cannot read; the cloud holds a readable x.
    const keptX = { id: 'x', character: null };
    localStorage.setItem(ROSTER_KEY, JSON.stringify([ch('a', 'Ayla'), keptX]));
    localStorage.setItem(CHAR_UPDATED_KEY, JSON.stringify({ a: 1000 }));
    localStorage.setItem(OWNER_KEY, 'user-1');
    sb.state.cloudRow = { roster: [ch('a', 'Ayla'), ch('x', 'Xan')], charUpdated: { a: 1000, x: 1000 } } as unknown as CloudBundle;
    sb.state.upserts = [];
    sb.state.failNext = 0;
    const storage = await import('../src/data/storage');
    const persist = await import('../src/data/persist');
    const sync = await import('../src/data/cloudSync');
    persist.setupPersist(storage.saveRoster, () => {});
    const applied: SavedChar[][] = [];
    const stop = await sync.startCloudSync((r) => applied.push(r));
    try {
      await vi.advanceTimersByTimeAsync(10);
      expect(applied.at(-1)?.map((c) => c.id).sort()).toEqual(['a', 'x']);
      // The player deletes Xan.
      persist.schedulePersist(applied.at(-1)!.filter((c) => c.id !== 'x'));
      await vi.advanceTimersByTimeAsync(PERSIST_MS + 50);
      const tomb = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) ?? '{}') as Record<string, number>;
      expect(tomb['char:x']).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(3100); // the live push
      const up = sb.state.upserts.at(-1);
      expect(up).toBeDefined();
      expect(up!.roster.some((e) => storage.isRosterEntry(e) && e.id === 'x')).toBe(false); // no readable x goes back
      expect(up!.deleted?.['char:x']).toBeGreaterThan(0);
      // The unreadable copy is still on this device (UNKNOWN is not EMPTY).
      expect(JSON.parse(localStorage.getItem(ROSTER_KEY)!)).toContainEqual(keptX);
    } finally {
      stop();
    }
  });

  it('an unreadable cloud entry is never handed to the screens, and it stays in the roster key and the cloud', async () => {
    vi.resetModules();
    const { normalizeCharacter } = await import('../src/rules/normalize');
    const ch = (id: string, name: string) => ({ id, character: normalizeCharacter({ id, name }) }) as SavedChar;
    const junk = { note: 'a row without an id' };
    sb.state.cloudRow = { roster: [ch('c1', 'Ayla'), junk, null], charUpdated: { c1: 1000 } } as unknown as CloudBundle;
    sb.state.upserts = [];
    sb.state.failNext = 0;
    localStorage.setItem(OWNER_KEY, 'user-1');
    const storage = await import('../src/data/storage');
    const persist = await import('../src/data/persist');
    const sync = await import('../src/data/cloudSync');
    persist.setupPersist(storage.saveRoster, () => {});
    const applied: SavedChar[][] = [];
    const stop = await sync.startCloudSync((r) => applied.push(r));
    try {
      await vi.advanceTimersByTimeAsync(10);
      expect(applied.at(-1)?.map((c) => c.id)).toEqual(['c1']);
      persist.schedulePersist(applied.at(-1)!); // the app's persist of what it was handed
      await vi.advanceTimersByTimeAsync(PERSIST_MS + 50);
      const onDisk = JSON.parse(localStorage.getItem(ROSTER_KEY)!) as unknown[];
      expect(onDisk).toContainEqual(junk);
      expect(onDisk).toContainEqual(null);
      expect(sb.state.upserts.at(-1)?.roster).toContainEqual(junk);
      expect(sb.state.upserts.at(-1)?.roster).toContainEqual(null);
    } finally {
      stop();
    }
  });

  it('offline open (the first pull fails): a character loaded at launch that the player deletes is still tombstoned', async () => {
    vi.resetModules();
    const { normalizeCharacter } = await import('../src/rules/normalize');
    const ch = (id: string, name: string) => ({ id, character: normalizeCharacter({ id, name }) }) as SavedChar;
    sb.state.cloudRow = { roster: [ch('c1', 'Ayla'), ch('c2', 'Bram')], charUpdated: { c1: 1000, c2: 1000 } } as unknown as CloudBundle;
    sb.state.upserts = [];
    sb.state.failNext = 1; // the opening pull fails
    localStorage.setItem(OWNER_KEY, 'user-1');
    const storage = await import('../src/data/storage');
    const persist = await import('../src/data/persist');
    const sync = await import('../src/data/cloudSync');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.saveRoster([ch('c1', 'Ayla'), ch('c2', 'Bram')]); // what this device held before it went offline
    storage.saveCharUpdated({ c1: 1000, c2: 1000 });
    persist.setupPersist(storage.saveRoster, () => {});
    const stop = await sync.startCloudSync(() => {});
    try {
      await vi.advanceTimersByTimeAsync(10);
      expect(sync.hasSyncedOnce()).toBe(false);
      persist.schedulePersist([storage.loadRoster()[0]]); // the player deletes Bram, still offline
      await vi.advanceTimersByTimeAsync(PERSIST_MS + 50);
      const tomb = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) ?? '{}') as Record<string, number>;
      expect(tomb['char:c2']).toBeGreaterThan(0);
      expect(tomb['char:c1']).toBeUndefined();
    } finally {
      stop();
    }
  });
});

describe('the steps that clear or replace the roster on purpose keep what was never read (ported from main 5ff8815)', () => {
  const copiesNow = () => Object.keys(localStorage).filter((k) => k.startsWith(UNREADABLE_PREFIX));

  it('Restore over a key that does not parse copies the old value aside first (equal to the old raw), and the restore lands', async () => {
    vi.resetModules();
    const storage = await import('../src/data/storage');
    const backup = await import('../src/data/backup');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Last week's backup: one readable character.
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('old', 'Weekold')]));
    const env = backup.parseBackup(backup.createBackup());
    localStorage.clear();
    // Today the key holds a cut-off value: the notice says "kept unchanged", and the player restores.
    const broken = '[{"id":"a","character":{"name":"Ayla"}},{"id":"b","charac';
    localStorage.setItem(ROSTER_KEY, broken);
    expect(storage.rosterUnreadCounts()).toEqual({ entries: 0, lists: 1 });
    backup.restoreBackup(env);
    expect(storedIds()).toEqual(['old']);
    const copies = copiesNow();
    expect(copies).toHaveLength(1);
    expect(localStorage.getItem(copies[0])).toBe(broken);
    expect(storage.rosterUnreadCounts()).toEqual({ entries: 0, lists: 1 }); // still told, still exported
  });

  it('Restore over a readable key holding an unreadable entry keeps that entry too', async () => {
    vi.resetModules();
    const backup = await import('../src/data/backup');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = backup.parseBackup(backup.createBackup()); // an empty device's backup
    const withKept = JSON.stringify([pc('a', 'Ayla'), { id: 'x', note: 'no character object' }]);
    localStorage.setItem(ROSTER_KEY, withKept);
    backup.restoreBackup(env);
    expect(copiesNow().map((k) => localStorage.getItem(k))).toEqual([withKept]);
  });

  it('Restore is refused, changing nothing, when that copy cannot be made', async () => {
    vi.resetModules();
    const backup = await import('../src/data/backup');
    const env = backup.parseBackup(backup.createBackup());
    const broken = '[{"id":"a",';
    localStorage.setItem(ROSTER_KEY, broken);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith(UNREADABLE_PREFIX)) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, k, v);
    });
    expect(() => backup.restoreBackup(env)).toThrow(/could not be kept aside/);
    expect(localStorage.getItem(ROSTER_KEY)).toBe(broken);
  });

  it('the crash screen\'s "Reset saved data" (clearRoster) of a key that does not parse leaves a copy, told as a list that could not be read', async () => {
    vi.resetModules();
    const storage = await import('../src/data/storage');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = '[{"id":"a","character":{"name":"Ayla"}},{"id":"b","charac';
    localStorage.setItem(ROSTER_KEY, broken);
    storage.clearRoster();
    expect(localStorage.getItem(ROSTER_KEY)).toBeNull();
    expect(copiesNow().map((k) => localStorage.getItem(k))).toEqual([broken]);
    expect(storage.rosterUnreadCounts()).toEqual({ entries: 0, lists: 1 });
    expect(storage.rosterResetCopies()).toBe(0);
    // A value too large to sit beside its copy is copied into the space the key freed.
    localStorage.clear();
    localStorage.setItem(ROSTER_KEY, broken);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith(UNREADABLE_PREFIX) && localStorage.getItem(ROSTER_KEY) !== null) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, k, v);
    });
    storage.clearRoster();
    expect(localStorage.getItem(ROSTER_KEY)).toBeNull();
    expect(copiesNow().map((k) => localStorage.getItem(k))).toEqual([broken]);
  });

  it('a crash reset that cannot make any copy (storage full) puts the roster back instead of losing it', async () => {
    vi.resetModules();
    const storage = await import('../src/data/storage');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored = JSON.stringify([pc('a', 'Ayla'), pc('b', 'Bren')]);
    localStorage.setItem(ROSTER_KEY, stored);
    localStorage.setItem('wanderers-codex:active:v1', 'a');
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith(UNREADABLE_PREFIX)) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, k, v);
    });
    storage.clearRoster();
    expect(localStorage.getItem(ROSTER_KEY)).toBe(stored);
    expect(copiesNow()).toEqual([]);
    expect(localStorage.getItem('wanderers-codex:active:v1')).toBeNull();
  });

  it('a crash reset of an empty roster ("[]") leaves no copy and no notice', async () => {
    vi.resetModules();
    const storage = await import('../src/data/storage');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(ROSTER_KEY, '[]');
    storage.clearRoster();
    expect(localStorage.getItem(ROSTER_KEY)).toBeNull();
    expect(copiesNow()).toEqual([]);
    expect(storage.rosterUnreadCounts()).toEqual({ entries: 0, lists: 0 });
    expect(storage.rosterResetCopies()).toBe(0);
  });

  it('a crash reset of a readable roster keeps it under a reset copy, and the notice says so without calling it unreadable', async () => {
    vi.resetModules();
    const storage = await import('../src/data/storage');
    const { unreadNotice } = await import('../src/sheet/RosterScreen');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored = JSON.stringify([pc('a', 'Ayla'), pc('b', 'Bren')]);
    localStorage.setItem(ROSTER_KEY, stored);
    storage.clearRoster();
    expect(localStorage.getItem(ROSTER_KEY)).toBeNull();
    const copies = copiesNow();
    expect(copies.map((k) => localStorage.getItem(k))).toEqual([stored]);
    expect(copies[0].startsWith(`${UNREADABLE_PREFIX}local:reset:`)).toBe(true);
    expect(storage.rosterUnreadCounts()).toEqual({ entries: 0, lists: 0 }); // never "could not be read"
    expect(storage.rosterResetCopies()).toBe(1);
    const line = unreadNotice({ ...storage.rosterUnreadCounts(), resets: storage.rosterResetCopies() });
    expect(line).toBe('Characters saved before a reset are kept on this device; Settings → Export everything saves a copy.');
    expect(line).not.toMatch(/could not be read|can't be read/);
    // "Export everything" carries it, and the scans that delete by "nothing uses it" still see it.
    const backup = await import('../src/data/backup');
    expect(backup.parseBackup(backup.createBackup()).data[copies[0]]).toBe(stored);
    expect(storage.rosterUnshownText()).toContain('Bren');
    // The notice text with nothing kept is unchanged ('' and the old one-list wording).
    expect(unreadNotice({ entries: 0, lists: 0 })).toBe('');
    expect(unreadNotice({ entries: 0, lists: 1 })).toBe('A saved character list could not be read. It is kept unchanged; Settings → Export everything saves a copy.');
    // Wiring: the Characters screen passes the reset count to the notice.
    expect(readFileSync(`${process.cwd()}/src/sheet/RosterScreen.tsx`, 'utf8')).toMatch(/\{ \.\.\.rosterUnreadCounts\(\), resets: rosterResetCopies\(\) \}/);
  });

  it('normalize fills missing proficiency ranks on a copy, never in the stored entry it reads', async () => {
    vi.resetModules();
    const { normalizeCharacter } = await import('../src/rules/normalize');
    const stored = { name: 'Ayla', proficiencies: { saves: {}, attacks: {}, defenses: {} } };
    const before = JSON.stringify(stored);
    const out = normalizeCharacter(stored);
    expect(JSON.stringify(stored)).toBe(before);
    expect(Object.keys(out.proficiencies.saves).length).toBeGreaterThan(0);
  });
});
