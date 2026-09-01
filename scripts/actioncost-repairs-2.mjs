/*
 * THE 99 RECORDS AoN'S BADGE COULD NOT SETTLE, ADJUDICATED FROM THE PRINTED TEXT.
 *
 * `scripts/actioncost-vs-aon.mjs` reports one sound direction only — "we say none, AoN says action" —
 * because a BLANK action badge is not AoN saying "no cost", it is equally a scrape that lost the
 * glyph. That left 99 records carrying a cost the badge could not confirm. The badge cannot decide
 * them; the printed text can, and this is the result of reading all 99.
 *
 * Method: 8 readers over the printed text of every record (ours and AoN's), each ruling keep/change
 * with a quoted sentence; every proposed CHANGE then faced three independent refuters — printed text,
 * activity markers, page identity — briefed to default to "refuted". 110 agents, 99/99 read.
 *   65 keep · 34 changes proposed · 31 survived refutation · 3 refuted.
 *
 * Then cross-checked against FOUNDRY's pf2e data, which none of the agents' reasoning depended on:
 * 29 of 31 agreed outright. The two that did not were read by hand and are corrected here:
 *
 *   · worm-caller-dedication — agents said `reaction`; Foundry says passive; PASSIVE is right. The
 *     text is *"You gain the Shake It Off reaction"* and our record already carries
 *     `grantsActions: ['shake-it-off']`, with `actions/shake-it-off` shipped as a reaction. Storing
 *     `reaction` on the dedication would put the same reaction on the sheet twice.
 *   · ascend — agents said `1`; Foundry says passive; `1` is right FOR OUR SCHEMA. The printed text is
 *     explicit — *"Once per day AS A SINGLE ACTION, you can fly at incredible speeds"* — and unlike
 *     Foundry we do not ship that burst as a separate record, so `passive` would delete the only route
 *     a player has to it. Stored `2` matched nothing at all.
 *
 * THE DOMINANT PATTERN, 27 of the 31: a feat that GRANTS something, or MODIFIES another action, was
 * storing that other thing's cost as its own. *"You can spend 2 actions to Direct your Follower
 * instead of 1"* (Tactical Guidance, Companion's Cry) — the 2 belongs to Direct your Follower. *"When
 * you transform using Monstrosity Shape, you can take on a kaiju form"* (Heart of the Kaiju) — the
 * stored `1` was the kaiju's own jaws Strike glyph, and every sibling in that Wild Shape family was
 * already passive. The six alchemist ADDITIVES (smoke/healing/sticky/debilitating/exploitive bomb,
 * combine elixirs) were free actions in their LEGACY printing and became additives in the Remaster,
 * applied as part of Quick Alchemy with no action of their own — the same legacy-vs-remaster drift
 * that had Mercy and Cruelty stored as single-action metamagics.
 *
 * ⚠ THREE PROPOSALS WERE REFUTED AND ARE NOT APPLIED — soothing-pulse (keeps 2), tengu-feather-fan
 * (keeps 1), mega-bomb (keeps 1). The first two are the mirror image of the pattern above: the feat
 * grants an activity we do NOT ship separately (Administer Ambient Magic, two actions; Activate—Wave
 * Fan, single action, both quoted from the pristine mirror), so the cost on the feat is the only route
 * a player has to it. Foundry marks both passive because Foundry ships the granted thing as its own
 * item — a difference in schema, not in rules.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const cost = (v) =>
  v === 'passive' || v === 'free' || v === 'reaction'
    ? { type: v }
    : { type: 'actions', value: Number(v) };

/** id -> the correct cost, as adjudicated. */
const RULINGS = {
  /* grants or modifies another action; the stored cost was that other thing's */
  'heart-of-the-kaiju': 'passive',
  'spellshot-dedication': 'passive',
  'shape-of-the-cloud-dragon': 'passive',
  'expand-spiral': 'passive',
  'worm-caller-dedication': 'passive',
  'companions-cry': 'passive',
  'buzzing-death-cicadas': 'passive',
  'instinctive-strike': 'passive',
  'dual-weapon-reload': 'passive',
  'chemical-contagion': 'passive',
  'improvised-pummel': 'passive',
  'morphic-strike': 'passive',
  'archfiend-dedication': 'passive',
  'manipulate-realm': 'passive',
  'assume-godhood': 'passive',
  'pact-of-the-fey-paths': 'passive',
  'venture-gossip-dedication': 'passive',
  'tactical-guidance': 'passive',
  'i-am-the-weapon': 'passive',
  'thaumaturges-demesne': 'passive',
  'talons-mark': 'passive',
  'aristocratic-arms': 'passive',
  'avenger-of-lust': 'passive',
  'avenger-of-wrath': 'passive',
  /* the six alchemist additives — free actions in the legacy printing, additives in the Remaster */
  'smoke-bomb': 'passive',
  'healing-bomb': 'passive',
  'combine-elixirs': 'passive',
  'debilitating-bomb': 'passive',
  'sticky-bomb': 'passive',
  'exploitive-bomb': 'passive',
  /* the one record whose printed text names a cost of its own */
  ascend: '1',
};

const rows = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const [id, v] of Object.entries(RULINGS)) {
  const e = { category: 'feats', id, field: 'actionCost', value: cost(v) };
  const at = rows.findIndex((r) => r.category === 'feats' && r.id === id && r.field === 'actionCost');
  if (at >= 0) { rows[at] = e; updated++; } else { rows.push(e); added++; }
}
writeBackfill(ROOT, rows);
console.log(`${Object.keys(RULINGS).length} ruling(s): ${added} added, ${updated} updated in place (${rows.length} rows).`);
