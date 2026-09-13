// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeCharacter, normalizePlay } from '../src/rules/normalize';
import type { CloudBundle, SavedChar } from '../src/data/storage';

/**
 * THE "SOMETHING I DO IN THE INVENTORY GETS OVERWRITTEN AFTER A SECOND" BUG (2026-09-13).
 *
 * A pull or a push reads localStorage BEFORE its network leg and adopts the result AFTER it. The player
 * keeps playing through those hundreds of milliseconds, so anything edited during the roundtrip (or
 * still sitting in the 400 ms persist debounce when local was read) was written back over: reverted in
 * localStorage, reverted on screen by applyRoster, then re-persisted and stamped as the newest copy —
 * and, because push cleared `dirty` after the upload, never uploaded either. Third report of this shape
 * (the first two were the derived-refresh stamp and the customization repaint; see cloudSync.ts).
 *
 * Every leg below drives the real cloudSync against a fake supabase whose pull can be held open, so the
 * "network is in the air" window is exact instead of timing-dependent.
 */

const sb = vi.hoisted(() => {
  type Chan = { on: (evt: string, filter: unknown, cb: () => void) => Chan; subscribe: () => Chan };
  const state = {
    /** The row in `user_data` (what a pull returns / a push overwrites). */
    cloudRow: null as CloudBundle | null,
    /** Every bundle uploaded, deep-copied at upload time. */
    upserts: [] as CloudBundle[],
    /** When set, the NEXT select hangs until this is released — the network wait. */
    hold: null as { promise: Promise<void>; release: () => void } | null,
    /** Realtime handlers cloudSync registered (another device wrote the row). */
    realtime: [] as (() => void)[],
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            const h = state.hold;
            if (h) {
              state.hold = null;
              await h.promise;
            }
            return { data: state.cloudRow ? { data: state.cloudRow } : null, error: null };
          },
        }),
      }),
      upsert: async (row: { user_id: string; data: CloudBundle }) => {
        const copy = JSON.parse(JSON.stringify(row.data)) as CloudBundle;
        state.upserts.push(copy);
        state.cloudRow = copy;
        return { error: null };
      },
    }),
    channel: () => {
      const ch: Chan = {
        on: (_evt, _filter, cb) => {
          state.realtime.push(cb);
          return ch;
        },
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: () => {},
  };
  return { state, client };
});

vi.mock('../src/data/supabase', () => ({
  supabase: sb.client,
  isCloudConfigured: true,
  isCloudSyncEnabled: true,
}));

const PERSIST_MS = 400; // persist.ts PERSIST_DEBOUNCE_MS
const PUSH_MS = 3000; // cloudSync.ts LIVE_PUSH_DEBOUNCE_MS

/** A character carrying one inventory row, so "the player changed something in the inventory" is a
 *  single readable number. Normalized up front so a storage round trip changes nothing (the sync's
 *  edit detection is a JSON fingerprint). */
const hero = (quantity: number): SavedChar =>
  ({
    id: 'c1',
    character: normalizeCharacter({ id: 'c1', name: 'Hero', inventory: [{ instanceId: 'inv-1', itemId: 'test-flask', quantity }] }),
    play: normalizePlay({}),
  }) as SavedChar;

/** A second character, as if another device had just added one. */
const other = (): SavedChar =>
  ({ id: 'c2', character: normalizeCharacter({ id: 'c2', name: 'From The Other Device' }), play: normalizePlay({}) }) as SavedChar;

/** How many flasks the roster says c1 is carrying. */
const flasks = (roster: SavedChar[] | undefined): number | undefined => roster?.find((c) => c.id === 'c1')?.character.inventory?.[0]?.quantity;

/** Let every queued promise settle (the fake network resolves through several awaits). */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
}

/** Hold the next pull open; returns the release. */
function holdPull(): () => Promise<void> {
  let release = () => {};
  const promise = new Promise<void>((res) => {
    release = res;
  });
  sb.state.hold = { promise, release };
  return async () => {
    release();
    await settle();
  };
}

type Booted = {
  storage: typeof import('../src/data/storage');
  persist: typeof import('../src/data/persist');
  syncBus: typeof import('../src/data/syncBus');
  applied: SavedChar[][];
  stop: () => void;
};
let booted: Booted | null = null;

/**
 * A signed-in device that already holds one character and has finished its opening sync — i.e. exactly
 * the state the owner is in when he edits something. Fresh module registry each time, because cloudSync
 * keeps its dirty/fingerprint state at module scope.
 */
async function boot(): Promise<Booted> {
  vi.resetModules();
  const storage = await import('../src/data/storage');
  const persist = await import('../src/data/persist');
  const syncBus = await import('../src/data/syncBus');
  const sync = await import('../src/data/cloudSync');
  storage.saveRoster([hero(1)]);
  storage.saveCharUpdated({ c1: 1000 });
  persist.setupPersist(storage.saveRoster, () => {}); // what App.tsx wires up
  const applied: SavedChar[][] = [];
  const stop = await sync.startCloudSync((r) => applied.push(r)); // opening pull + push
  await settle();
  booted = { storage, persist, syncBus, applied, stop };
  return booted;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sb.state.cloudRow = null;
  sb.state.upserts = [];
  sb.state.hold = null;
  sb.state.realtime = [];
});

afterEach(() => {
  booted?.stop();
  booted = null;
  vi.useRealTimers();
});

describe('an edit made while a sync is on the network is never overwritten', () => {
  // bug 2026-09-13: edits overwritten by the sync roundtrip
  it('leg 1 — edit during the PUSH roundtrip survives in storage, on screen, and reaches the cloud', async () => {
    const t = await boot();
    // Edit A: the player changes the inventory. It persists and schedules the upload.
    t.persist.schedulePersist([hero(2)]);
    await vi.advanceTimersByTimeAsync(PERSIST_MS);
    const holds = holdPull();
    await vi.advanceTimersByTimeAsync(PUSH_MS); // push starts; its re-pull is now hanging
    expect(flasks(sb.state.upserts.at(-1)?.roster)).toBe(1); // nothing uploaded yet beyond the opening sync

    // Edit B: the player keeps playing while the network is in the air, and it persists.
    t.persist.schedulePersist([hero(3)]);
    await vi.advanceTimersByTimeAsync(PERSIST_MS);
    const stampB = Date.now();
    // Meanwhile another device added a character, so the adopt below has something real to apply.
    sb.state.cloudRow = { ...(sb.state.cloudRow as CloudBundle), roster: [hero(1), other()], charUpdated: { c1: 1000, c2: 2000 } };
    const appliedBefore = t.applied.length;
    await holds();

    expect(flasks(t.storage.loadRoster())).toBe(3); // storage kept edit B
    expect(t.storage.loadCharUpdated().c1).toBe(stampB); // …stamped as B's edit, not rolled back to A's
    const handed = t.applied.slice(appliedBefore);
    expect(handed.length).toBeGreaterThan(0); // the other device's character has to be applied
    for (const r of handed) {
      expect(flasks(r)).toBe(3); // …and no roster handed to React may have dropped edit B
      expect(r.find((c) => c.id === 'c2')).toBeTruthy();
    }
    // dirty stayed true and a push is pending, so the newer local state still reaches the cloud.
    const uploads = sb.state.upserts.length;
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(sb.state.upserts.length).toBe(uploads + 1);
    expect(flasks(sb.state.upserts.at(-1)?.roster)).toBe(3);
  });

  // bug 2026-09-13: edits overwritten by the sync roundtrip
  it('leg 2 — an edit still inside the 400 ms persist debounce when the push starts goes up with it', async () => {
    const t = await boot();
    t.persist.schedulePersist([hero(2)]);
    await vi.advanceTimersByTimeAsync(PERSIST_MS); // edit A → push scheduled PUSH_MS from here
    await vi.advanceTimersByTimeAsync(PUSH_MS - 200);
    t.persist.schedulePersist([hero(3)]); // edit B: due to persist 200 ms AFTER the push starts
    expect(flasks(t.storage.loadRoster())).toBe(2); // …so it is NOT in localStorage yet
    expect(t.persist.hasPendingPersist()).toBe(true);

    const uploads = sb.state.upserts.length;
    await vi.advanceTimersByTimeAsync(200); // the push fires with edit B still pending
    await settle();

    expect(sb.state.upserts.length).toBe(uploads + 1);
    expect(flasks(sb.state.upserts.at(-1)?.roster)).toBe(3); // push flushed the debounce before reading local
    expect(flasks(t.storage.loadRoster())).toBe(3); // and nothing wrote the older copy back over it
  });

  // bug 2026-09-13: edits overwritten by the sync roundtrip
  it('leg 3 — edit during the PULL a Realtime echo triggers survives', async () => {
    const t = await boot();
    expect(sb.state.realtime.length).toBeGreaterThan(0);
    const holds = holdPull();
    sb.state.realtime[0](); // another device wrote the row (or our own push echoed back)
    await settle();

    t.persist.schedulePersist([hero(5)]); // the player edits while that pull is in the air
    await vi.advanceTimersByTimeAsync(PERSIST_MS);
    await holds();

    expect(flasks(t.storage.loadRoster())).toBe(5);
    for (const r of t.applied) expect(flasks(r)).toBe(5);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(flasks(sb.state.upserts.at(-1)?.roster)).toBe(5);
  });

  // bug 2026-09-13: edits overwritten by the sync roundtrip
  it('leg 4 — a push asked for while one is in flight is re-queued, not dropped', async () => {
    const t = await boot();
    t.persist.schedulePersist([hero(2)]);
    await vi.advanceTimersByTimeAsync(PERSIST_MS);
    const holds = holdPull();
    await vi.advanceTimersByTimeAsync(PUSH_MS); // push #1 in flight, hanging on its re-pull

    // A NON-roster local change (homebrew / modes / settings all arrive this way) during the flight:
    // its push lands while `syncing` is true. Nothing else would carry it up, so if that request is
    // dropped — or if the in-flight push clears `dirty` after its upload — it stays local forever.
    t.syncBus.saveCustomizationUpdated(4242);
    t.syncBus.markLocalDataChanged();
    await vi.advanceTimersByTimeAsync(PUSH_MS); // the re-queued push tries while #1 is still in flight

    const uploads = sb.state.upserts.length;
    await holds();
    expect(sb.state.upserts.length).toBe(uploads + 1); // push #1 landed…
    expect(sb.state.upserts.at(-1)?.customizationUpdated ?? 0).not.toBe(4242); // …with the older snapshot

    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(sb.state.upserts.length).toBe(uploads + 2); // …and the re-queued one ran afterwards
    expect(sb.state.upserts.at(-1)?.customizationUpdated).toBe(4242);
  });

  // bug 2026-09-13: edits overwritten by the sync roundtrip
  it('leg 5 — a genuinely newer copy from another device is still adopted (local does NOT always win)', async () => {
    const t = await boot();
    sb.state.cloudRow = { ...(sb.state.cloudRow as CloudBundle), roster: [hero(9)], charUpdated: { c1: 5000 } };
    sb.state.realtime[0]();
    await settle();

    expect(flasks(t.storage.loadRoster())).toBe(9);
    expect(flasks(t.applied.at(-1))).toBe(9);
    expect(t.storage.loadCharUpdated().c1).toBe(5000);
  });

  // bug 2026-09-13: edits overwritten by the sync roundtrip
  it('leg 7 — a roster another TAB wrote during the roundtrip is kept and still reaches the cloud', async () => {
    const t = await boot();
    const holds = holdPull();
    sb.state.realtime[0]();
    await settle(); // a pull is in the air

    // A second context (another browser tab, or a dev tab open beside the Tauri webview — the case
    // App.tsx's cross-tab guard exists for) writes the roster key itself. Nothing in THIS context ran
    // noteRosterChange, so `dirty` is false: the only thing that can carry this up is adopt noticing
    // that its re-merge preferred the local copy.
    t.storage.saveRoster([hero(7)]);
    t.storage.saveCharUpdated({ c1: Date.now() });
    await holds();

    expect(flasks(t.storage.loadRoster())).toBe(7);
    expect(flasks(t.applied.at(-1))).toBe(7); // and React is handed the other tab's roster
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(flasks(sb.state.upserts.at(-1)?.roster)).toBe(7);
  });

  // bug 2026-09-13: edits overwritten by the sync roundtrip
  it('leg 8 — an edit still inside the 400 ms persist debounce when the roundtrip LANDS is not written over', async () => {
    // The sibling of leg 2: there, the edit was pending when the push STARTED (push's own flushPersist
    // catches that one). Here it is pending when the network comes BACK, so the only thing standing
    // between the player and a reverted inventory is adopt() flushing the debounce before it re-merges.
    const t = await boot();
    const holds = holdPull();
    sb.state.realtime[0](); // a pull goes on the network
    await settle();
    // Another device added a character, so the adopt that follows really does hand React a roster.
    sb.state.cloudRow = { ...(sb.state.cloudRow as CloudBundle), roster: [hero(1), other()], charUpdated: { c1: 1000, c2: 2000 } };

    t.persist.schedulePersist([hero(6)]); // the player edits…
    expect(t.persist.hasPendingPersist()).toBe(true); // …and it is still inside the debounce…
    await holds(); // …when the pull lands and adopt runs

    expect(flasks(t.storage.loadRoster())).toBe(6); // storage keeps the edit
    expect(flasks(t.applied.at(-1))).toBe(6); // and the screen is not rolled back to the old quantity
    expect(t.applied.at(-1)?.find((c) => c.id === 'c2')).toBeTruthy(); // …while still gaining c2
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(flasks(sb.state.upserts.at(-1)?.roster)).toBe(6); // and it reaches the cloud
  });

  // bug 2026-09-13: edits overwritten by the sync roundtrip
  it('leg 9 — two pushes fired in one tick (blur + pagehide on close) do not both go on the network', async () => {
    // Closing/backgrounding the app fires blur, pagehide and visibilitychange→hidden in the SAME task,
    // and each calls flushPush() → push(). Unless `syncing` is claimed before the first await, both get
    // past the guard, snapshot local at different instants and race their upserts — whichever lands
    // last wins the cloud row, so the later snapshot's edits can be overwritten by the earlier one's.
    const t = await boot();
    t.persist.schedulePersist([hero(2)]);
    await vi.advanceTimersByTimeAsync(PERSIST_MS); // dirty, push scheduled but not yet fired
    const holds = holdPull();
    const uploads = sb.state.upserts.length;

    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('pagehide'));
    await settle(); // push #1 is hanging on its re-pull; push #2 must NOT have run its own

    expect(sb.state.upserts.length).toBe(uploads); // neither has uploaded yet
    await holds();
    expect(sb.state.upserts.length).toBe(uploads + 1); // exactly one upload, not two racing copies
    expect(flasks(sb.state.upserts.at(-1)?.roster)).toBe(2);
  });

  // bug 2026-09-13: edits overwritten by the sync roundtrip
  it('leg 10 — a character DELETED during the roundtrip is not resurrected by the re-merge', async () => {
    // adopt()'s re-merge is a UNION, and the bundle the network leg is carrying still contains the
    // character. Only the deletion tombstone noteRosterChange records keeps it dead — so a delete made
    // during the roundtrip is the one direction where "re-merge against local" could un-do the player.
    const t = await boot();
    t.persist.schedulePersist([hero(2)]);
    await vi.advanceTimersByTimeAsync(PERSIST_MS);
    const holds = holdPull();
    await vi.advanceTimersByTimeAsync(PUSH_MS); // push in flight, carrying a snapshot that HAS c1
    t.persist.persistNow([]); // the player deletes the character while the network is in the air
    await holds();
    expect(t.storage.loadRoster()).toEqual([]); // adopt's union must not bring c1 back
    for (const r of t.applied) expect(r.find((c) => c.id === 'c1')).toBeFalsy();
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(sb.state.upserts.at(-1)?.roster).toEqual([]);
  });

  // bug 2026-09-13: edits overwritten by the sync roundtrip
  it('leg 6 — nothing changed anywhere → adopt applies nothing and uploads nothing (incident 2 invariant)', async () => {
    const t = await boot();
    const applied = t.applied.length;
    const uploads = sb.state.upserts.length;
    sb.state.realtime[0]();
    await settle();
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(t.applied.length).toBe(applied);
    expect(sb.state.upserts.length).toBe(uploads);
  });
});
