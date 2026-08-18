/**
 * A record must not be hidden as legacy while it renders a current document.
 *
 * `applyEditionFilter` (src/rules/build.ts) drops every record whose `edition` is `legacy` or
 * `legacy-era` when a character has "Hide legacy data" on. That is correct — until `edition` disagrees
 * with the document the record actually shows. Then a remaster-only player loses content whose displayed
 * text is already current, and whose trait chips contradict the trait row inside its own popup.
 *
 * Found after repointing the mis-stamped subclass options: seven of them (Bomber, Chirurgeon, Thief,
 * Scoundrel, Fencer, Gymnast, Mutagenist) still carried `legacy-era` from the wrong document they used
 * to render, plus six familiars (Imp, Pipefox, Spellslime, Spirit Guide, Elemental Wisp, Breath Weapon).
 *
 * ⚠ ONLY ONE DIRECTION IS REPAIRED HERE, deliberately. Across the database 160 records disagree with
 * their own document's edition, in ten different directions — 104 of them are ours saying `superseded`,
 * which is a deliberate marker and not a mistake, and 20 say `remaster-era` over a `legacy-era`
 * document. "Adopt the document's edition" would resolve all of them, but in that second direction it
 * would HIDE records that are visible today, which is a content decision, not a data repair. So this
 * fixes only the direction that reveals correct content and can hide nothing: hidden-as-legacy over a
 * current document.
 *
 *   node scripts/edition-drift-check.mjs            # report only, non-zero exit if any
 *   node scripts/edition-drift-check.mjs --write
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';
import { buildDocIndex } from './lib/aonid-categories.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
const WRITE = process.argv.includes('--write');

const CORE = join(ROOT, 'public/core.json');
const core = JSON.parse(readFileSync(CORE, 'utf8'));
const docIndex = buildDocIndex(EXPORT, { readFileSync, readdirSync, join });

const cache = new Map();
const docFor = (aonId) => {
  const hit = docIndex.get(aonId);
  if (!hit) return null;
  if (!cache.has(hit.cat)) {
    try { cache.set(hit.cat, JSON.parse(readFileSync(join(EXPORT, hit.cat + '.json'), 'utf8')).docs ?? {}); }
    catch { cache.set(hit.cat, {}); }
  }
  return cache.get(hit.cat)[aonId] ?? null;
};

/** The two values applyEditionFilter drops, and the three it keeps. */
const HIDDEN = new Set(['legacy', 'legacy-era']);
const CURRENT = new Set(['remaster', 'remaster-era', 'neutral']);

const drift = [];
for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object') continue;
  for (const [id, rec] of Object.entries(recs)) {
    if (!rec || typeof rec !== 'object' || !rec.aonId) continue;
    if (!HIDDEN.has(String(rec.edition))) continue;
    const doc = docFor(rec.aonId);
    if (!doc || !CURRENT.has(String(doc.edition))) continue;
    drift.push({ bucket, id, name: rec.name, was: rec.edition, to: doc.edition, aonId: rec.aonId });
  }
}

console.log(`${drift.length} record(s) hidden as legacy while rendering a current document`);
if (drift.length) {
  console.log(`\n${'record'.padEnd(40)} ${'was'.padEnd(12)} ${'becomes'.padEnd(12)} renders`);
  for (const d of drift) {
    console.log(`${(d.bucket + '/' + d.id).padEnd(40)} ${d.was.padEnd(12)} ${d.to.padEnd(12)} ${d.aonId}  "${d.name}"`);
  }
}

if (!WRITE) {
  if (drift.length) console.log('\nFix with: node scripts/edition-drift-check.mjs --write');
  process.exit(drift.length ? 1 : 0);
}
if (!drift.length) { console.log('nothing to write.'); process.exit(0); }

const rows = readBackfill(ROOT);
for (const d of drift) {
  core[d.bucket][d.id].edition = d.to;
  const i = rows.findIndex((r) => r.category === d.bucket && r.id === d.id && r.field === 'edition');
  const row = { category: d.bucket, id: d.id, field: 'edition', value: d.to };
  if (i >= 0) rows[i] = row; else rows.push(row);
}
writeFileSync(CORE, JSON.stringify(core));
writeBackfill(ROOT, rows);
console.log(`\nwrote public/core.json and the overlay (${drift.length} editions corrected)`);
