// CAMPAIGN HOMEBREW — a GM's own homebrew, shared read-only with a campaign's players
// (supabase-campaign-homebrew.sql: one row per shared record, only the GM writes).
//
// WHO CAN READ — the campaign-system convention. Membership lives in each player's own synced data, not
// on the server, so every campaign table (campaign_characters, this one) lets any signed-in account the
// GM hasn't kicked read the rows; the app only ever asks for the campaigns the player holds. Real
// server-side membership is a separate task: it would tighten every campaign table at once.
//
// GM SIDE (publish). The GM's originals stay in his own synced homebrew; the table is only the
// published copy. The four storage writers put every edited key on a device-local dirty set; a flush
// 3 s after the last edit (and at start, on focus, on online) uploads only those keys, and only for
// sources a campaign of his actually shares. A key leaves the set only after its upload went through:
// offline, failed or killed mid-flight, it waits on disk for the next try.
//
// PLAYER SIDE (pull). Each device keeps its last pulled copy in a device-local cache (storage.ts),
// merged into the content database as its own layer (index.ts mergeWithSeed). THE RULE this app has
// broken three times — a player's data is never overwritten by the app — shapes every step:
//   • UNKNOWN IS NOT EMPTY. No session, a failed read, a missing table, a short page, a sign-out
//     during the fetch: the pull changes NOTHING. Under RLS a missing session reads as zero rows, not
//     an error, which is why the user is checked before and after the read;
//   • what the GM takes away becomes the PLAYER'S OWN homebrew (convertGone) — written through the
//     ordinary saveHomebrewEntry/saveHomebrewSource, only into ids the player doesn't already hold,
//     never over one of their tombstones. Nothing is ever deleted from the player's own store here.
import { supabase } from './supabase';
import { hasSyncedOnce } from './cloudSync';
import { flushPersist } from './persist';
import { isPrintedId, printedIdsReady } from './index';
import { onCampaignHbDirty } from './syncBus';
import {
  HOMEBREW_TYPES,
  campaignMemberIds,
  clearCampaignHbDirty,
  loadCampaignHbCache,
  loadCampaignHbDirty,
  loadCampaigns,
  loadHomebrewContent,
  loadHomebrewSources,
  loadRevived,
  loadRoster,
  loadSyncOwner,
  loadTombstones,
  newRosterId,
  saveCampaignHbCache,
  saveHomebrewEntry,
  saveHomebrewSource,
  type CampaignHbCampaign,
  type HomebrewContent,
  type HomebrewSource,
  type HomebrewType,
} from './storage';
import { sanitize, sanitizeEntryHtml } from '../sheet/sanitizeHtml';
import type { CampaignResult } from './campaigns';

// Lives in storage.ts (no supabase there); re-exported for the callers that pair it with the pull.
export { homebrewFingerprint } from './storage';

const TABLE = 'campaign_homebrew';
const COLS = 'campaign_id,kind,id,source_id,data,updated_at';
const PAGE = 1000;
const FLUSH_DEBOUNCE_MS = 3000;
const FOCUS_PULL_THROTTLE_MS = 30_000;
const REALTIME_DEBOUNCE_MS = 1500;
const NOT_SET_UP = "Campaign homebrew isn't set up on the server yet — ask the app owner to run supabase-campaign-homebrew.sql.";

type Row = { campaign_id: string; kind: string; id: string; source_id: string; data: unknown; updated_at?: string };
type Entry = Record<string, unknown> & { id: string; homebrewSourceId?: string };

function friendly(error: { message?: string; code?: string } | null | undefined): string {
  const msg = error?.message || '';
  if (error?.code === 'PGRST205' || /PGRST205|does not exist|Could not find the table/i.test(msg)) return NOT_SET_UP;
  return msg || 'Something went wrong. Please try again.';
}

/** Server timestamps as numbers — PostgREST spells one instant several ways (see trackerSync.ts). */
function ms(s: string | undefined): number {
  const n = s ? Date.parse(s) : NaN;
  return Number.isNaN(n) ? 0 : n;
}

/** How long one network step may take. supabase-js sets no fetch timeout, and the GM's writes run one
 *  at a time (serial) as do the pulls (running/queued): one call that never answered held every later
 *  flush, share and pull for the rest of the session. */
const CALL_MS = 30_000;
const NO_ANSWER = "The server didn't answer — check your connection and try again.";

/** One network step, given up after CALL_MS. `start` hands the signal to the request (a PostgREST
 *  builder's .abortSignal) so a step given up on is CANCELLED — it can't land after the next GM write
 *  began. Given up is a failure, never an empty answer: every caller treats it as UNKNOWN. */
async function bounded<T>(start: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CALL_MS);
  try {
    return await Promise.race([
      start(ctl.signal),
      new Promise<never>((_, fail) => ctl.signal.addEventListener('abort', () => fail(new Error(NO_ANSWER)))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** This account's real (server-side) campaign ids in one role, sorted so the list compares as a string.
 *  One definition (storage.ts), so the ids a pull reads for are the ids campaignHbCacheKnown checks. */
const memberIds = campaignMemberIds;

let started = false;
/** Bumped by every start and stop: a pull captures it before its first await and drops what it read
 *  if it moved — a sign-out must not be followed by the previous session's rows landing. */
let generation = 0;
let onChanged: (() => void) | null = null;
let stopCurrent: (() => void) | null = null;
let lastPullAt = 0;
/** The player-membership ids the last pull that reached the network asked for ('hh-synced' re-pulls
 *  only when they change — it fires on every cloud adopt). */
let pulledIds: string | null = null;
/** Did the LAST pull leave a campaign unread because this device refused a write (a full storage)? */
let pullFull = false;

/**
 * True when the last pull read every row but could not keep what it read: a conversion of something the
 * GM took away, or the cache's own write, was refused by a full storage — so a campaign stays out of the
 * copy's read list (storage.ts campaignHbCacheKnown) for want of room, not of a connection. Every pull
 * answers afresh: one that stops short (offline, before the first cloud sync) says false, and so does a
 * stopped session (a sign-out), whose pulls no longer run.
 */
export function campaignHomebrewStorageFull(): boolean {
  return pullFull;
}

/** Signed in, positively signed out, or no cloud at all: see accountStateHere. */
export type AccountHere = 'no-cloud' | 'signed-out' | 'signed-in';

/**
 * Is this device signed in right now, positively SIGNED OUT, or without a cloud at all? The Homebrew
 * import's UNKNOWN check (sheet/HomebrewPage.tsx) waits for this session's first cloud pull only while
 * signed in. An auth client that can't answer — it threw, gave up after CALL_MS, or reported an error
 * with no session (what supabase-js does for an expired token it couldn't refresh offline) — is NOT
 * signed out: the app may still be signed in, with its first pull not landed.
 */
export async function accountStateHere(): Promise<AccountHere> {
  const client = supabase;
  if (!client) return 'no-cloud';
  const res = await bounded(() => client.auth.getSession()).catch(() => null);
  return !!res && !res.error && !res.data.session ? 'signed-out' : 'signed-in';
}

/* ---- PULL ------------------------------------------------------------------------------------------ */

let running: Promise<boolean> | null = null;
let queued: Promise<boolean> | null = null;

/**
 * Pull every campaign's shared homebrew into this device's cache. Resolves true when anything changed
 * (and onChanged has been called). One at a time: a pull asked for while one is on the network is
 * QUEUED behind it (coalesced, never dropped — the rows in the air were read before whatever asked).
 */
export function refreshCampaignHomebrew(): Promise<boolean> {
  if (!started) return Promise.resolve(false);
  resubscribe(); // a join/leave changes what Realtime should watch; a no-op otherwise
  if (!running) {
    running = pullOnce(generation)
      .catch((e) => {
        console.warn('[CampaignHomebrew] pull failed — keeping the last copy:', e);
        return false;
      })
      .finally(() => {
        running = null;
      });
    return running;
  }
  queued ??= running.then(() => {
    queued = null;
    return refreshCampaignHomebrew();
  });
  return queued;
}

async function pullOnce(g: number): Promise<boolean> {
  pullFull = false; // this pull's own answer, from the save below; one that stops short has none
  const client = supabase;
  // Before the first cloud sync the membership list may be stale or empty — reading it as "left every
  // campaign" would convert them all.
  if (!client || !hasSyncedOnce()) return false;
  // convertGone's printed-id check needs core.json: before it has loaded only the seed is known, and a
  // campaign row reusing a printed id would become the player's OWN record, which replaces the book's.
  // A failed load is UNKNOWN for the whole session: nothing changes.
  if (!(await printedIdsReady())) return false;
  const user = (await bounded(() => client.auth.getUser())).data.user;
  if (!user || user.id !== loadSyncOwner() || g !== generation) return false;
  const uid = user.id;
  const ids = memberIds('player');
  pulledIds = ids.join(',');
  lastPullAt = Date.now();
  const rows: Row[] = [];
  if (ids.length) {
    let total = -1;
    for (;;) {
      // Every page after the first starts ONE row early, on the row the last page ended with. A GM write
      // between two pages that moved it (a delete or an insert among the rows already read — even one
      // of each, which keeps the count) shifts every offset, and a live row could fall between the
      // pages and read as gone. Moved means give up; unmoved means nothing was skipped.
      const from = Math.max(rows.length - 1, 0);
      const { data, error, count } = await bounded((signal) =>
        client
          .from(TABLE)
          .select(COLS, { count: 'exact' })
          .in('campaign_id', ids)
          .order('campaign_id')
          .order('kind')
          .order('id')
          .range(from, from + PAGE - 1)
          .abortSignal(signal),
      );
      if (error || !Array.isArray(data) || typeof count !== 'number' || g !== generation) return false;
      // A COPY: the shift below must not shrink `data`, whose length is the "last page" test further
      // down (aliased, every second page read as the last one and a 3-page share never finished).
      const page = [...data] as Row[];
      if (rows.length) {
        const [a, b] = [page.shift(), rows[rows.length - 1]];
        if (!a || a.campaign_id !== b.campaign_id || a.kind !== b.kind || a.id !== b.id) return false;
      }
      total = count;
      rows.push(...page);
      if (data.length < PAGE || rows.length >= total) break;
    }
    if (rows.length !== total) return false; // a short read is not "the GM deleted the rest"
    // Signed out (or another account signed in) while the read was on the network.
    if ((await bounded(() => client.auth.getSession())).data.session?.user?.id !== uid || g !== generation) return false;
  }

  const names = new Map(loadCampaigns().map((m) => [m.id, m.name]));
  const old = loadCampaignHbCache();
  const next: Record<string, CampaignHbCampaign> = {};
  const bad = new Set<string>();
  for (const r of rows) {
    const cid = r?.campaign_id;
    if (typeof cid !== 'string' || !ids.includes(cid)) continue;
    if (r.kind !== 'source' && !(HOMEBREW_TYPES as string[]).includes(r.kind)) continue; // a bucket this build doesn't know
    const camp = (next[cid] ??= { name: names.get(cid) ?? '', sources: {}, content: {}, updatedAt: '' });
    if (typeof r.updated_at === 'string' && ms(r.updated_at) > ms(camp.updatedAt)) camp.updatedAt = r.updated_at;
    const d = r.data as Record<string, unknown> | null;
    if (typeof r.id !== 'string' || !d || typeof d !== 'object' || Array.isArray(d) || typeof d.name !== 'string') {
      bad.add(cid);
      continue;
    }
    if (r.kind === 'source') {
      // Rebuilt from explicit fields only: nothing the GM's app stored beside them rides along.
      const src: HomebrewSource = { id: r.id, name: d.name };
      if (typeof d.abbreviation === 'string') src.abbreviation = d.abbreviation;
      if (typeof d.description === 'string') src.description = sanitize(d.description);
      camp.sources[r.id] = src;
    } else {
      if (d.id !== r.id || typeof r.source_id !== 'string') {
        bad.add(cid);
        continue;
      }
      ((camp.content[r.kind as HomebrewType] ??= {}) as Record<string, unknown>)[r.id] = sanitizeEntryHtml({ ...d, homebrewSourceId: r.source_id });
      if (typeof r.updated_at === 'string') (camp.stamps ??= {})[`${r.kind}:${r.id}`] = r.updated_at;
    }
  }
  for (const [cid, camp] of Object.entries(next)) {
    // One row we can't read makes that campaign UNKNOWN: keep what this device already had for it.
    if (bad.has(cid)) {
      if (old[cid]) next[cid] = old[cid];
      else delete next[cid];
      continue;
    }
    // An entry whose source row is missing has no source to be switched on from.
    for (const t of HOMEBREW_TYPES) {
      const bucket = camp.content[t] as Record<string, Entry> | undefined;
      for (const [id, e] of Object.entries(bucket ?? {})) {
        if (!camp.sources[e.homebrewSourceId ?? '']) {
          delete bucket![id];
          delete camp.stamps?.[`${t}:${id}`];
        }
      }
    }
  }

  // The player's own store first, the cache second: a crash in between just converts again. A campaign
  // whose conversion did not finish (a full storage) keeps its OLD copy in the cache — still on screen,
  // and the next pull converts the rest. Dropped from the cache, what didn't land would be gone.
  const { wrote, unfinished } = convertGone(old, next);
  for (const cid of unfinished) next[cid] = old[cid];
  // The campaigns this copy now holds a FULL read of (storage.ts campaignHbCacheKnown): every one asked
  // for, less one with a row we couldn't read and one whose conversion didn't finish — both hold their
  // OLD copy (or none), not what the GM shares now.
  const saved = saveCampaignHbCache(
    uid,
    next,
    ids.filter((cid) => !bad.has(cid) && !unfinished.has(cid)),
  );
  // Only a campaign the player is still in counts: one left since converts too, but the read list never
  // asks about it.
  pullFull = !saved || ids.some((cid) => unfinished.has(cid));
  if (!wrote && JSON.stringify(old) === JSON.stringify(next)) return false;
  onChanged?.();
  return true;
}

/**
 * What the GM took away becomes the player's own homebrew, in a fixed-id KEPT source
 * (`hbsrc-kept-<GM source id>`) with the same entry ids and the same name, so every character that
 * used it keeps working and stays switched on.
 *   • a whole source gone (unshared, deleted, campaign gone, kicked, left) keeps all its entries;
 *   • one entry gone from a source that is still shared was deleted on purpose, so it is kept only
 *     where one of the player's characters still uses it.
 * Never over an id the player already holds, never a printed id. Something one of the player's
 * characters uses always comes back; anything else stays deleted only when the player deleted it AFTER
 * the GM's row was last written (see `deletedAt` below).
 * `unfinished` names every old campaign something of which should have landed and didn't.
 */
function convertGone(
  old: Record<string, CampaignHbCampaign>,
  next: Record<string, CampaignHbCampaign>,
): { wrote: boolean; unfinished: Set<string> } {
  // Across ALL campaigns: a source shared in two stays live while either still has it.
  const live = new Set<string>();
  for (const camp of Object.values(next)) {
    for (const id of Object.keys(camp.sources)) live.add(`src:${id}`);
    for (const t of HOMEBREW_TYPES) for (const id of Object.keys(camp.content[t] ?? {})) live.add(`${t}:${id}`);
  }
  const tomb = loadTombstones();
  const rev = loadRevived();
  /** When the player deleted this key (a live tombstone), else 0. */
  const deletedAt = (k: string) => ((tomb[k] ?? 0) > (rev[k] ?? 0) ? tomb[k] : 0);
  let rosterJson: string | null = null;
  const usedByRoster = (id: string): boolean => {
    if (rosterJson === null) {
      flushPersist(); // a pick still inside the 400 ms persist debounce is a real pick
      rosterJson = JSON.stringify(loadRoster());
    }
    // ponytail: a substring scan of the whole saved roster for `"<id>"` — any field of any character
    // counts as "uses it". An unrelated string equal to the id keeps an entry it didn't need to; walk
    // the build's reference fields instead if that ever matters.
    return rosterJson.includes(JSON.stringify(id));
  };

  let wrote = false;
  const unfinished = new Set<string>();
  for (const [cid, camp] of Object.entries(old)) {
    const bySource = new Map<string, { t: HomebrewType; e: Entry }[]>();
    for (const sid of Object.keys(camp.sources ?? {})) if (!live.has(`src:${sid}`)) bySource.set(sid, []);
    for (const t of HOMEBREW_TYPES) {
      for (const [id, e] of Object.entries(camp.content?.[t] ?? {}) as [string, Entry][]) {
        const sid = e.homebrewSourceId;
        if (live.has(`${t}:${id}`) || !sid || !camp.sources?.[sid]) continue;
        if (live.has(`src:${sid}`) && !usedByRoster(id)) continue;
        if (!bySource.has(sid)) bySource.set(sid, []);
        bySource.get(sid)!.push({ t, e });
      }
    }
    for (const [sid, list] of bySource) {
      const keptId = `hbsrc-kept-${sid}`;
      const own = loadHomebrewContent();
      const want: { t: HomebrewType; id: string; json: string }[] = [];
      for (const { t, e } of list) {
        if (isPrintedId(t, e.id)) continue;
        // The player deleted it (the entry, or the whole kept book): that stands only when it happened
        // AFTER the GM last wrote this row — deleted, then shared again, the GM taking it away once more
        // is new. Their device's tombstone is compared with the SERVER's stamp only, never with another
        // device's clock; no stamp (a cache from before stamps) is 0, so any live tombstone wins. And
        // content a character uses always comes back: a GM's removal never takes it off a sheet.
        const deleted = Math.max(deletedAt(`hb:${t}:${e.id}`), deletedAt(`hbsrc:${keptId}`));
        if (deleted > ms(camp.stamps?.[`${t}:${e.id}`]) && !usedByRoster(e.id)) continue;
        const conv = { ...e, homebrewSourceId: keptId };
        const json = JSON.stringify(conv);
        const mine = own[t][e.id];
        // An id the player holds is theirs — unless it is byte-for-byte what this conversion writes: an
        // earlier run saved it and stopped (a crash, a full storage) before its source line below.
        if (mine && JSON.stringify(mine) !== json) continue;
        if (!mine) saveHomebrewEntry(t, conv as never);
        want.push({ t, id: e.id, json });
      }
      if (!want.length) continue;
      // saveHomebrewEntry swallows a full storage: count only what is on disk now.
      const after = loadHomebrewContent();
      const landed = want.filter((w) => JSON.stringify(after[w.t][w.id]) === w.json).map((w) => `${w.t}:${w.id}`);
      if (landed.length < want.length) unfinished.add(cid);
      // Nothing landed (the player already holds or deleted every id, or the source was empty): no
      // source either — an empty kept book is clutter, not something kept.
      if (!landed.length) continue;
      // The source LAST: saved first, its kept list would be stripped by the entry saves above
      // (saveHomebrewEntry reads a save into a kept source as the player editing that entry).
      const existing = loadHomebrewSources()[keptId];
      const ids = [...new Set([...(existing?.kept?.ids ?? []), ...landed])];
      if (existing && ids.length === (existing.kept?.ids ?? []).length) continue; // already whole
      const src = camp.sources[sid];
      saveHomebrewSource(
        existing
          ? // The player's own name/notes on it stay theirs; only the kept list grows.
            { ...existing, kept: { from: existing.kept?.from ?? camp.name, ids } }
          : {
              id: keptId,
              name: src.name,
              ...(src.abbreviation ? { abbreviation: src.abbreviation } : {}),
              ...(src.description ? { description: src.description } : {}),
              kept: { from: camp.name, ids },
            },
      );
      wrote = true;
      if (!loadHomebrewSources()[keptId]) unfinished.add(cid); // swallowed the same way
    }
  }
  return { wrote, unfinished };
}

/* ---- FLUSH (the GM's publish) ------------------------------------------------------------------------ */

/** Every GM write (flush, share, unshare) runs one at a time, so a flush can never re-upload rows an
 *  unshare is deleting from a "shared" list it read before the delete. Every network step inside one is
 *  bounded(), so each link settles and the next one runs. */
let gmChain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = gmChain.then(fn, fn);
  gmChain = p.catch(() => {});
  return p;
}

/** True while `uid` (this device's account when the call began) still owns this device's data AND is
 *  the one signed in. Signed out, RLS answers a select with zero rows and a delete with nothing deleted
 *  — never an error — so every GM-side read and delete asks this before AND after its network step, and
 *  a "no" is UNKNOWN, not "nothing shared". No answer from the auth client is a "no". */
async function signedInAs(uid: string | null): Promise<boolean> {
  const client = supabase;
  if (!client || !uid) return false;
  const session = await bounded(() => client.auth.getSession()).catch(() => null);
  return session?.data.session?.user?.id === uid && uid === loadSyncOwner();
}

/** A dirty key's record as it is on disk (undefined once it's gone): "unchanged since it was read". */
function recordJson(key: string, content: HomebrewContent, sources: Record<string, HomebrewSource>): string | undefined {
  const at = key.indexOf(':');
  const id = key.slice(at + 1);
  const kind = key.slice(0, at);
  return JSON.stringify(kind === 'src' ? sources[id] : (content as unknown as Record<string, Record<string, unknown> | undefined>)[kind]?.[id]);
}

/** Upload the dirty keys of every source a campaign of this GM shares. A key leaves the dirty set only
 *  once this went through; anything else — a failure, a sign-out, the app killed mid-flight — leaves it. */
export function flushCampaignHomebrew(): Promise<void> {
  return serial(flushOnce);
}

async function flushOnce(): Promise<void> {
  const client = supabase;
  if (!client || !hasSyncedOnce()) return;
  // Not a GM on this device (yet — a campaign made on another device may not have synced here): the
  // keys wait. Nothing but a successful read that says "not shared" ever drops one.
  const localGm = memberIds('gm');
  if (!localGm.length) return;
  const uid = loadSyncOwner();
  if (!uid || !(await signedInAs(uid))) return; // the keys wait on disk
  // READ, not taken: every key stays on disk until its upload went through, so an app killed while the
  // calls below are in flight still has the edit (the next flush sends it again — an upsert, harmless).
  const keys = loadCampaignHbDirty();
  if (!Object.keys(keys).length) return;
  try {
    // Every campaign this account owns, from the SERVER as well as this device's list: a campaign made
    // on another device may not be in the list yet, and a key shared only there would read as "not
    // shared" and be dropped.
    const owned = await bounded((signal) => client.from('campaigns').select('id').eq('owner_id', uid).abortSignal(signal));
    if (owned.error || !Array.isArray(owned.data)) throw owned.error ?? new Error('no answer');
    const gmIds = [...new Set([...localGm, ...(owned.data as { id: string }[]).map((r) => r.id)])];
    const { data, error } = await bounded((signal) =>
      client.from(TABLE).select('campaign_id,id').eq('kind', 'source').in('campaign_id', gmIds).abortSignal(signal),
    );
    if (error || !Array.isArray(data)) throw error ?? new Error('no answer');
    if (!(await signedInAs(uid))) throw new Error('signed out during the publish');
    const sharedIn = new Map<string, string[]>(); // GM source id → campaigns sharing it
    for (const r of data as { campaign_id: string; id: string }[]) {
      if (!sharedIn.has(r.id)) sharedIn.set(r.id, []);
      sharedIn.get(r.id)!.push(r.campaign_id);
    }
    // Read AFTER the await: the newest local state is what goes up.
    const content = loadHomebrewContent();
    const sources = loadHomebrewSources();
    const sent = new Map(Object.keys(keys).map((k) => [k, recordJson(k, content, sources)]));
    const upserts: Row[] = [];
    const deletes: ((signal: AbortSignal) => PromiseLike<{ error: unknown }>)[] = [];
    for (const [key, sid] of Object.entries(keys)) {
      const camps = sharedIn.get(sid);
      if (!camps) continue; // read and not shared in any campaign this account owns — settled, dropped
      const at = key.indexOf(':');
      const kind = key.slice(0, at);
      const id = key.slice(at + 1);
      for (const cid of camps) {
        if (kind === 'src') {
          if (sources[id]) upserts.push({ campaign_id: cid, kind: 'source', id, source_id: id, data: sources[id] });
          else deletes.push((signal) => client.from(TABLE).delete().eq('campaign_id', cid).eq('source_id', id).abortSignal(signal));
        } else if ((HOMEBREW_TYPES as string[]).includes(kind)) {
          const e = content[kind as HomebrewType][id] as unknown as Entry | undefined;
          if (e && e.homebrewSourceId === sid) upserts.push({ campaign_id: cid, kind, id, source_id: sid, data: e });
          else deletes.push((signal) => client.from(TABLE).delete().eq('campaign_id', cid).eq('kind', kind).eq('id', id).abortSignal(signal));
        }
      }
    }
    for (const del of deletes) {
      const { error: e } = await bounded(del);
      if (e) throw e;
    }
    // No updated_at: the server's trigger stamps it.
    if (upserts.length) {
      const { error: e } = await bounded((signal) => client.from(TABLE).upsert(upserts).abortSignal(signal));
      if (e) throw e;
    }
    if (!(await signedInAs(uid))) throw new Error('signed out during the publish'); // a delete may have been a no-op
    // Forget exactly what this flush settled. A record written again while the calls were on the
    // network no longer matches what was read — it stays dirty and goes up with the next flush.
    const nowContent = loadHomebrewContent();
    const nowSources = loadHomebrewSources();
    clearCampaignHbDirty(Object.fromEntries(Object.entries(keys).filter(([k]) => recordJson(k, nowContent, nowSources) === sent.get(k))));
  } catch (e) {
    console.warn('[CampaignHomebrew] publish failed — the edits wait on disk for the next try:', e);
  }
}

/* ---- The GM's share controls ------------------------------------------------------------------------- */

/** The GM's sources a campaign shares right now, or null when that can't be read (UNKNOWN). */
export async function fetchSharedSourceIds(campaignId: string): Promise<string[] | null> {
  const uid = loadSyncOwner();
  const client = supabase;
  if (!client || !(await signedInAs(uid))) return null;
  const { data, error } = await bounded((signal) =>
    client.from(TABLE).select('id').eq('campaign_id', campaignId).eq('kind', 'source').abortSignal(signal),
  ).catch(() => ({ data: null, error: true }));
  if (error || !Array.isArray(data) || !(await signedInAs(uid))) return null;
  return (data as { id: string }[]).map((r) => r.id);
}

/** A share-control write that never rejects: the campaign form awaits it with Save held busy. */
async function gmWrite(start: (signal: AbortSignal) => PromiseLike<{ error: { message?: string; code?: string } | null }>) {
  const { error } = await bounded(start).catch((e: Error) => ({ error: { message: e.message } }));
  return error ? friendly(error) : null;
}

/** Share sources: ONE upsert of each source row plus every entry in it — the only whole-source push. */
export function shareSources(campaignId: string, sourceIds: string[]): Promise<CampaignResult<null>> {
  return serial(async (): Promise<CampaignResult<null>> => {
    if (!supabase) return { ok: false, error: 'Sign in to share homebrew.' };
    // Before the first sync this device's homebrew may be missing what another device added.
    if (!hasSyncedOnce()) return { ok: false, error: 'Still syncing — save again in a moment.' };
    const sources = loadHomebrewSources();
    const content = loadHomebrewContent();
    const rows: Row[] = [];
    for (const sid of sourceIds) {
      if (!sources[sid]) continue;
      rows.push({ campaign_id: campaignId, kind: 'source', id: sid, source_id: sid, data: sources[sid] });
      for (const t of HOMEBREW_TYPES) {
        for (const [id, e] of Object.entries(content[t]) as [string, Entry][]) {
          if (e.homebrewSourceId === sid) rows.push({ campaign_id: campaignId, kind: t, id, source_id: sid, data: e });
        }
      }
    }
    if (!rows.length) return { ok: true, value: null };
    const client = supabase;
    const error = await gmWrite((signal) => client.from(TABLE).upsert(rows).abortSignal(signal));
    return error ? { ok: false, error } : { ok: true, value: null };
  });
}

/** Unshare sources: delete their rows. Players' apps then keep what they had as their own homebrew. */
export function unshareSources(campaignId: string, sourceIds: string[]): Promise<CampaignResult<null>> {
  return serial(async (): Promise<CampaignResult<null>> => {
    const uid = loadSyncOwner();
    if (!supabase || !(await signedInAs(uid))) return { ok: false, error: 'Sign in to share homebrew.' };
    if (!sourceIds.length) return { ok: true, value: null };
    const client = supabase;
    const error = await gmWrite((signal) => client.from(TABLE).delete().eq('campaign_id', campaignId).in('source_id', sourceIds).abortSignal(signal));
    if (error) return { ok: false, error };
    // Signed out mid-call, the delete "succeeds" on nothing: not an unshare.
    return (await signedInAs(uid)) ? { ok: true, value: null } : { ok: false, error: 'Sign in to share homebrew.' };
  });
}

/** GM: source id → the names of his campaigns sharing it. null when it can't be read (UNKNOWN). */
export async function sharedSourceCampaigns(): Promise<Record<string, string[]> | null> {
  if (!supabase) return null;
  const gm = loadCampaigns().filter((m) => m.role === 'gm' && !m.local);
  if (!gm.length) return {};
  const uid = loadSyncOwner();
  if (!(await signedInAs(uid))) return null;
  const client = supabase;
  const { data, error } = await bounded((signal) =>
    client
      .from(TABLE)
      .select('campaign_id,id')
      .eq('kind', 'source')
      .in('campaign_id', gm.map((m) => m.id))
      .abortSignal(signal),
  ).catch(() => ({ data: null, error: true }));
  if (error || !Array.isArray(data) || !(await signedInAs(uid))) return null;
  const names = new Map(gm.map((m) => [m.id, m.name]));
  const out: Record<string, string[]> = {};
  for (const r of data as { campaign_id: string; id: string }[]) (out[r.id] ??= []).push(names.get(r.campaign_id) ?? '');
  return out;
}

/* ---- The player's export ----------------------------------------------------------------------------- */

/**
 * Copy a campaign source into the player's own homebrew as an INDEPENDENT source: new source id, new
 * entry ids, "<name> (my copy)". Every reference inside the copied entries to an old id (the source,
 * a heritage's ancestry, a deity's refs…) is remapped to the copy's id. Returns the new source id.
 */
export function exportCampaignSource(campaignId: string, sourceId: string): string | null {
  const camp = loadCampaignHbCache()[campaignId];
  const src = camp?.sources?.[sourceId];
  if (!camp || !src) return null;
  const newSourceId = `hbsrc-${newRosterId()}`;
  const idMap = new Map<string, string>([[sourceId, newSourceId]]);
  const list: { t: HomebrewType; e: Entry }[] = [];
  for (const t of HOMEBREW_TYPES) {
    for (const e of Object.values(camp.content?.[t] ?? {}) as Entry[]) {
      if (e.homebrewSourceId !== sourceId) continue;
      list.push({ t, e });
      idMap.set(e.id, `${e.id}-copy-${newRosterId()}`);
    }
  }
  // ONE pass over the JSON: every string literal that IS an old id becomes the new one.
  const json = JSON.stringify(list.map((x) => x.e)).replace(/"(?:[^"\\]|\\.)*"/g, (lit) => {
    const to = idMap.get(JSON.parse(lit) as string);
    return to === undefined ? lit : JSON.stringify(to);
  });
  const copies = JSON.parse(json) as Entry[];
  const taken = new Set(Object.values(loadHomebrewSources()).map((s) => s.name.trim().toLowerCase()));
  let name = `${src.name} (my copy)`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${src.name} (my copy) ${n}`;
  saveHomebrewSource({
    id: newSourceId,
    name,
    ...(src.abbreviation ? { abbreviation: src.abbreviation } : {}),
    ...(src.description ? { description: src.description } : {}),
  });
  copies.forEach((e, i) => saveHomebrewEntry(list[i].t, sanitizeEntryHtml(e) as never));
  return newSourceId;
}

/* ---- Lifecycle --------------------------------------------------------------------------------------- */

let channelUnsub: (() => void) | null = null;
let subKey: string | null = null;
let subSeq = 0;
let rtTimer: ReturnType<typeof setTimeout> | null = null;

/** Watch this player's campaigns live; re-subscribes only when the membership ids changed. DELETE is
 *  not watched (RLS can't filter what it no longer sees) — the next focus pull catches removals. */
function resubscribe(): void {
  const client = supabase;
  if (!started || !client) return;
  const ids = memberIds('player');
  const key = ids.join(',');
  if (key === subKey) return;
  subKey = key;
  channelUnsub?.();
  channelUnsub = null;
  if (!ids.length) return;
  const filter = `campaign_id=in.(${ids.join(',')})`;
  const onRow = () => {
    if (rtTimer) clearTimeout(rtTimer);
    rtTimer = setTimeout(() => {
      rtTimer = null;
      void refreshCampaignHomebrew();
    }, REALTIME_DEBOUNCE_MS);
  };
  // A fresh topic per subscription: realtime-js hands back the EXISTING channel for a topic until its
  // async removal finishes, and adding callbacks to that already-subscribed channel throws.
  const channel = client
    .channel(`campaign-hb:${loadSyncOwner() ?? 'me'}:${++subSeq}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE, filter }, onRow)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter }, onRow)
    // Realtime replays nothing missed while disconnected: pull on every successful (re)join.
    .subscribe((status: string) => {
      if (status === 'SUBSCRIBED') void refreshCampaignHomebrew();
    });
  channelUnsub = () => void client.removeChannel(channel);
}

/**
 * Start both halves for the signed-in account. `onChanged` fires after a pull changed the cache or the
 * player's own homebrew — the caller rebuilds the content database and re-derives the roster. Runs on
 * every device, phones included: the publish is a background step, not a GM screen.
 */
export function startCampaignHomebrew(opts: { onChanged: () => void }): () => void {
  stopCurrent?.();
  started = true;
  const mine = ++generation;
  onChanged = opts.onChanged;
  pulledIds = null;
  lastPullAt = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushSoon = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushCampaignHomebrew();
    }, FLUSH_DEBOUNCE_MS);
  };
  const onFocus = () => {
    void flushCampaignHomebrew();
    if (Date.now() - lastPullAt >= FOCUS_PULL_THROTTLE_MS) void refreshCampaignHomebrew();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') onFocus();
  };
  const onOnline = () => {
    void flushCampaignHomebrew();
    void refreshCampaignHomebrew();
  };
  // Fires on every cloud adopt: the first one is what lets both halves run at all (hasSyncedOnce), and a
  // join/leave on another device arrives through it.
  const onSynced = () => {
    void flushCampaignHomebrew();
    if (memberIds('player').join(',') !== pulledIds) void refreshCampaignHomebrew();
  };
  onCampaignHbDirty(flushSoon);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  window.addEventListener('hh-synced', onSynced);
  const stop = () => {
    if (mine !== generation) return;
    generation++;
    started = false;
    onChanged = null;
    stopCurrent = null;
    onCampaignHbDirty(null);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('hh-synced', onSynced);
    if (flushTimer) clearTimeout(flushTimer);
    if (rtTimer) clearTimeout(rtTimer);
    rtTimer = null;
    channelUnsub?.();
    channelUnsub = null;
    subKey = null;
    // The storage-full answer was this session's: after a sign-out no pull runs to answer afresh until the
    // next start, and an import in between (signed in again, its first cloud pull not landed) must hear
    // about the sync, not about a storage that may have room by now. A start needs no reset of its own: a
    // session still current is stopped here first, and the pull the start fires (or one already on the
    // network, which it queues behind) resets the flag in its first statement.
    pullFull = false;
  };
  stopCurrent = stop;
  void refreshCampaignHomebrew();
  void flushCampaignHomebrew();
  return stop;
}
