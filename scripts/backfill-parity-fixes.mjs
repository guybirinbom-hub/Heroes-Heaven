/*
 * DIVERGENCES FROM WANDERER'S GUIDE, FIXED — the data half.
 *
 * The owner's rule is the EXACT same implementation as theirs, and an audit of all 219 settles found 18
 * places where we quietly did something else. These are the ones a data row fixes; the rest are engine
 * or registry changes made in src/.
 *
 * Every value here was checked against the PRINTED text first, not copied from their dump (which is
 * GPL-3.0 and is a differ only). Where their encoding and the printed text disagree, the case goes to
 * work/owner-questions.json instead of being decided here.
 *
 *   node scripts/backfill-parity-fixes.mjs           # report
 *   node scripts/backfill-parity-fixes.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const ROWS = [
  /*
   * SPIRIT WARRIOR DEDICATION — two thirds of the fist clause was missing.
   *
   * Printed: *"The damage die for your fist CHANGES TO 1D6 instead of 1d4, and your fist GAINS THE
   * PARRY TRAIT. You don't take the normal −2 circumstance penalty when making a lethal attack…"*
   * Ours stripped `nonlethal` and did nothing else, so the fist stayed 1d4 with no parry. Their side
   * hands over a pre-modified fist that has both.
   *
   * Two riders because they have different scopes: the die and parry are the FIST's (`match: ['fist']`),
   * while the lethal-attack clause says *"your fist OR ANY OTHER UNARMED ATTACKS"* and stays unmatched.
   */
  {
    category: 'feats',
    id: 'spirit-warrior-dedication',
    field: 'unarmedTraits',
    value: [
      { match: ['fist'], setDie: 'd6', add: ['parry'] },
      { remove: ['nonlethal'] },
    ],
  },

  /*
   * ELEMENTAL WRATH — the grant pointed at a SUPERSEDED record.
   *
   * Printed: *"cast the Acid Splash cantrip as an innate primal spell"*, retyped to the chosen energy.
   * Our `acid-splash` is stamped edition 'superseded' — the legacy printing, a single-target spell
   * attack with splash and persistent damage. The current spell is Caustic Blast: a 5-foot burst at 30
   * feet with a basic Reflex save. A player casting from this feat was getting the wrong spell entirely,
   * and the app's own edition policy is that a superseded record is not what a character receives.
   *
   * ⚠ BOTH CARRIERS, TOGETHER. The record holds a flat `innateSpells` AND a four-option `effectChoices`
   * (one per energy type), and both pointed at the same id — so the innate list deduped to one spell.
   * Repointing only one leaves two DIFFERENT ids and grants the player two cantrips; I did exactly that
   * for one run when this script failed to parse halfway through. The four options keep their
   * `heightenHalfLevel`, which the flat grant does not carry.
   */
  { category: 'feats', id: 'elemental-wrath', field: 'innateSpells', value: [{ spellId: 'caustic-blast', atWill: true, tradition: 'primal' }] },
  {
    category: 'feats',
    id: 'elemental-wrath',
    field: 'effectChoices',
    value: [
      {
        id: 'element',
        /* The prompt named the legacy spell too — a player reading it was told they cast Acid Splash. */
        prompt: 'Choose the damage type for Elemental Wrath (casts Caustic Blast retyped to this type, at will)',
        options: ['acid', 'cold', 'electricity', 'fire'].map((v) => ({
          value: v,
          label: v.charAt(0).toUpperCase() + v.slice(1),
          grant: { innateSpells: [{ spellId: 'caustic-blast', tradition: 'primal', atWill: true, heightenHalfLevel: true }] },
        })),
      },
    ],
  },
  /*

  /*
   * ZOMBIE DEDICATION — the survival clause the other five undead dedications carry.
   *
   * Their side hands the whole shared undead-benefits package, which states it; ours delivers the five
   * mechanical clauses and never shows the player the one that decides what happens at 0 HP.
   */
  /*
   * DRACONIC RESISTANCE — the record's star described a clause the feat does not print.
   *
   * It carried *"+1 status to AC against attacks from dragons, while the relic aspect is active"* —
   * an AC bonus, a relic condition, neither of which appears anywhere in this feat's text. The clause
   * it should carry is *"DOUBLE this resistance against damage of that type dealt to you by dragons"*.
   * Both the record and the registry held the wrong one; both now hold the right one.
   */
  {
    category: 'feats',
    id: 'draconic-resistance',
    field: 'situational',
    value: [
      { targets: [{ kind: 'hp' }], when: "against damage of your exemplar's type dealt by a DRAGON", bonus: 'double your resistance' },
    ],
  },

  /*
   * SVETOCHER — a conditional relief modelled as a permanent bonus.
   *
   * Printed: *"WHEN YOU HAVE THE DRAINED CONDITION, calculate the penalty to your Fortitude saves and
   * your Hit Point reduction as though the condition value were 1 lower."* Ours shipped
   * `maxHpBonus: { perLevel: 1 }` — an unconditional +1 HP per level — so a svetocher who had never
   * been drained carried extra Hit Points at every level, and the Fortitude half was absent entirely.
   *
   * The relief now rides `drainedReduction`, read by `effectiveDrainedValue` (HP) and
   * `conditionsWithDrainedReduction` (the Fortitude save) in conditions.ts.
   */
  { category: 'feats', id: 'svetocher', field: 'maxHpBonus', value: null },
  { category: 'feats', id: 'svetocher', field: 'drainedReduction', value: 1 },

  /*
   * PUNCTURING HORN — a conditional upgrade applied to everyone.
   *
   * Printed: *"You gain a horn unarmed attack that deals 1D6 piercing damage… **Special** If you have
   * the XYLOSHI HERITAGE, your horn instead deals 1D8."* Ours carried the d8 rider on the FEAT, so
   * every kashrishi who took it got the xyloshi upgrade regardless of heritage.
   *
   * The rider moves to the heritage, which is the thing the sentence conditions on. `fromRecord` keeps
   * it aimed at the horn this feat granted rather than any strike that happens to be named "horn".
   */
  { category: 'feats', id: 'puncturing-horn', field: 'unarmedTraits', value: null },
  {
    category: 'heritages',
    id: 'xyloshi',
    field: 'unarmedTraits',
    value: [{ match: ['horn'], fromRecord: 'puncturing-horn', setDie: 'd8' }],
  },

  /*
   * TWO LANES FOR ONE "IF ALREADY TRAINED" CLAUSE — the skill twin of the double-pick defect.
   *
   * Both records print the standard replacement clause: *"You gain the trained proficiency rank in
   * Survival. IF YOU WOULD AUTOMATICALLY BECOME TRAINED IN SURVIVAL… you become trained in another
   * skill of your choice."* Ours modelled it TWICE — `redundantFallback: true` on the registry entry,
   * which fires only when the grant is actually redundant, AND a standing `effectChoices` picker that
   * trains a second skill unconditionally. A character who was NOT already trained got the printed
   * skill plus a free extra one.
   *
   * The registry lane is the correct one: it is conditional, which is what the sentence says. The
   * record's picker is removed.
   */
  { category: 'feats', id: 'gemsoul', field: 'effectChoices', value: null },
  { category: 'feats', id: 'warren-navigator', field: 'effectChoices', value: null },

  /*
   * COLUGO'S TRAVERSAL — the heightening was dropped.
   *
   * Printed: *"You can cast your choice of Gentle Landing or Jump as a primal innate spell once per
   * day. AT 9TH LEVEL, THESE SPELLS ARE HEIGHTENED TO 3RD RANK."* The pick lived in
   * `FEAT_CANTRIP_GRANTS`, whose own header says exact feat heightening is not modelled — it pushes a
   * bare {spellId, tradition} — so the spell was cast at rank 1 from 5th to 20th and the second
   * sentence reached nothing.
   *
   * Moved to the record's own `effectChoices`, which carries a full grant including `heightenAt`. That
   * is the same migration the four double-pick records just made, and the registry entry is removed in
   * featCantripGrants.ts so the two lanes cannot both fire.
   */
  {
    category: 'feats',
    id: 'colugos-traversal',
    field: 'effectChoices',
    value: [
      {
        id: 'colugos-traversal-spell',
        prompt: 'Choose Gentle Landing or Jump (primal innate, 1/day; 3rd rank from 9th level)',
        options: [
          { value: 'gentle-landing', label: 'Gentle Landing', grant: { innateSpells: [{ spellId: 'gentle-landing', tradition: 'primal', rank: 1, usesPerDay: 1, heightenAt: [{ level: 9, rank: 3 }] }] } },
          { value: 'jump', label: 'Jump', grant: { innateSpells: [{ spellId: 'jump', tradition: 'primal', rank: 1, usesPerDay: 1, heightenAt: [{ level: 9, rank: 3 }] }] } },
        ],
      },
    ],
  },

  /*
   * GHOSTLY RESISTANCE — nothing at all below 4th level, and the non-magical half missing.
   *
   * Printed: *"You gain RESISTANCE 1 to all damage except force, vitality, and any damage done by a
   * weapon with the ghost touch rune… This resistance INCREASES TO 2 IF THE SOURCE IS NON-MAGICAL. At
   * 10th level, the resistance increases to 2, or 4 if the source is non-magical. At 16th level, 3, or
   * 5 if non-magical."*
   *
   * Ours shipped `floor((@actor.level+2)/6)`, which is 0 at levels 1–3 — a feat delivering nothing for
   * its first three levels — and carried no non-magical entry at all, so half the printed values were
   * absent at every level. `max(1, floor((level+2)/6))` was checked against all twenty levels and
   * reproduces the printed 1 / 2 / 3 bands exactly; the non-magical row is its printed 2 / 4 / 5.
   *
   * ⚠ THE TWO TYPES MUST DIFFER. derive's aggregator is TYPE-KEYED highest-wins
   * (`res.set(r.type, Math.max(...))`), so two entries both typed 'all-damage' COLLAPSE to the bigger
   * number — the sheet promised resistance 2/4/5 to ALL damage where print gives 1/2/3, exactly the
   * over-grant apply-defense-lane.mjs's EXCEPTION_UNMODELLABLE note predicted. The exception clauses
   * therefore fold into the TYPE string (the modes/vengeful-remnant and items/silhouette-cloak
   * shape), giving two map keys, two listed bands, and no collapsed maximum.
   */
  {
    category: 'feats',
    id: 'ghostly-resistance',
    field: 'resistances',
    value: [
      {
        type: 'all damage except force, ghost touch, and vitality',
        value: 'max(1,floor((@actor.level+2)/6))',
      },
      {
        type: 'non-magical damage (except force, ghost touch, and vitality)',
        /* ⚠ NOT a clean doubling. The printed non-magical values are 2 / 4 / 5 — the last band is
         * +2 over the base, not ×2 — so a bare doubling hands out 6 at 16th. Checked at all twenty
         * levels rather than at the two the text happens to name. */
        value: 'min(5,max(2,floor((@actor.level+2)/6)*2))',
      },
    ],
  },

  /*
   * FIREWORK TECHNICIAN DEDICATION — the wrong subsystem entirely.
   *
   * Printed: *"You gain the [Quick Alchemy benefits], creating up to 4 PYROTECHNIC VERSATILE VIALS
   * during your daily preparations… You can use pyrotechnic versatile vials only to throw as bombs,
   * for the Launch Fireworks action or with QUICK ALCHEMY to create fireworks consumables."*
   *
   * Ours granted `advancedAlchemy: { items: 4 }` — a prepared-item allowance the feat never mentions —
   * and no Quick Alchemy and no vial counter, so Launch Fireworks had nothing to spend. The vial
   * resource is authored in src/rules/classResources.ts beside the other three flat-four archetypes;
   * these two rows are the record's half: drop the wrong subsystem, grant the action.
   */
  { category: 'feats', id: 'firework-technician-dedication', field: 'advancedAlchemy', value: null },
  { category: 'feats', id: 'firework-technician-dedication', field: 'grantsActions', value: ['launch-fireworks', 'quick-alchemy'] },

  {
    category: 'feats',
    id: 'zombie-dedication',
    field: 'note',
    value: 'Negative Survival: at 0 Hit Points you are knocked out and start dying, as a living creature — you are not destroyed.',
  },
];

for (const r of ROWS) {
  if (!core[r.category]?.[r.id]) { console.error(`${r.category}/${r.id} is not in core.json`); process.exit(2); }
}
/* The repointed spell must exist and must not itself be superseded — the defect being fixed. */
const cb = core.spells?.['caustic-blast'];
if (!cb) { console.error('caustic-blast is not in core.spells'); process.exit(2); }
if (cb.edition === 'superseded') { console.error('caustic-blast is itself superseded — repointing there would repeat the defect'); process.exit(2); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
console.log(`${ROWS.length} row(s): ${added} new, ${replaced} replaced.`);
for (const r of ROWS) console.log(`  ${r.category}/${r.id}.${r.field}`);
if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }
writeBackfill(ROOT, rows);
console.log(`\nwrote ${rows.length} rows.`);
