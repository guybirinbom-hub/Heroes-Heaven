/*
 * THE ARCHETYPE COMMANDER HAD NO FOLIO (feats/commander-dedication).
 *
 * *"You gain the tactics class feature LIKE A COMMANDER and gain your own folio; THIS FOLIO CONTAINS
 * TWO common mobility or offensive tactics of your choosing. You can prepare ONE of these tactics
 * whenever a commander would be able to prepare tactics."* (Battlecry! pg. 52.)
 *
 * The whole subsystem was gated on `ownsClass('commander')`, which a dedication never satisfies — so
 * an archetype commander picked no tactics, stored none and saw none, and the only carrier was a note
 * on the record apologising that "archetype tactics aren't tracked". Their row (WG 45508) opens with
 * TWO `select` pickers over ability blocks filtered `{traits:['Tactic'], level:{max:1}}` — two basic
 * tactics, which is the same feat read the same way.
 *
 * This row is the two capacities, on the record that prints them. They are read through `tableMax` by
 * `commanderFolioMaxViaDedication` / `commanderPreparedMaxViaDedication`, exactly as the runesmith
 * dedication's `runesKnown` / `runesEtched` are — the class's own numbers are 5 and 3, so a dedicated
 * character reading the class ladder would carry a folio nearly three times the size the feat grants.
 *
 * ⚠ THE COUNTS ARE FLAT, and that is the printed text, not an omission: no commander archetype feat
 * raises the folio by level. Tactical Expansion and Tactical Excellence each add two, and both already
 * carry their `commander-folio` counter mods, so they apply the moment the gate opens. Tactical
 * Excellence also carries `preparedTacticsBonus: 1`.
 *
 * ⚠ SQUADMATES ARE NOT AUTHORED HERE, and are not a guess either. The printed Tactics feature — the one
 * the dedication grants by name — reads *"when you drill, you can instruct a total number of allies
 * equal to 2 + your Intelligence modifier … These allies are your squadmates."* It travels with the
 * feature, and the dedication demands Intelligence +2.
 *
 *   node scripts/backfill-commander-dedication.mjs [--write]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const rec = core.feats?.['commander-dedication'];
if (!rec) { console.error('feats/commander-dedication is missing'); process.exit(2); }

/* The pool the feat can draw from has to exist, or the folio is a capacity over nothing. */
const basic = Object.values(core.actions ?? {}).filter((a) => (a.traits ?? []).includes('tactic') && (a.tacticTier ?? 'basic') === 'basic');
if (basic.length < 2) { console.error(`only ${basic.length} basic tactic(s) in the data — a two-tactic folio could not be filled`); process.exit(2); }
console.log(`${basic.length} basic tactics available to fill a folio of 2.`);

const rows = [
  { category: 'feats', id: 'commander-dedication', field: 'folioTactics', value: [{ level: 1, count: 2 }] },
  { category: 'feats', id: 'commander-dedication', field: 'preparedTactics', value: [{ level: 1, count: 1 }] },
];

/*
 * The note said the subsystem was not tracked. It is now, and a note that contradicts the sheet is
 * worse than none — but the SECOND half of that note is real printed information with no other
 * carrier: *"You gain a commander's banner that grants you a 30-foot aura for the purposes of using
 * your tactics, but the banner does not grant the commander's banner bonus to Will saves and DCs
 * against fear effects."* So the apology is dropped and the banner clause kept, rather than the whole
 * note cleared — deleting a sentence nothing else says is not a fix.
 */
const BANNER_NOTE =
  "Your commander's banner gives a 30-foot aura for using your tactics, but not the commander's banner bonus to Will saves and DCs against fear effects.";
if (typeof rec.note === 'string' && /aren't tracked/i.test(rec.note)) {
  console.log(`replacing the note:\n  was: ${rec.note}\n  now: ${BANNER_NOTE}`);
  rows.push({ category: 'feats', id: 'commander-dedication', field: 'note', value: BANNER_NOTE });
} else {
  console.log(`note left alone: ${rec.note ?? '(none)'}`);
}

console.log(`\nfolio 2, prepared 1 (flat — no archetype feat raises them by level).`);
if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }

const all = readBackfill(ROOT);
for (const r of rows) {
  const at = all.findIndex((x) => x.category === r.category && x.id === r.id && x.field === r.field);
  if (at >= 0) all[at] = r; else all.push(r);
}
writeBackfill(ROOT, all);
console.log(`wrote (${all.length} rows).`);
