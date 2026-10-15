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
 * THE INDEX IS DERIVED FROM THE TREES ON DISK (scripts/lib/ast-index.mjs), not from the trees this run
 * added. It used to be the latter, and the trees are written before the index: on 2026-09-29 a regen
 * died on a transient Windows lock at the index write, the re-run found 0 trees to add and added +0
 * slugs, and public/ast-index.json stayed 1,779 slugs short until a full regen. Deriving from the
 * shipped `public/ast/*.json.gz` makes the order of the tree and index writes irrelevant: if a run dies
 * after the .gz trees landed, the next run adds exactly the slugs those trees hold and the index lacks,
 * and a run after that adds none — so the tree writes stay where they are. A slug in several trees takes
 * the lib's rule 4 (never a superseded printing, then the document's own bucket, then the importer's
 * order); `docOf` below gives it the export facts. The old loop's bucket choice was run-dependent (it
 * walked `perBucket` after the report sorted it in place by trees added in the run); replayed on the last
 * full chain it and rule 4 give the same 1,779 entries, byte for byte (the lib's header), so this changes
 * no pick this step makes. scripts/ast-index-check.mjs (npm run verify) fails an index that is short.
 *
 * …and the trees are READ FROM THE SHIPPED .gz, the plain `<bucket>.json` only when no readable .gz
 * exists. Each tree write is plain first, then .gz. Reading the plain file first meant that a run which
 * died between the two (the same transient lock, on the .gz) left a plain file WITH the new tree and a
 * .gz WITHOUT it: the re-run saw the tree, added 0, never rewrote the .gz, and the shipped file — which
 * the index rule and the guard also read — stayed short. Now the re-run sees the .gz lack it and adds it
 * again; a .gz that exists but will not parse is rebuilt from the plain copy (`stale`). The ORDER of the
 * tree and index writes is unchanged; this read order and `stale` are the only change to the tree path,
 * made because a resumed tail must be a fixed point for the trees too, not just the index (proven
 * 2026-09-29: with the plain file read first, a .gz three trees short stayed short across re-runs).
 * What this does NOT make a fixed point: a run that dies after scripts/data/effect-backfill.json gained
 * an `edition` row but before public/core.json was written — the re-run skips the row (`hasRow`) and
 * core.json lacks that edition until the next full `npm run data`.
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
import { REGEN_DIFFERS, makeDocOf, refreshIndexFile } from './lib/ast-index.mjs';

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

/** The shipped .gz first (see the header); `stale` = a .gz exists but did not parse, so it must be rewritten. */
const readAst = (bucket) => {
  const gz = join(ROOT, `public/ast/${bucket}.json.gz`);
  if (existsSync(gz)) { try { return { ast: JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8')), stale: false }; } catch { /* rebuild from the plain copy */ } }
  const plain = join(ROOT, `public/ast/${bucket}.json`);
  if (existsSync(plain)) { try { return { ast: JSON.parse(readFileSync(plain, 'utf8')), stale: existsSync(gz) }; } catch { /* none */ } }
  return null;
};

const rows = readBackfill(ROOT);
const hasRow = (category, id, field) => rows.some((r) => r.category === category && r.id === id && r.field === field);

const perBucket = [];
let astAdded = 0, edAdded = 0, noDoc = 0, docNoAst = 0, implausible = 0, lnSet = 0;

for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object') continue;
  const read = readAst(bucket);
  if (!read) continue;                      // bucket has no ast file: not this script's business
  const { ast, stale } = read;
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
  if (bAst || bEd || stale) {
    perBucket.push({ bucket, bAst, bEd, stale, total: Object.keys(ast).length });
    if (WRITE && (bAst || stale)) {
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
    console.log(`  ${b.bucket.padEnd(22)} +${String(b.bAst).padStart(4)} ast   +${String(b.bEd).padStart(4)} edition   (bucket now ${b.total} trees)`
      + (b.stale ? '   .json.gz unreadable: rebuilt from the plain .json' : ''));
  }
}

// The ast-index maps a bare slug to its preferred bucket, derived from EVERY tree on disk (see the
// header): additive only, the pages import-core-v2's step 5 created are never indexed (they open by
// key — createdRefs), and a slug with trees in two buckets takes the lib's rule 4 — never a superseded
// printing, then the document's own bucket, then the importer's order. The rule lives in
// scripts/lib/ast-index.mjs; `docOf` gives it each tree's document (the `aon` on its root) from the
// export this script already reads.
const docOf = makeDocOf({ docIndex, fullDoc });
const indexStep = { indexPath: join(ROOT, 'public/ast-index.json'), astDir: join(ROOT, 'public/ast'), exclude: createdRefs(ROOT), docOf };
// Rule 4 re-derives every entry THIS step writes exactly (the lib's header: all 1,779 of the last full
// chain, so a resumed tail is byte-identical). It cannot re-derive 9 entries the EARLIER import steps
// write — the lib pins them (REGEN_DIFFERS) and scripts/ast-index-check.mjs fails an index that holds one
// under another bucket; only an index that lost some of theirs can reach them. Say how many added slugs
// were a choice among several buckets and name any pinned one placed off its pin, so such a repair says
// it is not the chain's before the guard fails it. The pin is read for this line only, never for a pick.
const sayAmbiguous = ({ ambiguous }) => {
  if (!ambiguous.length) return;
  const off = ambiguous.filter((a) => REGEN_DIFFERS[a.slug] && REGEN_DIFFERS[a.slug].pinned !== a.bucket)
    .map((a) => `${a.slug} -> ${a.bucket} (pinned: ${REGEN_DIFFERS[a.slug].pinned})`);
  console.log(`  ${ambiguous.length} of them had trees in several buckets and were placed by scripts/lib/ast-index.mjs rule 4; `
    + (off.length ? `${off.length} of those ${off.length === 1 ? 'is a pinned slug' : 'are pinned slugs'} the chain writes under another bucket; scripts/ast-index-check.mjs fails ${off.length === 1 ? 'it' : 'them'} until a full npm run data (or the committed index) restores the pin: ${off.join('; ')}`
      : 'none is one of the 9 pinned slugs where that rule differs from the chain'));
};

if (!WRITE) {
  const r = refreshIndexFile(indexStep);
  console.log(`ast-index slugs to add (derived from the trees on disk): ${r.added.length}`);
  sayAmbiguous(r);
  console.log('\nreport only — pass --write to apply.'); process.exit(0);
}

const idx = refreshIndexFile({ ...indexStep, write: true });

if (edAdded) writeBackfill(ROOT, rows);
writeFileSync(CORE, JSON.stringify(core));
const treesWritten = perBucket.filter((b) => b.bAst || b.stale).length;
console.log(`\nwrote public/ast/* (${treesWritten} bucket${treesWritten === 1 ? '' : 's'}), public/ast-index.json (+${idx.added.length} slugs${idx.wrote ? '' : ', file unchanged'}; ${idx.total} in all), public/core.json`
  + (edAdded ? ', scripts/data/effect-backfill.json' : ''));
sayAmbiguous(idx);
