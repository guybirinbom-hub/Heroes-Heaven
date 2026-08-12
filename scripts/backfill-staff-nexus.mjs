/*
 * Staff Nexus (wizard thesis): "You begin play with a makeshift staff of your own invention… it
 * contains one cantrip and one 1st-rank spell, both from your spellbook."
 *
 * Three things were missing and two of them turned out to already exist:
 *   - `grantsItems` DOES create an inventory item — it was only ever read off FEATS, and Staff Nexus
 *     is a class feature. That is a one-line gap, not a missing lane.
 *   - The staff itself did not exist as an item, so there was nothing to grant. Created here.
 *   - Its two spells are the player's, from their own spellbook, so they belong to the INSTANCE
 *     rather than the shared item record (`heldSpellsOverride`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const db = JSON.parse(readFileSync(ROOT + 'public/core.json', 'utf8'));
const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};
const rec = db.classFeatures['staff-nexus'];
if (!rec) fail('staff-nexus is not a class feature');
const t = String(rec.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
for (const [what, re] of [
  ['the makeshift staff', /You begin play with a makeshift staff of your own invention/i],
  ['its two spells', /contains one cantrip and one 1st-rank spell, both from your spellbook/i],
  ['the charge rule', /you can expend one spell to grant the staff a number of charges equal to that spell.s rank/i],
  ['the 8th-level step', /At 8th level, you can expend two spells instead of one/i],
  ['the 16th-level step', /At 16th level, you can expend up to a total of three spells/i],
])
  if (!re.test(t)) fail(`staff-nexus: ${what} is not in the text`);

const STAFF = {
  id: 'makeshift-staff',
  name: 'Makeshift Staff',
  // Level 1: it is the thesis's starting equipment, not a purchasable magic item.
  level: 1,
  itemType: 'weapon',
  category: 'simple',
  group: 'club',
  damage: { dice: 1, die: 'd4', type: 'bludgeoning' },
  traits: ['magical', 'staff', 'two-hand-d8'],
  rarity: 'common',
  bulk: 1,
  hands: 1,
  price: '0 gp',
  description:
    'The makeshift staff you built during your first days of study (Staff Nexus). It holds one cantrip and one 1st-rank spell from your spellbook. ' +
    'During your daily preparations you can expend a prepared spell to give it charges equal to that spell’s rank — two spells from 8th level, three from 16th. ' +
    'Casting its 1st-rank spell costs 1 charge; the cantrip costs none. Charges dissipate after 24 hours. If it is destroyed you can build another in an hour, with no charges.',
  // The charge pool the Spells page and Inventory both read. Its maximum is not fixed by the item —
  // it is whatever you expended this morning — so it starts empty and the player sets it.
  counters: [{ id: 'pool', label: 'Charges', max: 'level', resetsOnRest: true, startsFull: false }],
  source: { book: 'Pathfinder Player Core', license: 'ORC' },
};

const put = (category, id, field, value) => {
  const i = rows.findIndex((r) => r.category === category && r.id === id && r.field === field && !r.path);
  if (value === null) {
    if (i >= 0) rows.splice(i, 1);
    return;
  }
  if (i >= 0) rows[i] = { category, id, field, value };
  else rows.push({ category, id, field, value });
};

// The item, as a whole-record create (it has no AoN source of its own — it is a thesis's kit).
const ci = rows.findIndex((r) => r.category === 'items' && r.id === STAFF.id && r.create);
if (ci >= 0) rows[ci] = { category: 'items', id: STAFF.id, create: true, value: STAFF };
else rows.push({ category: 'items', id: STAFF.id, create: true, value: STAFF });

put('classFeatures', 'staff-nexus', 'grantsItems', [{ itemId: STAFF.id }]);
put('classFeatures', 'staff-nexus', 'effectChoices', [
  {
    id: 'staff-cantrip',
    prompt: 'Makeshift staff — the cantrip it holds',
    spellFilter: { cantripsOnly: true, traditions: ['arcane'], grantAs: 'staff' },
  },
  {
    id: 'staff-spell',
    prompt: 'Makeshift staff — the 1st-rank spell it holds',
    spellFilter: { rank: 1, traditions: ['arcane'], grantAs: 'staff' },
  },
]);
put('classFeatures', 'staff-nexus', 'dataWarning', null);

writeFileSync(BF, formatBackfill(rows));
console.log(`staff-nexus: item ${ci >= 0 ? 'replaced' : 'created'}, grant + two spell picks written`);
