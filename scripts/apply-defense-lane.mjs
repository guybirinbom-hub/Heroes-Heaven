/*
 * Applies the classified DEFENSE lane: unconditional resistances / weaknesses / immunities / senses /
 * speeds a record grants its owner.
 *
 * Storage is DIRECT fields on the record (r.resistances, r.senses, …) — the shape derive.ts actually
 * reads (src/rules/derive.ts ~line 673) and the shape the 194 already-modelled records use. The
 * `defenses` wrapper in DefenseGrants is not used by any record in core.json, so writing there would
 * have produced data that parses, validates, and does nothing.
 *
 * Only `grants: true` rows are applied. Everything conditional (in a stance, against one foe, once
 * per day, while an item is activated) is deliberately excluded: a false positive here hands every
 * character with that feat a PERMANENT resistance the rules never gave them.
 *
 * Usage: node scripts/apply-defense-lane.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const PATH = 'public/core.json';
const CLASSIFIED = 'work/lane-defense-classified.json';

const db = JSON.parse(readFileSync(PATH, 'utf8'));
const rows = JSON.parse(readFileSync(CLASSIFIED, 'utf8')).filter((r) => r.grants);

/**
 * Rows whose text carries an EXCEPTION the IwrEntry shape cannot express ("resistance to all damage
 * EXCEPT force, vitality and ghost touch"). Storing them without the exception would grant a
 * resistance the rules withhold, which is worse than granting nothing — so they are held back with
 * the reason recorded, exactly like the conditional stance resistances.
 *
 * Note the scan that found these had to check EVERY defense sentence in a record, not just the first:
 * ghostly-resistance's exception sits in its second sentence and a first-sentence scan missed it.
 * Mantle of the Grogrisant is NOT here — "physical except bludgeoning" was correctly decomposed into
 * piercing + slashing, which loses nothing.
 */
const EXCEPTION_UNMODELLABLE = {
  'ghostly-resistance': 'resistance is to all damage EXCEPT force, vitality and ghost-touch weapons; IwrEntry has no exception field, so filing it as "all" would over-grant',
};

const COLLECTIONS = ['feats', 'items', 'heritages', 'backgrounds', 'classFeatures', 'ancestries'];
const findRec = (id) => {
  for (const c of COLLECTIONS) if (db[c]?.[id]) return { rec: db[c][id], collection: c };
  return null;
};

/** IwrEntry.value is `number | string`: a plain count stays a number, a level formula stays a string. */
const num = (v) => (/^\d+$/.test(String(v)) ? Number(v) : String(v));

const stats = { applied: 0, missing: 0, skippedExisting: 0, heldBack: 0, fields: {} };
const notes = [];

for (const row of rows) {
  if (EXCEPTION_UNMODELLABLE[row.id]) {
    stats.heldBack++;
    notes.push(`HELD BACK ${row.id} — ${EXCEPTION_UNMODELLABLE[row.id]}`);
    continue;
  }
  const found = findRec(row.id);
  if (!found) { stats.missing++; notes.push(`MISSING ${row.id}`); continue; }
  const { rec } = found;

  // Never overwrite a hand-authored/imported defense — those were verified earlier and win.
  if (rec.resistances || rec.weaknesses || rec.immunities || rec.senses) { stats.skippedExisting++; continue; }

  const bump = (f) => { stats.fields[f] = (stats.fields[f] ?? 0) + 1; };

  if (row.whileActive) {
    // Gated on a live class-resource toggle (Raging Resistance). derive reads these via
    // activeStateGrants, NOT as a standing defense — filing them flat would make rage permanent.
    const wa = { state: row.whileActive };
    if (row.resistances?.length) wa.resistances = row.resistances.map((e) => ({ type: e.type, value: num(e.value) }));
    if (row.senses?.length) wa.senses = row.senses.map((s) => ({ name: s.name, ...(s.range && { range: s.range }), ...(s.acuity && { acuity: s.acuity }) }));
    if (row.immunities?.length) wa.immunities = row.immunities;
    rec.whileActive = [...(rec.whileActive ?? []), wa];
    bump('whileActive');
    stats.applied++;
    continue;
  }

  if (row.resistances?.length) { rec.resistances = row.resistances.map((e) => ({ type: e.type, value: num(e.value) })); bump('resistances'); }
  if (row.weaknesses?.length) { rec.weaknesses = row.weaknesses.map((e) => ({ type: e.type, value: num(e.value) })); bump('weaknesses'); }
  if (row.immunities?.length) { rec.immunities = row.immunities; bump('immunities'); }
  if (row.senses?.length) {
    rec.senses = row.senses.map((s) => ({ name: s.name, ...(s.range != null && { range: s.range }), ...(s.acuity && { acuity: s.acuity }) }));
    bump('senses');
  }
  if (row.speeds && Object.keys(row.speeds).length) {
    rec.speeds = Object.fromEntries(Object.entries(row.speeds).map(([k, v]) => [k, num(v)]));
    bump('speeds');
  }
  stats.applied++;
}

console.log(`granting rows: ${rows.length}`);
console.log(`applied ${stats.applied} · held back (unmodellable exception) ${stats.heldBack} · skipped (already had defenses) ${stats.skippedExisting} · missing record ${stats.missing}`);
console.log('fields written:', JSON.stringify(stats.fields));
if (notes.length) notes.slice(0, 10).forEach((n) => console.log('  ' + n));
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(PATH, JSON.stringify(db)); // minified — pretty-printing this file once cost 4 MB
console.log('\nwritten:', PATH);
