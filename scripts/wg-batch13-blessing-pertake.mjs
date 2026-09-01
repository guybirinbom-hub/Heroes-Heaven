/*
 * BLESSING OF THE SUN GODS — every take after the first granted nothing.
 *
 * *"**Special** You can select this feat multiple times, selecting a different domain each time and
 * gaining its domain spell."* `maxTakable: null` means the builder rightly offers it again, but the
 * domain pick lived on `effectChoices`, whose answer is stored ONCE per (record, choiceId). So takes
 * two and three asked nothing, granted no domain spell, and added no Focus Point.
 *
 * Moved onto the record's own `choice`, which is per-TAKING — its answer rides on the taking, keyed by
 * slot — with `distinctAcrossTakes: true` for the printed "a different domain each time". The focus
 * gather in build.ts now reads a per-take choice option's `grant.focusSpells`; it previously walked a
 * SET of record ids, which is why a repeatable feat could only ever contribute once.
 *
 * The option list is carried over verbatim from the effectChoices it replaces — the eleven Old Sun
 * Gods domains and their initial domain spells.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const existing = core.feats['blessing-of-the-sun-gods']?.effectChoices?.[0];
if (!existing?.options?.length) throw new Error('blessing-of-the-sun-gods: no effectChoices to carry over');

const edits = [
  {
    category: 'feats',
    id: 'blessing-of-the-sun-gods',
    field: 'choice',
    value: {
      flag: 'sunGodsDomain',
      prompt: existing.prompt,
      kind: 'array',
      distinctAcrossTakes: true,
      options: existing.options.map((o) => ({ value: o.value, label: o.label, grant: o.grant })),
    },
  },
  /* The per-RECORD picker retires — it could only ever answer once. */
  { category: 'feats', id: 'blessing-of-the-sun-gods', field: 'effectChoices', value: null },
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
