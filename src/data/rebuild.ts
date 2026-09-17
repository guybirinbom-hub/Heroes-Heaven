import { applyOverrides, buildCharacter } from '../rules/build';
import type { Character, ContentDatabase } from '../rules/types';
import type { SavedChar } from './storage';

/**
 * Fields the engine derives fresh on every build/rebuild but does NOT own: they live only on the
 * stored character until something else (Play mode, the player) sets them, so a fresh build's
 * default must never stomp them. Used by every site that replaces a stored `character` wholesale
 * with a freshly built one — `rebuildRoster` below, the builder's Save path (App.tsx), and the GM
 * edit save (GmEditSheet.tsx). `stored` is the roster/working-copy character being replaced; when
 * there is none (a brand-new character), `fresh` is returned untouched — a new character starting
 * at the build's own defaults (0 gold) is correct, there is nothing to carry.
 */
export function carryStoredOverrides(fresh: Character, stored: Character | undefined): Character {
  if (!stored) return fresh;
  const carried: { customization?: Character['customization']; currency?: Character['currency'] } = {};
  if (stored.customization !== undefined) carried.customization = stored.customization;
  if (stored.currency !== undefined) carried.currency = stored.currency;
  return { ...fresh, ...carried };
}

/**
 * Re-derive every character from its build against the CURRENT engine and data.
 *
 * The stored `character` is a derived cache; it is refreshed here once per launch and again whenever a
 * roster pulled from the cloud is adopted (that copy was derived by whichever app version last saved
 * it). Play state is untouched. A rebuild that throws keeps the stored snapshot. Fields the engine does
 * not derive but the player owns on the character (`customization` — per-sheet zoom and layout) are
 * carried over, because `buildCharacter` never emits them and a plain replacement dropped them.
 *
 * ⚠ The caller must register the result with cloud sync as a DERIVED refresh (`noteDerivedRefresh`),
 * never let it count as an edit — see cloudSync.ts for the two-device data loss that taught this.
 *
 * `currency` is carried over too, same as `customization`: buildCharacter's starting purse is a flat
 * 0 for every build now (new characters start with no gold), so there is nothing left for a refresh to
 * correct — and any real wallet a character was given outside the build (an import) lives here until
 * Play mode's own `play.currency` takes over, so overwriting it on every launch would just erase it.
 */
export function rebuildRoster(roster: SavedChar[], content: ContentDatabase): SavedChar[] {
  return roster.map((c) => {
    if (!c.build) return c;
    try {
      const fresh = buildCharacter(c.build, applyOverrides(content, c.build.overrides));
      return { ...c, character: carryStoredOverrides(fresh, c.character) };
    } catch (e) {
      console.warn(`[HeavesRebuild] kept the stored snapshot for "${c.character?.name ?? c.id}" — rebuild threw:`, e);
      return c;
    }
  });
}
