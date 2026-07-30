/*
 * What batch 1 found, and how much of it is directly applicable.
 *
 * The sweep was designed to emit the FIX, not just a diagnosis, so the first question is what share of
 * the 301 misses arrived with a usable one. Anything without a fix is still a finding, but it needs a
 * second pass rather than a script.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const res = JSON.parse(readFileSync(path.join(ROOT, 'work/sweep/b1/result.json'), 'utf8'));
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));

const misses = res.records.filter((r) => r.verdict === 'MISS');
console.log(`MISS: ${misses.length} of ${res.records.length} (${Math.round((misses.length / res.records.length) * 100)}%)`);
console.log(`needs-nothing: ${res.totals.nothing}  ·  already-modelled: ${res.totals.modelled}`);
console.log(`overturned by the refute pass: ${res.totals.overturned}\n`);

// ---- what kind of fix ----
const kinds = new Map();
const noFix = [];
for (const m of misses) {
  const f = m.fix ?? {};
  const has = [];
  if (f.situational?.length) has.push('situational');
  if (f.effectChoices?.length) has.push('effectChoices');
  if (f.field && f.value) has.push(`field:${f.field}`);
  if (!has.length) { noFix.push(m.id); continue; }
  for (const h of has) kinds.set(h, (kinds.get(h) ?? 0) + 1);
}
console.log('APPLICABLE FIXES by shape');
for (const [k, n] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log(`  ${String(noFix.length).padStart(4)}  (no fix supplied — needs a second look)`);
if (noFix.length) console.log(`        e.g. ${noFix.slice(0, 8).join(', ')}`);

// ---- which collection do the misses live in? tells us where to write ----
const COLLECTIONS = ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds', 'spells', 'deities', 'stances'];
const where = new Map();
for (const m of misses) {
  const c = COLLECTIONS.find((k) => core[k]?.[m.id]) ?? 'NOT FOUND';
  where.set(c, (where.get(c) ?? 0) + 1);
}
console.log('\nMISSES by collection');
for (const [k, n] of [...where.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

// ---- the needs-nothing justifications, so the claim is auditable this time ----
const rulings = new Map();
for (const r of res.records.filter((x) => x.verdict === 'needs-nothing')) {
  const key = String(r.ruling ?? 'unstated').slice(0, 60);
  rulings.set(key, (rulings.get(key) ?? 0) + 1);
}
console.log('\nNEEDS-NOTHING by stated ruling (every one now has a recorded reason)');
for (const [k, n] of [...rulings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${k}`);
const unstated = res.records.filter((x) => x.verdict === 'needs-nothing' && !x.ruling).length;
console.log(`\n  unstated: ${unstated} (these are the only ones still resting on a bare claim)`);
