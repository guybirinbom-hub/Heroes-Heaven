/*
 * The last of the build-time choice lane.
 *
 * 115 records printed "choose/select/pick" at build time and carried no picker, so the player was
 * never asked and the answer was never recorded. Each was classified, then every proposal was
 * adversarially re-read against the record AND against the app's own shapes. 12 survived unchanged,
 * 58 with a correction; the rest were rejected as play-time picks, already covered by a working
 * picker, or unrepresentable.
 *
 * Two lanes, and choosing wrongly between them is the damaging mistake:
 *   effectChoices — the pick GRANTS something (a spell, a focus spell, a sense, a resistance)
 *   choice        — the pick only needs REMEMBERING; `inert` carries the reason nothing is applied
 *
 * The verify pass caught a defect in the classification SCHEMA, not just in the data: I declared
 * `inert` as a boolean, but `FeatChoiceDef.inert` is a REASON STRING that the builder renders as
 * text. Every boolean was rewritten to the row's own explanation of what is not applied.
 *
 * Reads work/choice-apply.json. Refuses to write over an existing picker.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const COLS = ['feats', 'classFeatures', 'items', 'heritages', 'backgrounds', 'ancestries'];
const db = JSON.parse(readFileSync('public/core.json', 'utf8'));
const rows = JSON.parse(readFileSync('work/choice-apply.json', 'utf8'));

let choices = 0;
let effects = 0;
const patches = [];

for (const row of rows) {
  const col = COLS.find((k) => db[k]?.[row.id]);
  if (!col) throw new Error(`${row.id} is not in core.json`);
  const rec = db[col][row.id];

  if (row.verdict === 'choice') {
    const d = row.choice;
    if (!d?.flag || !d.prompt || !['array', 'text', 'open', 'skills'].includes(d.kind)) throw new Error(`${row.id}: malformed choice`);
    if (d.inert !== undefined && typeof d.inert !== 'string') throw new Error(`${row.id}: inert must be a reason STRING`);
    if (d.kind === 'array' && (d.options ?? []).length < 2) throw new Error(`${row.id}: array choice with <2 options`);
    if (d.kind === 'open' && !d.from) throw new Error(`${row.id}: open choice with no from`);
    if (rec.choice) throw new Error(`${row.id}: already has a picker — refusing to clobber`);
    rec.choice = d;
    patches.push({ category: col, id: row.id, field: 'choice', value: d });
    choices++;
  } else {
    const ecs = row.effectChoices ?? [];
    if (!ecs.length) throw new Error(`${row.id}: no effectChoices`);
    if ((rec.effectChoices ?? []).length) throw new Error(`${row.id}: already has effectChoices — refusing to clobber`);
    for (const e of ecs) {
      if (!e.id || !e.prompt) throw new Error(`${row.id}: effectChoice missing id/prompt`);
      if (!!e.options === !!e.spellFilter) throw new Error(`${row.id}/${e.id}: needs exactly one of options / spellFilter`);
      for (const o of e.options ?? []) {
        for (const s of o.grant?.innateSpells ?? []) if (!db.spells[s.spellId]) throw new Error(`${row.id}/${o.value}: spell '${s.spellId}' missing`);
        for (const s of o.grant?.focusSpells ?? []) if (!db.spells[s]) throw new Error(`${row.id}/${o.value}: focus spell '${s}' missing`);
      }
    }
    rec.effectChoices = ecs;
    patches.push({ category: col, id: row.id, field: 'effectChoices', value: ecs });
    effects++;
  }
}

writeFileSync('public/core.json', JSON.stringify(db)); // minified on purpose

const FILE = 'scripts/data/effect-backfill.json';
const existing = JSON.parse(readFileSync(FILE, 'utf8'));
const key = (p) => `${p.category}|${p.id}|${p.field}`;
const mine = new Set(patches.map(key));
writeFileSync(FILE, JSON.stringify([...existing.filter((p) => !mine.has(key(p))), ...patches], null, 2));

console.log(`build choices: ${choices} recorded-only pickers, ${effects} that actually grant.`);
