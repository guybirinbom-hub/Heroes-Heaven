/**
 * DELTA PULL FROM ARCHIVES OF NETHYS.
 *
 * The local mirror (C:\wonderers guide\aon-2e-archive\data) was pulled 2026-07-15 at 43,686 docs.
 * The live index holds 45,405. Rather than re-scrape 45,000 documents to obtain 1,700, this asks the
 * index for its ID LIST ONLY — which is one small scrolled query — diffs that against what is on
 * disk, and then fetches the full body of just the difference.
 *
 * BE A GOOD CITIZEN. This hits someone else's public search proxy, the same one the mirror's own
 * scraper uses. Requests are serial, batched at 200 documents, and paced. Do not parallelise it.
 *
 * The mirror is the PRISTINE MASTER for this project — everything downstream is rebuilt from it — so
 * new documents are written into its by-category layout in exactly the shape the existing files use,
 * and an existing file is never overwritten. Re-running is safe and fetches only what is still absent.
 *
 *   node scripts/aon-delta-fetch.mjs --dry      # what would be fetched, by category
 *   node scripts/aon-delta-fetch.mjs            # fetch and write
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const ES = 'https://elasticsearch.aonprd.com';
const DRY = process.argv.includes('--dry');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

/*
 * Categories to pull.
 *
 * This began as "what a character sheet draws from", which left creatures, hazards and sidebars
 * behind on the reasoning that a sheet has no use for a bestiary. That reasoning was too narrow: the
 * owner wants the archive complete so an in-app archives browser and the initiative tracker's stat
 * blocks have their data already, and both of those want exactly the categories a sheet does not.
 *
 * So the default is now EVERYTHING. `--sheet-only` keeps the old narrow set for a quick top-up.
 */
const SHEET_ONLY = new Set([
  'feat', 'class-feature', 'equipment', 'weapon', 'relic', 'vehicle', 'spell', 'ritual', 'action',
  'deity', 'background', 'heritage', 'ancestry', 'archetype', 'condition', 'trait', 'language',
  'domain', 'animal-companion', 'familiar-ability', 'class', 'rules', 'item-bonus', 'source',
]);
const WANTED = has('--sheet-only') ? SHEET_ONLY : null; // null = every category

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(path, body, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${ES}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1)); // back off; the proxy is not ours to hammer
    }
  }
}

/* ------------------------------------------------------------ what is on disk */
const onDisk = new Set();
for (const cat of readdirSync(MIRROR)) {
  const dir = join(MIRROR, cat);
  if (!existsSync(dir)) continue;
  for (const fn of readdirSync(dir)) {
    if (fn.endsWith('.json') && fn !== '_index.json') onDisk.add(fn.replace(/\.json$/, ''));
  }
}
console.log(`on disk: ${onDisk.size.toLocaleString()} documents`);

/* ------------------------------------------------------------ what is live (ids only) */
console.log('asking the live index for its id list…');
const live = [];
let scrollId = null;
let page = await post('/aon/_search?scroll=2m', {
  size: 2000,
  _source: ['id', 'name', 'category', 'release_date'],
  query: { match_all: {} },
});
while (page?.hits?.hits?.length) {
  scrollId = page._scroll_id;
  for (const h of page.hits.hits) {
    const s = h._source ?? {};
    live.push({ id: String(s.id ?? h._id), category: s.category, name: s.name, released: s.release_date });
  }
  process.stdout.write(`\r  ${live.length.toLocaleString()} ids`);
  await sleep(250);
  page = await post('/_search/scroll', { scroll: '2m', scroll_id: scrollId });
}
console.log(`\nlive: ${live.length.toLocaleString()} documents`);

const missing = live.filter((d) => (!WANTED || WANTED.has(d.category)) && !onDisk.has(d.id));
const byCat = {};
for (const d of missing) byCat[d.category] = (byCat[d.category] ?? 0) + 1;
console.log(`\nnot on disk, in a category we use: ${missing.length.toLocaleString()}`);
for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${c}`);

const skipped = WANTED ? live.filter((d) => !WANTED.has(d.category) && !onDisk.has(d.id)).length : 0;
console.log(`\n  (${skipped.toLocaleString()} more are new but in categories a character sheet does not use — creatures, hazards, sidebars. Reported, not silently dropped.)`);

if (DRY) { console.log('\n--dry: nothing fetched.'); process.exit(0); }
if (!missing.length) { console.log('\nnothing to fetch.'); process.exit(0); }

/* ------------------------------------------------------------ fetch the bodies */
console.log(`\nfetching ${missing.length.toLocaleString()} full documents, 200 at a time…`);
let written = 0;
for (let i = 0; i < missing.length; i += 200) {
  const batch = missing.slice(i, i + 200);
  /* ⚠ `terms: {id: […]}` matches NOTHING here — the `id` field is analysed text, not a keyword, so
   * the query is silently empty and the whole run reports "wrote 0" while looking like it worked.
   * The document `_id` is the addressable key, and `ids` is the query for it. Verified against
   * feat-1/feat-4388 before trusting it. */
  const res = await post('/aon/_search', {
    size: batch.length,
    query: { ids: { values: batch.map((d) => d.id) } },
  });
  const got = res?.hits?.hits ?? [];
  /* A batch that comes back short means the query stopped matching — the failure this script already
   * had once. Stop rather than continue writing nothing across 8 more batches. */
  if (!got.length) {
    console.error(`\n\nbatch at ${i} returned NO documents for ${batch.length} ids (first: ${batch[0]?.id}).`);
    console.error('Refusing to continue — a silent empty fetch is how this went wrong before.');
    process.exit(1);
  }
  for (const h of got) {
    const src = h._source ?? {};
    const cat = src.category;
    const id = String(h._id ?? src.id);
    if (!cat || !id) continue;
    const dir = join(MIRROR, cat);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const dest = join(dir, `${id}.json`);
    if (existsSync(dest)) continue; // never overwrite the pristine master
    /* Same envelope the existing files use, so every downstream reader keeps working unchanged. */
    writeFileSync(dest, JSON.stringify(src, null, 1));
    written++;
  }
  process.stdout.write(`\r  ${Math.min(i + 200, missing.length).toLocaleString()}/${missing.length.toLocaleString()}  written ${written.toLocaleString()}`);
  await sleep(600);
}
console.log(`\n\nwrote ${written.toLocaleString()} new documents into the mirror.`);
console.log(`Next: rebuild core.json with \`npm run data\`, then \`node scripts/import-siege-and-gaps.mjs\`.`);
