/*
 * ONE-TIME: stamp the permanent desk number `n` onto every owner-question entry.
 *
 * docs/wg-batch-pipeline.md, section B: *"a one-time backfill adds a persistent `n` to every entry of
 * `open` / `deferred` / `ruled` / `authorisedExceptions` in `work/owner-questions.json` (assigned from
 * today's positions so #104 keeps its identity) with a test pinning the n→id map"*.
 *
 * Why it exists: the owner answers by NUMBER ("104 — keep ours"), but until now the number lived only
 * in work/rulings-numbering.json, and the desk list he reads is rendered from positions in
 * owner-questions.json. Those two drift the moment an entry moves array (open -> ruled) and every
 * number after it shifts by one — i.e. a ruling can silently land on the wrong record. Stamping `n`
 * into the entry itself makes the number a property of the RECORD, not of its position.
 *
 * Reconciliation rule (the plan's, not invented here): where rulings-numbering.json already has a
 * number for an id, THAT number is its `n`; an entry with no number gets the next free `n` above the
 * current max; any conflict is REPORTED and the run refuses, never guessed.
 *
 *   node scripts/backfill-owner-question-numbers.mjs            # report only
 *   node scripts/backfill-owner-question-numbers.mjs --write
 *
 * Idempotent: a second run finds every `n` already stamped and writes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Q = join(ROOT, 'work/owner-questions.json');
const N = join(ROOT, 'work/rulings-numbering.json');
const WRITE = process.argv.includes('--write');
const ARRAYS = ['open', 'deferred', 'ruled', 'authorisedExceptions'];

/* authorisedExceptions carry no `id` (they are rulings, not records), and they still need a stable
 * key so their number survives a re-run. Derived from the ruling date + the sentence, both of which
 * are the entry's identity — an edit to `what` is a new exception, not a renamed one. */
const keyOf = (e) =>
  e.id ?? `exception:${e.ruling}:${String(e.what ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`;

function reconcile(doc, numbers) {
  const entries = [];
  for (const arr of ARRAYS) for (const [i, e] of (doc[arr] ?? []).entries()) entries.push({ arr, i, e, key: keyOf(e) });

  const conflicts = [];
  const claimed = new Map(); // n -> key
  for (const row of entries) {
    const fromMap = numbers[row.key];
    const stamped = row.e.n;
    if (stamped !== undefined && fromMap !== undefined && stamped !== fromMap)
      conflicts.push(`${row.key}: entry says n=${stamped}, rulings-numbering.json says ${fromMap}`);
    row.n = fromMap ?? stamped ?? null;
    if (row.n === null) continue;
    const prev = claimed.get(row.n);
    if (prev) conflicts.push(`n=${row.n} claimed by both ${prev} and ${row.key}`);
    claimed.set(row.n, row.key);
  }

  let next = Math.max(0, ...claimed.keys(), ...Object.values(numbers).map(Number)) + 1;
  const assigned = [];
  for (const row of entries) {
    if (row.n !== null) continue;
    row.n = next++;
    assigned.push(row);
  }
  return { entries, conflicts, assigned };
}

{
  const doc = JSON.parse(readFileSync(Q, 'utf8'));
  const num = JSON.parse(readFileSync(N, 'utf8'));
  const { entries, conflicts, assigned } = reconcile(doc, num.numbers ?? {});

  if (conflicts.length) {
    console.error(`REFUSED — ${conflicts.length} numbering conflict(s); nothing written:`);
    for (const c of conflicts) console.error(`  ${c}`);
    process.exit(3);
  }

  const already = entries.filter((r) => r.e.n === r.n).length;
  console.log(`${entries.length} entries across ${ARRAYS.join(' / ')} — ${already} already stamped, ${assigned.length} newly numbered.`);
  for (const r of assigned) console.log(`  new n=${r.n}  ${r.arr}[${r.i}]  ${r.key}`);
  console.log(`highest n now ${Math.max(...entries.map((r) => r.n))}.`);
  if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }

  for (const r of entries) {
    const { n: _drop, ...rest } = r.e;
    doc[r.arr][r.i] = { n: r.n, ...rest };
    num.numbers[r.key] = r.n;
  }
  writeFileSync(Q, JSON.stringify(doc, null, 1) + '\n');
  writeFileSync(N, JSON.stringify(num, null, 1) + '\n');
  console.log('written: work/owner-questions.json + work/rulings-numbering.json.');
}
