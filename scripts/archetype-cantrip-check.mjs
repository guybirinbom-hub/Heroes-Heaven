/*
 * GUARD: A CASTER ARCHETYPE MAY PREPARE THE NUMBER OF CANTRIPS ITS TEXT PRINTS.
 *
 * `CasterArchetype.cantrips` is the CAP on how many cantrips the player may select for the archetype
 * (Builder.tsx:386, `cantripCap`), and every selected one is castable. So it is the PREPARED-per-day
 * number, not the size of the spellbook.
 *
 * Four dedications had the spellbook number in it. Their texts read *"gaining a spellbook with FOUR
 * common arcane cantrips of your choice … You can PREPARE TWO cantrips each day from your spellbook"*
 * (Magus, Wizard), *"a dirge with four … prepare two"* (Necromancer) and *"a familiar with two common
 * cantrips … you can PREPARE ONE cantrip each day"* (Witch) — and we let the character cast all four,
 * or both. The batches 5–16 parity read found it on Witch and Magus; their side allows one and two.
 *
 * The check is self-evidencing and reads the record's own text: the sentence *"prepare N cantrip(s)
 * each day"* names the number, and the config must equal it. An archetype whose text does not print
 * that sentence is not judged — plenty grant their cantrips outright with no prepare step, and
 * guessing at those would be inventing a rule rather than checking one.
 *
 *   node scripts/archetype-cantrip-check.mjs           # guard
 *   node scripts/archetype-cantrip-check.mjs --list    # every archetype whose text names a number
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

/*
 * The table is read as SOURCE. Importing it would drag the whole rules graph in, and the numbers are
 * written two ways — `mk(tradition, key, N, …)` positionally, and `cantrips: N` in an object literal —
 * so both shapes are parsed. An entry matching neither is reported rather than skipped: an archetype
 * this cannot read is one the guard silently stops covering.
 */
const src = readFileSync(join(ROOT, 'src/rules/casterArchetypes.ts'), 'utf8');
const lines = src.split(/\r?\n/);
const config = new Map();
const unreadable = [];
{
  let cur = null;
  let buf = [];
  const flush = () => {
    if (!cur) return;
    const block = buf.join('\n');
    const mk = /\bmk\(\s*'[a-z]+'\s*,\s*'[a-z]+'\s*,\s*(\d+)/.exec(block);
    const lit = /\bcantrips\s*:\s*(\d+)/.exec(block);
    if (mk) config.set(cur, Number(mk[1]));
    else if (lit) config.set(cur, Number(lit[1]));
    else unreadable.push(cur);
    cur = null;
  };
  for (const line of lines) {
    const m = /^\s{2}'([a-z0-9-]+)':\s*(?:mk\(|\{)/.exec(line);
    if (m) { flush(); cur = m[1]; buf = [line]; continue; }
    if (cur) buf.push(line);
  }
  flush();
}

const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/*
 * ⚠ THE CLAUSE IS NOT ALWAYS ADJACENT, and this pattern needed widening TWICE — each time because the
 * report named what it could not read rather than staying silent:
 *
 *   · Hedge Mage — *"prepare two cantrips FROM YOUR KEEPSAKE each day"*. The source of the cantrips
 *     sits between the count and "each day", so a `cantrips each day` pattern missed it.
 *   · Cleric, Druid, Animist — *"prepare two COMMON cantrips each day"*. An adjective sits between the
 *     count and the noun.
 *
 * Both gaps are bounded and may not cross a full stop, so a count in one sentence still cannot pair
 * with a cadence in the next. Two records genuinely do not print a prepared count and stay unmatched,
 * correctly: Beast Gunner and Cathartic Mage grant a bonus cantrip *"in addition to your usual
 * cantrips per day"*, which is not a cap at all.
 */
const PREPARE = /\bprepare\s+(\d+|one|two|three|four|five|six)\s+(?:[a-z]+\s+){0,2}cantrips?\b[^.]{0,60}?\beach day\b/i;

const rows = [];
const unmatched = [];
for (const [id, have] of config) {
  const rec = core.feats?.[id] ?? core.classFeatures?.[id];
  const text = String(rec?.description ?? descs.feats?.[id]?.d ?? descs.classFeatures?.[id]?.d ?? '').replace(/\s+/g, ' ');
  const m = PREPARE.exec(text);
  if (!m) {
    /* Record whose text TALKS about preparing cantrips but that the pattern could not read. A silent
     * non-match is how the Hedge Mage gap survived; naming them makes the next phrasing visible. */
    if (/\bprepare\b[^.]{0,80}\bcantrip/i.test(text)) unmatched.push(id);
    continue;
  }
  const printed = WORD[m[1].toLowerCase()] ?? Number(m[1]);
  rows.push({ id, have, printed, sentence: m[0] });
}

if (LIST) {
  for (const r of rows) console.log(`${r.have === r.printed ? 'ok  ' : 'BAD '} ${r.id.padEnd(30)} config ${r.have}  printed ${r.printed}   "${r.sentence}"`);
  console.log(`\n${rows.length} archetype(s) whose text names a prepared-cantrip count; ${config.size} in the table.`);
  if (unreadable.length) console.log(`config entries whose number could not be parsed: ${unreadable.join(', ')}`);
  if (unmatched.length) console.log(`text mentions preparing cantrips but no count was read: ${unmatched.join(', ')}`);
  process.exit(0);
}

const bad = rows.filter((r) => r.have !== r.printed);
if (bad.length) {
  console.error(`archetype-cantrip-check: FAIL — ${bad.length} archetype(s) may prepare the wrong number of cantrips:\n`);
  for (const r of bad) console.error(`   ${r.id}: config allows ${r.have}, its text says "${r.sentence}"`);
  console.error('\n`cantrips` is the PREPARED-per-day cap, not the spellbook/dirge/familiar size — every');
  console.error('selected cantrip is castable (Builder.tsx cantripCap). Set it to the printed number.');
  process.exit(1);
}
console.log(`archetype-cantrip-check: ok — ${rows.length} archetype(s) prepare exactly what their text prints.`);
