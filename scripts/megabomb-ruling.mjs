/*
 * MEGA BOMB — OWNER RULING, 2026-08-20: "it needs to be in the actions as a 2 action".
 *
 * The one record of the 99 whose action cost the printed text does not settle by itself, and the
 * evidence pointed three ways:
 *
 *   · OUR STORED VALUE was `1`, which matches nothing at all — not the feat, not the activity.
 *   · WANDERER'S GUIDE encodes NO cost: `ability_block.actions` is NULL for Mega Bomb and for all six
 *     of its additive siblings, while Quick Bomber in the same family reads `ONE-ACTION` — so the null
 *     is a statement, not missing data (6,709 of their 10,843 feat rows are null). Foundry agrees, and
 *     so do the six siblings, all of which are passive.
 *   · THE PRINTED TEXT carries exactly one number: *"Throwing this bomb takes a 2-action activity
 *     instead of a Strike. This isn't a Strike, and you don't make an attack roll."*
 *
 * WG and Foundry both make the FEAT passive because the 2 actions belong to throwing the bomb the
 * additive produced. But a passive Mega Bomb never reaches the encounter action list (MainTab filters
 * on `isActionCost`), so the only thing a player can actually DO with this feat would appear nowhere
 * on their turn. The owner ruled it must be in the actions, as a 2-action — which is also the one
 * number the book prints.
 *
 * ⚠ THIS DOES NOT GENERALISE TO THE SIX SIBLINGS. Smoke/Sticky/Debilitating/Healing/Exploitive Bomb
 * and Combine Elixirs print no activity cost of their own — the additive just changes the bomb — so
 * they stay passive. Mega Bomb is the only additive that replaces the Strike with a timed activity.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const edit = { category: 'feats', id: 'mega-bomb', field: 'actionCost', value: { type: 'actions', value: 2 } };

const rows = readBackfill(ROOT);
const at = rows.findIndex((r) => r.category === edit.category && r.id === edit.id && r.field === edit.field);
if (at >= 0) rows[at] = edit; else rows.push(edit);
writeBackfill(ROOT, rows);
console.log(`mega-bomb -> 2 actions (${at >= 0 ? 'updated in place' : 'added'}; ${rows.length} rows).`);
