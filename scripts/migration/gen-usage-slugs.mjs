/*
 * Generate scripts/data/usage-slugs.json — Archives usage PROSE -> Heroes Heaven's usage slug.
 *
 * HH's `usage` is a closed set of ~118 slugs the engine keys off (which hand an item occupies, whether
 * it is worn/invested/affixed). The Archives carry the same information as prose, on 84% of equipment.
 * A mechanical slugify gets 79.8% of the way — "held in 1 hand" -> "held-in-one-hand" needs digits
 * spelled out — but the remainder are HH's own conventions that no rule predicts:
 *
 *     "worn cloak"                -> worncloak                (no separator at all)
 *     "affixed to a weapon"       -> affixed-to-weapon        (drops the article)
 *     "tattoo"                    -> tattooed-on-the-body     (different words entirely)
 *
 * So the mapping is learned once, from the records that already have both sides, and frozen here as an
 * HH-owned file — the same treatment as scripts/data/book-names.json, and for the same reason: the
 * Archives supply the FACT, Heroes Heaven owns the vocabulary its engine reads.
 *
 * Re-runnable. Reports every prose value whose records disagree, so ambiguity stays visible.
 *
 *   node scripts/migration/gen-usage-slugs.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join as pjoin } from 'node:path';

const ARCHIVE = 'C:/trying ai 2/hh-data-export/without-images/data';
const OUT = 'scripts/data/usage-slugs.json';

const docs = new Map();
for (const f of readdirSync(ARCHIVE).filter((x) => x.endsWith('.json'))) {
  let raw; try { raw = JSON.parse(readFileSync(pjoin(ARCHIVE, f), 'utf8')); } catch { continue; }
  for (const [id, d] of Object.entries(raw.docs ?? {})) docs.set(id, d);
}

const core = JSON.parse(readFileSync('public/core.json', 'utf8'));
const used = JSON.parse(readFileSync('scripts/migration/out/used-docs.json', 'utf8'));

const votes = new Map();
for (const [key, rec] of Object.entries(core.items ?? {})) {
  const hh = rec?.usage;
  const aon = docs.get(used.items?.[key])?.data?.usage;
  if (!hh || !aon) continue;
  const k = String(aon).trim().toLowerCase();
  const m = votes.get(k) ?? votes.set(k, new Map()).get(k);
  m.set(hh, (m.get(hh) ?? 0) + 1);
}

const table = {};
const ambiguous = [];
for (const [aon, m] of [...votes].sort((a, b) => a[0].localeCompare(b[0]))) {
  const ranked = [...m].sort((a, b) => b[1] - a[1]);
  // A near-tie means the prose genuinely does not determine the slug — record it rather than guess.
  table[aon] = ranked[0][0];
  if (ranked.length > 1 && ranked[1][1] >= ranked[0][1] * 0.5) {
    ambiguous.push({ aon, ranked: ranked.slice(0, 4) });
  }
}

writeFileSync(OUT, `${JSON.stringify(table, null, 1)}\n`);
console.log(`distinct Archives usage strings : ${votes.size}`);
console.log(`wrote ${OUT}`);
console.log(`\nprose values whose records genuinely disagree: ${ambiguous.length}`);
for (const a of ambiguous.slice(0, 15)) {
  console.log(`   ${JSON.stringify(a.aon)}  ->  ${a.ranked.map(([s, n]) => `${s} (${n})`).join('  |  ')}`);
}
