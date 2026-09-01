/*
 * ONE CLAUSE, ONE LANE — remove the duplicate dragon note from Draconic Resistance.
 *
 * *"Double this resistance against damage of that type dealt to you by dragons."*
 *
 * That sentence was encoded TWICE. Once correctly, as a source-qualified resistance
 * (`{ type, value: 'max(2,@actor.level)', against: 'dragons' }`), which deriveDefenses deliberately
 * keeps OUT of the headline number and surfaces as its own IWR breakdown line carrying the trigger —
 * "exactly as a situational bonus shows beside a stat", in that code's own words. And once again as a
 * `situational` on `hp`, which stars the HP row with the same clause.
 *
 * The second one is the duplicate. It was added while replacing a genuinely WRONG situational on this
 * record (an entry describing a +1 AC bonus against dragons — a clause the REMASTER feat does not
 * print; it belongs to the legacy version, which is why their legacy row 29500 carries an AC_BONUS and
 * their remaster row does not). Replacing wrong text with correct text was right; putting it in a lane
 * that already had it was not.
 *
 * Parity, checked rather than assumed: their remaster encoding is
 *     RESISTANCES = "<type>, 1" / "<type>, {{level/2}}"
 *     RESISTANCES = "<type> from dragons, 2" / "<type> from dragons, {{level}}"
 * which is our `max(1, floor(level/2))` plus `max(2, level)` against dragons — the same two values in
 * the same lane, and no separate note beside them.
 *
 *   node scripts/drop-draconic-resistance-situational.mjs [--write]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const rec = core.feats?.['draconic-resistance'];
if (!rec) { console.error('feats/draconic-resistance is missing'); process.exit(2); }

/* Only remove it once the resistance lane is verified to carry the clause — otherwise this deletes the
 * only encoding of a printed sentence, which is worse than the duplicate it fixes. */
const grants = (rec.effectChoices ?? []).flatMap((c) => c.options ?? []).flatMap((o) => o.grant?.resistances ?? []);
const vsDragons = grants.filter((r) => r.against === 'dragons');
console.log(`resistance entries qualified "against dragons": ${vsDragons.length}`);
if (!vsDragons.length) {
  console.error('refusing: the resistance lane does not carry the dragon clause, so the situational is the ONLY encoding.');
  process.exit(1);
}
console.log(`  e.g. ${JSON.stringify(vsDragons[0])}`);
console.log(`current situational: ${JSON.stringify(rec.situational ?? null)}`);

if (!rec.situational?.length) { console.log('\nalready absent — nothing to do.'); process.exit(0); }
if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }

/* `value: null` REMOVES a field rather than setting it to null — see the note in import-core-v2. */
const rows = readBackfill(ROOT);
const row = { category: 'feats', id: 'draconic-resistance', field: 'situational', value: null };
const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
if (at >= 0) rows[at] = row; else rows.push(row);
writeBackfill(ROOT, rows);
console.log(`\nwrote (${rows.length} rows).`);
