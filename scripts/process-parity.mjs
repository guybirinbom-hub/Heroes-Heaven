/**
 * DID THE NEW DATA GO THROUGH EVERYTHING THE OLD DATA WENT THROUGH?
 *
 * A record can be present and still be second-class. Every record in this app has passed through a
 * chain of steps, and each one leaves a trace you can look for:
 *
 *   aonId          provenance stamping (scripts/migration/stamp-aonid.mjs)
 *   description    the prose split out into public/core-descriptions.json
 *   ast            the parsed display tree in public/ast/<bucket>.json — what actually renders
 *   descRefs       cross-links resolved, so links in the text open a popup instead of reading dead
 *   source.book    canonicalised to the name the Sources filter keys off
 *   edition        classified legacy / remaster / neutral, which decides visibility
 *   no raw markup  AoN's unsubstituted <%TEMPLATE%%> stripped
 *
 * Rather than ask "is this record present", this asks "does this record have everything its
 * neighbours have" — per bucket, comparing records ADDED in the recent imports against the ones that
 * were already there. A step that silently skipped the new arrivals shows up as a coverage cliff.
 *
 * The comparison is against the bucket's own baseline, not an absolute: `archetype` records carry no
 * description by design, so demanding one everywhere would be noise.
 *
 *   node scripts/process-parity.mjs
 *   node scripts/process-parity.mjs --bucket feats --list
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));

/** The ast trees, per bucket, read from whichever form ships. */
const astFor = (bucket) => {
  for (const p of [`public/ast/${bucket}.json`, `public/ast/${bucket}.json.gz`]) {
    const f = join(ROOT, p);
    if (!existsSync(f)) continue;
    try {
      const raw = p.endsWith('.gz') ? gunzipSync(readFileSync(f)).toString('utf8') : readFileSync(f, 'utf8');
      return JSON.parse(raw);
    } catch { /* fall through */ }
  }
  return null;
};

/**
 * "New" means: added by the 2026-08-16 work. Identified by SOURCE BOOK rather than by a date, because
 * core.json carries no timestamps — Impossible Magic and Battlecry! are the books the delta brought,
 * and the two authored classes name Impossible Magic too.
 */
const NEW_BOOKS = new Set(['Pathfinder Impossible Magic', 'Pathfinder Battlecry!']);
const isNew = (rec) => NEW_BOOKS.has(String(rec?.source?.book ?? '').trim());

/** Does this tree contain any link at all? Used to tell "no links" apart from "links, none resolved". */
function hasLinkNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.t === 'link' || node.to != null) return true;
  for (const c of node.c || []) if (hasLinkNode(c)) return true;
  return false;
}

const CHECKS = [
  ['aonId', (rec) => rec.aonId != null],
  ['description', (rec, id, bucket) => {
    const d = descs[bucket]?.[id];
    const t = typeof d === 'string' ? d : d?.d ?? d?.description ?? rec.description;
    return !!(t && String(t).trim());
  }],
  ['ast', (rec, id, bucket, ast) => !!ast?.[id]],
  /*
   * LINKS LIVE — measured on the mechanism the record actually renders through, not on descRefs alone.
   *
   * DescriptionModal draws the `ast` when a record has one; each link node inside it carries a
   * `ref: "bucket:slug"` resolved at import time. `descRefs` is the FALLBACK list, read by the RichText
   * path only when there is no tree. So a record with an ast never consults descRefs.
   *
   * Measuring raw descRefs coverage reported a permanent three-bucket "cliff" (items 37->17,
   * feats 51->29, spells 47->12) for records that were in fact 99-100% clickable through their ast —
   * BETTER than the old records at 95-100%. The gap was real in the field and empty in effect: only 5
   * of the 1,250 new records across those buckets have no ast at all.
   *
   * So: a record passes if its links are live by EITHER mechanism, which is what a reader experiences.
   */
  ['links live', (rec, id, bucket, ast) => {
    const node = ast?.[id];
    if (node) {
      let found = false;
      (function walk(n) {
        if (found || !n || typeof n !== 'object') return;
        if (n.ref) { found = true; return; }
        for (const c of n.c || []) walk(c);
      })(node);
      // An ast with no links at all is not a defect — plenty of prose references nothing.
      if (found || !hasLinkNode(node)) return true;
    }
    const d = descs[bucket]?.[id];
    const r = (typeof d === 'object' && (d?.r ?? d?.descRefs)) ?? rec.descRefs;
    return Array.isArray(r) && r.length > 0;
  }],
  ['source.book', (rec) => !!rec.source?.book],
  ['edition', (rec) => !!rec.edition],
  ['no raw markup', (rec, id, bucket) => {
    const d = descs[bucket]?.[id];
    const t = typeof d === 'string' ? d : d?.d ?? rec.description ?? '';
    return !String(t).includes('<%');
  }],
];

const rows = [];
for (const [bucket, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object') continue;
  const entries = Object.entries(records).filter(([, r]) => r && typeof r === 'object');
  if (entries.length < 5) continue;
  const ast = astFor(bucket);
  const old = entries.filter(([, r]) => !isNew(r));
  const neu = entries.filter(([, r]) => isNew(r));
  if (!neu.length) continue;

  const pct = (list, fn) => (list.length ? Math.round((100 * list.filter(([id, r]) => fn(r, id, bucket, ast)).length) / list.length) : null);
  const cols = CHECKS.map(([name, fn]) => ({ name, old: pct(old, fn), neu: pct(neu, fn) }));
  rows.push({ bucket, oldN: old.length, newN: neu.length, cols, entriesNew: neu, ast });
}

rows.sort((a, b) => b.newN - a.newN);
const CLIFF = 15; // percentage points below the bucket's own baseline

console.log('Per bucket: coverage of each step, OLD records vs the ones added by the 2026-08-16 imports.');
console.log('A cliff (new far below old) is a step that skipped the new arrivals.\n');
const head = ['bucket', 'old', 'new', ...CHECKS.map(([n]) => n)];
console.log(`${head[0].padEnd(18)}${head[1].padStart(6)}${head[2].padStart(6)}  ${CHECKS.map(([n]) => n.slice(0, 11).padStart(13)).join('')}`);

const cliffs = [];
for (const r of rows) {
  const cells = r.cols.map((c) => {
    const s = `${c.old ?? '-'}/${c.neu ?? '-'}`;
    const bad = c.old != null && c.neu != null && c.old - c.neu > CLIFF;
    if (bad) cliffs.push({ bucket: r.bucket, step: c.name, old: c.old, neu: c.neu });
    return (bad ? `! ${s}` : s).padStart(13);
  });
  console.log(`${r.bucket.padEnd(18)}${String(r.oldN).padStart(6)}${String(r.newN).padStart(6)}  ${cells.join('')}`);
}

console.log(`\n${cliffs.length} coverage cliff(s):`);
for (const c of cliffs) console.log(`  ${c.bucket}/${c.step}: old ${c.old}% -> new ${c.neu}%`);
if (!cliffs.length) console.log('  none — every step that reached the old records reached the new ones.');

const only = arg('--bucket', null);
if (has('--list') && only) {
  const r = rows.find((x) => x.bucket === only);
  if (r) {
    console.log(`\n--- ${only}: new records failing a step ---`);
    for (const [id, rec] of r.entriesNew) {
      const missing = CHECKS.filter(([, fn]) => !fn(rec, id, only, r.ast)).map(([n]) => n);
      if (missing.length) console.log(`  ${id.padEnd(40)} missing: ${missing.join(', ')}`);
    }
  }
}
process.exit(cliffs.length ? 1 : 0);
