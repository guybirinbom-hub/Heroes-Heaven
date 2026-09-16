// GM-DEVICE SYNC FOR THE INITIATIVE TRACKER — local-first, GM-only, realtime between the SAME
// account's devices.
//
// The owner's ruling (2026-09-16): "the initiative order, monster data doesn't need to be accessible to
// players. I would like all of the data to be local and that is what the GM actually uses, to cut on
// lag; but when I open another device I want to be able to see the current encounter if there is one,
// and all of the saved encounters also need to be visible. So if there are 2 GM devices and one updates
// something it needs to update on the second one."
//
// So: the tracker stores keep writing localStorage exactly as they always did and the GM plays entirely
// off local — nothing here is on the hot path. This module only MIRRORS those keys to
// `gm_tracker_state` (supabase-gm-tracker-state.sql, owner-only RLS) and back down to this account's
// other devices. Players never read any of it.
//
// ── THE CONTRACT ───────────────────────────────────────────────────────────────────────────────────
// KEYS (SYNCED_KEYS + every `pf2e-current-combat:<campaignId>`): the GM's table data. NOT synced: the
// bare `pf2e-current-combat` (the standalone tracker's board), `pf2e-current-combat:local` (ruling 3's
// no-account table), pf2e-settings, pf2e-custom-themes, pf2e-disabled-sources, pf2e-gm-layout*, the
// `gmw:*` widget keys — those are DEVICE preferences.
//
// WHAT "STAYS ON THIS DEVICE" MEANS FOR THE NO-ACCOUNT TABLE: its BOARD, and only its board. The
// collections it writes into are the tracker's single device-wide ones — an encounter it saves, a
// creature it converts, its entry in `pf2e-parties` — and those ARE mirrored once that GM signs in,
// because they are the same encounters and creatures the ruling asks to see on the other device.
// CampaignsPage's copy says the board, not "everything".
//
// TIME IS THE SERVER'S. `updated_at` is set by a trigger in supabase-gm-tracker-state.sql, never by a
// client, and is only ever compared against another SERVER value. Two GM devices whose wall clocks
// disagree by a minute used to destroy each other's work: the slow one's edit looked older than the
// fast one's last local change, so the fast device "corrected" the cloud with its own stale board,
// every round, silently. Nothing here reads `Date.now()` to order anything.
//
// STAMPS live in localStorage under STAMP_PREFIX + this account's uid: { [key]: { remote, dirty } }
// — per account, because the tracker's data is device-global and a second GM signing in on the same
// machine must meet every key for the first time rather than inherit someone else's history. `remote`
// is the SERVER updated_at of the row we last pushed or adopted — the one we know we have. `dirty` is
// "this device holds an unsent change", written down rather than kept only in memory so a reload (or
// a backup restore, which reloads) still pushes it instead of sitting diverged from the cloud forever.
//
// APPLY RULE — the rule this app has broken three times (a user's change is never overwritten by the
// app): a remote row applies ONLY if the key is not dirty, not in flight, and the row is not the one
// we last pushed or adopted (`updated_at === stamps[key].remote` is our own echo, in whatever spelling
// PostgREST hands it back). A dirty key keeps LOCAL and pushes it. And because the combat store writes
// on a 200 ms debounce, every pull flushes that debounce BEFORE it decides — an edit sitting in the
// debounce is a real edit, and flushing it marks the key dirty, which is what stops the in-flight pull
// from writing over it. Nothing is ever DELETED remotely by this layer: a key that is missing locally
// is simply not pushed.
//
// FIRST CONTACT (no stamp at all — a new device, a reinstall, a second account on this machine) has
// no shared history to order the two copies by, so it doesn't pretend to: collections are UNIONED,
// the campaign's board is ADOPTED (the one thing ruling 2 names — "I want to be able to see the
// current encounter"), and a true singleton is left alone. See `firstContact`.
//
// PUSH: per key, coalesced into one trailing 3 s upsert round, so a fight with a change every second
// uploads at most once every 3 s. `dirty` is cleared where local is snapshotted (not after the
// upload), so a change made DURING the upload re-dirties itself and gets its own turn; a failed upload
// puts the keys back and backs off (3 s, 6 s, 12 s … capped), so a laptop offline for an hour makes a
// handful of attempts instead of 1,200. A push asked for while one is in flight is re-queued, never
// dropped.
import { supabase } from './supabase';
import {
  useCombatStore,
  scopeKey,
  onScopeChange,
  flushPersist as flushCombatPersist,
  invalidateEncounterCache,
} from '../../tracker/src/store/combatStore';
import { usePartyStore } from '../../tracker/src/store/partyStore';
import { useEncounterTablesStore } from '../../tracker/src/store/encounterTablesStore';
import { useCustomConditionsStore } from '../../tracker/src/store/customConditionsStore';
import { useDmAverageStore } from '../../tracker/src/store/dmAverageStore';
import { reloadCustomCreatures } from '../../tracker/src/data/dataStore';
import { notifyPersist, onPersist, onReset } from '../../tracker/src/store/persistBus';
import { isMergeableKey, mergeValue } from '../../tracker/src/utils/dataTransfer';

const TABLE = 'gm_tracker_state';
/**
 * v2: the stamps changed meaning when the SERVER started stamping updated_at (see APPLY RULE). A v1
 * file's timestamps are this device's own clock and order nothing, so they are simply ignored.
 *
 * PER ACCOUNT, because one localStorage is shared by everyone who signs in on this device. A second
 * account inheriting the first one's stamps skips first contact entirely: every key reads as "already
 * reconciled", so the new account's cloud row simply REPLACES the encounters, creatures and parties
 * the device holds — and any key still flagged dirty from the previous session is uploaded into the
 * wrong account. An unknown account has no stamp file, which is exactly the safe path.
 */
const STAMP_PREFIX = 'wanderers-codex:tracker-sync:v2:';
/** Campaign-scoped boards only. The BARE `pf2e-current-combat` is the standalone tracker's own board
 *  (ruling 3: it works with no account at all) and is deliberately never uploaded. */
const COMBAT_PREFIX = 'pf2e-current-combat:';
/** The signed-out "Local table" BOARD (CampaignsPage's LOCAL_TABLE, id `local`). It IS campaign-
 *  scoped, so the prefix alone matched it and a signed-in GM opening a real campaign uploaded their
 *  no-account fight along with it — and then had device B's copy of it replaced. See "WHAT 'STAYS ON
 *  THIS DEVICE' MEANS" above for what this does and does not cover. */
const LOCAL_BOARD_KEY = `${COMBAT_PREFIX}local`;
const SYNCED_KEYS = [
  'pf2e-encounters',
  'pf2e-parties',
  'pf2e-encounter-tables',
  'pf2e-custom-conditions',
  'pf2e-dm-turn-average',
  'pf2e-custom-creatures',
] as const;
/** Trailing debounce for the upload — see PUSH above. */
const PUSH_DEBOUNCE_MS = 3000;
/** Ceiling on the retry backoff. Past this there is nothing to gain from trying harder — a focus, a
 *  reconnect or the next edit pushes immediately anyway. */
const PUSH_RETRY_CAP_MS = 300_000;
/** Don't re-pull more than once per this window on focus/visibility churn (cloudSync.ts's number). */
const PULL_THROTTLE_MS = 4000;

type Stamp = { remote?: string; dirty?: boolean };
type Row = { key: string; value: unknown; updated_at: string };

let uid: string | null = null;
/** STAMP_PREFIX + the account we are mirroring. Empty until a start, and deliberately NOT cleared by
 *  the teardown: the best-effort push it fires is still writing this account's stamps. */
let stampKey = '';
let stamps: Record<string, Stamp> = {};
const dirty = new Set<string>();
/** Keys inside an upsert that hasn't answered yet. Realtime can deliver the WAL event for our own
 *  write BEFORE the HTTP response carries the row's server timestamp back, and a pull in that gap
 *  would see a row with no matching stamp, treat our own upload as the other device's change, and
 *  push again — one request every 3 s, forever, with no user input. They are skipped like `dirty`. */
const inFlight = new Set<string>();
/** Consecutive failed upload rounds, for the backoff. Reset by any success. */
let pushFails = 0;
/** Bumped by every start and every teardown. A pull captures it before its await and drops what it
 *  read if the number moved — signing out (or leaving the campaign) must not be followed a second
 *  later by the stores being rewritten from the account that just left. */
let generation = 0;
/** How many seams hold this mirror. The teardown is the LAST one's, not the first one's. */
let refs = 0;
let liveReady: Promise<void> = Promise.resolve();
/** The CURRENT session's opening pull has settled (landed or given up). Read by the seam through
 *  `isTrackerSyncReady` before it decides whether a board has to wait; false again on teardown. */
let readySettled = false;
/** The last content we wrote or read for a key. A persist whose content matches it changed nothing —
 *  which is how the board re-persisting itself right after we applied a remote copy stops here instead
 *  of bouncing back up as a "new" edit forever. */
const lastSeen = new Map<string, string>();
let applying = false; // suppress the persist notifications our own apply causes (all synchronous)
let pulling = false;
/** A change arrived while a pull was on the network. The rows that pull is carrying were read BEFORE
 *  it, so they cannot contain that change — dropping the event (what this did) left the device on a
 *  board the other one had already moved past, until a focus or a reconnect happened to re-pull. */
let pullAgain = false;
let pushing = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastPullAt = 0;
let unsubs: (() => void)[] = [];
let started = false;

/**
 * Is THIS account's mirror already up and past its opening pull?
 *
 * The seam blanks the board ("Opening the table…") until that pull has landed, because a board drawn
 * before it may be this device's stale copy and touching it makes the key dirty — which beats the
 * cloud. That is right on a FIRST open and wrong on a remount: the GM stepping into campaign settings
 * and back got the whole blackout again, for a mirror that (the campaigns page holds it while the GM
 * is inside a campaign) never went anywhere. When this answers true the mirror is live and its rows
 * are already in localStorage, so the board is drawn at once and a later pull lands on it as usual.
 */
export function isTrackerSyncReady(owner: string | null): boolean {
  return started && !!owner && owner === uid && readySettled;
}

export function isTrackerSyncKey(key: string): boolean {
  if (key === LOCAL_BOARD_KEY) return false;
  return key.startsWith(COMBAT_PREFIX) || (SYNCED_KEYS as readonly string[]).includes(key);
}

/** Timestamps as a comparable number. NEVER compare these as strings: we push `…123Z` and PostgREST
 *  hands the same instant back as `…123456+00:00`, so string equality (the echo check) would never
 *  hold and `<=` would order the two forms by punctuation. Date.parse settles both to the same ms. */
function ms(s: string | undefined): number {
  if (!s) return 0;
  const n = Date.parse(s);
  return Number.isNaN(n) ? 0 : n;
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function loadStamps(): Record<string, Stamp> {
  try {
    const raw = stampKey ? localStorage.getItem(stampKey) : null;
    const p = raw ? (JSON.parse(raw) as Record<string, Stamp>) : {};
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}
function saveStamps(): void {
  if (!stampKey) return;
  try {
    localStorage.setItem(stampKey, JSON.stringify(stamps));
  } catch {
    /* quota / private mode — stamps rebuild from scratch, worst case one extra push */
  }
}

/**
 * FORGET EVERY STAMP — the keys underneath us have just been replaced wholesale.
 *
 * A restore (Heroes Heaven's Settings → Backup, and the tracker's own applyBackup) gives every synced
 * key a brand-new history: the stamps left over describe a conversation with the cloud about data that
 * no longer exists here. Kept, they read each restored key as one this device has already reconciled,
 * so the next pull skips the cloud's copy — and a key the backup left out stays missing for good.
 * Dropped, every key meets the cloud again as first contact, which UNIONS instead of picking a winner.
 *
 * WIPING THE FILE IS NOT ENOUGH, which is the whole reason this is a function and not a removeItem:
 * with the mirror live, the restore's own notifyPersist → markDirty → saveStamps wrote the in-memory
 * copy straight back out, so whichever ran first decided. `stampKey` goes too, so nothing left in this
 * session can write the file again; the restore reloads the app, and the next start reads an absent
 * file. Announced through the persist bus (`notifyReset`), because the tracker never imports from src/.
 */
export function forgetTrackerSyncStamps(): void {
  try {
    if (stampKey) localStorage.removeItem(stampKey);
  } catch {
    /* private mode — there was nothing on disk to forget */
  }
  stamps = {};
  dirty.clear();
  lastSeen.clear();
  stampKey = '';
}

/** Every synced key this device currently holds. */
function localSyncedKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && isTrackerSyncKey(k)) out.push(k);
    }
  } catch {
    /* private mode */
  }
  return out;
}

/** Tell the store that owns `key` to re-read localStorage. Only the CURRENT campaign's board is on
 *  screen; another campaign's board is picked up by setScope when the GM opens it. */
function reloadLocal(key: string): void {
  if (key.startsWith(COMBAT_PREFIX)) {
    if (key !== scopeKey('pf2e-current-combat')) return;
    useCombatStore.getState().reloadFromStorage();
    // The reload re-queues a persist of the board we just adopted. Flush it here, inside `applying`,
    // so the settled bytes are what lastSeen records — otherwise that write lands 200 ms later, looks
    // like a local edit, and ping-pongs the same board between the two devices every 3 seconds.
    flushCombatPersist();
    return;
  }
  switch (key) {
    case 'pf2e-encounters':
      invalidateEncounterCache();
      break;
    case 'pf2e-parties':
      usePartyStore.getState().reloadFromStorage();
      break;
    case 'pf2e-encounter-tables':
      useEncounterTablesStore.getState().reloadFromStorage();
      break;
    case 'pf2e-custom-conditions':
      useCustomConditionsStore.getState().reloadFromStorage();
      break;
    case 'pf2e-dm-turn-average':
      useDmAverageStore.getState().reloadFromStorage();
      break;
    case 'pf2e-custom-creatures':
      reloadCustomCreatures();
      break;
  }
}

/** Adopt a remote row: write localStorage, reload the store, and record the stamp. Synchronous, so
 *  `applying` is exact — nothing our own reload persists is mistaken for the GM editing. */
function applyRemote(row: Row): void {
  applying = true;
  try {
    localStorage.setItem(row.key, JSON.stringify(row.value));
    reloadLocal(row.key);
    // The same announcement a store makes after its own write. Two of these keys reach the UI only
    // through a module cache (saved encounters, custom creatures), so without this an open list keeps
    // showing the pre-pull names. Inside `applying`, so our own listener still ignores it.
    notifyPersist(row.key);
  } catch {
    return; // quota / private mode: keep local, keep the old stamp, try again next pull
  } finally {
    applying = false;
  }
  stamps[row.key] = { remote: row.updated_at };
  lastSeen.set(row.key, readRaw(row.key) ?? '');
  saveStamps();
}

/**
 * A SCOPE SWITCH IS NOT AN EDIT.
 *
 * Opening a campaign runs setScope → reloadFromStorage → (the store's own subscriber) a persist, and
 * that re-write is not byte-identical to the file it just read: loadPersistedCombat DERIVES the
 * once-per-round flags that a board saved by an older build doesn't carry. Those extra bytes reached
 * onLocalPersist as "the GM changed something", the key went dirty, and a dirty key beats the cloud
 * unconditionally — so a device that opened the campaign and touched nothing uploaded its yesterday
 * board over the other device's live fight, then pulled the stale one back down. It fires exactly at
 * a rollout, where every on-disk board predates the new fields.
 *
 * Flushing the load's own persist here, inside `applying`, and taking the baseline from the settled
 * bytes is the same move applyRemote makes for the reload IT causes.
 */
function onScopeSwitch(): void {
  const key = scopeKey('pf2e-current-combat');
  if (!isTrackerSyncKey(key)) return; // the standalone board and the no-account table are not ours
  applying = true;
  try {
    flushCombatPersist();
  } finally {
    applying = false;
  }
  lastSeen.set(key, readRaw(key) ?? '');
}

/** "We have this row." Records it as the echo baseline without touching local data. */
function markSeen(row: Row): void {
  stamps[row.key] = { ...stamps[row.key], remote: row.updated_at };
  lastSeen.set(row.key, readRaw(row.key) ?? '');
  saveStamps();
}

/**
 * THE FIRST TIME THIS DEVICE MEETS A KEY — no stamp, so there is no shared history and no way to tell
 * which copy is later. Adopting the cloud outright (what this used to do) deletes whatever the device
 * built offline: on the rollout open of the second GM device that is the saved encounters, the
 * homebrew stat blocks and the per-player notes, gone with no prompt and no undo. Whichever device
 * happened to push first won. So:
 *   • nothing local → adopt the cloud's copy. That is ruling 2's "when I open another device I want to
 *     see the current encounter, and all of the saved encounters";
 *   • a BOARD (`pf2e-current-combat:<campaign>`) → adopt as well, occupied or not, for the same
 *     sentence of the same ruling: the current encounter is the ONE thing the owner named. Keeping
 *     this device's board instead showed him yesterday's fight — and, since "keep local" also means
 *     "don't push", left the live one on the other device to be overwritten by the next edit either
 *     device made. This is the one place the mirror replaces work rather than merging it, and it is
 *     the owner's own instruction for the key he named;
 *   • a COLLECTION (encounters, custom creatures, parties, conditions, tables) → the UNION of both,
 *     adopted here and pushed back up so the other device gets it too. Nothing is lost on either side.
 *     An entry both devices hold under one id keeps THIS device's copy — the one in front of the user;
 *   • a true SINGLETON (the turn averages) → keep what is on this device and record the row as seen.
 *     Neither copy is destroyed; the next real edit on either device syncs it the normal way.
 */
function firstContact(row: Row): void {
  const raw = readRaw(row.key);
  if (raw === null || row.key.startsWith(COMBAT_PREFIX)) {
    applyRemote(row);
    return;
  }
  const incoming = JSON.stringify(row.value);
  if (!isMergeableKey(row.key)) {
    markSeen(row);
    return;
  }
  // mergeValue's "incoming wins a clash" is why the arguments are this way round: OUR copy is the
  // incoming one, so the union keeps this device's entry where both hold the same id.
  const merged = mergeValue(row.key, incoming, raw);
  if (merged !== raw) {
    try {
      applyRemote({ ...row, value: JSON.parse(merged) as unknown });
    } catch {
      markSeen(row); // unmergeable after all — keep local, decide on the next edit
      return;
    }
  } else {
    markSeen(row);
  }
  if (merged !== incoming) markDirty(row.key); // the cloud is missing entries this device holds
}

/** A store just wrote a synced key. Stamp + queue it, unless the content is what we already had. */
function onLocalPersist(key: string): void {
  if (applying || !isTrackerSyncKey(key)) return;
  const raw = readRaw(key);
  if (raw === null || raw === lastSeen.get(key)) return;
  lastSeen.set(key, raw);
  markDirty(key);
}

function markDirty(key: string): void {
  dirty.add(key);
  // Written down, not just held in memory: a restore-and-reload (tracker/src/utils/dataTransfer.ts)
  // or a closed app must not leave this device quietly diverged from the cloud.
  if (!stamps[key]?.dirty) {
    stamps[key] = { ...stamps[key], dirty: true };
    saveStamps();
  }
  schedulePush();
}

function schedulePush(delayMs = PUSH_DEBOUNCE_MS): void {
  if (!supabase || !uid || pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushDirty().catch(() => {});
  }, delayMs);
}

async function pushDirty(): Promise<void> {
  const client = supabase;
  const owner = uid;
  if (!client || !owner || !dirty.size) return;
  // Never DROP a push asked for mid-flight: the in-flight one is uploading a snapshot taken before
  // this request existed (cloudSync.ts, leg 4 of the roundtrip test).
  if (pushing) {
    schedulePush();
    return;
  }
  // No `updated_at`: the server's trigger stamps it (supabase-gm-tracker-state.sql). A client clock
  // must never be what two devices are ordered by — see TIME IS THE SERVER'S above.
  const rows: { key: string; value: unknown }[] = [];
  for (const key of [...dirty]) {
    const raw = readRaw(key);
    // A key that vanished locally is NOT a deletion we broadcast — this layer never deletes.
    if (raw === null) {
      dirty.delete(key);
      stamps[key] = { ...stamps[key], dirty: false };
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      dirty.delete(key);
      stamps[key] = { ...stamps[key], dirty: false };
      continue;
    }
    rows.push({ key, value });
  }
  if (!rows.length) {
    saveStamps();
    return;
  }
  pushing = true;
  // Same reason pullAll captures it: a sign-out (or a second account signing in) while this is on the
  // network must not have its stamp file written with the previous account's rows.
  const g = generation;
  // Clear dirty HERE, where local is snapshotted — an edit during the upload re-dirties itself and
  // keeps its own scheduled push, instead of being swallowed by a later clear.
  for (const r of rows) {
    dirty.delete(r.key);
    inFlight.add(r.key);
  }
  try {
    const { data, error } = await client
      .from(TABLE)
      .upsert(rows.map((r) => ({ owner_id: owner, ...r })))
      .select('key,updated_at');
    if (error) throw error;
    if (g !== generation) return;
    // The row's SERVER timestamp, read back — that, and only that, is what a later pull compares
    // against to recognise its own echo.
    for (const r of (data ?? []) as { key: string; updated_at: string }[]) {
      if (typeof r?.key !== 'string' || typeof r.updated_at !== 'string') continue;
      stamps[r.key] = { remote: r.updated_at, dirty: dirty.has(r.key) };
      lastSeen.set(r.key, readRaw(r.key) ?? lastSeen.get(r.key) ?? '');
    }
    pushFails = 0;
    saveStamps();
  } catch (e) {
    if (g !== generation) return; // whatever failed belonged to a session that has already ended
    // Stays dirty → retried on the next trigger, and (being written down) across a reload too.
    // Not markDirty: that would schedule the retry at the plain debounce and win the race with the
    // backoff below.
    for (const r of rows) {
      dirty.add(r.key);
      stamps[r.key] = { ...stamps[r.key], dirty: true };
    }
    saveStamps();
    pushFails += 1;
    // 3 s, 6 s, 12 s … capped. Offline for an hour used to mean 1,200 failed requests — and it still
    // did, because the GM keeps playing through a failure: each edit scheduled the plain debounce and
    // schedulePush then REFUSED to replace that timer with the backoff. The retry is this one.
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    schedulePush(Math.min(PUSH_DEBOUNCE_MS * 2 ** (pushFails - 1), PUSH_RETRY_CAP_MS));
    console.warn('[TrackerSync] upload failed:', e);
  } finally {
    for (const r of rows) inFlight.delete(r.key);
    pushing = false;
  }
}

/** One row through the APPLY RULE. A pull and a Realtime payload make the same decision — the WAL
 *  event carries the whole row, so there is nothing a round trip would add. */
function applyRow(row: Row): void {
  // An unsent (or still-uploading) local change wins and is already queued.
  if (dirty.has(row.key) || inFlight.has(row.key)) return;
  const st = stamps[row.key];
  if (!st) {
    firstContact(row);
    return;
  }
  // OLDER, OR THE ONE WE ALREADY HAVE, IS NEVER APPLIED. `st.remote` is the SERVER time of the row
  // this device last pushed or adopted, so a row that is not strictly newer carries nothing we don't
  // already hold. Equality alone (what this checked) was not enough: a pull's rows are read at
  // REQUEST time, so a Realtime row that lands while the select is on the network is adopted first
  // and the held select then answers with its pre-edit snapshot — a different timestamp, so it
  // passed, and the other GM's live board was rolled back to what it was two hours ago.
  // Only `remote` is compared. It is server time; ordering against anything this device's own clock
  // produced is the clock-skew loss leg c pins down.
  if (ms(row.updated_at) <= ms(st.remote)) return;
  applyRemote(row);
}

/** Pull every row for this account and adopt the ones that pass the APPLY RULE. Throws on a real
 *  error, so "the fetch failed" is never mistaken for "the cloud is empty" (UNKNOWN is not EMPTY). */
async function pullAll(): Promise<void> {
  const client = supabase;
  const owner = uid;
  if (!client || !owner) return;
  // Coalesce, don't drop: this pull's rows were read before that change existed.
  if (pulling) {
    pullAgain = true;
    return;
  }
  pulling = true;
  pullAgain = false;
  const g = generation;
  try {
    const { data, error } = await client.from(TABLE).select('key,value,updated_at').eq('owner_id', owner);
    if (error) throw error;
    // Signed out, or left the campaign, while this was on the network: the account that asked for
    // these rows is gone, so they must not be written into the stores now.
    if (g !== generation) return;
    // An edit inside the combat store's 200 ms debounce is a real edit: get it into localStorage (and
    // onto the dirty set) BEFORE we decide anything, or this pull writes over it.
    flushCombatPersist();
    const seen = new Set<string>();
    for (const row of (data ?? []) as Row[]) {
      if (!row?.key || !isTrackerSyncKey(row.key) || typeof row.updated_at !== 'string') continue;
      seen.add(row.key);
      applyRow(row);
    }
    // A key this device holds that the cloud has never seen still has to go up — and "never seen" is a
    // STAMP, not an absence from THESE rows. They were read at REQUEST time, so a key the other device
    // CREATED while the select was in flight (delivered meanwhile by Realtime, adopted, stamped) is
    // simply not in them. Marking it dirty on that evidence made this device refuse the other GM's next
    // row for that key and, 3 s later, upload the copy it had just adopted over their live fight. A key
    // carrying a server stamp came FROM the cloud: its absence here means the snapshot is stale.
    for (const key of localSyncedKeys()) if (!seen.has(key) && !stamps[key]?.remote) markDirty(key);
    lastPullAt = Date.now();
  } finally {
    pulling = false;
    if (pullAgain) {
      pullAgain = false;
      void pullAll().catch(() => {});
    }
  }
  if (dirty.size) schedulePush();
}

/**
 * A WAL event from `gm_tracker_state`, which carries the whole row. Both halves of "cut the lag" are
 * here:
 *   • OUR OWN write comes back through this channel too, and the upsert's `.select()` has already
 *     recorded that row's server timestamp (or is in flight and about to) — so there is nothing to
 *     fetch and nothing to do. Pulling the table to discard it cost 682 KB for ten damage clicks;
 *   • the OTHER device's write IS the payload, so it applies straight away instead of asking the
 *     server for every row of every campaign to find the one that moved.
 * Realtime drops a row over ~1 MB and sends `errors` instead of `new`; that (and any payload shape we
 * don't recognise) falls back to the pull, so a big board still arrives.
 */
function onRealtimeRow(payload: unknown): void {
  if (!uid) return;
  const row = (payload as { new?: { key?: unknown; updated_at?: unknown; value?: unknown } } | undefined)?.new;
  const key = typeof row?.key === 'string' ? row.key : null;
  const at = typeof row?.updated_at === 'string' ? row.updated_at : null;
  if (key && at) {
    if (inFlight.has(key) || ms(stamps[key]?.remote) === ms(at)) return; // our own echo
    if (row && 'value' in row) {
      if (!isTrackerSyncKey(key)) return;
      // The same first move a pull makes: an edit sitting in the board's 200 ms debounce is a real
      // edit, and it has to be in localStorage (and on the dirty set) before anything is decided.
      flushCombatPersist();
      applyRow({ key, value: row.value, updated_at: at });
      if (dirty.size) schedulePush();
      return;
    }
  }
  void pullAll().catch(() => {});
}

function maybePull(): void {
  if (Date.now() - lastPullAt < PULL_THROTTLE_MS) return;
  void pullAll().catch(() => {});
}
const onVisibility = () => {
  if (document.visibilityState === 'hidden') void pushDirty().catch(() => {});
  else maybePull();
};
const onFocus = () => maybePull();
const onOnline = () => {
  maybePull();
  void pushDirty().catch(() => {});
};
const onLeave = () => void pushDirty().catch(() => {});

/**
 * Start mirroring this GM's tracker data. `uid` null (signed out, or the standalone tracker of ruling
 * 3) makes the whole thing a no-op — the tracker keeps working, purely local.
 *
 * Returns `stop` and `ready`: `ready` resolves when the opening pull has settled (it never rejects),
 * so the seam can await it — capped — before it draws a board that may be stale. Starting it twice is
 * fine: the second caller joins the running mirror and the teardown belongs to whichever holder lets
 * go LAST (it used to belong to the first, which tore the channel out from under the second).
 */
export function startTrackerSync({ uid: owner }: { uid: string | null }): { stop: () => void; ready: Promise<void> } {
  if (!supabase || !owner) return { stop: () => {}, ready: Promise.resolve() };
  if (started) {
    if (owner !== uid) {
      // Two accounts at once is not something one localStorage can serve; say so rather than
      // mirroring the first account's board under the second one's session.
      console.warn('[TrackerSync] already mirroring another account — this start is a no-op.');
      return { stop: () => {}, ready: Promise.resolve() };
    }
    refs += 1;
    return { stop: release(), ready: liveReady };
  }
  started = true;
  refs = 1;
  generation += 1;
  uid = owner;
  stampKey = STAMP_PREFIX + owner;
  stamps = loadStamps();
  dirty.clear();
  inFlight.clear();
  lastSeen.clear();
  pushFails = 0;
  lastPullAt = 0;
  readySettled = false;
  // Seed the content baseline so a store re-persisting identical bytes at startup isn't an "edit".
  for (const key of localSyncedKeys()) lastSeen.set(key, readRaw(key) ?? '');
  // An unsent change from the last session (app closed, or a backup restored and the page reloaded)
  // is still unsent. It is what stops the opening pull from adopting the cloud over it.
  for (const [key, st] of Object.entries(stamps)) if (st?.dirty && isTrackerSyncKey(key)) dirty.add(key);

  const ready = pullAll()
    .catch((e) => {
      // Offline / not set up yet: stay local and retry on focus/online. Never block the board.
      console.warn('[TrackerSync] initial pull failed — staying local, will retry:', e);
    })
    .then(() => {
      readySettled = true; // landed or gave up — either way nothing is still on its way in
    });
  liveReady = ready;

  unsubs.push(onPersist(onLocalPersist));
  // A backup restore announces itself here, BEFORE it rewrites the keys — see forgetTrackerSyncStamps.
  unsubs.push(onReset(forgetTrackerSyncStamps));
  unsubs.push(onScopeChange(onScopeSwitch));
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onLeave);
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('online', onOnline);

  // Realtime: the other GM device's write lands here within a second instead of on the next focus.
  // Needs the table in the supabase_realtime publication (supabase-gm-tracker-state.sql); if it isn't,
  // this simply never fires and focus/open pulls remain the fallback. Every SUBSCRIBED — including a
  // reconnect after a dropped socket — re-pulls, because whatever changed while we were gone never
  // produced an event.
  const client = supabase;
  const channel = client
    .channel(`gm-tracker:${owner}`)
    // Unthrottled (unlike focus): a genuine near-simultaneous change from the other device must never
    // be skipped by a time window, and an event that arrives mid-pull re-runs the pull afterwards
    // instead of being dropped (`pullAgain`) — the rows in the air were read before it happened.
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE, filter: `owner_id=eq.${owner}` }, onRealtimeRow)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: `owner_id=eq.${owner}` }, onRealtimeRow)
    .subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        lastPullAt = 0; // a reconnect must pull even inside the throttle window
        maybePull();
      }
    });
  unsubs.push(() => void client.removeChannel(channel));

  return { stop: release(), ready };
}

/** One holder's release, at most once, and only for the session it was handed out in — a handle kept
 *  past its own teardown must not take down whatever started afterwards. The mirror comes down when
 *  the last holder lets go. */
function release(): () => void {
  const mine = generation;
  let done = false;
  return () => {
    if (done || mine !== generation) return;
    done = true;
    refs -= 1;
    if (refs <= 0) teardown();
  };
}

function teardown(): void {
  // THE LAST THING THE GM DID. The board persists on a 200 ms debounce, and the flush that would
  // settle it — the seam's `setScope(null)` on the way out — runs AFTER this, by which time the
  // persist listener below is already unsubscribed and nobody is left to hear it. The key stayed
  // clean with the OLDER cloud row as its stamp, so every later pull skipped it and that last edit
  // never reached the cloud at all: the other device kept an older board and overwrote it next.
  flushCombatPersist();
  // Anything already on the network belongs to the session that is ending.
  generation += 1;
  for (const u of unsubs) u();
  unsubs = [];
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('focus', onFocus);
  window.removeEventListener('blur', onLeave);
  window.removeEventListener('pagehide', onLeave);
  window.removeEventListener('online', onOnline);
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  void pushDirty().catch(() => {}); // best effort: local is durable, the next open re-pushes
  started = false;
  refs = 0;
  uid = null;
  readySettled = false; // the next start is a new session, and its board waits for the new pull
}
