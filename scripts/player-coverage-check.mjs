/*
 * GUARD: EVERY ARCHIVES PAGE A PLAYER CAN PICK HAS A RECORD IN THE APP.
 *
 * Owner, 2026-09-24: "the players' missing data is more important — add it". The importer used to
 * CREATE new records only in four buckets (feats, actions, spells, items), so a background, heritage or
 * class feature that exists only in a newer book never reached the app, and nothing said so. This
 * compares every live page of every player-option category of the export against core.json, page by
 * page, with the rule set in scripts/lib/player-coverage.mjs (present by aonId / by a linked twin / by
 * name within the same kind and book-or-remaster; class-table chassis rows are structural).
 *
 * A page that is none of those is MISSING and fails the run unless
 * scripts/data/player-coverage-allow.json names it by doc id with a one-line reason:
 *   "structural: chassis row | legacy class row | shared record <key> — <name>"  the class-table rule
 *       (re-checked every run: a row whose page no longer meets the rule fails);
 *   "hidden: AoN exclude_from_search — <name>"  the Archives hide the page themselves;
 *   anything else — a deliberate gap with its evidence or the ruling that keeps it out.
 * A row for a page that is now present fails too — the list stays exact, never a wildcard.
 *
 * Four more ways a created record can be wrong, each of which happened (2026-09-24):
 *   DUPLICATE   a created record whose page another record already answers for, or that shares its
 *               bare name AND book with one (`backgrounds/refugee-fop`), or two created records for a
 *               page and its own reprint (Keep Pace, APG and Player Core 2);
 *   LEFTOVER    a record with step 4's `<slug>-<book>` key that player-created.json no longer lists;
 *   MISPOINTED  a record carrying another book's page of its name while its own book's page is carried
 *               by nothing — the shape that made the rule call that page missing;
 *   HIDDEN SHELF  a book of choosable records that src/rules/sources.ts puts on the hidden niche shelf
 *               while the Archives shelve it for players (the Dead God's Hand backgrounds);
 *   UNREAD / LIVE MISMATCH  a created record whose live page was never read, or that disagrees with it
 *               on name, level, rarity or edition (Volatile Spark shipped common; its page is Uncommon).
 *
 * It imports src/rules/sources.ts, so it runs under jiti:
 *
 *   npx jiti scripts/player-coverage-check.mjs
 *   npx jiti scripts/player-coverage-check.mjs --json work/player-gaps.json   # created / present elsewhere / excluded
 *   npx jiti scripts/player-coverage-check.mjs --propose                           # allow rows for today's gaps
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReprintMap, EXPORT_DIR } from './lib/reprint.mjs';
import {
  KINDS, REAL_BUCKETS, bookKey, buildIndex, classify, linkGraph, linkedIds, nameForms, reprintEdges, remasterBooks, sameBookOrRemaster,
} from './lib/player-coverage.mjs';
import { loadLivePages, liveEdition, sameName } from './lib/live-pages.mjs';
// TypeScript, so this guard runs under jiti (package.json `verify`), like the other src-reading checks.
import { categoryOfBook, CHOOSABLE_SOURCE_MAPS, NICHE_BY_DESIGN, NICHE_CATEGORIES } from '../src/rules/sources';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const PROPOSE = argv.includes('--propose');
const ALLOW_PATH = join(ROOT, 'scripts/data/player-coverage-allow.json');

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const allow = existsSync(ALLOW_PATH) ? JSON.parse(readFileSync(ALLOW_PATH, 'utf8')) : {};

// Slim copies of every player-option page, plus the class pages the reprint class hop joins through.
const docs = new Map();
for (const cat of [...Object.keys(KINDS), 'class']) {
  const f = join(EXPORT_DIR, `${cat}.json`);
  if (!existsSync(f)) continue;
  for (const [id, d] of Object.entries(JSON.parse(readFileSync(f, 'utf8')).docs ?? {})) {
    docs.set(id, {
      id, category: d.category ?? cat, name: String(d.name ?? '').trim(), url: d.url, book: d.book,
      books: [...new Set([d.book, ...(d.data?.source ?? [])].map((x) => String(x ?? '').trim()).filter(Boolean))],
      release_date: d.release_date ?? '', edition: d.edition ?? '', level: d.level,
      price: d.data?.price, // the reprint map's rule C compares a grade pair's level and price (desk #167)
      exclude_from_search: d.exclude_from_search === 1 || d.exclude_from_search === true,
      superseded_by: d.superseded_by, text: String(d.data?.text ?? ''),
      // remaster_name / legacy_name: the reprint map's rule A reads them (scripts/lib/reprint.mjs header).
      data: {
        legacy_id: d.data?.legacy_id, remaster_id: d.data?.remaster_id, class: d.data?.class, archetype: d.data?.archetype, ability_type: d.data?.ability_type,
        remaster_name: d.data?.remaster_name, legacy_name: d.data?.legacy_name,
      },
    });
  }
}

const desc = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));
const reprint = buildReprintMap(docs);
const edges = reprintEdges(docs, reprint);
const ctx = {
  index: buildIndex(core, desc), adj: linkGraph(docs, edges), pairs: remasterBooks(docs, edges),
  docs, textOf: (id) => docs.get(String(id))?.text,
};

const table = {};
const findings = [];
const verdicts = [];
const seenAllow = new Set();
for (const page of docs.values()) {
  if (!KINDS[page.category] || !page.name) continue;
  const v = classify(page, ctx);
  const kind = KINDS[page.category].kind;
  const t = (table[page.category] ??= { kind, pages: 0, aonId: 0, twin: 0, name: 0, structural: 0, allowed: 0, missing: 0 });
  t.pages++;
  const row = { id: page.id, category: page.category, name: page.name, book: page.book, level: page.level, hidden: page.exclude_from_search, ...v };
  verdicts.push(row);
  const why = allow[page.id];
  if (why !== undefined) seenAllow.add(page.id);
  if (v.status === 'aonId' || v.status === 'twin' || v.status === 'name') {
    t[v.status]++;
    if (why !== undefined) findings.push(`stale allow row ${page.id} "${page.name}" — present now (${v.status}: ${v.via})`);
    continue;
  }
  if (v.status === 'structural') t.structural++;
  if (why !== undefined) {
    if (String(why).startsWith('structural:') && v.status !== 'structural') {
      findings.push(`allow row ${page.id} "${page.name}" says structural but the rule no longer holds`);
    }
    t.allowed++;
    continue;
  }
  t.missing++;
  findings.push(`MISSING ${page.id} ${page.category} "${page.name}" (${page.book}${page.exclude_from_search ? ', AoN-hidden' : ''}${v.status === 'structural' ? `, structural by rule ${v.via} — allow it with that reason` : ''})`);
}
for (const id of Object.keys(allow)) {
  if (!seenAllow.has(id)) findings.push(`allow row ${id} names no player-option page in the export`);
}

/*
 * A CREATED RECORD MUST NOT DUPLICATE ONE THAT SHIPS. The importer creates exactly the pages the rule
 * above calls missing when its own last-run records do not count (classify's importer view), so for
 * every record in scripts/migration/out/player-created.json that view must still say "missing" — if it
 * does not, another record already answers for the page and the created one is a second copy. Checked
 * a second way that does not lean on the rule at all, because the rule is what failed the first time
 * (`backgrounds/refugee-fop`, 2026-09-24): no other record of the bucket may carry the same bare name
 * AND the very same `source.book` string.
 */
/** The importer's key rule (scripts/import-core-v2.mjs `slug`). */
const slugOfName = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const createdPath = join(ROOT, 'scripts/migration/out/player-created.json');
const createdRaw = existsSync(createdPath) ? JSON.parse(readFileSync(createdPath, 'utf8')) : {};
const createdKeys = new Set(Object.entries(createdRaw).flatMap(([b, m]) => Object.keys(m ?? {}).map((k) => `${b}/${k}`)));
// page id -> created key, for the third way a copy can be made: two created records for one page and
// its own reprint (the first run made Keep Pace from the APG page AND from its Player Core 2 reprint).
const createdByPage = new Map(Object.entries(createdRaw).flatMap(([b, m]) => Object.entries(m ?? {}).map(([k, meta]) => [String(meta?.doc), `${b}/${k}`])));
for (const [pageId, key] of createdByPage) {
  for (const other of linkedIds(pageId, ctx.adj)) {
    if (createdByPage.has(other) && pageId < other) findings.push(`DUPLICATE created ${key} (${pageId}) and ${createdByPage.get(other)} (${other}) are one page and its reprint — create only the newest printing`);
  }
}
for (const [bucket, m] of Object.entries(createdRaw)) {
  for (const [key, meta] of Object.entries(m ?? {})) {
    const rec = core[bucket]?.[key];
    const page = docs.get(String(meta?.doc));
    if (!rec) { findings.push(`created ${bucket}/${key} is listed in player-created.json but core.json has no such record`); continue; }
    if (!page) continue; // a page the export no longer has is the refresh-loss guard's business
    const v = classify(page, ctx, { skipKeys: createdKeys });
    if (v.status !== 'missing') findings.push(`DUPLICATE created ${bucket}/${key} (${page.id} "${page.name}") — the page is present without it (${v.status}: ${v.via})`);
    const mine = nameForms(rec.name);
    for (const [id, other] of Object.entries(core[bucket] ?? {})) {
      if (id === key || other?.edition === 'superseded' || !other?.source?.book || other.source.book !== rec.source?.book) continue;
      if ([...nameForms(other.name)].some((f) => mine.has(f))) {
        findings.push(`DUPLICATE created ${bucket}/${key} "${rec.name}" — ${bucket}/${id} "${other.name}" has its name and its book (${rec.source.book})`);
      }
    }
  }
}

/*
 * A CREATED RECORD SAYS WHAT ITS LIVE PAGE SAYS. The export lags the page (house rule: the live page
 * wins): it called two Uncommon class options common, and a Legacy Content page neutral. So every page
 * step 4 creates from must have been read (scripts/read-live-pages.mjs --created, into
 * scripts/data/live-pages.json, which the importer reads back), and the record must agree with the read
 * on name, level, rarity and edition.
 */
const live = loadLivePages(ROOT);
for (const [bucket, m] of Object.entries(createdRaw)) {
  for (const [key, meta] of Object.entries(m ?? {})) {
    const rec = core[bucket]?.[key];
    const read = live[String(meta?.doc)];
    if (!rec) continue;
    if (!read) { findings.push(`UNREAD created ${bucket}/${key} (${meta?.doc}) — its live page has not been read: node scripts/read-live-pages.mjs --created`); continue; }
    const want = {
      name: read.name, rarity: read.rarity, ...(read.level != null ? { level: read.level } : {}),
      edition: liveEdition(docs.get(String(meta.doc))?.edition ?? rec.edition, read),
    };
    const off = Object.entries(want).filter(([f, v]) => (f === 'name' ? !sameName(rec.name, v) : rec[f] !== v));
    if (off.length) findings.push(`LIVE MISMATCH created ${bucket}/${key} (${meta.doc}): ${off.map(([f, v]) => `${f} ${JSON.stringify(rec[f])} vs the page's ${JSON.stringify(v)}`).join(', ')}`);
  }
}

/*
 * …and a record step 4 USED to create must not outlive it. Step 4 keys a page whose slug is taken as
 * `<page slug>-<book slug>`; a record of that exact shape that player-created.json no longer lists is a
 * copy some other step carried forward (import-core-v2's step 3 revived the first run's APG Keep Pace as
 * "the legacy half of a reprint" until it was told to leave step 4's records alone).
 */
for (const [bucket, rows] of Object.entries(core)) {
  if (!rows || typeof rows !== 'object') continue;
  for (const [id, rec] of Object.entries(rows)) {
    const P = rec?.aonId ? docs.get(String(rec.aonId)) : null;
    if (!P || createdKeys.has(`${bucket}/${id}`)) continue;
    if (id === `${slugOfName(P.name)}-${slugOfName(P.book)}`) findings.push(`LEFTOVER ${bucket}/${id} has the key step 4 gives ${P.id} "${P.name}" (${P.book}) but player-created.json no longer lists it`);
  }
}

/*
 * A RECORD POINTED AT ANOTHER BOOK'S PAGE WHILE ITS OWN BOOK'S PAGE GOES UNCLAIMED. The shape of
 * `backgrounds/refugee-fall-of-plaguestone` (The Fall of Plaguestone) carrying background-455 (the
 * Player Core 2 Refugee, which `refugee-pc2` carries too) while background-40 — the Fall of
 * Plaguestone page itself — was carried by nothing, so the rule called it missing and the importer
 * made a copy. build-map's weak "slug minus (…)" join picks the first live page of a bare name and
 * never looks at the book. The fix is a repoint row in scripts/fix-aonid-collisions.mjs.
 */
/** A page of the record's name can still be ANOTHER option: another archetype's feat, another class's
 *  feature. Those are never the record's own page. */
const samePlace = (Q, rec) => {
  const arch = [].concat(Q.data?.archetype ?? []).map(slugOfName);
  if (arch.length && !arch.includes(rec.archetype)) return false;
  const cls = slugOfName(Q.data?.class);
  return !cls || !(rec.traits ?? []).length || rec.traits.includes(cls);
};
const pagesByForm = new Map(); // kind|form -> [page]
for (const p of docs.values()) {
  const spec = KINDS[p.category];
  if (!spec || !p.name || p.exclude_from_search) continue;
  for (const f of nameForms(p.name)) {
    const k = `${spec.kind}|${f}`;
    (pagesByForm.get(k) ?? pagesByForm.set(k, []).get(k)).push(p);
  }
}
for (const [bucket, rows] of Object.entries(core)) {
  if (!REAL_BUCKETS.has(bucket) || !rows || typeof rows !== 'object') continue;
  for (const [id, rec] of Object.entries(rows)) {
    const P = rec?.aonId ? docs.get(String(rec.aonId)) : null;
    const spec = P && KINDS[P.category];
    if (!spec || !spec.buckets.includes(bucket) || !rec.source?.book || rec.edition === 'superseded') continue;
    if (sameBookOrRemaster(P.books, rec.source.book, ctx.pairs)) continue;
    const own = new Set();
    for (const f of nameForms(rec.name)) {
      for (const Q of pagesByForm.get(`${spec.kind}|${f}`) ?? []) {
        if (Q.id === P.id || !samePlace(Q, rec) || !sameBookOrRemaster(Q.books, rec.source.book, ctx.pairs)) continue;
        // Unclaimed = neither its own id nor a linked printing's is on any record.
        if (['aonId', 'twin'].includes(classify(Q, ctx).status)) continue;
        own.add(`${Q.id} "${Q.name}"`);
      }
    }
    if (own.size) findings.push(`MISPOINTED ${bucket}/${id} "${rec.name}" (${rec.source.book}) carries ${P.id} "${P.name}" (${P.book}); its own book prints ${[...own].join(', ')}, which no record carries — repoint it (scripts/fix-aonid-collisions.mjs)`);
  }
}

/*
 * A RECORD IS ONLY REACHABLE IF ITS BOOK IS ON A SHELF THE SOURCES CARD SHOWS. categoryOfBook
 * (src/rules/sources.ts) shelves a book by its name, and a book it does not recognise lands on "Other",
 * which is hidden unless the player turns niche sources on. So a created record can exist, pass every
 * check above and still be unpickable: the six Dead God's Hand backgrounds, 2026-09-24, and before them
 * 1,029 Impossible Magic records. The Archives say which shelf every book is on
 * (`primary_source_category`); a book they put on a player's shelf must not land on a hidden one.
 */
const SHOWN_SHELVES = new Set(['Rulebooks', 'Lost Omens', 'Adventures', 'Adventure Paths', 'Society']);
const shelfOf = new Map();
try {
  for (const d of Object.values(JSON.parse(readFileSync(join(EXPORT_DIR, 'source.json'), 'utf8')).docs ?? {})) {
    if (d?.name) shelfOf.set(bookKey(d.name), d.data?.primary_source_category);
  }
} catch { findings.push(`shelf check: cannot read ${join(EXPORT_DIR, 'source.json')}`); }
const hiddenBooks = new Map(); // book -> [count, shelf]
for (const bucket of CHOOSABLE_SOURCE_MAPS) {
  for (const rec of Object.values(core[bucket] ?? {})) {
    const book = rec?.source?.book;
    if (!book || NICHE_BY_DESIGN.test(book) || !NICHE_CATEGORIES.has(categoryOfBook(book))) continue;
    const shelf = shelfOf.get(bookKey(book));
    if (!SHOWN_SHELVES.has(shelf)) continue;
    const h = hiddenBooks.get(book) ?? [0, shelf];
    h[0]++;
    hiddenBooks.set(book, h);
  }
}
for (const [book, [n, shelf]] of hiddenBooks) {
  findings.push(`HIDDEN SHELF "${book}" — ${n} choosable record(s) on the niche "${categoryOfBook(book)}" shelf, where the Archives shelve the book as "${shelf}" (add it to src/rules/sources.ts)`);
}

const pad = (s, n) => String(s).padStart(n);
console.log('category'.padEnd(34) + pad('pages', 7) + pad('aonId', 7) + pad('twin', 6) + pad('name', 6) + pad('struct', 7) + pad('allow', 7) + pad('MISS', 6));
const tot = { pages: 0, aonId: 0, twin: 0, name: 0, structural: 0, allowed: 0, missing: 0 };
for (const [cat, t] of Object.entries(table).sort()) {
  console.log(cat.padEnd(34) + pad(t.pages, 7) + pad(t.aonId, 7) + pad(t.twin, 6) + pad(t.name, 6) + pad(t.structural, 7) + pad(t.allowed, 7) + pad(t.missing, 6));
  for (const k of Object.keys(tot)) tot[k] += t[k];
}
console.log('TOTAL'.padEnd(34) + pad(tot.pages, 7) + pad(tot.aonId, 7) + pad(tot.twin, 6) + pad(tot.name, 6) + pad(tot.structural, 7) + pad(tot.allowed, 7) + pad(tot.missing, 6));
console.log('(struct = class-table rows by rule; allow = named in scripts/data/player-coverage-allow.json)');

if (JSON_OUT) {
  // The hand-back shape: what the importer created (the next parity batch's cut), what is present under
  // another document id, what is excluded and why, and anything still missing.
  const created = Object.fromEntries(Object.entries(createdRaw).map(([b, m]) => [b, Object.entries(m).map(([key, v]) => ({ id: `${b}/${key}`, aonId: v.doc }))]));
  const row = (v) => [v.id, v.name, v.via ?? allow[v.id] ?? ''];
  writeFileSync(JSON_OUT, JSON.stringify({
    measured: new Date().toISOString().slice(0, 10),
    rules: 'scripts/lib/player-coverage.mjs', guard: 'scripts/player-coverage-check.mjs', allow: 'scripts/data/player-coverage-allow.json',
    table,
    created,
    presentUnderAnotherId: {
      columns: ['page', 'name', 'via'],
      byName: verdicts.filter((v) => v.status === 'name').map(row),
      byTwin: verdicts.filter((v) => v.status === 'twin').map(row),
    },
    structuralExcluded: { columns: ['page', 'name', 'rule'], rows: verdicts.filter((v) => v.status === 'structural').map(row) },
    allowedOther: { columns: ['page', 'name', 'reason'], rows: verdicts.filter((v) => v.status === 'missing' && allow[v.id] !== undefined).map((v) => [v.id, v.name, allow[v.id]]) },
    missing: verdicts.filter((v) => v.status === 'missing' && allow[v.id] === undefined).map(row),
  }, null, 1));
  console.log(`hand-back -> ${JSON_OUT}`);
}
if (PROPOSE) {
  const rows = {};
  for (const r of verdicts) {
    if (r.status !== 'missing' && r.status !== 'structural') continue;
    if (allow[r.id] !== undefined) continue;
    if (r.status === 'structural') {
      rows[r.id] = `structural: ${r.via === 'chassis' ? 'chassis row'
        : r.via === 'legacy-class' ? 'legacy class row' : `shared record ${r.via.slice(7)}`} — ${r.name}`;
    }
    else if (r.hidden) rows[r.id] = `hidden: AoN exclude_from_search — ${r.name}`;
  }
  console.log(JSON.stringify(rows, null, 1));
}

if (findings.length) {
  console.log(`\n${findings.length} finding(s):`);
  for (const f of findings.slice(0, 200)) console.log('  ' + f);
  if (findings.length > 200) console.log(`  … and ${findings.length - 200} more (--json for all)`);
  process.exit(1);
}
console.log('\nplayer-coverage-check: every player-option page has a record, a twin, a same-book name match or an allow row.');
