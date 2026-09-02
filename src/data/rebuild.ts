import { applyOverrides, buildCharacter } from '../rules/build';
import type { ContentDatabase } from '../rules/types';
import type { SavedChar } from './storage';

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
 */
export function rebuildRoster(roster: SavedChar[], content: ContentDatabase): SavedChar[] {
  return roster.map((c) => {
    if (!c.build) return c;
    try {
      const fresh = buildCharacter(c.build, applyOverrides(content, c.build.overrides));
      const carried = c.character.customization !== undefined ? { customization: c.character.customization } : {};
      return { ...c, character: { ...fresh, ...carried } };
    } catch (e) {
      console.warn(`[HeavesRebuild] kept the stored snapshot for "${c.character?.name ?? c.id}" — rebuild threw:`, e);
      return c;
    }
  });
}
