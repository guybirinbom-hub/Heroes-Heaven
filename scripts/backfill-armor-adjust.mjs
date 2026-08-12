/*
 * The two items in the game that restate the armour they are worn with.
 *
 * Both shipped as read-only flavour text, so a character wearing one showed a WRONG AC — and in the
 * worst case a flattering one: an armoured skirt makes its host one step heavier, and a wearer
 * untrained in the heavier category loses their entire proficiency bonus to AC.
 *
 * Every number below is read out of the item's own printed text, which is asserted first. The one
 * translation is Strength: both items are pre-Remaster and say "increases the Strength SCORE
 * required … by 2", while the app stores armour Strength as a MODIFIER (full plate is +4, i.e.
 * Str 18). Two points of score is one point of modifier.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const db = JSON.parse(readFileSync(ROOT + 'public/core.json', 'utf8'));
const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const plain = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

// ---- Armored Skirt --------------------------------------------------------------------------------
const skirt = plain(db.items['armored-skirt']?.description);
if (!skirt) fail('armored-skirt has no description');
for (const [what, re] of [
  ['mode A host list', /When worn with a breastplate, chain shirt, chain mail, or scale mail/i],
  ['mode A +1 AC', /increases the armor.s item bonus to AC by 1/i],
  ['mode A check penalty', /worsens the armor.s check penalty by 1/i],
  ['mode A dex cap', /reduces the armor.s Dex cap by 1/i],
  ['mode A strength', /increases the Strength score required[^.]*by 2/i],
  ['mode A noisy', /adds the noisy trait/i],
  ['mode A step', /one step heavier \(from light to medium, or medium to heavy\)/i],
  ['mode B host list', /to replace appropriate portions of a set of half plate or full plate/i],
  ['mode B -1 AC', /reduce the armor.s item bonus to AC by 1/i],
  ['mode B check penalty', /lessen the check penalty by 1/i],
  ['mode B strength', /decrease the Strength score required[^.]*by 2/i],
  ['mode B dex cap', /increase the armor.s Dex cap by 1/i],
  ['the no-benefit clause', /grants no benefit when worn by itself or with armors other than those listed here/i],
])
  if (!re.test(skirt)) fail(`armored-skirt: ${what} is not in the printed text`);

// The four hosts of mode A and the two of mode B must all exist, or the mode silently covers nothing.
const MODE_A = ['breastplate', 'chain-shirt', 'chain-mail', 'scale-mail'];
const MODE_B = ['half-plate', 'full-plate'];
for (const id of [...MODE_A, ...MODE_B]) if (db.items[id]?.itemType !== 'armor') fail(`host armour "${id}" is missing`);

const ARMORED_SKIRT = {
  modes: [
    {
      label: 'with a breastplate, chain shirt, chain mail or scale mail',
      items: MODE_A,
      acBonus: 1,
      checkPenalty: -1,
      dexCap: -1,
      strength: 1, // "+2 to the Strength SCORE" = +1 modifier
      addTraits: ['noisy'],
      categoryStep: 1,
    },
    {
      // "Alternatively, when wearing an armored skirt to replace appropriate portions of a set of
      // half plate or full plate…" — this mode LIGHTENS the suit and does NOT change its category.
      label: 'replacing portions of half plate or full plate',
      items: MODE_B,
      acBonus: -1,
      checkPenalty: 1,
      dexCap: 1,
      strength: -1,
      addTraits: ['noisy'],
    },
  ],
  exclusive: true,
};

// ---- Plated Duster --------------------------------------------------------------------------------
const duster = plain(db.items['plated-duster']?.description);
if (!duster) fail('plated-duster has no description');
for (const [what, re] of [
  ['host test', /When worn with light armor from the cloth, leather, or chain groups/i],
  ['+1 AC', /increases the armor.s item bonus to AC by 1/i],
  ['check penalty', /worsens the armor.s check penalty by 1/i],
  ['dex cap', /reduces the armor.s Dex cap by 1/i],
  ['strength', /increases the Strength score required[^.]*by 2/i],
  ['noisy', /adds the noisy trait/i],
  ['the group change', /changes the armor.s group to composite/i],
  ['the step', /one step heavier \(from light to medium\)/i],
  ['the exclusivity clause', /can.t use a plated duster alongside an armored skirt/i],
])
  if (!re.test(duster)) fail(`plated-duster: ${what} is not in the printed text`);

const PLATED_DUSTER = {
  modes: [
    {
      label: 'with light cloth, leather or chain armour',
      hostCategories: ['light'],
      hostGroups: ['cloth', 'leather', 'chain'],
      acBonus: 1,
      checkPenalty: -1,
      dexCap: -1,
      strength: 1,
      addTraits: ['noisy'],
      setGroup: 'composite',
      categoryStep: 1,
    },
  ],
  exclusive: true,
};

// How many armours the duster's mode actually covers — a group name that matches nothing would make
// the whole item silently inert, which is the failure this backfill exists to prevent.
const covered = Object.values(db.items).filter(
  (i) => i.itemType === 'armor' && i.category === 'light' && ['cloth', 'leather', 'chain'].includes(i.group ?? ''),
);
if (covered.length < 5) fail(`plated-duster covers only ${covered.length} armours — the group names are probably wrong`);

const put = (id, value) => {
  const i = rows.findIndex((r) => r.category === 'items' && r.id === id && r.field === 'armorAdjust' && !r.path);
  const row = { category: 'items', id, field: 'armorAdjust', value };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
};
put('armored-skirt', ARMORED_SKIRT);
put('plated-duster', PLATED_DUSTER);

writeFileSync(BF, formatBackfill(rows));
console.log(`armored-skirt: 2 modes (${MODE_A.length} + ${MODE_B.length} hosts)`);
console.log(`plated-duster: 1 mode, covering ${covered.length} light cloth/leather/chain armours`);
console.log(`effect-backfill now holds ${rows.length} rows`);
