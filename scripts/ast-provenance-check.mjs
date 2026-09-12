/*
 * GUARD: every shipped description page was built from the record's OWN archive document.
 *
 * The full-page popups are the trees in public/ast/<bucket>.json.gz. They used to be picked per SLUG
 * by edition rank, independently of the document the record itself was built from — so when two
 * archive documents shared a name, the wrong page shipped under the right name and nothing said so.
 * Measured on the tracked artefact before this guard existed: items/dragon-pearl is equipment-4011
 * (Draconic Codex, 9,000 gp, level 16) and rendered equipment-3482 (Tian Xia Character Guide, 180 gp,
 * level 10) in full.
 *
 * Every writer of public/ast now stamps the page's tree root with `aon` — the archive document id the
 * tree was copied from (import-core-v2, import-siege-and-gaps, import-new-classes,
 * import-archive-buckets, fix-aonid-collisions, backfill-ast-edition). This compares that stamp with
 * the record's own `aonId` in public/core.json.
 *
 * THE RULES
 *   • scope: records carrying `aonId` that have a page in their own bucket. A record stamped
 *     `aonParentId` (a subblock/table/derived record, whose content is a SECTION of a bigger page) or
 *     `aonOrigin: 'authored'` has no page of its own to compare against and is counted, not checked.
 *   • a stamp equal to the record's aonId passes.
 *   • a stamp that is a PREFIX of the record's aonId passes, and is reported separately: that is
 *     backfill-ast-edition.mjs pulling the base page for a graded/synthetic id, which resolveDoc()
 *     in scripts/lib/aonid-categories.mjs does by design (equipment-5194-4715 -> equipment-5194).
 *     Every candidate resolveDoc tries is a prefix of the id it was asked for, so the prefix test is
 *     exactly "the page the resolver would have found", with no need to load the export.
 *   • an UNSTAMPED page fails as soon as ANY page in its bucket carries a stamp. That is what stops a
 *     bucket that a regen skipped from passing on the strength of its age: the moment one page in it
 *     is rewritten, the rest must be too. A bucket with NO stamps at all predates the stamp entirely
 *     and is reported as not checked — which is what the whole tree looked like before the regen that
 *     introduced this file.
 *
 * Reads the TRACKED public/ast/<bucket>.json.gz, never the gitignored raw .json beside it, so it
 * measures what actually ships. AST_DIR overrides the directory (used to prove the guard goes red
 * against a mutated scratch copy).
 *
 *   node scripts/ast-provenance-check.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AST_DIR = process.env.AST_DIR || join(ROOT, 'public/ast');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const buckets = existsSync(AST_DIR)
  ? readdirSync(AST_DIR).filter((f) => f.endsWith('.json.gz')).map((f) => f.slice(0, -8))
  : [];
if (!buckets.length) {
  console.error(`ast-provenance: FAIL — no <bucket>.json.gz found in ${AST_DIR}`);
  process.exit(1);
}

const rows = [];
const bad = [];
let unstampedBuckets = 0, parentOnly = 0, authored = 0, prefix = 0;

for (const bucket of buckets) {
  const tree = JSON.parse(gunzipSync(readFileSync(join(AST_DIR, `${bucket}.json.gz`))).toString('utf8'));
  const recs = core[bucket];
  if (!recs || typeof recs !== 'object') continue;

  const stamped = Object.values(tree).filter((p) => p && typeof p === 'object' && p.aon).length;
  let checked = 0, ok = 0, pre = 0, missing = 0, wrong = 0;

  for (const [slug, rec] of Object.entries(recs)) {
    if (!rec || typeof rec !== 'object') continue;
    const page = tree[slug];
    if (!page || typeof page !== 'object') continue;
    if (!rec.aonId) {
      if (rec.aonParentId) parentOnly++;
      else if (rec.aonOrigin) authored++;
      continue;
    }
    checked++;
    const want = String(rec.aonId);
    const got = page.aon ? String(page.aon) : null;
    if (!got) {
      if (!stamped) continue;             // whole bucket predates the stamp — reported below, not failed
      missing++;
      if (bad.length < 4000) bad.push(`${bucket}/${slug}  page carries NO provenance; record is ${want}`);
    } else if (got === want) ok++;
    else if (want.startsWith(`${got}-`)) { pre++; prefix++; }
    else {
      wrong++;
      bad.push(`${bucket}/${slug}  page built from ${got}; record is ${want}`);
    }
  }

  if (!stamped && checked) unstampedBuckets++;
  if (checked) rows.push({ bucket, checked, ok, pre, missing, wrong, stamped, pages: Object.keys(tree).length });
}

const t = (k) => rows.reduce((n, r) => n + r[k], 0);
console.log(`ast-provenance: ${AST_DIR}`);
console.log(`${'bucket'.padEnd(24)}${'pages'.padStart(7)}${'checked'.padStart(9)}${'own page'.padStart(10)}${'base page'.padStart(11)}${'unstamped'.padStart(11)}${'WRONG'.padStart(7)}`);
for (const r of rows.sort((a, b) => b.wrong + b.missing - (a.wrong + a.missing) || b.checked - a.checked)) {
  if (!r.wrong && !r.missing && !r.pre && rows.length > 20 && r.checked < 50) continue; // keep the table readable
  console.log(`${r.bucket.padEnd(24)}${String(r.pages).padStart(7)}${String(r.checked).padStart(9)}${String(r.ok).padStart(10)}${String(r.pre).padStart(11)}${String(r.missing).padStart(11)}${String(r.wrong).padStart(7)}`);
}
console.log(`totals: ${t('checked')} record page(s) checked — ${t('ok')} on their own document, ${prefix} on its base page, `
  + `${t('missing')} unstamped, ${t('wrong')} WRONG.`);
console.log(`(not in scope: ${parentOnly} record(s) stamped aonParentId — a section of a bigger page; ${authored} authored.)`);
if (unstampedBuckets) console.log(`(${unstampedBuckets} bucket(s) carry no provenance at all — they predate the stamp and were not checked.)`);

if (bad.length) {
  console.error('\nast-provenance: FAIL — a description page is not the record\'s own archive document:');
  for (const b of bad.slice(0, 40)) console.error('   ' + b);
  if (bad.length > 40) console.error(`   … and ${bad.length - 40} more`);
  console.error('   Re-run the chain: npm run data  (the picker lives in scripts/import-core-v2.mjs)');
  process.exit(1);
}
console.log('ast-provenance: ok — every stamped page is the page its record says it is.');
