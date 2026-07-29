/*
 * Daily-preparation choices, round 2.
 *
 * 69 records whose text pairs "daily preparations" with a choice verb were classified, then every
 * proposal was adversarially re-read against the record. 8 survived unchanged and 30 survived with a
 * correction; the rest were rejected (already covered by ordinary spell preparation, an ally's or the
 * GM's choice, a build decision rather than a daily one, or unrepresentable as data).
 *
 * The single most common defect in the first pass was mine: the classification schema had no `daily`
 * field, so every proposed def would have been stored as a permanent BUILD answer. `dailyChoicesFor`
 * hard-skips anything without `daily: true`, so all 38 would have wired nothing. Everything written
 * here carries it.
 *
 * Reads work/daily-apply.json (confirmed + corrected defs). Written minified.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const COLS = ['feats', 'classFeatures', 'items', 'heritages', 'backgrounds', 'ancestries'];
const db = JSON.parse(readFileSync('public/core.json', 'utf8'));
const rows = JSON.parse(readFileSync('work/daily-apply.json', 'utf8'));

let written = 0;
let merged = 0;
const patches = [];

for (const row of rows) {
  const col = COLS.find((k) => db[k]?.[row.id]);
  if (!col) throw new Error(`${row.id} is not in core.json`);
  const rec = db[col][row.id];
  const def = { ...row.def, daily: true };

  if (!def.flag || !def.prompt || !['array', 'text', 'open'].includes(def.kind)) throw new Error(`${row.id}: malformed def`);
  if (def.kind === 'array' && (def.options ?? []).length < 2) throw new Error(`${row.id}: array choice with <2 options`);
  if (def.kind === 'open' && !def.from) throw new Error(`${row.id}: open choice with no from`);

  if (rec.choice) {
    // Universal Versatility already stored this exact 8-option pick as a BUILD choice. The record
    // says the pick lasts "until your next daily preparations", so the fix is to make the existing
    // choice daily — replacing it would discard answers players have already given.
    if (rec.choice.flag !== def.flag) throw new Error(`${row.id}: existing choice '${rec.choice.flag}' != proposed '${def.flag}' — refusing to clobber`);
    rec.choice = { ...rec.choice, daily: true };
    merged++;
  } else {
    rec.choice = def;
    written++;
  }
  patches.push({ category: col, id: row.id, field: 'choice', value: rec.choice });
}

writeFileSync('public/core.json', JSON.stringify(db)); // minified on purpose

const FILE = 'scripts/data/effect-backfill.json';
const existing = JSON.parse(readFileSync(FILE, 'utf8'));
const key = (p) => `${p.category}|${p.id}|${p.field}`;
const mine = new Set(patches.map(key));
writeFileSync(FILE, JSON.stringify([...existing.filter((p) => !mine.has(key(p))), ...patches], null, 2));

console.log(`daily choices: ${written} added, ${merged} existing choice(s) made daily.`);
