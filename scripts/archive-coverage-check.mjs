/*
 * GUARD: EVERY ARCHIVES PAGE HAS A RECORD THE GM CAN FIND BY NAME IN THE TRACKER'S SEARCH.
 *
 * Owner, 2026-09-24: "every record of PF2e needs to be accessible to the GM in the tracker's search".
 * The Search (src/integration/hostSearchRecords.ts) is by name over every core.json bucket, plus the
 * bestiary; a page with no record there is a page the GM cannot open. The player-option categories are
 * scripts/player-coverage-check.mjs's (its own rule and allow list); THIS guard is every other category
 * of the export, page by page, with the rule in scripts/lib/archive-coverage.mjs (present by aonId, by
 * the bestiary, by a linked twin, by name within its kind's bucket with book-or-text evidence, or
 * through its newer printing in any category).
 *
 * A page that is none of those fails the run unless scripts/data/archive-coverage-allow.json names it by
 * doc id with a one-line reason:
 *   "hidden: AoN exclude_from_search — <name>"  the Archives hide the page themselves;
 *   "stub: an AoN page with no name — <name>"    a nameless or "(…)" fragment of another page;
 *     (both re-checked WORD FOR WORD against allowReason(); a nameless page reads
 *     "no name, <book>, <url>" in place of <name>)
 *   anything else — a deliberate gap with its evidence.
 * A row for a page that is now present fails too, and so does a row naming no page: the list stays exact.
 *
 * The created records only ADD: a description link may open one only when no other record of its bucket
 * carries its name (the LINK findings — a link the app sent to its own record stays there), and no
 * title-only popup may open one (the INDEX findings — public/ast-index.json never names a created record).
 * And none is an old printing made beside the newer one that already answers for it (the LEGACY findings),
 * and every record of `reference`, rules, sidebar, categoryPage and disease that has a page carries its
 * book, as does each record of a name a created one shares, so none of those Search rows goes unlabelled
 * (the UNLABELLED findings) — the book its own page's Source line names (the BOOK findings).
 *
 * And the two guards together must cover the WHOLE export: an export category that is neither a player
 * option (scripts/lib/player-coverage.mjs KINDS) nor read here fails the run, so a category the next
 * Archives refresh adds cannot fall between them.
 *
 *   node scripts/archive-coverage-check.mjs
 *   node scripts/archive-coverage-check.mjs --json work/archive-gaps.json   # every page's verdict
 *   node scripts/archive-coverage-check.mjs --propose                       # allow rows for hidden / stub gaps (new or misworded)
 *   node scripts/archive-coverage-check.mjs --propose --write               # …merged into the allow file
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { EXPORT_DIR } from './lib/reprint.mjs';
import { KINDS } from './lib/player-coverage.mjs';
import {
  LABELLED_BUCKETS, allowReason, allowRowHolds, buildIndex, classify, createdRefs as readCreatedRefs, isStub, linkContext, loadBestiary, loadPages, namesBook,
  nonPlayerCategories, viaNewerPrinting,
} from './lib/archive-coverage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const PROPOSE = argv.includes('--propose');
const ALLOW_PATH = join(ROOT, 'scripts/data/archive-coverage-allow.json');

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const desc = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));
const allow = existsSync(ALLOW_PATH) ? JSON.parse(readFileSync(ALLOW_PATH, 'utf8')) : {};

const findings = [];
const categories = nonPlayerCategories(EXPORT_DIR);
const everyCategory = readdirSync(EXPORT_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
for (const c of everyCategory) if (!KINDS[c] && !categories.includes(c)) findings.push(`category ${c} is read by neither coverage guard`);

const pages = loadPages(EXPORT_DIR, categories);
const ctx = {
  index: buildIndex(core, desc, (id) => pages.get(id)),
  ...linkContext(pages),
  pages,
  bestiary: loadBestiary(ROOT),
};

const table = {};
const verdicts = [];
const seenAllow = new Set();
for (const page of pages.values()) {
  const v = classify(page, ctx);
  const t = (table[page.category] ??= {});
  t.pages = (t.pages ?? 0) + 1;
  verdicts.push({ id: page.id, category: page.category, name: page.name, book: page.book, hidden: page.exclude_from_search, stub: isStub(page), ...v });
  const why = allow[page.id];
  if (why !== undefined) seenAllow.add(page.id);
  const inc = (k, n = 1) => { t[k] = (t[k] ?? 0) + n; };
  if (v.status !== 'missing') {
    inc(v.status);
    if (why !== undefined) findings.push(`stale allow row ${page.id} "${page.name}" — present now (${v.status}: ${v.via})`);
    continue;
  }
  if (why !== undefined) {
    if (!allowRowHolds(why, page)) findings.push(`allow row ${page.id} "${page.name}" reads ${JSON.stringify(why)}, but the page makes it ${JSON.stringify(allowReason(page) ?? 'no hidden/stub row')} (--propose --write rewrites it)`);
    inc('allowed');
    continue;
  }
  inc('missing');
  inc('missingKB', Buffer.byteLength(page.text, 'utf8') / 1024);
  findings.push(`MISSING ${page.id} ${page.category} "${page.name}" (${page.book}${page.exclude_from_search ? ', AoN-hidden' : ''}${isStub(page) ? ', unnamed stub' : ''})`);
}
for (const id of Object.keys(allow)) if (!seenAllow.has(id)) findings.push(`allow row ${id} names no non-player page in the export`);

/*
 * The records the importer created must ADD links, never take them: a description link that opened the
 * app's own record of a name ("level" -> Player Core's Level) must not start opening a created record of
 * that same name (Kingmaker's Level) because AoN's auto-link happens to name that page. Read off the
 * shipped trees: a created record may be a link target only when no other record of its bucket carries
 * its name. (53,797 links moved this way on the first run, 2026-09-25.)
 */
const createdRefs = readCreatedRefs(ROOT);

/*
 * …and none of them is an old printing whose NEWER one the Search already reaches (gold-set R12; the
 * rule's second `twin` in scripts/lib/archive-coverage.mjs). The Archives' reprint link often crosses
 * categories, which scripts/reprint-check.mjs does not follow: the first runs made the Core Rulebook's
 * twelve "Key Terms" sidebars beside the Player Core class pages that reprint them, and 17 more such
 * sidebars — 29 legacy records beside their reprint (measured 2026-09-25).
 */
for (const ref of createdRefs) {
  const [b, k] = ref.split(':');
  const page = pages.get(String(core[b]?.[k]?.aonId ?? ''));
  const n = page && viaNewerPrinting(page, ctx);
  if (n) findings.push(`LEGACY the created ${b}/${k} is ${page.id} "${page.name}" (${page.book}), whose newer printing is already present: ${n.via} — the importer must not make it (scripts/lib/archive-coverage.mjs creationPlan)`);
}

const holderOf = new Map(); // `bucket|lower name` -> key of a record the importer did NOT create
const sameName = new Map(); // `bucket|lower name` -> [key, record][] in LABELLED_BUCKETS or a bucket that holds created records
const createdBuckets = new Set([...createdRefs].map((r) => r.split(':')[0]));
for (const b of new Set([...LABELLED_BUCKETS, ...createdBuckets])) {
  for (const [k, r] of Object.entries(core[b] ?? {})) {
    if (!r?.name) continue;
    const nk = `${b}|${r.name.toLowerCase()}`;
    if (!createdRefs.has(`${b}:${k}`)) holderOf.set(nk, k);
    (sameName.get(nk) ?? sameName.set(nk, []).get(nk)).push([k, r]);
  }
}
/*
 * …and each record carries a book, as a created one does: a bare row is a printing the GM cannot tell
 * ("Hero Points" led with War of Immortals' alternate mythic rules, unlabelled; "Scarlet Fever · DISEASE"
 * named no book — 2,519 bare rows in the four glossary buckets, 2026-09-25). The importer's rule: every
 * record of LABELLED_BUCKETS; in another bucket holding a created record, a name another record of its
 * bucket carries, or a created record of any bucket. A record with no page has no book to give: listed.
 */
/*
 * …and that book is the one on its page's own Source line (namesBook), never the source filter's fold of
 * it into another book or printing: 56 of these rows once read "Monster Core 2" for a Bestiary 3 creature
 * family, "Treasure Vault (Remastered)" for a legacy Treasure Vault page, plain "Guns & Gears" for its
 * Remastered printing, or a whole Adventure Path for one volume (2026-09-25).
 */
const createdNames = new Set([...createdRefs].map((ref) => { const [b, k] = ref.split(':'); return String(core[b]?.[k]?.name ?? '').toLowerCase(); }));
const bareNoPage = [];
for (const [nk, rs] of sameName) {
  const b = nk.split('|')[0];
  if (!LABELLED_BUCKETS.has(b) && rs.length < 2 && !createdNames.has(nk.slice(nk.indexOf('|') + 1))) continue;
  for (const [k, r] of rs) {
    const page = pages.get(String(r.aonId ?? ''));
    if (!r.source?.book) {
      if (!page) bareNoPage.push(`${b}/${k}`);
      else findings.push(`UNLABELLED ${b}/${k} "${r.name}" carries no book, though its page ${page.id} names "${page.book}" — its Search row has no detail line (scripts/import-core-v2.mjs step 5)`);
      continue;
    }
    if (page && !namesBook(r.source.book, page.book)) findings.push(`BOOK ${b}/${k} "${r.name}" reads "${r.source.book}" in the Search, but its page ${page.id} is printed in "${page.book}" (scripts/import-core-v2.mjs step 5 pageBook)`);
  }
}
console.log(`unlabelled, no page to take a book from: ${bareNoPage.length}${bareNoPage.length ? ` — ${bareNoPage.join(', ')}` : ''}`);
const linkedTo = new Map();
for (const f of readdirSync(join(ROOT, 'public/ast')).filter((x) => x.endsWith('.json.gz'))) {
  for (const [, ref] of gunzipSync(readFileSync(join(ROOT, 'public/ast', f))).toString('utf8').matchAll(/"ref":"([^"]+)"/g)) {
    if (createdRefs.has(ref)) linkedTo.set(ref, (linkedTo.get(ref) ?? 0) + 1);
  }
}
for (const [ref, n] of linkedTo) {
  const [b, k] = ref.split(':');
  const other = holderOf.get(`${b}|${String(core[b]?.[k]?.name ?? '').toLowerCase()}`);
  if (other) findings.push(`LINK ${n} description link(s) open the created ${b}/${k}, but ${b}/${other} is the app's record of "${core[b][k].name}" — they belong on it (scripts/import-core-v2.mjs step 5)`);
}

/*
 * …and never answer to a TITLE. public/ast-index.json is what a popup opened with a title alone reads
 * (src/sheet/useAst.ts: astSlug(title), then the index), so an entry naming a created record hands its
 * page to every title of that name: the first run sent `ram` from the Battering Ram siege weapon, and
 * four familiar abilities, to creature-family pages, and gave "Hyena" and six more animal-companion
 * names a creature-family page they never had (measured 2026-09-25). The created records open by key.
 */
const astIndex = JSON.parse(readFileSync(join(ROOT, 'public/ast-index.json'), 'utf8'));
for (const [s, b] of Object.entries(astIndex)) {
  if (createdRefs.has(`${b}:${s}`)) findings.push(`INDEX public/ast-index.json sends the title "${s}" to the created ${b}/${s} — created records open by key only (scripts/lib/archive-coverage.mjs createdRefs)`);
}

const COLS = [['pages', 7], ['aonId', 7], ['bestiary', 9], ['item', 6], ['twin', 6], ['name', 6], ['allowed', 8], ['missing', 8], ['missingKB', 10]];
const line = (label, t) => label.padEnd(30) + COLS.map(([k, w]) => String(Math.round(t[k] ?? 0)).padStart(w)).join('');
console.log('category'.padEnd(30) + COLS.map(([k, w]) => k.padStart(w)).join(''));
const tot = {};
for (const [cat, t] of Object.entries(table).sort()) {
  console.log(line(cat, t));
  for (const [k] of COLS) tot[k] = (tot[k] ?? 0) + (t[k] ?? 0);
}
console.log(line('TOTAL', tot));
console.log('(item = an item-bonus page whose item has the record; allowed = named in scripts/data/archive-coverage-allow.json; missingKB = the missing pages\' text)');

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    measured: new Date().toISOString().slice(0, 10),
    rules: 'scripts/lib/archive-coverage.mjs', guard: 'scripts/archive-coverage-check.mjs', allow: 'scripts/data/archive-coverage-allow.json',
    table,
    rows: verdicts.map((v) => [v.id, v.category, v.name, v.book, v.status, v.via ?? allow[v.id] ?? '']),
  }, null, 1));
  console.log(`verdicts -> ${JSON_OUT}`);
}
if (PROPOSE) {
  // Only the two re-checkable shapes are ever proposed — new, or rewritten where a row of that shape reads
  // otherwise; a deliberate gap is written by hand with its evidence.
  const rows = {};
  for (const v of verdicts) {
    const want = v.status === 'missing' ? allowReason(pages.get(v.id)) : null;
    const had = allow[v.id];
    if (want && had !== want && (had === undefined || /^(?:hidden|stub):/.test(had))) rows[v.id] = want;
  }
  if (argv.includes('--write')) {
    const merged = { ...allow, ...rows };
    const byId = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
    writeFileSync(ALLOW_PATH, `${JSON.stringify(byId, null, 1)}\n`);
    console.log(`${Object.keys(rows).length} row(s) added -> scripts/data/archive-coverage-allow.json`);
  } else console.log(JSON.stringify(rows, null, 1));
}

if (findings.length) {
  console.log(`\n${findings.length} finding(s):`);
  for (const f of findings.slice(0, 200)) console.log('  ' + f);
  if (findings.length > 200) console.log(`  … and ${findings.length - 200} more (--json for all)`);
  process.exit(1);
}
console.log('\narchive-coverage-check: every non-player Archives page has a searchable record, a twin, a same-book name match or an allow row.');
