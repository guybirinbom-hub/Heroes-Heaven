/**
 * Give every record the display tree and edition its own archive document already holds — and the
 * names that document says it was printed under before (`legacyNames`, see the loop below).
 *
 * `public/ast/<bucket>.json` is written by import-core-v2.mjs from its mirror scan, keyed by SLUG and
 * only for the categories that map to a first-class bucket. A record that reached its bucket by another
 * route gets prose but no tree, and no `edition`:
 *
 *     the 30 commander tactics  ->  core.actions (playable, with actionCost + tacticTier)
 *                               ->  their ast is written under the `tactic` REFERENCE bucket instead
 *
 * `useAst.ts` resolves an ast by the bucket the caller passes, falling back to the slug→bucket index.
 * So whether a tactic renders its tree or its plain-text fallback depends on which key the opener
 * happened to pass — the sheet's action row passes `actions`, and misses. Measured by
 * scripts/process-parity.mjs: new actions at 25% ast / 25% edition against 62% / 63% for the rest.
 *
 * The tree is not rebuilt here. The export document already carries a parsed `ast`, produced by the same
 * pipeline as every other tree in public/ast, so this copies it and re-points internal links through
 * public/idmap.json exactly as the two importers do.
 *
 * Additive and idempotent: never overwrites an ast a record already has, and never touches a record
 * whose aonId resolves to nothing.
 *
 * ORDER MATTERS — must run AFTER import-core-v2 and import-siege-and-gaps, which rewrite the ast files
 * wholesale. It is the last data step for that reason.
 *
 *   node scripts/backfill-ast-edition.mjs            # report only
 *   node scripts/backfill-ast-edition.mjs --write
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';
import { buildDocIndex, resolveDoc, linkIsPlausible } from './lib/aonid-categories.mjs';
import { createdRefs } from './lib/archive-coverage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
const WRITE = process.argv.includes('--write');

const CORE = join(ROOT, 'public/core.json');
const core = JSON.parse(readFileSync(CORE, 'utf8'));
const idMap = existsSync(join(ROOT, 'public/idmap.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'public/idmap.json'), 'utf8')) : {};

/** aonId -> {cat,name}, read from every category file (never derived from the id prefix). */
const docIndex = buildDocIndex(EXPORT, { readFileSync, readdirSync, join });

/** The full documents, loaded per category on demand — we need `.ast` and `.edition`, not just names. */
const docsCache = new Map();
const fullDoc = (cat, id) => {
  if (!docsCache.has(cat)) {
    const p = join(EXPORT, cat + '.json');
    let docs = {};
    try { docs = JSON.parse(readFileSync(p, 'utf8')).docs ?? {}; } catch { /* leave empty */ }
    docsCache.set(cat, docs);
  }
  return docsCache.get(cat)[id];
};

/** Rewrite in-tree links to "bucket:slug" so they open a popup instead of rendering as dead text. */
const resolveTo = (to) => {
  const hit = idMap[to];
  return hit && core[hit.bucket]?.[hit.slug] ? `${hit.bucket}:${hit.slug}` : null;
};
const resolveAst = (node) => {
  if (!node || typeof node !== 'object') return node;
  const out = Array.isArray(node) ? [] : {};
  for (const k in node) {
    if (k === 'to') { out.ref = resolveTo(node.to); out.to = node.to; }
    else if (k === 'c') out.c = node.c.map(resolveAst);
    else out[k] = node[k];
  }
  return out;
};

const readAst = (bucket) => {
  const plain = join(ROOT, `public/ast/${bucket}.json`);
  if (existsSync(plain)) { try { return JSON.parse(readFileSync(plain, 'utf8')); } catch { /* fall through */ } }
  const gz = join(ROOT, `public/ast/${bucket}.json.gz`);
  if (existsSync(gz)) { try { return JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8')); } catch { /* none */ } }
  return null;
};

const rows = readBackfill(ROOT);
const hasRow = (category, id, field) => rows.some((r) => r.category === category && r.id === id && r.field === field);

const perBucket = [];
let astAdded = 0, edAdded = 0, noDoc = 0, docNoAst = 0, implausible = 0, lnSet = 0;

for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object') continue;
  const ast = readAst(bucket);
  if (!ast) continue;                       // bucket has no ast file: not this script's business
  const entries = Object.entries(recs).filter(([, r]) => r && typeof r === 'object' && r.aonId);
  if (!entries.length) continue;

  let bAst = 0, bEd = 0;
  for (const [id, rec] of entries) {
    const { doc, via } = resolveDoc(docIndex, rec.aonId);
    if (!doc) { noDoc++; continue; }
    // Never import content across a bad link — same rule the stamper and the integrity check use.
    if (!linkIsPlausible(bucket, doc.cat, id)) { implausible++; continue; }
    const full = fullDoc(doc.cat, via);
    if (!full) { noDoc++; continue; }

    if (!ast[id]) {
      if (full.ast) {
        ast[id] = resolveAst(full.ast);
        /* Provenance — see scripts/ast-provenance-check.mjs. `via` is what resolveDoc actually found:
         * usually rec.aonId itself, but for a graded/synthetic id it is the BASE page the tree really
         * came from (equipment-5194-4715 -> equipment-5194). The guard accepts the base because every
         * resolveDoc candidate is a prefix of the id asked for. */
        ast[id].aon = via;
        bAst++; astAdded++;
      } else docNoAst++;
    }
    if (!rec.edition && full.edition && !hasRow(bucket, id, 'edition')) {
      rows.push({ category: bucket, id, field: 'edition', value: full.edition });
      rec.edition = full.edition;
      bEd++; edAdded++;
    }
    /*
     * …and the NAMES its page says it was printed under before (`data.legacy_name`): Searing Blade is
     * the reprint of Flame Tongue, Vitalizing of Disrupting. The record takes the reprint's name
     * (gold-set R12), so a player searching the Core Rulebook name found nothing — the pickers search
     * the name and the text, and neither says "Flame Tongue". The Archives' own search answers to these
     * names, so the pickers read them too (`legacyNames`, src/sheet/filterSpecs.ts). A case-only
     * difference is the Archives re-casing a heading, not another name. Recomputed from the record's
     * FINAL page on every run — this is the first step after scripts/fix-aonid-collisions.mjs — so a
     * repoint takes its names along and a stale list never outlives its page.
     */
    const was = [...new Set([].concat(full.data?.legacy_name ?? []).map((n) => String(n).trim())
      .filter((n) => n && n.toLowerCase() !== String(rec.name ?? '').trim().toLowerCase()))];
    if (was.length) {
      if (JSON.stringify(rec.legacyNames) !== JSON.stringify(was)) { rec.legacyNames = was; lnSet++; }
    } else if (rec.legacyNames) { delete rec.legacyNames; lnSet++; }
  }
  if (bAst || bEd) {
    perBucket.push({ bucket, bAst, bEd, total: Object.keys(ast).length });
    if (WRITE && bAst) {
      const ordered = {};
      for (const s of Object.keys(ast).sort()) ordered[s] = ast[s];
      const json = JSON.stringify(ordered);
      writeFileSync(join(ROOT, `public/ast/${bucket}.json`), json);
      writeFileSync(join(ROOT, `public/ast/${bucket}.json.gz`), gzipSync(json, { level: 9 }));
    }
  }
}

console.log(`ast trees to add : ${astAdded}`);
console.log(`editions to add  : ${edAdded}`);
console.log(`legacy names set or cleared: ${lnSet}`);
console.log(`(aonId resolves to nothing: ${noDoc};  document carries no ast: ${docNoAst};  link implausible, skipped: ${implausible})`);
if (perBucket.length) {
  console.log('\nper bucket:');
  for (const b of perBucket.sort((x, y) => y.bAst - x.bAst)) {
    console.log(`  ${b.bucket.padEnd(22)} +${String(b.bAst).padStart(4)} ast   +${String(b.bEd).padStart(4)} edition   (bucket now ${b.total} trees)`);
  }
}

if (!WRITE) { console.log('\nreport only — pass --write to apply.'); process.exit(0); }

// The ast-index maps a bare slug to its preferred bucket. Additive only: re-pointing an existing slug
// would move an unrelated record's popup to a different bucket. The pages import-core-v2's step 5
// created share these bucket files and are never indexed (they open by key — createdRefs).
const indexPath = join(ROOT, 'public/ast-index.json');
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
const created = createdRefs(ROOT);
let idxAdded = 0;
for (const { bucket } of perBucket) {
  const ast = readAst(bucket);
  for (const s of Object.keys(ast ?? {})) if (!(s in index) && !created.has(`${bucket}:${s}`)) { index[s] = bucket; idxAdded++; }
}
const orderedIndex = {};
for (const s of Object.keys(index).sort()) orderedIndex[s] = index[s];
writeFileSync(indexPath, JSON.stringify(orderedIndex));

if (edAdded) writeBackfill(ROOT, rows);
writeFileSync(CORE, JSON.stringify(core));
console.log(`\nwrote public/ast/*, public/ast-index.json (+${idxAdded} slugs), public/core.json` + (edAdded ? ', scripts/data/effect-backfill.json' : ''));
