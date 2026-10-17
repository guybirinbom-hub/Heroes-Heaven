/*
 * GUARD: A WHOLE-FIELD OVERLAY ROW MAY NOT SIT BEHIND A PATH ROW INTO THE SAME FIELD.
 *
 * `docs/wg-batch-pipeline.md` §B: "scripts/overlay-shape-check.mjs (in `npm run verify`) — no
 * whole-field assignment row may sit at a later index than a `path:[…,'id=…']` row into the same
 * category/id/field."
 *
 * WHY. scripts/lib/apply-backfill.mjs applies the overlay TOP TO BOTTOM, absolute assignment each
 * time. A row with `path: ["subclass","options","id=way-of-the-drifter"]` amends one option inside
 * `classes/gunslinger.subclass`; a later pathless row with `field: "subclass"` replaces that whole
 * object. The amendment is gone, nothing errors, and the only evidence is a field quietly reverting
 * to its imported value — the failure mode this project keeps finding a month late (batch 29 spent
 * a whole pass on eight magus rows that had replaced each other for exactly this reason).
 *
 * The guard is about the LOST AMENDMENT, not about row order as such. So:
 *   · the later whole-field value does NOT carry the path row's value → FAIL, the amendment is dead;
 *   · it carries the identical value → reported as shadowed. The shipped data is right, but the two
 *     rows now have to be edited together, and the next person to touch either one gets no warning.
 *     `classes/gunslinger.subclass` is in that state today.
 *
 * It also reports `description` / `descRefs` rows that route nowhere: prose rows on a record that no
 * longer exists in the shipped artefacts, or carrying a path (prose is never nested, so the walk
 * lands on a sub-object and the row silently reaches nothing).
 *
 * RIDER SHAPE (package I item I11). The same blind spot, one level down: JSON is untyped, so
 * `StrikeDamageRider.dice: { n, die }` (src/rules/types.ts) is only a promise until something reads
 * the data. Four acid flasks stored `{ dice: 2, die: 'd6' }` instead, and derive.ts printed
 * "1 acid plus undefinedundefined persistent acid plus undefinedundefined acid splash" on the Strikes
 * tab — and the test that should have caught it pinned the same wrong shape and matched the broken
 * string with /2d6/. So every `strikeDamage` array, at ANY depth, in every overlay row's value, in every
 * shipped record (public/core.json) and in the two mode files is held to the type through
 * scripts/lib/rider-shape.mjs: dice must be { n: number, die: string }, no stray top-level die/n, no
 * unknown key, an amount of some kind. Exit 1 names the row index or the record path.
 *
 *   node scripts/overlay-shape-check.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill } from './lib/write-backfill.mjs';
import { findBadRiders } from './lib/rider-shape.mjs';

/* PARITY_ROOT relocates the repo root; the tests point it at fixtures so no case reads the real overlay. */
const ROOT = process.env.PARITY_ROOT ? resolve(process.env.PARITY_ROOT) : join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8').replace(/^﻿/, ''));

const rows = readBackfill(ROOT);
const core = readJson('public/core.json');
/* Prose lives in core-descriptions.json since the split; a description row reaches the app through it. */
const descs = existsSync(join(ROOT, 'public/core-descriptions.json')) ? readJson('public/core-descriptions.json') : {};

/** Walk a value the way lib/apply-backfill.mjs backfillTarget does: array steps address by `id=`. */
function walk(node, path) {
  for (const step of path) {
    if (node == null) return undefined;
    if (Array.isArray(node)) {
      const [k, v] = String(step).split('=');
      node = k === 'id' ? node.find((x) => x?.id === v) : undefined;
    } else node = node[step];
  }
  return node;
}

/* category/id/<field the path descends into> → every path row with an `id=` step, in overlay order. */
const idPaths = new Map();
rows.forEach((r, i) => {
  if (!r.path?.length || !r.path.some((s) => String(s).startsWith('id='))) return;
  const k = `${r.category}/${r.id}/${r.path[0]}`;
  if (!idPaths.has(k)) idPaths.set(k, []);
  idPaths.get(k).push({ row: r, index: i });
});

const failures = [];
const shadowed = [];
rows.forEach((r, i) => {
  if (r.path?.length || !r.field || r.create || r.delete) return;
  for (const p of idPaths.get(`${r.category}/${r.id}/${r.field}`) ?? []) {
    if (p.index >= i) continue;
    /* The path row descends INTO this field, so drop its first step before walking the new value. */
    const inside = walk(r.value, p.row.path.slice(1));
    const kept = inside && typeof inside === 'object' ? inside[p.row.field] : undefined;
    const where = `${r.category}/${r.id}.${r.field}`;
    const what = `row #${i} (whole ${r.field}) sits behind row #${p.index} (path [${p.row.path.join(', ')}] field ${p.row.field})`;
    if (kept === undefined || JSON.stringify(kept) !== JSON.stringify(p.row.value)) {
      failures.push(`${where}: ${what} and does NOT carry its value — the amendment is dead. Move the path row after it, or fold its value in.`);
    } else {
      shadowed.push(`${where}: ${what}; the value is identical today, so nothing is lost — but the two rows must be edited together.`);
    }
  }
});

const nowhere = [];
for (const r of rows) {
  if (r.field !== 'description' && r.field !== 'descRefs') continue;
  const where = `${r.category}/${r.id}.${r.field}`;
  if (r.path?.length) { nowhere.push(`${where}: carries path [${r.path.join(', ')}] — prose is never nested, this row reaches nothing.`); continue; }
  if (!core[r.category]?.[r.id] && !descs[r.category]?.[r.id]) nowhere.push(`${where}: no such record in core.json or core-descriptions.json.`);
}

/* RIDER SHAPE — see the header. Overlay rows first (a bad row is the SOURCE; the record is its echo),
 * then every shipped record, then the two data files that feed modes into the app. */
const riderFailures = [];
let ridersSeen = 0;
rows.forEach((r, i) => {
  if (r.value == null) return; // value:null removes a field; there is nothing to hold to a shape
  const where = `overlay row #${i} ${r.category}/${r.id}${r.path?.length ? ` [${r.path.join(', ')}]` : ''}`;
  ridersSeen += r.field === 'strikeDamage'
    ? findBadRiders({ strikeDamage: r.value }, where, riderFailures)
    : findBadRiders(r.value, `${where}.${r.field ?? ''}`, riderFailures);
});
for (const [cat, recs] of Object.entries(core)) {
  if (recs && typeof recs === 'object' && !Array.isArray(recs)) {
    for (const [id, rec] of Object.entries(recs)) ridersSeen += findBadRiders(rec, `core.json ${cat}/${id}`, riderFailures);
  } else ridersSeen += findBadRiders(recs, `core.json ${cat}`, riderFailures);
}
for (const rel of ['scripts/data/consumable-modes.json', 'scripts/data/toggle-modes.json']) {
  if (existsSync(join(ROOT, rel))) ridersSeen += findBadRiders(readJson(rel), rel, riderFailures);
}

console.log(`overlay-shape-check: ${rows.length} rows, ${idPaths.size} field(s) amended by id= path rows.`);
for (const s of shadowed) console.log(`   shadowed  ${s}`);
for (const n of nowhere) console.log(`   nowhere   ${n}`);
if (failures.length || riderFailures.length) {
  if (failures.length) {
    console.error(`\n${failures.length} lost amendment(s):\n`);
    for (const f of failures) console.error(`   ${f}`);
  }
  if (riderFailures.length) {
    console.error(`\n${riderFailures.length} strike-damage rider(s) not in the StrikeDamageRider shape (dice must be { n, die }):\n`);
    for (const f of riderFailures) console.error(`   ${f}`);
    console.error('\nFix the overlay row (re-shape the value; a supersedes row replaces it in place) — see scripts/lib/rider-shape.mjs.');
  }
  process.exit(1);
}
console.log(`OK — no whole-field row destroys a path row (${shadowed.length} shadowed, ${nowhere.length} prose row(s) routing nowhere).`);
console.log(`OK — all ${ridersSeen} strikeDamage rider(s) (overlay + shipped records + mode files) are in the StrikeDamageRider shape.`);
