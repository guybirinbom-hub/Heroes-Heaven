/*
 * RESTORE THE SEARCH TEXT FOR RECORDS THAT CARRY NONE.
 *
 * WHAT THIS IS NOT. It started as "389 player-facing records ship no description", and that number was
 * wrong three times over. `description` is the SEARCH + fallback field; DISPLAY comes from the ast tree
 * in public/ast/<bucket>.json, so a record with an empty description usually still reads perfectly on
 * the sheet. Measuring "no description AND no ast" gives 612, of which 455 are synthetic `modes` (their
 * text lives on the parent item) and 151 are `treasure` — gems and art objects that have no rules text
 * in the book at all. The genuine remainder is SIX records, four of which carry their rules in `note`.
 *
 * So this script does the modest thing that is actually true: for records that have an ast but no plain
 * text, it restores the plain text from the mirror so they become findable by their own words.
 *
 * ⚠ RECOVERED, NOT WRITTEN. Text comes from the pristine AoN mirror page joined on aonId — never
 * composed here, and never from Wanderer's Guide (GPL-3.0, a differ only). Three separate contaminants
 * had to be refused before the output was trustworthy; each has a named guard below.
 *
 *   node scripts/restore-empty-descriptions.mjs           # report, printing every row in full
 *   node scripts/restore-empty-descriptions.mjs --write
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plain } from './lib/aon-plain.mjs';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));
if (!existsSync(MIRROR)) { console.error(`no mirror at ${MIRROR}`); process.exit(2); }

/* aonId -> page path, across every category (a record's page need not live where its bucket suggests). */
const page = new Map();
for (const cat of readdirSync(MIRROR)) {
  let files;
  try { files = readdirSync(join(MIRROR, cat)); } catch { continue; }
  for (const f of files) if (f.endsWith('.json') && f !== '_index.json') page.set(f.slice(0, -5), join(MIRROR, cat, f));
}

/*
 * ⚠ GUARD 1 — THE PAGE MUST BE THIS RECORD'S. Several of our records share one AoN aonId: the four tent
 * sizes all point at Tent (Pup), the two feed grades at Feed (Standard). A bare aonId join therefore
 * handed `tent-pavilion` the pup tent's rules and `feed-unique` the standard feed's — wrong text that
 * reads as right, which is the worst failure available here. Name equality separates the two cases.
 */
const nameMatches = (a, b) => {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return Boolean(norm(a)) && norm(a) === norm(b);
};

/*
 * The mirror's `markdown` is the structured source; `text` is a pre-flattened copy that has already lost
 * its paragraph breaks. Reading `text` produced single run-on paragraphs, so the prose comes from
 * `markdown` and goes through the SHARED transform in lib/aon-plain.mjs — the same one the top-up
 * import used. A second, private copy of that transform would silently disagree with the corpus.
 */
const proseOf = (j) => {
  const md = String(j.markdown ?? '').replace(/\r\n/g, '\n');
  if (!md) return '';

  /*
   * ⚠ GUARD 2 — LOCATE THE PROSE, DO NOT INFER IT. An AoN page reads
   *     <title …>Name</title> … **Source** Book pg. N … \n---\n <the rules prose>
   * so a line that is exactly "---" is the separator. My first attempt also tried to guess where the
   * prose began on pages lacking one, by skipping past "pg. <n>"; that shipped descriptions beginning
   * `<title level="2" right="Item 0" …>`. A page with no separator is a page whose prose we cannot
   * locate, so it is refused rather than guessed at.
   */
  const lines = md.split('\n');
  const at = lines.findIndex((l) => l.trim() === '---');
  if (at < 0) return '';
  let prose = plain(lines.slice(at + 1).join('\n'));

  /*
   * ⚠ GUARD 3 — CUT AoN'S APPENDED REFERENCE SECTIONS. Every weapon page ends with the shared
   * "Critical Specialization Effects / Source Core Rulebook pg. 283 / …" block, which describes the
   * weapon GROUP, not the item; restoring it verbatim gave five ammunition records a paragraph of
   * crit-spec rules as their description. The tell is generic rather than a hard-coded heading: the
   * record's own Source line was consumed above the separator, so a SECOND "<Heading> Source <Book>
   * pg. <n>" inside the prose is always an appended section.
   */
  const appended = /(?:[A-Z][A-Za-z'’-]*\s+){1,5}Source\s+[A-Z][^.]*?pg\.\s*\d+/.exec(prose);
  if (appended) prose = prose.slice(0, appended.index).trim();

  /* ⚠ GUARD 4 — AoN's editorial voice is not printed rules text, and "no description was provided" is
   * the Archives stating outright that the page has none. Neither is recoverable text. */
  if (/^Nethys Note:/i.test(prose.trim())) return '';

  /*
   * ⚠ GUARD 5 — REFUSE FAMILY PAGES. AoN files item VARIANTS on one shared page: Feed (Standard) and
   * Feed (Unique) together, all three tent sizes, every grade of lodging and meal. The page's `name` is
   * the first variant's, so GUARD 1 waves it through — and what comes back is the family's price table
   * ("Tent (Pup) / Source Player Core pg. 292 / Price 8 sp / Tent (Four-Person) / …"), which is not any
   * one item's rules text. Fifteen records were handed one of these before this guard existed.
   *
   * The tell is exact: a record's own Source line is consumed above the separator, so prose that STILL
   * carries "Source <Book> pg. <n>" is describing other records. Unlike GUARD 3 this refuses rather
   * than cuts — there is no salvageable item prose on a page that is only a variant table.
   */
  if (/\bSource\s+[A-Z][^\n]{0,80}?pg\.\s*\d+/.test(prose)) return '';
  return prose.trim();
};

const ROWS = [];
const skipped = [];
for (const bucket of ['items', 'spells']) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    if (String(rec?.description ?? '').trim() || String(descs[bucket]?.[id]?.d ?? '').trim()) continue;
    const p = page.get(String(rec?.aonId ?? ''));
    if (!p) { skipped.push(`${bucket}/${id}: no mirror page for ${rec?.aonId ?? '(no aonId)'}`); continue; }
    const j = JSON.parse(readFileSync(p, 'utf8'));
    if (!nameMatches(rec?.name, j?.name)) {
      skipped.push(`${bucket}/${id}: aonId ${rec.aonId} is "${j?.name}"'s page, not "${rec?.name}"'s`);
      continue;
    }
    const prose = proseOf(j);
    if (prose.length < 40) { skipped.push(`${bucket}/${id}: no locatable prose on its mirror page`); continue; }
    ROWS.push({ category: bucket, id, field: 'description', value: prose });
  }
}

/* Every row is printed in full. The set is small and each row is prose that ships to players, so it is
 * READ rather than counted — the first two passes both produced rows that looked fine as a count and
 * were wrong as text. */
console.log(`${ROWS.length} record(s) recoverable; ${skipped.length} left alone.\n`);
for (const r of ROWS) console.log(`── ${r.category}/${r.id}\n${r.value}\n`);

if (!ROWS.length) process.exit(0);
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`wrote ${added} new, ${replaced} replaced (${rows.length} rows).`);
