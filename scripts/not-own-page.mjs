/*
 * NOT OWN PAGE — the generator of src/data/not-own-page.json (docs/card-design.md section 9 row 12, F6;
 * docs/display-truth-plan.md F6; section 2 rule 2 (d)).
 *
 * The S2 residue: records whose shared Archives page, after the F5 section cut (src/sheet/astVisibility.ts
 * variantSection), is still not their own — the cleric doctrines on the whole doctrine page, the alchemist
 * field-discovery variants on the family page that lacks their benefit, Anathema (Cleric) on the druid's
 * page, the masterful-hunter variants, about 180 items on their family page. The census that finds them is
 * scripts/lib/shared-page-census.mjs (censusResidue), the same one the card guard runs.
 *
 * A listed record reads NO tree (useAstNode → recordTree), so every popup falls back to the record's own
 * description — but only when that description is trustworthy: a record joins `ids` only if its
 * description finds >= 60 % of its own sentences in its Archives section in the local mirror
 * (C:\wonderers guide\aon-2e-archive\data, by the record's aonId). Checked on EVERY listed record, not a
 * sample. A record that fails stays on its page, in `keptOnPage` with its measured coverage, and in the
 * card guard's S2 baseline.
 *
 * The card guard checks the file both ways against the census on every run (NOT-OWN-UNLISTED /
 * NOT-OWN-STALE / NOT-OWN-BOTH), with no mirror needed. The mirror is needed only to (re)write the split.
 * A residue record that has a slice (src/data/page-slices.json) reads its slice, so it is in neither half:
 * the file splits the residue LESS the sliced records (residueWithoutSlices), and so does the guard.
 *
 *   npx jiti scripts/not-own-page.mjs            # counts + what would change
 *   npx jiti scripts/not-own-page.mjs --write    # write src/data/not-own-page.json (needs the mirror)
 *   npx jiti scripts/not-own-page.mjs --check    # exit 1 when the file is not the census (two-way)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent, loadTrees } from './card-truth-check.mjs';
import { COVERAGE_GATE, NOT_OWN_PAGE_FILE, censusResidue, computePageSlices, notOwnPageProblems, residueWithoutSlices, splitResidue } from './lib/shared-page-census.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = process.env.AON_MIRROR || 'C:/wonderers guide/aon-2e-archive/data/by-category';
const argv = process.argv.slice(2);
const content = loadContent(ROOT);
const trees = loadTrees(ROOT);
const fullResidue = censusResidue(content, trees);
// A residue record with a slice (src/data/page-slices.json, the same computation the ledger runs) reads its
// slice of a page, so it is in neither half of this file.
const slices = computePageSlices(content, trees, fullResidue);
const residue = residueWithoutSlices(fullResidue, slices);
const file = JSON.parse(readFileSync(join(ROOT, NOT_OWN_PAGE_FILE), 'utf8'));

const byBucket = (keys) => {
  const c = {};
  for (const k of keys) { const b = k.slice(0, k.indexOf(':')); c[b] = (c[b] ?? 0) + 1; }
  return Object.entries(c).sort().map(([b, n]) => `${b} ${n}`).join(', ');
};
console.log(`not own page: S2 residue after F5 = ${Object.keys(fullResidue).length}; ${Object.keys(fullResidue).length - Object.keys(residue).length} read a page slice; ${Object.keys(residue).length} left (${byBucket(Object.keys(residue))}).`);

/** The record's Archives section in the mirror: by-category/<category>/<aonId>.json → markdown. */
function mirrorOf(rec) {
  const id = rec?.aonId ? String(rec.aonId) : '';
  if (!id) return undefined;
  const cat = id.replace(/-\d+(?:-\d+)*$/, '');
  for (const f of [id, id.replace(/-\d+$/, '')]) {
    const p = join(MIRROR, cat, `${f}.json`);
    if (existsSync(p)) {
      const doc = JSON.parse(readFileSync(p, 'utf8'));
      return String(doc.markdown ?? doc.text ?? '');
    }
  }
  return undefined;
}

const problems = notOwnPageProblems(file, residue);
if (argv.includes('--write')) {
  if (!existsSync(MIRROR)) {
    console.error(`not own page: the mirror (${MIRROR}) is absent — the coverage gate cannot run, so nothing is written.`);
    process.exit(1);
  }
  const { ids, keptOnPage, coverage } = splitResidue(residue, content, mirrorOf);
  const out = {
    _generated: `scripts/not-own-page.mjs --write — never hand-edit; gate ${COVERAGE_GATE} own-sentence coverage against the mirror section by aonId; the card guard checks it both ways against the census`,
    _counts: { residue: Object.keys(fullResidue).length, sliced: Object.keys(fullResidue).length - Object.keys(residue).length, ids: ids.length, keptOnPage: Object.keys(keptOnPage).length },
    ids,
    keptOnPage,
    coverage: Object.fromEntries(ids.map((k) => [k, coverage[k]])),
  };
  writeFileSync(join(ROOT, NOT_OWN_PAGE_FILE), JSON.stringify(out, null, 1) + '\n');
  console.log(`not own page: wrote ${NOT_OWN_PAGE_FILE}: ${ids.length} fall back to their own text (${byBucket(ids)}); ${Object.keys(keptOnPage).length} stay on their page (${byBucket(Object.keys(keptOnPage))}).`);
} else {
  console.log(`not own page: the file lists ${file.ids?.length ?? 0} + ${Object.keys(file.keptOnPage ?? {}).length} kept; ${problems.length} problems.`);
  for (const p of problems.slice(0, 60)) console.log(`   ${p}`);
  if (problems.length > 60) console.log(`   … and ${problems.length - 60} more`);
  if (argv.includes('--check') && problems.length) process.exitCode = 1;
}
