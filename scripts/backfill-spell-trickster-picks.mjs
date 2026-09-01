/*
 * SPELL TRICKSTER DEDICATION RECORDED ITS TWO FEATS AND GRANTED NEITHER (feats/spell-trickster-dedication).
 *
 * *"Choose up to two 4th-level spell trickster archetype feats for which you meet the spell-casting
 * prerequisite. You gain those feats, ignoring their level prerequisite."* (Grand Bazaar pg. 122.)
 *
 * The record carried its own `choice` — a two-answer array over the seven 4th-level archetype feats —
 * explicitly marked `inert: "Recorded only — the two feats are not added to your sheet, so add their
 * benefits yourself."` Nothing in src/ ever read the flag (`tricksterFeats`), so the picker stored an
 * answer no code could act on: a player who chose Barrier Shield and Tracing Sigil gained the words
 * and none of the mechanics.
 *
 * The lane now exists — `FeatPickSpec.picks` grants several feats from one pool, and
 * `FEAT_PICK_GRANTS['spell-trickster-dedication']` lists the same seven ids — so this script removes
 * the record's own `choice`. That is the systemic class the batches 5-16 read exposed 27 times: a
 * record's `choice` sitting beside a working picker shows the player TWO dropdowns for one printed
 * decision and leaves the record's answer inert. Guarded by `duplicate-pick-check.mjs`.
 *
 * ⚠ The `note` on the old choice is not lost information — the same two facts (you may take fewer than
 * two; the spell-casting prerequisite is not checked) are stated in the FEAT_PICK_GRANTS comment, and
 * both are properties of the picker rather than of the record.
 *
 *   node scripts/backfill-spell-trickster-picks.mjs [--write]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const rec = core.feats?.['spell-trickster-dedication'];
if (!rec) { console.error('feats/spell-trickster-dedication is missing'); process.exit(2); }

/* The seven the spec offers. Read back from the source of truth rather than retyped, so this script
 * fails loudly if the two lists ever drift apart instead of quietly clearing a picker the engine
 * cannot replace. */
const SPEC_IDS = ['agile-hand', 'barrier-shield', 'forceful-push', 'shining-arms', 'summon-ensemble', 'tracing-sigil', 'wild-lights'];

const missing = SPEC_IDS.filter((id) => !core.feats?.[id]);
if (missing.length) { console.error(`refusing: the picker would offer feats that do not exist — ${missing.join(', ')}`); process.exit(2); }

const fourth = Object.entries(core.feats)
  .filter(([, f]) => f.archetype === 'spell-trickster' && f.level === 4)
  .map(([id]) => id)
  .sort();
if (fourth.join(',') !== [...SPEC_IDS].sort().join(',')) {
  console.error(`refusing: the 4th-level spell trickster feats in the data are [${fourth.join(', ')}], which is not the seven the spec offers.`);
  process.exit(2);
}

const oldChoice = rec.choice;
if (!oldChoice) {
  console.log('the record already carries no `choice` — nothing to clear.');
  process.exit(0);
}
console.log(`clearing choice: flag=${oldChoice.flag} picks=${oldChoice.picks} options=${(oldChoice.options ?? []).length}`);
console.log(`  inert marker was: ${oldChoice.inert ?? '(none)'}`);

const clear = { category: 'feats', id: 'spell-trickster-dedication', field: 'choice', value: null };

if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }

const rows = readBackfill(ROOT);
const at = rows.findIndex((x) => x.category === clear.category && x.id === clear.id && x.field === clear.field);
if (at >= 0) rows[at] = clear; else rows.push(clear);
writeBackfill(ROOT, rows);
console.log(`wrote (${rows.length} rows).`);
