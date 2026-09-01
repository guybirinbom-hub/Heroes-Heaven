/*
 * Batch 14, residual pass 2.
 *
 *   ghostly-resistance — ENTRY REMOVED (2026-08-26); scripts/backfill-parity-fixes.mjs is the sole
 *       owner now. The value this script emitted was superseded twice over: it lacked the
 *       `max(1,…)` sub-4th correction AND the non-magical band, and its `condition`-carrier shape was
 *       itself the defect — derive's aggregator is TYPE-keyed highest-wins, so two entries both typed
 *       'all-damage' collapse to the bigger number. This script has NO --write gate (writeBackfill
 *       runs on every invocation), so leaving the stale entry here meant any re-run silently reverted
 *       the fixed row. One row, one owner.
 *
 *   scales-of-the-dragon — its SECOND printed sentence moved no number.
 *       *"Your resistance from Dragon Disciple Dedication increases to 3 + half your level."* The
 *       dedication's own resistance is `max(1,floor(@actor.level/2))` on all 50 dragon-colour options,
 *       and nothing rewrote it: a 12th-level Dragon Disciple who took Scales had resistance 6 where
 *       print says 9. Authored as the feat's OWN resistance at the upgraded value, one option per
 *       colour mirroring the dedication's, because PF2e resistances of the same type do not stack —
 *       the higher wins and the dedication's entry renders superseded. That needs no new engine lane;
 *       a `modifiesGrant.resistanceValue` would have needed one, and this reaches the player today.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

/* The dedication's own colour list is the authority for which colours exist and what each resists —
 * copied from it rather than re-typed, so the two can never disagree about a colour. */
const ded = core.feats['dragon-disciple-dedication']?.effectChoices?.find((e) => (e.options ?? []).length);
if (!ded) throw new Error('dragon-disciple-dedication: no colour options to mirror');

const UPGRADED = '3 + max(1,floor(@actor.level/2))';
const options = ded.options.map((o) => {
  const type = o.grant?.resistances?.[0]?.type;
  return { value: o.value, label: o.label, ...(type ? { grant: { resistances: [{ type, value: UPGRADED }] } } : {}) };
});
const missing = options.filter((o) => !o.grant).map((o) => o.value);

const edits = [
  /* ghostly-resistance's entry was REMOVED — see the header. backfill-parity-fixes.mjs owns the row. */
  {
    category: 'feats',
    id: 'scales-of-the-dragon',
    field: 'effectChoices',
    value: [{ id: 'dragonColor', prompt: 'Your Dragon Disciple dragon — its resistance rises to 3 + half your level', options }],
  },
];

const rows = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const e of edits) {
  const at = rows.findIndex((r) => r.category === e.category && r.id === e.id && r.field === e.field);
  if (at >= 0) { rows[at] = e; updated++; } else { rows.push(e); added++; }
}
writeBackfill(ROOT, rows);
console.log(`${edits.length} edit(s): ${added} added, ${updated} updated (${rows.length} rows).`);
console.log(`scales-of-the-dragon mirrors ${options.length} colour(s)${missing.length ? `; ${missing.length} carry no resistance on the dedication: ${missing.join(', ')}` : ''}.`);
