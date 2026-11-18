/*
 * Character roster persistence (localStorage).
 *
 * A saved character keeps the BUILD (the player's choices) when it was made in the
 * builder, so it can be re-opened and edited; the resolved Character is recomputed
 * from the build on load. Hand-authored examples (e.g. the seed) have no build and
 * are stored as a Character only.
 */
import type { BuildState } from '../rules/build';
import type { PlayState } from '../rules/play';
import type {
  Action,
  Ancestry,
  Background,
  Character,
  Deity,
  Feat,
  Heritage,
  Item,
  ModeDef,
  Spell,
} from '../rules/types';
import { normalizeCharacter, normalizePlay } from '../rules/normalize';
import { authoredKey, hash53 } from './authored';
import { knownRoster, noteRosterKnown, rosterSig, writeLineage } from './rosterLineage';
import { loadSettingsUpdated, markLocalDataChanged, markCampaignHbDirty, saveSettingsUpdated, loadCustomizationUpdated, saveCustomizationUpdated } from './syncBus';
import { notifyReset } from '../../tracker/src/store/persistBus';
import type { CampaignMembership } from './campaigns';

export interface SavedChar {
  /** Unique roster id (distinct from character.id, which can collide on name). */
  id: string;
  character: Character;
  /** The builder choices, if this character was made in the builder (enables editing). */
  build?: BuildState;
  /** In-play runtime state (damage, hero points, XP); overlaid on the snapshot at render. */
  play?: PlayState;
  /** Archived characters are hidden from the default roster view. */
  archived?: boolean;
  /**
   * The custom records this character uses (homebrew of every HomebrewType, and the player's own modes),
   * by type and id — owner ruling 2026-10-20: "the others should see the same item as the player".
   * Attached when a sheet is SENT (a publish, a GM push, an export) and read by every view of it
   * (src/data/carried.ts `withCarried`), so a GM or a teammate never sees "Unknown item", a dropped feat,
   * "Empty cantrip" or an AC without the custom mode that is on. TOP-LEVEL on purpose, never inside
   * `character`: a no-build sheet's authored hash covers the whole `character` (./authored.ts), and which
   * copy of a record rides along is not something the player authored. Never moved into anyone's
   * homebrew or saved modes.
   */
  carried?: CarriedRecords;
}

/** What a sheet carries (`SavedChar.carried`): homebrew records by type, then id — and, since round 2
 *  (2026-10-20), the modes a player wrote that the sheet has switched on (src/data/carried.ts).
 *  `fill`: the `type:id` keys of carried records that only FILL a gap in a viewer's database, never win
 *  over the viewer's own record of that id — the ones the campaign a publish goes to shares itself
 *  (src/data/carried.ts carriedForCampaign). Absent on everything but a published sheet. */
export type CarriedRecords = Partial<HomebrewContent> & { modes?: Record<string, ModeDef>; fill?: string[] };

/** First roster entry whose character name matches `name` (case-insensitive, trimmed), or undefined.
 *  Includes archived characters — a name clash with an archived char is still a real clash. */
export function findByName(roster: SavedChar[], name: string): SavedChar | undefined {
  const want = name.trim().toLowerCase();
  return roster.find((c) => c.character.name.trim().toLowerCase() === want);
}

/** `base` if it's free, otherwise the first "base 2", "base 3", … not already taken (case-insensitive). */
export function uniqueName(base: string, roster: SavedChar[]): string {
  const taken = new Set(roster.map((c) => c.character.name.trim().toLowerCase()));
  if (!taken.has(base.trim().toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const cand = `${base} ${n}`;
    if (!taken.has(cand.trim().toLowerCase())) return cand;
  }
}

/** A deep copy of a saved character with a fresh roster id, a "(Copy)" name, and unarchived. Its modes:
 *  the roster's Duplicate goes through src/data/carried.ts `duplicateWithOwnModes`, which gives the copy its
 *  own copies of the modes the original owns (Guy 2026-10-21, "modes need to be per character"). */
export function duplicateChar(c: SavedChar): SavedChar {
  const copy: SavedChar = structuredClone(c);
  copy.id = newRosterId();
  copy.character = { ...copy.character, name: `${copy.character.name} (Copy)` };
  copy.archived = false;
  return copy;
}

export const ROSTER_KEY = 'wanderers-codex:roster:v1';
const KEY = ROSTER_KEY;

/**
 * `hash53(authoredKey(<a stored entry as it was on disk>))` → `authoredKey(<that entry as loaded>)`,
 * for every entry whose load CHANGED what counts as authored (a play / character migration of an app
 * update: normalizePlay dropping a legacy field, an item-id alias). Session memory, add-only: each pair
 * is a fact about content ("loading this makes that"), true whenever it is read.
 *
 * The GM-edit verdict reads it (src/sheet/gmSync.ts → `gmEditVerdict`, `loaded`): a GM push built on
 * what the OLDER version published must not be refused because this version's load — not the player —
 * changed the sheet and its launch republished that. A load is not an edit (F1, 2026-10-09).
 */
const loadedAuthored = new Map<string, string>();
export function loadedAuthoredAs(hash: string): string | undefined {
  return loadedAuthored.get(hash);
}

export function loadRoster(): SavedChar[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return [];
  }
  return parseRoster(raw);
}

/*
 * UNKNOWN IS NOT EMPTY — THE ROSTER-WIPE BUG (2026-11-17, test/bug-roster-wipe.test.ts).
 *
 * The parse below used to wrap the whole roster in ONE try/catch: a single entry whose normalize threw
 * (a name like {"toString":0}), or a value that did not JSON.parse, loaded as [] — and App's mount persist
 * wrote that [] over the stored roster 400 ms later. Every character gone, the original string with them.
 *
 * Now nothing stored is ever dropped by a load:
 *  - an entry that cannot be shown (not an object, no string id, no character object, or its normalize
 *    throws) is KEPT AS STORED: hidden from every screen (nothing renders a half-read character), and
 *    carried back onto the key, unchanged, by every saveRoster after it;
 *  - a value that is not a JSON array at all is UNKNOWN: it loads as [] so the app opens, and saveRoster
 *    copies it to its own key (ROSTER_UNREADABLE_PREFIX + owner + its signature; "Export everything" includes it)
 *    before the first write over it — and refuses the write when that copy cannot be made. A copy rather
 *    than refusing every write: the player keeps working and nothing they do is lost, while the unread
 *    value stays byte-for-byte where a fix or a support request can get it back.
 */

/** Where saveRoster keeps a stored roster value it could not read, before writing over it. */
export const ROSTER_UNREADABLE_PREFIX = 'wanderers-codex:roster-unreadable:v1:';

/** A stored roster entry with the shape the app reads: an object with a string id and a character object. */
export function isRosterEntry(e: unknown): e is SavedChar {
  if (!e || typeof e !== 'object') return false;
  const o = e as { id?: unknown; character?: unknown };
  return typeof o.id === 'string' && !!o.character && typeof o.character === 'object';
}

/** Stored entries of that shape whose normalize THREW — kept as stored like any unreadable entry. */
const unreadableEntries = new WeakSet<object>();

/** An entry the app shows: the right shape, and its normalize did not throw. */
function isShownEntry(e: unknown): boolean {
  return isRosterEntry(e) && !unreadableEntries.has(e);
}

/** What a stored roster value holds. */
export interface RosterRead {
  /** The entries the app can show, normalized. */
  roster: SavedChar[];
  /** The entries it cannot show, exactly as stored — every saveRoster writes them back. */
  kept: unknown[];
  /** False when the value is not a JSON array at all (UNKNOWN: saveRoster copies it aside before writing). */
  readable: boolean;
}

/** Each entry of a roster array, normalized when it can be read, else kept as it is. */
export function readRosterEntries(entries: unknown[]): { roster: SavedChar[]; kept: unknown[] } {
  const roster: SavedChar[] = [];
  const kept: unknown[] = [];
  for (const e of entries) {
    if (!isRosterEntry(e)) {
      kept.push(e);
      continue;
    }
    let out: SavedChar;
    try {
      out = { ...e, character: normalizeCharacter(e.character), play: e.play ? normalizePlay(e.play) : undefined };
    } catch {
      unreadableEntries.add(e);
      kept.push(e);
      continue;
    }
    try {
      const before = authoredKey(e);
      const after = authoredKey(out);
      if (before !== after) loadedAuthored.set(hash53(before), after);
    } catch {
      /* a sheet that won't serialise has no pair; the verdict then judges it as stored */
    }
    roster.push(out);
  }
  return { roster, kept };
}

/** The last stored value read or written, and what of it the app cannot show — saveRoster runs on every
 *  persist (each HP tick, debounced), so it must not re-parse the key each time to find what to carry. */
let lastScan: { raw: string; kept: unknown[]; readable: boolean } | null = null;

/** Read a raw stored roster value: what can be shown, what is kept as stored, and whether it was a roster. */
export function readRoster(raw: string | null): RosterRead {
  if (raw === null || raw === '') return { roster: [], kept: [], readable: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const read: RosterRead = Array.isArray(parsed) ? { ...readRosterEntries(parsed), readable: true } : { roster: [], kept: [], readable: false };
  lastScan = { raw, kept: read.kept, readable: read.readable };
  return read;
}

/** The roster a raw stored value holds — loadRoster's parse, for a value already read. Only what can be
 *  shown: an entry it cannot read is kept on the key by saveRoster (readRoster), never dropped. */
export function parseRoster(raw: string | null): SavedChar[] {
  return readRoster(raw).roster;
}

/** What of the stored value `raw` the app cannot show, from the cache when it is the value last seen. */
function scanOf(raw: string): { kept: unknown[]; readable: boolean } {
  if (lastScan && lastScan.raw === raw) return lastScan;
  const { kept, readable } = readRoster(raw);
  return { kept, readable };
}

/** The stored value the roster key holds now, or null (empty, or storage unreadable). */
function storedRosterRaw(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === '' ? null : raw;
  } catch {
    return null;
  }
}

/** What this device keeps that the Characters screen cannot show, for its one-line notice
 *  (src/sheet/RosterScreen.tsx): `entries`, stored characters on the roster key this version cannot
 *  read; `lists`, whole roster values that could not be read at all (the key's own value, and every copy
 *  under ROSTER_UNREADABLE_PREFIX). Without the line the player saw an empty or short roster and
 *  believed those characters deleted (a checker's finding on 12e9ad2). */
export function rosterUnreadCounts(): { entries: number; lists: number } {
  const raw = storedRosterRaw();
  const s = raw === null ? null : scanOf(raw);
  let lists = s && !s.readable ? 1 : 0;
  for (const k of rosterBackupKeys()) if (isOwnRosterBackup(k) && !isResetCopy(k) && localStorage.getItem(k) !== raw) lists++;
  return { entries: s?.readable ? s.kept.length : 0, lists };
}

/** How many copies of this account's roster the crash screen's "Reset saved data" kept (clearRoster) of a
 *  roster this version COULD read. They are not "lists that could not be read" (saying so would be a false
 *  alarm), so the Characters screen says what they are instead (RosterScreen unreadNotice). */
export function rosterResetCopies(): number {
  const raw = storedRosterRaw();
  let n = 0;
  for (const k of rosterBackupKeys()) if (isOwnRosterBackup(k) && isResetCopy(k) && localStorage.getItem(k) !== raw) n++;
  return n;
}

/** The tag after the owner in a reset copy's key (`<prefix><owner>:reset:<signature>`); every other scan of
 *  ROSTER_UNREADABLE_PREFIX (the GC and campaign scans, Export everything, a restore) treats it as any copy. */
const RESET_TAG = 'reset';
function isResetCopy(key: string): boolean {
  // Not a split-and-index: blocks-check reads every `x.split(':')[1]` as a feat slot key's category.
  const rest = key.slice(ROSTER_UNREADABLE_PREFIX.length);
  const owner = rest.indexOf(':');
  return owner >= 0 && rest.startsWith(`${RESET_TAG}:`, owner + 1);
}

/** Every key a roster copy sits under (ROSTER_UNREADABLE_PREFIX), whoever it was made for. */
function rosterBackupKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== null && k.startsWith(ROSTER_UNREADABLE_PREFIX)) out.push(k);
    }
  } catch {
    /* unreadable storage: no copies to find */
  }
  return out;
}

/** A copy's key names the account it was made for (`<prefix><owner or 'local'>:<signature>`). Only this
 *  account's copies, and copies made signed out, are counted on its Characters screen and go into its
 *  "Export everything": after an account switch the old account's copy is kept on the device, unseen,
 *  until that account signs in here again (a checker's finding on 54f6585 — the new account was told
 *  about, and exported, the other account's list). */
export function isOwnRosterBackup(key: string): boolean {
  if (!key.startsWith(ROSTER_UNREADABLE_PREFIX)) return false;
  const tag = key.slice(ROSTER_UNREADABLE_PREFIX.length).split(':')[0];
  return tag === 'local' || tag === (loadSyncOwner() ?? 'local');
}

/** What the roster key itself holds that loadRoster does not show, as text (empty when nothing). */
function keyUnshownText(): string {
  const raw = storedRosterRaw();
  if (raw === null) return '';
  const s = scanOf(raw);
  if (!s.readable) return raw;
  return s.kept.length ? JSON.stringify(s.kept) : '';
}

/** Everything this device keeps of a roster that loadRoster does not show, as text (empty when nothing):
 *  the key's kept entries (or its whole value when it is not a roster at all), and every copy saved under
 *  ROSTER_UNREADABLE_PREFIX, whoever it was made for. For a scan that must count every character on this
 *  device, readable or not: campaign homebrew's usedByRoster, App's portrait GC and its cleanup of
 *  campaigns no character holds. Once the first real save had copied an unread value aside the key read
 *  clean again, and the GC deleted a portrait only the copy still named (a checker's finding on 54f6585). */
export function rosterUnshownText(): string {
  let text = keyUnshownText();
  for (const k of rosterBackupKeys()) {
    try {
      text += localStorage.getItem(k) ?? '';
    } catch {
      /* unreadable storage: nothing more to add */
    }
  }
  return text;
}

/** Before a Restore clears the roster key on purpose (backup.restoreBackup): copy what the key holds that
 *  loadRoster does not show (a value that is not a roster, or kept unreadable entries) to its own key, so
 *  the restore never takes it with it. The whole value is copied (one string; the readable part is the
 *  player's to replace). True when nothing needed a copy or the copy is on disk; false when it could not
 *  be made. Before this, "restore last week's backup" — the obvious step after the notice "A saved
 *  character list could not be read. It is kept unchanged" — destroyed that list for good. */
export function copyUnreadRosterAside(why: string): boolean {
  const raw = storedRosterRaw();
  if (raw !== null && keyUnshownText()) return backupUnreadableRoster(raw, why);
  return true;
}

/** Copy a stored roster value the app cannot (wholly) read to its own key, named for the account it
 *  belongs to (isOwnRosterBackup). True once the copy is on disk. `kind` 'reset': a roster this version
 *  could read, kept by the crash screen's reset (clearRoster) — counted apart (rosterResetCopies). */
function backupUnreadableRoster(
  raw: string,
  why = 'the stored roster could not be read',
  owner: string | null = loadSyncOwner(),
  kind: 'unread' | 'reset' = 'unread',
): boolean {
  const key = `${ROSTER_UNREADABLE_PREFIX}${owner ?? 'local'}:${kind === 'reset' ? `${RESET_TAG}:` : ''}${rosterSig(raw)}`;
  try {
    if (localStorage.getItem(key) !== raw) {
      localStorage.setItem(key, raw);
      console.warn(`[roster] ${why}; kept unchanged under ${key}`);
    }
    return localStorage.getItem(key) === raw;
  } catch {
    return false;
  }
}

/** The kept entries of the stored value that the roster about to be written does not already hold: not
 *  the same text, and not an older copy of an id the roster writes unreadably itself. Only a cloud adopt
 *  hands saveRoster an entry it cannot show, and the merge chose that copy of the id; this version could
 *  never have edited the one on the key. Carried, each remote edit of a character this version cannot
 *  read left one more full copy on the key, without end (a checker's finding on 54f6585). */
function keptToCarry(kept: unknown[], roster: unknown[]): unknown[] {
  if (!kept.length) return kept;
  const own = roster.filter((e) => !isShownEntry(e));
  if (!own.length) return kept;
  const texts = new Set(own.map((e) => JSON.stringify(e)));
  const ids = new Set(own.map(idOf).filter((id): id is string => id !== undefined));
  return kept.filter((e) => !texts.has(JSON.stringify(e)) && !ids.has(idOf(e) as string));
}

/** A stored entry's string id, if it has one. */
function idOf(e: unknown): string | undefined {
  const id = e && typeof e === 'object' ? (e as { id?: unknown }).id : undefined;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Result of a save attempt: `true` on success, `false` when storage rejected it (e.g. quota).
 *
 * Every roster write this tab makes goes through here (the persist debounce, and cloud sync's adopt via
 * writeCloudBundle), so this is where the two-tabs bookkeeping lives (src/data/rosterLineage.ts): the
 * value written becomes what this tab KNOWS the key holds, and a lineage record says what it replaced.
 * The caller must already have folded in whatever the key held (rosterTabs.takeForeignRoster, or cloud
 * sync's read of the current bundle) — so that value is what this write was built on.
 *
 * A value the key already holds is not written again: no `storage` event goes out for it, so another
 * tab never sees an "echo" of a roster it wrote itself.
 *
 * Nothing the key holds that this app cannot read is lost by a write (UNKNOWN is not EMPTY, see
 * readRoster above): its kept entries are written back after `roster`, and a value that is not a roster
 * at all is copied to its own key first — no copy, no write.
 */
export function saveRoster(roster: SavedChar[]): boolean {
  try {
    const cur = localStorage.getItem(KEY);
    const was = cur === null || cur === '' ? null : scanOf(cur);
    if (was && !was.readable) {
      // Nothing of the player's to save yet (the launch's own write of the empty roster it loaded): the
      // unread value stays where it is. Anything real is written only once a copy of it is on disk.
      if (!roster.length) return true;
      if (!backupUnreadableRoster(cur as string)) return false;
    }
    const carry = was?.readable ? keptToCarry(was.kept, roster) : [];
    const all = carry.length ? [...roster, ...carry] : roster;
    const raw = JSON.stringify(all);
    const k = knownRoster();
    const sig = rosterSig(raw);
    if (cur !== raw) {
      writeLineage(sig, cur === null ? null : cur === k.raw ? k.sig : rosterSig(cur));
      localStorage.setItem(KEY, raw);
    }
    // Only what the app shows is what this tab knows it holds (the base another tab's write is merged
    // against); a cloud adopt can hand over entries it cannot read, and they ride along as kept ones.
    const shown = roster.every(isShownEntry) ? roster : roster.filter(isShownEntry);
    lastScan = { raw, kept: shown === roster ? carry : [...roster.filter((e) => !isShownEntry(e)), ...carry], readable: true };
    noteRosterKnown(raw, shown, sig, loadSyncOwner());
    return true;
  } catch {
    // Storage unavailable or over quota — the roster won't persist. Surfaced to the user by the
    // caller (App) rather than silently swallowed, so unsaved work isn't lost without warning.
    return false;
  }
}

export function newRosterId(): string {
  return `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** What the crash reset keeps of a stored roster value: 'unread' for a value that is not a roster (the
 *  notice says a list could not be read), 'reset' for a roster this version reads that holds anything (the
 *  notice says characters from before a reset are kept — never "could not be read", a false alarm), and
 *  null for an empty one ('[]': nothing to keep, no copy and no notice). JSON.parse only: the reset runs
 *  after a crash, so it calls no normalize. */
function resetCopyKind(raw: string): 'unread' | 'reset' | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'unread';
  }
  if (!Array.isArray(parsed)) return 'unread';
  return parsed.length ? 'reset' : null;
}

/** Last-resort recovery: wipe the persisted roster + active id (e.g. a corrupt save crashing on load).
 *  The roster is copied aside first (backupUnreadableRoster: the Characters notice counts it, "Export
 *  everything" saves it), so a player who is not signed in does not lose every character to the crash
 *  screen's one button. A copy too large to sit beside the key is made after the key is gone, in the
 *  space it freed.
 *
 *  Returns false when no copy fits even then: the roster is put back as it was (the crash screen
 *  promised the characters are kept) and the caller asks the player before `withoutCopy` clears it. */
export function clearRoster(opts: { withoutCopy?: boolean } = {}): boolean {
  try {
    const raw = storedRosterRaw();
    const kind = raw === null || opts.withoutCopy ? null : resetCopyKind(raw);
    const why = 'the player reset saved data after a crash';
    const copied = kind === null || backupUnreadableRoster(raw as string, why, undefined, kind);
    localStorage.removeItem(KEY);
    // No room for a copy even after the key is gone: put the roster back as it was.
    if (!copied && !backupUnreadableRoster(raw as string, why, undefined, kind as 'unread' | 'reset')) {
      localStorage.setItem(KEY, raw as string);
      localStorage.removeItem(ACTIVE_KEY);
      return false;
    }
    localStorage.removeItem(ACTIVE_KEY);
    return true;
  } catch {
    return true; // storage unavailable: nothing more this button can do; the reload shows what is left
  }
}

const ACTIVE_KEY = 'wanderers-codex:active:v1';

/** The roster id of the last-opened character (so a reload reopens it). */
export function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // storage unavailable — non-fatal.
  }
}

/* ---- Homebrew: user-authored content, grouped under user-named Sources ---------------------------
 * A Source is just a label + id. Each content entry carries `homebrewSourceId` linking it to its
 * source, plus `source: { license: 'homebrew' }`. All entries merge into the live ContentDatabase at
 * load (data/index.ts), so homebrew resolves everywhere core content does. */

export interface HomebrewSource {
  id: string;
  name: string;
  abbreviation?: string;
  description?: string;
  /**
   * A GM's campaign source this player's app KEPT when it stopped being shared (unshared, deleted,
   * campaign gone, kicked, left) — see data/campaignHomebrew.ts. `from` names the campaign; `ids` are
   * the `${type}:${id}` keys the player has not edited since, which sit UNDER the GM's live copy if it
   * comes back. saveHomebrewEntry drops a key from here the moment the player edits that entry.
   */
  kept?: { from: string; ids: string[] };
}

/** The content-type buckets the Homebrew manager can author. */
export interface HomebrewContent {
  items: Record<string, Item>;
  feats: Record<string, Feat>;
  spells: Record<string, Spell>;
  ancestries: Record<string, Ancestry>;
  heritages: Record<string, Heritage>;
  backgrounds: Record<string, Background>;
  actions: Record<string, Action>;
  /** Owner request 2026-09-02 ("i cant add a deity to home brew its a problem") — a homebrew deity
   *  merges into content.deities and is read by the builder's Deity picker and the cleric engine
   *  exactly like a printed one. */
  deities: Record<string, Deity>;
}
export type HomebrewType = keyof HomebrewContent;
export const HOMEBREW_TYPES: HomebrewType[] = [
  'items',
  'feats',
  'spells',
  'ancestries',
  'heritages',
  'backgrounds',
  'actions',
  'deities',
];

const HOMEBREW_SOURCES_KEY = 'wanderers-codex:homebrew-sources:v1';
const HOMEBREW_CONTENT_KEY = 'wanderers-codex:homebrew-content:v1';
const LEGACY_HOMEBREW_ITEMS_KEY = 'wanderers-codex:homebrew-items:v1';

function emptyHomebrewContent(): HomebrewContent {
  return { items: {}, feats: {}, spells: {}, ancestries: {}, heritages: {}, backgrounds: {}, actions: {}, deities: {} };
}

export function loadHomebrewSources(): Record<string, HomebrewSource> {
  try {
    const raw = localStorage.getItem(HOMEBREW_SOURCES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, HomebrewSource>) : {};
  } catch {
    return {};
  }
}

export function saveHomebrewSource(source: HomebrewSource): void {
  try {
    const all = loadHomebrewSources();
    all[source.id] = source;
    localStorage.setItem(HOMEBREW_SOURCES_KEY, JSON.stringify(all));
  } catch {
    /* non-fatal */
  }
  recordReviveKeys([`hbsrc:${source.id}`]);
  markLocalDataChanged();
  markHbDirty(`src:${source.id}`, source.id);
}

/** Delete a source and every content entry that belonged to it. */
export function deleteHomebrewSource(id: string): void {
  const tombstones: string[] = [`hbsrc:${id}`];
  try {
    const sources = loadHomebrewSources();
    delete sources[id];
    localStorage.setItem(HOMEBREW_SOURCES_KEY, JSON.stringify(sources));
    const content = loadHomebrewContent();
    for (const type of HOMEBREW_TYPES) {
      for (const [eid, entry] of Object.entries(content[type])) {
        if ((entry as { homebrewSourceId?: string }).homebrewSourceId === id) {
          delete content[type][eid];
          tombstones.push(`hb:${type}:${eid}`);
        }
      }
    }
    localStorage.setItem(HOMEBREW_CONTENT_KEY, JSON.stringify(content));
  } catch {
    /* non-fatal */
  }
  recordTombstoneKeys(tombstones);
  markLocalDataChanged();
  // One key for the whole source: the publish deletes every row with this source_id.
  markHbDirty(`src:${id}`, id);
}

/** All homebrew content, folding in any items saved under the legacy items-only key. */
export function loadHomebrewContent(): HomebrewContent {
  const content = emptyHomebrewContent();
  try {
    const raw = localStorage.getItem(HOMEBREW_CONTENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<HomebrewContent>) : null;
    if (parsed && typeof parsed === 'object') {
      for (const type of HOMEBREW_TYPES) Object.assign(content[type], parsed[type] ?? {});
    }
  } catch {
    /* ignore */
  }
  try {
    const legacy = localStorage.getItem(LEGACY_HOMEBREW_ITEMS_KEY);
    const items = legacy ? (JSON.parse(legacy) as Record<string, Item>) : null;
    if (items && typeof items === 'object') for (const [id, it] of Object.entries(items)) content.items[id] ??= it;
  } catch {
    /* ignore */
  }
  return content;
}

function saveHomebrewContent(content: HomebrewContent): void {
  try {
    localStorage.setItem(HOMEBREW_CONTENT_KEY, JSON.stringify(content));
  } catch {
    /* non-fatal */
  }
  markLocalDataChanged(); // homebrew is synced — nudge cloud upload
}

/** Persist (or update) one homebrew entry of the given type. */
export function saveHomebrewEntry<T extends HomebrewType>(type: T, entry: HomebrewContent[T][string]): void {
  const content = loadHomebrewContent();
  const id = (entry as { id: string }).id;
  content[type][id] = entry;
  recordReviveKeys([`hb:${type}:${id}`]); // (re-)created → beat any older tombstone through the merge
  saveHomebrewContent(content);
  const key = `${type}:${id}`;
  const sid = (entry as { homebrewSourceId?: string }).homebrewSourceId;
  // A KEPT campaign entry the player edits becomes theirs: off the kept list, so it sits ON TOP of the
  // GM's live copy from now on instead of under it (data/index.ts mergeWithSeed, layer 1 vs 3).
  const src = sid ? loadHomebrewSources()[sid] : undefined;
  if (src?.kept?.ids?.includes(key)) saveHomebrewSource({ ...src, kept: { ...src.kept, ids: src.kept.ids.filter((k) => k !== key) } });
  markHbDirty(key, sid);
}

/** Remove a homebrew entry. */
export function deleteHomebrewEntry(type: HomebrewType, id: string): void {
  const content = loadHomebrewContent();
  const sid = (content[type][id] as { homebrewSourceId?: string } | undefined)?.homebrewSourceId; // read BEFORE the delete
  delete content[type][id];
  recordTombstoneKeys([`hb:${type}:${id}`]); // so the union merge won't resurrect it
  saveHomebrewContent(content);
  markHbDirty(`${type}:${id}`, sid);
}

/* ---- Campaign homebrew (data/campaignHomebrew.ts) — DEVICE-LOCAL, never in the CloudBundle --------
 * The CACHE is this device's last pulled copy of every campaign's shared homebrew (keyed by campaign
 * id), stamped with the account it was pulled for so a second account on this browser never reads it.
 * The DIRTY set is the GM side: `type:id` / `src:id` → source id of every homebrew record written since
 * the last publish. Only the four writers above add to it; writeCloudBundle never does — a pull is not
 * an edit. */
export const CAMPAIGN_HB_CACHE_KEY = 'wanderers-codex:campaign-homebrew:v1';
export const CAMPAIGN_HB_DIRTY_KEY = 'wanderers-codex:campaign-hb-dirty:v1';

export interface CampaignHbCampaign {
  name: string;
  sources: Record<string, HomebrewSource>;
  content: Partial<HomebrewContent>;
  updatedAt: string;
  /** `${type}:${id}` → that entry row's SERVER updated_at: a player's tombstone blocks converting the
   *  entry only when it is newer than this (data/campaignHomebrew.ts convertGone). */
  stamps?: Record<string, string>;
}

/** The last pulled copy, or {} when it was pulled for another account (or never). */
export function loadCampaignHbCache(): Record<string, CampaignHbCampaign> {
  const raw = loadJsonRaw(CAMPAIGN_HB_CACHE_KEY) as { uid?: unknown; campaigns?: unknown } | undefined;
  if (!raw || typeof raw !== 'object' || raw.uid !== loadSyncOwner()) return {};
  const c = raw.campaigns;
  return c && typeof c === 'object' ? (c as Record<string, CampaignHbCampaign>) : {};
}

/** This account's real (server-side) campaign ids in one role — never the signed-out Local table, never
 *  a membership with no id — once each, sorted so the list compares as a string. The ids a campaign
 *  homebrew pull reads for ('player') and publishes for ('gm'), data/campaignHomebrew.ts. */
export function campaignMemberIds(role: 'gm' | 'player'): string[] {
  return [...new Set(loadCampaigns().filter((m) => m?.role === role && !m.local && !!m.id).map((m) => m.id))].sort();
}

/**
 * UNKNOWN ≠ EMPTY: does this device KNOW `uid`'s campaign homebrew? loadCampaignHbCache reads {} both
 * for "pulled for this account, and nothing is shared" and for "never pulled here / pulled for another
 * account / unreadable"; only the stored copy's stamps tell them apart. Known = a copy stamped for `uid`
 * (no account is never one) that holds a campaigns object AND a full read of every campaign this account
 * plays in now (campaignMemberIds('player')) — what saveCampaignHbCache writes after a pull that went
 * through, even when nothing is shared. A campaign joined after the last pull, one with a row the pull
 * couldn't read, or one whose conversion didn't finish is not in `pulledFor`, so the copy is unknown
 * until a pull reads it whole. The cache's format stays in this file: callers (the Homebrew page's
 * import) ask this, never read the key themselves.
 */
export function campaignHbCacheKnown(uid: string | null): boolean {
  const raw = loadJsonRaw(CAMPAIGN_HB_CACHE_KEY) as { uid?: unknown; campaigns?: unknown; pulledFor?: unknown } | null | undefined;
  if (uid === null || raw?.uid !== uid) return false;
  const c = raw.campaigns;
  // saveCampaignHbCache writes a keyed object: an array is not one this build wrote.
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  const read = raw.pulledFor;
  if (!Array.isArray(read)) return false; // a copy from before the list existed: which campaigns it read is unknown
  return campaignMemberIds('player').every((id) => read.includes(id));
}

/** `pulledFor`: the player campaigns this copy holds a FULL read of (see campaignHbCacheKnown). Left
 *  out, the copy vouches for none of them. False when the device refused the write (a full storage):
 *  the copy on disk is still the previous one. */
export function saveCampaignHbCache(uid: string, campaigns: Record<string, CampaignHbCampaign>, pulledFor: readonly string[] = []): boolean {
  try {
    localStorage.setItem(CAMPAIGN_HB_CACHE_KEY, JSON.stringify({ uid, campaigns, pulledFor }));
    return true;
  } catch {
    return false; // non-fatal: the next pull writes it again
  }
}

/** Every campaign source this device holds, once each (the first campaign that shares it wins). */
export function listCampaignHbSources(): { id: string; name: string; campaignId: string; campaignName: string; count: number }[] {
  const out = new Map<string, { id: string; name: string; campaignId: string; campaignName: string; count: number }>();
  for (const [campaignId, camp] of Object.entries(loadCampaignHbCache())) {
    for (const src of Object.values(camp.sources ?? {})) {
      if (out.has(src.id)) continue;
      let count = 0;
      for (const t of HOMEBREW_TYPES) {
        for (const e of Object.values(camp.content?.[t] ?? {})) if ((e as { homebrewSourceId?: string }).homebrewSourceId === src.id) count++;
      }
      out.set(src.id, { id: src.id, name: src.name, campaignId, campaignName: camp.name, count });
    }
  }
  return [...out.values()];
}

/** The player's own homebrew as one string that ignores key order — "did a sync change it?". Modes too
 *  (2026-11-13): the content database merges them from storage like homebrew, and without them a mode
 *  edited on another device reached this device's storage but not its open screen until a relaunch. */
export function homebrewFingerprint(): string {
  const sorted = (r: Record<string, unknown>) => Object.keys(r).sort().map((k) => [k, r[k]]);
  const c = loadHomebrewContent();
  return JSON.stringify([sorted(loadHomebrewSources()), HOMEBREW_TYPES.map((t) => sorted(c[t])), sorted(loadModes())]);
}

/** The dirty set as it sits on disk. The publish READS it and leaves it there: a key goes only once its
 *  upload went through (clearCampaignHbDirty), so an app killed mid-publish still holds every edit. */
export function loadCampaignHbDirty(): Record<string, string> {
  const raw = loadJsonRaw(CAMPAIGN_HB_DIRTY_KEY);
  return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
}
function saveCampaignHbDirty(map: Record<string, string>): void {
  try {
    if (Object.keys(map).length) localStorage.setItem(CAMPAIGN_HB_DIRTY_KEY, JSON.stringify(map));
    else localStorage.removeItem(CAMPAIGN_HB_DIRTY_KEY);
  } catch {
    /* non-fatal: worst case one edit waits for the next write of that record */
  }
}

/** A publish that went through forgets the keys it settled — each only while it still names the source
 *  it was settled under (a write since then that moved the record to another source keeps it). */
export function clearCampaignHbDirty(done: Record<string, string>): void {
  const map = loadCampaignHbDirty();
  for (const [key, sid] of Object.entries(done)) if (map[key] === sid) delete map[key];
  saveCampaignHbDirty(map);
}

/** The writers' hook: record the key (newest source wins), then nudge the publish. */
function markHbDirty(key: string, sourceId: string | undefined): void {
  if (!sourceId) return; // an entry with no source can't be in a shared one
  saveCampaignHbDirty({ ...loadCampaignHbDirty(), [key]: sourceId });
  markCampaignHbDirty();
}

/** Back-compat shim: the inventory "Create item" flow and data/index.ts use these. */
export function loadHomebrewItems(): Record<string, Item> {
  return loadHomebrewContent().items;
}
export function saveHomebrewItem(item: Item): void {
  saveHomebrewEntry('items', item);
}

const MODES_KEY = 'wanderers-codex:modes:v1';

/** User-saved modes, keyed by id. Merged over the built-in catalog at load (data/index.ts). */
export function loadModes(): Record<string, ModeDef> {
  try {
    const raw = localStorage.getItem(MODES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ModeDef>) : {};
  } catch {
    return {};
  }
}

/** Persist (or update) a single user mode. */
export function saveMode(mode: ModeDef): void {
  try {
    const all = loadModes();
    all[mode.id] = mode;
    localStorage.setItem(MODES_KEY, JSON.stringify(all));
  } catch {
    // non-fatal
  }
  recordReviveKeys([`mode:${mode.id}`]);
  markLocalDataChanged(); // modes are synced — nudge cloud upload
}

/** Delete a user mode by id. */
export function deleteMode(id: string): void {
  try {
    const all = loadModes();
    delete all[id];
    localStorage.setItem(MODES_KEY, JSON.stringify(all));
  } catch {
    // non-fatal
  }
  recordTombstoneKeys([`mode:${id}`]);
  markLocalDataChanged();
}

const CAMPAIGNS_KEY = 'pf2e-codex.campaigns';

/** This user's campaign memberships (GM-owned + joined). Synced with the bundle; the campaigns
 *  themselves live in the shared Supabase table (data/campaigns.ts). */
export function loadCampaigns(): CampaignMembership[] {
  try {
    const raw = localStorage.getItem(CAMPAIGNS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as CampaignMembership[]) : [];
  } catch {
    return [];
  }
}

/** Replace the whole membership list (add/remove/update happen in the page, then save the result). */
export function saveCampaigns(list: CampaignMembership[]): void {
  // Diff against the previous list so a REMOVED membership gets a tombstone (else the union merge would
  // resurrect it from another device), and an added or changed one is stamped revived (it beats an older
  // tombstone). Only those: re-stamping every kept membership on each save brought back one another
  // device had left meanwhile, and made the stamp useless as "joined at" (App's launch cleanup waits a
  // day from it — a checker's finding, 2026-10-21).
  const before = new Map(loadCampaigns().map((m) => [m.id, JSON.stringify(m)]));
  const nextIds = new Set(list.map((m) => m.id));
  const removed = [...before.keys()].filter((id) => !nextIds.has(id)).map((id) => `camp:${id}`);
  const touched = list.filter((m) => before.get(m.id) !== JSON.stringify(m)).map((m) => `camp:${m.id}`);
  try {
    localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(list));
  } catch {
    // non-fatal
  }
  if (removed.length) recordTombstoneKeys(removed);
  recordReviveKeys(touched);
  markLocalDataChanged(); // campaign memberships are synced — nudge cloud upload
}

const UNHELD_CAMPAIGNS_KEY = 'pf2e-codex.unheldCampaigns';

/** When this device first saw each PLAYER campaign membership no character holds (campaign id → ms).
 *  Device-local, not synced, but account-scoped (wipeSyncedLocalData): App's launch cleanup removes one
 *  only a day after it was first seen (campaignLeave.ts dropUnheldPlayerCampaigns). */
export function loadUnheldCampaigns(): Record<string, number> {
  try {
    const raw = localStorage.getItem(UNHELD_CAMPAIGNS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}
export function saveUnheldCampaigns(seen: Record<string, number>): void {
  try {
    if (Object.keys(seen).length) localStorage.setItem(UNHELD_CAMPAIGNS_KEY, JSON.stringify(seen));
    else localStorage.removeItem(UNHELD_CAMPAIGNS_KEY);
  } catch {
    // non-fatal
  }
}

/** Permanently erase ALL of this app's locally-stored data: every saved character, homebrew item,
 *  custom mode, theme/zoom preference, and any other setting. The app owns its storage origin
 *  (a dedicated Tauri webview, or its own dev-server port), so clearing localStorage wipes only
 *  this app's data and nothing else. Returns the number of storage keys removed. IRREVERSIBLE —
 *  only call behind an explicit, typed user confirmation. */
export function wipeAllData(): number {
  // BEFORE ANY KEY GOES: the GM-device mirror holds a per-key history of its conversation with the
  // cloud, in memory as well as on disk, and clearing storage below settles only the disk half. Its
  // next scheduled push finds nothing dirty left to send and writes the in-memory map straight back
  // out (trackerSync.ts's `if (!rows.length) { saveStamps(); return; }`) — so the file outlives the
  // wipe in the two branches that keep running after it (the plain-browser reload, same origin still
  // signed in; the Android fallback, which does not reload at all), and on the next start every cloud
  // row it names reads as already reconciled and is skipped: the GM's own boards never come back
  // down. Same announcement the two other wholesale rewrites make — see forgetTrackerSyncStamps.
  notifyReset();
  let removed = 0;
  try {
    removed = localStorage.length;
    localStorage.clear();
  } catch {
    // storage unavailable — nothing to clear
  }
  try {
    sessionStorage.clear();
  } catch {
    // non-fatal
  }
  return removed;
}

/** Rough total size of this app's localStorage, in bytes (stored as UTF-16 ≈ 2 bytes/char). Used to
 *  warn the user BEFORE they hit the browser's ~5 MB quota and a save actually fails. */
export function localStorageBytes(): number {
  let chars = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null) continue;
      chars += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
  } catch {
    return 0;
  }
  return chars * 2;
}

/* ---- Cloud sync bundle (web build) -----------------------------------------------------------
 * Everything cloud sync mirrors is bundled together so it uploads/downloads as one JSON blob.
 * Per-character last-modified timestamps live in their OWN key (not on SavedChar) so the app's
 * normal roster writes — which don't know about sync — can never strip them. */

const CHAR_UPDATED_KEY = 'wanderers-codex:char-updated:v1';

/** Per-roster-id last-modified time (epoch ms). Used only to resolve cloud-sync conflicts. */
export function loadCharUpdated(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CHAR_UPDATED_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === 'object' ? (p as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function saveCharUpdated(map: Record<string, number>): void {
  try {
    localStorage.setItem(CHAR_UPDATED_KEY, JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}

const GM_EDITS_APPLIED_KEY = 'wanderers-codex:gm-edits-applied:v1';

/** `campaignId|charId` → the `updated_at` of the last GM edit this device HANDLED (applied, refused
 *  or found already settled).
 *
 *  The applier's cleanup DELETE on `gm_character_edits` is best-effort — on a database missing the
 *  `gce_owner_delete` policy (a setup that predates it) it silently removes NOTHING, and the same
 *  edit then re-applied on every poll tick (2.5 s), clobbering every local change seconds after it
 *  was made. This stamp is what makes that loop structurally impossible: a row carrying the SAME
 *  stamp (compared as an instant, by equality — src/sheet/gmSync.ts → `editsToApply`) has already
 *  been judged here and is never judged again, whatever the delete did. A different push is a new
 *  edit even when the GM's other device stamped it earlier: two GM clocks are never ordered. */
export function loadGmEditsApplied(): Record<string, string> {
  try {
    const raw = localStorage.getItem(GM_EDITS_APPLIED_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === 'object' ? (p as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveGmEditsApplied(map: Record<string, string>): void {
  try {
    localStorage.setItem(GM_EDITS_APPLIED_KEY, JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}

const GM_EDITS_CHAIN_KEY = 'wanderers-codex:gm-edits-chain:v1';

/** `campaignId|charId` → WHICH GM edit this device last APPLIED, what it was built on and what it
 *  produced: `at` = that row's own `updated_at` (a later push's `gm_base.on` names it), `stamp` = its
 *  `gm_base.stamp` (the publish it was applied over — every later push built on a held edit of his over
 *  that publish carries it), `base` = its `gm_base.hash`, `result` = `hash53(authoredKey(<the roster
 *  entry the apply produced>))`. It lets the GM's next push, built on THAT push of his, land here — and
 *  only here, only while the sheet is still exactly that result (src/sheet/gmSync.ts → `gmEditVerdict`). Kept
 *  OUTSIDE the roster and its undo timeline on purpose: a Ctrl+Z of the applied edit must make the
 *  sheet differ from `result`, never move the record with it. */
export function loadGmEditChains(): Record<string, { at?: string; stamp?: string; base: string; result: string }> {
  try {
    const raw = localStorage.getItem(GM_EDITS_CHAIN_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === 'object' ? (p as Record<string, { at?: string; stamp?: string; base: string; result: string }>) : {};
  } catch {
    return {};
  }
}

export function saveGmEditChains(map: Record<string, { at?: string; stamp?: string; base: string; result: string }>): void {
  try {
    localStorage.setItem(GM_EDITS_CHAIN_KEY, JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}

const PREFS_KEY = 'pf2e-codex.prefs';
const APPEARANCE_KEY = 'pf2e-codex.appearance';
const CUSTOMIZATION_KEY = 'pf2e-codex.customization';

function loadJsonRaw(key: string): unknown {
  try {
    const r = localStorage.getItem(key);
    return r ? JSON.parse(r) : undefined;
  } catch {
    return undefined;
  }
}

const SYNC_META_KEY = 'pf2e-codex.syncMeta';

/** Who last wrote the cloud, and when — surfaced in Settings as "Last synced from ⟨device⟩". */
export interface SyncMeta {
  lastDevice?: { id: string; label: string };
  lastEditedAt?: number;
}

export function loadSyncMeta(): SyncMeta {
  const raw = loadJsonRaw(SYNC_META_KEY);
  return raw && typeof raw === 'object' ? (raw as SyncMeta) : {};
}

export function saveSyncMeta(m: SyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(m));
  } catch {
    /* non-fatal */
  }
}

/* ---- Deletion tombstones + account owner --------------------------------------------------------
 * The cloud merge is a conservative UNION (never drops a record present on only one side), so a plain
 * delete would be resurrected from the other device's copy. A tombstone records "id X was deleted at
 * time T"; the merge then drops X unless it was (re-)created/edited after T. Tombstones are synced in
 * the bundle and pruned after a long TTL, by when every device has converged. Keys are namespaced:
 *   char:<id> · hb:<type>:<id> · hbsrc:<id> · mode:<id> · camp:<id> */
const TOMBSTONES_KEY = 'pf2e-codex.deleted';
const REVIVED_KEY = 'pf2e-codex.revived';
const SYNC_OWNER_KEY = 'pf2e-codex.syncOwner';
/** Retention for a deletion tombstone. Long enough that a device offline for months won't resurrect
 *  deleted data; after this every device has converged so the tombstone is pruned to bound growth. */
export const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export function loadTombstones(): Record<string, number> {
  const raw = loadJsonRaw(TOMBSTONES_KEY);
  return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
}
function saveTombstones(map: Record<string, number>): void {
  try {
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}
/** Per-key "last (re-)created/updated at" for KEYED records (homebrew/sources/modes/campaigns), which
 *  have no timestamp of their own. It plays the role charUpdated plays for characters: the merge keeps a
 *  keyed record when its revive time is newer than any tombstone. Synced so a re-create on one device
 *  beats a stale tombstone another device still holds (a bare local tombstone-clear would NOT propagate). */
export function loadRevived(): Record<string, number> {
  const raw = loadJsonRaw(REVIVED_KEY);
  return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
}
function saveRevived(map: Record<string, number>): void {
  try {
    localStorage.setItem(REVIVED_KEY, JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}
/** Mark synced records as deleted so the cloud merge won't resurrect them from another device. */
export function recordTombstoneKeys(keys: string[]): void {
  if (!keys.length) return;
  const m = loadTombstones();
  const now = Date.now();
  for (const k of keys) m[k] = now;
  saveTombstones(m);
  markLocalDataChanged();
}
/** Stamp keyed records as (re-)created NOW so they beat any older tombstone through the union merge. */
export function recordReviveKeys(keys: string[]): void {
  if (!keys.length) return;
  const m = loadRevived();
  const now = Date.now();
  for (const k of keys) m[k] = now;
  saveRevived(m);
  markLocalDataChanged();
}

/** The account (auth uid) this device's synced data currently belongs to. Used to keep one account
 *  from inheriting/re-uploading another's data when they sign in on the same browser. */
export function loadSyncOwner(): string | null {
  try {
    return localStorage.getItem(SYNC_OWNER_KEY);
  } catch {
    return null;
  }
}
export function saveSyncOwner(uid: string): void {
  try {
    localStorage.setItem(SYNC_OWNER_KEY, uid);
  } catch {
    /* non-fatal */
  }
}
/** Wipe only the ACCOUNT-scoped synced data (roster, homebrew, modes, campaigns, sync meta, tombstones)
 *  — NOT device-global prefs/appearance. Used when a different account signs in on this browser.
 *
 *  This tab emptied the roster key itself, so it KNOWS the key is empty and holds no account's roster
 *  (owner null: the account now signing in takes it, as on a first sign-in — rosterTabs.ts). Left naming
 *  the old account, this tab read its own wipe as "another tab switched accounts" and held every write
 *  until its first pull succeeded — offline, a character made in the new account was never saved (a
 *  checker's finding on S3, 2026-10-20; test/bug-account-switch-this-tab.test.tsx). */
export function wipeSyncedLocalData(owner: string | null = loadSyncOwner()): void {
  // What the roster key holds that this version cannot read was never uploaded (readCloudBundle sends
  // only what it shows), so removing the key would lose it with no copy anywhere: it is copied aside
  // first, as saveRoster does (UNKNOWN is not EMPTY; a checker's finding on 12e9ad2). The copy is named
  // for `owner`, the account whose roster this was (cloudSync passes it: it saves the new owner first).
  const raw = storedRosterRaw();
  const why = 'an account switch removes the roster, which holds entries this version cannot read';
  const mustCopy = raw !== null && !!keyUnshownText();
  const copied = !mustCopy || backupUnreadableRoster(raw as string, why, owner);
  noteRosterKnown(null, [], null, null);
  for (const k of [
    ROSTER_KEY,
    ACTIVE_KEY,
    CHAR_UPDATED_KEY,
    HOMEBREW_CONTENT_KEY,
    HOMEBREW_SOURCES_KEY,
    LEGACY_HOMEBREW_ITEMS_KEY,
    MODES_KEY,
    CAMPAIGNS_KEY,
    TOMBSTONES_KEY,
    REVIVED_KEY,
    SYNC_META_KEY,
    // Device-local, not synced — but ACCOUNT-scoped: another account's campaign copy and unsent edits.
    CAMPAIGN_HB_CACHE_KEY,
    CAMPAIGN_HB_DIRTY_KEY,
    UNHELD_CAMPAIGNS_KEY,
  ]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* non-fatal */
    }
  }
  // Too full to copy beside the key: copy into the space the removals just freed (as clearRoster does).
  if (!copied) backupUnreadableRoster(raw as string, why, owner);
}

export interface CloudBundle {
  roster: SavedChar[];
  homebrew: HomebrewContent;
  homebrewSources: Record<string, HomebrewSource>;
  modes: Record<string, ModeDef>;
  /** Campaign memberships (GM-owned + joined). The campaigns themselves live in the shared table. */
  campaigns?: CampaignMembership[];
  charUpdated: Record<string, number>;
  /** Deletion tombstones (id → deleted-at ms) so the union merge doesn't resurrect deleted records. */
  deleted?: Record<string, number>;
  /** Revive stamps (id → last-created/updated ms) for keyed records, so a re-create beats a stale
   *  tombstone. Characters use `charUpdated` for this; keyed records (homebrew/modes/campaigns) use this. */
  revived?: Record<string, number>;
  /** Device settings (prefs + appearance) — synced last-write-wins via settingsUpdated. */
  settings?: { prefs?: unknown; appearance?: unknown };
  settingsUpdated?: number;
  /** The device-global sheet-customization default. Synced on its OWN timestamp so a customization edit on
   *  one device isn't clobbered by a more-recent theme/prefs edit on another. */
  customization?: unknown;
  customizationUpdated?: number;
  /** Last device to write the cloud (for the "Last synced from …" line). Set only on push. */
  lastDevice?: { id: string; label: string };
  lastEditedAt?: number;
}

/** Snapshot everything cloud sync mirrors, straight from localStorage. */
export function readCloudBundle(): CloudBundle {
  const meta = loadSyncMeta();
  return {
    roster: loadRoster(),
    homebrew: loadHomebrewContent(),
    homebrewSources: loadHomebrewSources(),
    modes: loadModes(),
    campaigns: loadCampaigns(),
    charUpdated: loadCharUpdated(),
    deleted: loadTombstones(),
    revived: loadRevived(),
    settings: { prefs: loadJsonRaw(PREFS_KEY), appearance: loadJsonRaw(APPEARANCE_KEY) },
    settingsUpdated: loadSettingsUpdated(),
    customization: loadJsonRaw(CUSTOMIZATION_KEY),
    customizationUpdated: loadCustomizationUpdated(),
    lastDevice: meta.lastDevice,
    lastEditedAt: meta.lastEditedAt,
  };
}

/** Overwrite localStorage with a (merged) bundle. Used when adopting the cloud's copy on login.
 *  The caller re-applies prefs/appearance live (cloudSync) — this only writes the raw keys. */
export function writeCloudBundle(b: CloudBundle): void {
  saveRoster(b.roster ?? []);
  try {
    localStorage.setItem(HOMEBREW_CONTENT_KEY, JSON.stringify(b.homebrew ?? emptyHomebrewContent()));
  } catch {
    /* non-fatal */
  }
  try {
    localStorage.setItem(HOMEBREW_SOURCES_KEY, JSON.stringify(b.homebrewSources ?? {}));
  } catch {
    /* non-fatal */
  }
  try {
    localStorage.setItem(MODES_KEY, JSON.stringify(b.modes ?? {}));
  } catch {
    /* non-fatal */
  }
  if (b.campaigns) {
    try {
      localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(b.campaigns));
    } catch {
      /* non-fatal */
    }
  }
  saveCharUpdated(b.charUpdated ?? {});
  if (b.deleted) saveTombstones(b.deleted);
  if (b.revived) saveRevived(b.revived);
  if (b.settings?.prefs !== undefined) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(b.settings.prefs));
    } catch {
      /* non-fatal */
    }
  }
  if (b.customization !== undefined) {
    try {
      localStorage.setItem(CUSTOMIZATION_KEY, JSON.stringify(b.customization));
    } catch {
      /* non-fatal */
    }
  }
  if (b.settings?.appearance !== undefined) {
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(b.settings.appearance));
    } catch {
      /* non-fatal */
    }
  }
  if (b.settingsUpdated) saveSettingsUpdated(b.settingsUpdated);
  if (b.customizationUpdated) saveCustomizationUpdated(b.customizationUpdated);
  if (b.lastDevice || b.lastEditedAt) saveSyncMeta({ lastDevice: b.lastDevice, lastEditedAt: b.lastEditedAt });
}
