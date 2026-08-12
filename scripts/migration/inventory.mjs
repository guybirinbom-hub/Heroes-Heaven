/*
 * Stage 1 of the archive migration — the INVENTORY. Read-only; writes a report and nothing else.
 *
 * Question it answers: for every field Heroes Heaven holds in core.json, can the Archives dataset
 * supply that value? Whatever it cannot is the list the user has to see, because the standing rule is
 * that we never fall back to Foundry — we go and find it in the archive together.
 *
 * TWO DESIGN RULES, both learned the hard way (see MIGRATION.md section 5):
 *
 * 1. JOIN BY ID, NEVER BY NAME. public/idmap.json maps an archive doc id -> {bucket, slug}, which is
 *    the only trustworthy link between the two datasets. Matching on name produced two wrong answers
 *    already; the archive has 8,227 same-category name collisions.
 *
 * 2. MATCH ON VALUES, NOT ON FIELD NAMES. HH calls it `actionCost`, the archive calls it `actions`;
 *    HH `traits`, the archive `trait` on .data and `traits` on the doc. Guessing that mapping is how
 *    you conclude "the archive doesn't have weapon damage" when it is sitting in weapon.json. So for
 *    each HH value we ask the far simpler question: does this value appear ANYWHERE in the archive
 *    doc? That cannot produce a false "missing", which is the error that matters here — a false
 *    "found" only costs us a second look.
 *
 * Re-runnable and idempotent: it reads three files and rewrites its two outputs. Costs seconds. If a
 * session dies, just run it again.
 *
 *   node scripts/migration/inventory.mjs [--collection feats]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HH = 'public/core.json';
const IDMAP = 'public/idmap.json';
const ARCHIVE = 'C:/trying ai 2/hh-data-export/without-images/data';
const OUT_DIR = 'scripts/migration/out';

const only = (() => {
  const i = process.argv.indexOf('--collection');
  return i > -1 ? process.argv[i + 1] : null;
})();

/** Normalise a scalar so 'Flourish' matches 'flourish' and 3 matches '3'. */
const norm = (v) => String(v).trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Every scalar reachable inside a value, flattened. An HH field can be a string, a number, an array
 * of trait names, or a nested object (source: {book, page}); the archive may hold the same information
 * at a different depth, so both sides get flattened before comparison.
 */
function scalars(v, out = new Set(), depth = 0) {
  if (v == null || depth > 6) return out;
  if (Array.isArray(v)) { for (const x of v) scalars(x, out, depth + 1); return out; }
  if (typeof v === 'object') { for (const k of Object.keys(v)) scalars(v[k], out, depth + 1); return out; }
  const s = norm(v);
  if (s && s !== 'false' && s !== '0') out.add(s); // 0/false carry no identifying signal
  return out;
}

// ---------------------------------------------------------------- load
console.log('reading…');
const core = JSON.parse(readFileSync(HH, 'utf8'));
const idmap = JSON.parse(readFileSync(IDMAP, 'utf8'));

// bucket -> slug -> archive doc id   (the reverse of idmap, which is id -> {bucket, slug})
const idByBucketSlug = {};
for (const [docId, m] of Object.entries(idmap)) {
  if (!m?.bucket || !m?.slug) continue;
  (idByBucketSlug[m.bucket] ??= {})[m.slug] = docId;
}

// archive doc id -> the whole doc, across every category file
const archiveById = new Map();
for (const f of readdirSync(ARCHIVE).filter((x) => x.endsWith('.json'))) {
  let raw;
  try { raw = JSON.parse(readFileSync(join(ARCHIVE, f), 'utf8')); } catch { continue; }
  for (const [numericId, doc] of Object.entries(raw.docs || {})) {
    // idmap keys look like 'feat-1'; the export keys its docs by the bare number under a category.
    archiveById.set(`${raw.category}-${numericId}`, doc);
    archiveById.set(String(numericId), doc);
    if (doc?.id) archiveById.set(String(doc.id), doc);
  }
}
console.log(`archive docs indexed: ${archiveById.size} keys`);

// ---------------------------------------------------------------- compare
const report = { generated: 'stage-1-inventory', collections: {} };

for (const [collection, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  if (only && collection !== only) continue;
  const slugToId = idByBucketSlug[collection] || {};

  const stats = {
    records: 0,
    withArchiveDoc: 0,
    withoutArchiveDoc: 0,
    noDocExamples: [],
    fields: {}, // field -> { present, matched, unmatchedExamples[] }
  };

  for (const [slug, rec] of Object.entries(records)) {
    if (!rec || typeof rec !== 'object') continue;
    stats.records++;
    const docId = slugToId[slug];
    const doc = docId ? archiveById.get(docId) : undefined;
    if (!doc) {
      stats.withoutArchiveDoc++;
      if (stats.noDocExamples.length < 5) stats.noDocExamples.push({ slug, name: rec.name, docId: docId ?? null });
      continue;
    }
    stats.withArchiveDoc++;

    // Everything the archive doc says, at any depth, as one bag of normalised scalars.
    const haystack = scalars(doc);

    for (const [field, value] of Object.entries(rec)) {
      if (value == null) continue;
      const f = (stats.fields[field] ??= { present: 0, matched: 0, unmatchedExamples: [] });
      f.present++;
      const wanted = scalars(value);
      if (wanted.size === 0) { f.matched++; continue; } // nothing to prove
      // Supplied if EVERY scalar in the HH value appears somewhere in the archive doc.
      let all = true;
      for (const w of wanted) if (!haystack.has(w)) { all = false; break; }
      if (all) f.matched++;
      else if (f.unmatchedExamples.length < 3) {
        f.unmatchedExamples.push({ slug, docId, name: rec.name, value: JSON.stringify(value).slice(0, 120) });
      }
    }
  }
  report.collections[collection] = stats;
  console.log(
    `${collection.padEnd(22)} ${String(stats.records).padStart(6)} records  ` +
    `${String(stats.withArchiveDoc).padStart(6)} joined  ${String(stats.withoutArchiveDoc).padStart(6)} unjoined`,
  );
}

// ---------------------------------------------------------------- write
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'inventory.json'), JSON.stringify(report, null, 1));

const lines = ['# Stage 1 — inventory', '', 'Generated by `scripts/migration/inventory.mjs`. Join is by archive doc id; matching is by value.', ''];
lines.push('## Join coverage', '', '| collection | records | joined to an archive doc | not joined |', '|---|---:|---:|---:|');
for (const [c, s] of Object.entries(report.collections)) {
  lines.push(`| ${c} | ${s.records} | ${s.withArchiveDoc} | ${s.withoutArchiveDoc} |`);
}
lines.push('', '## Fields whose value the archive did not supply', '',
  'Ordered by how many records are affected. A high count on a field HH *computes* (choice lanes,',
  'slot tables) is expected — those are Heroes Heaven\'s own work, not Foundry\'s. What matters is a',
  'field that looks like printed rules data.', '');
const gaps = [];
for (const [c, s] of Object.entries(report.collections)) {
  for (const [field, f] of Object.entries(s.fields)) {
    const missing = f.present - f.matched;
    if (missing > 0) gaps.push({ c, field, missing, present: f.present, ex: f.unmatchedExamples });
  }
}
gaps.sort((a, b) => b.missing - a.missing);
lines.push('| collection | field | unmatched | of records | example |', '|---|---|---:|---:|---|');
for (const g of gaps.slice(0, 120)) {
  const ex = g.ex[0] ? `\`${g.ex[0].slug}\` = ${g.ex[0].value.replace(/\|/g, '\\|')}` : '';
  lines.push(`| ${g.c} | ${g.field} | ${g.missing} | ${g.present} | ${ex} |`);
}
writeFileSync(join(OUT_DIR, 'inventory.md'), lines.join('\n'));
console.log(`\nwrote ${OUT_DIR}/inventory.json and inventory.md — ${gaps.length} field gaps`);
