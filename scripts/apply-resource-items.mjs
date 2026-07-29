/*
 * Applies the ITEM half of the resource lane: per-day/per-hour activation limits and charge pools.
 *
 * ITEMS ONLY, on purpose. `frequency` and `counters` are read by src/rules/itemUses.ts, which turns
 * them into use pips on the inventory row. Nothing reads a FEAT's frequency — PlayState has no
 * per-day feat tracking at all — so the other 913 records in this lane are held back until that
 * exists (see the engine-gap task). Writing them now would raise the coverage number while giving
 * the player nothing to click.
 *
 * Usage: node scripts/apply-resource-items.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const PATH = 'public/core.json';
const CLASSIFIED = 'work/lane-resource-classified.json';

const db = JSON.parse(readFileSync(PATH, 'utf8'));
const rows = JSON.parse(readFileSync(CLASSIFIED, 'utf8')).filter((r) => r.limited);

const PERIODS = new Set(['round', 'minute', 'hour', 'day', 'week', 'month']);

/** Rows the hand-check overturned. Only 11 items got a counter, so every one was read against its
 *  own text — which is how these three were caught. */
const OVERRIDES = {
  // "a glass cube 50 FEET WIDE" was read as 50 activations. The item has no Frequency line at all.
  'aquarium-lamp': null,
  // "can hold up to 2 charges, and its charges reset to 0 when you invest it" — it BUILDS UP from
  // empty as you resist fear. resetsOnRest:true would hand the player 2 free charges every morning.
  'bravery-baldric': [{ id: 'charges', label: 'Charges', max: 2, resetsOnRest: false, startsFull: false }],
  'bravery-baldric-healthful-greater': [{ id: 'charges', label: 'Charges', max: 2, resetsOnRest: false, startsFull: false }],
  // "one of its eyes disappears" — a real 2-use pool, but the eyes are gone for good, not daily.
  'staring-skull': [{ id: 'eyes', label: 'Eyes', max: 2, resetsOnRest: false }],
};
/** ItemCounter.max is `number | 'level'`; the schema returned strings, so normalise or reject. */
const normMax = (v) => (String(v) === 'level' ? 'level' : Number(v));

const stats = { frequency: 0, counters: 0, skippedExisting: 0, skippedConsumable: 0, rejected: 0, missing: 0, overridden: 0 };
const rejected = [];

for (const row of rows) {
  const item = db.items?.[row.id];
  if (!item) { stats.missing++; continue; }
  // A single-use consumable is already tracked by QUANTITY; a counter on top would double-count.
  // (itemUses only synthesises a consumable counter when uses.max > 1, so match that rule here.)
  if (item.itemType === 'consumable' && !(item.uses && item.uses.max > 1)) { stats.skippedConsumable++; continue; }
  if (item.frequency || item.counters?.length) { stats.skippedExisting++; continue; }

  if (Object.prototype.hasOwnProperty.call(OVERRIDES, row.id)) {
    const ov = OVERRIDES[row.id];
    if (ov === null) { stats.overridden++; continue; }   // hand-check says: no limit at all
    item.counters = ov;
    stats.overridden++;
    stats.counters++;
    continue;
  }

  if (row.counters?.length) {
    const list = [];
    for (const c of row.counters) {
      const max = normMax(c.max);
      if (max !== 'level' && (!Number.isFinite(max) || max <= 0)) { rejected.push(`${row.id}: bad counter max '${c.max}'`); continue; }
      if (!c.id || !c.label) { rejected.push(`${row.id}: counter missing id/label`); continue; }
      list.push({ id: c.id, label: c.label, max, resetsOnRest: c.resetsOnRest !== false });
    }
    if (list.length) { item.counters = list; stats.counters++; continue; }
    stats.rejected++;
    continue;
  }

  if (row.frequency) {
    const { max, per } = row.frequency;
    if (!PERIODS.has(per) || !Number.isFinite(max) || max <= 0) {
      rejected.push(`${row.id}: bad frequency ${max}/${per}`);
      stats.rejected++;
      continue;
    }
    item.frequency = { max, per };
    stats.frequency++;
  }
}

console.log(`limited rows: ${rows.length}`);
console.log(`frequency ${stats.frequency} · counters ${stats.counters} · hand-overridden ${stats.overridden} · skipped-existing ${stats.skippedExisting} · skipped-consumable ${stats.skippedConsumable} · rejected ${stats.rejected} · missing ${stats.missing}`);
if (rejected.length) { console.log('REJECTED:'); rejected.slice(0, 10).forEach((r) => console.log('  ' + r)); }
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(PATH, JSON.stringify(db)); // minified — pretty-printing this file once cost 4 MB
console.log('\nwritten:', PATH);
