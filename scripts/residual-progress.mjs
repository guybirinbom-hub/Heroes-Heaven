/*
 * HOW MUCH OF THE BATCHES 1–12 RESIDUAL READ IS STILL OWED.
 *
 * 1,201 records were read against their printed text and 262 findings survived an adversarial
 * refutation pass. Gate 7 will not pass a batch whose findings are still open, so this is the work list
 * between here and twelve closed batches — and a list of 262 items in a JSON file is not a work list
 * anyone can act on. This counts what is left, grouped by the LANE the fix belongs in, because a defect
 * that appears once appears fifty times and fixing by class is the only way to know a class is done.
 *
 * "Fixed" is judged from the DATA, not from a checkbox: a finding counts as closed when the record now
 * carries something in the lane the finding named. That is deliberately weaker than "the fix is right"
 * — the tests and guards are what say that — but it cannot be satisfied by editing a status field.
 *
 *   node scripts/residual-progress.mjs
 *   node scripts/residual-progress.mjs --lane situational   # list what is left in one lane
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));

const src = 'work/residual-1-12.json';
if (!existsSync(join(ROOT, src))) { console.log(`residual-progress: SKIPPED — no ${src}`); process.exit(0); }
const findings = read(src).confirmed ?? [];
const core = read('public/core.json');

/* Registries a fix may land in, read as text — used only to LABEL a lane, never to judge closure. */
const REGISTRY_TEXT = ['src/rules/situationalBonuses.ts', 'src/rules/featGrants.ts', 'src/rules/featGrantsAuto.ts', 'src/rules/featFeatGrants.ts', 'src/rules/modes.ts']
  .map((f) => { try { return readFileSync(join(ROOT, f), 'utf8'); } catch { return ''; } })
  .join('\n');

/*
 * THE LEDGER — record ids whose finding has actually been fixed, written down when the fix is made.
 * `work/residual-fixed.json` is a plain array of ids. Adding an id here is a claim, and the tests and
 * guards are what check it; the point is that the claim is EXPLICIT rather than guessed from the shape
 * of the data, which cannot distinguish "this record was fixed" from "this record already had a note".
 */
const LEDGER = 'work/residual-fixed.json';
const fixed = new Set(existsSync(join(ROOT, LEDGER)) ? read(LEDGER) : []);

/** Which lane a finding's fix belongs in, and how to tell whether it landed. */
const LANES = [
  ['skillSubstitutions', /skillSubstitution/i, (r) => !!r?.skillSubstitutions || !!r?.skillAbilitySwap],
  ['heldSpells rank', /heldSpells/i, () => true /* whole class closed and guarded */],
  ['situational', /situational|circumstance bonus|status bonus/i, (r, id) => new RegExp(`['"]${id}['"]`).test(REGISTRY_TEXT)],
  ['grantsFeats', /grantsFeats/i, (r) => !!r?.grantsFeats],
  ['grantsActions', /grantsActions/i, (r) => !!r?.grantsActions],
  ['innate spell', /innateSpells/i, (r) => !!r?.innateSpells || !!r?.effectChoices],
  ['resistance/IWR', /resistances|weakness|immunit/i, (r) => !!r?.resistances || !!r?.weaknesses || !!r?.immunities || !!r?.removesWeaknesses],
  ['speed', /speeds?\b|landSpeed/i, (r) => !!r?.speeds || !!r?.speedsIf || !!r?.landSpeedBonus || !!r?.speedAdjust],
  ['modes', /\bmodes?\b/i, (r, id) => new RegExp(`['"]${id}['"]`).test(REGISTRY_TEXT)],
  ['note', /\bnote\b/i, (r) => !!r?.note],
];

const laneOf = (f) => {
  const t = `${f.missing ?? ''} ${f.whereToModel ?? ''}`;
  return LANES.find(([, re]) => re.test(t)) ?? null;
};

const only = arg('--lane', null);
const open = [];
const done = [];
const unclassified = [];
for (const f of findings) {
  const lane = laneOf(f);
  if (!lane) { unclassified.push(f); continue; }
  /*
   * ⚠ CLOSURE IS A LEDGER, NOT AN INFERENCE. Two attempts to read it off the data both failed, in
   * opposite directions: testing the lane the finding's prose was classified into reported real fixes
   * as open (a clause routed to "situational" often lands correctly as a note or a data field), and
   * testing EVERY lane reported 0 open on a corpus with dozens of untouched findings, because almost
   * every record already carries something somewhere. A number that can be wrong by 60 in either
   * direction is not a work list. So a finding is closed when it is written down as closed.
   */
  (fixed.has(f.id) ? done : open).push({ ...f, lane: lane[0] });
}

if (only) {
  const rows = open.filter((f) => f.lane === only);
  console.log(`${rows.length} open in "${only}":\n`);
  for (const r of rows) console.log(`  ${(r.bucket + '/' + r.id).padEnd(40)} ${String(r.printed).replace(/\s+/g, ' ').slice(0, 110)}`);
  process.exit(0);
}

const tally = new Map();
for (const f of open) tally.set(f.lane, (tally.get(f.lane) ?? 0) + 1);
console.log(`${findings.length} confirmed finding(s) from the batches 1–12 residual read.`);
console.log(`  closed : ${done.length}`);
console.log(`  OPEN   : ${open.length}`);
console.log(`  unclassified (need a lane decided) : ${unclassified.length}\n`);
for (const [lane, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${lane}`);
console.log(`\n  --lane <name> lists one lane. Gate 7 holds batches 1–12 open until every finding is closed.`);
