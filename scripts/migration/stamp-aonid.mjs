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
 *   remasteredAs {bucket,id,name} of the reprint that ships beside this record (desk #158), with
 *                `edition` forced to 'legacy' — see the doc/scraped branch below
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
    // pairing behind when a record is reclassified between runs. `remasteredAs` is cleared with them
    // for the same reason: it is derived from the map, so a record that stops being a shipped twin
    // must not keep pointing a player at a reprint that is no longer its reprint.
    delete rec.aonId; delete rec.aonParentId; delete rec.aonSection; delete rec.aonOrigin;
    delete rec.remasteredAs;

    switch (m.status) {
      case 'doc':
      case 'scraped':
        if (!m.docId) { bump('doc WITHOUT AN ID'); break; }
        if (!plausibleDoc(bucket, key, m.docId)) { bump(`${m.status} — WRONG KIND OF PAGE, not stamped`); break; }
        rec.aonId = m.docId; bump(m.status);
        /*
         * DESK #158 — the old page whose reprint already ships as its own record. build-map.mjs
         * computed the pairing from the export (scripts/lib/reprint.mjs shippedTwin); this writes it
         * onto the record, which is the only place the app can read it.
         *
         * `legacy`, deliberately NOT `superseded`: the owner ruled the pre/post-remaster axis is
         * chosen by the hide-legacy toggle, not by an always-hide, so a player who plays legacy
         * content keeps Acid Splash and a remaster-only character does not see it
         * (applyEditionFilter, src/rules/build.ts). scripts/reprint-check.mjs fails the build if the
         * pair is missing; scripts/edition-drift-check.mjs leaves it alone because it is a ruling.
         */
        if (m.remasteredAs) {
          rec.remasteredAs = { ...m.remasteredAs };
          rec.edition = 'legacy';
          bump('remastered-as (edition legacy, desk #158)');
        }
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

/*
 * ---- the AUTHORED PROVENANCE always wins ---------------------------------------------------------
 *
 * Stamping is an automated guess made from a NAME, and the loop above deliberately clears every aon*
 * field first so a reclassified record never keeps a stale pairing. That also throws away the
 * hand-corrected links, which live in scripts/data/effect-backfill.json and reach core.json through
 * import-core-v2 — a stage that runs BEFORE this one. So every regen quietly reinstated the wrong
 * page and nothing said so: `fix-aonid-collisions.mjs` saw its own row still in the overlay and
 * reported "0 change(s)".
 *
 * Measured 2026-08-19 — 25 records, all of them a subclass whose name is also something else:
 *
 *     classFeatures/thief    racket-9         ->  class-sample-15   (an NPC rogue named Thief)
 *     classFeatures/bomber   research-field-5 ->  class-sample-2
 *     classFeatures/battle   mystery-13       ->  action-1422       (the Battle action)
 *     classFeatures/time     mystery-23       ->  domain-121        (the Time domain)
 *
 * A name-match cannot tell those apart; a person already did. Re-applying the authored rows LAST
 * makes that ruling durable, and costs nothing where the two agree.
 *
 * ⚠ 2026-09-12 — THE SAME HOLE, ONE FIELD OVER. This block only knew `aonId`, so the identical
 * ruling expressed as a PARENT link was still wiped every regen. Measured against the committed
 * artefact: 23 armour-innovation records fell back from `innovation-1` (Armor, Guns & Gears
 * REMASTERED, the newest printing) to the stale `innovation-5` section row; `blessed-swiftness` fell
 * from `class-feature-877` to `equipment-2320`, a class feature pointing at an ITEM page; and 33
 * records the overlay CREATES carried their parent inside the created value — out of the map, so
 * build-map called them `authored` and the parent was replaced by `aonOrigin`. Two carriers, one
 * ruling, so both are re-applied here:
 *
 *   {category,id,field:'aonId'|'aonParentId'|'aonSection',value}   a hand-corrected link
 *   {category,id,create:true,value:{… aonParentId, aonSection …}}  a record authored with its parent
 *
 * A record gets exactly ONE of aonId / aonParentId / aonOrigin (see the header), so re-applying a
 * parent drops the `authored` origin stamping had just written.
 */
{
  let overlay = [];
  try { overlay = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')); } catch { /* optional */ }
  const AON_FIELDS = ['aonId', 'aonParentId', 'aonSection'];
  let restored = 0;
  const put = (rec, field, value) => {
    if (value === null) { if (field in rec) { delete rec[field]; restored++; } return; }
    if (rec[field] === value) return;
    rec[field] = value;
    if (field === 'aonParentId' && 'aonOrigin' in rec) delete rec.aonOrigin;
    restored++;
  };
  for (const r of overlay) {
    if (!r || r.path?.length) continue;
    const rec = core[r.category]?.[r.id];
    if (!rec) continue;
    if (r.create) {
      for (const f of AON_FIELDS) if (r.value?.[f] !== undefined) put(rec, f, r.value[f]);
    } else if (AON_FIELDS.includes(r.field)) {
      put(rec, r.field, r.value);
    }
  }
  if (restored) console.log(`\n${restored} authored aon* field(s) re-applied over the stamp (the overlay is the ruling).`);
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
