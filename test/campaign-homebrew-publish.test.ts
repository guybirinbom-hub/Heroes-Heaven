// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CAMPAIGN HOMEBREW — THE GM'S PUBLISH (src/data/campaignHomebrew.ts flushCampaignHomebrew +
 * shareSources), against the real storage writers and a fake `campaign_homebrew` table that records
 * every call.
 *
 * The contract: an edit uploads exactly what was edited, only for a source a campaign shares, and
 * nothing loses the edit — a failure, a sign-out, an UNKNOWN shared list, a campaign this device doesn't
 * list yet, the app killed mid-upload: its key stays on disk for the next try. A pull (the cloud bundle
 * being adopted) is not an edit and dirties nothing.
 */

const sb = vi.hoisted(() => {
  type Filter = [op: 'eq' | 'in', col: string, val: unknown];
  type Call = { table: string; op: 'select' | 'upsert' | 'delete'; filters: Filter[]; rows?: Record<string, unknown>[]; signal?: AbortSignal };
  const state = {
    rows: [] as Record<string, unknown>[],
    /** The `campaigns` table: which account owns which campaign (the server's answer, not this device's list). */
    campaigns: [] as Record<string, unknown>[],
    calls: [] as Call[],
    synced: true,
    failSelect: false,
    /** Answer every campaign_homebrew read with this error instead (e.g. the table isn't there). */
    selectError: null as null | { message: string; code?: string },
    failWrite: false,
    session: 'u-gm' as string | null,
    /** Runs while a call is "on the network" (before it is answered). */
    during: null as null | ((c: Call) => void),
    /** A call this says yes to is never answered — the app died with it on the network. */
    hang: null as null | ((c: Call) => boolean),
    hung: [] as (() => void)[],
  };
  const match = (r: Record<string, unknown>, filters: Filter[]) =>
    filters.every(([op, col, val]) => (op === 'eq' ? r[col] === val : (val as unknown[]).includes(r[col])));
  const answer = (c: Call) => {
    state.calls.push(c);
    state.during?.(c);
    // RLS with no session: a select reads zero rows and a delete deletes nothing — neither is an error.
    const anon = !state.session;
    if (c.op === 'select') {
      if (state.failSelect) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
      if (state.selectError && c.table === 'campaign_homebrew') return { data: null, error: state.selectError };
      const table = c.table === 'campaigns' ? state.campaigns : state.rows;
      return { data: anon ? [] : JSON.parse(JSON.stringify(table.filter((r) => match(r, c.filters)))), error: null };
    }
    if (state.failWrite || (anon && c.op === 'upsert')) return { data: null, error: { message: 'new row violates row-level security policy' } };
    if (anon) return { data: null, error: null };
    if (c.op === 'upsert') {
      for (const row of c.rows!) {
        const i = state.rows.findIndex((r) => r.campaign_id === row.campaign_id && r.kind === row.kind && r.id === row.id);
        const copy = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
        if (i >= 0) state.rows[i] = copy;
        else state.rows.push(copy);
      }
    } else state.rows = state.rows.filter((r) => !match(r, c.filters));
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
      range: () => q,
      // Kept off the enumerable fields: the tests compare recorded calls with toEqual.
      abortSignal: (s: AbortSignal) => (Object.defineProperty(c, 'signal', { value: s }), q),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (state.hang?.(c)) {
          state.calls.push(c);
          // Answered only when the test lets the dead app's promise go (state.hung), or — as supabase-js
          // does — when the app aborts the request; either way with an error.
          return new Promise<void>((go) => {
            state.hung.push(go);
            c.signal?.addEventListener('abort', () => go());
          })
            .then(() => ({ data: null, error: { message: c.signal?.aborted ? 'AbortError: signal is aborted without reason' : 'never answered' } }))
            .then(res, rej);
        }
        return Promise.resolve().then(() => answer(c)).then(res, rej);
      },
    };
    return q;
  };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u-gm' } }, error: null }),
      getSession: async () => ({ data: { session: state.session ? { user: { id: state.session } } : null } }),
    },
    from,
    channel: () => ({}),
    removeChannel: () => undefined,
  };
  return { state, client };
});

vi.mock('../src/data/supabase', () => ({ supabase: sb.client, isCloudConfigured: true, isCloudSyncEnabled: true }));
vi.mock('../src/data/cloudSync', () => ({ hasSyncedOnce: () => sb.state.synced }));

import {
  CAMPAIGN_HB_DIRTY_KEY,
  deleteHomebrewEntry,
  deleteHomebrewSource,
  readCloudBundle,
  saveCampaigns,
  saveHomebrewEntry,
  saveHomebrewSource,
  saveSyncOwner,
  wipeSyncedLocalData,
  writeCloudBundle,
} from '../src/data/storage';
import { fetchSharedSourceIds, flushCampaignHomebrew, shareSources, sharedSourceCampaigns, unshareSources } from '../src/data/campaignHomebrew';

const feat = (id: string, sid: string, name = id) => ({ id, name, homebrewSourceId: sid }) as never;
/** The dirty set as it sits on disk. */
const dirty = (): Record<string, string> => JSON.parse(localStorage.getItem(CAMPAIGN_HB_DIRTY_KEY) ?? '{}') as Record<string, string>;
const clearDirty = () => localStorage.removeItem(CAMPAIGN_HB_DIRTY_KEY);
const writes = () => sb.state.calls.filter((c) => c.op !== 'select');
const row = (cid: string, kind: string, id: string) => sb.state.rows.find((r) => r.campaign_id === cid && r.kind === kind && r.id === id);

beforeEach(() => {
  localStorage.clear();
  sb.state.hung.splice(0).forEach((go) => go()); // a "dead" app's call from an earlier test lets go
  Object.assign(sb.state, { calls: [], synced: true, failSelect: false, selectError: null, failWrite: false, session: 'u-gm', during: null, hang: null });
  saveSyncOwner('u-gm');
  saveCampaigns([{ id: 'camp-g', code: 'GGGGGG', role: 'gm', name: 'My Table' }]);
  sb.state.campaigns = [{ id: 'camp-g', owner_id: 'u-gm' }];
  saveHomebrewSource({ id: 'S1', name: 'Shared Book' });
  saveHomebrewEntry('feats', feat('f1', 'S1'));
  saveHomebrewEntry('feats', feat('f2', 'S1'));
  saveHomebrewSource({ id: 'S2', name: 'Private Book' });
  saveHomebrewEntry('feats', feat('p1', 'S2'));
  // S1 is shared in camp-g; S2 is not.
  sb.state.rows = [{ campaign_id: 'camp-g', kind: 'source', id: 'S1', source_id: 'S1', data: { id: 'S1', name: 'Shared Book' } }];
  clearDirty(); // the setup's own writes are not under test
});

describe('campaign homebrew publish', () => {
  it('an edit in a shared source upserts exactly that one row', async () => {
    saveHomebrewEntry('feats', feat('f1', 'S1', 'F1 v2'));
    expect(dirty()).toEqual({ 'feats:f1': 'S1' });
    await flushCampaignHomebrew();
    const w = writes();
    expect(w).toHaveLength(1);
    expect(w[0].op).toBe('upsert');
    expect(w[0].rows).toEqual([{ campaign_id: 'camp-g', kind: 'feats', id: 'f1', source_id: 'S1', data: { id: 'f1', name: 'F1 v2', homebrewSourceId: 'S1' } }]);
    expect(dirty()).toEqual({});
  });

  it('a key in a source no campaign shares is dropped with no write', async () => {
    saveHomebrewEntry('feats', feat('p1', 'S2', 'P1 v2'));
    await flushCampaignHomebrew();
    // Without the not-shared skip: expected { 'feats:p1': 'S2' } to deeply equal {}
    expect(writes()).toEqual([]);
    expect(dirty()).toEqual({});
  });

  it('deleting an entry deletes its row; deleting a source deletes every row by source_id', async () => {
    deleteHomebrewEntry('feats', 'f1');
    // Source read after the delete: expected {} to deeply equal { 'feats:f1': 'S1' }
    expect(dirty()).toEqual({ 'feats:f1': 'S1' }); // the source read BEFORE the delete
    await flushCampaignHomebrew();
    expect(writes()).toEqual([
      { table: 'campaign_homebrew', op: 'delete', filters: [['eq', 'campaign_id', 'camp-g'], ['eq', 'kind', 'feats'], ['eq', 'id', 'f1']] },
    ]);

    sb.state.calls = [];
    deleteHomebrewSource('S1');
    await flushCampaignHomebrew();
    expect(writes()).toEqual([{ table: 'campaign_homebrew', op: 'delete', filters: [['eq', 'campaign_id', 'camp-g'], ['eq', 'source_id', 'S1']] }]);
  });

  it('a failed shared-read or a failed write keeps the keys dirty', async () => {
    saveHomebrewEntry('feats', feat('f1', 'S1', 'F1 v2'));
    sb.state.failSelect = true;
    await flushCampaignHomebrew();
    // Clearing the keys before the calls went out: expected {} to deeply equal { 'feats:f1': 'S1' }
    expect(writes()).toEqual([]);
    expect(dirty()).toEqual({ 'feats:f1': 'S1' });

    sb.state.failSelect = false;
    sb.state.failWrite = true;
    await flushCampaignHomebrew();
    expect(writes()).toHaveLength(1);
    expect(dirty()).toEqual({ 'feats:f1': 'S1' });

    sb.state.failWrite = false;
    await flushCampaignHomebrew();
    expect(dirty()).toEqual({});
  });

  it('signed out, RLS reads "shares nothing" — the keys wait instead of being dropped', async () => {
    saveHomebrewEntry('feats', feat('f1', 'S1', 'F1 v2'));
    // Already signed out: nothing is taken, nothing is sent. Without the check before the keys are
    // taken, a select still goes out (the re-checks below then save the keys):
    //   AssertionError: expected [ Array(1) ] to deeply equal []
    sb.state.session = null;
    await flushCampaignHomebrew();
    expect(sb.state.calls).toEqual([]);
    expect(dirty()).toEqual({ 'feats:f1': 'S1' });

    // Signed out while the shared-read is on the network: it answers zero rows, no error. Either
    // re-check (after the read, after the writes) catches this; with neither, the key is dropped as
    // "not shared":  AssertionError: expected {} to deeply equal { 'feats:f1': 'S1' }
    sb.state.session = 'u-gm';
    sb.state.during = (c) => {
      if (c.op === 'select') sb.state.session = null;
    };
    await flushCampaignHomebrew();
    expect(writes()).toEqual([]);
    expect(dirty()).toEqual({ 'feats:f1': 'S1' });

    // Signed out while a delete is on the network: it deletes nothing, no error.
    // Without the re-check after the writes: expected {} to deeply equal { 'feats:f2': 'S1' }
    clearDirty();
    deleteHomebrewEntry('feats', 'f2');
    sb.state.session = 'u-gm';
    sb.state.during = (c) => {
      if (c.op === 'delete') sb.state.session = null;
    };
    await flushCampaignHomebrew();
    expect(writes().map((c) => c.op)).toEqual(['delete']);
    expect(dirty()).toEqual({ 'feats:f2': 'S1' });
  });

  it('another account signing in mid-publish: its wipe dropped the keys, and they stay dropped', async () => {
    saveHomebrewEntry('feats', feat('f1', 'S1', 'F1 v2'));
    sb.state.during = (c) => {
      if (c.op !== 'select') return;
      wipeSyncedLocalData();
      saveSyncOwner('u-other');
      sb.state.session = 'u-other';
    };
    await flushCampaignHomebrew();
    // Without the re-check after the read, or re-checking against the CURRENT owner instead of the one
    // the publish began with, the wiped store reads as "f1 deleted" and a delete goes out:
    //   AssertionError: expected [ Array(1) ] to deeply equal []
    expect(writes()).toEqual([]);
    expect(dirty()).toEqual({});
  });

  it('an app killed while the upload is on the network still has the edit on disk; the next start sends it', async () => {
    saveHomebrewEntry('feats', feat('f1', 'S1', 'F1 v2'));
    sb.state.hang = (c) => c.op === 'upsert'; // the app dies with the upload in flight
    void flushCampaignHomebrew();
    await vi.waitFor(() => expect(sb.state.calls.some((c) => c.op === 'upsert')).toBe(true));
    // Taking the keys off disk before the calls went out (the old takeCampaignHbDirty):
    //   AssertionError: expected {} to deeply equal { 'feats:f1': 'S1' }
    expect(dirty()).toEqual({ 'feats:f1': 'S1' });

    // The next start of the app: new module instances, the same disk.
    sb.state.hang = null;
    vi.resetModules();
    const fresh = await import('../src/data/campaignHomebrew');
    await fresh.flushCampaignHomebrew();
    expect(row('camp-g', 'feats', 'f1')?.data).toEqual({ id: 'f1', name: 'F1 v2', homebrewSourceId: 'S1' });
    expect(dirty()).toEqual({});
  });

  it('a call that never answers is cancelled after 30 s: later flushes and shares still run, and the key waits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      saveHomebrewEntry('feats', feat('f1', 'S1', 'F1 v2'));
      let hangNext = true; // only the first upsert hangs
      sb.state.hang = (c) => c.op === 'upsert' && hangNext && !(hangNext = false);
      const settled: string[] = [];
      const first = flushCampaignHomebrew().then(() => settled.push('first flush'));
      const share = shareSources('camp-g', ['S2']).then((r) => (settled.push('share'), r));
      const second = flushCampaignHomebrew().then(() => settled.push('second flush'));
      await vi.waitFor(() => expect(sb.state.calls.some((c) => c.op === 'upsert')).toBe(true));
      const hung = sb.state.calls.find((c) => c.op === 'upsert')!;
      await vi.advanceTimersByTimeAsync(29_000);
      expect(settled).toEqual([]);
      expect(dirty()).toEqual({ 'feats:f1': 'S1' });

      // With no bound on the call (the old chain): every later GM write waits for good —
      //   AssertionError: expected [] to deeply equal [ 'first flush', 'share', 'second flush' ]
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.all([first, share, second]);
      expect(settled).toEqual(['first flush', 'share', 'second flush']);
      // Given up on but not cancelled, the request could still land after the writes behind it.
      // Without the signal handed to the request:  AssertionError: expected undefined to be true
      expect(hung.signal?.aborted).toBe(true);
      expect(await share).toEqual({ ok: true, value: null });
      // The edit waited on disk through the timeout and went up with the next flush.
      expect(row('camp-g', 'feats', 'f1')?.data).toMatchObject({ name: 'F1 v2' });
      expect(dirty()).toEqual({});

      // A share that never answers resolves as a failure (the campaign form's Save awaits it), never rejects.
      // Letting the timeout reject:  Error: The server didn't answer — check your connection and try again.
      hangNext = true;
      const upserts = sb.state.calls.filter((c) => c.op === 'upsert').length;
      const stuck = shareSources('camp-g', ['S2']);
      await vi.waitFor(() => expect(sb.state.calls.filter((c) => c.op === 'upsert').length).toBe(upserts + 1));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await stuck).toEqual({ ok: false, error: "The server didn't answer — check your connection and try again." });
    } finally {
      vi.useRealTimers();
    }
  });

  it('an edit made while the upload is on the network stays dirty, and the next flush sends it', async () => {
    saveHomebrewEntry('feats', feat('f1', 'S1', 'F1 v2'));
    sb.state.during = (c) => {
      if (c.op !== 'upsert') return;
      sb.state.during = null;
      saveHomebrewEntry('feats', feat('f1', 'S1', 'F1 v3')); // same key, same source — only the record moved
    };
    await flushCampaignHomebrew();
    expect(row('camp-g', 'feats', 'f1')?.data).toMatchObject({ name: 'F1 v2' });
    // Clearing every key the flush read, not only the ones whose record is still what it sent:
    //   AssertionError: expected {} to deeply equal { 'feats:f1': 'S1' }
    expect(dirty()).toEqual({ 'feats:f1': 'S1' });
    await flushCampaignHomebrew();
    expect(row('camp-g', 'feats', 'f1')?.data).toMatchObject({ name: 'F1 v3' });
    expect(dirty()).toEqual({});
  });

  it('a source shared in a campaign this device does not list yet is still uploaded, not dropped', async () => {
    // camp-h was made on another device; this device's membership list hasn't caught up. The server
    // says the account owns it, and S2 is shared there.
    sb.state.campaigns.push({ id: 'camp-h', owner_id: 'u-gm' });
    sb.state.rows.push({ campaign_id: 'camp-h', kind: 'source', id: 'S2', source_id: 'S2', data: { id: 'S2', name: 'Private Book' } });
    saveHomebrewEntry('feats', feat('p1', 'S2', 'P1 v2'));
    await flushCampaignHomebrew();
    // Reading "shared" only for this device's own GM list:
    //   AssertionError: expected undefined to match object { name: 'P1 v2' }
    expect(row('camp-h', 'feats', 'p1')?.data).toMatchObject({ name: 'P1 v2' });
    expect(dirty()).toEqual({});
  });

  it('the shared list UNKNOWN (table missing, owned list unreadable) keeps every key', async () => {
    saveHomebrewEntry('feats', feat('p1', 'S2', 'P1 v2')); // not shared — but that can't be known here
    sb.state.selectError = { message: "Could not find the table 'public.campaign_homebrew'", code: 'PGRST205' };
    await flushCampaignHomebrew();
    expect(writes()).toEqual([]);
    expect(dirty()).toEqual({ 'feats:p1': 'S2' });
    sb.state.selectError = null;
    sb.state.failSelect = true;
    await flushCampaignHomebrew();
    expect(dirty()).toEqual({ 'feats:p1': 'S2' });
    // Read, and known not shared anywhere: now it is dropped.
    sb.state.failSelect = false;
    await flushCampaignHomebrew();
    expect(writes()).toEqual([]);
    expect(dirty()).toEqual({});
  });

  it('the share controls answer UNKNOWN, not "nothing shared", when signed out', async () => {
    // Without the session checks:  AssertionError: expected [] to be null
    // Without the re-check after the unshare's delete:
    //   AssertionError: expected { ok: true, value: null } to deeply equal { ok: false, …(1) }
    expect(await fetchSharedSourceIds('camp-g')).toEqual(['S1']);
    expect(await sharedSourceCampaigns()).toEqual({ S1: ['My Table'] });
    sb.state.session = null;
    expect(await fetchSharedSourceIds('camp-g')).toBeNull();
    expect(await sharedSourceCampaigns()).toBeNull();
    sb.state.session = 'u-gm';
    sb.state.during = () => {
      sb.state.session = null;
    };
    expect(await fetchSharedSourceIds('camp-g')).toBeNull();
    sb.state.session = 'u-gm';
    expect(await sharedSourceCampaigns()).toBeNull();
    sb.state.session = 'u-gm';
    expect(await unshareSources('camp-g', ['S1'])).toEqual({ ok: false, error: 'Sign in to share homebrew.' });
  });

  it('with no GM campaign on this device the keys wait — no network, nothing dropped — until it has one', async () => {
    saveCampaigns([{ id: 'camp-p', code: 'PPPPPP', role: 'player', name: 'Their Table' }]);
    saveHomebrewEntry('feats', feat('f1', 'S1', 'F1 v2'));
    await flushCampaignHomebrew();
    expect(sb.state.calls).toEqual([]);
    // Clearing the set here (the old rule) throws the edit away for good:
    //   AssertionError: expected {} to deeply equal { 'feats:f1': 'S1' }
    expect(dirty()).toEqual({ 'feats:f1': 'S1' });
    // The GM membership syncs to this device: the waiting edit goes up.
    saveCampaigns([{ id: 'camp-g', code: 'GGGGGG', role: 'gm', name: 'My Table' }]);
    await flushCampaignHomebrew();
    expect(row('camp-g', 'feats', 'f1')?.data).toMatchObject({ name: 'F1 v2' });
    expect(dirty()).toEqual({});
  });

  it('shareSources upserts the source row plus every entry of it, and refuses before the first sync', async () => {
    sb.state.synced = false;
    // Without the refusal: expected { ok: true, value: null } to deeply equal { ok: false, …(1) }
    expect(await shareSources('camp-g', ['S2'])).toEqual({ ok: false, error: 'Still syncing — save again in a moment.' });
    expect(sb.state.calls).toEqual([]);

    sb.state.synced = true;
    expect(await shareSources('camp-g', ['S2'])).toEqual({ ok: true, value: null });
    const w = writes();
    expect(w).toHaveLength(1);
    expect(w[0].rows).toEqual([
      { campaign_id: 'camp-g', kind: 'source', id: 'S2', source_id: 'S2', data: { id: 'S2', name: 'Private Book' } },
      { campaign_id: 'camp-g', kind: 'feats', id: 'p1', source_id: 'S2', data: { id: 'p1', name: 'p1', homebrewSourceId: 'S2' } },
    ]);
  });

  it('adopting a cloud bundle dirties nothing — a pull is not an edit', () => {
    const b = readCloudBundle();
    b.homebrewSources.S9 = { id: 'S9', name: 'From Another Device' };
    b.homebrew.feats.f9 = feat('f9', 'S1');
    writeCloudBundle(b);
    // writeCloudBundle marking its sources: expected '{"src:S1":"S1","src:S2":"S2","src:S9"…' to be null
    expect(localStorage.getItem(CAMPAIGN_HB_DIRTY_KEY)).toBeNull();
  });
});
