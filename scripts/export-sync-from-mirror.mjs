/*
 * Pull documents the AoG export snapshot never received from the PRISTINE AoN mirror.
 *
 * The identity check (scripts/aonid-integrity.mjs) resolves every aonId through the per-category
 * export at hh-data-export/without-images/data — a SNAPSHOT that falls behind the mirror whenever
 * AoN publishes a new book (batch 28: the four Impossible Magic wizard schools, arcane-school-31..34,
 * were in the mirror but not the export, so the created records failed as NO DOCUMENT).
 *
 * With no arguments: every aonId in public/core.json that the export lacks and the mirror has is
 * inserted. With --ids a,b,c: just those. Nothing is ever removed or overwritten.
 *
 *   node scripts/export-sync-from-mirror.mjs
 *   node scripts/export-sync-from-mirror.mjs --ids arcane-school-31,arcane-school-32
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocIndex, stripSynthetic } from './lib/aonid-categories.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = 'C:/trying ai 2/hh-data-export/without-images/data';
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

const byId = buildDocIndex(EXPORT, { readFileSync, readdirSync, join });

/* The candidate ids: the explicit list, or every aonId core.json carries. */
let wanted;
if (arg('--ids')) wanted = arg('--ids').split(',').map((s) => s.trim()).filter(Boolean);
else {
  const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
  wanted = [];
  const walk = (v) => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (v && typeof v === 'object') {
      if (typeof v.aonId === 'string') wanted.push(v.aonId);
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(core);
}

const missing = [...new Set(wanted.map(stripSynthetic))].filter((id) => !byId.has(id));
const perFile = new Map();
const notInMirror = [];
for (const id of missing) {
  const cat = id.replace(/-\d+$/, '');
  const path = join(MIRROR, cat, id + '.json');
  if (!existsSync(path)) { notInMirror.push(id); continue; }
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const book = doc.primary_source ?? (Array.isArray(doc.source) ? doc.source[0] : doc.source) ?? '';
  /* Same envelope the export writes around each mirror document (the mirror doc is its `data`). */
  const envelope = {
    id,
    category: cat,
    name: doc.name ?? '',
    url: doc.url ?? '',
    rarity: doc.rarity ?? 'common',
    book,
    release_date: doc.release_date ?? '',
    // ponytail: date rule only — Player Core (2023-11-15) is where the remaster era starts.
    edition: (doc.release_date ?? '') >= '2023-11-15' ? 'remaster-era' : 'legacy-era',
    exclude_from_search: doc.exclude_from_search ? 1 : 0,
    pfs: doc.pfs ?? 'Standard',
    doc_type: doc.type ?? '',
    has_art: 0,
    sfs: 'standard',
    data: doc,
  };
  if (!perFile.has(cat)) perFile.set(cat, []);
  perFile.get(cat).push(envelope);
}

let inserted = 0;
for (const [cat, docs] of perFile) {
  const file = join(EXPORT, cat + '.json');
  if (!existsSync(file)) { console.log('no export file for category ' + cat + ' — skipped ' + docs.map((d) => d.id).join(', ')); continue; }
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.docs ??= {};
  for (const d of docs) { json.docs[d.id] = d; inserted++; }
  json.count = Object.keys(json.docs).length;
  writeFileSync(file, JSON.stringify(json));
  console.log(cat + '.json: +' + docs.length + ' (' + docs.map((d) => d.id + ' "' + d.name + '"').join(', ') + ')');
}
console.log(inserted + ' document(s) inserted; ' + notInMirror.length + ' missing from the mirror too' + (notInMirror.length ? ': ' + notInMirror.slice(0, 20).join(', ') : ''));
