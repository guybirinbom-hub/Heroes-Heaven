/*
 * COLLAPSE DUPLICATE OPTIONS in already-authored choice rows.
 *
 * Repointing every superseded spell grant at its current printing left eight option lists showing the
 * same choice twice: those lists had offered BOTH printings — the legacy record and its remaster
 * replacement — and after the repoint both options named the same spell. A picker with two identical
 * entries is a defect the referential-integrity test catches ("an option list offers at least two
 * distinct choices"), which is exactly what it is there for.
 *
 * This walks the overlay rows themselves rather than re-deriving from core.json, because the repoint
 * has already been written: re-running the repointer now finds nothing to do.
 *
 *   node scripts/dedupe-choice-options.mjs           # report
 *   node scripts/dedupe-choice-options.mjs --write
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

const dedupe = (opts) => {
  const seen = new Set();
  return opts.filter((o) => {
    const k = String(o?.value ?? '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const rows = readBackfill(ROOT);
const changed = [];
for (const r of rows) {
  if (r.field !== 'effectChoices' && r.field !== 'choice') continue;
  const groups = r.field === 'choice' ? [r.value] : r.value;
  if (!Array.isArray(groups)) continue;
  let touched = false;
  const next = groups.map((g) => {
    if (!Array.isArray(g?.options)) return g;
    const d = dedupe(g.options);
    if (d.length === g.options.length) return g;
    touched = true;
    changed.push(`${r.category}/${r.id}.${r.field}[${g.id ?? g.flag ?? '?'}]: ${g.options.length} → ${d.length} option(s)`);
    return { ...g, options: d };
  });
  if (touched) r.value = r.field === 'choice' ? next[0] : next;
}

console.log(`${changed.length} option list(s) deduped:`);
for (const c of changed) console.log(`   ${c}`);
if (!changed.length) process.exit(0);
if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }
writeBackfill(ROOT, rows);
console.log(`\nwrote ${rows.length} rows.`);
