/*
 * MEASURE: every record carrying a bare `choice` that a second lane already asks.
 *
 * Generalises measure-choice-vs-slot.mjs, which only recognised a duplicate when EVERY option value
 * was a skill key. That found 12 records — and the batches 5–16 read then named several more of the
 * same shape whose option values are not skill names: dandy-dedication (flag `deceptionRank`, options
 * that are ranks), war-mage-dedication (`warMageLore`, kind 'skills' with no explicit options),
 * marshal-dedication (four options, two with duplicate labels and one with a typo'd value),
 * guerrilla-dedication, occult-evolution, know-the-beat. A predicate keyed on the option VALUES could
 * never see those; the thing they share is the SECOND LANE, not the option type.
 *
 * So this asks the structural question instead: does the record carry a bare `choice` (no option
 * carries a grant, so it grants nothing by itself) while another lane on the same record already
 * grants something?
 *
 * ⚠⚠ THIS OVER-REPORTS, BADLY, AND IT CANNOT BE MADE PRECISE. It returns ~55 records and most are
 * PERFECTLY CORRECT. `sorcerer-dedication` carries a bloodline choice (18 options) beside a skill
 * lane; `druid-dedication` an order; `oracle-dedication` a mystery; `bard-dedication` a muse. Each is
 * a bare choice next to another lane, and each asks a COMPLETELY DIFFERENT QUESTION from that lane —
 * they are subclass picks, not duplicate skill prompts.
 *
 * What separates a real duplicate from those is SEMANTIC: does the choice ask the same question the
 * other lane already asks? Structure cannot answer that. measure-choice-vs-slot.mjs stays narrow
 * (every option value is a skill key) precisely because within that narrow set the answer is knowable,
 * and it is the one that is safe to act on.
 *
 * Treat the output as READING MATERIAL for a human or an agent going record by record — never as a
 * work list, and never as the basis for a sweep. `choice.flag` also has at least six readers, and a
 * grant table can key on `choice.value` without naming the flag anywhere near the record:
 * CHOICE_FEAT_GRANTS reads molten-wit's answer to pick which SKILL FEAT to grant, which no structural
 * scan can see. Any candidate must be proven inert empirically — build the character twice with
 * different answers and compare the MECHANICAL outputs, not the whole character, which echoes the
 * answer back — before its `choice` is touched.
 *
 *   node scripts/measure-inert-choice.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');

const grantSrc = ['featGrantsAuto.ts', 'featGrants.ts', 'featGrantsLane.ts']
  .map((f) => { try { return readFileSync(join(ROOT, 'src/rules', f), 'utf8'); } catch { return ''; } })
  .join('\n');

/* Each registry entry's block runs to the next top-level id — an entry spans many lines. */
const grantBlocks = new Map();
{
  let cur = null;
  let buf = [];
  for (const line of grantSrc.split(/\r?\n/)) {
    const m = /^\s{2}'([a-z0-9-]+)':\s*\{/.exec(line);
    if (m) { if (cur) grantBlocks.set(cur, buf.join('\n')); cur = m[1]; buf = [line]; continue; }
    if (cur) buf.push(line);
  }
  if (cur) grantBlocks.set(cur, buf.join('\n'));
}

/* Records whose own choice.value IS read by a grant table — the correct shape, never a candidate. */
const featFeat = (() => { try { return readFileSync(join(ROOT, 'src/rules/featFeatGrants.ts'), 'utf8'); } catch { return ''; } })();
const choiceKeyed = new Set();
{
  const at = featFeat.indexOf('CHOICE_FEAT_GRANTS');
  if (at >= 0) {
    const body = featFeat.slice(at, featFeat.indexOf('\n};', at));
    for (const m of body.matchAll(/^\s{2}'([a-z0-9-]+)':/gm)) choiceKeyed.add(m[1]);
  }
}

/*
 * Does anything in src/rules mention this flag?
 *
 * ⚠ USELESS FOR GENERIC FLAG NAMES, and the split below shows it: guerrilla-dedication (`skill`),
 * marshal-dedication (`choice`) and linguist-dedication (`rank`) land in the "flag IS named" column
 * only because those words appear all over the rules for unrelated reasons — and all three are real
 * duplicates. The signal is meaningful only for a distinctive flag; for a common word it says nothing
 * in either direction. Kept because it usefully ranks the DISTINCTIVE flags, not because a hit or a
 * miss decides anything.
 */
const allSrc = ['build.ts', 'derive.ts', 'featGrants.ts', 'featGrantsAuto.ts', 'featGrantsLane.ts', 'featFeatGrants.ts', 'situationalBonuses.ts', 'casterArchetypes.ts', 'featPickGrants.ts', 'featCantripGrants.ts']
  .map((f) => { try { return readFileSync(join(ROOT, 'src/rules', f), 'utf8'); } catch { return ''; } })
  .join('\n');

const LANE_KEYS = ['skillChoices', 'loreChoices', 'redundantFallback', 'conditionalSkills', 'skills', 'choiceGrants'];

const rows = [];
for (const bucket of ['feats', 'heritages', 'classFeatures', 'backgrounds']) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    const ch = rec?.choice;
    if (!ch) continue;
    if ((ch.options ?? []).some((o) => o?.grant)) continue; // options with grants ARE the working lane
    if (choiceKeyed.has(id)) continue;                      // CHOICE_FEAT_GRANTS reads this answer

    const block = grantBlocks.get(id) ?? '';
    const hasChoiceGrants = /choiceGrants\s*:/.test(block);
    if (hasChoiceGrants) continue;                          // choiceGrantFor reads this answer

    const lanes = [];
    for (const k of LANE_KEYS) if (new RegExp(`${k}\\s*:`).test(block)) lanes.push(`FEAT_GRANTS.${k}`);
    if ((rec.effectChoices ?? []).length) lanes.push(`effectChoices[${rec.effectChoices.length}]`);
    if (!lanes.length) continue;                            // no second lane — not a duplicate

    const flag = String(ch.flag ?? '');
    const flagNamed = flag ? new RegExp(`['"\`]${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(allSrc) : false;
    rows.push({ bucket, id, flag, options: (ch.options ?? []).length, kind: ch.kind ?? '?', lanes: lanes.join(' + '), flagNamed });
  }
}

rows.sort((a, b) => Number(a.flagNamed) - Number(b.flagNamed) || a.id.localeCompare(b.id));
const unnamed = rows.filter((r) => !r.flagNamed);
const named = rows.filter((r) => r.flagNamed);

console.log(`${rows.length} record(s) carry a bare \`choice\` alongside another lane.`);
console.log('⚠ MOST OF THESE ARE CORRECT. A subclass pick (bloodline, order, mystery, muse, instinct)');
console.log('  legitimately sits beside a skill lane — it asks a DIFFERENT question. Only a choice that');
console.log('  asks the SAME question as the other lane is a duplicate, and that is a semantic call.\n');
console.log(`${unnamed.length} whose flag is named NOWHERE in src/rules — read these first:\n`);
for (const r of unnamed) console.log(`   ${r.bucket}/${r.id.padEnd(34)} flag=${r.flag.padEnd(24)} ${r.options} opt  lanes: ${r.lanes}`);
console.log(`\n${named.length} whose flag IS named in src/rules — but a GENERIC flag name ('skill', 'choice',`);
console.log("  'rank') matches for unrelated reasons, so this column proves nothing on its own:\n");
for (const r of named) console.log(`   ${r.bucket}/${r.id.padEnd(34)} flag=${r.flag.padEnd(24)} ${r.options} opt  lanes: ${r.lanes}`);
console.log('\n⚠ Reading material, not a work list. Before removing ANY of these: confirm the choice asks');
console.log('  the same question as the other lane, check CHOICE_FEAT_GRANTS/choiceGrants for a table');
console.log('  keyed on its value, then prove it inert by building the character with two different');
console.log('  answers and comparing MECHANICAL outputs (the whole character echoes the answer back).');
