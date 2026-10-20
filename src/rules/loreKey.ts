import type { ProficiencyKey } from './types';

/**
 * A Lore subject → the `lore:<slug>` key that stores it, or null when nothing but the word "Lore" is
 * left. THE one keyer: every Lore the app names — typed by a player on any card, printed on a
 * background, listed on an apparition, read off a prerequisite or a Wanderer's Guide import — goes
 * through here, so the same subject can never become two Lores.
 *
 * There were two, and they disagreed: the builder cards stripped "lore" anywhere, the engine only a
 * trailing " lore", so "Lore of the Sea" typed on the Languages card and on a background trained
 * `lore:of-the-sea` and `lore:lore-of-the-sea`. "Lore of the Sea", "sea lore", "Sea Lore " and
 * "lore: sea" are all `lore:sea`. A key passes through unchanged ("lore:sea" → "lore:sea").
 * Measured over every printed Lore subject (514): none keys differently from the old engine keyer.
 *
 * Its own file (moved out of build.ts, 2026-10-20) so the book blocks (blocks/book.ts) can key a
 * background's printed Lore without importing the build — build.ts re-exports it, so every existing
 * `import { loreKey } from './build'` still works.
 */
export function loreKey(raw: string): ProficiencyKey | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/^(?:lore\b[\s:,-]*)+(?:of[\s-]+(?:the[\s-]+)?)?/, '')
    .replace(/\blore\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? (`lore:${slug}` as ProficiencyKey) : null;
}
