/**
 * Classify each "genuinely missing" record before importing it.
 *
 * Every raw gap count this project has produced has been inflated, four times running, by records we
 * already hold under another id or another spelling. Importing one of those is worse than leaving it:
 * it puts a second copy of the same thing in a picker.
 *
 * So each candidate is put in one of four boxes, and only the last is work:
 *
 *   TWIN      we hold a record with the SAME name in the same bucket, under a different AoN id —
 *             a legacy/remaster pair, or two printings AoN never cross-linked
 *   VARIANT   a held name differs only by a parenthetical or an abbreviation — "Refugee (FoP)"
 *             against "Refugee (Fall of Plaguestone)"
 *   NO-TEXT   the document carries no rules text to import
 *   NEW       none of the above. This is the real work list.
 *
 *   node scripts/gap-classify.mjs
 *   node scripts/gap-classify.mjs --category familiar-ability --list
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const gaps = JSON.parse(readFileSync(join(ROOT, 'work/gap-now.json'), 'utf8'));
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const CAT_TO_BUCKET = (() => {
  const src = readFileSync(join(ROOT, 'scripts/import-core-v2.mjs'), 'utf8');
  const block = /const CAT_BUCKET = \{([\s\S]*?)\n\};/.exec(src);
  const map = {};
  for (const m of block[1].matchAll(/'?([a-zA-Z-]+)'?\s*:\s*'([a-zA-Z]+)'/g)) map[m[1]] = m[2];
  for (const c of ['equipment', 'weapon', 'armor', 'shield', 'relic']) map[c] = 'items';
  map.ritual = 'spells';
  return map;
})();

/**
 * The importer also registers REFERENCE buckets on the fly — a category with no `CAT_BUCKET` entry
 * becomes a camel-cased bucket of its own (`item-bonus` -> `itemBonus`, `arcane-school` ->
 * `arcaneSchool`). Without this, five categories that DO have a home read as "no bucket yet" and
 * their records were counted as unplaceable when the app already holds hundreds of each.
 */
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const bucketFor = (cat) => {
  const direct = CAT_TO_BUCKET[cat];
  if (direct && core[direct]) return direct;
  const guess = camel(cat);
  return core[guess] ? guess : null;
};

/**
 * The export's own supersession links, read per category and cached.
 *
 * `superseded_by` lives in the EXPORT (the edition model computed it), not in the mirror document,
 * so a scan reading only the mirror cannot see it. Every record it points at that we already hold is
 * a deliberate prune, not a gap.
 */
const EXPORT_DIR = 'C:/trying ai 2/hh-data-export/without-images/data';
const exportCache = new Map();
const exportDocs = (cat) => {
  if (!exportCache.has(cat)) {
    const p = join(EXPORT_DIR, `${cat}.json`);
    let docs = {};
    try { docs = JSON.parse(readFileSync(p, 'utf8')).docs ?? {}; } catch { /* category not exported */ }
    exportCache.set(cat, docs);
  }
  return exportCache.get(cat);
};
const heldAonIds = (() => {
  const s = new Set();
  for (const recs of Object.values(core)) {
    if (!recs || typeof recs !== 'object') continue;
    for (const r of Object.values(recs)) if (r?.aonId != null) s.add(String(r.aonId));
  }
  return s;
})();
const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** Every name we hold, in any bucket. Used ONLY to recognise a replacement, never to claim a gap. */
const heldNamesAnywhere = (() => {
  const s = new Set();
  for (const recs of Object.values(core)) {
    if (!recs || typeof recs !== 'object') continue;
    for (const r of Object.values(recs)) if (r?.name) s.add(normName(r.name));
  }
  return s;
})();
/**
 * The record that replaced this one, if we hold the replacement — BY ID OR BY NAME.
 *
 * Checking the id alone found nothing: AoN gives a replacement a compound variant id
 * (`equipment-2775-2612`) while the legacy record's `superseded_by` names the bare page
 * (`equipment-2775`), so the two never met. All 48 "missing" items were legacy printings of things
 * we already hold — "Basic Hearing Aid" against our "Hearing Aid". Matching the replacement's NAME
 * as well takes the equipment gap from 48 to 0.
 */
const supersededBy = (cat, aonId) => {
  const by = exportDocs(cat)[aonId]?.superseded_by;
  if (!by) return null;
  if (heldAonIds.has(String(by))) return String(by);
  const rep = exportDocs(cat)[by];
  if (rep?.name && heldNamesAnywhere.has(normName(rep.name))) return `${by} (${rep.name})`;
  return null;
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** Strip a trailing parenthetical so "Refugee (FoP)" and "Refugee (Fall of Plaguestone)" meet. */
const stem = (s) => norm(String(s ?? '').replace(/\s*\([^)]*\)\s*$/, ''));

/* Versatile heritages are filed by AoN as `ancestry` documents and held by us as heritages, so an
 * ancestry candidate is checked against BOTH buckets. Same for the reverse. */
const EXTRA_BUCKETS = { ancestry: ['heritages'], heritage: ['ancestries'] };

const out = [];
for (const row of gaps) {
  if (!row.records) continue;
  const bucket = bucketFor(row.category);
  const buckets = [bucket, ...(EXTRA_BUCKETS[row.category] ?? [])].filter((b) => b && core[b]);
  if (!buckets.length) { out.push({ category: row.category, noBucket: true, records: row.record }); continue; }

  const heldByName = new Map();
  const heldByStem = new Map();
  for (const b of buckets) {
    for (const [id, rec] of Object.entries(core[b])) {
      if (!rec?.name) continue;
      heldByName.set(norm(rec.name), `${b}/${id}`);
      if (!heldByStem.has(stem(rec.name))) heldByStem.set(stem(rec.name), `${b}/${id}`);
    }
  }
  const boxes = { twin: [], variant: [], noText: [], superseded: [], neu: [] };
  for (const m of row.record) {
    if (!m.chars) { boxes.noText.push(m); continue; }
    /* A REPRINT is not a gap. The export carries `superseded_by`; when it points at a record we
     * already hold, the importer pruned this one on purpose — the owner's ruling is that reprinted
     * legacy content stays out of the app. The name-twin test below cannot see these, because Paizo
     * often reprints under a DIFFERENT name, which is how "Basic Hearing Aid" read as missing. */
    const sup = supersededBy(row.category, m.aonId);
    if (sup) { boxes.superseded.push({ ...m, by: sup }); continue; }
    const t = heldByName.get(norm(m.name));
    if (t) { boxes.twin.push({ ...m, held: t }); continue; }
    const v = heldByStem.get(stem(m.name));
    if (v) { boxes.variant.push({ ...m, held: v }); continue; }
    boxes.neu.push(m);
  }
  out.push({ category: row.category, bucket, ...boxes, records: row.records });
}

out.sort((a, b) => (b.neu?.length ?? 0) - (a.neu?.length ?? 0));
console.log(`${'category'.padEnd(26)} ${'flagged'.padStart(8)} ${'reprint'.padStart(8)} ${'twin'.padStart(6)} ${'variant'.padStart(8)} ${'REALLY NEW'.padStart(11)}`);
let totalNew = 0, totalFlag = 0;
for (const r of out) {
  if (r.noBucket) {
    totalFlag += r.records.length; totalNew += r.records.length;
    console.log(`${r.category.padEnd(26)} ${String(r.records.length).padStart(8)} ${'—'.padStart(6)} ${'—'.padStart(8)} ${'—'.padStart(8)} ${String(r.records.length).padStart(11)}  (no bucket yet)`);
    continue;
  }
  totalFlag += r.records; totalNew += r.neu.length;
  console.log(`${r.category.padEnd(26)} ${String(r.records).padStart(8)} ${String(r.superseded.length).padStart(8)} ${String(r.twin.length).padStart(6)} ${String(r.variant.length).padStart(8)} ${String(r.neu.length).padStart(11)}`);
}
console.log(`\n${'TOTAL'.padEnd(26)} ${String(totalFlag).padStart(8)} ${''.padStart(6)} ${''.padStart(8)} ${''.padStart(8)} ${String(totalNew).padStart(11)}`);

const only = arg('--category', null);
if (has('--list') && only) {
  const r = out.find((x) => x.category === only);
  console.log(`\n--- ${only}: really new (${r?.neu?.length ?? 0}) ---`);
  for (const m of (r?.neu ?? []).slice(0, 40)) console.log(`  ${String(m.aonId).padEnd(24)} ${String(m.name).slice(0, 40).padEnd(42)} ${m.source ?? ''}`);
  if (r?.twin?.length) {
    console.log(`\n--- twins we already hold (${r.twin.length}) ---`);
    for (const m of r.twin.slice(0, 10)) console.log(`  ${String(m.name).slice(0, 34).padEnd(36)} -> ${m.held}`);
  }
}
writeFileSync(join(ROOT, 'work/gap-classified.json'), JSON.stringify(out, null, 1));
console.log(`\n-> work/gap-classified.json`);
