/*
 * The 240-record sample said 46% MISS. This turns that into something actionable: the per-lane rate,
 * the extrapolation to the whole unjustified set, and — the useful part — the misses grouped by ROOT
 * CAUSE, because many share one. "1,790 misses" is a number to despair at; "the top cause covers 300
 * of them and is one fix" is a plan.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const res = JSON.parse(readFileSync(p('work/verify/result.json'), 'utf8'));
const examined = JSON.parse(readFileSync(p('work/examined.json'), 'utf8'));
const reasons = existsSync(p('work/examined-reasons.json')) ? JSON.parse(readFileSync(p('work/examined-reasons.json'), 'utf8')) : {};

const unjustifiedCount = (lane) => {
  const ids = examined[lane];
  const list = Array.isArray(ids) ? ids : Object.keys(ids ?? {});
  const lr = reasons[lane] ?? {};
  return list.filter((id) => !(typeof lr[id] === 'string' && lr[id].length > 20)).length;
};

console.log('PER-LANE MISS RATE, and what it implies for the whole unjustified set\n');
console.log('  lane            sampled   MISS   rate    unjustified   implied misses');
let impliedTotal = 0;
let popTotal = 0;
const rows = [];
for (const [lane, list] of Object.entries(res.byLane)) {
  const miss = list.filter((x) => x.verdict === 'MISS').length;
  const rate = list.length ? miss / list.length : 0;
  const pop = unjustifiedCount(lane);
  const implied = Math.round(rate * pop);
  impliedTotal += implied;
  popTotal += pop;
  rows.push({ lane, sampled: list.length, miss, rate, pop, implied });
}
rows.sort((a, b) => b.implied - a.implied);
for (const r of rows) {
  console.log(
    `  ${r.lane.padEnd(14)} ${String(r.sampled).padStart(7)} ${String(r.miss).padStart(6)} ${String(Math.round(r.rate * 100) + '%').padStart(6)} ${String(r.pop).padStart(13)} ${String(r.implied).padStart(16)}`,
  );
}
console.log(`  ${'TOTAL'.padEnd(14)} ${String(res.totals.total).padStart(7)} ${String(res.totals.miss).padStart(6)} ${String(Math.round((res.totals.miss / res.totals.total) * 100) + '%').padStart(6)} ${String(popTotal).padStart(13)} ${String(impliedTotal).padStart(16)}`);

// ---- root causes ----
// The `suggestedField` is where the fix would live, which is the closest thing to a root cause the
// sample records. Grouping by it turns a list of records into a list of jobs.
const misses = Object.values(res.byLane).flat().filter((x) => x.verdict === 'MISS');
const byFix = new Map();
for (const m of misses) {
  // Normalise to the field/registry name, dropping the per-record explanation after it.
  const raw = String(m.suggestedField ?? 'unstated').toLowerCase();
  let key = 'other';
  for (const [pat, label] of [
    [/background|backgroundgrantedfeats|feats\[\]/, 'background/class-granted feats get no choice picker'],
    [/effectchoices|`choice`|\bchoice\b/, 'effectChoices / choice — a build-time pick never offered'],
    [/feat_situational|situationalbonuses|situational/, 'situational registry — a conditional bonus with no star'],
    [/innatespells|focusspells|spellcasting|spellgrant/, 'granted spells never reach the Spells page'],
    [/modes|stance|toggle/, 'modes/stances — a toggleable state with no switch'],
    [/featfeatgrants|grantsfeats|grantedfeatid|feat_feat/, 'grants-another-feat not registered'],
    [/limiteduses|uses|counters|frequency/, 'limited uses / per-day not tracked'],
    [/resistance|immunit|weakness|senses|speeds|defense/, 'defences & senses not granted'],
    [/proficien|trainedskill|skillchoices|featgrants/, 'proficiency grant missing'],
    [/companion/, 'companion grant missing'],
  ]) {
    if (pat.test(raw)) { key = label; break; }
  }
  if (!byFix.has(key)) byFix.set(key, []);
  byFix.get(key).push(m.id);
}
console.log('\nMISSES BY ROOT CAUSE (what would have to be built)\n');
for (const [k, ids] of [...byFix.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(ids.length).padStart(3)}  ${k}`);
  console.log(`       e.g. ${ids.slice(0, 5).join(', ')}`);
}

console.log(`\n${misses.length} of ${res.totals.total} sampled records are real misses (${Math.round((res.totals.miss / res.totals.total) * 100)}%).`);
console.log(`Across the ${popTotal} unjustified records that implies roughly ${impliedTotal} genuine gaps.`);
console.log(`${res.totals.modelled} of the sample were ALREADY modelled — "examined" understated those.`);
