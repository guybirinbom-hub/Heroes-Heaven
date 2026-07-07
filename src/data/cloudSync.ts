// Cloud sync orchestration. Local-first: the app always works from localStorage; this module mirrors
// that to Supabase so a signed-in user's characters follow them across devices. Lifecycle:
//   • on open   → PULL the cloud bundle, MERGE with local, adopt, then PUSH the merged result up.
//   • on focus  → PULL + MERGE again (throttled) so a device you return to refreshes itself before you
//                 can edit stale data — this is the lightweight alternative to a hard device lock.
//   • on leave  → PUSH when the app is backgrounded/closed (visibilitychange→hidden / pagehide / blur).
//   • on online → resume a pull (if the first never succeeded) or a pending push.
// Deliberately NO mid-session push: edits stay local + fast during play and only reach the cloud on
// leave/close, per the "sync on open and close" model. That's safe because localStorage is durable
// and the merge is per-character newest-timestamp-wins — a push that never fired (hard kill) simply
// re-syncs on the next open, when local's newer timestamps win the merge and get pushed.
//
// SAFETY (no stale overwrite): every PUSH first re-PULLs and MERGES, so a device that's been sitting
// on old data can never blow away newer changes another device saved in the meantime. And we never
// PUSH until a PULL has succeeded this session, so a failed pull (offline) isn't mistaken for "the
// cloud is empty". See cloudMerge.ts for the (tested) conflict logic.
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
import { onLocalDataChanged } from './syncBus';
import { reloadPrefs } from './prefs';
import { initTheme } from '../theme/theme-manager';
import { getDeviceInfo } from './device';
import { charFingerprint, mergeBundles } from './cloudMerge';

/** Don't re-pull more than once per this window on rapid focus/visibility churn. */
const PULL_THROTTLE_MS = 4000;
// Flip to true to trace every sync in the console. Off in production: successful syncs are silent,
// only failures warn (so a friend hitting a sync problem still leaves a breadcrumb).
const SYNC_DEBUG = false;

let dirty = false; // local changes not yet confirmed uploaded
let syncing = false; // a pull or push is in flight (serializes network work)
let pulledOk = false; // a successful pull has happened this session (gate before any push)
let started = false;
let lastPullAt = 0;
let applyRoster: ((r: SavedChar[]) => void) | null = null;
let fingerprints = new Map<string, string>(); // last-applied content per roster id (edit detection)

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

/** True when `next` differs from the roster we last applied (added/removed/edited character). */
function rosterDiffers(next: SavedChar[]): boolean {
  if (next.length !== fingerprints.size) return true;
  for (const c of next) {
    if (fingerprints.get(c.id) !== charFingerprint(c)) return true;
  }
  return false;
}

/** Adopt a merged bundle locally: write it to localStorage, re-apply live settings, and hand the
 *  roster to React only when it actually changed (so a no-op sync doesn't churn state / undo). */
function adopt(merged: CloudBundle): void {
  const rosterChanged = rosterDiffers(merged.roster);
  writeCloudBundle(merged);
  // writeCloudBundle only wrote the raw keys — re-read + re-apply so the theme repaints and prefs
  // subscribers fire. Non-fatal if it throws (settings still take effect on next load).
  try {
    reloadPrefs();
    initTheme();
  } catch {
    /* non-fatal */
  }
  fingerprints = new Map(merged.roster.map((c) => [c.id, charFingerprint(c)]));
  if (rosterChanged) applyRoster?.(merged.roster);
  window.dispatchEvent(new Event('hh-synced'));
}

/** Pull the cloud, merge into local, adopt. Safe to call on open / focus / online. Throws on a real
 *  network error so the caller can decide whether to retry. After a successful pull, if we have local
 *  edits not yet uploaded, push the merged result up. */
async function pull(): Promise<void> {
  if (!supabase || syncing) return;
  syncing = true;
  try {
    const local = readCloudBundle();
    const cloud = await pullBundle();
    if (SYNC_DEBUG)
      console.info(
        `[HeavenSync] pulled: ${cloud === null ? 'no row yet' : `${cloud.roster?.length ?? 0} char(s)`} · local ${local.roster.length}`,
      );
    adopt(mergeBundles(local, cloud));
    pulledOk = true;
    lastPullAt = Date.now();
  } finally {
    syncing = false;
  }
  if (dirty) await push();
}

/** Upload local to the cloud — but re-pull + merge first so a stale device can't overwrite newer
 *  cloud data (optimistic-concurrency, the light alternative to a device lock). Only runs after a
 *  successful pull this session. */
async function push(): Promise<void> {
  if (!supabase || syncing || !pulledOk) return;
  const uid = await currentUserId();
  if (!uid) return;
  syncing = true;
  try {
    const local = readCloudBundle();
    const cloud = await pullBundle();
    const merged: CloudBundle = { ...mergeBundles(local, cloud), lastDevice: getDeviceInfo(), lastEditedAt: Date.now() };
    const { error } = await supabase.from('user_data').upsert({ user_id: uid, data: merged });
    if (error) {
      dirty = true; // keep dirty (retry later) if the write failed
      console.warn('[HeavenSync] upload FAILED:', error.message, error);
    } else {
      dirty = false;
      adopt(merged); // adopt any changes pulled in during the merge + stamp the "last synced" line
      if (SYNC_DEBUG) console.info(`[HeavenSync] uploaded ${merged.roster.length} character(s)`);
    }
  } catch (e) {
    dirty = true; // offline / network error → retry on next trigger
    console.warn('[HeavenSync] upload threw:', e);
  } finally {
    syncing = false;
  }
}

/** Push any pending local changes now (on leave/close). Best-effort: on a hard unload it may not
 *  finish, which is fine — the durable local copy re-syncs on the next open. */
function flushPush(): void {
  if (dirty) void push();
}

/** Re-pull on focus/visibility, but not more than once per PULL_THROTTLE_MS. */
function maybePull(): void {
  if (!pulledOk) {
    void pull().catch(() => {});
    return;
  }
  if (Date.now() - lastPullAt < PULL_THROTTLE_MS) return;
  void pull().catch(() => {});
}

/** After each local persist: bump timestamps for characters whose content changed (and prune ones
 *  that were deleted), then mark dirty so the next leave uploads. No network here (open/close model). */
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
    dirty = true;
  }
}

const onVisibility = () => {
  if (document.visibilityState === 'hidden') flushPush();
  else maybePull();
};
const onFocus = () => maybePull();
const onBlur = () => flushPush();
const onPageHide = () => flushPush();
const onOnline = () => {
  if (!pulledOk) void pull().catch(() => {});
  else flushPush();
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
  syncing = false;
  dirty = true; // ensure the first pull is followed by a push (uploads local / establishes the row)
  // Seed fingerprints from local so a failed first sync (offline) still detects later edits and the
  // first successful pull doesn't spuriously look "changed".
  fingerprints = new Map(readCloudBundle().roster.map((c) => [c.id, charFingerprint(c)]));

  // A failed first sync (offline) must not brick the app — it stays local-only and retries via the
  // 'online' / focus handlers.
  try {
    await pull();
  } catch (e) {
    console.warn('[HeavenSync] initial sync failed — staying local, will retry:', e);
  }

  setOnPersisted(noteRosterChange);
  // Non-roster local data (homebrew, modes, settings) just marks dirty; it uploads on the next leave.
  onLocalDataChanged(() => {
    dirty = true;
  });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('online', onOnline);

  return () => {
    setOnPersisted(() => {});
    onLocalDataChanged(null);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('online', onOnline);
    flushPush();
    started = false;
    pulledOk = false;
    applyRoster = null;
  };
}
