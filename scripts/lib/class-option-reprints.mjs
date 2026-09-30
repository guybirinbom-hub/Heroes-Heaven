// Derives the NEWER printings of the class sub-picks from the AoN mirror (desk #170, sources-apply-to-everything,
// 2026-09-30). Read-only. Used by scripts/class-option-reprints.mjs (prints / checks the table) and by
// test/class-option-reprints.test.ts (the guard that src/rules/sources.ts CLASS_OPTION_REPRINTS equals it).
//
// Why: a class sub-pick's book is its classFeatures record's (classOptionRecords). Eleven eidolon records still
// name their first printing (Secrets of Magic, Book of the Dead) although Impossible Magic, the remastered
// summoner's own book, prints every one of them again (AoN eidolon-15 … eidolon-26). The Archives do not link
// those pairs, so scripts/reprint-check.mjs cannot see them, and a Sources filter keyed on the stale book hid
// them from a summoner who has Impossible Magic on. The rule (R12, the newest printing wins; the owner, "the
// player sources should aplly to everything he has accses to"): an option is offered when ANY printing of it
// is in a book the character has on, the way the shop offers each printing of an item by its own book.
//
// The derivation, per class option list (subclass.options, each extraChoices[].options):
//   - the list's AoN category is the one most of its records' aonIds name (eidolon-1 → "eidolon");
//   - an option's OWN page is its record's aonId, or — a record with no aonId — the category page of the same
//     name printed in the record's book;
//   - a REPRINT is a page in that category with the same name (the record's name may add the category word:
//     "Angel Eidolon" = "Angel" + " eidolon"), printed in a different book, released strictly LATER than the
//     own page. An older printing is not listed: the record's own book is already the newer one.
//   - the reprint's book is resolved to a Sources card key the way the importers mint `source.book`
//     (canonBookName: scripts/data/book-names.json, else 'Pathfinder ' + the Archives' title — "Dark Archives
//     (Remastered)" is our "Pathfinder Dark Archive (Remastered)"); one that is no card key is returned in
//     `unresolved`, never guessed.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { canonBookName } from './aon-facets.mjs';

export const MIRROR_CATEGORIES = 'C:/wonderers guide/aon-2e-archive/data/by-category';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const strip = (b) => String(b ?? '').trim().replace(/^Pathfinder /, '');
const catOf = (aonId) => (typeof aonId === 'string' ? aonId.replace(/-\d+$/, '') : undefined);

function loadCategory(dir, cat, cache) {
  if (cache.has(cat)) return cache.get(cat);
  const d = `${dir}/${cat}`;
  const out = [];
  if (existsSync(d)) {
    for (const f of readdirSync(d)) {
      if (!/^[a-z-]+-\d+\.json$/.test(f)) continue; // skips _index.json
      out.push(JSON.parse(readFileSync(`${d}/${f}`, 'utf8')));
    }
  }
  cache.set(cat, out);
  return out;
}

/**
 * @param core the parsed public/core.json (classes + classFeatures are all it reads)
 * @param knownBooks every Sources card key (sourceCatalog(core).allBooks)
 * @param dir the mirror's by-category folder
 * @returns { table: { [optionId]: { book, aonId }[] }, unresolved: string[], noOwnPage: string[] }
 */
export function deriveClassOptionReprints(core, knownBooks, dir = MIRROR_CATEGORIES) {
  const known = new Set(knownBooks);
  const features = core.classFeatures ?? {};
  const cache = new Map();
  const table = {};
  const unresolved = [];
  const noOwnPage = [];
  const seen = new Set();
  for (const c of Object.values(core.classes ?? {})) {
    const lists = [c?.subclass?.options ?? [], ...(c?.extraChoices ?? []).map((g) => g?.options ?? [])];
    for (const opts of lists) {
      const recs = opts.map((o) => [o.id, features[o.id]]).filter(([, r]) => r);
      const tally = {};
      for (const [, r] of recs) {
        const k = catOf(r.aonId);
        if (k) tally[k] = (tally[k] ?? 0) + 1;
      }
      const cat = Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
      if (!cat) continue;
      const docs = loadCategory(dir, cat, cache);
      const word = cat.replace(/-/g, ' ');
      for (const [id, r] of recs) {
        if (seen.has(id)) continue; // each id once, whichever class lists it (as classOptionRecords)
        seen.add(id);
        const book = r.source?.book?.trim();
        if (!book) continue;
        const nr = norm(r.name);
        const sameName = (d) => norm(d.name) === nr || `${norm(d.name)} ${word}` === nr;
        const own =
          (catOf(r.aonId) === cat ? docs.find((d) => d.id === r.aonId) : undefined) ??
          docs.find((d) => sameName(d) && strip(d.primary_source) === strip(book));
        if (!own) {
          noOwnPage.push(id);
          continue;
        }
        const later = docs.filter(
          (d) =>
            d.id !== own.id &&
            sameName(d) &&
            strip(d.primary_source) !== strip(book) &&
            String(d.release_date ?? '') > String(own.release_date ?? ''),
        );
        for (const d of later.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))) {
          const key = canonBookName(d.primary_source);
          if (!key || !known.has(key)) {
            unresolved.push(`${id} -> ${d.id} (${d.primary_source})`);
            continue;
          }
          (table[id] ??= []).push({ book: key, aonId: d.id });
        }
      }
    }
  }
  return { table, unresolved, noOwnPage };
}
