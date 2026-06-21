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
import type { Character, Item, ModeDef } from '../rules/types';
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

const HOMEBREW_ITEMS_KEY = 'wanderers-codex:homebrew-items:v1';

/** User-created custom items, keyed by item id. Merged into the content DB at load
 *  (see data/index.ts) so they resolve everywhere a real item would. */
export function loadHomebrewItems(): Record<string, Item> {
  try {
    const raw = localStorage.getItem(HOMEBREW_ITEMS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Item>) : {};
  } catch {
    return {};
  }
}

/** Persist (or update) a single custom item. */
export function saveHomebrewItem(item: Item): void {
  try {
    const all = loadHomebrewItems();
    all[item.id] = item;
    localStorage.setItem(HOMEBREW_ITEMS_KEY, JSON.stringify(all));
  } catch {
    // non-fatal
  }
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
