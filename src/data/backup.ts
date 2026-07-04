/*
 * Whole-device backup & restore (Settings → Backup).
 *
 * The app owns its entire storage origin (a dedicated Tauri webview, or its own dev-server port —
 * same reasoning as wipeAllData in storage.ts), so a backup simply snapshots EVERY localStorage
 * key into one versioned JSON envelope, and a restore writes those raw values back. Keys are kept
 * as opaque strings: a backup made by a newer build round-trips through an older one untouched.
 */
import { APP_VERSION } from '../version';

export const BACKUP_APP = 'heroes-heaven';
export const BACKUP_KIND = 'full-backup';
export const BACKUP_FORMAT_VERSION = 1;

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
  'wanderers-codex:homebrew-sources:v1': '{}',
  'wanderers-codex:homebrew-content:v1': '{}',
  'wanderers-codex:modes:v1': '{}',
  'wanderers-codex:active:v1': '',
  'pf2e-codex.prefs': '',
  'pf2e-codex.appearance': '',
};

/** Every localStorage key this app owns and a restore must clear before writing, so "replace
 *  everything" truly replaces (a target-device-only key — e.g. a pref or appearance the backup
 *  never wrote — must not survive the restore). Any key present in the backup is written on top;
 *  ALWAYS_KEYS names the ones that may be absent from the backup yet must still be cleared. */
export const APP_KEY_PREFIXES = ['wanderers-codex:', 'pf2e-codex.'];
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

/** heroes-heaven-backup-YYYY-MM-DD.json (local date). */
export function backupFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `heroes-heaven-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
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
