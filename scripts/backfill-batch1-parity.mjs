/*
 * BATCH 1 PARITY FIXES — the records where the read found ours differing from theirs.
 *
 * 1. VENOMOUS SPIT HAS NO WEAPON GROUP (heritages/hooded-nagaji, feats/venom-spit).
 *    Both print *"Your spit doesn't have a weapon group or a critical specialization effect"* and both
 *    shipped `group: 'brawling'`. That is a mechanical error, not a label: critSpecWeapons matches on
 *    group, so the brawling critical specialization was reachable on an attack the book explicitly
 *    denies it to. Their side agrees with the book — the item BOTH of their records hand out (the same
 *    one, so the two records cannot drift apart on their side) carries category `unarmed_attack` and no
 *    weapon group. So ours diverged from the printed text and from theirs simultaneously.
 *
 *    The whole `grantedStrikes` array is rewritten rather than patched, because the overlay's `value:
 *    null` removal works on a record FIELD and these live inside array elements. Everything else in the
 *    element is carried across unchanged and asserted below.
 *
 * 2. SONGBIRD'S BRUSH GRANTS +2 PERFORMANCE (items/songbirds-brush).
 *    *"A songbird's brush grants a +2 item bonus to Performance checks made to dance or sing as long as
 *    the glaive is held in two hands."* We encoded the weapon, its runes, its activation and its
 *    frequency — and not this sentence, so the bonus reached nothing. Their side encodes it as a
 *    Performance bonus of 2 gated on holding it in two hands.
 *
 *    It goes in `situational`, not into a flat bonus: it is gated on how the item is held, and the
 *    owner's ruling is that a conditional value is a star, never a number. Held-in-two-hands is a
 *    circumstance that changes during play — a character can stow it or draw a shield.
 *
 *   node scripts/backfill-batch1-parity.mjs [--write]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const rows = [];
const notes = [];

/* --- 1: drop the weapon group from both venomous-spit strikes --- */
for (const [bucket, id] of [['heritages', 'hooded-nagaji'], ['feats', 'venom-spit']]) {
  const rec = core[bucket]?.[id];
  if (!rec) { notes.push(`${bucket}/${id}: record missing — skipped`); continue; }
  const strikes = rec.grantedStrikes ?? [];
  if (!strikes.some((s) => s?.group)) { notes.push(`${bucket}/${id}: already has no group — skipped`); continue; }
  /* Carry every other field across untouched; only `group` is dropped. */
  const next = strikes.map(({ group, ...rest }) => rest);
  rows.push({ category: bucket, id, field: 'grantedStrikes', value: next });
  notes.push(`${bucket}/${id}: dropping group=${strikes.map((s) => s.group).filter(Boolean).join(',')} from ${strikes.length} strike(s)`);
}

/* --- 2: the Songbird's Brush Performance bonus --- */
const brush = core.items?.['songbirds-brush'];
if (!brush) notes.push('items/songbirds-brush: record missing — skipped');
else {
  const existing = brush.situational ?? [];
  if (existing.some((s) => /performance/i.test(JSON.stringify(s)))) {
    notes.push('items/songbirds-brush: already carries a Performance situational — skipped');
  } else {
    rows.push({
      category: 'items',
      id: 'songbirds-brush',
      field: 'situational',
      value: [
        ...existing,
        {
          targets: [{ kind: 'skill', detail: 'performance' }],
          when: 'to dance or sing, while the glaive is held in two hands',
          bonus: '+2 item',
        },
      ],
    });
    notes.push(`items/songbirds-brush: adding +2 item bonus to Performance (${existing.length} existing situational kept)`);
  }
}

for (const n of notes) console.log(`   ${n}`);
console.log(`\n${rows.length} row(s).`);
if (!rows.length) process.exit(0);
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }

const all = readBackfill(ROOT);
for (const row of rows) {
  const at = all.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) all[at] = row; else all.push(row);
}
writeBackfill(ROOT, all);
console.log(`wrote (${all.length} rows).`);
