/*
 * Generate scripts/data/book-names.json — the HH-owned canonical book string for each Archives book.
 *
 * WHY. `source.book` is not a label, it is the PRIMARY KEY of the source filter: `CORE_BOOKS`
 * (src/rules/sources.ts:9) hard-codes four of these strings, `enabledBookSet(undefined)` returns them
 * for every character that has never opened the Sources card, and `applySources`
 * (src/rules/build.ts:1583) keeps a record only when `enabled.has(book)`. Saved characters persist
 * these strings and there is no migration. Adopting the Archives' short names raw ("Player Core"
 * instead of "Pathfinder Player Core") would empty the builder for every default character.
 *
 * WHAT THE ARCHIVES DO AND DO NOT PROVIDE. They provide the book IDENTITY — every one of the 43,686
 * docs carries a `/Sources.aspx?ID=N` link joining to the 245-doc `source` category — and the
 * shelving (`primary_source_category`, `primary_source_group`). They do NOT provide a long title: the
 * source doc for "Pathfinder Player Core" is named just "Player Core". The prefix is Heroes Heaven's
 * own display convention, so it is HH's to own, and this file is where it lives.
 *
 * The point of the exercise: `mapBook()` currently derives that string by reading
 * `core.foundry-backup.json` at import time. THAT is the Foundry dependency. Freezing the mapping into
 * a checked-in file removes it without changing a single string.
 *
 * Re-runnable. Reports every Archives book whose records disagree about the HH string, so an
 * ambiguity is visible rather than silently majority-voted.
 *
 *   node scripts/migration/gen-book-names.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join as pjoin } from 'node:path';

const ARCHIVE = 'C:/trying ai 2/hh-data-export/without-images/data';
const OUT = 'scripts/data/book-names.json';

const docs = new Map();
for (const f of readdirSync(ARCHIVE).filter((x) => x.endsWith('.json'))) {
  let raw; try { raw = JSON.parse(readFileSync(pjoin(ARCHIVE, f), 'utf8')); } catch { continue; }
  for (const [id, d] of Object.entries(raw.docs ?? {})) docs.set(id, d);
}

const core = JSON.parse(readFileSync('public/core.json', 'utf8'));
const used = JSON.parse(readFileSync('scripts/migration/out/used-docs.json', 'utf8'));

// Archives book name -> { HH string -> how many records say so }
const votes = new Map();
for (const [bucket, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  for (const [key, rec] of Object.entries(records)) {
    const hh = rec?.source?.book;
    const aon = docs.get(used[bucket]?.[key])?.book;
    if (!hh || !aon) continue;
    const m = votes.get(aon) ?? votes.set(aon, new Map()).get(aon);
    m.set(hh, (m.get(hh) ?? 0) + 1);
  }
}

const table = {};
const ambiguous = [];
for (const [aon, m] of [...votes].sort((a, b) => a[0].localeCompare(b[0]))) {
  const ranked = [...m].sort((a, b) => b[1] - a[1]);
  table[aon] = ranked[0][0];
  if (ranked.length > 1) ambiguous.push({ aon, chosen: ranked[0][0], count: ranked[0][1], others: ranked.slice(1) });
}

writeFileSync(OUT, `${JSON.stringify(table, null, 1)}\n`);

console.log(`Archives books seen on HH records : ${votes.size}`);
console.log(`wrote ${OUT}`);
console.log(`\nbooks whose records DISAGREE about the HH string: ${ambiguous.length}`);
for (const a of ambiguous.slice(0, 20)) {
  console.log(`   ${JSON.stringify(a.aon)}`);
  console.log(`      chose ${JSON.stringify(a.chosen)} (${a.count})  over  ${a.others.map((o) => `${JSON.stringify(o[0])} (${o[1]})`).join(', ')}`);
}
if (ambiguous.length > 20) console.log(`   …and ${ambiguous.length - 20} more`);
