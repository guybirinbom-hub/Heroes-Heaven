/*
 * GRADE-SPELLING TWINS INHERIT THE DEFENCES OF THE RECORD THEY DUPLICATE.
 *
 * PF2e prints a graded item family as "Flaming Star (Greater)"; a later printing of the same book
 * spells the same item "Greater Flaming Star". Both spellings end up in the data — the Impossible
 * Magic import (2026-08-15) added 41 of them — and `findDuplicateIds` HIDES the second one from every
 * picker so the shop does not list the item twice.
 *
 * HIDING IS NOT DELETING, and that is the whole reason this script exists. The comment on
 * `gradeSpellingDuplicates` says it outright: a saved character may already carry either id, and the
 * engine resolves whatever id the inventory holds — `derive.ts` reads `db.items[inv.itemId]
 * ?.passiveEffects`, never the twin's. A hidden record that carries no mechanics is an item that
 * silently does nothing for the character who owns it.
 *
 * The twins arrive hollow. AoN's scrape gives the "Grade Name" row the FAMILY blurb and none of the
 * per-grade fields: `greater-flaming-star` came in with no `passiveEffects`, no `heldSpells`, no
 * `usage`, no `frequency` and no `counters`, while `flaming-star-greater` carries all five.
 *
 * ⚠ THE VALUES COME FROM THE TWIN, NEVER FROM THE TEXT. The hollow record's description is the whole
 * family's — `greater-flaming-star` reads "You gain resistance 2 to fire" (the level-3 base) followed
 * by "Resistance when affixed to armor is 5 … is 10" for the other two grades. A text scrape would
 * author 2 onto an item that grants 5. The modelled twin is the only per-grade source there is.
 *
 * The precedent is already in the overlay: the Pickled Demon Tongue family carries the same authored
 * `passiveEffects` under BOTH spellings (`greater-pickled-demon-tongue` and
 * `pickled-demon-tongue-greater`), and that is why the resistance ladder guard in
 * test/triage-lane-close.test.ts passes for it and failed for Flaming Star.
 *
 * WHAT IS PAIRED, and how each half is decided rather than assumed:
 *   · "the same item" is `findDuplicateIds` — the app's own authority for it, not a copy of the rule.
 *     Exactly one of the two ids must be in that set, so a pair the app does not consider duplicate
 *     is reported and left alone.
 *   · "the partner" is the record whose name matches once the grade word moves, at the SAME level and
 *     the SAME price in copper. Grade is part of the key, so a lesser never inherits from a greater.
 *   · "which way round" is whichever half HAS the field. Not "the visible one" — the dedupe may change
 *     which spelling it keeps, and two ids for one item must resolve alike whichever is on show.
 *   · a field already present on the target is never touched, so re-running is a no-op.
 *
 * ⚠ SCOPE IS THE DEFENCE LANE, DELIBERATELY, and the measurement is why. Run this and it reports 229
 * grade-spelling pairs missing 508 fields between them — `usage` on 208, `uses` on 90, `counters` on
 * 82, `heldSpells` on 56. Only FOUR are defences, and all four are twins this import added. Hollow
 * twins are the long-standing normal state of this data (the "Grade Name" scrape has always been the
 * thin half; 188 of those pairs predate the import), so copying all 508 would be a blind sweep of
 * records nobody has looked at, dressed up as an import fix. The defence lane is the half with a
 * guard behind it — test/triage-lane-close.test.ts asserts the spellheart resistance ladder, and it
 * is what caught this — so that is what this writes. Everything else is REPORTED on every run, with a
 * count, so the size of the remaining gap is measured rather than remembered.
 *
 *   npx jiti scripts/apply-grade-twin-mechanics.mjs --dry     # report only
 *   npx jiti scripts/apply-grade-twin-mechanics.mjs           # write core.json + the overlay
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findDuplicateIds } from '../src/data';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));

/**
 * The lane this writes: item defences, which live under `passiveEffects` and NOWHERE else — derive.ts
 * reads resistances/immunities/senses only from `db.items[inv.itemId]?.passiveEffects` (the note at
 * the top of scripts/apply-sweep-b2.mjs has the line numbers). A top-level `resistances` on an item
 * is inert, so this copies the whole object rather than the sub-key.
 */
const MECHANICAL_FIELDS = ['passiveEffects'];

/** Fields that say WHICH PRINTING a record is, not what the item does. Never part of the gap count. */
const IDENTITY_FIELDS = ['id', 'name', 'description', 'descRefs', 'traits', 'source', 'aonId', 'aonOrigin', 'rarity', 'edition', 'level', 'price', 'bulk', 'itemType', 'access', 'category'];

/**
 * The pairs this script authored on 2026-08-15, listed literally so `npm run feat <id>` names an owner
 * for the rows (feat-doctor indexes scripts by the ids they mention). All four are Impossible Magic
 * reprints of a spellheart the app already modelled; each value was checked against the grade-specific
 * sentence on the twin — "resistance 5 to fire" / "to falling damage" / "to void" / "to water effects".
 * The set is RECOMPUTED on every run and any pair missing from this list is printed: the list records
 * what was reviewed, it is never the input.
 */
const REVIEWED_PAIRS = [
  ['greater-five-feather-wreath', 'five-feather-wreath-greater'],
  ['greater-flaming-star', 'flaming-star-greater'],
  ['greater-grim-sandglass', 'grim-sandglass-greater'],
  ['greater-perfect-droplet', 'perfect-droplet-greater'],
];
const reviewed = new Set(REVIEWED_PAIRS.map((pair) => [...pair].sort().join('|')));

/* ── pairing ────────────────────────────────────────────────────────────────────────────────── */
const GRADE_WORDS = ['lesser', 'moderate', 'greater', 'major', 'minor', 'true', 'supreme'];
/** In copper, so `{gp:425}` and `{pp:0,gp:425,sp:0,cp:0}` compare equal. */
const copper = (x) => (x?.pp ?? 0) * 1000 + (x?.gp ?? 0) * 100 + (x?.sp ?? 0) * 10 + (x?.cp ?? 0);
/** "Greater Flaming Star" and "Flaming Star (Greater)" both key to "flaming star|greater". */
const gradeKey = (name) => {
  let s = name.toLowerCase().replace(/['’]/g, '').trim();
  let grade = null;
  const paren = /\s*\(([^)]+)\)\s*$/.exec(s);
  if (paren && GRADE_WORDS.includes(paren[1].trim())) {
    grade = paren[1].trim();
    s = s.slice(0, paren.index);
  } else {
    const first = /^([a-z]+)\s+/.exec(s);
    if (first && GRADE_WORDS.includes(first[1])) {
      grade = first[1];
      s = s.slice(first[0].length);
    }
  }
  return grade ? `${s.replace(/[^a-z0-9]+/g, ' ').trim()}|${grade}` : null;
};

const hidden = findDuplicateIds(core);
const byKey = new Map();
for (const [id, rec] of Object.entries(core.items)) {
  if (!rec?.name) continue;
  const k = gradeKey(rec.name);
  if (!k) continue;
  if (byKey.has(k)) byKey.get(k).push(id);
  else byKey.set(k, [id]);
}

const pairs = [];
const notDuplicate = [];
for (const ids of byKey.values()) {
  if (ids.length !== 2) continue; // three spellings of one item has never happened; look at it by hand
  const [a, b] = ids;
  if (core.items[a].level !== core.items[b].level) continue; // different item — leave both alone
  if (copper(core.items[a].price) !== copper(core.items[b].price)) continue;
  const flagged = ids.filter((i) => hidden.has(i));
  if (flagged.length !== 1) {
    notDuplicate.push(`${a} / ${b} — ${flagged.length} of the two are in findDuplicateIds`);
    continue;
  }
  pairs.push([a, b]);
}

/* ── what each half is missing ──────────────────────────────────────────────────────────────── */
const writes = []; // { id, field, value }
const unreviewed = [];
const otherShapes = [];
for (const [a, b] of pairs) {
  const key = [a, b].sort().join('|');
  const A = core.items[a];
  const B = core.items[b];
  let touched = false;
  for (const [from, to] of [[A, B], [B, A]]) {
    for (const field of MECHANICAL_FIELDS) {
      if (from[field] == null || to[field] != null) continue;
      writes.push({ id: to.id, field, value: from[field], from: from.id });
      touched = true;
    }
    // Anything else one half models and the other does not: MEASURED every run, never swept in.
    for (const field of Object.keys(from)) {
      if (MECHANICAL_FIELDS.includes(field) || to[field] != null) continue;
      if (IDENTITY_FIELDS.includes(field)) continue;
      otherShapes.push({ id: to.id, field, from: from.id });
    }
  }
  if (touched && !reviewed.has(key)) unreviewed.push(`${a} / ${b}`);
}

/* ── report ─────────────────────────────────────────────────────────────────────────────────── */
console.log(`${pairs.length} grade-spelling pairs; ${writes.length} defence(s) to copy across ${new Set(writes.map((w) => w.id)).size} records`);
for (const w of writes) console.log(`   ${w.id} <- ${w.from}  ${w.field} = ${JSON.stringify(w.value)}`);
if (unreviewed.length) {
  console.log(`\n⚠ ${unreviewed.length} pair(s) not in REVIEWED_PAIRS — a later import added them. Check the value against the twin's printed text, then add the pair to the list:`);
  for (const s of unreviewed) console.log(`   ${s}`);
}
if (otherShapes.length) {
  /* THE STANDING MEASUREMENT. Not a to-do list and not noise: it is how big the hollow-twin gap is
   * today, counted rather than remembered, so the next person can see whether an import grew it. */
  const byField = new Map();
  for (const s of otherShapes) byField.set(s.field, (byField.get(s.field) ?? 0) + 1);
  console.log(`\nNOT WRITTEN — ${otherShapes.length} non-defence fields one half of a pair has and the other lacks, over ${new Set(otherShapes.map((s) => s.id)).size} records:`);
  for (const [f, n] of [...byField].sort((x, y) => y[1] - x[1])) console.log(`   ${String(n).padStart(4)} ${f}`);
  console.log('   These are mostly older scrapes, not this import. Sweeping them needs a record-by-record');
  console.log('   read of what each field means for the item, which is a lane of its own.');
}
if (notDuplicate.length) {
  console.log(`\nNOT PAIRED — the app does not call these two the same item (${notDuplicate.length}):`);
  for (const s of notDuplicate.slice(0, 20)) console.log(`   ${s}`);
}

if (DRY) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

/* ── write ──────────────────────────────────────────────────────────────────────────────────── */
for (const w of writes) core.items[w.id][w.field] = w.value;
writeFileSync(p('public/core.json'), JSON.stringify(core));

// The overlay is the only thing that carries a record field through `npm run data`.
const overlay = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const w of writes) {
  const hit = overlay.find((r) => r.category === 'items' && r.id === w.id && r.field === w.field && !r.path?.length);
  if (hit) {
    hit.value = w.value;
    updated++;
  } else {
    overlay.push({ category: 'items', id: w.id, field: w.field, value: w.value });
    added++;
  }
}
writeBackfill(ROOT, overlay);
console.log(`\noverlay: ${added} rows added, ${updated} updated`);
console.log('written: public/core.json, scripts/data/effect-backfill.json');
