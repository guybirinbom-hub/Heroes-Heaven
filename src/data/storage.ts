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
  Feat,
  Heritage,
  Item,
  ModeDef,
  Spell,
} from '../rules/types';
import { normalizeCharacter, normalizePlay } from '../rules/normalize';
import { loadSettingsUpdated, markLocalDataChanged, saveSettingsUpdated } from './syncBus';
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
}

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

/** A deep copy of a saved character with a fresh roster id, a "(Copy)" name, and unarchived. */
export function duplicateChar(c: SavedChar): SavedChar {
  const copy: SavedChar = structuredClone(c);
  copy.id = newRosterId();
  copy.character = { ...copy.character, name: `${copy.character.name} (Copy)` };
  copy.archived = false;
  return copy;
}

export const ROSTER_KEY = 'wanderers-codex:roster:v1';
const KEY = ROSTER_KEY;

export function loadRoster(): SavedChar[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    // Drop structurally-broken entries (interrupted write / external edit) and normalize the
    // survivors so a legacy or hand-edited character can't crash the roster on render.
    return parsed
      .filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && e.character && typeof e.character === 'object')
      .map((e) => ({ ...e, character: normalizeCharacter(e.character), play: e.play ? normalizePlay(e.play) : undefined }));
  } catch {
    return [];
  }
}

/** Result of a save attempt: `true` on success, `false` when storage rejected it (e.g. quota). */
export function saveRoster(roster: SavedChar[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(roster));
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

/** Last-resort recovery: wipe the persisted roster + active id (e.g. a corrupt save crashing on load). */
export function clearRoster(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // ignore
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
];

const HOMEBREW_SOURCES_KEY = 'wanderers-codex:homebrew-sources:v1';
const HOMEBREW_CONTENT_KEY = 'wanderers-codex:homebrew-content:v1';
const LEGACY_HOMEBREW_ITEMS_KEY = 'wanderers-codex:homebrew-items:v1';

function emptyHomebrewContent(): HomebrewContent {
  return { items: {}, feats: {}, spells: {}, ancestries: {}, heritages: {}, backgrounds: {}, actions: {} };
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
}

/** Remove a homebrew entry. */
export function deleteHomebrewEntry(type: HomebrewType, id: string): void {
  const content = loadHomebrewContent();
  delete content[type][id];
  recordTombstoneKeys([`hb:${type}:${id}`]); // so the union merge won't resurrect it
  saveHomebrewContent(content);
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
  // resurrect it from another device), and a re-added one clears its tombstone.
  const nextIds = new Set(list.map((m) => m.id));
  const removed = loadCampaigns()
    .filter((m) => !nextIds.has(m.id))
    .map((m) => `camp:${m.id}`);
  try {
    localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(list));
  } catch {
    // non-fatal
  }
  if (removed.length) recordTombstoneKeys(removed);
  recordReviveKeys(list.map((m) => `camp:${m.id}`));
  markLocalDataChanged(); // campaign memberships are synced — nudge cloud upload
}

/** Permanently erase ALL of this app's locally-stored data: every saved character, homebrew item,
 *  custom mode, theme/zoom preference, and any other setting. The app owns its storage origin
 *  (a dedicated Tauri webview, or its own dev-server port), so clearing localStorage wipes only
 *  this app's data and nothing else. Returns the number of storage keys removed. IRREVERSIBLE —
 *  only call behind an explicit, typed user confirmation. */
export function wipeAllData(): number {
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

const PREFS_KEY = 'pf2e-codex.prefs';
const APPEARANCE_KEY = 'pf2e-codex.appearance';

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
 *  — NOT device-global prefs/appearance. Used when a different account signs in on this browser. */
export function wipeSyncedLocalData(): void {
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
  ]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* non-fatal */
    }
  }
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
  /** Device settings (customization prefs + appearance) — synced last-write-wins via settingsUpdated. */
  settings?: { prefs?: unknown; appearance?: unknown };
  settingsUpdated?: number;
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
  if (b.settings?.appearance !== undefined) {
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(b.settings.appearance));
    } catch {
      /* non-fatal */
    }
  }
  if (b.settingsUpdated) saveSettingsUpdated(b.settingsUpdated);
  if (b.lastDevice || b.lastEditedAt) saveSyncMeta({ lastDevice: b.lastDevice, lastEditedAt: b.lastEditedAt });
}
