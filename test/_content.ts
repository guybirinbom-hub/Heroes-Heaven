import { readFileSync } from 'node:fs';
import { seedContent } from '../src/rules/seed';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Load the imported game data (public/core.json) merged with the seed, exactly as
 * the app does at runtime (src/data/index.ts), so tests exercise the real content.
 * Cached across the suite.
 */
let cached: ContentDatabase | null = null;
export function content(): ContentDatabase {
  if (cached) return cached;
  const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as Record<string, Record<string, unknown>>;
  const merged: Record<string, unknown> = {};
  // Union of seed + core keys, so core-only catalogs (companionSpecializations, followers, pets)
  // are included just like the app's mergeWithSeed does.
  for (const k of new Set([...Object.keys(seedContent), ...Object.keys(core)])) {
    merged[k] = { ...((seedContent as Record<string, Record<string, unknown>>)[k] ?? {}), ...(core[k] ?? {}) };
  }
  cached = merged as ContentDatabase;
  return cached;
}

const c = () => content();
const anc = () => Object.keys(c().ancestries)[0];
const bg = () => Object.keys(c().backgrounds)[0];

/** The first subclass option id for a class, if any. */
export function firstSubclass(classId: string): string | null {
  return (c().classes[classId]?.subclass?.options[0]?.id as string) ?? null;
}

/** Build a character for `classId` at `level` with a minimal valid build + overrides. */
export function build(classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = c().classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: anc(),
      backgroundId: bg(),
      // Mirror the app (changeClass): a fixed key only when the class has exactly one;
      // otherwise null so an extra-choice (e.g. psychic subconscious mind) can set it.
      keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: firstSubclass(classId),
      ...over,
    },
    c(),
  );
}

/** The proficiency rank of a track on a built character. */
export function prof(ch: Character, track: string): string | undefined {
  if (track === 'perception') return ch.proficiencies.perception;
  if (track === 'classDc') return ch.proficiencies.classDc;
  if (['fortitude', 'reflex', 'will'].includes(track)) return ch.proficiencies.saves[track as 'fortitude'];
  if (['unarmed', 'simple', 'martial', 'advanced'].includes(track)) return ch.proficiencies.attacks[track as 'simple'];
  if (['unarmored', 'light', 'medium', 'heavy'].includes(track)) return ch.proficiencies.defenses[track as 'light'];
  if (['bomb', 'firearm', 'crossbow'].includes(track)) return ch.proficiencies.weaponGroups?.[track];
  if (track === 'spellcasting') return ch.spellcasting.find((s) => s.type !== 'focus')?.proficiency;
  return undefined;
}

/** The character's primary (non-focus) spellcasting entry. */
export function mainCasting(ch: Character) {
  return ch.spellcasting.find((s) => s.type === 'prepared' || s.type === 'spontaneous');
}
