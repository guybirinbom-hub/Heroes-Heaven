/*
 * MEASURE (report-only; writes nothing): which public/ast-index.json entries open a SUPERSEDED page, split
 * by the chain step that wrote them, and whether another bucket holds a live tree for the slug.
 *
 * It backs scripts/lib/ast-index.mjs rule 4a's rationale (header): tier 4a only ORDERS candidates, so a
 * full chain's index still opens superseded pages, and for all but one of them no other bucket holds a
 * live (not superseded) tree to prefer. Measured 2026-09-30 on the committed index (11fa92a): 365 of
 * 23,042 entries open a page carrying `superseded_by` — 85 written by the steps before
 * backfill-ast-edition.mjs, 280 by backfill itself — and 1 has a live tree in another bucket: strigoi
 * (sidebar-1126, superseded_by ancestry-85; live in trait).
 *
 * HOW. For each index entry, the tree root's `aon` in `public/ast/<bucket>.json.gz` (readAstTrees) is looked
 * up in the archive export (exportDocOf: `superseded_by`). The split: the entries backfill-ast-edition.mjs
 * wrote are the 1,779 slugs listed in scripts/data/ast-index-backfill-slugs.json — the committed index
 * minus the 21,263-entry index the 2026-09-29 `npm run data` left on disk when it died at backfill's index
 * write, the same subtraction the lane's tail-resume proof made. That incident index was never in the repo,
 * so the list is recorded there (see its "_"); every other entry is a pre-backfill step's. If the index has
 * moved since (a full regen), the list may no longer be backfill's exact share: the script says how many
 * listed slugs the index still holds, and the split is then only approximate.
 *
 *   node scripts/ast-index-superseded-split.mjs
 *   AON_EXPORT=<export data dir> node scripts/ast-index-superseded-split.mjs   # default: the one backfill-ast-edition.mjs reads
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportDocOf, readAstTrees } from './lib/ast-index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';

const index = JSON.parse(readFileSync(join(ROOT, 'public/ast-index.json'), 'utf8'));
const trees = readAstTrees(join(ROOT, 'public/ast'));
const docOf = exportDocOf(EXPORT);
const listed = JSON.parse(readFileSync(join(ROOT, 'scripts/data/ast-index-backfill-slugs.json'), 'utf8')).slugs;
const backfillSlugs = new Set(listed);

const sup = (aon) => (aon ? docOf(aon)?.supersededBy ?? null : null);
const out = { earlier: [], backfill: [] };
const withLive = { earlier: [], backfill: [] };
for (const [slug, b] of Object.entries(index)) {
  const aon = trees[b]?.[slug];
  const s = sup(aon);
  if (!s) continue;
  const live = Object.keys(trees).filter((o) => o !== b && trees[o]?.[slug] && !sup(trees[o][slug]));
  const who = backfillSlugs.has(slug) ? 'backfill' : 'earlier';
  const line = `${slug} -> ${b} (${aon}, superseded_by ${s})${live.length ? ` LIVE ALT: ${live.map((o) => `${o} (${trees[o][slug]})`).join(', ')}` : ''}`;
  out[who].push(line);
  if (live.length) withLive[who].push(line);
}

const held = listed.filter((s) => Object.prototype.hasOwnProperty.call(index, s)).length;
const total = Object.keys(index).length;
console.log(`ast-index: ${total} entries; backfill-written list (scripts/data/ast-index-backfill-slugs.json): ${listed.length} slugs, ${held} in the index; pre-backfill steps: ${total - held}`);
if (held !== listed.length || total - held !== 21263) {
  console.log('  NOTE: the index is no longer the 11fa92a one this list was cut against (23,042 = 21,263 + 1,779); the split below is approximate.');
}
console.log(`superseded-page entries: ${out.earlier.length + out.backfill.length} (pre-backfill steps ${out.earlier.length}, backfill ${out.backfill.length})`);
console.log(`  of them with a live tree in another bucket: pre-backfill ${withLive.earlier.length}, backfill ${withLive.backfill.length}`);
for (const [k, name] of [['earlier', 'pre-backfill steps'], ['backfill', 'backfill-ast-edition.mjs']]) {
  console.log(`-- ${name}: first 10, then every one with a live alternative (*)`);
  for (const h of out[k].slice(0, 10)) console.log('  ' + h);
  for (const h of withLive[k]) console.log('  * ' + h);
}
