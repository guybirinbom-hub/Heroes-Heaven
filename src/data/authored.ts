/*
 * WHAT THE PLAYER AUTHORED IN A SHEET — the part of a SavedChar a GM edit must never take from them.
 *
 * A built character's `character` object is a DERIVED cache: `rebuildRoster` (./rebuild.ts) re-derives
 * it from `build` at every launch and on every cloud adopt, so two copies of the same character can
 * differ there while the player has changed nothing at all. A load is not an edit, so that cache never
 * counts. What does count is exactly what survives a rebuild: `build`, `play`, and the few `character`
 * fields the engine never emits (`CARRIED_CHARACTER_FIELDS`). A character with no build (an import, a
 * legacy sheet) has nothing to re-derive from, so its whole `character` is the player's.
 *
 * The GM-edit channel compares sheets through this and nothing else (src/sheet/gmSync.ts →
 * `gmEditVerdict`, `pendingEditStandsOnFreshRead`, `gmUpdateBase`): a GM push records
 * `hash53(authoredKey(<the published sheet it read>))` in `gm_character_edits.gm_base.hash`, and the
 * player's app applies the push only while its own published sheet still has that hash. Content, never
 * a stamp — so a launch republish that moves `campaign_characters.updated_at` without changing anything
 * the player authored can never refuse a GM edit, and no comparison here needs any clock.
 *
 * No heavy imports: this is read by the party layer, the GM sheet and the player's applier alike.
 */

/** The `character` fields a player owns on a BUILT character; everything else on it is derived by
 *  buildCharacter and re-derived at every launch (rebuildRoster). `carryStoredOverrides` carries exactly
 *  these over a rebuild, and test/rebuild-sync.test.ts holds the two together. */
export const CARRIED_CHARACTER_FIELDS = ['customization', 'currency'] as const;

type SheetLike = { character?: unknown; build?: unknown; play?: unknown } | null | undefined;

/** What the PLAYER authored in a sheet: exactly what survives a launch rebuild. Never `id`/`archived`. */
export function authoredSheet(sc: SheetLike): unknown {
  if (!sc) return null;
  const ch = (sc.character ?? null) as Record<string, unknown> | null;
  if (sc.build != null)
    return {
      build: sc.build,
      play: sc.play ?? null,
      ...Object.fromEntries(CARRIED_CHARACTER_FIELDS.map((k) => [k, ch?.[k] ?? null])),
    };
  return { character: ch, play: sc.play ?? null };
}

/**
 * JSON with every object's keys in one order. `campaign_characters.sheet` is jsonb, which hands an
 * object's keys back in its OWN order, never the order they were written in — so a plain
 * `JSON.stringify` of the published sheet and of the very sheet that was pushed differ even when
 * every value is the same.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

/** `canonicalJson(authoredSheet(sc))` — the one string two sheets are compared by. */
export function authoredKey(sc: SheetLike): string {
  return canonicalJson(authoredSheet(sc));
}

/** cyrb53 (seed 0), 14 hex digits — deterministic in the browser, jiti and node alike. */
export function hash53(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
