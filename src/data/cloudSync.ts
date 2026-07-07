// Cloud sync orchestration (web build). Local-first: the app keeps working from localStorage; this
// module mirrors that to Supabase. Lifecycle:
//   • on login  → PULL the cloud bundle, MERGE with local, apply, and PUSH the merge back.
//   • on edit   → a debounced PUSH (invisible; the session stays local + fast).
//   • on leave  → flush a PUSH when the app is backgrounded/closed (visibilitychange/pagehide).
//   • on online → if the first pull never succeeded, retry it; otherwise retry a pending PUSH.
// The durable copy is the cloud; localStorage is a fast cache. See cloudMerge.ts for the (tested)
// conflict logic.
//
// SAFETY: we never PUSH until a PULL has succeeded this session. A failed pull (offline/transient)
// must not be mistaken for "the cloud is empty" and overwrite real cloud data with local.
import { supabase } from './supabase';
import {
  loadCharUpdated,
  readCloudBundle,
  saveCharUpdated,
  writeCloudBundle,
  type CloudBundle,
  type SavedChar,
} from './storage';
import { setOnPersisted } from './persist';
import { charFingerprint, mergeBundles } from './cloudMerge';

const PUSH_DEBOUNCE_MS = 3000;
// Flip to true to trace every sync in the console. Off in production: successful syncs are silent,
// only failures warn (so a friend hitting a sync problem still leaves a breadcrumb).
const SYNC_DEBUG = false;

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false; // local changes not yet confirmed uploaded
let pushing = false; // a push is in flight
let pulledOk = false; // a successful pull has happened this session (gate before any push)
let started = false;
let applyRoster: ((r: SavedChar[]) => void) | null = null;
let fingerprints = new Map<string, string>(); // last-seen content per roster id (edit detection)

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Fetch the cloud bundle. Returns null only when the row genuinely doesn't exist yet; THROWS on a
 *  real error so the caller never mistakes a failed fetch for "cloud is empty". */
async function pullBundle(): Promise<CloudBundle | null> {
  if (!supabase) return null;
  const uid = await currentUserId();
  if (!uid) throw new Error('no user');
  const { data, error } = await supabase.from('user_data').select('data').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (data.data ?? null) as CloudBundle | null;
}

async function pushBundle(): Promise<void> {
  if (!supabase || pushing || !pulledOk) return; // never push before a confirmed pull
  const uid = await currentUserId();
  if (!uid) return;
  pushing = true;
  try {
    const bundle = readCloudBundle();
    const { error } = await supabase.from('user_data').upsert({ user_id: uid, data: bundle });
    dirty = !!error; // keep dirty (retry later) if the write failed
    if (error) console.warn('[HeavenSync] upload FAILED:', error.message, error);
    else if (SYNC_DEBUG) console.info(`[HeavenSync] uploaded ${bundle.roster.length} character(s) to the cloud`);
  } catch (e) {
    dirty = true; // offline / network error → retry on next trigger
    console.warn('[HeavenSync] upload threw:', e);
  } finally {
    pushing = false;
  }
}

/** Pull + merge + apply + push, once, guarded so it only runs until it first succeeds. */
async function initialSync(): Promise<void> {
  if (!supabase || pulledOk) return;
  const local = readCloudBundle();
  const cloud = await pullBundle(); // throws on real error → caller retries later
  if (SYNC_DEBUG)
    console.info(
      `[HeavenSync] pulled from cloud: ${cloud === null ? 'no row yet (empty)' : `${cloud.roster?.length ?? 0} character(s)`} · local has ${local.roster.length}`,
    );
  const merged = mergeBundles(local, cloud);
  writeCloudBundle(merged);
  fingerprints = new Map(merged.roster.map((c) => [c.id, charFingerprint(c)]));
  applyRoster?.(merged.roster);
  pulledOk = true; // now safe to push
  await pushBundle(); // upload the merged result (first login / offline edits accumulated)
}

function schedulePush(): void {
  dirty = true;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushBundle();
  }, PUSH_DEBOUNCE_MS);
}

function flushPush(): void {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (dirty) void pushBundle();
}

/** After each local persist: bump timestamps for characters whose content changed (and prune ones
 *  that were deleted), then queue an upload. No-op when nothing actually changed. */
function noteRosterChange(roster: SavedChar[]): void {
  const ts = loadCharUpdated();
  const now = Date.now();
  const present = new Set<string>();
  let changed = false;

  for (const c of roster) {
    present.add(c.id);
    const fp = charFingerprint(c);
    if (fingerprints.get(c.id) !== fp) {
      fingerprints.set(c.id, fp);
      ts[c.id] = now;
      changed = true;
    }
  }
  for (const id of Object.keys(ts)) {
    if (!present.has(id)) {
      delete ts[id];
      changed = true;
    }
  }
  for (const id of [...fingerprints.keys()]) {
    if (!present.has(id)) fingerprints.delete(id);
  }

  if (changed) {
    saveCharUpdated(ts);
    schedulePush();
  }
}

const onVisibility = () => {
  if (document.visibilityState === 'hidden') flushPush();
};
const onPageHide = () => flushPush();
const onOnline = () => {
  if (!pulledOk) void initialSync().catch(() => {});
  else if (dirty) void pushBundle();
};

/**
 * Start cloud sync for a signed-in user. Returns a cleanup function (call on sign-out / unmount).
 * `onRosterReplaced` receives the merged roster so React can adopt the just-pulled cloud characters.
 */
export async function startCloudSync(onRosterReplaced: (roster: SavedChar[]) => void): Promise<() => void> {
  if (!supabase || started) return () => {};
  started = true;
  applyRoster = onRosterReplaced;
  pulledOk = false;
  dirty = false;

  // A failed first sync (offline) must not brick the app — it stays local-only and retries via the
  // 'online' handler / on the next edit. Seed fingerprints from local so edits are still detected.
  try {
    await initialSync();
  } catch (e) {
    console.warn('[HeavenSync] initial sync failed — staying local, will retry:', e);
    fingerprints = new Map(readCloudBundle().roster.map((c) => [c.id, charFingerprint(c)]));
  }

  setOnPersisted(noteRosterChange);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('online', onOnline);

  return () => {
    setOnPersisted(() => {});
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('online', onOnline);
    flushPush();
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    started = false;
    pulledOk = false;
    applyRoster = null;
  };
}
