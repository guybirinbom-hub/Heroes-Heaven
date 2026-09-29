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
 *     two records onto one page — a merge decision, and the owner made it (desk #158, 2026-09-12):
 *     "keep both, mark the old one legacy, add a 'remastered as …' link". So the twin is not repointed
 *     — but it MUST carry `edition: "legacy"` and a `remasteredAs` naming a record that exists, or
 *     this exits 1 (e.g. spells/acid-splash -> spells/caustic-blast). Both are stamped by the chain.
 *     The reverse holds too: a record carrying `remasteredAs` must BE that twin (CHECK 3, widened).
 *   • a REFUSED cross-kind link: the record's document names a newer printing of another category (a
 *     sidebar's page, a bonus line's item, a class feature's class) and no rule in scripts/lib/reprint.mjs
 *     can say which record on that page is its reprint. Printed with the reason, counted, not failed —
 *     but such a link with NO reason fails, so a new one cannot slip in unexplained.
 *
 * Also CHECK 4: every scripts/data/book-names.json alias that renames the book carries a reason
 * (owner, desk #166 — see the check itself), and no choosable record's book differs from a fold target
 * only by "(Remastered)"; CHECK 5: an item's "Remastered as" opens a record with the
 * same level and price, or says why not; CHECK 6: a record's book is one its own document is printed in
 * (a baseline of the older exceptions, which only shrinks); CHECK 7: a book split never moves a record the
 * old book also prints; CHECK 8: a record on a reprint does not keep the replaced printing's prose (a
 * baseline of the older exceptions, which only shrinks); CHECK 9: a legacy item's "Remastered as" is an
 * item the hide-legacy shop offers (a baseline of the older exceptions, which only shrinks).
 *
 * Anything else is a failure: re-run `npm run data`, whose chain applies the rule in
 * scripts/lib/reprint.mjs (the importer's join + the AST writer, and build-map.mjs so the stamp
 * follows).
 *
 * It imports src/rules/sources.ts (CHECK 7 reads BOOK_SPLITS there) and src/data (CHECK 9 measures the
 * shop's own list), so it runs under jiti:
 *
 *   npx jiti scripts/reprint-check.mjs
 *   CORE_JSON=/path/to/core.json npx jiti scripts/reprint-check.mjs   # point it at a scratch copy
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReprintIndex, repointDoc, shippedTwin, slugify, whyUnpaired } from './lib/reprint.mjs';
import { movedProseVerdict } from './lib/moved-prose.mjs';
import { BOOK_SPLITS, CHOOSABLE_SOURCE_MAPS } from '../src/rules/sources';
import { seedContent } from '../src/rules/seed';
import { findCombinationFormIds, findDuplicateIds, findHiddenTwins, findUmbrellaIds, shopItems } from '../src/data';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = process.env.CORE_JSON || join(ROOT, 'public/core.json');
const core = JSON.parse(readFileSync(CORE, 'utf8'));
/* The prose split-descriptions.mjs moved out of core.json, beside it (CHECK 8). */
const DESCS = join(dirname(CORE), 'core-descriptions.json');
const descs = existsSync(DESCS) ? JSON.parse(readFileSync(DESCS, 'utf8')) : {};

const pinned = new Set();
try {
  for (const r of JSON.parse(readFileSync(join(ROOT, 'scripts/data/effect-backfill.json'), 'utf8'))) {
    if (!r || r.path?.length || !r.category || !r.id) continue;
    if (r.field === 'aonId' || (r.create && r.value?.aonId !== undefined)) pinned.add(`${r.category}/${r.id}`);
  }
} catch { /* the overlay is optional to this check */ }

const index = loadReprintIndex(undefined, { text: true });
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
/** A book's title with the conventions that do not make it another book stripped (CHECK 4, CHECK 6). */
const aliasTitle = (s) => String(s || '').toLowerCase()
  .replace(/^(?:pathfinder|paizo)\s+/, '').replace(/^(?:lost omens|adventure paths?|adventures?|blog)\s*:?\s*/, '').replace(/^the\s+/, '')
  .replace(/\((?:remastered|remaster)\)/g, '').replace(/[^a-z0-9]/g, '');
/** CHECK 6: the record's book is one its own document is printed in, under any spelling of that book
 *  ("#207: The Resurrection Flood" and "#207: Resurrection Flood" are one volume). */
const looseTitle = (s) => aliasTitle(String(s || '').replace(/\bthe\b/gi, ' '));
const sameBookAsDoc = (doc, book) => docNamesBook(doc, book)
  || (doc?.books ?? []).some((b) => looseTitle(b) === looseTitle(book) || looseTitle(mapBook(b)) === looseTitle(book));

/*
 * "the printing this document replaces" — taken from the SAME pairing the repoint runs on.
 *
 * It used to be read straight off `doc.data.legacy_id`, filtered to the same category, which only ever
 * sees the links AoN writes document-to-document. Two of the four rules in scripts/lib/reprint.mjs do
 * not have that shape, so the check was blind to exactly the records they move:
 *   · THE CLASS HOP — every Impossible Magic class feature carries `legacy_id: ["class-77"]`, a CLASS
 *     document, so the same-category filter threw it away. `classFeatures/spell-repertoire-summoner`
 *     moved to class-feature-1339 (Impossible Magic) and kept `source.book` "Pathfinder Secrets of
 *     Magic", and this printed 0.
 *   · A NAME-PAIRED CATEGORY — `hybrid-study` states no link at all, so there was nothing to read.
 *     All five reprinted hybrid studies moved and kept the Secrets of Magic book.
 * `index.next` already holds every pair from every rule; inverting it is the whole fix. The predicate
 * is unchanged in meaning — "the book the record names is the book of a document that this one
 * REPLACES" — and it still reports 6 records, not the 287 the wider readings produced.
 */
const replacedBy = new Map();
for (const [oldId, newId] of index.next) {
  (replacedBy.get(newId) ?? replacedBy.set(newId, []).get(newId)).push(oldId);
}

let withAon = 0, unknown = 0;
const bad = [];
const staleBook = [];
const byRuling = [];
const byTwin = [];
const twinOnCurrentDoc = [];
const unmarked = [];
const staleLink = [];
const refused = [];
const unexplained = [];
/** CHECK 6: `bucket/key` -> "<record book> <= <its document's books>" for a record naming another book. */
const otherBook = new Map();
/** CHECK 7: a split's new key -> its old key (src/rules/sources.ts BOOK_SPLITS). */
const splitFrom = new Map(BOOK_SPLITS.map(([from, to]) => [to, from]));
const splitProblems = [];
/** CHECK 8: records whose own document replaced an older printing, with their prose. */
const onReprint = [];

/*
 * CROSS-KIND LINKS NO RULE CAN RESOLVE, each with the reason it stays unlinked (scripts/lib/reprint.mjs
 * `whyUnpaired` supplies the reason for a sidebar, a bonus line and a class feature; these are the kinds
 * it has no rule for). Printed with the others, never failed — and a NEW such link with no reason fails
 * the check below, so the list cannot grow in silence.
 */
const REFUSED_BY_HAND = {
  'creatureThemeTemplate/hellbound-creature': 'the only statement is `legacy_id` on sidebar-3329 "Custom Contracts", whose url resolves to creature-adjustment-17 "Earth", not the Hellbound Creatures page; the live index has no page-level link (creature-theme-template-17 has no legacy_id, -16 no remaster_id). Reaching it would need a rule that trusts a sub-page\'s parent field. Hidden by hide-legacy (legacy-era).',
  'classFeatures/demon-eidolon': 'the only statement is `legacy_id` on sidebar-3755 "Embodiments of Sin", naming the old eidolon PAGE eidolon-5; the eidolon\'s own reprint (eidolon-19 "Demon", Impossible Magic) states no link either way, and `eidolon` is not a name-paired category (scripts/lib/reprint.mjs).',
};

/** A document's forward links into ANOTHER category — the pairs this check must account for. */
const crossNewer = (D) => {
  const cat = index.docs.get(D)?.category;
  const when = String(index.docs.get(D)?.release_date ?? '');
  return [...(index.links.get(D) ?? [])].filter((n) => index.docs.get(n)?.category !== cat && String(index.docs.get(n)?.release_date ?? '') > when);
};

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

    /*
     * CHECK 3, WIDENED — every `remasteredAs` IS the shipped twin. The branch below insists a twin carries
     * the link; this is the other direction: a link on a record that is NOT (or no longer) that twin, or
     * names another twin than the one the rule computes, is a dead or wrong "Remastered as" on a player's
     * screen. stamp-aonid.mjs clears and rewrites the field on every regen, so this fails only when the
     * chain did not run or a hand edit put the field there.
     */
    if (rec.remasteredAs) {
      const t = shippedTwin(index, D, key, hasSlug);
      if (!t || rec.remasteredAs.bucket !== bucket || rec.remasteredAs.id !== t.id) {
        staleLink.push(`${where}  remasteredAs ${JSON.stringify(rec.remasteredAs)}, but shippedTwin() is ${t ? `${bucket}/${t.id}` : 'null'}`);
      }
    }
    /* …and every cross-kind link is a twin, a repoint, a ruling, or a refusal with its reason. */
    if (!index.next.has(D) && crossNewer(D).length) {
      const why = whyUnpaired(index, D) ?? REFUSED_BY_HAND[where];
      if (why) refused.push(`${where}  ${D}${pinned.has(where) ? ' (pinned by ruling)' : ''} — ${why}`);
      else if (!pinned.has(where)) unexplained.push(`${where}  ${D} -> ${crossNewer(D).join(', ')}`);
    } else if (index.next.has(D) && index.derived.get(D)?.sub && !repointDoc(index, D, key, () => false)) {
      refused.push(`${where}  ${D} — the sub-page pairs with ${index.next.get(D)}, but the record's key is not the old title (key guard)`);
    }

    // CHECK 2 (see the header): the book must have followed the document to the newer printing.
    const doc = index.docs.get(D);
    // CHECK 6 (below): note a record whose book is not one its own document is printed in.
    if (rec.source?.book && doc?.books?.length && !sameBookAsDoc(doc, rec.source.book)) {
      otherBook.set(where, `${rec.source.book} <= ${JSON.stringify(doc.books)}`);
    }
    // CHECK 7 (below): the record sits under a split's new key while the old key's book prints it too.
    const from = splitFrom.get(rec.source?.book);
    if (from && looseTitle(from) && doc?.books?.length && sameBookAsDoc(doc, from)) {
      splitProblems.push(`${where}: reads ${JSON.stringify(rec.source.book)}, but ${D} is printed in ${JSON.stringify(doc.books)} — ${JSON.stringify(from)} among them`);
    }
    const prose = descs[bucket]?.[key]?.d ?? rec.description;
    if (replacedBy.has(D) && prose) onReprint.push({ where, D, olds: replacedBy.get(D), prose });
    if (rec.source?.book && doc?.books?.length && !docNamesBook(doc, rec.source.book)) {
      const from = (replacedBy.get(D) ?? []).find((l) => docNamesBook(index.docs.get(l), rec.source.book));
      if (from) {
        staleBook.push(`${where}  source.book is ${JSON.stringify(rec.source.book)}, the book of ${from} — but ${D} prints ${JSON.stringify(doc.books)}`);
      }
    }
    if (!R) {
      // Not repointable — but say WHY when a reprint exists, so the exceptions stay visible.
      const any = repointDoc(index, D, key, () => false);
      if (!any) continue;
      // A pin forbids the MOVE, not desk #158's label: a pinned old page whose reprint ships beside it is
      // held to the twin rule below like any other (build-map.mjs stamps it from the pinned page).
      if (pinned.has(where) && !shippedTwin(index, D, key, hasSlug)) { byRuling.push(`${where}  pinned at ${D}; the reprint is ${any}`); continue; }
      /*
       * CHECK 3 — THE SHIPPED TWIN CARRIES THE OWNER'S RULING (desk #158, 2026-09-12).
       *
       * "keep both, mark the old one legacy, add a 'remastered as …' link". Both halves are stamped
       * in the pipeline (build-map.mjs computes the pairing, stamp-aonid.mjs writes it), so a regen
       * reproduces them and no overlay row is involved. This is what makes that a guarantee rather
       * than a run that happened to work:
       *   · `edition` must be exactly 'legacy' — NOT 'superseded' (always hidden, which the ruling
       *     overturns) and not the doc's own 'legacy-era';
       *   · `remasteredAs` must name this bucket and a record that really exists, because the popup
       *     renders it as a link and a dangling one is a dead end on the player's screen.
       * A record whose OWN document is a current printing is not this case — see shippedTwin().
       */
      const twin = shippedTwin(index, D, key, hasSlug);
      const rname = index.docs.get(any)?.name ?? '';
      if (!twin) { twinOnCurrentDoc.push(`${where}  ${D} -> ${any} "${rname}" — ${D} is itself a current printing, so it is not marked legacy`); continue; }
      byTwin.push(`${where}  ${D} -> ${any} "${rname}" already ships as ${bucket}/${slugify(rname)}`);
      const ra = rec.remasteredAs;
      if (rec.edition !== 'legacy') unmarked.push(`${where}  edition is ${JSON.stringify(rec.edition ?? null)}, must be "legacy" (desk #158)`);
      if (!ra) unmarked.push(`${where}  has no remasteredAs; it should name ${bucket}/${twin.id} "${twin.name}"`);
      else if (ra.bucket !== bucket || ra.id !== twin.id) unmarked.push(`${where}  remasteredAs is ${JSON.stringify(ra)}, must be ${JSON.stringify({ bucket, id: twin.id, name: twin.name })}`);
      else if (!records[ra.id]) unmarked.push(`${where}  remasteredAs points at ${bucket}/${ra.id}, which no record answers to`);
      /* …and the LABEL must be the title of the record the link opens. The popup renders this string
       * and the click opens that record, so a label that disagrees is a defect the player sees. Seven
       * rows shipped as "Rune Of Sin" against a record named "Rune of Sin" — the export document's
       * title, stale where the live Archives page and the record agree — before build-map.mjs was
       * changed to take the record's own name. */
      else if (records[ra.id].name !== ra.name) unmarked.push(`${where}  remasteredAs is labelled ${JSON.stringify(ra.name)}, but ${bucket}/${ra.id} is named ${JSON.stringify(records[ra.id].name)}`);
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
for (const r of twinOnCurrentDoc) console.log(`   not marked (own document is current): ${r}`);
const unmarkedRecords = new Set(unmarked.map((u) => u.split('  ')[0]));
console.log(`${byTwin.length - unmarkedRecords.size} of ${byTwin.length} shipped twin(s) carry edition legacy + remasteredAs (desk #158).`);

console.log(`${staleBook.length} record(s) whose source.book stayed on the printing their document replaced.`);

console.log(`${refused.length} cross-kind link(s) left unlinked on purpose (refused pairs, counted, not failed):`);
for (const r of refused) console.log(`   refused: ${r}`);
/* desk #167 rule C (scripts/lib/reprint.mjs): a grade whose link names only the family pairs with the family's
 * grade of the same suffix — refused where the suffix is not one-to-one or the numbers disagree. Printed so a
 * refusal is seen, not failed: the grade keeps its family link, as before the rule. */
const derivedGrades = [...index.derived.values()].filter((v) => v.grade).length;
console.log(`${derivedGrades} grade block(s) paired with the new family's grade of the same suffix (desk #167); ${index.gradeRefused.size} refused, left on the family:`);
for (const [D, why] of index.gradeRefused) console.log(`   grade refused: ${D} "${index.docs.get(D)?.name}" — ${why}`);

/*
 * CHECK 4 — A BOOK ALIAS THAT RENAMES THE BOOK SAYS WHY.
 *
 * scripts/data/book-names.json turns the Archives' book title into the `source.book` key the source
 * filter runs on, so an alias that points at ANOTHER book moves every record of that book under the
 * other book's toggle: "Bestiary 3" -> "Pathfinder Monster Core 2" showed Bestiary 3 content to a player
 * who owns only Monster Core 2 and hid it from one who owns only Bestiary 3. Owner, 2026-09-25 (desk
 * #166, "Middle way"): a "(Remastered)" printing still folds into its own book — same book, newer
 * printing — but different books are never folded together. So every alias whose title (prefixes,
 * a leading "The" and "(Remastered)" aside) differs from its key must carry a reason in
 * scripts/data/book-names-reasons.json, and a reason with no such alias is stale — except one on an alias
 * that folds a legacy title into its "(Remastered)" key ("Dark Archive", "Gatewalkers Player's Guide"),
 * which is no rename but moves a printing, and may say why.
 */
const aliasProblems = [];
{
  const names = JSON.parse(readFileSync(join(ROOT, 'scripts/data/book-names.json'), 'utf8'));
  const reasons = JSON.parse(readFileSync(join(ROOT, 'scripts/data/book-names-reasons.json'), 'utf8'));
  const renaming = Object.entries(names).filter(([aon, hh]) => aliasTitle(aon) !== aliasTitle(hh));
  // A legacy title folded into its "(Remastered)" key ("Dark Archive") is no rename, but may say why.
  const remastered = (s) => /\((?:remastered|remaster)\)/i.test(String(s));
  for (const [aon, hh] of renaming) if (!String(reasons[aon] ?? '').trim()) aliasProblems.push(`${JSON.stringify(aon)} -> ${JSON.stringify(hh)} renames the book and gives no reason`);
  for (const aon of Object.keys(reasons)) {
    if (aon === '_') continue;
    if (!(aon in names)) aliasProblems.push(`reason for ${JSON.stringify(aon)}, which book-names.json no longer holds`);
    else if (aliasTitle(aon) === aliasTitle(names[aon]) && remastered(aon) === remastered(names[aon])) {
      aliasProblems.push(`reason for ${JSON.stringify(aon)}, whose alias neither renames the book nor folds one printing into the other`);
    }
  }
  console.log(`${Object.keys(names).length} book alias(es); ${renaming.length} rename the title, each with its reason in scripts/data/book-names-reasons.json.`);
  /*
   * …and a record's book that ESCAPES a fold: the table folds "Guns & Gears (Remastered)" into "Pathfinder
   * Guns & Gears", yet two overlay rows wrote "Pathfinder Guns & Gears (Remastered)" and the Sources card drew
   * it as a second Guns & Gears row. So a choosable record (src/rules/sources.ts CHOOSABLE_SOURCE_MAPS, the
   * keys the filter runs on) whose book is no fold target but differs from one only by "(Remastered)" fails.
   * The GM Search's page rows name the page's own printing on purpose (namesBook) and feed no filter.
   */
  const targets = new Set(Object.values(names));
  const unRemastered = (s) => String(s).replace(/\s*\((?:remastered|remaster)\)\s*/gi, ' ').trim();
  const targetOf = new Map();
  for (const t of targets) targetOf.set(unRemastered(t), [...(targetOf.get(unRemastered(t)) ?? []), t]);
  let escaped = 0;
  for (const bucket of CHOOSABLE_SOURCE_MAPS) {
    for (const [key, rec] of Object.entries(core[bucket] ?? {})) {
      const b = rec?.source?.book?.trim();
      if (!b || targets.has(b) || rec.source?.license === 'homebrew') continue;
      const t = (targetOf.get(unRemastered(b)) ?? []).filter((x) => x !== b);
      if (!t.length) continue;
      escaped++;
      aliasProblems.push(`${bucket}/${key} reads ${JSON.stringify(b)}, which differs from the fold target ${JSON.stringify(t[0])} only by "(Remastered)" — a second row of one book on the Sources card`);
    }
  }
  console.log(`${escaped} choosable record(s) name a book that differs from a fold target only by "(Remastered)".`);
}

/*
 * CHECK 5 — A GRADE IS "REMASTERED AS" A GRADE WITH ITS OWN NUMBERS.
 *
 * CHECK 3 compares a link with shippedTwin(), so it cannot see a twin that is wrong at the source. The
 * Judgment Thurible showed how: the Archives title the legacy Item 17 block "(Major)" and the Item 20 one
 * "(Greater)", each block's `remaster_name` follows its own numbers, and the two records — joined by title,
 * their level and price repaired by overlay rows — linked each other's grade: the level-17 Greater read
 * "Remastered as Judgement Thurible (Major)", a level-20, 65,000 gp item. So an item or bonus-line record
 * and the record its link opens must print the same level and price, or the pair is listed below with the
 * reason the reprint really differs (a stated rename, a reprice). Compared only where the link was made
 * between documents of the SAME shape (a grade block with a grade block, a page with a page): where a grade's
 * link was made to the reprint's PAGE — the Archives named only the family and desk #167's same-suffix rule
 * refused the pair (Universal Solvent (Moderate), whose Absolute Solvent (Moderate) is Item 12 against 5) —
 * the record it opens carries the family's base numbers by construction.
 * An entry that stops differing is stale and fails too, so a ruling here cannot go quiet.
 */
const copper = (p) => (p?.pp ?? 0) * 1000 + (p?.gp ?? 0) * 100 + (p?.sp ?? 0) * 10 + (p?.cp ?? 0);
const shapeOf = (docId) => (/-bonus-\d+$/.test(String(docId ?? '')) ? 'line' : /^[a-z-]+-\d+-\d+$/.test(String(docId ?? '')) ? 'grade' : 'page');
const RENAMED = 'the Archives state a whole-item rename both ways (remaster_name on the old page, legacy_name on the new), and the renamed item prints other numbers';
const TWIN_NUMBERS_DIFFER = {
  'items/aeon-stone-gold-nodule': `${RENAMED}: equipment-407-487 (Item 6, 230 gp) -> Aeon Stone (Envisioning), equipment-3055-2974 (Item 8, 425 gp).`,
  'items/boots-of-elvenkind': `${RENAMED}: equipment-413 -> Arboreal Boots, equipment-3056-2980 (160 gp against 145 gp).`,
  'items/boots-of-elvenkind-greater': `${RENAMED}, and the owner paired the grades by suffix himself (desk #167, his own example): equipment-413-503 (Item 11, 1,250 gp) -> Arboreal Boots (Greater), equipment-3056-2981 (Item 9, 700 gp).`,
  'items/cassock-of-devotion': `${RENAMED}: equipment-420 -> Devoted Vestments, equipment-3077 (1,250 gp against 1,150 gp).`,
  'items/fearcracker': `${RENAMED}: equipment-4557 -> Ghostcracker, equipment-2024 (25 gp against 5 gp).`,
  'items/hand-of-the-mage': `${RENAMED}: equipment-440 (Item 2, 30 gp) -> Charlatan's Gloves, equipment-3064-2991 (Item 3, 50 gp).`,
  'items/plate-armor-of-the-deep': `${RENAMED}: equipment-157 (Item 15, 6,500 gp) -> Tideplate, equipment-2810 (Item 10, 1,000 gp).`,
  'items/rod-of-wonder': `${RENAMED}: equipment-265 -> Madcap Top, equipment-3025 (459 gp against 465 gp).`,
  'items/staff-of-power': `${RENAMED}: equipment-361 (Item 16) -> Staff of Arcane Might, equipment-3038 (Item 12).`,
  'items/grim-sandglass-major': 'the reprint repriced the grade: equipment-5154-4639 Major Grim Sandglass prints 1,750 gp against equipment-1015-978\'s 2,000 gp, same level (src/data/index.ts REMASTER_REPRINT_IDS).',
  'items/feather-token-chest-ammunition': 'the AMMUNITION variant has no document of its own, so it sits on the plain token\'s block equipment-244-244 (Item 3, 10 gp), whose remaster_name is Marvelous Miniature (Chest), equipment-3002-2862; the remaster prints no ammunition variant.',
  'items/feather-token-ladder-ammunition': 'the AMMUNITION variant has no document of its own, so it sits on the plain token\'s block equipment-244-247 (Item 1, 3 gp), whose remaster_name is Marvelous Miniature (Ladder), equipment-3002-2864; the remaster prints no ammunition variant.',
  'items/feather-token-swan-boat-ammunition': 'the AMMUNITION variant has no document of its own, so it sits on the plain token\'s block equipment-244-248 (Item 8, 76 gp), whose remaster_name is Marvelous Miniature (Boat), equipment-3002-2860; the remaster prints no ammunition variant.',
  'items/healers-gel-lesser': 'the reprint\'s base grade equipment-5055-4573 (Healer\'s Gel, Item 5, 25 gp) has no record of its own: it shares its name, so its slug, with the family page equipment-5055, and the record that answers is that priceless family head.',
  'items/thieves-tools-concealable': 'the record carries its family\'s PAGE id equipment-58 (its own block, equipment-58-845, is Item 4, 80 gp), and every Thieves\' Tools block names only "Thieves\' Toolkit" (equipment-2758), which carries the base kit\'s numbers; the remaster prints no concealable variant.',
  'items/thieves-tools-concealable-picks': 'the record carries its family\'s PAGE id equipment-58 (its own block, equipment-58-844, is Item 4, 10 gp), and every Thieves\' Tools block names only "Thieves\' Toolkit" (equipment-2758), which carries the base kit\'s numbers; the remaster prints no concealable variant.',
};
/*
 * …and a link whose record is not on the reprint's page at all is not a numbers question: the twin is found
 * by SLUG in the record's own bucket, so where the reprint has no record there, a record of the same name
 * built from another document answers. Listed here with what it is, and any new one fails.
 */
const OFF_PAGE_TWINS = {
  'heritages/aon-half-elf': 'the legacy Half-Elf page (ancestry-7) is reprinted as the Aiuvarin page (ancestry-69), which no heritage record is built from; the link opens the heritage of that name (heritage-281), the remaster\'s form of it.',
  'heritages/aon-half-orc': 'the legacy Half-Orc page is reprinted as the Dromaar page (ancestry-70), which no heritage record is built from; the link opens the heritage of that name (heritage-282).',
  'heritages/aon-aasimar': 'the legacy Aasimar page is reprinted as the Nephilim page (ancestry-68), which no heritage record is built from; the link opens the heritage of that name (heritage-280).',
  'heritages/aon-tiefling': 'the legacy Tiefling page is reprinted as the Nephilim page (ancestry-68), which no heritage record is built from; the link opens the heritage of that name (heritage-280).',
  'heritages/aon-aphorite': 'the legacy Aphorite page is reprinted as the Nephilim page (ancestry-68), which no heritage record is built from; the link opens the heritage of that name (heritage-280).',
  'trait/half-elf': 'the legacy Half-Elf page is reprinted as the Aiuvarin page (ancestry-69); the link opens the trait of that name (trait-515).',
  'trait/half-orc': 'the legacy Half-Orc page is reprinted as the Dromaar page (ancestry-70); the link opens the trait of that name (trait-516).',
  'trait/gnoll': 'the legacy Gnoll page is reprinted as the Kholo page (ancestry-79); the link opens the trait of that name (trait-758).',
  'feats/master-spotter-investigator': 'WRONG, open: the reprint is feat-6209 (Master Spotter, Investigator, Player Core 2), which ships no record; the slug belongs to the Overwatch feat feat-3124, which the link opens.',
  'items/mirror-implement': 'WRONG, open: the reprint is implement-21 (Mirror, Dark Archive (Remastered)), whose records are classFeatures/mirror and implement/mirror; the items slug belongs to the 1 gp hand mirror (equipment-2735), which the link opens.',
  'items/lantern-implement': 'WRONG, open: the reprint is implement-20 (Lantern, Dark Archive (Remastered)), whose records are classFeatures/lantern and implement/lantern; the items slug belongs to the lantern light source (equipment-2730), which the link opens.',
};
const numberProblems = [];
{
  const differing = new Set();
  const offPage = new Set();
  let compared = 0;
  const urlOf = (docId) => String(index.docs.get(String(docId ?? ''))?.url ?? '').toLowerCase();
  for (const [bucket, records] of Object.entries(core)) {
    if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
    for (const [key, rec] of Object.entries(records)) {
      const ra = rec?.remasteredAs;
      const t = ra ? core[ra.bucket]?.[ra.id] : null;
      const D = t && rec.aonId ? resolve(rec.aonId) : null;
      const twin = D ? shippedTwin(index, D, key, (k) => !!records[k]) : null;
      if (!twin) continue;
      const where = `${bucket}/${key}`;
      if (!t.aonId || urlOf(resolve(t.aonId)) !== urlOf(twin.docId)) {
        offPage.add(where);
        if (!OFF_PAGE_TWINS[where]) numberProblems.push(`${where} is "Remastered as" ${ra.bucket}/${ra.id}, which is not built from the reprint ${twin.docId} — a record of the same slug from another page`);
        continue;
      }
      if (!['items', 'itemBonus'].includes(bucket) || shapeOf(D) !== shapeOf(twin.docId)) continue;
      compared++;
      if (rec.level === t.level && copper(rec.price) === copper(t.price)) continue;
      differing.add(where);
      if (!TWIN_NUMBERS_DIFFER[where]) numberProblems.push(`${where} (level ${rec.level}, ${copper(rec.price)} cp) is "Remastered as" ${ra.bucket}/${ra.id} (level ${t.level}, ${copper(t.price)} cp)`);
    }
  }
  for (const where of Object.keys(TWIN_NUMBERS_DIFFER)) if (!differing.has(where)) numberProblems.push(`${where} is listed in TWIN_NUMBERS_DIFFER but its twin now prints the same level and price (or it has no twin) — remove the entry`);
  for (const where of Object.keys(OFF_PAGE_TWINS)) if (!offPage.has(where)) numberProblems.push(`${where} is listed in OFF_PAGE_TWINS but its link now opens the reprint's own record (or it has none) — remove the entry`);
  console.log(`${compared} grade/page twin(s) compared on level and price; ${differing.size} differ, each with its reason. ${offPage.size} link(s) open a same-slug record from another page, each listed:`);
  for (const where of offPage) console.log(`   off-page twin: ${where} — ${OFF_PAGE_TWINS[where] ?? '(unlisted)'}`);
}

/*
 * CHECK 6 — A RECORD NAMES A BOOK ITS OWN DOCUMENT IS PRINTED IN.
 *
 * CHECK 4 holds the alias TABLE to desk #166 (different books are never folded together), but a record's
 * book does not always come through the table: a record kept from the Foundry reference keeps Foundry's
 * label, and an overlay row sets whatever it says. Both folded books the table no longer folds — the five
 * Hell's Destiny tactics (tactic-33..37, printed in #223 only) still read "Adventure Path: Hell's Destiny",
 * and four Dark Archive (Remastered) backgrounds (background-587..590) read the Gatewalkers Player's Guide
 * from a batch-022 row. So every record's `source.book` must be a book its own document is printed in —
 * under any spelling of that book (mapBook, or the same title once prefixes, "The" and "(Remastered)" are
 * set aside, as CHECK 4 counts them). The records that named another book when this check went in are the
 * baseline in scripts/data/book-doc-baseline.json: a new one fails, and so does a listed one that has been
 * repaired (remove it — the list only shrinks) or whose pair of books has changed.
 */
const bookProblems = [];
{
  const BASELINE = 'scripts/data/book-doc-baseline.json';
  const baseline = JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8'));
  const listed = Object.keys(baseline).filter((k) => k !== '_');
  for (const [where, pair] of otherBook) {
    if (!(where in baseline)) bookProblems.push(`${where}: ${pair} — the record names a book its document is not printed in`);
    else if (baseline[where] !== pair) bookProblems.push(`${where}: now ${pair}, baseline says ${baseline[where]}`);
  }
  for (const where of listed) if (!otherBook.has(where)) bookProblems.push(`${where} is in ${BASELINE} but now names its document's book — remove the entry`);
  console.log(`${otherBook.size} record(s) name a book their document is not printed in; ${listed.length} in the baseline (it only shrinks).`);
}

/*
 * CHECK 7 — A BOOK SPLIT MOVES ONLY WHAT THE OLD BOOK DOES NOT PRINT.
 *
 * src/rules/sources.ts BOOK_SPLITS turns a split's new book on for a STORED selection that had the old one
 * on, once; a new selection, or one that already carries the split mark, sees each book as its own toggle.
 * So a record printed in BOTH books that the split moved under the new key disappears for every player who
 * turns on only the old one — and it had no reason to move. The Beginner Box showed it (desk #166, while its
 * two guides were split): five items printed in the 2020 Game Master's Guide AND in Secrets of the Unlit Star
 * (equipment-4349..4354) left the Unlit Star label for the 2020 guide, because the importer breaks a same-shelf
 * tie by the Archives' list order. The two guides fold together again (one book); the check holds every split
 * still in BOOK_SPLITS. A record printed in both keeps the old key.
 */
console.log(`${BOOK_SPLITS.length} book split(s); ${splitProblems.length} record(s) moved to a split's new book although the old book prints them.`);

/*
 * CHECK 8 — A RECORD MOVED TO A REPRINT DOES NOT KEEP THE OLD PRINTING'S PROSE.
 *
 * The reprint rule moves a record's page, book, traits, edition and display tree, but its plain description
 * (`d` in core-descriptions.json — the search text and the popup's fallback) is carried from the record as it
 * was. items/cantrip-deck-5-pack moved to Impossible Magic (equipment-5140-4612) and still read the Secrets
 * of Magic text ("…color-coded based on its school", envision, Interact): two printings on one record, which
 * gold-set R12 forbids. So a record whose own document replaced an older printing must not read more like
 * that older printing than like its own: the share of the prose's words (4+ letters) found in each page is
 * compared, and a margin over 0.05 in the old page's favour is a finding. The records that read that way
 * when the check went in are the baseline in scripts/data/moved-prose-baseline.json: a new one fails, and so
 * does a listed one that no longer reads that way (remove it — the list only shrinks).
 */
const proseProblems = [];
{
  const BASELINE = 'scripts/data/moved-prose-baseline.json';
  const baseline = JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8'));
  /*
   * batch P02: distracting-spellstrike#description — the judgement lives in scripts/lib/moved-prose.mjs
   * (pinned by test/batchP02-gap-data-rows-2.test.ts), and it has a second reading. The margin rule
   * below is unchanged; the VERBATIM reading (every counted word on the replaced page, not every one on
   * its own) catches the short near-identical reprints the 0.05 margin cannot: feats/distracting-spellstrike
   * read feat-2854's "arcane, illusion, and visual traits" at own 0.951 / old 1.000 and passed.
   * Its own baseline, scripts/data/moved-prose-verbatim-baseline.json, holds the records that read that
   * way when the reading went in (measured with batch P02's description rows applied): a new one fails,
   * a listed one whose pair changed fails, and a listed one now clean is reported for removal.
   */
  const VERBATIM_BASELINE = 'scripts/data/moved-prose-verbatim-baseline.json';
  const verbatimBaseline = JSON.parse(readFileSync(join(ROOT, VERBATIM_BASELINE), 'utf8'));
  const stale = new Map();
  const verbatim = new Map();
  for (const { where, D, olds, prose } of onReprint) {
    const v = movedProseVerdict(prose, index.docs.get(D)?.text ?? '', olds.map((o) => [o, index.docs.get(o)?.text ?? '']));
    if (v?.kind === 'margin') stale.set(where, `${D} reads like ${v.best}`);
    else if (v?.kind === 'verbatim') verbatim.set(where, `${D} reads like ${v.best}`);
  }
  const listed = Object.keys(baseline).filter((k) => k !== '_');
  for (const [where, pair] of stale) {
    if (!(where in baseline)) proseProblems.push(`${where}: ${pair} — the prose is the printing its document replaced`);
    else if (baseline[where] !== pair) proseProblems.push(`${where}: now ${pair}, baseline says ${baseline[where]}`);
  }
  for (const where of listed) if (!stale.has(where)) proseProblems.push(`${where} is in ${BASELINE} but its prose now reads like its own printing — remove the entry`);
  console.log(`${onReprint.length} record(s) with prose sit on a reprint; ${stale.size} read like the printing it replaced, ${listed.length} in the baseline (it only shrinks).`);
  const vListed = Object.keys(verbatimBaseline).filter((k) => k !== '_');
  for (const [where, pair] of verbatim) {
    if (!(where in verbatimBaseline)) proseProblems.push(`${where}: ${pair} word for word (every counted word is on the replaced page, not every one on its own) — the prose is the printing its document replaced`);
    else if (verbatimBaseline[where] !== pair) proseProblems.push(`${where}: now ${pair} word for word, ${VERBATIM_BASELINE} says ${verbatimBaseline[where]}`);
  }
  for (const where of vListed) if (!verbatim.has(where)) console.log(`   CHECK 8: ${where} no longer reads like its replaced printing word for word — remove its line from ${VERBATIM_BASELINE}`);
  console.log(`${verbatim.size} more read like it word for word (inside the 0.05 margin); ${vListed.length} in ${VERBATIM_BASELINE} (it only shrinks).`);
}

/*
 * CHECK 9 — A LEGACY ITEM'S "REMASTERED AS" IS AN ITEM THE HIDE-LEGACY SHOP OFFERS.
 *
 * "Hide legacy data" takes the legacy item out of the shop and leaves its popup's link as the way to the
 * reprint. findHiddenTwins brings back the 56 reprints the duplicate rules hide, but a link can also open a
 * record the shop never offers at all: an AoN family summary (findUmbrellaIds). Healer's Gel (Lesser) does —
 * the level-5 Impossible Magic grade has no record of its own, so a hide-legacy player cannot get it. This is
 * measured with the shop's own list (shopItems over seed + core, the four hidden-from-lists sets computed as
 * src/data/index.ts mergeWithSeed computes them), not a copy of its rules. The links in that state when the
 * check went in are the baseline in scripts/data/never-offered-links-baseline.json, each with its reason: a new
 * one fails, and so does a listed one whose target has changed; a listed one now offered is reported only.
 */
const offerProblems = [];
{
  const BASELINE = 'scripts/data/never-offered-links-baseline.json';
  const baseline = JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8'));
  const db = {};
  for (const k of new Set([...Object.keys(seedContent), ...Object.keys(core)])) db[k] = { ...(seedContent[k] ?? {}), ...(core[k] ?? {}) };
  db.duplicateIds = findDuplicateIds(db);
  db.hiddenTwins = findHiddenTwins(db, db.duplicateIds);
  db.umbrellaIds = findUmbrellaIds(db.items);
  db.combinationFormIds = findCombinationFormIds(db.items);
  const offered = new Set(shopItems(db, true).map((i) => i.id));
  const never = new Map();
  for (const [id, it] of Object.entries(db.items)) {
    const ra = it?.remasteredAs;
    if (ra?.bucket === 'items' && (it.edition === 'legacy' || it.edition === 'legacy-era') && !offered.has(ra.id)) never.set(`items/${id}`, `items/${ra.id}`);
  }
  for (const [where, to] of never) {
    const row = baseline[where];
    if (!row) offerProblems.push(`${where} is "Remastered as" ${to}, which the hide-legacy shop never offers`);
    else if (row.to !== to || !row.reason) offerProblems.push(`${where}: now "Remastered as" ${to}, baseline says ${row.to} (${row.reason ?? 'no reason'})`);
  }
  const listed = Object.keys(baseline).filter((k) => k !== '_');
  for (const where of listed) if (!never.has(where)) console.log(`   CHECK 9: ${where} now links to an offered item (or no longer links) — remove its line from ${BASELINE}`);
  console.log(`${never.size} legacy item(s) link to an item the hide-legacy shop never offers; ${listed.length} in the baseline (it only shrinks).`);
}

if (offerProblems.length) {
  console.error('\nreprint-check: FAIL — a legacy item\'s "Remastered as" is an item the hide-legacy shop never offers (CHECK 9):');
  for (const p of offerProblems.slice(0, 40)) console.error('   ' + p);
  console.error('   Repair: give the reprint a record the shop offers (its own grade, or a twin findHiddenTwins brings back),');
  console.error('   or point the link at the grade that ships. The baseline only shrinks.');
  process.exit(1);
}

if (splitProblems.length) {
  console.error('\nreprint-check: FAIL — a book split moved a record its old book also prints (CHECK 7):');
  for (const p of splitProblems.slice(0, 40)) console.error('   ' + p);
  console.error('   Repair: a `source` overlay row through scripts/apply-parity-fixes.mjs naming the old book');
  console.error('   (see work/.xk-refute-fixes-3.json).');
  process.exit(1);
}

if (proseProblems.length) {
  console.error('\nreprint-check: FAIL — a record on a reprint carries the replaced printing\'s prose (CHECK 8):');
  for (const p of proseProblems.slice(0, 40)) console.error('   ' + p);
  if (proseProblems.length > 40) console.error(`   … and ${proseProblems.length - 40} more`);
  console.error('   Repair: a `description` overlay row through scripts/apply-parity-fixes.mjs with its own page\'s text');
  console.error('   (see work/.xk-refute-fixes-3.json), or remove a repaired record from the baseline.');
  process.exit(1);
}

if (numberProblems.length) {
  console.error('\nreprint-check: FAIL — a "Remastered as" link opens a record with other numbers:');
  for (const p of numberProblems.slice(0, 40)) console.error('   ' + p);
  console.error('   Either the record sits on the wrong grade block (pin it to the block whose numbers it carries, as');
  console.error('   work/.xk-refute-fixes.json does for the Judgment Thurible) or the reprint really differs — then add');
  console.error('   it to TWIN_NUMBERS_DIFFER with the Archives page that says so.');
  process.exit(1);
}

if (bookProblems.length) {
  console.error('\nreprint-check: FAIL — a record names a book its own document is not printed in (desk #166):');
  for (const p of bookProblems.slice(0, 40)) console.error('   ' + p);
  if (bookProblems.length > 40) console.error(`   … and ${bookProblems.length - 40} more`);
  console.error('   Repair: a `source` overlay row through scripts/apply-parity-fixes.mjs naming the document\'s book');
  console.error('   (see work/.xk-refute-fixes.json), or remove a repaired record from the baseline.');
  process.exit(1);
}

if (aliasProblems.length) {
  console.error('\nreprint-check: FAIL — a book alias moves records to another book without saying why, or a record escapes a fold (desk #166):');
  for (const p of aliasProblems.slice(0, 40)) console.error('   ' + p);
  console.error('   A "(Remastered)" printing may fold into its own book; different books are never folded together.');
  console.error('   An escaped record takes the fold target through a `source` row (scripts/apply-parity-fixes.mjs) and its');
  console.error('   old spelling a src/rules/sources.ts BOOK_FOLDS pair, so a stored selection keeps it.');
  process.exit(1);
}

if (staleLink.length || unexplained.length) {
  console.error('\nreprint-check: FAIL — a "Remastered as" link or a cross-kind reprint link is not accounted for:');
  for (const s of staleLink.slice(0, 40)) console.error('   ' + s);
  for (const u of unexplained.slice(0, 40)) console.error(`   no rule and no reason: ${u}`);
  console.error('   A `remasteredAs` must be exactly shippedTwin() (re-run `npm run data`); a cross-kind link must be');
  console.error('   paired by a rule in scripts/lib/reprint.mjs, pinned by an aonId ruling, or given its reason in');
  console.error('   REFUSED_BY_HAND above.');
  process.exit(1);
}

if (staleBook.length) {
  console.error('\nreprint-check: FAIL — the document moved to a newer printing and source.book did not follow.');
  console.error('   source.book is the source-filter key, so these are hidden from a player who owns the new book:');
  for (const b of staleBook.slice(0, 40)) console.error('   ' + b);
  if (staleBook.length > 40) console.error(`   … and ${staleBook.length - 40} more`);
  console.error('   Repair: a `source` overlay row per record through scripts/apply-parity-fixes.mjs,');
  console.error('   citing the reprint doc id (see work/.reprint-source-book.json for the 20 already done).');
  process.exit(1);
}

if (unmarked.length) {
  console.error(`\nreprint-check: FAIL — ${unmarkedRecords.size} shipped twin(s) do not carry the owner's ruling (desk #158):`);
  console.error('   the old page stays, marked `edition: "legacy"` (hide-legacy hides it; `superseded` would');
  console.error('   always hide it) and carrying `remasteredAs` so the popup can link to the reprint.');
  for (const u of unmarked.slice(0, 40)) console.error('   ' + u);
  if (unmarked.length > 40) console.error(`   … and ${unmarked.length - 40} more`);
  console.error('   Repair: re-run the chain — `npm run data` (build-map.mjs computes the pairing,');
  console.error('   stamp-aonid.mjs writes it; the predicate is shippedTwin() in scripts/lib/reprint.mjs).');
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
