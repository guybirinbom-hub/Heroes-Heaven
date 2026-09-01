/*
 * REVERT — the champion's devotion spell was already built, and better than the row this script added.
 *
 * The trail: Mercy's `spellNotes` clause names `lay-on-hands`, and the guard in
 * test/spell-notes.test.tsx failed with "does not grant lay-on-hands". Searching core.json for records
 * granting that spell found only two archetype feats, and `classFeatures/devotion-spells` was an empty
 * record — so it looked like a champion never got their signature spell at all.
 *
 * That reading was wrong, and the mistake is worth recording because it is the same one this project
 * keeps making in reverse: I probed a built champion for `entry.focusSpells` / `entry.spells`, got
 * `undefined`, and concluded "empty". A focus entry stores its spells under `repertoire`. Read
 * properly, a level-5 champion already had Shields of the Spirit and a 1-point focus pool.
 *
 * What actually grants it is a dedicated lane in build.ts — `championDevotionOptions` /
 * `championDevotionSpell` — which offers Shields of the Spirit always, Lay on Hands if the deity's
 * divine font allows *heal*, and Touch of the Void if it allows *harm*, resolving the player's
 * `build.devotionSpell` pick. That is the printed rule including the font gate, which the
 * `effectChoices` row added here did NOT enforce; and because the row GRANTS rather than SELECTS, a
 * champion who used it came out with two devotion spells and a 2-point pool.
 *
 * The row is removed. Nothing else here is needed: the feature works.
 *
 * Kept as a script rather than deleted so the next search for "champion devotion spell" finds this
 * note instead of repeating the walk.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const rows = readBackfill(ROOT);
const before = rows.length;
const kept = rows.filter(
  (r) => !(r.category === 'classFeatures' && r.id === 'devotion-spells' && r.field === 'effectChoices'),
);
writeBackfill(ROOT, kept);
console.log(`effect-backfill.json: removed ${before - kept.length} row(s) (${kept.length} rows).`);
