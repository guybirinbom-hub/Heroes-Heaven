/*
 * GUARD: no record is built from a printing the Archives have since replaced.
 *
 * Owner, 2026-09-12: "we cant be using old data (not to be confused with pre remaster and after
 * remster data)" — and gold-set R12, "The newest printing wins, whole". Where the SAME thing was
 * reprinted in a newer book the record must carry the REPRINT's document, because its facets, its
 * text, its edition and its description page are all resolved from that id.
 *
 * Measured before the rule went in: 566 records pointed at a replaced document, 347 of them the
 * Secrets of Magic magus/summoner content that Impossible Magic reprinted in 2026.
 *
 * WHAT PASSES
 *   • a record whose aonId names a document with no reprint in the export (the overwhelming majority,
 *     including all legacy content that was simply never reprinted — nothing is deleted or merged).
 *   • a record PINNED BY A RULING: an overlay row `{category,id,field:"aonId"}` (or an `aonId` inside
 *     a `create` row) in scripts/data/effect-backfill.json. stamp-aonid.mjs re-applies those last, so
 *     the ruling is the answer; they are listed, not failed.
 *   • a SHIPPED TWIN: the reprint already ships as a record of its own, so repointing would collapse
 *     two records onto one page — a merge decision for the owner, not a data repair. Listed, not
 *     failed (e.g. spells/acid-splash, whose reprint spell-1461 ships as spells/caustic-blast).
 *
 * Anything else is a failure: re-run `npm run data`, whose chain applies the rule in
 * scripts/lib/reprint.mjs (the importer's join + the AST writer, and build-map.mjs so the stamp
 * follows).
 *
 *   node scripts/reprint-check.mjs
 *   CORE_JSON=/path/to/core.json node scripts/reprint-check.mjs   # point it at a scratch copy
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReprintIndex, repointDoc, slugify } from './lib/reprint.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = process.env.CORE_JSON || join(ROOT, 'public/core.json');
const core = JSON.parse(readFileSync(CORE, 'utf8'));

const pinned = new Set();
try {
  for (const r of JSON.parse(readFileSync(join(ROOT, 'scripts/data/effect-backfill.json'), 'utf8'))) {
    if (!r || r.path?.length || !r.category || !r.id) continue;
    if (r.field === 'aonId' || (r.create && r.value?.aonId !== undefined)) pinned.add(`${r.category}/${r.id}`);
  }
} catch { /* the overlay is optional to this check */ }

const index = loadReprintIndex();
const stripSynthetic = (a) => String(a).replace(/-bonus-\d+$/, '');
/** The same walk resolveDoc() does in scripts/lib/aonid-categories.mjs: our suffix, then a variant tail. */
const resolve = (aonId) => {
  const base = stripSynthetic(aonId);
  for (const c of [String(aonId), base, base.replace(/-\d+$/, '')]) if (index.docs.has(c)) return c;
  return null;
};

/*
 * CHECK 2 — the record's BOOK has to follow its document to the newer printing.
 *
 * `source.book` is the key the source filter runs on (src/rules/sources.ts), so a record whose
 * document moved to a reprint while its book stayed on the printing it replaced is INVISIBLE to a
 * player who owns the new book and not the old one. Measured 2026-09-12: the newest-printing repoint
 * did that to four STAMP-ONLY records — classFeatures/act-together, manifest-eidolon, share-senses
 * (their document lives in the `actions` category, so they are kept orphans in classFeatures and the
 * importer's overlayContent, which is what recomputes facets, never runs for them) and
 * items/chalice-implement. aonId and edition moved for all four; `source` did not.
 *
 * ⚠ THE PREDICATE IS NARROW ON PURPOSE, and the two wider ones were measured and rejected:
 *   · "source.book names no book of its document" is 287 records — almost all of them HH's long
 *     display convention against the Archives' short title, which mapBook() below resolves, plus a
 *     tail of record-vs-doc mismatches that have nothing to do with reprints.
 *   · "…and the document is a reprint" is still 62, of which 58 are unrelated pre-existing drift.
 * What this reports is the shape the newest-printing rule can actually CAUSE: the book the record
 * names is the book of a document that this one REPLACES. That was 20 records, all genuine, all
 * repaired through the overlay (work/.reprint-source-book.json).
 */
const normBook = (s) => String(s || '').toLowerCase()
  .replace(/^pathfinder /, '').replace(/^lost omens:? /, '').replace(/\((?:remastered|remaster)\)/g, '').replace(/[^a-z0-9]/g, '');
const bookByNorm = {};
try {
  for (const [aon, hh] of Object.entries(JSON.parse(readFileSync(join(ROOT, 'scripts/data/book-names.json'), 'utf8')))) {
    bookByNorm[normBook(aon)] = hh;
  }
} catch { /* without the table the name comparison below falls back to normBook alone */ }
/** The importer's mapBook(): the Archives' short title -> Heroes Heaven's canonical display string. */
const mapBook = (b) => {
  const x = String(b || '').trim();
  if (!x) return undefined;
  return bookByNorm[normBook(x)] ?? (/^Pathfinder /i.test(x) ? x : `Pathfinder ${x}`);
};
const docNamesBook = (doc, book) =>
  (doc?.books ?? []).some((b) => mapBook(b) === book || normBook(b) === normBook(book));

let withAon = 0, unknown = 0;
const bad = [];
const staleBook = [];
const byRuling = [];
const byTwin = [];

for (const [bucket, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  const hasSlug = (k) => !!records[k];
  for (const [key, rec] of Object.entries(records)) {
    if (!rec || typeof rec !== 'object' || !rec.aonId) continue;
    withAon++;
    const D = resolve(rec.aonId);
    if (!D) { unknown++; continue; }
    const R = repointDoc(index, D, key, hasSlug);
    const where = `${bucket}/${key}`;

    // CHECK 2 (see the header): the book must have followed the document to the newer printing.
    const doc = index.docs.get(D);
    if (rec.source?.book && doc?.books?.length && !docNamesBook(doc, rec.source.book)) {
      const from = (doc.data?.legacy_id ?? []).map(String)
        .find((l) => index.docs.get(l)?.category === doc.category && docNamesBook(index.docs.get(l), rec.source.book));
      if (from) {
        staleBook.push(`${where}  source.book is ${JSON.stringify(rec.source.book)}, the book of ${from} — but ${D} prints ${JSON.stringify(doc.books)}`);
      }
    }
    if (!R) {
      // Not repointable — but say WHY when a reprint exists, so the exceptions stay visible.
      const any = repointDoc(index, D, key, () => false);
      if (any && pinned.has(where)) byRuling.push(`${where}  pinned at ${D}; the reprint is ${any}`);
      else if (any) byTwin.push(`${where}  ${D} -> ${any} "${index.docs.get(any)?.name}" already ships as ${bucket}/${slugify(index.docs.get(any)?.name ?? '')}`);
      continue;
    }
    if (pinned.has(where)) { byRuling.push(`${where}  pinned at ${D}; the reprint is ${R}`); continue; }
    bad.push(`${where}  ${D} "${index.docs.get(D)?.name}" (${index.docs.get(D)?.book}) -> ${R} "${index.docs.get(R)?.name}" (${index.docs.get(R)?.book})`);
  }
}

console.log(`reprint-check: ${CORE}`);
console.log(`${withAon} record(s) carry an aonId; ${unknown} name a document the export does not hold.`);
console.log(`${byRuling.length} pinned by ruling, ${byTwin.length} owner merge decision (the reprint already ships), ${bad.length} on a replaced printing.`);
for (const r of byRuling) console.log(`   pinned by ruling: ${r}`);
if (byTwin.length) {
  console.log(`   owner merge decision (first 10 of ${byTwin.length}):`);
  for (const r of byTwin.slice(0, 10)) console.log(`      ${r}`);
}

console.log(`${staleBook.length} record(s) whose source.book stayed on the printing their document replaced.`);

if (staleBook.length) {
  console.error('\nreprint-check: FAIL — the document moved to a newer printing and source.book did not follow.');
  console.error('   source.book is the source-filter key, so these are hidden from a player who owns the new book:');
  for (const b of staleBook.slice(0, 40)) console.error('   ' + b);
  if (staleBook.length > 40) console.error(`   … and ${staleBook.length - 40} more`);
  console.error('   Repair: a `source` overlay row per record through scripts/apply-parity-fixes.mjs,');
  console.error('   citing the reprint doc id (see work/.reprint-source-book.json for the 20 already done).');
  process.exit(1);
}

if (bad.length) {
  console.error('\nreprint-check: FAIL — a record is built from a printing the Archives have replaced:');
  for (const b of bad.slice(0, 40)) console.error('   ' + b);
  if (bad.length > 40) console.error(`   … and ${bad.length - 40} more`);
  console.error('   Re-run the chain: npm run data  (the rule lives in scripts/lib/reprint.mjs)');
  process.exit(1);
}
console.log('reprint-check: ok — every record is on the newest printing the Archives hold.');
