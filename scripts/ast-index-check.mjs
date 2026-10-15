/*
 * GUARD: EVERY RECORD WITH AN AST TREE IS IN public/ast-index.json, AND EVERY ENTRY NAMES A TREE.
 *
 * The index is how a description opened by its title alone finds its tree (src/sheet/astStore.ts
 * `bucketOf`); a slug it lacks renders its plain-text fallback. On 2026-09-29 a `npm run data` died on a
 * transient Windows lock (errno -4094) at scripts/backfill-ast-edition.mjs's index write, after the trees
 * were on disk; the re-run tail added +0 slugs and the index stayed 1,779 slugs short (23,042 -> 21,263;
 * items 1,009, classFeatures 212, feats 189, actions 114 ...). Nothing in `npm run verify` noticed —
 * regen-durability-check, archive-coverage-check and readable-record-check do not measure the index's
 * completeness. This does.
 *
 * FAILS (exit 1), listing bucket/slug and a per-bucket count, when
 *   MISSING  — a slug of a tree `public/ast/<bucket>.json.gz` is missing from the index, unless
 *     (a) it is a CREATED record of that bucket — scripts/lib/archive-coverage.mjs createdRefs; those open
 *         by key only and archive-coverage-check fails an index that names one; or
 *     (b) the slug is already indexed under another bucket — the index is additive and one slug has one
 *         entry;
 *   DANGLING — an index entry names a bucket whose tree lacks that slug: `bucketOf` has no fallback, so
 *     that popup finds no tree and renders plain text, and the additive derivation never re-points it.
 *   PINNED   — one of the 8 multi-bucket slugs pinned in scripts/lib/ast-index.mjs `REGEN_DIFFERS` is
 *     indexed under a bucket other than its pin, or is missing. Those 8 are the only slugs whose committed
 *     bucket the derivation cannot re-derive from the files on disk (measured 2026-09-30: the whole index
 *     rebuilt from empty, 23,042 slugs, differs in exactly these 8 (9 on 2026-09-29; strigoi left on
 *     2026-09-30 when the importer began applying the newest-printing rule at index time)): which chain step
 *     indexed each first is written nowhere. A loss the chain produces (a tail resume) never reaches them; an
 *     arbitrary loss that does comes back under the other bucket, and a title-only popup would open another
 *     page (7 of the 8, measured 2026-09-30; dream-hunters-lodge's two buckets hold the same page). The printed
 *     counts are derived, never typed: the pin count from REGEN_DIFFERS, and the different-page count from
 *     the trees on disk (a pin whose pinned and derived trees carry different Archives page ids, `aon`).
 *     This fails that instead of shipping it. Under AST_INDEX / AST_DIR (a scratch copy) a pinned slug
 *     with no tree and no entry in the copy is skipped and named; on the shipped files it fails as a
 *     stale pin.
 * The rule is scripts/lib/ast-index.mjs (`missingFromIndex`, `danglingEntries`, `REGEN_DIFFERS`). The
 * repair for MISSING is the step that derives the index from the same files:
 * `node scripts/backfill-ast-edition.mjs --write`. A DANGLING entry is not re-derived by that step (additive
 * only), nor is a PINNED one: a full `npm run data` rebuilds the index (or, when only the index was damaged,
 * recover public/ast-index.json by writing it from `git show HEAD:public/ast-index.json`). A pin that a full regen
 * legitimately moved is updated in the lib with its reason, never silently.
 *
 * On success it prints the total slug count, the per-bucket counts and "8 multi-bucket slugs pinned, all in
 * place" (the number is Object.keys(REGEN_DIFFERS).length).
 *
 *   node scripts/ast-index-check.mjs
 *   AST_INDEX=<index.json> AST_DIR=<dir of *.json.gz> node scripts/ast-index-check.mjs   # a scratch copy
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createdRefs } from './lib/archive-coverage.mjs';
import { REGEN_DIFFERS, danglingEntries, missingFromIndex, readAstTrees } from './lib/ast-index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = resolve(process.env.AST_INDEX || join(ROOT, 'public/ast-index.json'));
const AST_DIR = resolve(process.env.AST_DIR || join(ROOT, 'public/ast'));
const SCRATCH_COPY = Boolean(process.env.AST_INDEX || process.env.AST_DIR);

if (!existsSync(INDEX)) { console.error(`AST-INDEX: ${INDEX} does not exist`); process.exit(1); }
const index = JSON.parse(readFileSync(INDEX, 'utf8'));
const pages = readAstTrees(AST_DIR); // { bucket: { slug: Archives page id | null } }
const trees = Object.fromEntries(Object.entries(pages).map(([b, m]) => [b, Object.keys(m)])); // readAstSlugs' shape
const created = createdRefs(ROOT);

const tally = (pairs) => {
  const n = {};
  for (const b of pairs) n[b] = (n[b] ?? 0) + 1;
  return Object.entries(n).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([b, c]) => `${b} ${c}`).join(', ');
};

let treeSlugs = 0, asCreated = 0, underOther = 0;
for (const [bucket, slugs] of Object.entries(trees)) {
  for (const s of slugs) {
    treeSlugs++;
    if (index[s] === bucket) continue;
    if (created.has(`${bucket}:${s}`)) asCreated++;
    else if (Object.prototype.hasOwnProperty.call(index, s)) underOther++;
  }
}
const missing = missingFromIndex(index, trees, created);
const dangling = danglingEntries(index, trees);

// PINNED: each of REGEN_DIFFERS's slugs must be indexed under its pin. Every count printed about the pins
// derives from REGEN_DIFFERS (Object.keys(REGEN_DIFFERS).length), so a pin leaving the lib cannot leave a stale number.
const pins = Object.entries(REGEN_DIFFERS);
// Which pins would open a DIFFERENT page if re-derived is read from the trees on disk, never typed: a pin
// opens the same page when its pinned and derived trees carry the same Archives page id (`aon`). A pin
// whose tree or page id is absent from this copy is counted as neither.
const pageOf = (bucket, slug) => pages[bucket]?.[slug] ?? null;
const pinPages = pins.map(([slug, { pinned, derived }]) => [pageOf(pinned, slug), pageOf(derived, slug)]);
const otherPage = pinPages.filter(([a, b]) => a && b && a !== b).length;
const unmeasured = pinPages.filter(([a, b]) => !a || !b).length;
const holders = (s) => Object.keys(trees).filter((b) => trees[b].includes(s)).sort();
const pinFails = [], pinSkipped = [];
for (const [slug, { pinned, derived }] of pins) {
  const has = holders(slug);
  const at = Object.prototype.hasOwnProperty.call(index, slug) ? index[slug] : null;
  if (at === pinned) continue;
  if (at != null) pinFails.push(`  PINNED ${slug}: indexed under ${at}, pinned to ${pinned}`
    + (at === derived ? ` (${derived} is the bucket the derivation picks; the chain writes ${pinned})` : ''));
  else if (has.length) pinFails.push(`  PINNED ${slug}: missing from the index, pinned to ${pinned} (trees in ${has.join(', ')})`);
  else if (SCRATCH_COPY) pinSkipped.push(slug);
  else pinFails.push(`  PINNED ${slug}: missing from the index and no tree holds it: a stale pin to ${pinned}`
    + ' — if a full npm run data removed it, drop it from REGEN_DIFFERS with the reason');
}

console.log(`ast-index: ${Object.keys(index).length} slugs; ${Object.keys(trees).length} bucket trees hold ${treeSlugs} slugs `
  + `(${asCreated} created, not indexed; ${underOther} indexed under another bucket); dangling entries: ${dangling.length}`);

if (missing.length) {
  const slugs = new Set(missing.map((m) => m.slug)).size;
  console.error(`\nAST-INDEX: ${slugs} slug(s) with an ast tree are missing from ${INDEX}`
    + (slugs === missing.length ? '' : ` (${missing.length} bucket/slug trees: a slug with trees in several buckets is listed under each)`));
  console.error(`  per bucket: ${tally(missing.map((m) => m.bucket))}`);
  for (const { bucket, slug } of missing) console.error(`  MISSING ${bucket}/${slug}`);
  console.error('\n  A title-only popup of each renders plain text. Repair: node scripts/backfill-ast-edition.mjs --write'
    + ' (derives the index from the trees on disk; scripts/lib/ast-index.mjs).');
}
if (dangling.length) {
  console.error(`\nAST-INDEX: ${dangling.length} entr${dangling.length === 1 ? 'y' : 'ies'} of ${INDEX} name${dangling.length === 1 ? 's' : ''} a bucket whose tree lacks the slug`);
  console.error(`  per bucket: ${tally(dangling.map((d) => d.bucket))}`);
  for (const { bucket, slug } of dangling) console.error(`  DANGLING ${slug} -> ${bucket}`);
  console.error('\n  A title-only popup of each finds no tree (astStore.ts bucketOf has no fallback) and renders plain text.'
    + ' The additive derivation never re-points an entry; a full npm run data rebuilds the index.');
}
if (pinFails.length) {
  console.error(`\nAST-INDEX: ${pinFails.length} of the ${pins.length} pinned multi-bucket slugs ${pinFails.length === 1 ? 'is' : 'are'} not under ${pinFails.length === 1 ? 'its' : 'their'} pin in ${INDEX}`);
  for (const line of pinFails) console.error(line);
  console.error('\n  These are the slugs whose committed bucket cannot be re-derived from the files on disk (scripts/lib/ast-index.mjs'
    + ' REGEN_DIFFERS says why each pin wins). A title-only popup opens the other bucket\'s tree, a different page for '
    + `${otherPage} of the ${pins.length}`
    + (unmeasured ? ` (${unmeasured} not measurable in this copy: a tree or its page id is absent)` : '')
    + '. Repair: a full npm run data,'
    + ' or, when only the index was damaged, recover public/ast-index.json by writing it from `git show HEAD:public/ast-index.json`.'
    + ' If a full regen moved a pin legitimately, update REGEN_DIFFERS with the reason, never silently.');
}
if (missing.length || dangling.length || pinFails.length) process.exit(1);
console.log(`ast-index per bucket: ${tally(Object.values(index))}`);
console.log(pinSkipped.length
  ? `${pins.length - pinSkipped.length} of the ${pins.length} pinned multi-bucket slugs are in this copy, all in place (no tree or entry here: ${pinSkipped.join(', ')})`
  : `${pins.length} multi-bucket slugs pinned, all in place`);
console.log('ast-index-check: OK — every record with an ast tree is indexed (created records aside), every entry names a bucket whose tree holds it, and every pinned slug is under its pin.');
