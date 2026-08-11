/*
 * Apply the owner's round-3 corrections to the gold set.
 *
 * Five entries were challenged. The owner ruled on each: four fixes accepted, and the challenge on
 * #11 REJECTED — which is the more interesting outcome, because it establishes a principle the
 * challenge pass did not know.
 *
 * Deterministic and re-runnable: each edit targets one requirement by index and asserts the row is
 * where it is expected, so a later regeneration of the key cannot silently mis-apply them.
 *
 *   node scripts/gold-apply-corrections.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = join(root, 'scripts/audit/gold-set.json');
const key = JSON.parse(readFileSync(P, 'utf8'));

const CORRECTIONS = [
  {
    num: 11, index: 3, expectLane: '',
    verdict: 'CHALLENGE REJECTED by the owner',
    lane: '',
    what:
      'No surface at all — no mode, no star, no modifier. OWNER RULING (round 3): an effect that fires on a ' +
      'critical success needs no implementation unless the effect is COMPLICATED; a complicated one gets a mode ' +
      'the player applies. Temporary Hit Points alone are not complicated. This overrides the challenge pass, ' +
      'which argued from Q1 that one minute earns a display-only mode — Q1 governs DURATION, and this ruling ' +
      'governs the crit-trigger shape, which comes first.',
  },
  {
    num: 12, index: 0, expectLane: 'speed',
    verdict: 'fix accepted',
    lane: 'speed',
    what:
      'A fly Speed present permanently on the sheet, WITH a `*` carrying the feat details. Q7 stars a movement ' +
      'type whose VALUE is a formula off your own Speed rather than a printed number, and Fly grants "equal to ' +
      'its Speed or 20 feet, whichever is greater" — the same shape as Wyrmling Flight\'s "equal to your Speed". ' +
      '⚠ VERIFIED BUG: core.json hardcodes speeds:{fly:40}, wrong for every character whose Speed is not 40. ' +
      'It must resolve max(@actor.speed.land, 20), which resolveFormula (derive.ts:3217) already supports.',
  },
  {
    num: 27, index: 14, expectLane: '',
    verdict: 'fix accepted',
    lane: 'negativeHealing',
    what:
      'The polarity half of Negative Healing — void effects that heal undead restore your Hit Points, vitality ' +
      'damage harms you, vitality healing does not help you. THE LANE ALREADY EXISTS: set negativeHealing:true on ' +
      'the record; derive.ts:1771 reads it from feats and it renders as "Void healing — healed by void, harmed by ' +
      'vitality" on the Defenses card (VitalsRail.tsx:746) and in DefensesPills. ⚠ No feat carries this field ' +
      'today — only the dhampir heritage and four items — so any feat granting it is currently silent.',
  },
  {
    num: 29, index: 0, expectLane: 'skillTrained',
    verdict: 'fix accepted — a FALSE gap removed',
    lane: 'skillTrained',
    what:
      'Trained proficiency rank in Thievery, folded into the Thievery modifier. ALREADY BUILT — featGrantsAuto.ts:23 ' +
      "carries skills:{thievery:'trained'}, applied through featGrants.ts:320 → build.ts:3081. The earlier " +
      '"⚠ VERIFIED GAP" annotation was false and is struck; nothing to build.',
  },
  {
    num: 29, index: 1, expectLane: 'redundantFallback',
    verdict: 'fix accepted — a FALSE gap removed',
    lane: 'redundantFallback',
    what:
      'When already trained in Thievery the grant must not be wasted: trained in another skill of the player\'s ' +
      'choice instead. ALREADY BUILT — redundantFallback:true on the same featGrantsAuto.ts:23 entry; build.ts:3089 ' +
      'records the fallback and applies the pick.',
  },
  {
    num: 42, index: 3, expectLane: '',
    verdict: 'fix accepted, and the owner confirmed the reasoning',
    lane: 'dailyChoice',
    what:
      'Each formula this feat writes into the book is, for this character, an ALCHEMICAL CONSUMABLE WITH THE ELIXIR ' +
      'TRAIT — and therefore CRAFTABLE. OWNER RULING (round 3): "yes, because You gain formulas to create these ' +
      'potions as alchemical consumables and you can craft alchemical consumables." So the chosen potions join the ' +
      'Advanced Alchemy prepare list and the Quick Alchemy picker. This is pool membership, not an inventory copy: ' +
      'the formula book stores references, never items.',
  },
];

let applied = 0;
for (const c of CORRECTIONS) {
  const row = key.rows.find((r) => r.num === c.num);
  if (!row) throw new Error(`feat #${c.num} not found`);
  const req = row.requirements[c.index];
  if (!req) throw new Error(`#${c.num} has no requirement at index ${c.index}`);
  if ((req.lane ?? '') !== c.expectLane) {
    throw new Error(`#${c.num}.${c.index + 1} expected lane "${c.expectLane}" but found "${req.lane}" — the key moved, re-check before applying`);
  }
  req.lane = c.lane;
  req.what = c.what;
  req.ownerCorrection = c.verdict;
  applied++;
  console.log(`  #${c.num}.${c.index + 1}  ${c.verdict}`);
}

/* The challenge on #11 was rejected, so its defect banner must not survive into the document. */
const eleven = key.rows.find((r) => r.num === 11);
eleven.defect = null;
eleven.fix = null;
eleven.challengeRejected = 'Owner ruled the challenge wrong: a crit-triggered rider needs no surface unless the effect is complicated.';

key.status = 'COMPLETE — owner-signed. 10 answered directly, 33 derived from 14 decisions, 5 challenged and ruled on (4 fixes accepted, 1 challenge rejected).';
key.correctionsApplied = applied;
writeFileSync(P, JSON.stringify(key, null, 1));

const total = key.rows.reduce((n, r) => n + r.requirements.length, 0);
const noLane = key.rows.flatMap((r) => r.requirements).filter((q) => !q.lane).length;
console.log(`\n${applied} corrections applied`);
console.log(`requirements ${total}, of which ${noLane} carry no lane (mostly "nothing required", not gaps)`);
