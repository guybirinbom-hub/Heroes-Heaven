/*
 * UNIVERSAL VERSATILITY — the daily school-spell pick that was never asked.
 *
 * *"During your daily preparations, choose one of the eight school spells gained by 1st-level
 * specialist wizards. You can use that school spell until your next daily preparation."*
 *
 * The record carried `focusPoolBonus: 1` and nothing else: the player got a Focus Point and no spell
 * to spend it on. This authors the choice, and REMOVES the flat pool bonus, because in this engine a
 * granted focus SPELL carries its own pool point (`applyFeatFocus`) and `focusPoolBonus` is for
 * pool-only feats. Leaving both would pay twice — which is exactly what `grantsFocusByChoice` exists
 * to prevent, and why an earlier attempt to add the choice alone dropped a pool from 3 to 2.
 *
 * ⚠ THE OPTION LIST IS THE APP'S SCHOOLS, NOT THE PRINTED "EIGHT". The sentence predates the Remaster,
 * which replaced the eight classical schools with the curricula this dataset ships. Every school that
 * grants a 1st-level school spell is offered, computed from the wizard subclass options — picking
 * which eight of them the sentence "really" meant would be inventing a restriction the current rules
 * do not state. Menu filtering is the one place this app has the last word.
 *
 *   node scripts/backfill-universal-versatility.mjs           # report
 *   node scripts/backfill-universal-versatility.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');

const schools = core.classes?.wizard?.subclass?.options ?? [];
if (!schools.length) { console.error('no wizard schools in core.json'); process.exit(2); }

const options = [];
for (const s of schools) {
  const spellId = (s.focusSpells ?? [])[0];
  if (!spellId) continue;
  const spell = core.spells?.[spellId];
  if (!spell) { console.error(`${s.id} names focus spell ${spellId}, which is not in core.spells`); process.exit(2); }
  options.push({
    value: spellId,
    label: spell.name,
    description: `${s.name}'s school spell.`,
    grant: { focusSpells: [spellId] },
  });
}
if (options.length < 8) { console.error(`only ${options.length} school spells resolved — the printed clause names eight`); process.exit(2); }

const ROWS = [
  {
    category: 'feats',
    id: 'universal-versatility',
    field: 'choice',
    value: {
      flag: 'schoolSpell',
      prompt: 'School spell for today',
      kind: 'array',
      daily: true,
      options,
    },
  },
  /* The chosen spell brings its own point; see the header. */
  { category: 'feats', id: 'universal-versatility', field: 'focusPoolBonus', value: null },
];

console.log(`${options.length} school spell(s) offered:`);
for (const o of options) console.log(`   ${o.value.padEnd(24)} ${o.label}`);
console.log('\nand focusPoolBonus is REMOVED — the granted spell carries the point.');

if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`\nwrote ${added} new, ${replaced} replaced (${rows.length} rows).`);
