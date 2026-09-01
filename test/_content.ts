import { readFileSync } from 'node:fs';
import { seedContent } from '../src/rules/seed';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';
import { findDuplicateIds } from '../src/data';

/**
 * Load the imported game data (public/core.json) merged with the seed, exactly as
 * the app does at runtime (src/data/index.ts), so tests exercise the real content.
 * Cached across the suite.
 */
let cached: ContentDatabase | null = null;
export function content(): ContentDatabase {
  if (cached) return cached;
  const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as Record<string, Record<string, unknown>>;
  /*
   * Descriptions ship in a SECOND file (61% of the data, and nobody reads one until they open it), so
   * the app fetches them in parallel and writes them back onto the same records. Tests do the same
   * thing synchronously — which also makes every description-reading test a check that the split is
   * lossless: if a record went missing on the way out or back, dozens of assertions notice.
   */
  const desc = JSON.parse(readFileSync('public/core-descriptions.json', 'utf8')) as Record<string, Record<string, { d?: string; r?: unknown }>>;
  for (const [bucket, records] of Object.entries(desc)) {
    const target = core[bucket] as Record<string, Record<string, unknown>> | undefined;
    if (!target) continue;
    for (const [id, v] of Object.entries(records)) {
      const rec = target[id];
      if (!rec) continue;
      if (v.d !== undefined) rec.description = v.d;
      if (v.r !== undefined) rec.descRefs = v.r;
    }
  }
  const merged: Record<string, unknown> = {};
  // Union of seed + core keys, so core-only catalogs (companionSpecializations, followers, pets)
  // are included just like the app's mergeWithSeed does.
  for (const k of new Set([...Object.keys(seedContent), ...Object.keys(core)])) {
    merged[k] = { ...((seedContent as Record<string, Record<string, unknown>>)[k] ?? {}), ...(core[k] ?? {}) };
  }
  cached = merged as ContentDatabase;
  // Same duplicate-scrape suppression the app computes in mergeWithSeed, using the SAME function, so
  // tests see the lists the user actually sees.
  cached.duplicateIds = findDuplicateIds(cached);
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

/**
 * The picker that carries a record's GRANTS, whichever lane it lives on.
 *
 * A record asks its question in one of two places, and which one is not a free choice: an
 * `effectChoices` answer is stored once per RECORD, so a REPEATABLE record must keep its pick on the
 * record's own `choice`, which is keyed by slot and therefore per TAKING. 21 records moved between the
 * two lanes when that was fixed, and every test that had hard-coded `effectChoices![0]` broke at once —
 * not because the behaviour changed, but because those tests were asserting the STORAGE rather than the
 * mechanic. Ask through here, and a record that legitimately moves lanes stays covered.
 */
export function grantPicker(
  rec: { effectChoices?: { id?: string; options?: { grant?: unknown }[] }[]; choice?: { options?: { grant?: unknown }[] } } | undefined,
): { id?: string; options?: { grant?: unknown }[] } | undefined {
  const fromEffect = (rec?.effectChoices ?? []).find((ec) => (ec.options ?? []).some((o) => o.grant));
  if (fromEffect) return fromEffect;
  return (rec?.choice?.options ?? []).some((o) => o.grant) ? rec!.choice : undefined;
}
