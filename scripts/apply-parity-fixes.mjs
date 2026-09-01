/*
 * Apply a batch of verified parity fix specs — overlay rows and code edits — with every precondition
 * checked BEFORE anything touches disk.
 *
 * The specs come from the parity workflow: each finding was produced by one agent and adversarially
 * verified by a second, and only survivors reach here. What this adds is the part no agent can do
 * safely — writing to SHARED files, one at a time, refusing anything ambiguous.
 *
 * WHY IT REFUSES SO MUCH. Every failure mode below has actually happened in this project:
 *
 *   · A code edit whose `find` is not unique replaces the wrong occurrence, or silently the first of
 *     several. Both are invisible in a diff nobody reads line by line. A `find` that does not appear
 *     EXACTLY ONCE is refused, never "best effort" applied.
 *   · An overlay row for a record that does not exist is authored data reaching nothing — the exact
 *     failure this project keeps finding late. Refused unless the row carries `create: true`.
 *   · Two fixes writing the same overlay field is a collision, not a merge. Reported, not resolved.
 *   · Nothing is written until every check on every item passes, so a bad spec in position 40 cannot
 *     leave the first 39 applied and the tree half-changed.
 *
 * `value: null` legitimately REMOVES a field and is allowed — it is the documented overlay idiom.
 *
 *   node scripts/apply-parity-fixes.mjs <specs.json>            # dry run: every check, nothing written
 *   node scripts/apply-parity-fixes.mjs <specs.json> --write
 *
 * The specs file is an array of findings, or { applicable: [...] }.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const specPath = process.argv[2];
if (!specPath || specPath.startsWith('--')) {
  console.error('usage: node scripts/apply-parity-fixes.mjs <specs.json> [--write]');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(specPath, 'utf8'));
const findings = Array.isArray(raw) ? raw : (raw.applicable ?? raw.findings ?? []);
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

/* A verifier may have supplied corrected rows/edits; those win over the finder's originals. */
const rowsOf = (f) => (f.verification?.correctedBackfillRows?.length ? f.verification.correctedBackfillRows : f.backfillRows) ?? [];
const editsOf = (f) => (f.verification?.correctedCodeEdits?.length ? f.verification.correctedCodeEdits : f.codeEdits) ?? [];

const problems = [];
const plannedRows = [];
const plannedEdits = [];
const fileCache = new Map();
const readOnce = (rel) => {
  if (!fileCache.has(rel)) fileCache.set(rel, readFileSync(join(ROOT, rel), 'utf8'));
  return fileCache.get(rel);
};

/* ---------- check everything first ---------- */
for (const f of findings) {
  for (const row of rowsOf(f)) {
    if (!row || !row.category || !row.id) { problems.push(`${f.id}: an overlay row is missing category/id`); continue; }
    if (!core[row.category]?.[row.id] && !row.create) {
      problems.push(`${f.id}: row targets ${row.category}/${row.id}, which does not exist and has no create:true — it would reach nothing`);
      continue;
    }
    if (!row.create && !row.field) { problems.push(`${f.id}: row for ${row.category}/${row.id} has no field and no create:true`); continue; }
    plannedRows.push({ from: f.id, row });
  }

  for (const e of editsOf(f)) {
    if (!e?.file || typeof e.find !== 'string' || typeof e.replace !== 'string') {
      problems.push(`${f.id}: a code edit is missing file/find/replace`);
      continue;
    }
    let src;
    try { src = readOnce(e.file); } catch { problems.push(`${f.id}: cannot read ${e.file}`); continue; }
    const n = src.split(e.find).length - 1;
    if (n !== 1) {
      problems.push(`${f.id}: \`find\` occurs ${n}x in ${e.file} (must be exactly 1) — ${JSON.stringify(e.find.slice(0, 70))}`);
      continue;
    }
    if (e.find === e.replace) { problems.push(`${f.id}: edit to ${e.file} is a no-op`); continue; }
    plannedEdits.push({ from: f.id, ...e });
  }
}

const seen = new Map();
for (const { from, row } of plannedRows) {
  const key = `${row.category}/${row.id}/${row.field ?? '(create)'}`;
  if (seen.has(key)) problems.push(`${from} and ${seen.get(key)} both write ${key} — resolve by hand`);
  else seen.set(key, from);
}

const byFile = {};
for (const e of plannedEdits) (byFile[e.file] ??= []).push(e);

console.log(`${findings.length} finding(s): ${plannedRows.length} overlay row(s), ${plannedEdits.length} code edit(s) across ${Object.keys(byFile).length} file(s).\n`);
for (const { from, row } of plannedRows) {
  console.log(`   row   ${String(from).padEnd(34)} ${row.category}/${row.id}.${row.field ?? '(create)'} = ${JSON.stringify(row.value).slice(0, 84)}`);
}
for (const e of plannedEdits) console.log(`   edit  ${String(e.from).padEnd(34)} ${e.file}: ${JSON.stringify(e.find.slice(0, 56))}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s) — NOTHING was written:\n`);
  for (const p of problems) console.error(`   ${p}`);
  process.exit(1);
}
console.log('\nall preconditions pass.');
if (!WRITE) { console.log('(dry run — pass --write)'); process.exit(0); }

/* ---------- write ---------- */
if (plannedRows.length) {
  const all = readBackfill(ROOT);
  let added = 0;
  let replaced = 0;
  for (const { row } of plannedRows) {
    const at = all.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
    if (at >= 0) { all[at] = row; replaced++; } else { all.push(row); added++; }
  }
  writeBackfill(ROOT, all);
  console.log(`overlay: ${added} new, ${replaced} replaced (${all.length} rows).`);
}

for (const [file, edits] of Object.entries(byFile)) {
  let src = readFileSync(join(ROOT, file), 'utf8');
  for (const e of edits) {
    /* Re-checked per edit: an earlier edit to the SAME file can change or duplicate a later `find`. */
    const n = src.split(e.find).length - 1;
    if (n !== 1) {
      console.error(`\n${file}: \`find\` for ${e.from} now occurs ${n}x (an earlier edit in this file changed it). STOPPING.`);
      console.error('   Overlay rows above ARE written; re-run the remaining edits after re-reading the file.');
      process.exit(1);
    }
    src = src.replace(e.find, e.replace);
  }
  writeFileSync(join(ROOT, file), src);
  console.log(`${file}: ${edits.length} edit(s) applied.`);
}
console.log('\nNext: node scripts/apply-backfill-now.mjs && npx tsc -b && npx vitest run && npm run verify');
