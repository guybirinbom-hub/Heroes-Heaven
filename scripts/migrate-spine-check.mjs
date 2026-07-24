/**
 * Step-0 spine validation for the AoN data migration (analysis only — writes nothing to core.json).
 * Validates the mint-and-map slug strategy against the two load-bearing risks:
 *   (1) SLUG COLLISIONS — two different new-data records minting the same slug within one target bucket
 *       (a hand-authored engine table would then attach to the wrong record).
 *   (2) COVERAGE — every slug the current core.json uses that has NO matching new-data slug in the same
 *       bucket (a hand-table / saved-character reference that would orphan under the new data).
 * Also measures the bundle-size risk (full corpus w/ ast vs today's 18.8 MB) and prunes superseded records.
 *
 * Run: node scripts/migrate-spine-check.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DATA = 'C:/trying ai 2/hh-data-export/without-images/data';
const CUR = 'public/core.json';

// --- the EXACT slug() from import-core.mjs (the spine every hand-table + saved char keys off) ---
const slug = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// --- new category -> ContentDatabase bucket (per the architecture map; hhTypeHint is the data's own hint) ---
const CAT_BUCKET = {
  spell: 'spells', ritual: 'spells',
  equipment: 'items', weapon: 'items', armor: 'items', shield: 'items', relic: 'items', 'set-relic': 'items', 'class-kit': 'items',
  class: 'classes',
  'class-feature': 'classFeatures',
  feat: 'feats',
  ancestry: 'ancestries',
  heritage: 'heritages',
  background: 'backgrounds',
  deity: 'deities',
  language: 'languages',
  action: 'actions',
  condition: 'conditions',
  'animal-companion': 'animalCompanions', 'animal-companion-advanced': 'animalCompanions', 'animal-companion-unique': 'animalCompanions',
  'animal-companion-specialization': 'companionSpecializations',
  'familiar-ability': 'familiarAbilities', 'familiar-specific': 'familiarAbilities',
  vehicle: 'vehicles', 'siege-weapon': 'siegeWeapons',
};

// --- load new data ---
const files = readdirSync(DATA).filter((f) => f.endsWith('.json'));
const hintDist = {};
const bucketRecords = {}; // bucket -> [{numericId, slug, name, edition, cat}]
let total = 0, superseded = 0, astBytes = 0, dataBytes = 0, catBytes = 0;
const catCounts = {};

for (const f of files) {
  let raw;
  try { raw = JSON.parse(readFileSync(join(DATA, f), 'utf8')); } catch { continue; }
  const cat = raw.category;
  const docs = raw.docs || {};
  hintDist[raw.hhTypeHint] = (hintDist[raw.hhTypeHint] || 0) + Object.keys(docs).length;
  for (const numericId in docs) {
    const r = docs[numericId];
    total++;
    if (r.superseded_by) { superseded++; continue; } // pruned at import
    const bucket = CAT_BUCKET[cat] || `(unmapped:${cat})`;
    (bucketRecords[bucket] ||= []).push({ numericId, slug: slug(r.name), name: r.name, edition: r.edition, cat });
    catCounts[cat] = (catCounts[cat] || 0) + 1;
    // size accounting (post-prune)
    if (r.ast) astBytes += JSON.stringify(r.ast).length;
    if (r.data) dataBytes += JSON.stringify(r.data).length;
  }
}

// --- (1) COLLISIONS: same slug, different numericId, same bucket ---
const collisions = {};
for (const [bucket, recs] of Object.entries(bucketRecords)) {
  const bySlug = {};
  for (const r of recs) (bySlug[r.slug] ||= []).push(r);
  for (const [s, group] of Object.entries(bySlug)) {
    if (group.length > 1) (collisions[bucket] ||= []).push({ slug: s, n: group.length, names: [...new Set(group.map((g) => g.name))], editions: group.map((g) => g.edition) });
  }
}

// --- (2) COVERAGE vs current core.json for the mechanical-critical buckets ---
let cur = {};
try { cur = JSON.parse(readFileSync(CUR, 'utf8')); } catch (e) { console.log('!! could not load current core.json:', e.message); }
const CRITICAL = ['classes', 'classFeatures', 'feats', 'spells', 'deities', 'ancestries', 'heritages', 'backgrounds', 'items'];
const coverage = {};
for (const bucket of CRITICAL) {
  const curMap = cur[bucket] || {};
  const curSlugs = Object.keys(curMap);
  if (!curSlugs.length) continue;
  const newSlugs = new Set((bucketRecords[bucket] || []).map((r) => r.slug));
  const orphans = curSlugs.filter((s) => !newSlugs.has(s));
  coverage[bucket] = { current: curSlugs.length, newDistinct: newSlugs.size, matched: curSlugs.length - orphans.length, orphanCount: orphans.length, orphanSample: orphans.slice(0, 20) };
}

// --- report ---
const MB = (n) => (n / 1e6).toFixed(1) + ' MB';
console.log('════ NEW DATA ════');
console.log('total docs:', total, '| pruned superseded:', superseded, '| kept:', total - superseded);
console.log('\nhhTypeHint distribution:'); for (const [k, v] of Object.entries(hintDist).sort((a, b) => b[1] - a[1])) console.log('  ' + k + ': ' + v);
console.log('\nkept records per target bucket:');
for (const [b, recs] of Object.entries(bucketRecords).sort((a, b2) => b2[1].length - a[1].length)) console.log('  ' + b + ': ' + recs.length);

console.log('\n════ (1) SLUG COLLISIONS (same slug, different records, same bucket) ════');
let totalColl = 0;
for (const [bucket, list] of Object.entries(collisions)) {
  totalColl += list.length;
  console.log(`\n${bucket}: ${list.length} colliding slugs`);
  for (const c of list.slice(0, 12)) console.log(`  "${c.slug}" ×${c.n}  [${c.editions.join(',')}]  ${c.names.join(' | ').slice(0, 90)}`);
  if (list.length > 12) console.log(`  … +${list.length - 12} more`);
}
console.log(`\nTOTAL colliding slugs across critical+all buckets: ${totalColl}`);

console.log('\n════ (2) COVERAGE vs current core.json (orphaned = current slug with NO new-data match) ════');
for (const [b, c] of Object.entries(coverage)) {
  console.log(`\n${b}: current ${c.current} | new-distinct ${c.newDistinct} | matched ${c.matched} | ORPHANED ${c.orphanCount}`);
  if (c.orphanCount) console.log('  orphan sample: ' + c.orphanSample.join(', '));
}

console.log('\n════ (3) BUNDLE SIZE (post-prune) ════');
console.log('ast JSON bytes:', MB(astBytes), '| raw data JSON bytes:', MB(dataBytes));
console.log('current core.json on disk:', (statSync(CUR).size / 1e6).toFixed(1) + ' MB');
console.log('note: full record adds name/facets/traits on top of ast; `data` (raw AoN) is droppable if unused.');
