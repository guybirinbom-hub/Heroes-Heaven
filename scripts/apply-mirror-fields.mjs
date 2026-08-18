/**
 * Correct LEVEL and RARITY from each record's OWN Archives of Nethys document.
 *
 * `field-diff.mjs` reports the disagreements; this is the lane that fixes them, so a correction lands
 * in `scripts/data/effect-backfill.json` and survives the next `npm run data` instead of being
 * overwritten by it.
 *
 * ⚠ ONLY the record's own document counts. Both fields were previously compared through a name
 * lookup, and a name answers to more than one document often enough that the checker was holding 952
 * records back as unresolvable — hiding real defects behind an apparent all-clear. Matching on
 * `aonId` dropped that to 26 and surfaced twelve genuine disagreements, seven of them a CURSED ITEM
 * printed Rare and stored common: Calamity Glass, Golden Goose, Mistranslator's Draft, Ring of
 * Sneering Charity, Rose of Love's Lost, Tablet of Chained Souls, Taleteller's Ring. Rarity is not
 * cosmetic — it decides what a player may take without asking their GM.
 *
 * Rarity is read from the document's TRAIT line rather than its `rarity` field, because the trait is
 * what the book prints; the scalar is a derived index and the two disagree on real records.
 *
 *   node scripts/apply-mirror-fields.mjs --dry
 *   node scripts/apply-mirror-fields.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBackfill, BACKFILL_PATH } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const DRY = process.argv.includes('--dry');

const CAT_DIR = {
  items: ['equipment', 'weapon', 'armor', 'shield', 'relic', 'vehicle'],
  feats: ['feat'],
  spells: ['spell', 'ritual'],
  classFeatures: ['class-feature'],
  backgrounds: ['background'],
  heritages: ['heritage'],
  ancestries: ['ancestry'],
  deities: ['deity'],
  actions: ['action'],
};
const RARITIES = ['common', 'uncommon', 'rare', 'unique'];
const norm = (s) => String(s ?? '').toLowerCase().trim();

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const docFor = (coll, aonId) => {
  for (const dir of CAT_DIR[coll] ?? []) {
    const p = join(MIRROR, dir, `${aonId}.json`);
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8'));
      return raw._source ?? raw;
    } catch { return null; }
  }
  return null;
};

const rows = [];
for (const [coll, recs] of Object.entries(core)) {
  if (!CAT_DIR[coll] || !recs || typeof recs !== 'object') continue;
  for (const [id, rec] of Object.entries(recs)) {
    if (!rec?.aonId || !rec.name) continue;
    /* A superseded or legacy record is deliberately not kept in step with the live document. */
    if (['superseded', 'legacy', 'legacy-era'].includes(rec.edition)) continue;
    const doc = docFor(coll, rec.aonId);
    /* The document must be the SAME record, not merely one we point at — a grade record's aonId is
     * sometimes its family's page, and a family page's level is a range, not this record's level. */
    if (!doc || norm(doc.name) !== norm(rec.name)) continue;

    const traits = (doc.trait ?? []).map(norm);
    const wantRarity = RARITIES.find((r) => traits.includes(r)) ?? 'common';
    const haveRarity = norm(rec.rarity ?? 'common');
    if (wantRarity !== haveRarity && norm(doc.rarity ?? 'common') === wantRarity) {
      rows.push({ category: coll, id, field: 'rarity', value: wantRarity, was: haveRarity });
    }

    /*
     * ⚠ NEVER take a level for a CLASS FEATURE from its document.
     *
     * One classFeature record serves every class that has that feature, and they get it at different
     * levels — Evasion is 7th for a rogue and 15th for a monk, Iron Will 3rd for one class and 7th
     * for another. The record's `level` is one printing of many; the authority is each class's own
     * feature table, which `scripts/class-table-diff.mjs` verifies separately and currently reports
     * as 0 features at the wrong level.
     *
     * The dry run proposed Evasion 7 -> 15, Improved Evasion 13 -> 15 and Iron Will 3 -> 7. Applying
     * those would have moved three features for every class that has them, to fix nothing.
     */
    const isCantrip = coll === 'spells' && (rec.traits ?? []).includes('cantrip');
    const wantLevel = typeof doc.level === 'number' ? doc.level : null;
    const haveLevel = typeof rec.level === 'number' ? rec.level : null;
    if (coll !== 'classFeatures' && !isCantrip && wantLevel !== null && wantLevel > 0 && haveLevel !== null && wantLevel !== haveLevel) {
      rows.push({ category: coll, id, field: 'level', value: wantLevel, was: haveLevel });
    }
  }
}

console.log(`${rows.length} corrections from the records' own documents:\n`);
for (const r of rows) {
  console.log(`  ${r.field.padEnd(7)} ${`${r.category}/${r.id}`.padEnd(44)} ${String(r.was).padEnd(10)} -> ${r.value}`);
}
if (DRY) { console.log('\n--dry: nothing written.'); process.exit(0); }
if (!rows.length) process.exit(0);

/* `writeBackfill` takes the WHOLE overlay, not a delta — it refused a 13-row array outright rather
 * than silently dropping the other 7,332. So merge: replace a row that already addresses the same
 * (category, id, field), append the rest, keep every other row untouched. */
const existing = JSON.parse(readFileSync(join(ROOT, BACKFILL_PATH), 'utf8'));
const key = (r) => `${r.category}|${r.id}|${r.field}`;
const mine = new Map(rows.map((r) => [key(r), { category: r.category, id: r.id, field: r.field, value: r.value }]));
const merged = existing.map((r) => (mine.has(key(r)) ? mine.get(key(r)) : r));
const seen = new Set(existing.map(key));
for (const [k, r] of mine) if (!seen.has(k)) merged.push(r);

writeBackfill(ROOT, merged);
console.log(`\nwrote ${rows.length} corrections (overlay ${existing.length} → ${merged.length})`);
console.log('Re-run `npm run data` to bake them into core.json.');
