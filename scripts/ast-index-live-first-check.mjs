/*
 * GUARD (npm run verify): no public/ast-index.json entry opens a SUPERSEDED page while a live page holds a tree
 * for the same slug.
 *
 * WHY (2026-09-30, the regenerating lane's refuter). The strigoi fix moved the importer's INDEX_ORDER pass onto
 * scripts/lib/ast-index.mjs `liveFirst` (rule 4a: a page the Archives mark `superseded_by` never wins while a
 * live page is a candidate; gold-set R12, "the newest printing wins, whole"). The fix took strigoi OUT of
 * REGEN_DIFFERS, so scripts/ast-index-check.mjs stopped looking at that slug: the pre-lane index, strigoi still
 * on sidebar-1126 (superseded_by ancestry-85) while trait-854 is live, passed it. Only a vitest case naming
 * strigoi held the fix, and nothing held the rule. This fails the rule, for every slug.
 *
 * THE RULE, over the files that ship. For each index entry, its candidates are every bucket whose tree
 * (`public/ast/<bucket>.json.gz`) holds the slug, the indexed one first; each tree's `aon` is looked up in the
 * archive export (`exportDocOf`). The entry fails when `liveFirst` moves it off the top — which it does exactly
 * when the indexed page is superseded and some other candidate is live. Superseded entries with NO live
 * alternative are not failures (the tier only orders; measured 2026-09-30: 364 such entries, 0 with a live
 * alternative — scripts/ast-index-superseded-split.mjs reports the same split).
 *
 *   node scripts/ast-index-live-first-check.mjs
 *   AST_INDEX=<index.json> AST_DIR=<dir of *.json.gz> AON_EXPORT=<export data dir> node scripts/ast-index-live-first-check.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exportDocOf, liveFirst, readAstTrees } from './lib/ast-index.mjs';

/**
 * Every index entry whose page is superseded while a live candidate exists: [{ slug, bucket, aon, supersededBy,
 * live: [{ bucket, aon }] }], sorted by slug. `trees` is readAstTrees' shape; `docOf(aon)` -> { supersededBy } | null.
 * Pure.
 */
export function supersededOverLive(index, trees, docOf) {
  const out = [];
  for (const slug of Object.keys(index).sort()) {
    const bucket = index[slug];
    const aon = trees[bucket]?.[slug];
    if (!aon) continue; // a dangling entry is scripts/ast-index-check.mjs's failure, not this one's
    const cands = [{ bucket, aon }];
    for (const b of Object.keys(trees).sort()) if (b !== bucket && trees[b]?.[slug]) cands.push({ bucket: b, aon: trees[b][slug] });
    if (cands.length < 2) continue;
    const first = liveFirst(cands, docOf)[0];
    if (first === cands[0]) continue;
    const sup = (c) => docOf(String(c.aon))?.supersededBy ?? null;
    out.push({ slug, bucket, aon, supersededBy: sup(cands[0]), live: cands.slice(1).filter((c) => !sup(c)) });
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const INDEX = resolve(process.env.AST_INDEX || join(ROOT, 'public/ast-index.json'));
  const AST_DIR = resolve(process.env.AST_DIR || join(ROOT, 'public/ast'));
  const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
  if (!existsSync(INDEX)) { console.error(`ast-index-live-first: FAIL — ${INDEX} does not exist`); process.exit(1); }
  if (!existsSync(EXPORT)) {
    console.error(`ast-index-live-first: FAIL — the archive export ${EXPORT} is missing; the rule reads each page's superseded_by from it (set AON_EXPORT).`);
    process.exit(1);
  }
  const index = JSON.parse(readFileSync(INDEX, 'utf8'));
  const hits = supersededOverLive(index, readAstTrees(AST_DIR), exportDocOf(EXPORT));
  if (hits.length) {
    console.log(`ast-index-live-first: FAIL — ${hits.length} index entr${hits.length === 1 ? 'y opens a superseded page' : 'ies open a superseded page'} while a live page holds a tree for the slug (gold-set R12; scripts/lib/ast-index.mjs rule 4a):`);
    for (const h of hits) console.log(`  ${h.slug} -> ${h.bucket} (${h.aon}, superseded_by ${h.supersededBy}); live: ${h.live.map((c) => `${c.bucket} (${c.aon})`).join(', ')}`);
    console.log('\nThe chain writes these through liveFirst (import-core-v2 INDEX_ORDER pass, backfill-ast-edition deriveIndex); an entry here was written around it.');
    process.exit(1);
  }
  console.log(`ast-index-live-first: OK — ${Object.keys(index).length} entries; none opens a superseded page while a live page holds the slug`);
}
