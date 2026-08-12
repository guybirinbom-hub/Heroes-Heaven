/*
 * Move an item's top-level resistances / weaknesses / immunities / senses / speeds under
 * `passiveEffects`, which is the only place the engine reads them from.
 *
 * deriveDefenses (derive.ts ~783) and deriveSpeeds (~1876) both look at
 * `db.items[inv.itemId].passiveEffects` and nothing else. A top-level `resistances` on an item is
 * read by NO code path, so 76 records were carrying defences that never reached a sheet — and worse,
 * scripts/measure-goal.mjs counts those field names as mechanical, so every one of them was being
 * reported as covered. That is the exact failure this whole audit exists to find, sitting inside the
 * data rather than in a description.
 *
 * Found by an adversary on the item audit while checking a single record (ghoul-hide).
 *
 * Usage: node scripts/migrate-item-passives.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const WRITE = process.argv.includes('--write');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));

/** Every field that belongs under passiveEffects and is dead at the top level. */
const MOVE = ['resistances', 'weaknesses', 'immunities', 'senses', 'speeds'];

const moved = [];
const conflicts = [];
const dropped = [];
/** `<id>.<field>` pairs whose top-level copy must survive — we could not reconcile the two. */
const keep = new Set();
for (const [id, it] of Object.entries(core.items)) {
  const present = MOVE.filter((f) => it[f] != null && (!Array.isArray(it[f]) || it[f].length));
  if (!present.length) continue;
  const pe = { ...(it.passiveEffects ?? {}) };
  const took = [];
  for (const f of present) {
    if (pe[f] != null && JSON.stringify(pe[f]) === JSON.stringify(it[f])) {
      dropped.push(`${id}.${f} (already identical under passiveEffects)`);
      continue;
    }
    if (pe[f] != null) {
      // Both exist and differ. The passiveEffects copy is the one that ships, so the item WORKS —
      // these are spelling differences ("greater darkvision" vs "greater-darkvision") or one list
      // being more precise than the other. Do not guess, and do not delete the richer copy either.
      conflicts.push(`${id}.${f}: top-level ${JSON.stringify(it[f])} vs passiveEffects ${JSON.stringify(pe[f])}`);
      keep.add(`${id}.${f}`);
      continue;
    }
    pe[f] = it[f];
    took.push(f);
  }
  if (took.length || present.some((f) => !keep.has(`${id}.${f}`))) moved.push({ id, fields: took, pe });
}

console.log(`items with top-level defence fields: ${moved.length}`);
const tally = {};
for (const m of moved) for (const f of m.fields) tally[f] = (tally[f] ?? 0) + 1;
for (const [f, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)} ${f}`);
if (dropped.length) console.log(`\nredundant duplicates removed: ${dropped.length}\n  ${dropped.slice(0, 5).join('\n  ')}`);
if (conflicts.length) {
  console.log(`\nBOTH COPIES PRESENT AND DIFFERENT (${conflicts.length}) — the item WORKS (passiveEffects ships);`);
  console.log('these are spelling/precision differences and are left exactly as they are:');
  for (const c of conflicts) console.log('  ' + c);
}

if (!WRITE) { console.log('\n--write to apply'); process.exit(0); }

const OVERLAY = p('scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let ovAdd = 0;
for (const m of moved) {
  core.items[m.id].passiveEffects = m.pe;
  // Strip only the dead top-level copies we could account for; an unreconciled one stays put.
  for (const f of MOVE) if (!keep.has(`${m.id}.${f}`)) delete core.items[m.id][f];
  const at = overlay.findIndex((x) => x.category === 'items' && x.id === m.id && x.field === 'passiveEffects');
  if (at >= 0) overlay[at] = { ...overlay[at], value: m.pe };
  else { overlay.push({ category: 'items', id: m.id, field: 'passiveEffects', value: m.pe }); ovAdd++; }
  // Drop any overlay entry that would put the dead top-level field back on the next regeneration.
  for (let i = overlay.length - 1; i >= 0; i--) {
    if (overlay[i].category === 'items' && overlay[i].id === m.id && MOVE.includes(overlay[i].field)) overlay.splice(i, 1);
  }
}
writeFileSync(p('public/core.json'), JSON.stringify(core));
writeFileSync(OVERLAY, formatBackfill(overlay));
console.log(`\nmigrated ${moved.length} items; ${ovAdd} new overlay entries`);
