/*
 * THE ENHANCEMENT TIER, MEASURED — a benefit a record prints but only HAS while another names it.
 *
 *   node scripts/scan-enhancements.mjs           # the counts
 *   node scripts/scan-enhancements.mjs --list    # every id in every bucket
 *
 * The audit named four records. The clause has a SHAPE, so the rest is a scan.
 *
 * ⚠ ANCHORED ON THE OUTCOME, NOT ON THE CONDITION — the lesson that has cost this project the most.
 * A detector for the CONDITION ("enhancement", "enhanced", "augment") matches 400+ records across the
 * corpus: alchemical enhancements, enhanced familiars, "an enhanced version of". The OUTCOME here is
 * a formatting fact that is also a mechanical one: the record prints a paragraph HEADED
 * `**Enhancement**`, which is how Paizo marks the automaton second tier and nothing else. That
 * matches 19 records, and all 19 are real — every one carries the `automaton` trait.
 *
 * SIX THINGS IT CHECKS, each of which is a way this lane fails silently:
 *   1. prints a tier and NOTHING models it and no option says so → the player has no way to know
 *   2. prints a tier but NO picker offers it → an unreachable benefit
 *   3. carries `enhancement` but prints no such paragraph → the app grants what the book does not
 *   4. an `enhancementPicker` option naming a record that prints no tier, or carrying no note
 *   5. `enhancement.choiceIds` naming an effectChoice the record does not have → gates nothing
 *   6. a gated choice with FEWER THAN TWO options → `resolvePick` auto-applies a one-option choice
 *      even when unanswered (build.ts, the `opts.length === 1` fallback), so the tier would be
 *      delivered unconditionally. This is the trap that made the whole lane necessary; it is checked
 *      here rather than remembered.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));

/** Descriptions live in a SECOND file; core.json's copy is a stale fallback where it exists at all. */
const textOf = (col, id) => String(desc[col]?.[id]?.d ?? core[col]?.[id]?.description ?? '');

/** The printed marker. `**Enhancement**` as a paragraph head — not the word "enhancement" in prose. */
const PRINTS_TIER = /\*\*Enhancement\*\*/;

/**
 * DELIBERATELY not offered, and not a defect. Written here with its reason rather than left to be
 * re-discovered as a finding, which is what an unexplained "1 TO DO" in this scan would become.
 */
export const EXEMPT = {
  // Lesser Augmentation is itself a 9th-level automaton ancestry feat, and RAW a level-17 automaton
  // could point Greater Augmentation at it: "You gain the enhancement benefits of ANOTHER 1st- or
  // 5th-level automaton ancestry feat." It is absent from Greater's option list as shipped, and
  // adding it would turn a single pass into a FIXED POINT — an enhanced Lesser opens a second picker
  // that enhances a third feat, which the engine's one-pass reader cannot express. 19 records print
  // an Enhancement; 18 are reachable; this is the one, on purpose.
  'feats/lesser-augmentation': 'recursive — enhancing it would open a second picker (see docs/mechanic-lanes.md, `enhancement`)',
};

/** EXPORTED so the guard test and any future applier use this detector rather than a copy of it. */
export function audit() {
  const collections = ['feats', 'classFeatures', 'heritages', 'ancestries', 'items', 'backgrounds'];

  /** Every record whose printed text carries an Enhancement paragraph. */
  const printing = [];
  /** Every record that hands the tier out, with the options it offers. */
  const pickers = [];
  for (const col of collections) {
    for (const [id, r] of Object.entries(core[col] ?? {})) {
      if (PRINTS_TIER.test(textOf(col, id))) printing.push({ col, id, rec: r });
      if (r.enhancementPicker) pickers.push({ col, id, rec: r });
    }
  }

  const printingIds = new Set(printing.map((p) => p.id));
  /** id -> the option that offers it, from any picker. */
  const offered = new Map();
  const badOption = [];
  const optionWithoutNote = [];
  for (const { col, id, rec } of pickers) {
    for (const cid of rec.enhancementPicker.choiceIds ?? []) {
      const ch = (rec.effectChoices ?? []).find((c) => c.id === cid);
      if (!ch) { badOption.push(`${col}/${id}: enhancementPicker names "${cid}", which is not one of its effectChoices`); continue; }
      for (const o of ch.options ?? []) {
        if (!core.feats[o.value]) { badOption.push(`${col}/${id} offers "${o.value}", which is not a feat`); continue; }
        if (!printingIds.has(o.value)) badOption.push(`${col}/${id} offers "${o.value}", whose text prints no Enhancement paragraph`);
        if (!o.note) optionWithoutNote.push(`${col}/${id} -> ${o.value}`);
        offered.set(o.value, `${id}`);
      }
    }
  }

  const computed = [];      // prints a tier AND the app models it
  const proseOnly = [];     // prints a tier, not modelled, but an option says so — the honest Q27 state
  const silent = [];        // prints a tier, not modelled, and nothing says so
  const unreachable = [];   // prints a tier and NO picker offers it
  const exempt = [];        // unreachable ON PURPOSE, with the reason in EXEMPT
  for (const { col, id, rec } of printing) {
    const key = `${col}/${id}`;
    if (EXEMPT[key]) { exempt.push(`${key} — ${EXEMPT[key]}`); continue; }
    const isOffered = offered.has(id);
    if (!isOffered) unreachable.push(key);
    if (rec.enhancement) computed.push(key);
    else if (isOffered) proseOnly.push(key);
    else silent.push(key);
  }

  /** Carries the field but prints no such paragraph — the app granting what the book does not. */
  const spurious = [];
  /** A gate that gates nothing, or one `resolvePick` would auto-apply. */
  const badGate = [];
  for (const col of collections) {
    for (const [id, r] of Object.entries(core[col] ?? {})) {
      if (!r.enhancement) continue;
      if (!PRINTS_TIER.test(textOf(col, id))) spurious.push(`${col}/${id}`);
      for (const cid of r.enhancement.choiceIds ?? []) {
        const ch = (r.effectChoices ?? []).find((c) => c.id === cid);
        if (!ch) { badGate.push(`${col}/${id}: enhancement.choiceIds names "${cid}", which is not one of its effectChoices`); continue; }
        if (!ch.spellFilter && (ch.options ?? []).length < 2)
          badGate.push(`${col}/${id}: gated choice "${cid}" has ${(ch.options ?? []).length} option(s) — resolvePick auto-applies a one-option choice even unanswered, so the tier would land for free`);
      }
    }
  }

  return { printing, pickers, computed, proseOnly, silent, unreachable, exempt, spurious, badOption, optionWithoutNote, badGate };
}

const a = audit();
const autoTrait = Object.values(core.feats).filter((f) => (f.traits ?? []).includes('automaton')).length;

console.log(`feats with the \`automaton\` trait      ${autoTrait}`);
console.log(`records printing an **Enhancement**   ${a.printing.length}`);
console.log(`  …computed by the app                ${a.computed.length}`);
console.log(`  …prose, and an option SAYS so       ${a.proseOnly.length}`);
console.log(`  …silent (not modelled, nothing says so) ${a.silent.length}   <- TO DO`);
console.log(`  …unreachable (no picker offers it)  ${a.unreachable.length}   <- TO DO`);
console.log(`  …exempt, with a stated reason       ${a.exempt.length}`);
console.log(`records handing the tier out          ${a.pickers.length}`);

const defects = [
  ['carry `enhancement` but print no such paragraph', a.spurious],
  ['picker options that do not resolve', a.badOption],
  ['picker options with no note', a.optionWithoutNote],
  ['gates that gate nothing, or that resolvePick would auto-apply', a.badGate],
];
let bad = 0;
for (const [label, list] of defects) {
  if (!list.length) continue;
  bad += list.length;
  console.log(`\n  ⚠ ${label}: ${list.length}`);
  for (const x of list) console.log(`     ${x}`);
}
if (!bad) console.log('\n  no defects');

if (LIST) {
  const show = (label, list) => { console.log(`\n${label} (${list.length}):`); for (const x of list) console.log('  ' + x); };
  show('computed', a.computed);
  show('prose, with a note', a.proseOnly);
  show('silent — TO DO', a.silent);
  show('unreachable', a.unreachable);
  show('exempt', a.exempt);
} else {
  console.log('\n--list for every id.');
}
