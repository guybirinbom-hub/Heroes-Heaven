/**
 * DOES EVERY aonId POINT AT THE RIGHT PAGE?
 *
 * `aonId` is the link between a core.json record and its AoN document. Everything downstream trusts
 * it: the ast, the description, descRefs, the "view on AoN" link, and any prose top-up.
 *
 * It is stamped by NAME, so a name shared by two unrelated things mis-stamps silently:
 *
 *     items/coral                gemstone, 1 gp  ->  draconic-exemplar-8   (the Coral dragon)
 *     items/jet                  gemstone, 1 gp  ->  familiar-ability-94   (the Jet familiar ability)
 *
 * Nothing complains, because the record still has *an* aonId. It surfaces only when something reads
 * the page — a prose top-up keyed on aonId would print dragon rules on a gemstone.
 *
 * The rule itself lives in scripts/lib/aonid-categories.mjs, shared with stamp-aonid.mjs so the
 * stamper cannot write a link this checker would accept.
 *
 * ⚠ COMPARING NAMES ALONE DOES NOT WORK — the first version reported 143 "mismatches" and nearly all
 * were correct links (AoN's own typos we had already fixed, composed labels, family variants, and our
 * synthetic `-bonus-N` ids). Category compatibility is the signal; the name is reported as a hint only.
 *
 *     node scripts/aonid-integrity.mjs
 *     node scripts/aonid-integrity.mjs --names          # include the weak name-difference report
 *     node scripts/aonid-integrity.mjs --json out.json
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED, BUCKET_QUIRK, CATEGORY_ABSENT_FROM_EXPORT, buildDocIndex, resolveDoc, stripSynthetic } from './lib/aonid-categories.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = 'C:/trying ai 2/hh-data-export/without-images/data';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const byId = buildDocIndex(EXPORT, { readFileSync, readdirSync, join });

/** The id prefix — for reporting only; the resolved category is what gets judged. */
const catOf = (aonId) => stripSynthetic(aonId).replace(/-\d+.*$/, '');

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/** Does the page name plausibly describe this record? Deliberately generous — see the header. */
function nameLooksRight(recName, docName) {
  const a = norm(recName), b = norm(docName);
  if (!a || !b) return true;                       // "(concentration)" normalises to empty on both sides
  if (a === b) return true;
  // one contains the other as a whole word run: "Adept Benefit (Amulet)" vs "Amulet",
  // "Lucky Coin (Lucky Gold)" vs "Lucky Gold", "Tent (Pup)" vs "Tent"
  if (a.includes(b) || b.includes(a)) return true;
  // AoN typo vs our correction: nearly the same string
  if (Math.abs(a.length - b.length) <= 3 && lev(a, b) <= Math.max(2, Math.floor(a.length * 0.15))) return true;
  // same word set in a different order / with a dropped article
  const wa = new Set(a.split(' ').filter((w) => !/^(the|of|a|an)$/.test(w)));
  const wb = new Set(b.split(' ').filter((w) => !/^(the|of|a|an)$/.test(w)));
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter >= Math.max(1, Math.min(wa.size, wb.size));
}
function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

const findings = { wrongCategory: [], noDoc: [], nameDiff: [], quirk: [] };
let checked = 0, clean = 0;

for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object') continue;
  for (const [id, rec] of Object.entries(recs)) {
    if (!rec || typeof rec !== 'object' || !rec.aonId) continue;
    checked++;
    // Resolve FIRST, then judge the category the index actually holds it under — the id prefix is only
    // a hint (`equipment-category-1` lives in category-page.json).
    const { doc, via } = resolveDoc(byId, rec.aonId);
    // A per-record quirk, or a whole category this import export predates (see that set's own comment).
    const quirk = BUCKET_QUIRK.has(`${bucket}/${id}`) || CATEGORY_ABSENT_FROM_EXPORT.has(catOf(rec.aonId));
    const row = { bucket, id, aonId: rec.aonId, name: rec.name, cat: doc?.cat ?? catOf(rec.aonId) };
    if (!doc) { (quirk ? findings.quirk : findings.noDoc).push(row); continue; }
    const allow = ALLOWED[bucket];
    if (allow && !allow.includes(doc.cat)) {
      (quirk ? findings.quirk : findings.wrongCategory).push({ ...row, page: doc.name });
      continue;
    }
    if (!nameLooksRight(rec.name, doc.name)) findings.nameDiff.push({ ...row, page: doc.name, via });
    else clean++;
  }
}

const pc = (a, b) => (b ? ((100 * a) / b).toFixed(2) : '0.00');
console.log(`checked ${checked.toLocaleString()} records carrying an aonId\n`);
console.log(`  HARD  points into an incompatible AoN category  : ${findings.wrongCategory.length}`);
console.log(`  HARD  matches no document in any of the 93 cats : ${findings.noDoc.length}`);
console.log(`  known mis-bucketed, link itself is correct      : ${findings.quirk.length}`);
console.log(`  weak  page name differs (typo/variant/label)    : ${findings.nameDiff.length}`);
console.log(`  clean                                          : ${clean.toLocaleString()} (${pc(clean, checked)}%)`);

const show = (label, list, limit = 30) => {
  if (!list.length) return;
  console.log(`\n--- ${label} (${list.length}) ---`);
  for (const f of list.slice(0, limit)) {
    console.log(`  ${(f.bucket + '/' + f.id).padEnd(46)} "${f.name}"  ->  ${f.aonId}` + (f.page ? `  = "${f.page}"` : ''));
  }
  if (list.length > limit) console.log(`  … ${list.length - limit} more`);
};
show('INCOMPATIBLE CATEGORY', findings.wrongCategory, 60);
show('NO DOCUMENT', findings.noDoc, 40);
if (has('--names')) show('name differs (weak)', findings.nameDiff, 200);
if (has('--quirks')) show('known mis-bucketed (accepted)', findings.quirk, 100);

const out = arg('--json', null);
if (out) { writeFileSync(out, JSON.stringify(findings, null, 1)); console.log(`\nwrote ${out}`); }

const hard = findings.wrongCategory.length + findings.noDoc.length;
if (hard) {
  console.log(`\n${hard} record(s) link to the wrong kind of page. Either the link is wrong (drop it — see`);
  console.log('scripts/fix-aonid-collisions.mjs) or the bucket is an accepted quirk (add it to');
  console.log('BUCKET_QUIRK in scripts/lib/aonid-categories.mjs, with the evidence).');
}
process.exit(hard ? 1 : 0);
