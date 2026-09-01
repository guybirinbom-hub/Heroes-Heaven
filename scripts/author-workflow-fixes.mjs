/*
 * AUTHOR the workflow's surviving fixes into scripts/data/effect-backfill.json — but only the ones
 * that survive a mechanical validation the model cannot talk its way past.
 *
 * 190 model-proposed values are not authorable on trust. Every one is put through these gates first,
 * and anything that fails is REPORTED rather than written, for a human pass:
 *
 *   FIELD IS REAL      the field name must be declared as a property somewhere in src/rules/types.ts.
 *                      This is the strongest automated check available: an invented field cannot pass.
 *   FIELD IS A FIELD   several proposals put prose or a registry path in `field`
 *                      ("note — scripts/data/…", "FEAT_GRANT_BOUND_CHOICE['web-weaver']"). Those are
 *                      code changes, not data rows, and must not be written as a field name.
 *   RECORD EXISTS      the (bucket, id) must resolve in public/core.json.
 *   VALUE PARSES       valueJson must JSON.parse. A value that does not parse was never authorable.
 *   NOT A DUPLICATE    the same (bucket, id, field) proposed twice — keep one, report the collision.
 *   WHEN ≤ 120         a `situational` entry's `when` is capped by ruling H; a longer one fails the
 *                      test suite, so it is caught here instead of there.
 *
 * Deliberately NOT gated on "the field is already set": that is legitimate for a WRONG-VALUE fix
 * (ghoul-hide holds speedPenalty 0 where every other hide armour holds -5). Those are listed instead,
 * so the overwrite is a decision rather than an accident.
 *
 *   node scripts/author-workflow-fixes.mjs            # report
 *   node scripts/author-workflow-fixes.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const out = read('work/residual-workflow-out.json');

/* Every property name declared in types.ts — `name?: T` and `name: T` at any indent. */
const types = readFileSync(join(ROOT, 'src/rules/types.ts'), 'utf8');
const DECLARED = new Set([...types.matchAll(/^\s{2,}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm)].map((m) => m[1]));

const accepted = [];
const rejected = [];
const overwrites = [];
const seen = new Map();

for (const fix0 of out.survived ?? []) {
  let fix = fix0;
  const rawField = String(fix.field ?? '').trim();
  let field = rawField.split(/[\s—,]/)[0];
  const where = `${fix.bucket}/${fix.id}`;
  const reject = (why) => rejected.push({ where, field: rawField, why, confidence: fix.confidence });

  /*
   * A NOTE verdict carries its text in `note` and names no field — the field IS `note` by definition.
   * Without this, 26 perfectly authorable one-line notes were held back as "no field named".
   */
  if (!field && fix.verdict === 'NOTE' && typeof fix.note === 'string' && fix.note.trim()) {
    field = 'note';
    fix = { ...fix, valueJson: JSON.stringify(fix.note.trim()) };
  }

  if (!field) { reject('no field named'); continue; }
  if (/[[\].]|\.ts|scripts\//.test(rawField.split(/\s/)[0])) { reject('field is a registry path or code change, not a data row'); continue; }
  if (!DECLARED.has(field)) { reject(`"${field}" is not declared in types.ts`); continue; }
  const rec = core[fix.bucket]?.[fix.id];
  if (!rec) { reject('record not in core.json'); continue; }
  if (fix.valueJson == null) { reject('no valueJson'); continue; }

  let value;
  try { value = JSON.parse(fix.valueJson); } catch (e) { reject(`valueJson does not parse: ${e.message.slice(0, 60)}`); continue; }

  if (field === 'situational') {
    const list = Array.isArray(value) ? value : [value];
    const long = list.find((s) => typeof s?.when === 'string' && s.when.length > 120);
    if (long) { reject(`situational \`when\` is ${long.when.length} chars — ruling H caps it at 120`); continue; }
  }

  const key = `${fix.bucket}/${fix.id}/${field}`;
  if (seen.has(key)) { reject(`duplicate of an earlier proposal for ${key}`); continue; }
  seen.set(key, true);

  const already = rec[field] != null && !(Array.isArray(rec[field]) && !rec[field].length);
  if (already) overwrites.push({ where, field, was: JSON.stringify(rec[field]).slice(0, 70) });

  accepted.push({ category: fix.bucket, id: fix.id, field, value });
}

console.log(`${(out.survived ?? []).length} proposals -> ${accepted.length} authorable, ${rejected.length} held back.\n`);

const byField = {};
for (const a of accepted) byField[a.field] = (byField[a.field] ?? 0) + 1;
console.log('authorable by field:');
for (const [f, n] of Object.entries(byField).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${f}`);

console.log(`\nheld back (${rejected.length}) — these need a human pass, most are code changes not data:`);
const byWhy = {};
for (const r of rejected) {
  const k = /not declared/.test(r.why) ? 'field not in types.ts' : /registry path/.test(r.why) ? 'code change, not a data row' : r.why;
  (byWhy[k] ??= []).push(r.where);
}
for (const [why, list] of Object.entries(byWhy).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(3)}  ${why}`);
  for (const w of list.slice(0, 6)) console.log(`         ${w}`);
  if (list.length > 6) console.log(`         … and ${list.length - 6} more`);
}

if (overwrites.length) {
  console.log(`\noverwrites an existing value (${overwrites.length}) — intentional for a wrong-value fix:`);
  for (const o of overwrites) console.log(`   ${o.where}.${o.field}  was ${o.was}`);
}

if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of accepted) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`\nwrote ${added} new, ${replaced} replaced (${rows.length} rows).`);
