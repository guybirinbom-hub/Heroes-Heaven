/**
 * DO WE HAVE A FIELD FOR EVERY OPERATION THEY CAN WRITE?
 *
 * Wanderer's Guide encodes a feature's effects as a list of generic OPERATIONS — a small set of verbs,
 * each carrying the thing it acts on in a string (`adjValue(SKILL_STEALTH, "T")`). We encode the same
 * game as ~190 named typed fields. Before another parity batch runs, the useful question is not "what
 * did they say about this record" but "is there anything they can SAY that we have no way to hear".
 *
 * A verb with no field behind it does not fail loudly. It comes back from a batch as `needs-new-lane`,
 * one record at a time, after the reading is already paid for. Batch 001 spent 15 of its 100 records
 * discovering exactly that — and one of the fifteen turned out to block the method itself rather than
 * its own record.
 *
 * So: enumerate every operation type in their dump, weight it by how many records actually use it, and
 * report which of them `wg-diff.mjs` can already translate into one of our fields.
 *
 * ⚠ READS THEIR DATA, COPIES NONE OF IT. `work/wg/` is GPL-3.0 and gitignored; this app ships
 * proprietary. The output is verb names and counts — facts about the shape of their schema, not their
 * encodings. Any fix that follows is authored from the printed rules text (Paizo, ORC), as always.
 *
 *   node scripts/wg-vocabulary.mjs
 *   node scripts/wg-vocabulary.mjs --variables    # also break adjValue/setValue down by target
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOps, flattenOps, parseCopyBlock } from './lib/wg-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DUMP = join(ROOT, 'work/wg/wg-data.sql');
const has = (k) => process.argv.includes(k);

if (!existsSync(DUMP)) {
  console.error(`no dump at ${DUMP} — it is gitignored on purpose (GPL-3.0). Restore it locally to run this.`);
  process.exit(1);
}

/*
 * The translation table lives in wg-diff.mjs, which is a script rather than a lib, so importing it
 * would run it. Re-declaring it here would be the "two copies of one predicate" mistake this codebase
 * has been bitten by repeatedly — so read the verbs straight out of that file's source instead. If a
 * verb is handled there, it appears as a `case '<verb>':` in kindOfTheirOp.
 */
const diffSrc = readFileSync(join(ROOT, 'scripts/wg-diff.mjs'), 'utf8');
const kindFn = diffSrc.slice(diffSrc.indexOf('const kindOfTheirOp'), diffSrc.indexOf('/** Our fields, in the same currency'));
const HANDLED = new Set([...kindFn.matchAll(/case '([A-Za-z]+)':/g)].map((m) => m[1]));
const OUR_KINDS_SRC = diffSrc.slice(diffSrc.indexOf('const OUR_KINDS'), diffSrc.indexOf('const fieldToKinds'));
const MAPPED_KINDS = new Set([...OUR_KINDS_SRC.matchAll(/^\s{2}([A-Za-z_]+):/gm)].map((m) => m[1]));

/* ---------------------------------------------------------------- read their operations */
const sql = readFileSync(DUMP, 'utf8');
const verbs = new Map();          // type -> {records, ops}
const variables = new Map();      // "type:VARIABLE_PREFIX" -> count
let rows = 0, withOps = 0;

/*
 * `ability_block` is the table wg-diff.mjs reads: one row per feat/class-feature/etc., with the
 * encoding in an `operations` column. Rows span physical lines, so the shared parser is what makes
 * this correct — a naive split on tabs read 14,034 of 26,824 rows and looked like it had worked.
 */
const { rows: theirRows, cols } = parseCopyBlock(sql, 'ability_block');
const opsIx = cols.indexOf('operations');
if (opsIx < 0) { console.error('no `operations` column in ability_block'); process.exit(1); }

for (const row of theirRows) {
  rows++;
  const parsed = parseOps(row.operations);
  const ops = parsed.flatMap((o) => flattenOps(o));
  if (!ops.length) continue;
  withOps++;
  const seen = new Set();
  for (const op of ops) {
    const t = String(op?.type ?? '(untyped)');
    const e = verbs.get(t) ?? { records: 0, ops: 0 };
    e.ops++;
    if (!seen.has(t)) { e.records++; seen.add(t); }
    verbs.set(t, e);
    if (has('--variables') && /Value$/.test(t)) {
      const v = String(op?.data?.variable ?? '(none)').split('_')[0];
      const k = `${t}:${v}`;
      variables.set(k, (variables.get(k) ?? 0) + 1);
    }
  }
}

const sorted = [...verbs.entries()].sort((a, b) => b[1].records - a[1].records);
console.log(`${rows.toLocaleString()} rows in their dump, ${withOps.toLocaleString()} carrying operations`);
console.log(`${sorted.length} distinct operation verbs\n`);
console.log(`${'their verb'.padEnd(24)} ${'records'.padStart(8)} ${'ops'.padStart(8)}   we can translate it?`);

let unhandled = 0, unhandledRecords = 0;
for (const [type, e] of sorted) {
  const ok = HANDLED.has(type);
  if (!ok) { unhandled++; unhandledRecords += e.records; }
  console.log(`${type.padEnd(24)} ${String(e.records).padStart(8)} ${String(e.ops).padStart(8)}   ${ok ? 'yes' : 'NO — falls through to the default'}`);
}

console.log(`\n${sorted.length - unhandled} of ${sorted.length} verbs have an explicit case in wg-diff.mjs.`);
if (unhandled) {
  console.log(`${unhandled} do not, covering ${unhandledRecords.toLocaleString()} records — they land on the \`default\` branch,`);
  console.log('which calls everything `value`. That is not a translation; it is a shrug that reads as coverage.');
}

console.log(`\nkinds our side declares fields for: ${[...MAPPED_KINDS].filter((k) => !k.startsWith('_')).join(', ')}`);
const noCounterpart = (OUR_KINDS_SRC.match(/_noCounterpart:\s*\[([^\]]*)\]/) ?? [])[1];
if (noCounterpart) console.log(`\nours with no verb on their side (they cannot say these at all):\n  ${noCounterpart.replace(/'/g, '').trim()}`);

/*
 * ---------------------------------------------------------------- the real question
 *
 * Verb coverage is the easy half and it flatters. Their three value verbs — adjValue, setValue,
 * addBonusToValue, together 3,037 records — are GENERIC: the verb says "change a number" and the
 * meaning is entirely in the variable name. `kindOfTheirOp` reads that name through a chain of
 * regexes and, when none match, returns `'value'`.
 *
 * `'value'` is not a key in OUR_KINDS. So it maps to no field at all: the record is counted as
 * translated, and then quietly has nowhere to go. THAT is where a missing lane hides — not in an
 * unknown verb, but in a known verb pointed at a variable we do not recognise.
 */
const VALUE_VERBS = new Set(['adjValue', 'setValue', 'addBonusToValue']);
const RECOGNISED = [
  /^SKILL_|^LORE_/, /^SAVE_/, /^PERCEPTION/, /^AC|ARMOR/, /^SPEED/, /^RESIST|^IMMUNITIES|^WEAKNESS/,
  /^MAX_HEALTH|^HEALTH/, /^SPELL_ATTACK|^SPELL_DC|^CASTING/, /^ATTRIBUTE_|^ATTR_/,
  /WEAPON|ATTACK|^UNARMED/, /^SENSE|VISION|DARKVISION/, /^SIZE/, /^CLASS_DC/, /^FOCUS_POINT/,
  /^BULK_LIMIT|^IMPLANT_LIMIT/, /^LANGUAGE|MULTILINGUAL/, /^PRIMARY_SHEET_TABS|^PAGE_/,
  /^BLACKLIST_|^WHITELIST_/,
];
const fellThrough = new Map();
let valueOps = 0, matched = 0;
for (const row of theirRows) {
  for (const op of parseOps(row.operations).flatMap((o) => flattenOps(o))) {
    if (!VALUE_VERBS.has(String(op?.type))) continue;
    valueOps++;
    const v = String(op?.data?.variable ?? '(none)');
    if (RECOGNISED.some((re) => re.test(v))) { matched++; continue; }
    fellThrough.set(v, (fellThrough.get(v) ?? 0) + 1);
  }
}
const fellCount = valueOps - matched;
console.log('\n--- where the generic value verbs actually point ---');
console.log(`${valueOps.toLocaleString()} value operations; ${matched.toLocaleString()} match a known target pattern.`);
console.log(`${fellCount.toLocaleString()} (${((100 * fellCount) / valueOps).toFixed(1)}%) fall through to \`'value'\`, which is NOT a key in OUR_KINDS —`);
console.log(`so they are reported as understood and map to no field. ${fellThrough.size} distinct variables.`);
if (fellThrough.size) {
  console.log('\nthe unmapped targets, by frequency:');
  for (const [v, n] of [...fellThrough.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${v.slice(0, 46).padEnd(48)} ${n}`);
  }
  if (fellThrough.size > 25) console.log(`  … ${fellThrough.size - 25} more`);
}

if (has('--variables')) {
  console.log('\nadjValue/setValue by target prefix:');
  for (const [k, n] of [...variables.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${k.padEnd(40)} ${n}`);
  }
}
