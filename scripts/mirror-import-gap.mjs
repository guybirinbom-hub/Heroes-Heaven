/**
 * WHAT IS IN THE LOCAL AoN MIRROR AND NOT IN core.json.
 *
 * The mirror at C:\wonderers guide\aon-2e-archive\data is a complete pull of Archives of Nethys'
 * Elasticsearch proxy — 43,686 documents. core.json is built FROM it. So any record we are missing is
 * one of two very different problems:
 *
 *   IMPORT GAP   the document is already on this disk and the importer dropped, filtered or failed
 *                on it. Costs nothing to fix and needs no network.
 *   SCRAPE GAP   the document is not in the mirror either, because it was published after the pull.
 *                Only this one needs re-scraping.
 *
 * Establishing which is which BEFORE scraping is the whole point of this script: the mirror holds
 * 8,461 feat documents against core.json's 6,312, and re-scraping to fix an import gap would take
 * hours, hammer someone else's server, and change nothing.
 *
 * Matching is by AoN document id (`aonId` on our records), never by name — names collide across
 * editions and reprints, and a name match would call a legacy record present when the remaster one
 * is what we hold.
 *
 *   node scripts/mirror-import-gap.mjs
 *   node scripts/mirror-import-gap.mjs --category feat --list
 *   node scripts/mirror-import-gap.mjs --out work/mirror-gap.json
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

if (!existsSync(MIRROR)) { console.error(`mirror not found at ${MIRROR}`); process.exit(2); }

/** AoN category -> the core.json bucket(s) that category feeds. */
const MAPS = {
  feat: ['feats'],
  'class-feature': ['classFeatures'],
  equipment: ['items'],
  weapon: ['items'],
  spell: ['spells'],
  ritual: ['spells'],
  action: ['actions'],
  deity: ['deities'],
  background: ['backgrounds'],
  heritage: ['heritages'],
  ancestry: ['ancestries'],
  archetype: ['archetypes'],
  condition: ['conditions'],
  trait: ['traits'],
  language: ['languages'],
  domain: ['domains'],
  relic: ['items'],
  vehicle: ['vehicles', 'items'],
  'animal-companion': ['companions'],
  'familiar-ability': ['familiarAbilities'],
  creature: ['creatures'],
  hazard: ['hazards'],
};

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

/** Every aonId we hold, per bucket, plus a global set. */
const heldGlobal = new Set();
const heldByBucket = new Map();
for (const [bucket, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object') continue;
  const s = new Set();
  for (const rec of Object.values(records)) {
    const a = rec?.aonId;
    if (a === undefined || a === null) continue;
    s.add(String(a));
    heldGlobal.add(String(a));
  }
  heldByBucket.set(bucket, s);
}

const walkFiles = (dir) => {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
};

const only = arg('--category', null);
const report = [];
const details = {};

for (const cat of Object.keys(MAPS)) {
  if (only && cat !== only) continue;
  const dir = join(MIRROR, 'by-category', cat);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
  const files = walkFiles(dir);
  const missing = [];
  let seen = 0;
  for (const f of files) {
    let doc;
    try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    /* The proxy wraps each hit; the id lives on the envelope or on _source. */
    const id = String(doc.id ?? doc._id ?? doc._source?.id ?? '').replace(/^.*?-/, '');
    const rawId = String(doc.id ?? doc._id ?? doc._source?.id ?? '');
    const src = doc._source ?? doc;
    if (!rawId) continue;
    seen++;
    /* Match on either the raw proxy id or its numeric tail — the importer has used both. */
    if (heldGlobal.has(rawId) || heldGlobal.has(id)) continue;
    missing.push({
      aonId: rawId,
      name: src.name ?? '(unnamed)',
      level: src.level ?? null,
      type: src.type ?? cat,
      source: Array.isArray(src.source) ? src.source[0] : src.source ?? null,
      legacy: src.legacy_id !== undefined || /legacy/i.test(String(src.remaster_id ?? '')),
    });
  }
  const buckets = MAPS[cat];
  const held = buckets.reduce((n, b) => n + Object.keys(core[b] ?? {}).length, 0);
  report.push({ category: cat, inMirror: seen, inCore: held, notImported: missing.length });
  details[cat] = missing;
}

report.sort((a, b) => b.notImported - a.notImported);
console.log(`${'category'.padEnd(20)} ${'in mirror'.padStart(10)} ${'in core.json'.padStart(13)} ${'NOT IMPORTED'.padStart(13)}`);
for (const r of report) {
  console.log(`${r.category.padEnd(20)} ${String(r.inMirror).padStart(10)} ${String(r.inCore).padStart(13)} ${String(r.notImported).padStart(13)}`);
}
const tot = report.reduce((n, r) => n + r.notImported, 0);
console.log(`\n${'TOTAL'.padEnd(20)} ${String(report.reduce((n, r) => n + r.inMirror, 0)).padStart(10)} ${''.padStart(13)} ${String(tot).padStart(13)}`);
console.log(`\nEvery one of these ${tot.toLocaleString()} documents is ALREADY ON DISK. None of them needs scraping.`);

if (has('--list') && only) {
  const list = details[only] ?? [];
  console.log(`\n--- ${only}: not imported (${list.length}) ---`);
  const bySource = {};
  for (const m of list) bySource[m.source ?? '(no source)'] = (bySource[m.source ?? '(no source)'] ?? 0) + 1;
  console.log('by source book:');
  for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(5)}  ${s}`);
  console.log('\nfirst 40:');
  for (const m of list.slice(0, 40)) console.log(`  ${String(m.aonId).padEnd(14)} lvl ${String(m.level ?? '?').padStart(2)}  ${String(m.name).slice(0, 46).padEnd(46)} ${m.source ?? ''}`);
}

const dest = arg('--out', null);
if (dest) { writeFileSync(join(ROOT, dest), JSON.stringify({ report, details }, null, 1)); console.log(`\n-> ${dest}`); }
