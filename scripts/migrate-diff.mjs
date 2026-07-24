/**
 * Migration Step-2 diff harness. For every record that exists in BOTH the new AoN data and the old
 * core.json (matched by slug), compare what the new-data FACETS would produce against the old value —
 * field by field. A low mismatch rate ⇒ safe to source that field from the new data; a high or
 * suspicious rate ⇒ needs a hand-authored overlay. Reports counts + sample mismatches per field.
 *
 * Analysis only — writes nothing. Run: node scripts/migrate-diff.mjs [bucket] [field]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA = 'C:/trying ai 2/hh-data-export/without-images/data';
const REF = 'public/core.foundry-backup.json';
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const EDITION_RANK = { remaster: 0, 'remaster-era': 1, neutral: 2, 'legacy-era': 3, legacy: 4 };
const RARITY = new Set(['common', 'uncommon', 'rare', 'unique']);
const CAT_BUCKET = {
  spell: 'spells', ritual: 'spells', equipment: 'items', weapon: 'items', armor: 'items', shield: 'items', relic: 'items', 'set-relic': 'items', 'class-kit': 'items',
  class: 'classes', 'class-feature': 'classFeatures', feat: 'feats', ancestry: 'ancestries', heritage: 'heritages', background: 'backgrounds', deity: 'deities', action: 'actions', condition: 'conditions',
};

const norm = (v) => (v === undefined ? 'undefined' : JSON.stringify(v));
const EDITION_TRAITS = new Set(['legacy', 'remaster', 'legacy-era', 'remaster-era']);
// slugify each trait (so "awakened animal" == "awakened-animal") and drop rarity + edition markers
const normTraits = (ts) => [...new Set((ts || []).map((t) => slug(t)).filter((t) => t && !RARITY.has(t) && !EDITION_TRAITS.has(t)))].sort();

// per-field derivers: (newRec) -> value from the new data facets; compared to old[field]
const FIELDS = {
  traits: { get: (r) => normTraits(r.traits), old: (o) => normTraits(o.traits) },
  level: { get: (r) => (typeof r.level === 'number' ? r.level : undefined), old: (o) => o.level, buckets: ['feats', 'classFeatures', 'items'] },
  rarity: { get: (r) => (RARITY.has(r.rarity) ? r.rarity : 'common'), old: (o) => o.rarity || 'common' },
  spellRank: { get: (r) => r.spell_rank, old: (o) => o.rank, buckets: ['spells'] },
};

// ---- load + dedup new data ----
const best = {}; // bucket -> slug -> rec
for (const f of readdirSync(DATA).filter((x) => x.endsWith('.json'))) {
  let raw; try { raw = JSON.parse(readFileSync(join(DATA, f), 'utf8')); } catch { continue; }
  const bucket = CAT_BUCKET[raw.category]; if (!bucket) continue;
  for (const id in (raw.docs || {})) {
    const r = raw.docs[id]; if (r.superseded_by) continue;
    const s = slug(r.name); const rk = EDITION_RANK[r.edition] ?? 5;
    (best[bucket] ||= {});
    if (!best[bucket][s] || rk < (EDITION_RANK[best[bucket][s].edition] ?? 5)) best[bucket][s] = r;
  }
}
const cur = JSON.parse(readFileSync(REF, 'utf8'));

const onlyBucket = process.argv[2];
const onlyField = process.argv[3];
const buckets = onlyBucket ? [onlyBucket] : ['feats', 'spells', 'items', 'ancestries', 'backgrounds', 'heritages', 'deities', 'classFeatures', 'actions', 'conditions', 'classes'];

for (const bucket of buckets) {
  const newMap = best[bucket] || {}; const oldMap = cur[bucket] || {};
  const matched = Object.keys(newMap).filter((s) => oldMap[s]);
  if (!matched.length) continue;
  console.log(`\n════ ${bucket} (${matched.length} matched records) ════`);
  for (const [field, spec] of Object.entries(FIELDS)) {
    if (onlyField && field !== onlyField) continue;
    if (spec.buckets && !spec.buckets.includes(bucket)) continue;
    let same = 0, diff = 0, newMissing = 0; const samples = [];
    for (const s of matched) {
      const nv = spec.get(newMap[s]); const ov = spec.old(oldMap[s]);
      if (nv === undefined || nv === null) { newMissing++; continue; }
      if (norm(nv) === norm(ov)) same++;
      else { diff++; if (samples.length < 6) samples.push(`${s}: new=${norm(nv).slice(0, 50)} old=${norm(ov).slice(0, 50)}`); }
    }
    const tot = same + diff;
    const pct = tot ? ((same / tot) * 100).toFixed(1) : '—';
    console.log(`  ${field.padEnd(10)} match ${same}/${tot} (${pct}%)  diff ${diff}  new-missing ${newMissing}`);
    for (const x of samples) console.log(`     • ${x}`);
  }
}
