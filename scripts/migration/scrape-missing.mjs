/*
 * Fetch ONLY the two adventure volumes the Archives scrape missed.
 *
 * The user was explicit: "don't run the scraper on everything, only on the ones I told you that we are
 * missing." scrape-all.mjs scrolls the whole 43,686-doc index; this asks for two books by name and
 * comes back with a few hundred documents.
 *
 * Same endpoint the user's own scraper uses (AoN's public Elasticsearch), and the output is written in
 * the same shape as archives-of-nethys-scraper/raw/<category>.json — an array of ES hits
 * ({_index,_id,_score,_source,sort}) — so it can be merged into that repo and rebuilt through the
 * normal Archives pipeline.
 *
 * NOTE: this fetches the raw documents only. The `ast` render tree is produced by the Archives' own
 * build (build.py), not by the scraper, so these docs need that build re-run before Heroes Heaven can
 * render them.
 *
 * Re-runnable; overwrites its output.  node scripts/migration/scrape-missing.mjs
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'https://elasticsearch.aonprd.com';
const INDEX = 'aon';
const OUT_DIR = 'scripts/migration/out/scraped';
const DELAY_MS = 150; // polite pause between requests, matching the user's own scraper
const PAGE = 200;

const BOOKS = [
  'Pathfinder #220: Crypt of Runes',
  'Pathfinder #221: Into the Apocalypse Archive',
];

/** The 32 Heroes Heaven records these books are supposed to supply — used to verify the fetch. */
const WANTED = [
  'Apocalypse Seed', "Belimarius's Invidious Halberd", "Beloved's Bracelets", 'Chromatic Robe (Greater)',
  'Chromatic Robe', 'Doomsday Door', "Dream Hunter's Lodge", 'Effortless Garden', "Fate Tempter's Ring",
  "One Day's Breath", 'Robes of Xin-Edasseril', 'Runewell of Lust', 'Runic Skullcap',
  "Sorshen's Scintillating Garment", "Sorshen's Sinuous Guisarme", 'Spindle Key', "Ten Day's Breath",
  'The Kardosian Fragments', "Three Day's Breath", 'Timeflaying Blade',
  'Avenger of Envy', 'Avenger of Gluttony', 'Avenger of Greed', 'Avenger of Lust', 'Avenger of Sloth',
  'Avenger of Wrath', 'Aegis of Envy', 'Convocation of Greed', 'Gluttonous Feast', 'Host of Wrath',
  "Sorshen's Devotion", 'Summon Sloth',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function es(body) {
  const res = await fetch(`${ROOT}/${INDEX}/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const hits = [];
for (const book of BOOKS) {
  let from = 0, total = null;
  for (;;) {
    // match_phrase on primary_source: the field carries the exact book title, verified on feat-9411
    // ("Avenger of Envy" -> primary_source "Pathfinder #220: Crypt of Runes").
    const j = await es({
      size: PAGE,
      from,
      query: { bool: { should: [
        { match_phrase: { primary_source: book } },
        { match_phrase: { source: book } },
      ], minimum_should_match: 1 } },
    });
    total ??= j.hits.total?.value ?? j.hits.total ?? 0;
    const batch = j.hits.hits ?? [];
    hits.push(...batch);
    from += batch.length;
    console.log(`  ${book} — ${from}/${total}`);
    if (!batch.length || from >= total) break;
    await sleep(DELAY_MS);
  }
  await sleep(DELAY_MS);
}

// De-duplicate (a doc can list both books) and group by category, matching raw/<category>.json.
const seen = new Set();
const byCat = {};
for (const h of hits) {
  if (seen.has(h._id)) continue;
  seen.add(h._id);
  (byCat[h._source?.category ?? 'unknown'] ??= []).push(h);
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
for (const [cat, list] of Object.entries(byCat)) {
  writeFileSync(join(OUT_DIR, `${cat}.json`), JSON.stringify(list, null, 1));
}

const names = new Set([...seen].map((id) => null).filter(Boolean));
const gotNames = new Set(hits.map((h) => h._source?.name).filter(Boolean));
const found = WANTED.filter((w) => gotNames.has(w));
const missing = WANTED.filter((w) => !gotNames.has(w));

writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify({
  books: BOOKS,
  fetched: seen.size,
  categories: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v.length])),
  wanted: WANTED.length,
  found: found.length,
  missing,
}, null, 1));

console.log(`\nfetched ${seen.size} documents`);
console.log('by category:', Object.entries(byCat).map(([k, v]) => `${k} ${v.length}`).join(', '));
console.log(`\nof the 32 Heroes Heaven needs: found ${found.length}, missing ${missing.length}`);
if (missing.length) console.log('  still missing:', missing.join(', '));
console.log(`\nwrote ${OUT_DIR}/`);
