/*
 * Merges batch 2's judge-*.json and refute-*.json into work/sweep/b2/result.json.
 *
 * The point of this step is the COVERAGE CHECK. An agent that quietly drops records looks exactly
 * like an agent that judged them all and found nothing — which is the precise failure that made the
 * original "examined" verdict worthless. So every id in the input chunks must come back with a
 * verdict, and anything missing is reported loudly rather than averaged away.
 *
 * Usage: node scripts/merge-sweep-b2.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'work/sweep/b2');
const rd = (f) => JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));

// ---- what was asked ----
const chunkFiles = readdirSync(DIR).filter((f) => /^c\d+\.json$/.test(f)).sort((a, b) => +a.slice(1) - +b.slice(1));
const asked = new Map();
for (const f of chunkFiles) for (const r of rd(f)) asked.set(r.id, r);
console.log(`input   : ${asked.size} records across ${chunkFiles.length} chunks`);

// ---- what came back ----
const judged = new Map();
const dupes = [];
let files = 0;
for (let i = 0; i < 12; i++) {
  const f = `judge-${i}.json`;
  if (!existsSync(path.join(DIR, f))) { console.log(`  !! MISSING ${f}`); continue; }
  files++;
  const body = rd(f);
  for (const r of body.records ?? []) {
    if (!r?.id) continue;
    if (judged.has(r.id)) { dupes.push(r.id); continue; } // first verdict wins
    judged.set(r.id, r);
  }
}
console.log(`judged  : ${judged.size} records from ${files}/12 files${dupes.length ? ` (${dupes.length} duplicate ids ignored)` : ''}`);

// ---- the adversary's rulings ----
const rulings = new Map();
for (let g = 0; g < 3; g++) {
  const f = `refute-${g}.json`;
  if (!existsSync(path.join(DIR, f))) { console.log(`  !! MISSING ${f}`); continue; }
  for (const r of rd(f).rulings ?? []) if (r?.id) rulings.set(r.id, r);
}
console.log(`refuted : ${rulings.size} MISS findings examined`);

// ---- coverage ----
const unjudged = [...asked.keys()].filter((id) => !judged.has(id));
const extra = [...judged.keys()].filter((id) => !asked.has(id));
if (unjudged.length) {
  console.log(`\n!! ${unjudged.length} RECORDS NEVER JUDGED — these are NOT "needs nothing", they were skipped:`);
  for (const id of unjudged.slice(0, 25)) console.log(`     ${id}  [${asked.get(id).lane}]`);
  if (unjudged.length > 25) console.log(`     ...and ${unjudged.length - 25} more`);
  writeFileSync(path.join(DIR, 'unjudged.json'), JSON.stringify(unjudged.map((id) => asked.get(id)), null, 1));
  console.log(`   -> work/sweep/b2/unjudged.json (re-run these before applying)`);
}
if (extra.length) console.log(`\n!! ${extra.length} ids judged that were never asked for (hallucinated): ${extra.slice(0, 5).join(', ')}`);

// ---- assemble, applying the adversary's overturns ----
const records = [];
let overturned = 0;
for (const [id, r] of judged) {
  if (!asked.has(id)) continue;
  const out = { ...r, lane: asked.get(id).lane, collection: asked.get(id).collection, name: asked.get(id).name };
  if (r.verdict === 'MISS') {
    const ruling = rulings.get(id);
    if (ruling && ruling.upheld === false) {
      out.verdict = 'NEEDS_NOTHING';
      out.reason = `overturned by adversary: ${ruling.why}`;
      out.wasMiss = true;
      delete out.fix;
      overturned++;
    } else if (ruling) {
      out.upheldBy = ruling.why;
    } else {
      out.unrefuted = true; // no adversary saw it — surfaced, not silently trusted
    }
  }
  records.push(out);
}

const tally = (pred) => records.filter(pred).length;
const miss = records.filter((r) => r.verdict === 'MISS');
const unrefuted = miss.filter((r) => r.unrefuted).length;
const noFix = miss.filter((r) => !r.fix || (!r.fix.field && !r.fix.situational?.length && !r.fix.toggle && !r.fix.effectChoices?.length)).length;

console.log(`\nRESULT  ${records.length} records`);
console.log(`  MISS             ${String(miss.length).padStart(4)}  (${(miss.length / records.length * 100).toFixed(0)}%)  [b1 was 21%]`);
console.log(`  ALREADY_MODELLED ${String(tally((r) => r.verdict === 'ALREADY_MODELLED')).padStart(4)}  [b1 was 49%]`);
console.log(`  NEEDS_NOTHING    ${String(tally((r) => r.verdict === 'NEEDS_NOTHING')).padStart(4)}`);
console.log(`  overturned by the adversary: ${overturned}`);
if (unrefuted) console.log(`  !! ${unrefuted} MISS findings no adversary examined`);
if (noFix) console.log(`  !! ${noFix} MISS findings carry no applicable fix (they cannot be applied)`);

const byLane = {};
for (const r of miss) byLane[r.lane] = (byLane[r.lane] ?? 0) + 1;
console.log(`  MISS by lane: ${Object.entries(byLane).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

writeFileSync(path.join(DIR, 'result.json'), JSON.stringify({ records }, null, 1));
console.log(`\nwritten: work/sweep/b2/result.json`);
if (unjudged.length) { console.log('\nCOVERAGE INCOMPLETE — do not treat this batch as finished.'); process.exit(1); }
