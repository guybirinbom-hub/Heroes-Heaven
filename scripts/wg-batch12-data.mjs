/*
 * Batch 12 — the two records their side encodes and ours did not.
 *
 * 1. MODULAR DYNAMO. *"Your dynamo attack gains the modular trait, as well as one of the following
 *    configurations of your choice: power driver (1d6 bludgeoning damage; shove), percussive striker
 *    (1d4 bludgeoning; agile, finesse), rotating sickle (1d6 slashing; trip), or entangling barbs
 *    (1d6 piercing; grapple). If you have a manually controlled dynamo, these damage dice increase by
 *    1 size, as usual, and you can also choose the extendable baton (1d4 bludgeoning; finesse, reach),
 *    which has the damage increase already factored in."*
 *
 *    The record already asked the question — nine options, correctly split by whether the dynamo is
 *    automatic or manual — and then did nothing with the answer. The label said "1d6 slashing damage;
 *    trip" and the character's Strikes page still showed the configuration chosen at the Dedication.
 *    A choice whose answer changes no number is a question the player answers for nothing.
 *
 *    Authored in the SAME shape as `sterling-dynamo-dedication`, which already gates its four strikes
 *    on its own answer with `choiceValue`. Both sets are meant to exist at once: the modular trait
 *    swaps between the Dedication's configuration and this one with an Interact, so two Dynamo strikes
 *    on the sheet is the printed state, not a duplicate.
 *
 * 2. COMMAND A CONSTRUCT. `actions['command-a-construct']` ships, and `grantsActions` is how a record
 *    puts an action on the sheet — 140 records use it, including `prototype-companion` and
 *    `clockwork-reanimator-dedication`, the two other records that hand you a construct companion.
 *    The two that grant a construct and did NOT grant the action are `rise-my-creature` and
 *    `construct-innovation`, so their owners had a companion they had no printed action to command.
 *    Their side grants it from the same records, which is what surfaced it.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * die / traits / group mirror `sterling-dynamo-dedication`'s own entries exactly, so the two sets
 * render as the same weapon in two configurations rather than as two different weapons.
 *
 * ⚠ THE NAME IS LOAD-BEARING. `collectGrantedStrikes` dedupes by lowercased NAME — first writer wins,
 * silently. Naming these "Dynamo" like the Dedication's would have let one erase the other, and which
 * one survived would depend on the order feats happen to be walked in. The printed text needs BOTH on
 * the sheet: *"you switch between the initial configuration of dynamo you chose with the Sterling
 * Dynamo Dedication and the new configuration"* — a swap you cannot make against a strike that is not
 * there. Each configuration is named, which is also what the player picked it by.
 */
const cfg = (choiceValue, label, die, damageType, ...props) => ({
  name: `Dynamo (${label})`,
  die,
  damageType,
  /* "Your dynamo attack gains the modular trait" — carried on every configuration this feat grants. */
  traits: ['unarmed', 'modular', ...props],
  group: 'brawling',
  choiceValue,
});

const strikes = [
  cfg('modular:auto-power-driver', 'power driver', 'd6', 'bludgeoning', 'shove'),
  cfg('modular:auto-percussive-striker', 'percussive striker', 'd4', 'bludgeoning', 'agile', 'finesse'),
  cfg('modular:auto-rotating-sickle', 'rotating sickle', 'd6', 'slashing', 'trip'),
  cfg('modular:auto-entangling-barbs', 'entangling barbs', 'd6', 'piercing', 'grapple'),
  /* "these damage dice increase by 1 size, as usual" — d4→d6, d6→d8. */
  cfg('modular:manual-power-driver', 'power driver', 'd8', 'bludgeoning', 'shove'),
  cfg('modular:manual-percussive-striker', 'percussive striker', 'd6', 'bludgeoning', 'agile', 'finesse'),
  cfg('modular:manual-rotating-sickle', 'rotating sickle', 'd8', 'slashing', 'trip'),
  cfg('modular:manual-entangling-barbs', 'entangling barbs', 'd8', 'piercing', 'grapple'),
  /* "…which has the damage increase already factored in" — d4 stays d4. */
  cfg('modular:manual-extendable-baton', 'extendable baton', 'd4', 'bludgeoning', 'finesse', 'reach'),
];

const edits = [
  { category: 'feats', id: 'modular-dynamo', field: 'grantedStrikes', value: strikes },
  { category: 'feats', id: 'rise-my-creature', field: 'grantsActions', value: ['command-a-construct'] },
  { category: 'classFeatures', id: 'construct-innovation', field: 'grantsActions', value: ['command-a-construct'] },
];

const rows = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const e of edits) {
  const at = rows.findIndex((r) => r.category === e.category && r.id === e.id && r.field === e.field);
  if (at >= 0) { rows[at] = e; updated++; } else { rows.push(e); added++; }
}
writeBackfill(ROOT, rows);
console.log(`effect-backfill.json: ${added} added, ${updated} updated in place (${rows.length} rows).`);
