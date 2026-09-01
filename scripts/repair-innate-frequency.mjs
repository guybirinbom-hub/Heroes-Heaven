/*
 * RESTORE THE FREQUENCY ON INNATE SPELLS WHOSE TEXT STATES ONE.
 *
 * An innate grant with no `usesPerDay` is castable AT WILL. 79 grants across 70-odd records printed
 * "once per day" and carried no limit, so the app handed out at-will Regenerate, Chain Lightning and
 * Prismatic Armor — the most valuable thing a feat can give, delivered by an omission rather than a
 * decision. Found in batch 15's residual read (Distant Cackle), measured by
 * `scripts/innate-frequency-check.mjs`, which holds the class at zero afterwards.
 *
 * The count comes from the record's own sentence — once / twice / three times / N times. Records whose
 * text mentions BOTH a per-day frequency and "at will" are left alone: they grant several spells on
 * different terms, and one number cannot be applied to all of them.
 *
 *   node scripts/repair-innate-frequency.mjs           # report
 *   node scripts/repair-innate-frequency.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

const PER_DAY = /\b(once|twice|thrice|three times|four times|(\d+) times)\s+per\s+day\b/i;
const AT_WILL = /\bat will\b/i;
const COUNT = { once: 1, twice: 2, thrice: 3, 'three times': 3, 'four times': 4 };

const edits = [];
for (const bucket of Object.keys(core)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    const grants = rec?.innateSpells;
    if (!Array.isArray(grants) || !grants.length) continue;
    const d = String(descs[bucket]?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = PER_DAY.exec(d);
    if (!m || AT_WILL.test(d)) continue;
    const n = m[2] ? Number(m[2]) : COUNT[m[1].toLowerCase()];
    if (!n) continue;

    let changed = false;
    const next = grants.map((g) => {
      /* A cantrip is at-will by its nature; its frequency sentence is about something else. */
      if ((core.spells?.[g.spellId]?.traits ?? []).includes('cantrip')) return g;
      if (g.usesPerDay != null || g.atWill != null) return g;
      changed = true;
      return { ...g, usesPerDay: n };
    });
    if (changed) edits.push({ category: bucket, id, field: 'innateSpells', value: next, n, spells: next.filter((g) => g.usesPerDay === n).map((g) => g.spellId) });
  }
}

console.log(`${edits.length} record(s) to limit.\n`);
for (const e of edits.slice(0, 20)) console.log(`  ${(e.category + '/' + e.id).padEnd(34)} ${e.n}/day  ${e.spells.join(', ')}`);
if (edits.length > 20) console.log(`  …and ${edits.length - 20} more`);
const multi = edits.filter((e) => e.spells.length > 1);
if (multi.length) {
  console.log(`\n${multi.length} record(s) grant SEVERAL spells and the sentence states one frequency — each gets its own`);
  console.log(`allowance, which is the closest the schema can come to a shared one:`);
  for (const e of multi) console.log(`   ${e.category}/${e.id} — ${e.spells.join(', ')}`);
}

if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const e of edits) {
  const row = { category: e.category, id: e.id, field: 'innateSpells', value: e.value };
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`\nwrote ${added} new row(s), ${replaced} replaced (${rows.length} rows total).`);
