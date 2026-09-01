/*
 * THE NESTED-ACTIVATE DEFECT: a feat wearing the action cost of an activity it merely GRANTS.
 *
 * AoN states a feat's own cost in its `<title>` glyph, and an EMPTY `<actions string="" />` there is
 * how the Archives say "passive". Some pages then describe a granted activity inline, with its own
 * glyph bound to a NAMED line: `**Activate—Host of Wrath** <actions string="Two Actions" />`.
 * `grantedCost()` in scripts/lib/aon-facets.mjs read ANY inline body glyph, so it copied the granted
 * activity's cost onto the feat.
 *
 * The tell is unmistakable on the six mythic Avenger feats (Revenge of the Runelords, Feat 14): five
 * store 2 actions and the sixth — Avenger of Lust — stores a REACTION, exactly matching its nested
 * "Sorshen's Devotion @Reaction" while the others match their nested "Two Actions". No feat body says
 * anything of the kind; all six are pure grant language.
 *
 * MEASURED across the whole feat archive: 17 pages have an empty title glyph AND a named
 * `**Activate—X**` glyph; 13 of them had that glyph copied onto the Heroes Heaven record. They split
 * cleanly, and the split is why "always passive" would be wrong:
 *
 *   · 6 where the granted activity SHIPS as its own action record — the four unflagged Avengers plus
 *     Spirit Warrior and Starlit Sentinel Dedication. The feat is passive and the player still finds
 *     the activity, exactly as Rage and Spellstrike already work. FIXED HERE.
 *   · 7 where it does NOT ship — Tengu Feather Fan, the three Dreaming Heirloom feats, the two Razmiri
 *     masks, and Living God. For these the cost on the feat is a player's ONLY route to the activity,
 *     so it is correct and is PINNED here, or the extractor fix below would silently delete it.
 *
 * Two further defects surfaced while checking that the granted activities really do ship:
 *   · avenger-of-wrath granted only `reactive-strike`. Its text grants two things — *"You gain the
 *     Reactive Strike reaction… You gain the Host of Wrath activity"* — and Host of Wrath ships.
 *   · avenger-of-lust and starlit-sentinel-dedication granted NOTHING, while the activity each one
 *     hands you ships as its own record. Making them passive without this would have orphaned it.
 *   · actions/sorshens-devotion stored 2 actions. AoN: `<actions string="Reaction" />`.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PASSIVE = { type: 'passive' };
const actions = (n) => ({ type: 'actions', value: n });

const edits = [
  /* ---- the four unflagged Avengers: the feat is passive, the granted activity carries the cost --- */
  { category: 'feats', id: 'avenger-of-envy', field: 'actionCost', value: PASSIVE },
  { category: 'feats', id: 'avenger-of-gluttony', field: 'actionCost', value: PASSIVE },
  { category: 'feats', id: 'avenger-of-greed', field: 'actionCost', value: PASSIVE },
  { category: 'feats', id: 'avenger-of-sloth', field: 'actionCost', value: PASSIVE },

  /* ---- the same defect outside the Avenger family ---------------------------------------------- */
  { category: 'feats', id: 'spirit-warrior-dedication', field: 'actionCost', value: PASSIVE },
  { category: 'feats', id: 'starlit-sentinel-dedication', field: 'actionCost', value: PASSIVE },

  /* ---- the grants that were missing, without which "passive" orphans the activity --------------- */
  /* *"You gain the Reactive Strike reaction… You gain the Host of Wrath activity."* Two grants, one
   * recorded. Reactive Strike stays: it is granted as BOTH a feat and an action on this record. */
  { category: 'feats', id: 'avenger-of-wrath', field: 'grantsActions', value: ['reactive-strike', 'host-of-wrath'] },
  /* *"You gain the Sorshen's Devotion reaction."* */
  { category: 'feats', id: 'avenger-of-lust', field: 'grantsActions', value: ['sorshens-devotion'] },
  /* *"You, and only you, can transform into your sentinel form by Activating the seal."* */
  { category: 'feats', id: 'starlit-sentinel-dedication', field: 'grantsActions', value: ['starlit-transformation'] },

  /* ---- and the granted action whose own cost was wrong ------------------------------------------ */
  { category: 'actions', id: 'sorshens-devotion', field: 'actionCost', value: { type: 'reaction' } },

  /*
   * ---- PINNED: the seven whose granted activity has no record of its own ------------------------
   * Each of these stores the nested activity's cost, and that is CORRECT here — there is nowhere else
   * for it to live, so a player would lose the ability entirely if the feat went passive. Pinned in
   * the overlay because the extractor fix in scripts/lib/aon-facets.mjs now refuses to read a named
   * `**Activate—X**` glyph, which is right by default and wrong for exactly these seven.
   */
  { category: 'feats', id: 'tengu-feather-fan', field: 'actionCost', value: actions(1) },
  { category: 'feats', id: 'inherit-the-dreaming-heirloom', field: 'actionCost', value: actions(1) },
  { category: 'feats', id: 'rouse-the-dreaming-relic', field: 'actionCost', value: { type: 'free' } },
  { category: 'feats', id: 'sever-the-dreaming-shadow', field: 'actionCost', value: actions(2) },
  { category: 'feats', id: 'mask-of-the-12th-step', field: 'actionCost', value: actions(2) },
  { category: 'feats', id: 'mask-of-the-15th-step', field: 'actionCost', value: actions(2) },
  { category: 'feats', id: 'living-god', field: 'actionCost', value: actions(3) },
];

const rows = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const e of edits) {
  const at = rows.findIndex((r) => r.category === e.category && r.id === e.id && r.field === e.field);
  if (at >= 0) { rows[at] = e; updated++; } else { rows.push(e); added++; }
}
writeBackfill(ROOT, rows);
console.log(`${edits.length} edit(s): ${added} added, ${updated} updated in place (${rows.length} rows).`);
