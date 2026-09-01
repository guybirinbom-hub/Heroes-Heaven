/*
 * ORDER MAGIC — a repeatable feat whose pick was stored ONCE for every taking.
 *
 * *"You gain the initial order spell from that order. **Special** You can take this feat multiple
 * times. Each time you do, you must choose a different order you have selected with Order Explorer."*
 *
 * The record carried the question TWICE: an `effectChoices` picker holding the nine orders and their
 * focus-spell grants, and its own `choice` holding the same nine orders and no grants. `effectChoices`
 * answers are stored per RECORD, so a druid who took the feat three times answered three pickers that
 * all wrote to one key and received ONE order spell. The record's own `choice` is the per-TAKING one —
 * keyed by slot — so the grants move there, which is also the shape `repeatable-pick-check.mjs` names
 * as the fix for the other 34 picks in the same state.
 *
 * Three things the printed text asks for, and one it does not:
 *   · the grant per option           → `choice.options[].grant.focusSpells`
 *   · "a different order each time"  → `distinctAcrossTakes`
 *   · "an order you have SELECTED with Order Explorer" → `limitToAnswersOf`
 *   · the duplicate `effectChoices` is removed — two pickers for one sentence is the defect ruling Q9
 *     names on Battle Harbinger, where the player answered the right question and got nothing for it.
 *
 *   node scripts/backfill-order-magic-per-taking.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const rec = core.feats['order-magic'];
if (!rec) { console.error('order-magic is not in core.json'); process.exit(2); }

/* The nine orders and their initial spells, taken from the record's OWN effectChoices — the grants are
 * already correct, they were merely stored where a repeat take could not reach them. */
const grants = new Map();
for (const ec of rec.effectChoices ?? []) {
  for (const o of ec.options ?? []) if (o.grant?.focusSpells?.length) grants.set(o.value, o.grant.focusSpells);
}
if (grants.size !== 9) { console.error(`expected 9 order grants, found ${grants.size}`); process.exit(2); }

const options = (rec.choice?.options ?? []).map((o) => {
  const focusSpells = grants.get(o.value);
  if (!focusSpells) { console.error(`no grant for choice option ${o.value}`); process.exit(2); }
  return { ...o, grant: { focusSpells } };
});
if (options.length !== 9) { console.error(`expected 9 choice options, found ${options.length}`); process.exit(2); }

const ROWS = [
  {
    category: 'feats',
    id: 'order-magic',
    field: 'choice',
    value: {
      ...rec.choice,
      prompt: 'Order — you gain its initial order spell',
      distinctAcrossTakes: true,
      limitToAnswersOf: 'order-explorer',
      options,
    },
  },
  /* `value: null` REMOVES the field (see apply-backfill.mjs) — the duplicate picker goes away rather
   * than staying as a second, per-record question that quietly overwrites itself. */
  { category: 'feats', id: 'order-magic', field: 'effectChoices', value: null },
];

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
console.log(`order-magic: ${options.length} options carry their grant; ${added} new row(s), ${replaced} replaced.`);
if (!WRITE) { console.log('(report only — pass --write to author)'); process.exit(0); }
writeBackfill(ROOT, rows);
console.log(`wrote ${rows.length} rows.`);
