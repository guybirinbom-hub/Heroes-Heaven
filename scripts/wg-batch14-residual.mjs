/*
 * Batch 14, residual pass — printed clauses no comparer could see.
 *
 *   weapon-expertise      The SHARED class feature carries `critSpec: true` with no `critSpecWeapons`,
 *                         and the reader treats a bare `critSpec` as "every weapon". So a fighter,
 *                         ranger and rogue all showed critical specialisation on EVERY weapon they
 *                         hold, which no class grants. `false` rather than deleting the field: the
 *                         reader is `if (!e?.critSpec) return;`, and a per-class feature that really
 *                         does grant it carries its own row.
 *
 *   chosen-of-lamashtu    *"…you also gain a goblin heritage"* — the record asked which one and stored
 *   secondary-adaptation  the answer, but without `secondHeritage` nothing resolved it into an actual
 *                         second heritage, so the pick reached nothing. `secondHeritageIdOf` reads it.
 *
 *   thrown-voice          A songbird strix gets 2/day, everyone else 1 — the heritage-conditional grant
 *                         must come FIRST, because the innate dedupe keeps the first entry per spell.
 *
 *   lucky-break           A PASSIVE feat that only widens Cat's Luck's trigger carried its own
 *                         `limitedUses`, so the sheet drew it a 1/day pip row of its own. The uses
 *                         belong to Cat's Luck.
 *
 *   arcane-evolution      The one printed skill-training sentence was asked TWICE — the record's own
 *                         `choice` beside the featGrantsAuto skillChoice that actually trains it.
 *
 *   nephilim-resistance   Same shape: a `choice` with no grants beside the `effectChoices` that grants.
 *
 *   enthralling-allure    *"…doesn't gain the heightened duration or extra targets"* — a clause about
 *                         a spell the feat grants, which is what spellNotes prints on the spell.
 *
 *   zip-zoom              *"The fly Speed you gain from Take Wing increases to 25 feet."* A change to
 *                         another record's grant, which is what modifiesGrant says.
 *
 *   administer-ambient-magic  Two actions, not one (its own printed glyph), and its description had
 *                         lost the healing amount.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8').replace(/^﻿/, ''));

const edits = [
  { category: 'classFeatures', id: 'weapon-expertise', field: 'critSpec', value: false },

  { category: 'feats', id: 'chosen-of-lamashtu', field: 'secondHeritage', value: true },
  { category: 'feats', id: 'secondary-adaptation', field: 'secondHeritage', value: true },

  {
    category: 'feats',
    id: 'thrown-voice',
    field: 'innateSpells',
    value: [
      { spellId: 'ventriloquism', tradition: 'primal', usesPerDay: 2, whenHeritage: ['songbird-strix'] },
      { spellId: 'ventriloquism', tradition: 'primal' },
    ],
  },

  { category: 'feats', id: 'zip-zoom', field: 'modifiesGrant', value: [{ from: 'take-wing', actionRider: { value: '25 feet', note: 'The fly Speed you gain from Take Wing increases to 25 feet.' } }] },

  { category: 'feats', id: 'enthralling-allure', field: 'spellNotes', value: [{ spellId: 'charm', note: 'Cast from Enthralling Allure, the spell does not gain its heightened duration or extra targets.' }] },

  { category: 'actions', id: 'administer-ambient-magic', field: 'actionCost', value: { type: 'actions', value: 2 } },
];

/* The record's own description had lost the healing amount; repaired only if the shipped text really
 * is the damaged one, so a later data refresh that fixes it upstream is not overwritten. */
const aam = String(descs.actions?.['administer-ambient-magic']?.d ?? '');
if (aam && !/\d\s*d\s*\d/.test(aam)) {
  edits.push({
    category: 'actions',
    id: 'administer-ambient-magic',
    field: 'description',
    value: aam.replace(/regain Hit Points/i, 'regain 2d4 Hit Points'),
  });
}

/* Rows whose fix is REMOVAL — a picker or a uses-row that should never have been authored. */
const REMOVE = [
  ['feats', 'lucky-break', 'limitedUses'],
  ['feats', 'arcane-evolution', 'choice'],
  ['feats', 'nephilim-resistance', 'choice'],
];

const rows = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const e of edits) {
  const at = rows.findIndex((r) => r.category === e.category && r.id === e.id && r.field === e.field);
  if (at >= 0) { rows[at] = e; updated++; } else { rows.push(e); added++; }
}
let removed = 0;
const kept = rows.filter((r) => {
  const hit = REMOVE.some(([c, i, f]) => r.category === c && r.id === i && r.field === f);
  if (hit) removed++;
  return !hit;
});
writeBackfill(ROOT, kept);
console.log(`${edits.length} edit(s): ${added} added, ${updated} updated; ${removed} row(s) removed (${kept.length} rows).`);
