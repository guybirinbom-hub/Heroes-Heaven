/*
 * REPAIR a recurring proposal error: several fields collapsed into one field's value.
 *
 * The shape is unmistakable — a row whose `field` is X, whose value is an OBJECT, and whose keys are
 * themselves declared field names (one of them usually X):
 *
 *   { field: 'grantedStrikes', value: { grantedStrikes: [...], strikeDamage: [...] } }
 *
 * The inner values are well-formed; only the wrapping is wrong, because the reader meant to propose
 * two rows and had one slot to put them in. This splits each such row into its parts. It is deliberate
 * that the check is STRUCTURAL — every key must be a real field in types.ts — so a legitimate object
 * value (a `choice`, a `classDcRank`) is never mistaken for a nesting error.
 *
 *   node scripts/split-nested-backfill-rows.mjs           # report
 *   node scripts/split-nested-backfill-rows.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

const types = readFileSync(join(ROOT, 'src/rules/types.ts'), 'utf8');
const DECLARED = new Set([...types.matchAll(/^\s{2,}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm)].map((m) => m[1]));

const rows = readBackfill(ROOT);
const out = [];
const split = [];

for (const r of rows) {
  const v = r.value;
  const isPlainObject = v && typeof v === 'object' && !Array.isArray(v);
  const keys = isPlainObject ? Object.keys(v) : [];
  /* Every key a declared field AND the row's own field among them — that is the collapse signature. */
  const nested = isPlainObject && keys.length > 1 && keys.every((k) => DECLARED.has(k)) && keys.includes(r.field);
  if (!nested) { out.push(r); continue; }
  split.push({ where: `${r.category}/${r.id}`, from: r.field, into: keys });
  for (const k of keys) out.push({ category: r.category, id: r.id, field: k, value: v[k] });
}

console.log(`${split.length} collapsed row(s) found in ${rows.length}; ${rows.length} -> ${out.length} rows.\n`);
for (const s of split) console.log(`   ${s.where}.${s.from}  ->  ${s.into.join(', ')}`);

if (!split.length) process.exit(0);
if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }
writeBackfill(ROOT, out);
console.log(`\nwrote ${out.length} rows.`);
