/*
 * Harvest every hand-authored field a `npm run data` regen DELETED into effect-backfill.json, which is
 * the one file the importer re-applies after rebuilding every record.
 *
 * 1,418 fields died in a single regen — 536 `limitedUses`, 500 item `frequency`, 152 `choice` groups,
 * 47 stance `requires`, 24 `focusSpells` — because an apply script had written them straight into
 * core.json and never into a source file. They came back before only because somebody re-ran the
 * matching apply script by hand.
 *
 * Only fields the regen dropped ENTIRELY are harvested. A field the importer rewrote from a fresher
 * AoN export (an `edition` reclassification, say) is the importer doing its job and is left alone.
 *
 * usage: node scripts/harvest-lost-fields.mjs <known-good-core.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const readCore = (p) => {
  let s = readFileSync(p, 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return JSON.parse(s);
};

const good = readCore(process.argv[2]);
const now = readCore(ROOT + 'public/core.json');
const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const BUCKETS = ['feats', 'classFeatures', 'items', 'spells', 'heritages', 'backgrounds', 'ancestries', 'classes', 'deities', 'actions', 'modes', 'stances'];
// Fields the importer OWNS — it derives them fresh every run and a stale copy would fight it.
const IMPORTER_OWNED = new Set(['edition', 'descRefs', 'ast', 'id', 'name', 'source', 'rarity']);

// A row already in the backfill wins: it is the authored intent, and re-harvesting a field the
// backfill deliberately set to something else would silently revert that decision.
const have = new Set(rows.filter((r) => !r.path).map((r) => `${r.category}/${r.id}/${r.field}`));
const haveCreate = new Set(rows.filter((r) => r.create).map((r) => `${r.category}/${r.id}`));

let fields = 0;
let records = 0;
const perField = new Map();
for (const bucket of BUCKETS) {
  for (const [id, grec] of Object.entries(good[bucket] ?? {})) {
    const nrec = now[bucket]?.[id];
    if (!nrec) {
      // A whole record the rebuild does not produce at all (an import-gap orphan). `create` never
      // overwrites, so this is safe to re-add on every run.
      if (!haveCreate.has(`${bucket}/${id}`)) {
        rows.push({ category: bucket, id, create: true, value: grec });
        records++;
      }
      continue;
    }
    if (typeof grec !== 'object') continue;
    for (const [field, gval] of Object.entries(grec)) {
      if (IMPORTER_OWNED.has(field)) continue;
      if (nrec[field] !== undefined) continue; // rewritten, not dropped — the importer's call
      if (have.has(`${bucket}/${id}/${field}`)) continue;
      rows.push({ category: bucket, id, field, value: gval });
      fields++;
      perField.set(`${bucket}.${field}`, (perField.get(`${bucket}.${field}`) ?? 0) + 1);
    }
  }
}

writeFileSync(BF, JSON.stringify(rows, null, 2) + '\n');
console.log(`harvested ${fields} dropped fields and ${records} whole records into effect-backfill.json`);
console.log(`effect-backfill now holds ${rows.length} rows\n`);
for (const [k, n] of [...perField].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(5)}  ${k}`);
