// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CAMPAIGN HOMEBREW — THE PLAYER'S PULL (src/data/campaignHomebrew.ts), against the real storage,
 * the real content merge and a fake `campaign_homebrew` table.
 *
 * The rule under test is the one this app has broken three times: a player's data is never
 * overwritten by the app. So every UNKNOWN answer must leave storage byte-identical, and everything
 * the GM takes away must land in the player's OWN homebrew — never over what they already hold.
 */

const sb = vi.hoisted(() => {
  type Filter = [op: 'eq' | 'in', col: string, val: unknown];
  type Call = { table: string; op: 'select' | 'upsert' | 'delete'; filters: Filter[]; range?: [number, number]; rows?: Record<string, unknown>[]; signal?: AbortSignal };
  const state = {
    rows: [] as Record<string, unknown>[],
    calls: [] as Call[],
    authCalls: 0,
    user: { id: 'u-player' } as { id: string } | null,
    session: 'u-player' as string | null,
    synced: true,
    failSelect: false,
    /** Report this count instead of the real one — a page that comes back short. */
    count: null as number | null,
    /** Runs while a select is "on the network" (before it is answered). */
    duringRead: null as null | ((c: Call) => void),
    /** A read this says yes to never answers — until the app aborts it, as supabase-js then does. */
    hangRead: null as null | ((c: Call) => boolean),
  };
  const match = (r: Record<string, unknown>, filters: Filter[]) =>
    filters.every(([op, col, val]) => (op === 'eq' ? r[col] === val : (val as unknown[]).includes(r[col])));
  const answer = (c: Call) => {
    state.calls.push(c);
    if (c.op === 'select') {
      state.duringRead?.(c);
      if (state.failSelect) return { data: null, error: { message: 'TypeError: Failed to fetch' }, count: null };
      const hit = state.rows.filter((r) => match(r, c.filters));
      const page = c.range ? hit.slice(c.range[0], c.range[1] + 1) : hit;
      return { data: JSON.parse(JSON.stringify(page)), error: null, count: state.count ?? hit.length };
    }
    return { data: null, error: null };
  };
  const from = (table: string) => {
    const c: Call = { table, op: 'select', filters: [] };
    const q = {
      select: () => q,
      upsert: (rows: Record<string, unknown>[]) => ((c.op = 'upsert'), (c.rows = rows), q),
      delete: () => ((c.op = 'delete'), q),
      eq: (col: string, val: unknown) => (c.filters.push(['eq', col, val]), q),
      in: (col: string, val: unknown) => (c.filters.push(['in', col, val]), q),
      order: () => q,
      range: (a: number, b: number) => ((c.range = [a, b]), q),
      abortSignal: (s: AbortSignal) => (Object.defineProperty(c, 'signal', { value: s }), q),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (state.hangRead?.(c)) {
          state.calls.push(c);
          return new Promise<void>((go) => c.signal?.addEventListener('abort', () => go()))
            .then(() => ({ data: null, error: { message: 'AbortError: signal is aborted without reason' }, count: null }))
            .then(res, rej);
        }
        return Promise.resolve().then(() => answer(c)).then(res, rej);
      },
    };
    return q;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  const client = {
    auth: {
      getUser: async () => {
        state.authCalls++;
        return { data: { user: state.user }, error: null };
      },
      getSession: async () => ({ data: { session: state.session ? { user: { id: state.session } } : null } }),
    },
    from,
    channel: () => channel,
    removeChannel: () => undefined,
  };
  return { state, client };
});

vi.mock('../src/data/supabase', () => ({ supabase: sb.client, isCloudConfigured: true, isCloudSyncEnabled: true }));
vi.mock('../src/data/cloudSync', () => ({ hasSyncedOnce: () => sb.state.synced }));

/** core.json (and core-descriptions.json): `gate` holds the load back, `ok: false` fails it. The pull
 *  waits on this load — isPrintedId must know the book before anything converts. */
const core = { gate: Promise.resolve() as Promise<unknown>, ok: true };
const CORE = { feats: { 'core-feat': { id: 'core-feat', name: 'Printed Feat' } } };
vi.stubGlobal('fetch', async () => {
  await core.gate;
  return { ok: core.ok, status: core.ok ? 200 : 404, json: async () => JSON.parse(JSON.stringify(CORE)) };
});

import {
  CAMPAIGN_HB_CACHE_KEY,
  CAMPAIGN_HB_DIRTY_KEY,
  deleteHomebrewEntry,
  deleteHomebrewSource,
  loadCampaignHbCache,
  loadHomebrewContent,
  loadHomebrewSources,
  recordTombstoneKeys,
  saveCampaignHbCache,
  saveCampaigns,
  saveHomebrewEntry,
  saveHomebrewSource,
  saveRoster,
  saveSyncOwner,
  wipeSyncedLocalData,
} from '../src/data/storage';
import { exportCampaignSource, refreshCampaignHomebrew, startCampaignHomebrew } from '../src/data/campaignHomebrew';
import { rebuildContent } from '../src/data';
import { normalizeCharacter, normalizePlay } from '../src/rules/normalize';

const AT = '2026-09-20T10:00:00.000Z';
const srcRow = (cid: string, id: string, name: string, extra: Record<string, unknown> = {}) => ({
  campaign_id: cid,
  kind: 'source',
  id,
  source_id: id,
  data: { id, name, ...extra },
  updated_at: AT,
});
const entryRow = (cid: string, kind: string, id: string, sid: string, extra: Record<string, unknown> = {}) => ({
  campaign_id: cid,
  kind,
  id,
  source_id: sid,
  data: { id, name: id, homebrewSourceId: sid, ...extra },
  updated_at: AT,
});

/** Every localStorage key and value — "byte-identical" means this string does not move. */
function snapshot(): string {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    out[k] = localStorage.getItem(k);
  }
  return JSON.stringify(Object.keys(out).sort().map((k) => [k, out[k]]));
}

let stop = () => {};
let changed = 0;

beforeEach(async () => {
  localStorage.clear();
  Object.assign(sb.state, { rows: [], calls: [], authCalls: 0, user: { id: 'u-player' }, session: 'u-player', synced: true, failSelect: false, count: null, duringRead: null, hangRead: null });
  Object.assign(core, { gate: Promise.resolve(), ok: true });
  saveSyncOwner('u-player');
  saveCampaigns([
    { id: 'camp-1', code: 'AAAAAA', role: 'player', name: 'Night Road' },
    { id: 'camp-2', code: 'BBBBBB', role: 'player', name: 'Sunken Keep' },
  ]);
  changed = 0;
  stop = startCampaignHomebrew({ onChanged: () => changed++ });
  await refreshCampaignHomebrew(); // settle the start's own pull (empty table)
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('campaign homebrew pull — UNKNOWN is not EMPTY', () => {
  it('leaves the cache and the own homebrew byte-identical on every unknown answer', async () => {
    sb.state.rows = [srcRow('camp-1', 'S1', 'GM Book'), entryRow('camp-1', 'feats', 'f1', 'S1'), entryRow('camp-1', 'items', 'i1', 'S1')];
    expect(await refreshCampaignHomebrew()).toBe(true);
    saveHomebrewSource({ id: 'mine', name: 'Mine' });
    saveHomebrewEntry('feats', { id: 'my-feat', name: 'My Feat', homebrewSourceId: 'mine' } as never);
    const before = snapshot();

    // Every case below reads NOTHING back. Taken as an answer, that is "the GM removed it all" and
    // S1 would be converted into the player's own homebrew — so a moved snapshot is a real failure.
    // Each guard removed on its own (a read error swallowed into [], no getUser gate, no short-page
    // check, no session re-check after the read, no hasSyncedOnce gate) fails here with:
    //   AssertionError: expected true to be false // Object.is equality
    // A read error.
    sb.state.rows = [];
    sb.state.failSelect = true;
    expect(await refreshCampaignHomebrew()).toBe(false);
    expect(snapshot()).toBe(before);
    sb.state.failSelect = false;

    // No session: under RLS the read would "succeed" with zero rows.
    sb.state.user = null;
    expect(await refreshCampaignHomebrew()).toBe(false);
    expect(snapshot()).toBe(before);
    sb.state.user = { id: 'u-player' };

    // A short page: count 3, rows 2.
    sb.state.rows = [srcRow('camp-1', 'S1', 'GM Book'), entryRow('camp-1', 'feats', 'f1', 'S1')];
    sb.state.count = 3;
    expect(await refreshCampaignHomebrew()).toBe(false);
    expect(snapshot()).toBe(before);
    sb.state.count = null;

    // Signed out while the read was on the network.
    sb.state.rows = [];
    sb.state.duringRead = () => {
      sb.state.session = null;
    };
    expect(await refreshCampaignHomebrew()).toBe(false);
    expect(snapshot()).toBe(before);
    sb.state.duringRead = null;
    sb.state.session = 'u-player';

    // Before the first cloud sync: no answer at all, and no network call either.
    sb.state.synced = false;
    const calls = sb.state.calls.length;
    const auth = sb.state.authCalls;
    expect(await refreshCampaignHomebrew()).toBe(false);
    expect(snapshot()).toBe(before);
    expect(sb.state.calls.length).toBe(calls);
    expect(sb.state.authCalls).toBe(auth);
  });

  it('a read that never answers is cancelled after 30 s: nothing changes, and the next pull runs', async () => {
    sb.state.rows = [srcRow('camp-1', 'S1', 'GM Book'), entryRow('camp-1', 'feats', 'f1', 'S1')];
    expect(await refreshCampaignHomebrew()).toBe(true);
    const before = snapshot();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // afterEach puts the real clock back
    let hangNext = true; // only the next read hangs
    sb.state.hangRead = () => hangNext && !(hangNext = false);
    sb.state.rows = [];
    const calls = sb.state.calls.length;
    // The snapshot is taken the moment the stuck pull settles, before the queued one starts.
    const stuck = refreshCampaignHomebrew().then((r) => [r, snapshot()]);
    const next = refreshCampaignHomebrew(); // queued behind the stuck one
    await vi.waitFor(() => expect(sb.state.calls.length).toBe(calls + 1));
    const hung = sb.state.calls.at(-1)!;
    // With no bound on the read, the pull queue waits for good — this and every later pull:
    //   Error: Test timed out in 5000ms.
    await vi.advanceTimersByTimeAsync(30_000);
    // UNKNOWN is not EMPTY: the given-up read changed nothing, though the table is now empty.
    expect(await stuck).toEqual([false, before]);
    expect(hung.signal?.aborted).toBe(true);
    // The queued pull ran and read the (now empty) table: the GM's removal converts as usual.
    expect(await next).toBe(true);
    expect(loadHomebrewSources()['hbsrc-kept-S1']).toBeDefined();
  });
});

describe('campaign homebrew pull — paging (more than 1000 rows)', () => {
  // S1 + 2500 items: THREE pages, each after the first starting one row early. The fake table answers
  // by position, like offset paging does.
  const big = () => [srcRow('camp-1', 'S1', 'GM Book'), ...Array.from({ length: 2500 }, (_, i) => entryRow('camp-1', 'items', `i${i}`, 'S1'))];

  it('reads every row of a share that spans three pages', async () => {
    sb.state.rows = big();
    sb.state.calls = [];
    // With the page array aliased to the response (the shift shrank it, so page 2 looked like the last
    // one) — the pull stopped after two pages and gave up on a count it could never reach:
    //   AssertionError: expected false to be true // Object.is equality
    expect(await refreshCampaignHomebrew()).toBe(true);
    expect(sb.state.calls.map((c) => c.range)).toEqual([
      [0, 999],
      [999, 1998],
      [1998, 2997],
    ]);
    expect(Object.keys(loadCampaignHbCache()['camp-1'].content.items ?? {})).toHaveLength(2500);
  });

  it('a GM write between two pages that shifts the rows gives up — also when the count stays the same', async () => {
    sb.state.rows = big();
    await refreshCampaignHomebrew();
    // A character uses i999, the row the shift pushes out of the second page — read as gone, it would
    // become a stray kept "GM Book" in the player's own homebrew.
    saveRoster([
      {
        id: 'c1',
        character: normalizeCharacter({ id: 'c1', name: 'Hero', inventory: [{ instanceId: 'inv-1', itemId: 'i999', quantity: 1 }] } as never),
        play: normalizePlay({}),
      },
    ]);
    const before = snapshot();
    const writes: [string, (rows: Record<string, unknown>[]) => void][] = [
      ['a delete', (rows) => rows.splice(6, 1)],
      ['a delete plus an insert', (rows) => (rows.splice(6, 1), rows.push(entryRow('camp-1', 'items', 'i1500', 'S1')))],
    ];
    for (const [what, write] of writes) {
      sb.state.rows = big();
      sb.state.duringRead = (c) => {
        if (c.range?.[0]) {
          sb.state.duringRead = null;
          write(sb.state.rows);
        }
      };
      // Plain offset paging (no overlap row): i999 falls between the pages and the pull goes through —
      //   AssertionError: a delete: expected true to be false // Object.is equality
      // Comparing only the counts across pages: the first passes, the second still goes through —
      //   AssertionError: a delete plus an insert: expected true to be false // Object.is equality
      expect(await refreshCampaignHomebrew(), what).toBe(false);
      expect(snapshot(), what).toBe(before);
    }
    // Once the table holds still, the next pull reads it all.
    expect(await refreshCampaignHomebrew()).toBe(true);
    expect(loadCampaignHbCache()['camp-1'].content.items?.i999).toBeDefined();
    expect(loadHomebrewSources()['hbsrc-kept-S1']).toBeUndefined();
  });
});

describe('campaign homebrew pull — what the GM takes away becomes the player’s own', () => {
  it('converts a source that disappeared into hbsrc-kept-<id>, same entry ids, same name', async () => {
    sb.state.rows = [srcRow('camp-1', 'S1', 'GM Book'), entryRow('camp-1', 'feats', 'f1', 'S1'), entryRow('camp-1', 'items', 'i1', 'S1')];
    await refreshCampaignHomebrew();
    changed = 0;
    sb.state.rows = []; // the GM unshared it (still a member)
    expect(await refreshCampaignHomebrew()).toBe(true);
    expect(changed).toBe(1);

    const kept = loadHomebrewSources()['hbsrc-kept-S1'];
    expect(kept).toEqual({ id: 'hbsrc-kept-S1', name: 'GM Book', kept: { from: 'Night Road', ids: ['items:i1', 'feats:f1'] } });
    const own = loadHomebrewContent();
    expect(own.feats.f1).toMatchObject({ id: 'f1', homebrewSourceId: 'hbsrc-kept-S1' });
    expect(own.items.i1).toMatchObject({ id: 'i1', homebrewSourceId: 'hbsrc-kept-S1' });
    expect(loadCampaignHbCache()['camp-1']).toBeUndefined();
    // …and a character that had "GM Book" switched on still resolves it under the same book name.
    expect(rebuildContent().feats.f1.source).toEqual({ license: 'homebrew', book: 'GM Book' });

    // (5) The same pull again changes nothing.
    const once = snapshot();
    expect(await refreshCampaignHomebrew()).toBe(false);
    expect(snapshot()).toBe(once);
  });

  it('never overwrites an own entry with the same id, and never revives a tombstone', async () => {
    sb.state.rows = [
      srcRow('camp-1', 'S1', 'GM Book'),
      entryRow('camp-1', 'feats', 'f1', 'S1'),
      entryRow('camp-1', 'feats', 'f2', 'S1'),
      srcRow('camp-1', 'S2', 'Other Book'),
      entryRow('camp-1', 'feats', 'f3', 'S2'),
    ];
    await refreshCampaignHomebrew();
    saveHomebrewEntry('feats', { id: 'f1', name: 'My own f1', homebrewSourceId: 'mine' } as never);
    recordTombstoneKeys(['hb:feats:f2', 'hbsrc:hbsrc-kept-S2']); // the player deleted these
    sb.state.rows = [];
    await refreshCampaignHomebrew();

    const own = loadHomebrewContent();
    // Without the own-id check: expected { id: 'f1', name: 'f1', …(1) } to deeply equal { id: 'f1', name: 'My own f1', …(1) }
    // Without the tombstone check: expected { id: 'f2', name: 'f2', …(1) } to be undefined
    expect(own.feats.f1).toEqual({ id: 'f1', name: 'My own f1', homebrewSourceId: 'mine' });
    expect(own.feats.f2).toBeUndefined();
    expect(own.feats.f3).toBeUndefined();
    expect(loadHomebrewSources()['hbsrc-kept-S2']).toBeUndefined();
    // Nothing of S1 landed, so no empty "GM Book" either. With the skip only for an EXISTING kept source:
    //   AssertionError: expected { id: 'hbsrc-kept-S1', …(2) } to be undefined
    expect(loadHomebrewSources()['hbsrc-kept-S1']).toBeUndefined();
  });

  it('keeps an entry deleted from a still-shared source only when a character uses it', async () => {
    sb.state.rows = [srcRow('camp-1', 'S1', 'GM Book'), entryRow('camp-1', 'items', 'i1', 'S1'), entryRow('camp-1', 'items', 'i2', 'S1')];
    await refreshCampaignHomebrew();
    saveRoster([
      {
        id: 'c1',
        character: normalizeCharacter({ id: 'c1', name: 'Hero', inventory: [{ instanceId: 'inv-1', itemId: 'i1', quantity: 1 }] } as never),
        play: normalizePlay({}),
      },
    ]);
    sb.state.rows = [srcRow('camp-1', 'S1', 'GM Book')]; // the GM deleted both items, kept the source
    await refreshCampaignHomebrew();

    const own = loadHomebrewContent();
    expect(own.items.i1).toMatchObject({ homebrewSourceId: 'hbsrc-kept-S1' });
    // Without the roster check: expected { id: 'i2', name: 'i2', …(1) } to be undefined
    expect(own.items.i2).toBeUndefined();
    expect(loadHomebrewSources()['hbsrc-kept-S1'].kept?.ids).toEqual(['items:i1']);
    expect(loadCampaignHbCache()['camp-1'].content.items ?? {}).toEqual({});
  });

  it('a kept copy the player deleted: what a character uses comes back; otherwise the later of the delete and the GM’s write wins', async () => {
    // The device clock is held and stepped a minute at a time: a tombstone and a revive stamped in the
    // same millisecond would read as "revived", which no real delete a person makes ever is.
    vi.useFakeTimers({ toFake: ['Date'] }); // afterEach puts the real clock back
    let now = Date.parse(AT);
    const later = () => vi.setSystemTime((now += 60_000));
    // The same share, every row stamped `at` by the server.
    const share = (at: string) =>
      [srcRow('camp-1', 'S1', 'GM Book'), entryRow('camp-1', 'items', 'i1', 'S1'), entryRow('camp-1', 'items', 'i2', 'S1')].map((r) => ({ ...r, updated_at: at }));
    sb.state.rows = share(AT);
    await refreshCampaignHomebrew();
    saveRoster([
      {
        id: 'c1',
        character: normalizeCharacter({ id: 'c1', name: 'Hero', inventory: [{ instanceId: 'inv-1', itemId: 'i1', quantity: 1 }] } as never),
        play: normalizePlay({}),
      },
    ]);
    later();
    sb.state.rows = []; // the GM unshares: both become the player's own
    await refreshCampaignHomebrew();
    later();
    deleteHomebrewSource('hbsrc-kept-S1'); // …and the player deletes that kept copy (tombstones: now)
    expect(loadHomebrewContent().items).toEqual({});

    // (a) The same rows come back — never written again, so stamped BEFORE the player's delete (a kick
    // lifted) — and go again. i1 is on a character: it comes back, whatever was deleted. i2 isn't, and
    // the delete is newer than the GM's row: it stays deleted.
    later();
    sb.state.rows = share(AT);
    await refreshCampaignHomebrew();
    sb.state.rows = [];
    await refreshCampaignHomebrew();
    // Every live tombstone blocking the conversion (the old rule), or no "a character uses it" override:
    //   AssertionError: expected undefined to match object { homebrewSourceId: 'hbsrc-kept-S1' }
    expect(loadHomebrewContent().items.i1).toMatchObject({ homebrewSourceId: 'hbsrc-kept-S1' });
    // No tombstone blocking anything:  AssertionError: expected { id: 'i2', …(2) } to be undefined
    expect(loadHomebrewContent().items.i2).toBeUndefined();
    expect(loadHomebrewSources()['hbsrc-kept-S1']).toMatchObject({ name: 'GM Book', kept: { ids: ['items:i1'] } });

    // (b) The player deletes it again; the GM shares it again for real — the server stamps the rows
    // AFTER that delete — and takes it away once more. That removal is new to the player: the stale
    // tombstone loses to the row, and i2 comes back too.
    later();
    deleteHomebrewSource('hbsrc-kept-S1');
    later();
    sb.state.rows = share(new Date(now).toISOString());
    await refreshCampaignHomebrew();
    sb.state.rows = [];
    await refreshCampaignHomebrew();
    // A tombstone winning whatever the GM wrote since:
    //   AssertionError: expected undefined to match object { homebrewSourceId: 'hbsrc-kept-S1' }
    expect(loadHomebrewContent().items.i2).toMatchObject({ homebrewSourceId: 'hbsrc-kept-S1' });
    expect(loadHomebrewContent().items.i1).toMatchObject({ homebrewSourceId: 'hbsrc-kept-S1' });
    expect(loadHomebrewSources()['hbsrc-kept-S1'].kept?.ids).toEqual(['items:i1', 'items:i2']);
  });

  it('a conversion the storage refuses stays in the cache, and the next pull finishes it', async () => {
    const setItem = Storage.prototype.setItem;
    let refuse: (key: string, value: string) => boolean = () => false;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (refuse(key, value)) throw new DOMException('full', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    try {
      sb.state.rows = [
        srcRow('camp-1', 'S1', 'GM Book'),
        entryRow('camp-1', 'feats', 'f1', 'S1'),
        entryRow('camp-1', 'feats', 'f2', 'S1'),
        srcRow('camp-2', 'S2', 'Keep Book'),
        entryRow('camp-2', 'feats', 'g1', 'S2'),
      ];
      await refreshCampaignHomebrew();
      sb.state.rows = []; // the GM unshared both

      // (a) f2's entry save is refused. Counting it anyway, the kept list named an entry that never
      // landed and the cache dropped camp-1 — f2 in neither the cache nor the player's own store:
      //   AssertionError: expected [ 'feats:f1', 'feats:f2' ] to deeply equal [ 'feats:f1' ]
      // (b) the S2 kept SOURCE save is refused (g1 landed). Without the source-landed check the cache
      // dropped camp-2 and g1 stayed pointing at a source that never came:
      //   AssertionError: expected undefined to be defined  (the camp-2 line)
      // Both caught but the old copy not put back in the cache:
      //   AssertionError: expected undefined to be defined  (the camp-1 line)
      refuse = (key, value) =>
        (key === 'wanderers-codex:homebrew-content:v1' && value.includes('"f2"')) ||
        (key === 'wanderers-codex:homebrew-sources:v1' && value.includes('hbsrc-kept-S2'));
      await refreshCampaignHomebrew();
      let own = loadHomebrewContent();
      expect(own.feats.f1).toMatchObject({ homebrewSourceId: 'hbsrc-kept-S1' });
      expect(own.feats.f2).toBeUndefined();
      expect(own.feats.g1).toMatchObject({ homebrewSourceId: 'hbsrc-kept-S2' });
      expect(loadHomebrewSources()['hbsrc-kept-S1'].kept?.ids).toEqual(['feats:f1']);
      expect(loadHomebrewSources()['hbsrc-kept-S2']).toBeUndefined();
      expect(loadCampaignHbCache()['camp-1']?.content.feats?.f2).toBeDefined();
      expect(loadCampaignHbCache()['camp-2']).toBeDefined();
      expect(rebuildContent().feats.f2?.source).toEqual({ license: 'homebrew', book: 'GM Book' }); // still on screen

      // Room again. An entry an earlier run already saved (byte-for-byte what the conversion writes)
      // counts as landed. Skipping it as "the player's own", g1's source never came:
      //   AssertionError: expected undefined to deeply equal { id: 'hbsrc-kept-S2', …(2) }
      refuse = () => false;
      await refreshCampaignHomebrew();
      own = loadHomebrewContent();
      expect(own.feats.f2).toMatchObject({ homebrewSourceId: 'hbsrc-kept-S1' });
      expect(loadHomebrewSources()['hbsrc-kept-S1'].kept?.ids).toEqual(['feats:f1', 'feats:f2']);
      expect(loadHomebrewSources()['hbsrc-kept-S2']).toEqual({ id: 'hbsrc-kept-S2', name: 'Keep Book', kept: { from: 'Sunken Keep', ids: ['feats:g1'] } });
      expect(loadCampaignHbCache()).toEqual({});
      const once = snapshot();
      expect(await refreshCampaignHomebrew()).toBe(false);
      expect(snapshot()).toBe(once);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('campaign homebrew pull — row validation', () => {
  it('a row it cannot read keeps THAT campaign’s old copy; a <script> is stripped', async () => {
    sb.state.rows = [
      srcRow('camp-1', 'S1', 'GM Book', { description: '<b>Lore</b><script>alert(1)</script>' }),
      entryRow('camp-1', 'feats', 'f1', 'S1', { description: '<p>ok</p><script>alert(2)</script>' }),
      srcRow('camp-2', 'S2', 'Keep Book'),
      entryRow('camp-2', 'feats', 'f2', 'S2'),
    ];
    await refreshCampaignHomebrew();
    const camp1 = loadCampaignHbCache()['camp-1'];
    expect(camp1.sources.S1.description).toBe('<b>Lore</b>');
    expect(camp1.content.feats?.f1.description).toBe('<p>ok</p>');

    const broken = entryRow('camp-1', 'feats', 'fX', 'S1');
    (broken.data as Record<string, unknown>).id = 'fY'; // data.id ≠ row id
    sb.state.rows = [srcRow('camp-1', 'S1', 'GM Book'), broken, srcRow('camp-2', 'S2', 'Keep Book')];
    await refreshCampaignHomebrew();
    // Skipping the bad row instead of marking the campaign UNKNOWN:
    //   AssertionError: expected { name: 'Night Road', …(3) } to deeply equal { name: 'Night Road', …(3) }
    expect(loadCampaignHbCache()['camp-1']).toEqual(camp1); // f1 NOT treated as deleted
    expect(loadHomebrewSources()['hbsrc-kept-S1']).toBeUndefined();
    expect(loadCampaignHbCache()['camp-2'].content.feats ?? {}).toEqual({}); // the readable campaign moved on
  });
});

describe('campaign homebrew — merge precedence (rebuildContent)', () => {
  it('kept-untouched < live campaign copy < edited own copy; printed ids are never replaced', async () => {
    sb.state.rows = [
      srcRow('camp-1', 'S1', 'GM Book'),
      entryRow('camp-1', 'feats', 'f1', 'S1', { name: 'Live F1' }),
      entryRow('camp-1', 'feats', 'toughness', 'S1', { name: 'Hijacked' }), // a seed feat's id
    ];
    await refreshCampaignHomebrew();
    // A kept copy from an earlier unshare, never edited (entry first, source last — as convertGone does).
    saveHomebrewEntry('feats', { id: 'f1', name: 'Kept F1', homebrewSourceId: 'hbsrc-kept-S1' } as never);
    saveHomebrewSource({ id: 'hbsrc-kept-S1', name: 'GM Book', kept: { from: 'Night Road', ids: ['feats:f1'] } });

    // Layers 1 and 2 swapped: expected 'Kept F1' to be 'Live F1'. No printed-id skip: expected
    // 'Hijacked' to be 'Toughness'. No kept-list strip in saveHomebrewEntry: expected [ 'feats:f1' ] to deeply equal []
    let db = rebuildContent();
    expect(db.feats.f1.name).toBe('Live F1');
    expect(db.feats.f1.source).toEqual({ license: 'homebrew', book: 'GM Book' });
    expect(db.feats.toughness.name).toBe('Toughness');

    saveHomebrewEntry('feats', { id: 'f1', name: 'Edited F1', homebrewSourceId: 'hbsrc-kept-S1' } as never);
    expect(loadHomebrewSources()['hbsrc-kept-S1'].kept?.ids).toEqual([]);
    db = rebuildContent();
    expect(db.feats.f1.name).toBe('Edited F1');
  });
});

describe('campaign homebrew — account scoping', () => {
  it('a cache stored for another account loads as {}; wipeSyncedLocalData removes both new keys', () => {
    // Without the uid check: expected { x: { name: 'X', sources: {}, …(2) } } to deeply equal {}
    // Dirty key left out of the wipe: expected '{"feats:f1":"mine"}' to be null
    saveCampaignHbCache('u-other', { x: { name: 'X', sources: {}, content: {}, updatedAt: AT } });
    expect(loadCampaignHbCache()).toEqual({});
    saveCampaignHbCache('u-player', { x: { name: 'X', sources: {}, content: {}, updatedAt: AT } });
    expect(Object.keys(loadCampaignHbCache())).toEqual(['x']);

    saveHomebrewEntry('feats', { id: 'f1', name: 'F1', homebrewSourceId: 'mine' } as never);
    deleteHomebrewEntry('feats', 'f1');
    expect(localStorage.getItem(CAMPAIGN_HB_DIRTY_KEY)).not.toBeNull();
    wipeSyncedLocalData();
    expect(localStorage.getItem(CAMPAIGN_HB_CACHE_KEY)).toBeNull();
    expect(localStorage.getItem(CAMPAIGN_HB_DIRTY_KEY)).toBeNull();
  });
});

describe('campaign homebrew — the player’s export', () => {
  it('copies a source with fresh ids and remapped references; later pulls never touch the copy', async () => {
    sb.state.rows = [
      srcRow('camp-1', 'S1', 'GM Book'),
      entryRow('camp-1', 'ancestries', 'a1', 'S1', { name: 'Gnollish' }),
      entryRow('camp-1', 'heritages', 'h1', 'S1', { ancestryId: 'a1' }),
    ];
    await refreshCampaignHomebrew();
    const sid = exportCampaignSource('camp-1', 'S1')!;
    expect(sid).toMatch(/^hbsrc-/);
    expect(loadHomebrewSources()[sid]).toEqual({ id: sid, name: 'GM Book (my copy)' });
    const own = loadHomebrewContent();
    const [anc] = Object.values(own.ancestries);
    const [her] = Object.values(own.heritages) as unknown as { id: string; ancestryId: string; homebrewSourceId: string }[];
    expect(anc.id).toMatch(/^a1-copy-/);
    expect(her.id).toMatch(/^h1-copy-/);
    // Remapping only id + homebrewSourceId: expected 'a1' to be 'a1-copy-c-…'
    expect(her.ancestryId).toBe(anc.id);
    expect(her.homebrewSourceId).toBe(sid);
    expect(anc.homebrewSourceId).toBe(sid);
    expect(own.ancestries.a1).toBeUndefined();

    const second = exportCampaignSource('camp-1', 'S1')!;
    expect(loadHomebrewSources()[second].name).toBe('GM Book (my copy) 2');

    const copies = JSON.stringify(loadHomebrewContent());
    sb.state.rows = [srcRow('camp-1', 'S1', 'GM Book'), entryRow('camp-1', 'ancestries', 'a1', 'S1', { name: 'Changed' })];
    await refreshCampaignHomebrew();
    expect(JSON.stringify(loadHomebrewContent())).toBe(copies);
  });
});

// LAST in the file: it re-imports the modules to get an app start whose core.json has not loaded.
describe('campaign homebrew pull — the book is known before anything converts', () => {
  it('waits for core.json, never converts a printed id, and changes nothing when core.json failed', async () => {
    sb.state.rows = [srcRow('camp-1', 'S1', 'GM Book'), entryRow('camp-1', 'feats', 'f1', 'S1'), entryRow('camp-1', 'feats', 'core-feat', 'S1')];
    await refreshCampaignHomebrew();
    stop();
    sb.state.rows = []; // the GM unshared S1

    // A fresh start whose core.json is still on the network.
    vi.resetModules();
    let release = () => {};
    core.gate = new Promise<void>((r) => (release = r));
    const slow = await import('../src/data/campaignHomebrew');
    stop = slow.startCampaignHomebrew({ onChanged: () => {} });
    const pulled = slow.refreshCampaignHomebrew();
    await new Promise((r) => setTimeout(r, 20));
    // Without the wait, the pull ran knowing only the seed and core-feat became the player's own:
    //   AssertionError: expected { …(2) } to deeply equal {}
    expect(loadHomebrewContent().feats).toEqual({});
    release();
    await pulled;
    const own = loadHomebrewContent();
    expect(own.feats.f1).toMatchObject({ homebrewSourceId: 'hbsrc-kept-S1' });
    expect(own.feats['core-feat']).toBeUndefined();
    stop();

    // A start whose core.json FAILED: only the seed is known for the whole session — UNKNOWN.
    // Treating that as "known" lets the start's own pull through and the snapshot moves:
    //   AssertionError: expected '[["pf2e-codex.campaigns","[{\"id\":\"…' to be '[["pf2e-codex.campaigns","[{\"id\":\"…'
    vi.resetModules();
    Object.assign(core, { gate: Promise.resolve(), ok: false });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      sb.state.rows = [srcRow('camp-1', 'S2', 'New Book'), entryRow('camp-1', 'feats', 'f9', 'S2')];
      const failed = await import('../src/data/campaignHomebrew');
      const before = snapshot();
      stop = failed.startCampaignHomebrew({ onChanged: () => {} });
      expect(await failed.refreshCampaignHomebrew()).toBe(false);
      expect(snapshot()).toBe(before);
    } finally {
      err.mockRestore();
    }
  });
});
