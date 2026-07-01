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

const KEY = 'wanderers-codex:roster:v1';

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
  /** Capability ids this Source turns on when enabled on a character (e.g. ['monsterParts']).
   *  Lets a Source unlock a built-in subsystem, resolved by Source id so it survives renames. */
  unlocks?: string[];
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
}

/** Delete a source and every content entry that belonged to it. */
export function deleteHomebrewSource(id: string): void {
  try {
    const sources = loadHomebrewSources();
    delete sources[id];
    localStorage.setItem(HOMEBREW_SOURCES_KEY, JSON.stringify(sources));
    const content = loadHomebrewContent();
    for (const type of HOMEBREW_TYPES) {
      for (const [eid, entry] of Object.entries(content[type])) {
        if ((entry as { homebrewSourceId?: string }).homebrewSourceId === id) delete content[type][eid];
      }
    }
    localStorage.setItem(HOMEBREW_CONTENT_KEY, JSON.stringify(content));
  } catch {
    /* non-fatal */
  }
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
}

/** Persist (or update) one homebrew entry of the given type. */
export function saveHomebrewEntry<T extends HomebrewType>(type: T, entry: HomebrewContent[T][string]): void {
  const content = loadHomebrewContent();
  content[type][(entry as { id: string }).id] = entry;
  saveHomebrewContent(content);
}

/** Remove a homebrew entry. */
export function deleteHomebrewEntry(type: HomebrewType, id: string): void {
  const content = loadHomebrewContent();
  delete content[type][id];
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
