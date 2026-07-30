/*
 * How much of the "examined" set is actually JUSTIFIED?
 *
 * triage-mechanics.mjs sorts every record into modelled / examined / TO DO. "modelled" is provable —
 * the id is in a registry or the record carries the field. "TO DO" is honest — it says work remains.
 * "examined" is the one that can lie: it means somebody looked and decided nothing was needed, and it
 * is only worth anything if that decision was written down PER RECORD.
 *
 * This counts, per lane, how many examined records have a recorded reason and how many are a bulk
 * assertion. The unjustified ones are the answer to "are you sure?" — they are the records where the
 * claim rests on a previous pass's word rather than on evidence.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const examined = JSON.parse(readFileSync(p('work/examined.json'), 'utf8'));
const reasons = existsSync(p('work/examined-reasons.json')) ? JSON.parse(readFileSync(p('work/examined-reasons.json'), 'utf8')) : {};

let totalEx = 0;
let totalJust = 0;
const rows = [];
for (const [lane, ids] of Object.entries(examined)) {
  const list = Array.isArray(ids) ? ids : Object.keys(ids ?? {});
  const laneReasons = reasons[lane] ?? {};
  const justified = list.filter((id) => typeof laneReasons[id] === 'string' && laneReasons[id].length > 20);
  totalEx += list.length;
  totalJust += justified.length;
  rows.push({ lane, examined: list.length, justified: justified.length, bulk: list.length - justified.length });
}
rows.sort((a, b) => b.bulk - a.bulk);

console.log('EXAMINED — is the decision written down, per record?\n');
console.log('  lane            examined  with a reason   BULK ASSERTION');
for (const r of rows) {
  console.log(
    `  ${r.lane.padEnd(14)} ${String(r.examined).padStart(8)} ${String(r.justified).padStart(14)} ${String(r.bulk).padStart(16)}`,
  );
}
console.log(`\n  ${'TOTAL'.padEnd(14)} ${String(totalEx).padStart(8)} ${String(totalJust).padStart(14)} ${String(totalEx - totalJust).padStart(16)}`);
console.log(
  `\n${totalEx - totalJust} of ${totalEx} examined records rest on a previous pass's word with no recorded reason.\n` +
  `That is the honest size of the "are you sure?" question — not a defect count, but the set where\n` +
  `nothing but a claim stands between "examined" and "missed".`,
);
