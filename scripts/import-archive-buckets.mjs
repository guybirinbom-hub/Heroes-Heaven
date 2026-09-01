/**
 * Ship the five categories the importer was skipping.
 *
 * `REF_SKIP` in import-core-v2.mjs excludes heavy entity stat-blocks from becoming reference buckets —
 * creatures, NPCs, hazards — and five much smaller categories had been swept up with them:
 *
 *     kingdom-structure        76   archive reference
 *     kingdom-event            45   archive reference
 *     creature-theme-template  16   archive reference
 *     creature-adjustment      60   archive reference (Elite/Weak and friends, for the tracker)
 *     campsite-meal            27   -> items, per the owner's ruling: "keep these as items that a player
 *                                     can get but don't encode actual effects"
 *
 * 224 records, none of them a stat-block, all carrying a parsed `ast` in the export. They were simply
 * absent from public/core.json, so nothing could show them.
 *
 * Additive and idempotent, in the same spirit as import-siege-and-gaps.mjs: it never rewrites a record
 * that already exists and never touches another bucket's ast entries. Preferred over `npm run data`
 * because a full regen rebuilds every bucket, and this only needs to add.
 *
 * REF_SKIP is edited too, so a future regen keeps producing them rather than silently dropping them
 * again — a fix that only exists in a side script is a fix that lasts until the next rebuild.
 *
 * Two source properties are honoured, the same way the main importer honours them:
 *   exclude_from_search   AoN's own "hidden page" flag — never shipped
 *   superseded_by         a legacy printing that has a remaster replacement. Dropped, matching the
 *                         owner's ruling that reprinted legacy content stays out of the app.
 *
 *   node scripts/import-archive-buckets.mjs            # report only
 *   node scripts/import-archive-buckets.mjs --write
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plain } from './lib/aon-plain.mjs';
import { coinsFromCp } from './lib/aon-facets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
const WRITE = process.argv.includes('--write');

/** category -> the core.json bucket it lands in. campsite-meal joins `items`; the rest are new. */
const PLAN = [
  { cat: 'kingdom-structure', bucket: 'kingdomStructure', kind: 'reference' },
  { cat: 'kingdom-event', bucket: 'kingdomEvent', kind: 'reference' },
  { cat: 'creature-theme-template', bucket: 'creatureThemeTemplate', kind: 'reference' },
  { cat: 'creature-adjustment', bucket: 'creatureAdjustment', kind: 'reference' },
  { cat: 'campsite-meal', bucket: 'items', kind: 'item' },
];

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const RARITY = new Set(['common', 'uncommon', 'rare', 'unique']);

const CORE = join(ROOT, 'public/core.json');
const core = JSON.parse(readFileSync(CORE, 'utf8'));
const DESCP = join(ROOT, 'public/core-descriptions.json');
const descs = JSON.parse(readFileSync(DESCP, 'utf8'));
const idMap = existsSync(join(ROOT, 'public/idmap.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'public/idmap.json'), 'utf8')) : {};

const resolveTo = (to) => {
  const hit = idMap[to];
  return hit && core[hit.bucket]?.[hit.slug] ? `${hit.bucket}:${hit.slug}` : null;
};
const resolveAst = (node) => {
  if (!node || typeof node !== 'object') return node;
  const out = Array.isArray(node) ? [] : {};
  for (const k in node) {
    if (k === 'to') { out.ref = resolveTo(node.to); out.to = node.to; }
    else if (k === 'c') out.c = node.c.map(resolveAst);
    else out[k] = node[k];
  }
  return out;
};
const readAst = (bucket) => {
  const plainP = join(ROOT, `public/ast/${bucket}.json`);
  if (existsSync(plainP)) { try { return JSON.parse(readFileSync(plainP, 'utf8')); } catch { /* fall through */ } }
  const gz = join(ROOT, `public/ast/${bucket}.json.gz`);
  if (existsSync(gz)) { try { return JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8')); } catch { /* none */ } }
  return {};
};

/** The body AoN prints after the stat block — everything past the first `---`. */
const bodyProse = (md) => {
  const s = String(md ?? '');
  const cut = s.indexOf('\n---');
  return plain(cut >= 0 ? s.slice(cut + 4) : s);
};

const report = [];
const astWrites = new Map();   // bucket -> ast object to write
const descWrites = [];

for (const { cat, bucket, kind } of PLAN) {
  const file = join(EXPORT, `${cat}.json`);
  if (!existsSync(file)) { report.push({ cat, bucket, total: 0, added: 0, skipped: 0, note: 'no export file' }); continue; }
  const docs = JSON.parse(readFileSync(file, 'utf8')).docs ?? {};

  core[bucket] ??= {};
  const ast = astWrites.get(bucket) ?? readAst(bucket);
  astWrites.set(bucket, ast);

  let added = 0, skipped = 0, existed = 0, renormalised = 0, filled = 0;
  for (const [docId, doc] of Object.entries(docs)) {
    const name = String(doc?.name ?? doc?.data?.name ?? '').trim();
    if (!name) { skipped++; continue; }
    if (doc.exclude_from_search === 1) { skipped++; continue; }
    if (doc.superseded_by) { skipped++; continue; }   // a reprinted legacy printing

    const id = slug(name);
    const rec = { id, name, aonId: docId };
    if (doc.edition) rec.edition = doc.edition;
    if (doc.rarity) rec.rarity = doc.rarity;
    // Rarity is its OWN field, so the rarity word never belongs in `traits` — same rule as normTraits()
    // in import-core-v2.mjs. Without this, First World Mince Pie shipped traits ["apex","meal","rare"]
    // and every trait-chip renderer drew a duplicate rarity.
    if (Array.isArray(doc.traits) && doc.traits.length) {
      const t = doc.traits.map((x) => String(x).toLowerCase()).filter((x) => !RARITY.has(x));
      if (t.length) rec.traits = t;
    }
    if (doc.level != null) rec.level = doc.level;
    if (doc.book) rec.source = { book: doc.book };

    if (kind === 'item') {
      // The owner's ruling: purchasable, with no encoded mechanical effect. AoN prices are in COPPER.
      rec.itemType = 'consumable';
      const cp = doc.price_cp ?? doc.data?.price_raw ?? null;
      if (cp != null) { rec.price = coinsFromCp(Number(cp)); rec.value = rec.price; }
      rec.note = 'Its bonus is not applied automatically — apply it by hand, or with a custom Mode.';
      const prose = bodyProse(doc.data?.markdown ?? doc.markdown);
      if (prose) descWrites.push({ bucket, id, prose });
    }

    const cur = core[bucket][id];
    if (cur) {
      existed++;
      /*
       * FILL-ONLY, not add-only.
       *
       * These five categories used to be produced by this script ALONE — `import-core-v2.mjs` skipped
       * them, so "the record exists" could only mean "this script already wrote it". That stopped
       * being true when they were removed from that importer's REF_SKIP so a regen would keep
       * producing them: stage 1 now emits a LIGHTWEIGHT reference record ({id, name, edition} + ast)
       * and this script, being add-only, skipped it. Measured on 2026-08-19: 76 kingdom structures,
       * 45 kingdom events, 54 creature adjustments and 16 theme templates lost their rarity, level and
       * source, and all 27 campsite meals lost their PRICE and their note — a shop full of food you
       * could not buy.
       *
       * Filling only ABSENT fields keeps the original doctrine intact: a value that came from anywhere
       * else is never overwritten, so this can never silently clobber authored data. The two producers
       * now compose instead of racing.
       */
      for (const [k, v] of Object.entries(rec)) {
        if (!(k in cur)) { cur[k] = v; filled++; }
      }
      /*
       * ONE field is this script's ruling to make rather than stage 1's: `itemType`. The owner ruled
       * that a campsite meal is something a player BUYS AND EATS, so the whole category is
       * `consumable`; the generic importer classifies anything with a price as `equipment`, which put
       * all 27 meals in the wrong shop tab the moment it started producing them. Scoped to this
       * script's own kind and to a record whose aonId is the doc we are holding, so it can never
       * reclassify an item that came from anywhere else.
       */
      if (kind === 'item' && cur.aonId === docId && cur.itemType !== rec.itemType) {
        cur.itemType = rec.itemType;
        filled++;
      }
      /*
       * A record THIS script wrote (same aonId) gets its traits re-normalised. The first run leaked
       * the rarity word into `traits` — First World Mince Pie shipped ["apex","meal","rare"] — and an
       * add-only script cannot repair its own output, so a later fix to the rule would never reach the
       * records already written. Scoped by aonId so it can never touch a record from anywhere else;
       * the fill above is what puts that aonId on a stage-1 record in the first place.
       */
      if (cur.aonId === docId && Array.isArray(cur.traits)) {
        const t = cur.traits.filter((x) => !RARITY.has(String(x).toLowerCase()));
        if (t.length !== cur.traits.length) { cur.traits = t; renormalised++; }
      }
      continue;
    }

    core[bucket][id] = rec;
    if (doc.ast) ast[id] = resolveAst(doc.ast);
    added++;
  }
  report.push({ cat, bucket, total: Object.keys(docs).length, added, skipped, existed, renormalised, filled });
}

console.log(`${'category'.padEnd(26)} ${'-> bucket'.padEnd(24)} ${'docs'.padStart(5)} ${'ADD'.padStart(5)} ${'exists'.padStart(7)} ${'skip'.padStart(5)}`);
for (const r of report) {
  console.log(`${r.cat.padEnd(26)} ${String(r.bucket).padEnd(24)} ${String(r.total).padStart(5)} ${String(r.added).padStart(5)} ${String(r.existed ?? 0).padStart(7)} ${String(r.skipped).padStart(5)}`
    + (r.note ? `   ${r.note}` : ''));
}
const totalAdded = report.reduce((n, r) => n + r.added, 0);
const totalRenorm = report.reduce((n, r) => n + (r.renormalised ?? 0), 0);
const totalFilled = report.reduce((n, r) => n + (r.filled ?? 0), 0);
if (totalRenorm) console.log(`${totalRenorm} existing record(s) had a rarity word stripped from traits.`);
if (totalFilled) console.log(`${totalFilled} field(s) filled in on records stage 1 had already created.`);
console.log(`\n${totalAdded} record(s) to add; ${descWrites.length} with prose.`);
console.log('skips are AoN hidden pages (exclude_from_search) and reprinted legacy (superseded_by).');

if (!WRITE) { console.log('\nreport only — pass --write to apply.'); process.exit(0); }
if (!totalAdded && !totalRenorm && !totalFilled) { console.log('\nnothing to add, fill or re-normalise.'); process.exit(0); }

mkdirSync(join(ROOT, 'public/ast'), { recursive: true });
for (const [bucket, ast] of astWrites) {
  const ordered = {};
  for (const s of Object.keys(ast).sort()) ordered[s] = ast[s];
  const json = JSON.stringify(ordered);
  writeFileSync(join(ROOT, `public/ast/${bucket}.json`), json);
  writeFileSync(join(ROOT, `public/ast/${bucket}.json.gz`), gzipSync(json, { level: 9 }));
}

// additive only: never re-point a slug an existing bucket already claims
const indexPath = join(ROOT, 'public/ast-index.json');
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
let idx = 0;
for (const [bucket, ast] of astWrites) for (const s of Object.keys(ast)) if (!(s in index)) { index[s] = bucket; idx++; }
const orderedIndex = {};
for (const s of Object.keys(index).sort()) orderedIndex[s] = index[s];
writeFileSync(indexPath, JSON.stringify(orderedIndex));

for (const { bucket, id, prose } of descWrites) {
  descs[bucket] ??= {};
  if (!descs[bucket][id]) descs[bucket][id] = { d: prose };
}
writeFileSync(DESCP, JSON.stringify(descs));
writeFileSync(CORE, JSON.stringify(core));
console.log(`\nwrote public/core.json, public/core-descriptions.json, public/ast/* and ast-index.json (+${idx} slugs)`);
