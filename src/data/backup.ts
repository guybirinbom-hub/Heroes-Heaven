/*
 * Whole-device backup & restore (Settings → Backup).
 *
 * The app owns its entire storage origin (a dedicated Tauri webview, or its own dev-server port —
 * same reasoning as wipeAllData in storage.ts), so a backup simply snapshots EVERY localStorage
 * key into one versioned JSON envelope, and a restore writes those raw values back. Keys are kept
 * as opaque strings: a backup made by a newer build round-trips through an older one untouched.
 */
import { APP_VERSION } from '../version';
import { notifyReset } from '../../tracker/src/store/persistBus';
import type { HomebrewContent, HomebrewSource } from './storage';

/** The GM-device mirror's per-key history (src/data/trackerSync.ts's STAMP_PREFIX, one file per
 *  account). Named here so a restore can leave it out — see restoreBackup. */
const TRACKER_SYNC_STAMP_PREFIX = 'wanderers-codex:tracker-sync:';

export const BACKUP_APP = 'heroes-heaven';
export const BACKUP_KIND = 'full-backup';
export const BACKUP_FORMAT_VERSION = 1;

/** The storage keys the homebrew lives under (src/data/storage.ts writes them). A backup carries them
 *  like every other key; Homebrew → Import reads ONLY these out of a backup file (readHomebrewFile). */
export const BACKUP_HOMEBREW_SOURCES_KEY = 'wanderers-codex:homebrew-sources:v1';
export const BACKUP_HOMEBREW_CONTENT_KEY = 'wanderers-codex:homebrew-content:v1';
/** Items saved before homebrew had sources; loadHomebrewContent still folds them in. */
const LEGACY_HOMEBREW_ITEMS_KEY = 'wanderers-codex:homebrew-items:v1';

export interface BackupEnvelope {
  app: typeof BACKUP_APP;
  kind: typeof BACKUP_KIND;
  formatVersion: number;
  savedAt: string;
  appVersion: string;
  /** Raw localStorage values, keyed by storage key. */
  data: Record<string, string>;
}

/** Keys a restore must always replace, so they're always present in an export — even when the
 *  source device never wrote them (fresh install). Without this, restoring a near-empty device's
 *  backup onto a used one would keep the old roster/homebrew/settings instead of replacing them.
 *  The empty-string entries (prefs, appearance, active-character-id) have no meaningful "empty"
 *  default — they're listed so a restore CLEARS them when the backup omits them (see restoreBackup),
 *  but a '' value is skipped on write so we don't materialize a bogus key. */
const ALWAYS_KEYS: Record<string, string> = {
  'wanderers-codex:roster:v1': '[]',
  [BACKUP_HOMEBREW_SOURCES_KEY]: '{}',
  [BACKUP_HOMEBREW_CONTENT_KEY]: '{}',
  'wanderers-codex:modes:v1': '{}',
  'wanderers-codex:active:v1': '',
  'pf2e-codex.prefs': '',
  'pf2e-codex.appearance': '',
  'pf2e-codex.customization': '',
};

/** Every localStorage key this app owns and a restore must clear before writing, so "replace
 *  everything" truly replaces (a target-device-only key — e.g. a pref or appearance the backup
 *  never wrote — must not survive the restore). Any key present in the backup is written on top;
 *  ALWAYS_KEYS names the ones that may be absent from the backup yet must still be cleared.
 *
 *  `pf2e-` covers BOTH the app's own `pf2e-codex.*` keys AND the embedded initiative tracker's
 *  `pf2e-*` keys (pf2e-parties, pf2e-settings, pf2e-encounters, pf2e-custom-creatures/-conditions/
 *  -themes, pf2e-disabled-sources, pf2e-encounter-tables, pf2e-gm-layout, pf2e-dm-turn-average,
 *  pf2e-current-combat, …) — so the tracker's data rides HH's one Backup/Restore instead of its own.
 *  Deliberately NOT `sb-` (Supabase auth) so a restore never signs the user out. */
export const APP_KEY_PREFIXES = ['wanderers-codex:', 'pf2e-'];
function isAppKey(key: string): boolean {
  return APP_KEY_PREFIXES.some((p) => key.startsWith(p));
}

/** Serialize everything the app has stored on this device into one backup-file JSON string. */
export function createBackup(now = new Date()): string {
  const data: Record<string, string> = { ...ALWAYS_KEYS };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null) continue;
      const value = localStorage.getItem(key);
      if (value !== null) data[key] = value;
    }
  } catch {
    // storage unavailable — export just the (empty) required keys
  }
  const envelope: BackupEnvelope = {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    formatVersion: BACKUP_FORMAT_VERSION,
    savedAt: now.toISOString(),
    appVersion: APP_VERSION,
    data,
  };
  return JSON.stringify(envelope, null, 2);
}

/** YYYY-MM-DD in the device's local time. */
function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** heroes-heaven-backup-YYYY-MM-DD.json (local date). */
export function backupFilename(now = new Date()): string {
  return `heroes-heaven-backup-${localDate(now)}.json`;
}

/** heroes-heaven-homebrew-YYYY-MM-DD.json (local date) — the Homebrew page's Export. */
export function homebrewFilename(now = new Date()): string {
  return `heroes-heaven-homebrew-${localDate(now)}.json`;
}

/** The whole text of every file Homebrew → Export saved from v0.1.9 until 2026-10: the export handed
 *  downloadText its two arguments the wrong way round, so the file was NAMED after the JSON and HELD
 *  only its own intended name. Such a file carries no homebrew at all. */
export const OLD_EMPTY_HOMEBREW_EXPORT = 'heroes-heaven-homebrew.json';

/** The `kind` of a Homebrew → Export file (its `app` is BACKUP_APP). */
export const HOMEBREW_EXPORT_KIND = 'homebrew';

/** What Homebrew → Import found in a file. */
export type HomebrewFileRead =
  | {
      /** 'export' = a Homebrew → Export file; 'backup' = a Settings → "Export everything" file, of which
       *  only the homebrew was read. */
      from: 'export' | 'backup';
      sources: Record<string, HomebrewSource>;
      content: Partial<HomebrewContent>;
    }
  | { from: 'old-empty-export' };

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One stored value of a backup, parsed; {} when absent or unreadable. */
function backupObject(data: Record<string, string>, key: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(data[key] ?? '');
    return isPlainObject(v) ? v : {};
  } catch {
    return {};
  }
}

/** A file that IS a Heroes Heaven backup but that this version can't read (a newer format version, no
 *  data section). Its message is parseBackup's own, for the player: "Update the app, then try again"
 *  is the truth about such a file — "not a homebrew export or backup" is not. */
export class UnreadableBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableBackupError';
  }
}

/** Read a file handed to Homebrew → Import: a homebrew export, OR a full backup — from which ONLY the
 *  homebrew sources and content are taken (nothing else in it is returned, so nothing else can be
 *  written; a full Restore stays the one way to replace everything) — OR the empty file older versions
 *  saved. Throws UnreadableBackupError for a backup this version can't read, and an Error when the file
 *  is none of these. */
export function readHomebrewFile(text: string): HomebrewFileRead {
  if (text.trim() === OLD_EMPTY_HOMEBREW_EXPORT) return { from: 'old-empty-export' };
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!isPlainObject(obj)) throw new Error('That file is not a homebrew export.');
  if (obj.app === BACKUP_APP && obj.kind === BACKUP_KIND) {
    let env: BackupEnvelope;
    try {
      env = parseBackup(text);
    } catch (e) {
      throw new UnreadableBackupError((e as Error).message);
    }
    const content = backupObject(env.data, BACKUP_HOMEBREW_CONTENT_KEY) as Partial<HomebrewContent>;
    // An old device may still hold items under the pre-sources key; loadHomebrewContent folds them in
    // the same way (the newer key wins).
    const legacy = backupObject(env.data, LEGACY_HOMEBREW_ITEMS_KEY) as HomebrewContent['items'];
    if (Object.keys(legacy).length) content.items = { ...legacy, ...(isPlainObject(content.items) ? content.items : {}) };
    return {
      from: 'backup',
      sources: backupObject(env.data, BACKUP_HOMEBREW_SOURCES_KEY) as Record<string, HomebrewSource>,
      content,
    };
  }
  // A homebrew export says so: every file Homebrew → Export ever wrote with its homebrew in it carries
  // kind 'homebrew' (the 27-byte files before that are told apart above). A top-level `content` alone
  // proves nothing — the sheet's own Wanderer's Guide character export is { version, character, content }.
  if (obj.kind !== HOMEBREW_EXPORT_KIND || (obj.app !== undefined && obj.app !== BACKUP_APP)) {
    throw new Error('That file is not a homebrew export.');
  }
  if (!isPlainObject(obj.sources) && !isPlainObject(obj.content)) throw new Error('That file is not a homebrew export.');
  return {
    from: 'export',
    sources: (isPlainObject(obj.sources) ? obj.sources : {}) as Record<string, HomebrewSource>,
    content: (isPlainObject(obj.content) ? obj.content : {}) as Partial<HomebrewContent>,
  };
}

/** Parse + validate a backup file. Throws an Error with a user-facing message when it isn't one of ours. */
export function parseBackup(text: string): BackupEnvelope {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const env = obj as Partial<BackupEnvelope> | null;
  if (!env || typeof env !== 'object' || env.app !== BACKUP_APP || env.kind !== BACKUP_KIND) {
    throw new Error('That file is not a Heroes Heaven backup. Expected a file made with Settings → Backup → “Export everything”.');
  }
  if (env.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `This backup uses format version ${env.formatVersion}, but this app understands version ${BACKUP_FORMAT_VERSION}. Update the app, then try again.`,
    );
  }
  if (!env.data || typeof env.data !== 'object' || Array.isArray(env.data)) {
    throw new Error('This backup file has no data section — it may be corrupted.');
  }
  return env as BackupEnvelope;
}

/** How many (non-archived + archived) characters a backup's roster holds; null if unreadable. */
export function backupCharCount(env: BackupEnvelope): number | null {
  try {
    const roster = JSON.parse(env.data['wanderers-codex:roster:v1'] ?? '');
    return Array.isArray(roster) ? roster.length : null;
  } catch {
    return null;
  }
}

/** Atomically replace this app's stored data with the backup's. Snapshots every app-owned key,
 *  clears them (so target-device-only keys — a pref/appearance the backup never wrote — don't
 *  survive), then writes the backup's keys (unknown keys included, for forward compat). If ANY write
 *  throws (e.g. quota), the whole app-owned storage is rolled back to the pre-restore snapshot and a
 *  clear Error is rethrown, so a mid-restore failure can never leave a half-restored roster with
 *  dangling homebrew/mode references. The caller reloads only on success. Returns keys written. */
export function restoreBackup(env: BackupEnvelope): number {
  // BEFORE ANY KEY MOVES: tell the GM-device mirror its per-key history is void. It holds those stamps
  // in memory as well as on disk, so clearing the file below settles nothing on its own — any later
  // save (a pending push, the teardown flush) writes the pre-restore copy straight back out, and the
  // mirror then reads each restored key as one it has already reconciled: the cloud's copy is skipped
  // for good, and a key the backup left out never comes back. See forgetTrackerSyncStamps.
  notifyReset();
  // Snapshot current app-owned values so we can roll back on any failure.
  const snapshot: Record<string, string> = {};
  const clearKeys = new Set<string>(Object.keys(ALWAYS_KEYS)); // always cleared, even if absent from backup
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null || !isAppKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) snapshot[key] = value;
    clearKeys.add(key);
  }

  // The values to write: every backup key with a real string value ('' placeholders from ALWAYS_KEYS
  // are treated as "no value" — the key stays cleared rather than materializing an empty entry).
  const toWrite: [string, string][] = [];
  for (const [key, value] of Object.entries(env.data)) {
    if (typeof value !== 'string' || value === '') continue; // tolerate a hand-edited file / skip placeholders
    // …except the mirror's stamps, which a backup snapshots like everything else. They are that
    // device's conversation with the cloud AT EXPORT TIME: restored on Friday, Monday's stamps say the
    // cloud has moved on, so the next pull replaces the data the user just restored. Left out, every
    // key meets the cloud as first contact and is UNIONED with it instead.
    if (key.startsWith(TRACKER_SYNC_STAMP_PREFIX)) continue;
    toWrite.push([key, value]);
  }

  const rollback = () => {
    try {
      for (const key of clearKeys) localStorage.removeItem(key);
      for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value);
    } catch {
      // Best-effort: storage is already misbehaving; nothing more we can safely do.
    }
  };

  try {
    for (const key of clearKeys) localStorage.removeItem(key);
    let written = 0;
    for (const [key, value] of toWrite) {
      localStorage.setItem(key, value);
      written++;
    }
    return written;
  } catch (e) {
    rollback();
    throw new Error(
      `Restore failed partway through (${(e as Error).message || 'storage error'}); your existing data was left unchanged. ` +
        'Free up space and try again.',
    );
  }
}
