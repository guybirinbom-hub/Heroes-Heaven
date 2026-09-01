/*
 * FREE HEART — the background pick that recorded an answer and did nothing with it.
 *
 * *"Choose a COMMON BACKGROUND that relates to a passion you've pursued; you're TRAINED IN THE SKILLS
 * and gain the SKILL FEAT associated with that background, in addition to those in your normal
 * background."*
 *
 * The record shipped a free-text box whose own `inert` note admitted the answer changed nothing:
 * *"Recorded only. Heroes Heaven can't apply a background's package from a feat yet."* It can now —
 * `OpenChoiceFrom` gained a `background` source, and buildCharacter reads the answer for both halves
 * (the skills, and the granted feat through the same path a real background's feat travels).
 *
 * The picker is `open`, not a 200-option array: backgrounds are content, and inlining them here would
 * freeze a copy that goes stale on the next data refresh. `rarity: 'common'` is the printed
 * restriction and `excludeOwn` keeps the character's own background off the list, since the feat's
 * whole point is a package "in addition to" it.
 *
 *   node scripts/backfill-free-heart.mjs           # report
 *   node scripts/backfill-free-heart.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');

if (!core.feats?.['free-heart']) { console.error('free-heart is not in core.json'); process.exit(2); }
const common = Object.values(core.backgrounds ?? {}).filter((b) => (b.rarity ?? 'common') === 'common');
if (common.length < 50) { console.error(`only ${common.length} common backgrounds — the picker would be near-empty`); process.exit(2); }

const ROWS = [
  {
    category: 'feats',
    id: 'free-heart',
    field: 'choice',
    value: {
      flag: 'freeHeartBackground',
      prompt: 'Background your Free Heart passion draws on',
      kind: 'open',
      from: { type: 'background', rarity: 'common', excludeOwn: true },
      note: "You gain that background's trained skills and its skill feat, in addition to your own background's.",
    },
  },
];

console.log(`free-heart -> a background picker over ${common.length} common background(s).`);
if (!WRITE) { console.log('(report only — pass --write to author)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`wrote ${added} new, ${replaced} replaced (${rows.length} rows).`);
