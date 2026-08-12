/*
 * Two feats whose whole content is arithmetic on a Speed the character already has.
 *
 * Neither could be written as a `speeds` grant: non-land grants resolve as max(existing, granted), so
 * "+5 feet to your fly Speed" would be swallowed, and "ignore the armour penalty" is not a grant at
 * all. The wording each field encodes is quoted below, from the AoN mirror.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const FIXES = [
  {
    id: 'winged-warrior-dedication',
    // "Any fly Speed granted by ancestry feats and other permanent wings increases by 5 feet."
    // `add` only touches a Speed already above 0 — a character with no wings gains nothing, and the
    // feat's own prerequisite is "you have permanent wings".
    value: { key: 'fly', add: 5 },
  },
  {
    id: 'unburdened-iron',
    // "Ignore the reduction to your Speed from any armor you wear. In addition, any time you're
    //  taking a penalty to your Speed for some other reason … deduct 5 feet from the penalty. …
    //  If your Speed is taking multiple penalties, pick only one penalty to reduce."
    value: { key: 'all', ignoreArmorPenalty: true, reduceOtherPenalty: 5 },
  },
];

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const missing = FIXES.filter((f) => !core.feats[f.id]);
if (missing.length) {
  console.error(`not in core.json: ${missing.map((m) => m.id).join(', ')} — refusing to write`);
  process.exit(1);
}

for (const f of FIXES) core.feats[f.id].speedAdjust = f.value;
writeFileSync(CORE, JSON.stringify(core));

const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const entries = FIXES.map((f) => ({ category: 'feats', id: f.id, field: 'speedAdjust', value: f.value }));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));

console.log(`wrote speedAdjust on ${FIXES.length} feats (backfill ${backfill.length} → ${next.length})`);
