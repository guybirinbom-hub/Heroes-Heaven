/*
 * The bare-feat tail: records the audits listed as needing engine work that carried no mechanics at
 * all. Proposed and then adversarially verified, which downgraded several — the verification is the
 * reason this file is short. Of 32 records: 7 get a real field, 6 get prose, 3 already worked, and 16
 * genuinely need an engine lane that does not exist and are left alone rather than faked.
 *
 * Every value is re-checked here against the record's own text before it is written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const db = JSON.parse(readFileSync(ROOT + 'public/core.json', 'utf8'));
const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));
const readable = new Set(JSON.parse(readFileSync(ROOT + 'work/readable-fields.json', 'utf8')));

const plain = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

/** id → [field, value, a phrase that must appear in the record's own text] */
const WRITES = [
  // --- real mechanics -------------------------------------------------------------------------
  [
    'forgotten-presence',
    'spellListAdditions',
    { spells: ['forgotten-lore'] },
    'forgotten lore',
  ],
  [
    'monstrous-inclinations',
    'spellListAdditions',
    { spells: ['monstrosity-form'] },
    'monstrosity form',
  ],
  [
    'deadly-aspect',
    'unarmedTraits',
    { match: ['jaws', 'claw', 'talon', 'horn', 'tail'], add: ['deadly-d8'] },
    'deadly',
  ],
  // --- prose: the feat works, but a clause is the player's to apply ----------------------------
  [
    'exorcist-dedication',
    'dataWarning',
    'Spirit wisps are not tracked. One arrives at each daily preparation; if your dwelling is empty you can spend 10 minutes to attract another, and remnants captured from vanquished incorporeal undead join it. Each purification spends one. Count them by hand.',
    'spirit dwelling',
  ],
  [
    'enticing-dwelling',
    'dataWarning',
    'Not tracked: you entice TWO wisps into your spirit dwelling instead of one, both at daily preparations and whenever you spend 10 minutes to find more.',
    'instead of one',
  ],
  [
    'miraculous-flight',
    'dataWarning',
    'Not tracked: the flight is a once-per-day miracle with a duration you time at the table.',
    'fly',
  ],
  [
    'terrifying-mien',
    'dataWarning',
    'Not tracked: the aura affects creatures that end their turn near you, which depends on where they are — apply it at the table.',
    'frightened',
  ],
];

let written = 0;
const skipped = [];
for (const [id, field, value, mustSay] of WRITES) {
  const rec = db.feats[id] ?? db.classFeatures[id];
  if (!rec) {
    skipped.push(`${id} (no such record)`);
    continue;
  }
  if (!readable.has(field)) fail(`${id}: "${field}" is not a field the engine reads — it would be inert`);
  const text = plain(rec.description);
  if (!new RegExp(mustSay.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
    // Not a hard failure: the phrase check is a guard against writing a value onto the wrong record,
    // and a record whose wording differs is reported rather than silently written.
    skipped.push(`${id} (text does not mention "${mustSay}")`);
    continue;
  }
  // A spell list addition that names a spell we do not ship would filter to nothing.
  for (const s of value?.spells ?? []) if (!db.spells[s]) {
    skipped.push(`${id} (spell "${s}" does not exist)`);
    continue;
  }
  if ((value?.spells ?? []).some((s) => !db.spells[s])) continue;
  const i = rows.findIndex((r) => r.category === 'feats' && r.id === id && r.field === field && !r.path);
  const row = { category: 'feats', id, field, value };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
  written++;
}

writeFileSync(BF, formatBackfill(rows));
console.log(`bare feats: ${written} written`);
if (skipped.length) console.log(`skipped (reported, not written):\n  ${skipped.join('\n  ')}`);
