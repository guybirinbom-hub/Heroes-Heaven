/*
 * PAGE SLICES — the generator of src/data/page-slices.json (docs/card-design.md section 9 row 12, F6b;
 * section 13, "raised bar on no own page records").
 *
 * The owner, 2026-10-02: old imported text is shown ONLY for things the Archives do not have at all. A
 * record with no page of its own that LIVES INSIDE a bigger Archives page — an action printed inside the
 * feat that grants it (Accept Echo in Echo of the Fallen), an inventor modification inside its innovation
 * page (Advanced Rangefinder in Weapon), a research field's Field Discovery, a Hellknight order's benefit,
 * a familiar ability printed in its feat — reads THAT paragraph / section, cut out of the bigger page at
 * display time (src/sheet/astVisibility.ts sliceOf, through useAstNode). Nothing is regenerated: the map
 * points into the trees that already ship.
 *
 * The matching rules and the coverage gate live in scripts/lib/shared-page-census.mjs computePageSlices,
 * the one copy the card guard (scripts/lib/card-scope.mjs, S2-NOT-OWN) re-runs on every check: the file
 * and the computation must agree both ways (SLICE-UNLISTED / SLICE-STALE / SLICE-DIFFERS). Generated —
 * never hand-edit it; re-run this after any change to the trees, the records or the rules.
 *
 *   npx jiti scripts/page-slices.mjs            # counts + what would change
 *   npx jiti scripts/page-slices.mjs --write    # write src/data/page-slices.json
 *   npx jiti scripts/page-slices.mjs --check    # exit 1 when the file is not the computation
 *
 * Needs only the repo (public/core.json, core-descriptions.json, public/ast/*.json.gz).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent, loadTrees } from './card-truth-check.mjs';
import { PAGE_SLICES_FILE, censusResidue, computePageSlices, officialNoPage, pageSliceProblems } from './lib/shared-page-census.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const content = loadContent(ROOT);
const trees = loadTrees(ROOT);
const residue = censusResidue(content, trees);
const slices = computePageSlices(content, trees, residue);
const noPage = officialNoPage(content, trees);

const byRoute = {};
const byBucket = {};
let noPageSliced = 0;
let residueSliced = 0;
const noPageSet = new Set(noPage);
for (const [k, v] of Object.entries(slices)) {
  byRoute[v.route] = (byRoute[v.route] ?? 0) + 1;
  const b = k.slice(0, k.indexOf(':'));
  byBucket[b] = (byBucket[b] ?? 0) + 1;
  if (noPageSet.has(k)) noPageSliced++;
  if (k in residue) residueSliced++;
}
console.log(`page slices: ${Object.keys(slices).length} (official no-page records ${noPageSliced} of ${noPage.length}; S2 residue ${residueSliced} of ${Object.keys(residue).length}).`);
console.log(`  by route: ${Object.entries(byRoute).map(([r, n]) => `${r} ${n}`).join(', ')}; by bucket: ${Object.entries(byBucket).sort().map(([b, n]) => `${b} ${n}`).join(', ')}.`);

const file = JSON.parse(readFileSync(join(ROOT, PAGE_SLICES_FILE), 'utf8'));
const problems = pageSliceProblems(file, slices);
if (argv.includes('--write')) {
  const sorted = Object.fromEntries(Object.entries(slices).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const out = {
    _generated: 'scripts/page-slices.mjs --write — never hand-edit; the card guard (scripts/lib/card-scope.mjs S2-NOT-OWN) checks it both ways',
    _counts: { slices: Object.keys(slices).length, officialNoPage: noPage.length, officialNoPageSliced: noPageSliced, residue: Object.keys(residue).length, residueSliced, byRoute },
    slices: sorted,
  };
  writeFileSync(join(ROOT, PAGE_SLICES_FILE), JSON.stringify(out, null, 1) + '\n');
  console.log(`page slices: wrote ${PAGE_SLICES_FILE} (${problems.length} entries changed).`);
} else {
  for (const p of problems.slice(0, 60)) console.log(`   ${p}`);
  if (problems.length > 60) console.log(`   … and ${problems.length - 60} more`);
  if (argv.includes('--check') && problems.length) process.exitCode = 1;
}
