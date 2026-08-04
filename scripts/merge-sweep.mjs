/*
 * Merges any sweep batch's judge-*.json and refute-*.json into work/sweep/<batch>/result.json.
 * Generic version of merge-sweep-b2.mjs — it counts the judge and refute files rather than being
 * told how many there are.
 *
 * The point of this step is the COVERAGE CHECK. An agent that quietly drops records looks exactly
 * like an agent that judged them all and found nothing — the precise failure that made the original
 * "examined" verdict worthless. Every id in the input chunks must come back with a verdict, and
 * anything missing is reported loudly and exits non-zero rather than being averaged away.
 *
 * Usage: node scripts/merge-sweep.mjs b3
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const batch = process.argv[2];
if (!batch) { console.error('usage: node scripts/merge-sweep.mjs <batchName>'); process.exit(2); }
const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'work/sweep', batch);
const rd = (f) => JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));
const ls = (re) => readdirSync(DIR).filter((f) => re.test(f)).sort((a, b) => (+a.replace(/\D+/g, '') || 0) - (+b.replace(/\D+/g, '') || 0));

const chunkFiles = ls(/^c\d+\.json$/);
const asked = new Map();
for (const f of chunkFiles) for (const r of rd(f)) asked.set(r.id, r);
console.log(`input   : ${asked.size} unique records across ${chunkFiles.length} chunks`);

const judgeFiles = ls(/^judge-\d+\.json$/);
const judged = new Map();
let dupes = 0;
for (const f of judgeFiles) {
  let body;
  try { body = rd(f); } catch (e) { console.log(`  !! ${f} is not valid JSON: ${e.message}`); continue; }
  for (const r of body.records ?? []) {
    if (!r?.id) continue;
    if (judged.has(r.id)) { dupes++; continue; } // first verdict wins
    judged.set(r.id, r);
  }
}
console.log(`judged  : ${judged.size} records from ${judgeFiles.length} judge files${dupes ? ` (${dupes} duplicate ids ignored)` : ''}`);

const refuteFiles = ls(/^refute-\d+\.json$/);
const rulings = new Map();
for (const f of refuteFiles) {
  try { for (const r of rd(f).rulings ?? []) if (r?.id) rulings.set(r.id, r); }
  catch (e) { console.log(`  !! ${f} is not valid JSON: ${e.message}`); }
}
console.log(`refuted : ${rulings.size} MISS findings examined across ${refuteFiles.length} adversaries`);

const unjudged = [...asked.keys()].filter((id) => !judged.has(id));
const extra = [...judged.keys()].filter((id) => !asked.has(id));
if (unjudged.length) {
  console.log(`\n!! ${unjudged.length} RECORDS NEVER JUDGED — these are NOT "needs nothing", they were skipped:`);
  for (const id of unjudged.slice(0, 25)) console.log(`     ${id}  [${asked.get(id).lane}]`);
  if (unjudged.length > 25) console.log(`     ...and ${unjudged.length - 25} more`);
  writeFileSync(path.join(DIR, 'unjudged.json'), JSON.stringify(unjudged.map((id) => asked.get(id)), null, 1));
  console.log(`   -> work/sweep/${batch}/unjudged.json`);
}
if (extra.length) console.log(`\n!! ${extra.length} ids judged that were never asked for: ${extra.slice(0, 5).join(', ')}`);

const records = [];
let overturned = 0;
for (const [id, r] of judged) {
  if (!asked.has(id)) continue;
  const src = asked.get(id);
  const out = { ...r, lane: src.lane, collection: src.collection, name: src.name };
  if (r.verdict === 'MISS') {
    const ruling = rulings.get(id);
    if (ruling && ruling.upheld === false) {
      out.verdict = 'NEEDS_NOTHING';
      out.reason = `overturned by adversary: ${ruling.why}`;
      out.wasMiss = true;
      delete out.fix;
      overturned++;
    } else if (ruling) out.upheldBy = ruling.why;
    else out.unrefuted = true;
  }
  records.push(out);
}

const n = (pred) => records.filter(pred).length;
const miss = records.filter((r) => r.verdict === 'MISS');
const unrefuted = miss.filter((r) => r.unrefuted).length;
const noFix = miss.filter((r) => !r.fix || (!r.fix.field && !r.fix.situational?.length && !r.fix.toggle && !r.fix.effectChoices?.length && !r.fix.needsEngineWork)).length;
const engineWork = miss.filter((r) => r.fix?.needsEngineWork).length;

console.log(`\nRESULT  ${records.length} records`);
console.log(`  MISS             ${String(miss.length).padStart(4)}  (${(miss.length / records.length * 100).toFixed(0)}%)   [b1 21% · b2 17%]`);
console.log(`  ALREADY_MODELLED ${String(n((r) => r.verdict === 'ALREADY_MODELLED')).padStart(4)}`);
console.log(`  NEEDS_NOTHING    ${String(n((r) => r.verdict === 'NEEDS_NOTHING')).padStart(4)}`);
console.log(`  overturned by the adversary: ${overturned}`);
console.log(`  of the MISSes: ${engineWork} need engine work (no field exists)`);
if (unrefuted) console.log(`  !! ${unrefuted} MISS findings no adversary examined`);
if (noFix) console.log(`  !! ${noFix} MISS findings carry no applicable fix`);

const byLane = {};
for (const r of miss) byLane[r.lane] = (byLane[r.lane] ?? 0) + 1;
console.log(`  MISS by lane: ${Object.entries(byLane).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

writeFileSync(path.join(DIR, 'result.json'), JSON.stringify({ records }, null, 1));
console.log(`\nwritten: work/sweep/${batch}/result.json`);
if (unjudged.length) { console.log('\nCOVERAGE INCOMPLETE — do not treat this batch as finished.'); process.exit(1); }
