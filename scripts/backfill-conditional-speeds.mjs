/*
 * FOUR RECORDS THAT PAID A SPEED THEY HAD NOT EARNED.
 *
 * Owner ruling 2026-08-22: *"we give an actual speed only when it's always; if it is dependent on
 * something it's in a *"*. `conditional-speed-check.mjs` found five records whose printed text gates a
 * Speed and whose data granted it permanently. Each moves to the lane that matches its condition:
 *
 *   monk-moves        *"+10-foot status bonus to your Speed WHEN YOU'RE NOT WEARING ARMOR"*
 *                     → speedsIf.unarmored. It was paying +10 in full plate.
 *   diving-armor      *"WHILE WEARING YOUR ARMOR INNOVATION … gain a swim Speed equal to your land Speed"*
 *   soaring-armor     *"WHILE WEARING YOUR INNOVATION, you gain a fly Speed equal to your land Speed"*
 *                     → speedsIf.wearingDesignated: 'innovation'. Both paid out with the suit off.
 *   implements-flight *"AS LONG AS YOU'RE HOLDING a thaumaturge implement…"*
 *                     → speedsIf.holdingDesignated: 'weapon-implement'.
 *
 * These stay NUMBERS rather than becoming stars because the sheet can evaluate each one exactly from
 * the character's own equipment — the Speed appears precisely while the condition holds. A star is for
 * a condition the sheet cannot see, which is Favored Terrain's lane.
 *
 *   shory-aerialist   held `speeds: {}` — an empty object granting nothing at all, so its +5-foot fly
 *                     bonus and its +2 Acrobatics were both absent. The bonus is gated on *"whenever
 *                     you are flying VIA MAGIC"*, which the sheet genuinely cannot see: it becomes two
 *                     situational stars, and the empty field is REMOVED so the guard stops counting it.
 *
 *   node scripts/backfill-conditional-speeds.mjs           # report
 *   node scripts/backfill-conditional-speeds.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const ROWS = [
  /* The +10 is a STATUS bonus to the existing land Speed, which is what `land` means here — the reader
   * adds land grants to the base rather than taking a max, so 25 + 10 = 35 for an unarmored monk. */
  { category: 'feats', id: 'monk-moves', field: 'speedsIf', value: [{ unarmored: true, speeds: { land: 10 } }] },
  { category: 'feats', id: 'monk-moves', field: 'speeds', value: null },

  { category: 'feats', id: 'diving-armor', field: 'speedsIf', value: [{ wearingDesignated: 'innovation', speeds: { swim: '@actor.speed.land' } }] },
  { category: 'feats', id: 'diving-armor', field: 'speeds', value: null },

  { category: 'feats', id: 'soaring-armor', field: 'speedsIf', value: [{ wearingDesignated: 'innovation', speeds: { fly: '@actor.speed.land' } }] },
  { category: 'feats', id: 'soaring-armor', field: 'speeds', value: null },

  { category: 'feats', id: 'implements-flight', field: 'speedsIf', value: [{ holdingDesignated: 'weapon-implement', speeds: { fly: '@actor.speed.land' } }] },
  { category: 'feats', id: 'implements-flight', field: 'speeds', value: null },

  /* Flying "via magic" is not a state the sheet holds, so this one really is a star — both halves of
   * it, since the Acrobatics bonus rides the same condition and was equally absent. */
  { category: 'feats', id: 'shory-aerialist', field: 'speeds', value: null },
  {
    category: 'feats',
    id: 'shory-aerialist',
    field: 'situational',
    value: [
      { targets: [{ kind: 'speed' }], when: 'whenever you are flying via magic', bonus: '+5-foot status bonus to your fly Speed' },
      { targets: [{ kind: 'skill', detail: 'acrobatics' }], when: 'to Maneuver in Flight', bonus: '+2 circumstance' },
    ],
  },
];

for (const r of ROWS) {
  if (!core[r.category]?.[r.id]) { console.error(`${r.category}/${r.id} is not in core.json`); process.exit(2); }
}

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
console.log(`${ROWS.length} row(s): ${added} new, ${replaced} replaced.`);
for (const r of ROWS) console.log(`  ${r.category}/${r.id}.${r.field}${r.value === null ? '  (REMOVED)' : ''}`);
if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }
writeBackfill(ROOT, rows);
console.log(`\nwrote ${rows.length} rows.`);
