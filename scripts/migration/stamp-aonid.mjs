/*
 * Stage 2c — stamp the archive provenance onto every core.json record.
 *
 * This is the field that makes "one database, two renderings" possible: given a record, the character
 * sheet renders its own compact view while the archive view renders the FULL AoN document — both from
 * the same source, with no duplicated content, because the record now says which document it is.
 *
 * Written per record, from scripts/migration/out/map.json:
 *
 *   aonId        the record's own archive document          (status doc | scraped)
 *   aonParentId  the document this record is a section of   (status subblock | table | derived)
 *   aonSection   the section's label inside that parent, when extract.mjs found one
 *   aonOrigin    'authored' for hand-written HH content with no archive source
 *
 * A record gets exactly ONE of aonId / aonParentId / aonOrigin. Records the user chose to drop are
 * reported but not touched — dropping them is a separate, deliberate step.
 *
 * SAFE BY DEFAULT: writes scripts/migration/out/core.stamped.json and prints a diff summary.
 * Pass --write to overwrite public/core.json (a timestamped backup is taken first).
 *
 *   node scripts/migration/stamp-aonid.mjs
 *   node scripts/migration/stamp-aonid.mjs --write
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join as pjoin, join } from 'node:path';
import { buildDocIndex, resolveDoc, linkIsPlausible } from '../lib/aonid-categories.mjs';

const OUT = 'scripts/migration/out';
const CORE = 'public/core.json';
const EXPORT = 'C:/trying ai 2/hh-data-export/without-images/data';
const WRITE = process.argv.includes('--write');

/*
 * The name-collision guard the `subblock`/`table` branch below already applies, extended to whole
 * DOCUMENT matches.
 *
 * That branch refuses to stamp an unverified parent and gives the gems as its worked example —
 * "`Alabaster` is filed under the feat `Alabaster Eyes`, `Emerald` under `Emerald Grasshopper`" — but a
 * `doc`/`scraped` match skipped the check entirely, which is how three gemstones came to own a dragon,
 * a familiar ability and a creature:
 *
 *     items/coral -> draconic-exemplar-8    items/jet -> familiar-ability-94    items/sard -> creature-792
 *
 * So: before writing a docId, confirm the document's category is one this bucket may point into. A
 * rejected stamp leaves the record with no provenance — which is exactly what the comment below argues
 * for, being better than a provenance known to be false.
 */
const docIndex = buildDocIndex(EXPORT, { readFileSync, readdirSync, join });
const rejected = [];
function plausibleDoc(bucket, key, docId) {
  const { doc } = resolveDoc(docIndex, docId);
  if (!doc) return true;                       // not in the export at all: not this guard's business
  if (linkIsPlausible(bucket, doc.cat, key)) return true;
  rejected.push(`${bucket}|${key}  -> ${docId}  (${doc.cat} "${doc.name}")`);
  return false;
}

const { map } = JSON.parse(readFileSync(pjoin(OUT, 'map.json'), 'utf8'));
const core = JSON.parse(readFileSync(CORE, 'utf8'));

let sections = {};
try { sections = JSON.parse(readFileSync(pjoin(OUT, 'sections.json'), 'utf8')); } catch { /* optional */ }

const tally = {};
const bump = (k) => { tally[k] = (tally[k] ?? 0) + 1; };
const unmapped = [];
const unresolved = [];

for (const [bucket, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  for (const [key, rec] of Object.entries(records)) {
    if (!rec || typeof rec !== 'object') continue;

    const m = map[bucket]?.[key];
    if (!m) { unmapped.push(`${bucket}|${key}`); bump('NOT IN THE MAP'); continue; }

    // Clear any stamp from a previous run so this script stays idempotent and never leaves a stale
    // pairing behind when a record is reclassified between runs.
    delete rec.aonId; delete rec.aonParentId; delete rec.aonSection; delete rec.aonOrigin;

    switch (m.status) {
      case 'doc':
      case 'scraped':
        if (!m.docId) { bump('doc WITHOUT AN ID'); break; }
        if (!plausibleDoc(bucket, key, m.docId)) { bump(`${m.status} — WRONG KIND OF PAGE, not stamped`); break; }
        rec.aonId = m.docId; bump(m.status);
        break;
      case 'subblock':
      case 'table': {
        /*
         * ONLY a parent that extract.mjs actually pulled a section out of gets stamped. The map's
         * `parentDocId` for a FAILED extraction is the unverified full-text guess, and those are
         * routinely wrong — the gem `Alabaster` is filed under the feat `Alabaster Eyes`, `Emerald`
         * under `Emerald Grasshopper`. Stamping those would write a provenance we know to be false,
         * which is worse than leaving the record unresolved and on the NEED-LOOKUP list.
         */
        const sec = sections[bucket]?.[key];
        if (!sec) { unresolved.push(`${bucket}|${key}  ${m.name}`); bump(`${m.status} — UNVERIFIED, not stamped`); break; }
        rec.aonParentId = sec.parentDocId;
        rec.aonSection = sec.label;
        bump(`${m.status} +section`);
        break;
      }
      case 'derived':
        // Hand-checked in build-map.mjs's DERIVED table, each entry commented with its reason, so
        // these need no extracted section — the parent feature IS the content.
        if (m.parentDocId) { rec.aonParentId = m.parentDocId; bump('derived'); }
        else bump('derived WITHOUT A PARENT');
        break;
      case 'authored':
        rec.aonOrigin = 'authored';
        bump('authored');
        break;
      case 'drop':
        bump('drop (left untouched)');
        break;
      default:
        bump(`UNKNOWN STATUS ${m.status}`);
    }
  }
}

const total = Object.values(tally).reduce((a, b) => a + b, 0);
console.log(`--- stamped ${total} records ---`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(32)} ${String(v).padStart(6)}`);
}
if (unmapped.length) {
  console.log(`\n${unmapped.length} records are NOT in map.json — the map must cover every record before --write:`);
  for (const u of unmapped.slice(0, 20)) console.log(`   ${u}`);
}
if (unresolved.length) {
  console.log(`\n${unresolved.length} records carry NO provenance yet — their parent was never verified.`);
  console.log('These are the NEED-LOOKUP set; stamping is still safe, they simply have no aon* field.');
}
if (rejected.length) {
  console.log(`\n${rejected.length} document match(es) REJECTED — the page is a different kind of thing:`);
  for (const r of rejected) console.log(`   ${r}`);
  console.log('  Left unstamped on purpose. If one of these is actually correct, add it to BUCKET_QUIRK');
  console.log('  in scripts/lib/aonid-categories.mjs with the evidence.');
}

const json = JSON.stringify(core);
if (WRITE) {
  if (unmapped.length) {
    console.error('\nREFUSING to write: some records have no map entry (see above). Fix build-map.mjs first.');
    process.exit(1);
  }
  const bak = `${CORE}.pre-aonid.bak`;
  if (!existsSync(bak)) copyFileSync(CORE, bak);
  writeFileSync(CORE, json);
  console.log(`\nwrote ${CORE}  (backup at ${bak})`);
} else {
  const dest = pjoin(OUT, 'core.stamped.json');
  writeFileSync(dest, json);
  const before = readFileSync(CORE).length;
  console.log(`\nDRY RUN — wrote ${dest}`);
  console.log(`  core.json ${(before / 1e6).toFixed(2)} MB -> ${(json.length / 1e6).toFixed(2)} MB  (+${(((json.length - before) / before) * 100).toFixed(1)}%)`);
  console.log('  re-run with --write to update public/core.json');
}
