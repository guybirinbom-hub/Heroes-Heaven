// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GM-DEVICE SYNC FOR THE INITIATIVE TRACKER (owner's ruling 2, 2026-09-16): the GM plays off
 * localStorage, and src/data/trackerSync.ts mirrors the GM's keys to that GM's OTHER devices —
 * owner-only, never to players.
 *
 * The leg that matters most is `d`. This app has been caught overwriting a user's change three times,
 * every time through the same window: a network leg reads localStorage BEFORE the wait and writes the
 * result back AFTER it, while the user keeps playing through it. Here the user is the GM and the data
 * is the live board, so the same window means "the monster I just added to the fight disappears a
 * second later". Two things close it — a pull flushes the combat store's 200 ms persist debounce
 * before it decides anything (an edit inside the debounce is a real edit), and a key with an unsent
 * local change is never applied over, it is pushed instead.
 */

const sb = vi.hoisted(() => {
  type Row = { key: string; value: unknown; updated_at: string };
  type Chan = { on: (evt: string, filter: unknown, cb: () => void) => Chan; subscribe: (cb?: (s: string) => void) => Chan };
  const state = {
    /** The `gm_tracker_state` rows for this account, by key. */
    rows: new Map<string, Row>(),
    /** Every upsert batch, deep-copied at upload time. */
    upserts: [] as Row[][],
    /** When set, the NEXT select hangs until it is released — the network wait. */
    hold: null as { promise: Promise<void> } | null,
    /** When set, the next upsert COMMITS its rows and then hangs before answering — the window in
     *  which Realtime can deliver our own write back to us before we know its server timestamp. */
    holdPush: null as { promise: Promise<void> } | null,
    /** Make the next upsert fail (offline / RLS / quota). */
    failPush: false,
    /** The SERVER's clock, which is the only one that orders anything. Offset from this device's
     *  (fake) clock, so a test can run the client fast or slow and watch it not matter. */
    skewMs: 0,
    /** Realtime handlers trackerSync registered. Called with a payload (`{ new: row }`) the way the
     *  real client calls them, or with nothing at all for the legs that only care that it fired. */
    realtime: [] as ((payload?: unknown) => void)[],
    /** The status callbacks handed to `.subscribe()`. The real client calls one with 'SUBSCRIBED'
     *  on every connect AND every reconnect; this used to be dropped on the floor, so the branch
     *  that re-pulls after a dropped socket had no test at all. */
    subscribed: [] as ((status: string) => void)[],
    /** Every table name the client was asked for (proves the no-uid no-op touches nothing). */
    tablesTouched: [] as string[],
    /** How many SELECTs went out — the cost of the mirror, which ruling 2 asked to keep down. */
    selects: 0,
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'gm-1' } }, error: null }) },
    from: (table: string) => {
      state.tablesTouched.push(table);
      return {
        select: () => ({
          eq: async () => {
            state.selects += 1;
            // Read AT REQUEST TIME, as a real query does. A change made while this is on the network
            // is not in what it carries — which is the whole reason an event that lands mid-pull has
            // to be re-run afterwards rather than dropped.
            const snapshot = [...state.rows.values()].map((r) => ({ ...r }));
            const h = state.hold;
            if (h) {
              state.hold = null;
              await h.promise;
            }
            return { data: snapshot, error: null };
          },
        }),
        // THE SERVER STAMPS updated_at (supabase-gm-tracker-state.sql's trigger), whatever the client
        // sends — so this deliberately overwrites anything on the incoming row, and hands the stamped
        // value back through .select(), which is the only way a client can learn it.
        upsert: (rows: ({ key: string; value: unknown; owner_id: string } & { updated_at?: string })[]) => ({
          select: async () => {
            if (state.failPush) {
              // A failing upload can be held too — the GM keeps playing while it is in flight, and
              // what those edits do to the retry schedule is the thing leg f pins down.
              const hf = state.holdPush;
              if (hf) {
                state.holdPush = null;
                await hf.promise;
              }
              return { data: null, error: { message: 'offline' } };
            }
            const at = new Date(Date.now() + state.skewMs).toISOString();
            const copy = (JSON.parse(JSON.stringify(rows)) as Row[]).map((r) => ({ ...r, updated_at: at }));
            state.upserts.push(copy);
            // Committed BEFORE the answer is sent — which is what lets the WAL event overtake it.
            for (const r of copy) state.rows.set(r.key, { key: r.key, value: r.value, updated_at: r.updated_at });
            const h = state.holdPush;
            if (h) {
              state.holdPush = null;
              await h.promise;
            }
            return { data: copy.map((r) => ({ key: r.key, updated_at: r.updated_at })), error: null };
          },
        }),
      };
    },
    channel: () => {
      const ch: Chan = {
        on: (_evt, _filter, cb) => {
          state.realtime.push(cb);
          return ch;
        },
        subscribe: (cb) => {
          if (cb) state.subscribed.push(cb); // the real client calls it with SUBSCRIBED — leg u drives it
          return ch;
        },
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

const PUSH_MS = 3000; // trackerSync.ts PUSH_DEBOUNCE_MS
const COMBAT_MS = 200; // combatStore.ts schedulePersist debounce
/** PER ACCOUNT: one device, one localStorage, and a second GM signing in must not inherit the first
 *  one's history (which is what tells the mirror a key has already been reconciled). */
const stampKeyFor = (uid: string): string => `wanderers-codex:tracker-sync:v2:${uid}`;
const STAMP_KEY = stampKeyFor('gm-1');
const NOW = '2026-09-16T12:00:00.000Z';
const HOUR_AGO = '2026-09-16T11:00:00.000Z';
const TWO_HOURS_AGO = '2026-09-16T10:00:00.000Z';
const AN_HOUR_FROM_NOW = '2026-09-16T13:00:00.000Z';
/** 45 seconds BEFORE this device's own clock: the other GM device is slow, so its perfectly real,
 *  perfectly newer edit carries a timestamp that reads as "in the past" here. */
const SKEWED_PAST = '2026-09-16T11:59:15.000Z';
/** The SAME instant, spelled the way PostgREST hands a timestamptz back: microseconds and a +00:00
 *  offset instead of milliseconds and a Z. String-equal to nothing we ever sent — so an echo check
 *  that compares the text instead of the instant misses its own push and re-adopts it forever. */
const asPostgresSpellsIt = (iso: string): string => iso.replace('Z', '000+00:00');

type Booted = {
  sync: typeof import('../src/data/trackerSync');
  combat: typeof import('../tracker/src/store/combatStore');
  dm: typeof import('../tracker/src/store/dmAverageStore');
  bus: typeof import('../tracker/src/store/persistBus');
  ready: Promise<void>;
  stop: () => void;
};
let booted: Booted | null = null;

/** Let every queued promise settle (the fake network resolves through several awaits). */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
}

/** Hold the next select open; returns the release. */
function holdPull(): () => Promise<void> {
  let release = () => {};
  const promise = new Promise<void>((res) => {
    release = res;
  });
  sb.state.hold = { promise };
  return async () => {
    release();
    await settle();
  };
}

/** Hold the next upsert's ANSWER open (its rows are already committed); returns the release. */
function holdPush(): () => Promise<void> {
  let release = () => {};
  const promise = new Promise<void>((res) => {
    release = res;
  });
  sb.state.holdPush = { promise };
  return async () => {
    release();
    await settle();
  };
}

/** A signed-in GM device. Fresh module registry each time: both trackerSync and the tracker stores
 *  keep their state at module scope. `awaitReady: false` leaves the opening pull on the network. */
async function boot(opts: { uid?: string | null; awaitReady?: boolean } = {}): Promise<Booted> {
  vi.resetModules();
  const combat = await import('../tracker/src/store/combatStore');
  const dm = await import('../tracker/src/store/dmAverageStore');
  const bus = await import('../tracker/src/store/persistBus');
  const sync = await import('../src/data/trackerSync');
  const { stop, ready } = sync.startTrackerSync({ uid: opts.uid === undefined ? 'gm-1' : opts.uid });
  if (opts.awaitReady !== false) {
    await ready;
    await settle();
  }
  booted = { sync, combat, dm, bus, ready, stop };
  return booted;
}

/** The keys of one upsert batch. */
const keysOf = (batch: Row[] | undefined): string[] => (batch ?? []).map((r) => r.key);
type Row = { key: string; value: unknown; updated_at: string };
/** Every key pushed across every batch. */
const allPushedKeys = (): string[] => sb.state.upserts.flatMap(keysOf);
/** A one-combatant board, the shape loadPersistedCombat expects. */
const boardOf = (name: string) => ({
  combatants: [{ id: 'x', name, conditions: [] }],
  round: 1,
  activeIndex: 0,
  inCombat: true,
  selectedId: null,
  cidCounter: 1,
  condCounter: 0,
});
/** The names on the board this device is showing. */
const onBoard = (t: Booted): string[] => t.combat.useCombatStore.getState().combatants.map((c) => c.name);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  localStorage.clear();
  sb.state.rows.clear();
  sb.state.upserts = [];
  sb.state.hold = null;
  sb.state.holdPush = null;
  sb.state.failPush = false;
  sb.state.skewMs = 0;
  sb.state.realtime = [];
  sb.state.subscribed = [];
  sb.state.tablesTouched = [];
  sb.state.selects = 0;
});

afterEach(() => {
  booted?.stop();
  booted = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('trackerSync — mirroring the GM board between that GM own devices', () => {
  it('a — a local change becomes ONE upsert after the debounce, however many edits it took', async () => {
    const t = await boot();
    expect(sb.state.upserts).toHaveLength(0); // nothing local yet, nothing to say

    t.dm.useDmAverageStore.getState().addTurns(30, 1);
    await vi.advanceTimersByTimeAsync(1000);
    t.dm.useDmAverageStore.getState().addTurns(40, 1);
    await vi.advanceTimersByTimeAsync(1000);
    t.dm.useDmAverageStore.getState().addTurns(50, 1); // three edits inside one window

    expect(sb.state.upserts).toHaveLength(0); // …and nothing on the network while the GM is typing
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();

    expect(sb.state.upserts).toHaveLength(1);
    expect(keysOf(sb.state.upserts[0])).toEqual(['pf2e-dm-turn-average']); // coalesced: one row, not three
    expect((sb.state.upserts[0][0].value as { turnCount: number }).turnCount).toBe(3);
  });

  it('b — a NEWER remote row on a clean key is applied and the store reloads', async () => {
    localStorage.setItem('pf2e-dm-turn-average', JSON.stringify({ avgSeconds: 1, turnCount: 1, history: [] }));
    localStorage.setItem(STAMP_KEY, JSON.stringify({ 'pf2e-dm-turn-average': { remote: TWO_HOURS_AGO } }));
    sb.state.rows.set('pf2e-dm-turn-average', {
      key: 'pf2e-dm-turn-average',
      value: { avgSeconds: 42, turnCount: 7, history: [] },
      updated_at: HOUR_AGO,
    });

    const t = await boot();

    expect(t.dm.useDmAverageStore.getState().turnCount).toBe(7); // the store, not just storage
    expect(JSON.parse(localStorage.getItem('pf2e-dm-turn-average')!).avgSeconds).toBe(42);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(allPushedKeys()).not.toContain('pf2e-dm-turn-average'); // adopting is not an edit
  });

  /*
   * CLOCK SKEW. The two GM devices' wall clocks are never going to agree, and the ordering between
   * them may not rest on that. The other device is 45 s slow: its edit is genuinely newer, but its
   * timestamp reads as older than this device's own last change. Ordering by the client clock — what
   * this did — made THIS device "correct" the cloud with its own stale board, every round, silently:
   * the other GM's work was destroyed and existed nowhere any more. The fast clock always won.
   *
   * `local` is left in the seeded stamp on purpose: it is what the old rule compared against, so
   * re-adding `if (st?.local && ms(row.updated_at) <= ms(st.local)) { markDirty(row.key); continue; }`
   * to pullAll reproduces it exactly —
   *   AssertionError: expected 1 to be 42   ← the other device's edit, gone from this device…
   *   AssertionError: expected [ 'pf2e-dm-turn-average' ] not to contain 'pf2e-dm-turn-average'
   *                                          ← …and about to be gone from the cloud too.
   */
  it('c — the other device wins on the SERVER clock, however wrong this device thinks the time is', async () => {
    localStorage.setItem('pf2e-dm-turn-average', JSON.stringify({ avgSeconds: 1, turnCount: 1, history: [] }));
    localStorage.setItem(STAMP_KEY, JSON.stringify({ 'pf2e-dm-turn-average': { local: NOW, remote: TWO_HOURS_AGO } }));
    sb.state.rows.set('pf2e-dm-turn-average', {
      key: 'pf2e-dm-turn-average',
      value: { avgSeconds: 42, turnCount: 42, history: [] },
      updated_at: SKEWED_PAST,
    });

    const t = await boot();

    expect(t.dm.useDmAverageStore.getState().turnCount).toBe(42); // the other device's real edit
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(allPushedKeys()).not.toContain('pf2e-dm-turn-average'); // and this device doesn't undo it
  });

  /*
   * FIRST CONTACT — the rollout open of the second GM device, and every reinstall. There is no stamp,
   * so there is no shared history and nothing says which copy is later. Adopting the cloud outright
   * (what this did) deleted whatever the device had built on its own; whichever device pushed first
   * won, and the loser's saved encounters, homebrew and notes were gone with no prompt and no undo.
   * Dropping `firstContact` for a plain `applyRemote(row)`:
   *   AssertionError: expected 1 to be 7                 ← this device's own turn averages, gone
   *   AssertionError: expected [ "Dragon's lair" ] to deeply equal [ 'Ambush at the ford', "Dragon's lair" ]
   */
  it('i — meeting a key for the first time keeps BOTH devices’ work', async () => {
    localStorage.setItem('pf2e-dm-turn-average', JSON.stringify({ avgSeconds: 30, turnCount: 7, history: [] }));
    localStorage.setItem('pf2e-encounters', JSON.stringify({ 'Ambush at the ford': { combatants: [] } }));
    // An EMPTY board for a campaign is not work: the other device's live fight is what the ruling asks
    // to see when this one opens.
    localStorage.setItem('pf2e-current-combat:camp-a', JSON.stringify({ combatants: [], round: 1, activeIndex: 0, inCombat: false, selectedId: null, cidCounter: 0, condCounter: 0 }));
    sb.state.rows.set('pf2e-dm-turn-average', { key: 'pf2e-dm-turn-average', value: { avgSeconds: 1, turnCount: 1, history: [] }, updated_at: TWO_HOURS_AGO });
    sb.state.rows.set('pf2e-encounters', { key: 'pf2e-encounters', value: { "Dragon's lair": { combatants: [] } }, updated_at: TWO_HOURS_AGO });
    sb.state.rows.set('pf2e-current-combat:camp-a', {
      key: 'pf2e-current-combat:camp-a',
      value: { combatants: [{ id: 'x', name: 'Owlbear', conditions: [] }], round: 2, activeIndex: 0, inCombat: true, selectedId: null, cidCounter: 1, condCounter: 0 },
      updated_at: TWO_HOURS_AGO,
    });

    const t = await boot(); // …with no stamp file at all

    expect(t.dm.useDmAverageStore.getState().turnCount).toBe(7); // a singleton: this device's stands
    expect(Object.keys(JSON.parse(localStorage.getItem('pf2e-encounters')!)).sort()).toEqual([
      'Ambush at the ford',
      "Dragon's lair",
    ]);
    expect(JSON.parse(localStorage.getItem('pf2e-current-combat:camp-a')!).combatants).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(allPushedKeys()).toContain('pf2e-encounters'); // the union goes up, so the OTHER device gets it too
    expect(allPushedKeys()).not.toContain('pf2e-dm-turn-average'); // …and the cloud's copy isn't clobbered either
  });

  // THE ROUNDTRIP. A change the GM makes while a pull is in the air is never written over.
  it('d — a monster added DURING the pull survives it, and is the copy that reaches the cloud', async () => {
    const t = await boot();
    t.combat.useCombatStore.getState().setScope('camp-a');
    const KEY = 'pf2e-current-combat:camp-a';
    t.combat.useCombatStore.getState().addCombatant(null, { name: 'Goblin Warrior' });
    await vi.advanceTimersByTimeAsync(COMBAT_MS); // the board is in localStorage and queued for upload
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    sb.state.upserts = [];

    // The OTHER GM device saved a different board — and stamped it LATER than anything this device is
    // about to do, so the timestamp rule alone would hand it the win. Only "this key has an unsent
    // local change" stands between the GM and a board that loses the monster he just added.
    sb.state.rows.set(KEY, {
      key: KEY,
      value: { combatants: [{ id: 'x', name: 'From The Other Device', conditions: [] }], round: 1, activeIndex: 0, inCombat: false, selectedId: null, cidCounter: 1, condCounter: 0 },
      updated_at: AN_HOUR_FROM_NOW,
    });

    const release = holdPull();
    sb.state.realtime[0](); // …and Realtime tells this device to pull it
    await settle();

    // The GM keeps running the fight while that pull is on the network. The board's own persist is on
    // a 200 ms debounce, so at the moment the pull lands this edit is not even in localStorage yet.
    t.combat.useCombatStore.getState().addCombatant(null, { name: 'Goblin Boss' });
    await release();

    const names = t.combat.useCombatStore.getState().combatants.map((c) => c.name);
    expect(names).toContain('Goblin Boss'); // the GM's monster is still on the board…
    expect(names).toContain('Goblin Warrior');
    expect(names).not.toContain('From The Other Device'); // …and was not replaced by the pulled board
    expect(JSON.parse(localStorage.getItem(KEY)!).combatants.map((c: { name: string }) => c.name)).toContain('Goblin Boss');

    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    const pushed = sb.state.upserts.flat().find((r) => r.key === KEY);
    expect(pushed).toBeTruthy();
    expect((pushed!.value as { combatants: { name: string }[] }).combatants.map((c) => c.name)).toContain('Goblin Boss');
  });

  it('e — the echo of our OWN push is ignored (and Postgres re-spelling the timestamp does not fool it)', async () => {
    const t = await boot();
    t.dm.useDmAverageStore.getState().addTurns(60, 2);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(sb.state.upserts).toHaveLength(1);

    // Our own row comes back through Realtime — same instant, spelled the way PostgREST spells it, and
    // (to prove the row is not adopted at all) carrying a value this device never wrote.
    const mine = sb.state.rows.get('pf2e-dm-turn-average')!;
    sb.state.rows.set('pf2e-dm-turn-average', { ...mine, value: { avgSeconds: 777, turnCount: 777, history: [] }, updated_at: asPostgresSpellsIt(mine.updated_at) });
    sb.state.realtime[0]();
    await settle();

    expect(t.dm.useDmAverageStore.getState().turnCount).toBe(2); // unchanged: that was our own echo
  });

  it('f — a failed push keeps the key dirty, comes back by itself, and backs off even mid-fight', async () => {
    const t = await boot();
    sb.state.failPush = true;
    t.dm.useDmAverageStore.getState().addTurns(30, 1);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(sb.state.upserts).toHaveLength(0); // it went nowhere…

    // The retry, 3 s later — also fails, and this time the GM keeps running the fight WHILE it is in
    // flight. That edit calls markDirty → schedulePush() at the plain 3 s debounce, and schedulePush
    // then refused to replace an existing timer — so the backoff the failure asked for never happened
    // and an offline laptop went on trying every 3 s for as long as it stayed offline.
    const releasePush = holdPush();
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    t.dm.useDmAverageStore.getState().addTurns(40, 1);
    await releasePush();
    expect(sb.state.upserts).toHaveLength(0);

    // After two failures the next attempt is 6 s out, not 3 — so there is none here.
    sb.state.failPush = false;
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(sb.state.upserts).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(keysOf(sb.state.upserts[0])).toEqual(['pf2e-dm-turn-average']); // …and it did come back
  });

  it('g — with no account signed in, start is a no-op and the tracker stays purely local', async () => {
    const t = await boot({ uid: null });
    t.dm.useDmAverageStore.getState().addTurns(30, 1);
    await vi.advanceTimersByTimeAsync(PUSH_MS * 2);
    await settle();

    expect(sb.state.tablesTouched).toEqual([]); // ruling 3: the tracker works with no account at all
    expect(sb.state.upserts).toHaveLength(0);
    expect(sb.state.realtime).toHaveLength(0);
    expect(localStorage.getItem(STAMP_KEY)).toBeNull();
    expect(t.dm.useDmAverageStore.getState().turnCount).toBe(1); // …and still saves locally
  });

  it('h — the standalone board, the no-account table and every DEVICE preference are never uploaded', async () => {
    // The bare key is the standalone tracker's own board and `:local` is the signed-out table (ruling
    // 3: no online features — it IS campaign-scoped, so the prefix alone used to catch it and a
    // signed-in GM opening a real campaign shipped their no-account table to every device they own).
    // The rest are per-device settings.
    const NEVER = ['pf2e-current-combat', 'pf2e-current-combat:local', 'pf2e-settings', 'pf2e-custom-themes', 'pf2e-disabled-sources', 'pf2e-gm-layout', 'pf2e-gm-layout:camp-a', 'gmw:notes:camp-a'];
    for (const k of NEVER) localStorage.setItem(k, JSON.stringify({ local: true }));
    localStorage.setItem('pf2e-current-combat:camp-a', JSON.stringify({ combatants: [], round: 1, activeIndex: 0, inCombat: false, selectedId: null, cidCounter: 0, condCounter: 0 }));

    const t = await boot();
    for (const k of NEVER) expect(t.sync.isTrackerSyncKey(k)).toBe(false);
    expect(t.sync.isTrackerSyncKey('pf2e-current-combat:camp-a')).toBe(true);

    for (const k of NEVER) t.bus.notifyPersist(k); // even if a store announced one, nothing queues
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();

    const pushed = allPushedKeys();
    for (const k of NEVER) expect(pushed).not.toContain(k);
    expect(pushed).toContain('pf2e-current-combat:camp-a'); // the campaign board still goes up
  });

  /*
   * OUR OWN WRITE, COMING BACK THE FAST WAY. The row is committed before either the HTTP answer or
   * the WAL event leaves the server, and the websocket often wins. A pull in that gap sees a row this
   * device has no server timestamp for yet — so without `inFlight` it treats its own upload as the
   * other device's change: it reloads the board (the GM's undo history with it) and, on the old apply
   * rule, pushed again, once every 3 s, forever, with nobody touching anything.
   * Dropping `|| inFlight.has(row.key)` from pullAll:
   *   AssertionError: expected false to be true   ← the GM's undo, wiped by their own upload
   */
  it('k — Realtime delivering our own write before the upload answers changes nothing', async () => {
    const t = await boot();
    t.combat.useCombatStore.getState().setScope('camp-a');
    t.combat.useCombatStore.getState().addCombatant(null, { name: 'Goblin Warrior', maxHP: 10 });
    const gob = t.combat.useCombatStore.getState().combatants[0].id;
    t.combat.useCombatStore.getState().applyDamage(gob, 3); // an edit the GM can undo
    await vi.advanceTimersByTimeAsync(COMBAT_MS);

    const releasePush = holdPush();
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(sb.state.upserts).toHaveLength(1); // in flight: committed, not yet answered
    expect(t.combat.useCombatStore.getState().canUndo).toBe(true);

    sb.state.realtime[0](); // the websocket gets there first
    await settle();
    await vi.advanceTimersByTimeAsync(PUSH_MS * 3);
    await settle();
    expect(sb.state.upserts).toHaveLength(1); // no storm…
    expect(t.combat.useCombatStore.getState().canUndo).toBe(true); // …and the board was not reloaded

    await releasePush();
    await vi.advanceTimersByTimeAsync(PUSH_MS * 3);
    await settle();
    expect(sb.state.upserts).toHaveLength(1);
    expect(t.combat.useCombatStore.getState().combatants.map((c) => c.name)).toEqual(['Goblin Warrior']);
  });

  /*
   * Signing out, or leaving the campaign, while a pull is on the network. `pullAll` captured the uid
   * before its await, so clearing it changed nothing: the rows landed afterwards and were written
   * into the stores of a session that no longer exists.
   * Dropping `if (g !== generation) return;`:  AssertionError: expected 9 to be 1
   */
  it('l — a pull still in the air when the session ends is dropped', async () => {
    localStorage.setItem('pf2e-dm-turn-average', JSON.stringify({ avgSeconds: 1, turnCount: 1, history: [] }));
    localStorage.setItem(STAMP_KEY, JSON.stringify({ 'pf2e-dm-turn-average': { remote: TWO_HOURS_AGO } }));
    sb.state.rows.set('pf2e-dm-turn-average', {
      key: 'pf2e-dm-turn-average',
      value: { avgSeconds: 90, turnCount: 9, history: [] },
      updated_at: HOUR_AGO,
    });

    const release = holdPull();
    const t = await boot({ awaitReady: false });
    t.stop();
    await release();

    expect(t.dm.useDmAverageStore.getState().turnCount).toBe(1);
  });

  /*
   * Two seams live at once (a remount over the top of an unmount, StrictMode, a second view). `stop`
   * used to be a silent no-op for the second caller and a full teardown for the first, so the first
   * one's unmount pulled the channel and the persist listener out from under the second, which then
   * mirrored nothing and never said so.
   * Making the second start return a no-op stop again (so nothing can ever bring the mirror down):
   *   AssertionError: expected [ [ { owner_id: 'gm-1', …(3) } ] ] to have a length of +0 but got 1
   */
  it('m — the mirror comes down when the LAST holder lets go, not the first', async () => {
    const t = await boot();
    const second = t.sync.startTrackerSync({ uid: 'gm-1' });
    await second.ready;

    t.stop(); // the first seam unmounts…
    t.dm.useDmAverageStore.getState().addTurns(30, 1);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(allPushedKeys()).toContain('pf2e-dm-turn-average'); // …and the second one still works

    second.stop();
    sb.state.upserts = [];
    t.dm.useDmAverageStore.getState().addTurns(40, 1);
    await vi.advanceTimersByTimeAsync(PUSH_MS * 2);
    await settle();
    expect(sb.state.upserts).toHaveLength(0); // now it really is down
  });

  /*
   * NORMALISING A SAVE IS NOT A GM EDIT — and at a rollout every board on disk is about to be
   * normalised. setScope runs AFTER the opening pull; reloadFromStorage re-reads the file through
   * loadPersistedCombat, which DERIVES countedThisRound / endedThisRound for a board saved before
   * those flags existed; the store's own persist then writes them out. Those bytes differ from what
   * the mirror last saw, so the key went dirty — and a dirty key beats the cloud unconditionally. A
   * device that opened the campaign and touched NOTHING uploaded its yesterday board over the other
   * device's live fight, and then pulled the stale one back down.
   * Dropping `unsubs.push(onScopeChange(onScopeSwitch))` from startTrackerSync:
   *   AssertionError: expected [ 'pf2e-current-combat:camp-a' ] to deeply equal []
   *   AssertionError: expected 'Yesterday Goblin' to be 'Tonight Dragon'   ← in the cloud
   */
  it('n — opening a campaign whose saved board predates a field pushes nothing', async () => {
    const KEY = 'pf2e-current-combat:camp-a';
    // What an older build left on disk: no countedThisRound, no endedThisRound on either combatant.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        combatants: [
          { id: 'c1', name: 'Yesterday Goblin', conditions: [] },
          { id: 'c2', name: 'Yesterday Wolf', conditions: [] },
        ],
        round: 2,
        activeIndex: 1,
        inCombat: true,
        selectedId: null,
        cidCounter: 2,
        condCounter: 0,
      }),
    );
    // We already hold this row, so the pull leaves local alone. The cloud's copy is the OTHER device's
    // live fight, and the only thing that can put it at risk is a write from this one.
    localStorage.setItem(STAMP_KEY, JSON.stringify({ [KEY]: { remote: HOUR_AGO } }));
    sb.state.rows.set(KEY, {
      key: KEY,
      value: { combatants: [{ id: 'x', name: 'Tonight Dragon', conditions: [] }], round: 1, activeIndex: 0, inCombat: true, selectedId: null, cidCounter: 1, condCounter: 0 },
      updated_at: HOUR_AGO,
    });

    const t = await boot();
    t.combat.useCombatStore.getState().setScope('camp-a'); // the GM opens the campaign — and stops there
    await vi.advanceTimersByTimeAsync(COMBAT_MS);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();

    expect(allPushedKeys()).toEqual([]);
    expect((sb.state.rows.get(KEY)!.value as { combatants: { name: string }[] }).combatants[0].name).toBe('Tonight Dragon');
  });

  /*
   * THE LAST THING THE GM DID. The board persists on a 200 ms debounce, so the final action of the
   * evening is always sitting in it when they leave — and the flush that settles it (the seam's
   * `setScope(null)`) happens AFTER this module's teardown, by which time the persist listener is
   * already gone. The key was left clean against the OLDER cloud row, so every later pull skipped it
   * and that edit never went anywhere; the other device kept an older board and overwrote it next.
   * Dropping `flushCombatPersist()` from teardown():
   *   AssertionError: expected [ 'Goblin Warrior' ] to contain 'Goblin Boss'
   */
  it('o — the GM’s last edit before leaving the campaign still reaches the cloud', async () => {
    const t = await boot();
    const KEY = 'pf2e-current-combat:camp-a';
    t.combat.useCombatStore.getState().setScope('camp-a');
    t.combat.useCombatStore.getState().addCombatant(null, { name: 'Goblin Warrior' });
    await vi.advanceTimersByTimeAsync(COMBAT_MS);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(allPushedKeys()).toContain(KEY);

    t.combat.useCombatStore.getState().addCombatant(null, { name: 'Goblin Boss' }); // inside the debounce…
    t.stop(); // …and straight out of the campaign
    await settle();

    const cloud = sb.state.rows.get(KEY)!.value as { combatants: { name: string }[] };
    expect(cloud.combatants.map((c) => c.name)).toContain('Goblin Boss');
  });

  /*
   * A CHANGE THAT LANDS MID-PULL. The rows a pull is carrying were read before that change existed,
   * so an event that arrives while one is in flight cannot be answered by it — and returning early
   * (what the `pulling` guard did) simply threw the event away. The device then sat on a board the
   * other one had already moved past until a focus, a reconnect or an `online` event happened to
   * re-pull; until then its own next edit went up over the change it never saw.
   * Reverting to `if (!client || !owner || pulling) return;`:  AssertionError: expected 8 to be 9
   */
  it('p — a change that lands while a pull is on the network is re-pulled, not dropped', async () => {
    const KEY = 'pf2e-dm-turn-average';
    localStorage.setItem(KEY, JSON.stringify({ avgSeconds: 1, turnCount: 1, history: [] }));
    localStorage.setItem(STAMP_KEY, JSON.stringify({ [KEY]: { remote: TWO_HOURS_AGO } }));
    sb.state.rows.set(KEY, { key: KEY, value: { avgSeconds: 1, turnCount: 1, history: [] }, updated_at: TWO_HOURS_AGO });
    const t = await boot();

    sb.state.rows.set(KEY, { key: KEY, value: { avgSeconds: 8, turnCount: 8, history: [] }, updated_at: HOUR_AGO });
    const release = holdPull();
    sb.state.realtime[0](); // …and the pull for it goes out, and hangs
    await settle();

    sb.state.rows.set(KEY, { key: KEY, value: { avgSeconds: 9, turnCount: 9, history: [] }, updated_at: AN_HOUR_FROM_NOW });
    sb.state.realtime[0](); // the other device saves again, mid-flight
    await release();
    await settle();

    expect(t.dm.useDmAverageStore.getState().turnCount).toBe(9);
  });

  /*
   * TWO ACCOUNTS, ONE DEVICE. The tracker's localStorage is device-global and the stamp file was a
   * single key, so the second GM to sign in inherited the first one's history: every key read as
   * "already reconciled", first contact never ran, and the new account's cloud row simply REPLACED the
   * encounters, creatures and parties on the device. Anything still flagged dirty went up into the
   * wrong account on top of that.
   * Reverting STAMP_PREFIX + uid to one fixed key:
   *   AssertionError: expected [ "GM2's cave" ] to deeply equal [ "GM1's ambush", "GM2's cave" ]
   */
  it('q — a second account signing in on the same device inherits nothing and destroys nothing', async () => {
    localStorage.setItem('pf2e-encounters', JSON.stringify({ "GM1's ambush": { combatants: [] } }));
    const first = await boot({ uid: 'gm-1' });
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(allPushedKeys()).toContain('pf2e-encounters'); // gm-1 seeded gm-1's cloud
    first.stop();

    sb.state.rows.clear(); // gm-2's account, with gm-2's own encounters in it
    sb.state.rows.set('pf2e-encounters', { key: 'pf2e-encounters', value: { "GM2's cave": { combatants: [] } }, updated_at: HOUR_AGO });
    await boot({ uid: 'gm-2' });

    expect(Object.keys(JSON.parse(localStorage.getItem('pf2e-encounters')!)).sort()).toEqual([
      "GM1's ambush",
      "GM2's cave",
    ]);
    expect(localStorage.getItem(stampKeyFor('gm-1'))).not.toBeNull(); // gm-1's history is still gm-1's
  });

  /*
   * THE COST OF THE MIRROR, which is the half of ruling 2 that says "to cut on lag". Every write —
   * including the GM's own — came back through Realtime as "something changed", and the answer to that
   * was a SELECT of every row of every campaign, whose bytes were then thrown away by the echo check.
   * Measured before this: 682 KB pulled for ten damage clicks, on both devices.
   * Dropping the echo check in onRealtimeRow:                 AssertionError: expected 6 to be 1
   * Falling back to pullAll() instead of applying the payload: AssertionError: expected 2 to be 1
   */
  it('r — the GM’s own clicks cost no download, and the other device’s change arrives without one', async () => {
    const KEY = 'pf2e-current-combat:camp-a';
    const t = await boot();
    expect(sb.state.selects).toBe(1); // the opening pull, and that is the lot

    t.combat.useCombatStore.getState().setScope('camp-a');
    t.combat.useCombatStore.getState().addCombatant(null, { name: 'Goblin Warrior', maxHP: 20 });
    const gob = t.combat.useCombatStore.getState().combatants[0].id;
    for (let i = 0; i < 5; i += 1) {
      t.combat.useCombatStore.getState().applyDamage(gob, 1);
      await vi.advanceTimersByTimeAsync(COMBAT_MS);
      await vi.advanceTimersByTimeAsync(PUSH_MS);
      await settle();
      sb.state.realtime[0]({ new: sb.state.rows.get(KEY) }); // the server tells us about our own write
      await settle();
    }
    expect(sb.state.upserts.length).toBeGreaterThan(0);
    expect(sb.state.selects).toBe(1);

    // The same echo with the row dropped for size — Realtime does that over ~1 MB, and a payload with
    // no `value` has to fall back to the pull. Not for OUR row: its timestamp is the one we already
    // hold, and that is knowable from the two columns the event still carries.
    const mine = sb.state.rows.get(KEY)!;
    sb.state.realtime[0]({ new: { key: mine.key, updated_at: mine.updated_at } });
    await settle();
    expect(sb.state.selects).toBe(1);

    // The OTHER device's save. The event carries the row, so it is applied as it stands.
    sb.state.rows.set(KEY, {
      key: KEY,
      value: { combatants: [{ id: 'x', name: 'From The Other Device', conditions: [] }], round: 1, activeIndex: 0, inCombat: false, selectedId: null, cidCounter: 1, condCounter: 0 },
      updated_at: AN_HOUR_FROM_NOW,
    });
    sb.state.realtime[1]({ new: sb.state.rows.get(KEY) });
    await settle();

    expect(t.combat.useCombatStore.getState().combatants.map((c) => c.name)).toEqual(['From The Other Device']);
    expect(sb.state.selects).toBe(1);
  });

  /*
   * "WHEN I OPEN ANOTHER DEVICE I WANT TO BE ABLE TO SEE THE CURRENT ENCOUNTER IF THERE IS ONE."
   * First contact kept this device's copy for every non-mergeable key, and a board is non-mergeable —
   * so the second device opened on whatever fight it last held. Worse, "keep local" also means "don't
   * push", so the live fight it failed to show was left to be overwritten by the next edit either
   * device made. The board is the one key the owner named, and it adopts.
   * Dropping `|| row.key.startsWith(COMBAT_PREFIX)` from firstContact:
   *   AssertionError: expected [ 'Yesterday Goblin' ] to deeply equal [ 'Tonight Dragon' ]
   */
  it('s — a device that already has a board for the campaign still opens on the CURRENT encounter', async () => {
    const KEY = 'pf2e-current-combat:camp-a';
    localStorage.setItem(
      KEY,
      JSON.stringify({ combatants: [{ id: 'c1', name: 'Yesterday Goblin', conditions: [] }], round: 4, activeIndex: 0, inCombat: false, selectedId: null, cidCounter: 1, condCounter: 0 }),
    );
    sb.state.rows.set(KEY, {
      key: KEY,
      value: { combatants: [{ id: 'x', name: 'Tonight Dragon', conditions: [] }], round: 1, activeIndex: 0, inCombat: true, selectedId: null, cidCounter: 1, condCounter: 0 },
      updated_at: HOUR_AGO,
    });

    const t = await boot(); // first contact: no stamp file at all
    t.combat.useCombatStore.getState().setScope('camp-a');

    expect(t.combat.useCombatStore.getState().combatants.map((c) => c.name)).toEqual(['Tonight Dragon']);
    await vi.advanceTimersByTimeAsync(COMBAT_MS);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    expect(allPushedKeys()).toEqual([]); // adopting is not an edit
  });

  /*
   * A STALE PULL, LANDING ON TOP OF A LIVE CHANGE. A select's rows are read at REQUEST time, so a
   * pull still on the network cannot contain anything that happened after it went out — while a
   * Realtime row that arrives meanwhile is applied straight away. The apply rule only ever rejected
   * an EXACT stamp match, so when the held select finally answered, its two-hours-old snapshot had a
   * different timestamp, passed the check, and was written over the board the other GM was playing
   * on: their dragon replaced by last night's goblin, on this device and then in the cloud.
   * Restoring `if (ms(row.updated_at) === ms(st.remote)) return;` in applyRow:
   *   AssertionError: expected [ 'Old Goblin' ] to deeply equal [ 'A DRAGON' ]
   */
  it('t — a pull that answers after a newer row arrived cannot roll the board back', async () => {
    const KEY = 'pf2e-current-combat:camp-a';
    // Both devices agree on last night's board, and this one knows it (a stamp, so no first contact).
    localStorage.setItem(KEY, JSON.stringify(boardOf('Old Goblin')));
    localStorage.setItem(STAMP_KEY, JSON.stringify({ [KEY]: { remote: TWO_HOURS_AGO } }));
    sb.state.rows.set(KEY, { key: KEY, value: boardOf('Old Goblin'), updated_at: TWO_HOURS_AGO });

    const t = await boot();
    t.combat.useCombatStore.getState().setScope('camp-a');
    await vi.advanceTimersByTimeAsync(COMBAT_MS);

    // A pull goes out — an oversized payload, a reconnect, a focus, it doesn't matter which — and
    // hangs on the network holding the rows it read the moment it left.
    const release = holdPull();
    sb.state.realtime[0]();
    await settle();

    // The OTHER GM starts tonight's fight while it is in the air. That event carries the whole row,
    // so it is applied on the spot.
    sb.state.rows.set(KEY, { key: KEY, value: boardOf('A DRAGON'), updated_at: NOW });
    sb.state.realtime[1]({ new: sb.state.rows.get(KEY) });
    await settle();
    expect(onBoard(t)).toEqual(['A DRAGON']);

    await release(); // …and now the held select answers, with the pre-dragon snapshot

    expect(onBoard(t)).toEqual(['A DRAGON']);
    expect(JSON.parse(localStorage.getItem(KEY)!).combatants.map((c: { name: string }) => c.name)).toEqual(['A DRAGON']);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    // …and nothing of the rollback was sent back up either.
    expect(allPushedKeys()).not.toContain(KEY);
    expect((sb.state.rows.get(KEY)!.value as { combatants: { name: string }[] }).combatants[0].name).toBe('A DRAGON');
  });

  /*
   * A KEY THE OTHER DEVICE CREATED WHILE THE SELECT WAS IN FLIGHT — leg t's window, one step further.
   *
   * A pull's rows are read at REQUEST time. A campaign whose first fight starts while that select is on
   * the network is simply not in them, so the "a key the cloud has never seen still has to go up" sweep
   * read this device's freshly ADOPTED board (it arrived by Realtime meanwhile, and was stamped) as one
   * the cloud has never had, and marked it dirty. A dirty key refuses every later row and is uploaded
   * instead: the other GM's next move was rejected here, and 3 s later their live fight was overwritten
   * with the copy this device had adopted from them two minutes earlier. A key carrying a SERVER stamp
   * came from the cloud — its absence from a snapshot means the snapshot is stale, nothing more.
   * Restoring `for (const key of localSyncedKeys()) if (!seen.has(key)) markDirty(key);` in pullAll:
   *   AssertionError: expected [ 'A DRAGON' ] to deeply equal [ 'A LICH' ]   ← their next move, refused
   *   AssertionError: expected [ 'pf2e-current-combat:camp-a' ] not to contain 'pf2e-current-combat:camp-a'
   */
  it('w — a key created after the select went out is not read as one the cloud has never seen', async () => {
    const KEY = 'pf2e-current-combat:camp-a';
    // The only key either device knows about so far, reconciled and quiet.
    localStorage.setItem('pf2e-dm-turn-average', JSON.stringify({ avgSeconds: 1, turnCount: 1, history: [] }));
    localStorage.setItem(STAMP_KEY, JSON.stringify({ 'pf2e-dm-turn-average': { remote: TWO_HOURS_AGO } }));
    sb.state.rows.set('pf2e-dm-turn-average', {
      key: 'pf2e-dm-turn-average',
      value: { avgSeconds: 1, turnCount: 1, history: [] },
      updated_at: TWO_HOURS_AGO,
    });

    const t = await boot();
    t.combat.useCombatStore.getState().setScope('camp-a'); // an empty board, written locally by the scope load
    await vi.advanceTimersByTimeAsync(COMBAT_MS);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    sb.state.upserts = [];

    // A pull goes out — a focus, a reconnect, an oversized payload — and hangs, holding rows that have
    // no camp-a board in them because none existed when it left.
    const release = holdPull();
    sb.state.realtime[0]();
    await settle();

    // The OTHER GM starts tonight's fight. Realtime carries the whole row, so it is adopted here and
    // stamped with the server time it carries.
    sb.state.rows.set(KEY, { key: KEY, value: boardOf('A DRAGON'), updated_at: NOW });
    sb.state.realtime[1]({ new: sb.state.rows.get(KEY) });
    await settle();
    expect(onBoard(t)).toEqual(['A DRAGON']);

    await release(); // …and now the stale select answers, without the key it never saw

    // Their fight moves on. This is the row a dirty key would refuse.
    sb.state.rows.set(KEY, { key: KEY, value: boardOf('A LICH'), updated_at: AN_HOUR_FROM_NOW });
    sb.state.realtime[1]({ new: sb.state.rows.get(KEY) });
    await settle();

    expect(onBoard(t)).toEqual(['A LICH']);
    await vi.advanceTimersByTimeAsync(PUSH_MS * 2);
    await settle();
    // …and nothing of this device's older copy went back up over it.
    expect(allPushedKeys()).not.toContain(KEY);
    expect((sb.state.rows.get(KEY)!.value as { combatants: { name: string }[] }).combatants[0].name).toBe('A LICH');
  });

  /*
   * A RECONNECT HAS TO PULL. Whatever the other device changed while the socket was down produced no
   * event this device will ever see, and the focus/visibility throttle (4 s) is exactly what a quick
   * drop-and-reconnect sits inside — so the SUBSCRIBED branch clears `lastPullAt` before it asks.
   * Nothing drove it: the fake channel never called its status callback.
   * Dropping `lastPullAt = 0;` from the SUBSCRIBED branch (or the branch itself):
   *   AssertionError: expected 1 to be 2
   */
  it('u — every SUBSCRIBED pulls, even inside the throttle window', async () => {
    const KEY = 'pf2e-dm-turn-average';
    localStorage.setItem(KEY, JSON.stringify({ avgSeconds: 1, turnCount: 1, history: [] }));
    localStorage.setItem(STAMP_KEY, JSON.stringify({ [KEY]: { remote: TWO_HOURS_AGO } }));
    // In the cloud too, and up to date — a key the cloud has never seen is dirty by definition, and a
    // dirty key is kept and pushed rather than pulled, which is a different leg entirely.
    sb.state.rows.set(KEY, { key: KEY, value: { avgSeconds: 1, turnCount: 1, history: [] }, updated_at: TWO_HOURS_AGO });

    const t = await boot();
    expect(sb.state.selects).toBe(1); // the opening pull
    expect(sb.state.subscribed).toHaveLength(1);

    // The other device saved while this one's socket was away.
    sb.state.rows.set(KEY, { key: KEY, value: { avgSeconds: 50, turnCount: 5, history: [] }, updated_at: HOUR_AGO });
    await vi.advanceTimersByTimeAsync(500); // …and the reconnect lands well inside the 4 s throttle

    sb.state.subscribed[0]('SUBSCRIBED');
    await settle();

    expect(sb.state.selects).toBe(2);
    expect(t.dm.useDmAverageStore.getState().turnCount).toBe(5);
  });

  /*
   * RESTORING A BACKUP OVER THE TOP. `replace` wipes every `pf2e-*` key — but the mirror's stamps are
   * not `pf2e-*`, so they used to survive the wipe: a key the cloud holds and the backup doesn't was
   * deleted here and KEPT its stamp, so every later pull read that cloud row as one this device
   * already has and skipped it. The key stayed missing for good, and anything the GM rebuilt under it
   * went up over their other device's copy. A replace is a new history, so the stamps go with it.
   * Dropping `|| k.startsWith(HH_SYNC_STAMP_PREFIX)` from applyBackup's wipe:
   *   AssertionError: expected null not to be null            ← pf2e-parties, gone for good
   */
  it('v — a restored backup meets the cloud again instead of quietly losing what it left out', async () => {
    localStorage.setItem('pf2e-encounters', JSON.stringify({ 'Ambush at the ford': { combatants: [] } }));
    localStorage.setItem('pf2e-parties', JSON.stringify([{ id: 'p1', name: 'The Salt Road', players: [] }]));
    localStorage.setItem(
      STAMP_KEY,
      JSON.stringify({ 'pf2e-encounters': { remote: HOUR_AGO }, 'pf2e-parties': { remote: HOUR_AGO } }),
    );
    // Both keys are in the cloud, stamped exactly as this device last saw them.
    sb.state.rows.set('pf2e-encounters', { key: 'pf2e-encounters', value: { 'Ambush at the ford': { combatants: [] } }, updated_at: HOUR_AGO });
    sb.state.rows.set('pf2e-parties', { key: 'pf2e-parties', value: [{ id: 'p1', name: 'The Salt Road', players: [] }], updated_at: HOUR_AGO });

    // An older backup, restored: it carries the encounters and says nothing about the parties.
    const { applyBackup } = await import('../tracker/src/utils/dataTransfer');
    applyBackup({ 'pf2e-encounters': JSON.stringify({ "Dragon's lair": { combatants: [] } }) }, 'replace');
    expect(localStorage.getItem('pf2e-parties')).toBeNull(); // the wipe took it, as a replace should

    const t = await boot(); // the reload a restore asks for

    // First contact all round: the party the backup never had is back from the cloud…
    expect(localStorage.getItem('pf2e-parties')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('pf2e-parties')!)[0].name).toBe('The Salt Road');
    expect(t.sync.isTrackerSyncKey('pf2e-parties')).toBe(true);
    // …and the restored encounters are UNIONED with the cloud's rather than replacing them.
    expect(Object.keys(JSON.parse(localStorage.getItem('pf2e-encounters')!)).sort()).toEqual([
      'Ambush at the ford',
      "Dragon's lair",
    ]);
    // …which is only possible because the restore took the history with it: these stamps are the
    // ones this session wrote, not the ones the backup was restored over.
    expect(JSON.parse(localStorage.getItem(STAMP_KEY)!)['pf2e-parties'].remote).toBe(HOUR_AGO);
  });

  /*
   * THE SAME RESTORE, WITH THE MIRROR ALREADY RUNNING — and this is the SHIPPED path (Settings →
   * Backup → import, src/data/backup.ts). Leg v restores on a device whose mirror has not started yet,
   * where wiping the stamp FILE settles it. Live, the mirror holds those stamps in memory as well, and
   * the first thing to save them writes the pre-restore copy straight back out: the restore's own
   * notifyPersist on the tracker path, a pending push or the teardown flush on this one. Whichever ran
   * first decided. With the file back, every restored key reads as one this device has already
   * reconciled, so the cloud's copy of a key the backup left out is skipped by every later pull.
   * Dropping `notifyReset()` from restoreBackup (or `onReset(forgetTrackerSyncStamps)` from the start):
   *   AssertionError: expected '{"pf2e-encounters":…}' to be null
   *   AssertionError: expected null not to be null            ← pf2e-parties, gone for good
   */
  it('x — a restore made while the mirror is LIVE takes the history with it too', async () => {
    localStorage.setItem('pf2e-encounters', JSON.stringify({ 'Ambush at the ford': { combatants: [] } }));
    localStorage.setItem('pf2e-parties', JSON.stringify([{ id: 'p1', name: 'The Salt Road', players: [] }]));
    localStorage.setItem(
      STAMP_KEY,
      JSON.stringify({ 'pf2e-encounters': { remote: HOUR_AGO }, 'pf2e-parties': { remote: HOUR_AGO } }),
    );
    sb.state.rows.set('pf2e-encounters', { key: 'pf2e-encounters', value: { 'Ambush at the ford': { combatants: [] } }, updated_at: HOUR_AGO });
    sb.state.rows.set('pf2e-parties', { key: 'pf2e-parties', value: [{ id: 'p1', name: 'The Salt Road', players: [] }], updated_at: HOUR_AGO });

    const t = await boot(); // the mirror is up, and those stamps are now in its memory too

    const { restoreBackup } = await import('../src/data/backup');
    restoreBackup({
      app: 'heroes-heaven',
      kind: 'full-backup',
      formatVersion: 1,
      savedAt: NOW,
      appVersion: 'test',
      // An older backup: it carries the encounters and says nothing about the parties.
      data: { 'pf2e-encounters': JSON.stringify({ "Dragon's lair": { combatants: [] } }) },
    });
    expect(localStorage.getItem('pf2e-parties')).toBeNull(); // the wipe took it, as a replace should

    // The GM keeps playing in the seconds before the reload, and the push round comes and goes: none of
    // it may put the file back.
    t.dm.useDmAverageStore.getState().addTurns(30, 1);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    t.stop(); // the app closing for the reload the restore asks for — its flush must not write it either
    expect(localStorage.getItem(STAMP_KEY)).toBeNull();

    await boot(); // …and here is that reload

    // First contact all round: the party the backup never had is back from the cloud…
    expect(localStorage.getItem('pf2e-parties')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('pf2e-parties')!)[0].name).toBe('The Salt Road');
    // …and the restored encounters are UNIONED with the cloud's rather than replacing them.
    expect(Object.keys(JSON.parse(localStorage.getItem('pf2e-encounters')!)).sort()).toEqual([
      'Ambush at the ford',
      "Dragon's lair",
    ]);
  });

  /*
   * The tracker's own restore, which reaches the same reset the only way it can: the tracker never
   * imports from src/, so it announces on the persist bus and the mirror listens.
   * Dropping `notifyReset()` from applyBackup's replace branch:
   *   AssertionError: expected '{"pf2e-parties":{"remote":…' to be null
   */
  it('y — the tracker’s applyBackup announces the same reset', async () => {
    localStorage.setItem('pf2e-parties', JSON.stringify([{ id: 'p1', name: 'The Salt Road', players: [] }]));
    localStorage.setItem(STAMP_KEY, JSON.stringify({ 'pf2e-parties': { remote: HOUR_AGO } }));
    sb.state.rows.set('pf2e-parties', { key: 'pf2e-parties', value: [{ id: 'p1', name: 'The Salt Road', players: [] }], updated_at: HOUR_AGO });

    await boot();
    const { applyBackup } = await import('../tracker/src/utils/dataTransfer');
    applyBackup({ 'pf2e-encounters': JSON.stringify({ "Dragon's lair": { combatants: [] } }) }, 'replace');
    await settle();

    // Its own notifyPersist, on the very first key it writes, used to rewrite the file from memory.
    expect(localStorage.getItem(STAMP_KEY)).toBeNull();
  });

  /*
   * THE THIRD WHOLESALE REWRITE: Settings → Uninstall / "erase everything" (src/data/storage.ts's
   * wipeAllData). Not a race like x and y — the push that puts the file back is the ORDINARY next one:
   * every key is gone locally, so every dirty key reads null and is dropped, `rows` ends up empty, and
   * `if (!rows.length) { saveStamps(); return; }` writes the whole in-memory map to a file the wipe had
   * just removed. It outlives the wipe in both branches that keep running after it — the plain browser
   * tab (wipe + reload, same origin, still signed in) and the Android fallback (no reload at all).
   * Dropping `notifyReset()` from wipeAllData:
   *   AssertionError: expected '{"pf2e-parties":{"remote":…}}' to be null
   *   AssertionError: expected null not to be null            ← the GM's own parties, never coming back
   */
  it('z — erasing everything erases the history with it, so the cloud is first contact again', async () => {
    localStorage.setItem('pf2e-parties', JSON.stringify([{ id: 'p1', name: 'The Salt Road', players: [] }]));
    localStorage.setItem(STAMP_KEY, JSON.stringify({ 'pf2e-parties': { remote: HOUR_AGO } }));
    sb.state.rows.set('pf2e-parties', { key: 'pf2e-parties', value: [{ id: 'p1', name: 'The Salt Road', players: [] }], updated_at: HOUR_AGO });

    const t = await boot();
    // Something unsent, which after a session of play there always is.
    t.combat.useCombatStore.getState().setScope('camp-a');
    t.combat.useCombatStore.getState().addCombatant(null, { name: 'Goblin' });
    await vi.advanceTimersByTimeAsync(COMBAT_MS);

    const { wipeAllData } = await import('../src/data/storage');
    wipeAllData();
    expect(localStorage.getItem(STAMP_KEY)).toBeNull(); // the wipe itself always got this far…

    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();
    t.stop();
    expect(localStorage.getItem(STAMP_KEY)).toBeNull(); // …and nothing may put it back

    await boot(); // the reload the browser branch does (and the Android branch's next start)
    expect(localStorage.getItem('pf2e-parties')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('pf2e-parties')!)[0].name).toBe('The Salt Road');
  });

  /*
   * THE OTHER HALF OF z: the Android wipe (src/sheet/SettingsPage.tsx ~:474) never reloads, so this
   * session's mirror is still the SAME live instance after wipeAllData — no stop(), no reboot. Leg z's
   * `t.stop()` then `await boot()` re-imports the module fresh, so it only proves the FILE half of
   * forgetTrackerSyncStamps; a mutation that deletes just the in-memory half leaves leg z green while
   * every cloud row still reads as already reconciled for the rest of this session.
   * Deleting `stamps = {};` from forgetTrackerSyncStamps:
   *   AssertionError: expected null not to be null
   */
  it('z2 — after wiping with the app still running, the cloud is first contact again', async () => {
    localStorage.setItem('pf2e-parties', JSON.stringify([{ id: 'p1', name: 'The Salt Road', players: [] }]));
    localStorage.setItem(STAMP_KEY, JSON.stringify({ 'pf2e-parties': { remote: HOUR_AGO } }));
    sb.state.rows.set('pf2e-parties', { key: 'pf2e-parties', value: [{ id: 'p1', name: 'The Salt Road', players: [] }], updated_at: HOUR_AGO });

    const t = await boot();

    const { wipeAllData } = await import('../src/data/storage');
    wipeAllData(); // the Android branch: no reload follows
    expect(localStorage.getItem('pf2e-parties')).toBeNull();

    // No t.stop(), no reboot — this is still the session the wipe just ran in. The next pull it makes
    // (a Realtime row, a focus, a reconnect) is what the Android GM actually gets.
    sb.state.realtime[0]();
    await settle();

    expect(localStorage.getItem('pf2e-parties')).not.toBeNull(); // the cloud is first contact again…
    expect(JSON.parse(localStorage.getItem('pf2e-parties')!)[0].name).toBe('The Salt Road'); // …with the GM's own party
  });

  it('payload — a six-combatant board is a few tens of KB, not a megabyte', async () => {
    const t = await boot();
    const { SAMPLE_COMBATANT } = await import('../tracker/src/data/sampleStatBlock');
    t.combat.useCombatStore.getState().setScope('camp-a');
    const add = t.combat.useCombatStore.getState().addCombatant;
    for (let i = 0; i < 4; i += 1) add(SAMPLE_COMBATANT.creature!, { name: `Wyrm ${i + 1}` });
    add(null, { name: 'Fighter', isPC: true, maxHP: 40 });
    add(null, { name: 'Cleric', isPC: true, maxHP: 32 });
    await vi.advanceTimersByTimeAsync(COMBAT_MS);
    await vi.advanceTimersByTimeAsync(PUSH_MS);
    await settle();

    const row = sb.state.upserts.flat().find((r) => r.key === 'pf2e-current-combat:camp-a');
    expect(row).toBeTruthy();
    // MEASURED at 12,715 bytes (12.4 KB) for this board: four level-14 dragons carrying a full stat
    // block plus two PCs. The persisted snapshot already drops each creature's `raw` and
    // `rawMarkdown`, which is what keeps it there — one upload per 3 s at that size is the whole cost
    // of the mirror. The ceiling below is deliberately loose: it is here to catch a change that
    // starts shipping the un-slimmed stat blocks again (the same board was ~1 MB before the slim).
    expect(JSON.stringify(row!.value).length).toBeLessThan(200_000);
  });
});
